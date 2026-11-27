use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum Entry {
    AudioState {
        key: String,
        revision: i64,
        deleted: bool,
    },
    Cover {
        key: String,
        bytes: usize,
        hash: String,
    },
    Audio {
        key: String,
        manifest: Manifest,
    },
    Original {
        hash: String,
        bytes: usize,
    },
}

impl Entry {
    pub(super) fn order(&self) -> String {
        match self {
            Self::AudioState { key, .. } => format!("0{key}"),
            Self::Cover { key, .. } => format!("1{key}"),
            Self::Original { hash, .. } => format!("2{hash}"),
            Self::Audio { key, .. } => format!("3{key}"),
        }
    }

    pub(super) fn bytes(&self) -> usize {
        match self {
            Self::AudioState { .. } => 0,
            Self::Cover { bytes, .. } | Self::Original { bytes, .. } => *bytes,
            Self::Audio { manifest, .. } => manifest.bytes as usize,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
pub enum Request {
    List {
        after: String,
    },
    Offer(Entry),
    Read {
        entry: Entry,
        offset: usize,
    },
    Write {
        entry: Entry,
        offset: usize,
        data: String,
    },
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum Need {
    Done,
    Space,
    Offset(usize),
}

#[derive(Debug, Deserialize, Serialize)]
pub enum Reply {
    List(Vec<Entry>),
    Need(Need),
    Data(Option<String>),
}

#[derive(Default, Debug, Serialize)]
pub struct Round {
    pub pending: bool,
    pub storage: bool,
}

pub(super) fn list(db: &Connection, after: &str) -> Result<Vec<Entry>> {
    let mut sql = db
        .prepare(
            "SELECT identity,key,value,bytes,revision,deleted FROM (
           SELECT '0'||source_key identity, source_key key, NULL value, 0 bytes, revision, deleted
             FROM library_audio_state
           UNION ALL
           SELECT '1'||video_id, video_id, sha256, length(data),0,0 FROM library_youtube_artwork a
             WHERE EXISTS(SELECT 1 FROM files f WHERE
               json_extract(f.media_source,'$.provider')='youtube'
               AND json_extract(f.media_source,'$.video_id')=a.video_id)
           UNION ALL
           SELECT '2'||sha256,sha256,NULL,bytes,0,0 FROM library_document_originals a
             WHERE EXISTS(SELECT 1 FROM files f WHERE json_extract(f.document_source,'$.source_sha256')=a.sha256)
           UNION ALL
           SELECT '3'||source_key,source_key,manifest_json,0,0,0 FROM source_media m
             WHERE status='ready' AND asset_id IS NOT NULL AND manifest_json IS NOT NULL
               AND NOT EXISTS(SELECT 1 FROM library_audio_state d
                 WHERE d.source_key=m.source_key AND d.deleted)
               AND EXISTS(SELECT 1 FROM files f WHERE f.media_identity=m.source_key)
         ) WHERE identity>? ORDER BY identity LIMIT ?",
        )
        .map_err(err)?;
    let rows = sql
        .query_map(params![after, PAGE], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, usize>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, bool>(5)?,
            ))
        })
        .map_err(err)?;
    let mut entries = Vec::new();
    for row in rows {
        let (id, key, value, bytes, revision, deleted) = row.map_err(err)?;
        match id.as_bytes()[0] {
            b'0' => entries.push(Entry::AudioState {
                key,
                revision,
                deleted,
            }),
            b'1' => entries.push(Entry::Cover {
                key,
                bytes,
                hash: value.unwrap_or_default(),
            }),
            b'2' => entries.push(Entry::Original { hash: key, bytes }),
            _ => {
                let manifest: Manifest =
                    serde_json::from_str(&value.unwrap_or_default()).map_err(err)?;
                entries.push(Entry::Audio { key, manifest });
            }
        }
    }
    // Keep pagination stable even if a local file has gone missing. The
    // receiver handles a stale entry's absent read without installing it.
    Ok(entries)
}

fn attached_source(db: &Connection, key: &str) -> Result<Option<(String, YoutubeSource)>> {
    let raw: Option<String> = db.query_row(
        "SELECT media_source FROM files WHERE media_identity=? AND media_source IS NOT NULL LIMIT 1",
        [key],
        |row| row.get(0),
    ).optional().map_err(err)?;
    raw.map(|raw| {
        let source: YoutubeSource = serde_json::from_str(&raw).map_err(err)?;
        source.validate()?;
        Ok((raw, source))
    })
    .transpose()
}

pub(super) fn target(
    db: &Connection,
    dir: &Path,
    key: &str,
    m: &Manifest,
) -> Result<Option<(String, PathBuf)>> {
    if !media::valid_hash(key)
        || !media::valid_hash(&m.sha256)
        || !(1..=media::MAX_BYTES).contains(&m.bytes)
    {
        return Err("invalid audio attachment".into());
    }
    if audio_removed(db, key)? {
        return Ok(None);
    }
    let Some((raw, source)) = attached_source(db, key)? else {
        return Ok(None);
    };
    let Some(track) = source.audio.as_ref() else {
        return Ok(None);
    };
    let (codec, suffix) = if source.provider == "local" {
        ("pcm_s16le", "wav")
    } else {
        ("aac", "m4a")
    };
    if source.key != key
        || m.video_id != source.video_id
        || m.codec != codec
        || m.format_id != track.format_id
        || m.language != track.language
        || m.language_basis != track.language_basis
        || m.start_ms != 0
        || m.offset_ms != 0
        || !(1..=media::MAX_DURATION_MS).contains(&m.duration_ms)
        || m.duration_ms.abs_diff(source.duration_ms) > 5_000
    {
        return Err("audio does not match material source".into());
    }
    let path = dir.join(format!("{}.{suffix}", m.sha256));
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err("invalid audio destination".into());
    }
    Ok(Some((raw, path)))
}

fn partial(dir: &Path, key: &str, hash: &str) -> PathBuf {
    dir.join(format!(".lan-{key}-{hash}.part"))
}

fn check_cover(key: &str, bytes: usize, hash: &str) -> Result<()> {
    if !super::super::youtube::is_valid_video_id(key)
        || !(1..=COVER_BYTES).contains(&bytes)
        || !media::valid_hash(hash)
    {
        return Err("invalid cover attachment".into());
    }
    Ok(())
}

fn offer(db: &Connection, dir: &Path, entry: &Entry) -> Result<Need> {
    match entry {
        Entry::AudioState {
            key,
            revision,
            deleted,
        } => {
            if !media::valid_hash(key) || !(1..i64::MAX).contains(revision) {
                return Err("invalid audio deletion".into());
            }
            let changed = db.execute(
                "INSERT INTO library_audio_state VALUES(?,?,?)
                 ON CONFLICT(source_key) DO UPDATE SET revision=excluded.revision,deleted=excluded.deleted
                 WHERE (excluded.revision,excluded.deleted)>(revision,deleted)",
                params![key, revision, deleted],
            ).map_err(err)?;
            if changed > 0 && *deleted {
                if let Err(error) = cleanup_partial(dir, key) {
                    log::warn!("Could not clear a removed audio transfer: {error}");
                }
            }
            Ok(Need::Done)
        }
        Entry::Cover { key, bytes, hash } => {
            check_cover(key, *bytes, hash)?;
            let needs: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE
                   json_extract(media_source,'$.provider')='youtube'
                   AND json_extract(media_source,'$.video_id')=?1)
                 AND NOT EXISTS(SELECT 1 FROM library_youtube_artwork WHERE video_id=?1 AND sha256<=?2)",
                params![key, hash], |r| r.get(0),
            ).map_err(err)?;
            Ok(if needs { Need::Offset(0) } else { Need::Done })
        }
        Entry::Audio { key, manifest } => audio_offer(db, dir, key, manifest),
        Entry::Original { hash, bytes } => original_offer(db, dir, hash, *bytes),
    }
}

fn audio_offer(db: &Connection, dir: &Path, key: &str, manifest: &Manifest) -> Result<Need> {
    let Some((source, path)) = target(db, dir, key, manifest)? else {
        return Ok(Need::Done);
    };
    let current: Option<String> = db
        .query_row(
            "SELECT asset_id FROM source_media WHERE source_key=? AND status='ready'",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten();
    if current.as_deref().is_some_and(|hash| {
        hash <= manifest.sha256.as_str() && media::asset_path(dir, hash).is_ok_and(|p| p.is_file())
    }) {
        return Ok(Need::Done);
    }
    if path.metadata().is_ok_and(|m| m.len() == manifest.bytes)
        && media::file_digest(&path).as_deref() == Ok(&manifest.sha256)
    {
        bind_audio(db, key, &source, manifest)?;
        return Ok(Need::Done);
    }
    partial_offset(dir, key, &manifest.sha256, manifest.bytes, || {
        finish_audio(db, dir, key, manifest)
    })
}

pub(super) fn original_target(
    db: &Connection,
    dir: &Path,
    hash: &str,
    bytes: usize,
) -> Result<Option<PathBuf>> {
    if !media::valid_hash(hash) || !(1..=MAX_DOCUMENT_BYTES as usize).contains(&bytes) {
        return Err("invalid original document attachment".into());
    }
    let known: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM files WHERE json_extract(document_source,'$.source_sha256')=?1
          AND json_extract(document_source,'$.origin') IS NULL)",
        [hash], |row| row.get(0),
    ).map_err(err)?;
    let path = original_path(dir, hash);
    if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
        return Err("invalid original document path".into());
    }
    Ok(known.then_some(path))
}

fn original_offer(db: &Connection, dir: &Path, hash: &str, bytes: usize) -> Result<Need> {
    let Some(path) = original_target(db, dir, hash, bytes)? else {
        return Ok(Need::Done);
    };
    if path.metadata().is_ok_and(|m| m.len() == bytes as u64) {
        let bound: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_document_originals WHERE sha256=? AND bytes=?)",
            params![hash, bytes], |r| r.get(0),
        ).map_err(err)?;
        if bound {
            return Ok(Need::Done);
        }
        if media::file_digest(&path).as_deref() == Ok(hash) {
            put_original(db, hash, bytes as u64)?;
            return Ok(Need::Done);
        }
    }
    partial_offset(dir, hash, hash, bytes as u64, || {
        finish_original(db, dir, hash, bytes)
    })
}

fn partial_offset(
    dir: &Path,
    key: &str,
    hash: &str,
    bytes: u64,
    finish: impl FnOnce() -> Result<()>,
) -> Result<Need> {
    let temp = partial(dir, key, hash);
    let length = match fs::symlink_metadata(&temp) {
        Ok(m) if m.is_file() && m.len() <= bytes => m.len(),
        Ok(_) => return Err("invalid partial attachment".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
        Err(e) => return Err(err(e)),
    };
    if length == bytes {
        finish()?;
        return Ok(Need::Done);
    }
    let remaining = bytes - length;
    if fs2::available_space(dir).map_err(err)? < remaining.saturating_add(1024 * 1024) {
        return Ok(Need::Space);
    }
    Ok(Need::Offset(length as usize))
}

pub(super) fn bind_audio(
    db: &Connection,
    key: &str,
    source: &str,
    manifest: &Manifest,
) -> Result<()> {
    db.execute(
        "INSERT INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at)
         VALUES(?,?,?,'ready',?,?)
         ON CONFLICT(source_key) DO UPDATE SET asset_id=excluded.asset_id,status='ready',error=NULL,
            manifest_json=excluded.manifest_json,updated_at=excluded.updated_at",
        params![
            key,
            source,
            manifest.sha256,
            serde_json::to_string(manifest).map_err(err)?,
            super::super::saved::now_ms()
        ],
    )
    .map_err(err)?;
    Ok(())
}

fn finish_audio(db: &Connection, dir: &Path, key: &str, manifest: &Manifest) -> Result<()> {
    let temp = partial(dir, key, &manifest.sha256);
    if media::file_digest(&temp)? != manifest.sha256 {
        fs::remove_file(&temp).map_err(err)?;
        return Err("audio attachment checksum mismatch".into());
    }
    let tx =
        rusqlite::Transaction::new_unchecked(db, TransactionBehavior::Immediate).map_err(err)?;
    if let Some((source, path)) = target(&tx, dir, key, manifest)? {
        fs::rename(&temp, path).map_err(err)?;
        File::open(dir)
            .and_then(|dir| dir.sync_all())
            .map_err(err)?;
        bind_audio(&tx, key, &source, manifest)?;
    } else {
        fs::remove_file(temp).map_err(err)?;
    }
    tx.commit().map_err(err)
}

fn finish_original(db: &Connection, dir: &Path, hash: &str, bytes: usize) -> Result<()> {
    let temp = partial(dir, hash, hash);
    if media::file_digest(&temp)? != hash {
        fs::remove_file(&temp).map_err(err)?;
        return Err("original document checksum mismatch".into());
    }
    let tx =
        rusqlite::Transaction::new_unchecked(db, TransactionBehavior::Immediate).map_err(err)?;
    if let Some(path) = original_target(&tx, dir, hash, bytes)? {
        fs::rename(&temp, &path).map_err(err)?;
        sync_parent(&path)?;
        put_original(&tx, hash, bytes as u64)?;
    } else {
        fs::remove_file(temp).map_err(err)?;
    }
    tx.commit().map_err(err)
}

fn read_chunk(path: &Path, offset: usize, size: usize) -> Result<Vec<u8>> {
    if offset >= size {
        return Err("invalid attachment offset".into());
    }
    let mut bytes = vec![0; CHUNK.min(size - offset)];
    let mut file = File::open(path).map_err(err)?;
    file.seek(SeekFrom::Start(offset as u64)).map_err(err)?;
    file.read_exact(&mut bytes).map_err(err)?;
    Ok(bytes)
}

pub(super) fn read(
    db: &Connection,
    dir: &Path,
    entry: &Entry,
    offset: usize,
) -> Result<Option<String>> {
    let bytes = match entry {
        Entry::Cover { key, hash, bytes } => {
            check_cover(key, *bytes, hash)?;
            if offset != 0 {
                return Err("invalid cover offset".into());
            }
            let data: Option<Vec<u8>> = db.query_row(
                "SELECT data FROM library_youtube_artwork WHERE video_id=? AND sha256=?
                 AND EXISTS(SELECT 1 FROM files WHERE json_extract(media_source,'$.video_id')=? AND json_extract(media_source,'$.provider')='youtube')",
                params![key, hash, key], |r| r.get(0),
            ).optional().map_err(err)?;
            let Some(data) = data else {
                return Ok(None);
            };
            data
        }
        Entry::Audio { key, manifest } => {
            let Some((_, path)) = target(db, dir, key, manifest)? else {
                return Ok(None);
            };
            let available: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM source_media WHERE source_key=? AND asset_id=? AND status='ready'
                 AND manifest_json=?)",
                params![key, manifest.sha256, serde_json::to_string(manifest).map_err(err)?],
                |r| r.get(0),
            ).map_err(err)?;
            if !available || !path.metadata().is_ok_and(|m| m.len() == manifest.bytes) {
                return Ok(None);
            }
            read_chunk(&path, offset, entry.bytes())?
        }
        Entry::Original { hash, bytes } => {
            let Some(path) = original_target(db, dir, hash, *bytes)? else {
                return Ok(None);
            };
            let present: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM library_document_originals WHERE sha256=? AND bytes=?)",
                params![hash, bytes], |r| r.get(0),
            ).map_err(err)?;
            if !present || !path.metadata().is_ok_and(|m| m.len() == *bytes as u64) {
                return Ok(None);
            }
            read_chunk(&path, offset, *bytes)?
        }
        Entry::AudioState { .. } => return Err("deletion does not carry bytes".into()),
    };
    Ok(Some(STANDARD.encode(bytes)))
}

fn write(db: &Connection, dir: &Path, entry: &Entry, offset: usize, data: &str) -> Result<Need> {
    let max = match entry {
        Entry::Cover { .. } => COVER_BYTES,
        Entry::Audio { .. } | Entry::Original { .. } => CHUNK,
        _ => return Err("deletion does not carry bytes".into()),
    };
    if data.len() > max.div_ceil(3) * 4 {
        return Err("oversized attachment chunk".into());
    }
    let data = STANDARD.decode(data).map_err(err)?;
    if offset >= entry.bytes() || data.len() != max.min(entry.bytes() - offset) {
        return Err("invalid attachment interval".into());
    }
    match entry {
        Entry::Cover { key, hash, .. } => {
            if offer(db, dir, entry)? == Need::Offset(0) {
                if media::digest(&data) != *hash {
                    return Err("cover attachment checksum mismatch".into());
                }
                store_cover(db, key, &data)?;
            }
            Ok(Need::Done)
        }
        Entry::Audio { key, manifest } => {
            let need = audio_offer(db, dir, key, manifest)?;
            append_chunk(
                need,
                &partial(dir, key, &manifest.sha256),
                offset,
                &data,
                entry.bytes(),
                || finish_audio(db, dir, key, manifest),
            )
        }
        Entry::Original { hash, bytes } => {
            let need = original_offer(db, dir, hash, *bytes)?;
            append_chunk(
                need,
                &partial(dir, hash, hash),
                offset,
                &data,
                *bytes,
                || finish_original(db, dir, hash, *bytes),
            )
        }
        _ => unreachable!(),
    }
}

fn append_chunk(
    need: Need,
    temp: &Path,
    offset: usize,
    data: &[u8],
    total: usize,
    finish: impl FnOnce() -> Result<()>,
) -> Result<Need> {
    match need {
        Need::Offset(expected) if expected == offset => {}
        Need::Offset(_) => return Err("invalid partial attachment offset".into()),
        result => return Ok(result),
    }
    if fs::symlink_metadata(temp).is_ok_and(|m| !m.is_file()) {
        return Err("invalid partial attachment".into());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(temp)
        .map_err(err)?;
    if file.metadata().map_err(err)?.len() != offset as u64 {
        return Err("invalid partial attachment offset".into());
    }
    if let Err(e) = file.write_all(data).and_then(|_| file.sync_data()) {
        file.set_len(offset as u64).map_err(err)?;
        return if e.raw_os_error() == Some(libc::ENOSPC) {
            Ok(Need::Space)
        } else {
            Err(err(e))
        };
    }
    let next = offset + data.len();
    if next == total {
        finish()?;
        Ok(Need::Done)
    } else {
        Ok(Need::Offset(next))
    }
}

pub fn respond(db: &Connection, dir: &Path, request: Request) -> Result<Reply> {
    match request {
        Request::List { after } if after.len() <= 65 => Ok(Reply::List(list(db, &after)?)),
        Request::List { .. } => Err("invalid attachment page".into()),
        Request::Offer(entry) => Ok(Reply::Need(offer(db, dir, &entry)?)),
        Request::Read { entry, offset } => Ok(Reply::Data(read(db, dir, &entry, offset)?)),
        Request::Write {
            entry,
            offset,
            data,
        } => Ok(Reply::Need(write(db, dir, &entry, offset, &data)?)),
    }
}

pub fn sync_round<F>(db: &Connection, dir: &Path, mut remote: F) -> Result<Round>
where
    F: FnMut(Request) -> Result<Reply>,
{
    if let Err(error) = reclaim_expired_audio(db, dir) {
        log::warn!("Could not reclaim expired original audio: {error}");
    }
    let mut round = Round::default();
    // Pull and push each get a budget, so large incoming audio cannot
    // prevent the other side's attachments from making progress.
    for pull in [true, false] {
        let mut budget = ROUND_BYTES;
        let mut after = String::new();
        loop {
            let entries = if pull {
                let Reply::List(entries) = remote(Request::List {
                    after: after.clone(),
                })?
                else {
                    return Err("expected attachment page".into());
                };
                entries
            } else {
                list(db, &after)?
            };
            if entries.is_empty() {
                break;
            }
            if entries.len() > PAGE {
                return Err("oversized attachment page".into());
            }
            for entry in entries {
                let next_key = entry.order();
                if next_key <= after {
                    return Err("out-of-order attachment page".into());
                }
                after = next_key;
                let target = |request, remote: &mut F| {
                    if pull {
                        respond(db, dir, request)
                    } else {
                        remote(request)
                    }
                };
                let Reply::Need(mut need) = target(Request::Offer(entry.clone()), &mut remote)?
                else {
                    return Err("expected attachment offset".into());
                };
                while let Need::Offset(offset) = need {
                    if budget == 0 {
                        round.pending = true;
                        break;
                    }
                    let request = Request::Read {
                        entry: entry.clone(),
                        offset,
                    };
                    let reply = if pull {
                        remote(request)?
                    } else {
                        respond(db, dir, request)?
                    };
                    let Reply::Data(data) = reply else {
                        return Err("expected attachment bytes".into());
                    };
                    let Some(data) = data else { break };
                    budget = budget.saturating_sub(data.len());
                    let Reply::Need(result) = target(
                        Request::Write {
                            entry: entry.clone(),
                            offset,
                            data,
                        },
                        &mut remote,
                    )?
                    else {
                        return Err("expected attachment receipt".into());
                    };
                    if matches!(result, Need::Offset(next) if next <= offset || next >= entry.bytes())
                    {
                        return Err("invalid attachment receipt".into());
                    }
                    need = result;
                }
                round.storage |= need == Need::Space;
            }
            if budget == 0 {
                round.pending = true;
                break;
            }
        }
    }
    Ok(round)
}
