use super::{exchange as wire, *};
use crate::commands::export::{self, BackupPayload, RestoreResult};
use std::collections::{HashMap, HashSet};
use tauri_plugin_fs::FsExt;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    version: u8,
    entries: Vec<wire::Entry>,
}

fn name(entry: &wire::Entry) -> Result<Option<String>> {
    let path = match entry {
        wire::Entry::AudioState { key, revision, .. }
            if media::valid_hash(key) && *revision > 0 =>
        {
            return Ok(None);
        }
        wire::Entry::Cover { key, bytes, hash }
            if super::super::youtube::is_valid_video_id(key)
                && media::valid_hash(hash)
                && (1..=COVER_BYTES).contains(bytes) =>
        {
            format!("cover/{hash}")
        }
        wire::Entry::Audio { key, manifest }
            if media::valid_hash(key)
                && media::valid_hash(&manifest.sha256)
                && (1..=media::MAX_BYTES).contains(&manifest.bytes) =>
        {
            format!("audio/{}", manifest.sha256)
        }
        wire::Entry::Original { hash, bytes }
            if media::valid_hash(hash) && (1..=MAX_DOCUMENT_BYTES as usize).contains(bytes) =>
        {
            format!("document/{hash}")
        }
        _ => return Err("invalid backup attachment".into()),
    };
    Ok(Some(path))
}

fn user_path(app: &AppHandle, path: &str) -> Result<PathBuf> {
    let path = if path.starts_with("file:") {
        tauri::Url::parse(path)
            .map_err(err)?
            .to_file_path()
            .map_err(|_| "invalid library backup path")?
    } else {
        PathBuf::from(path)
    };
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("lexicuebackup"))
        || !app.fs_scope().is_allowed(&path)
    {
        return Err("invalid library backup path".into());
    }
    Ok(path)
}

pub(super) fn export_archive(db: &Connection, media_dir: &Path, destination: &Path) -> Result<()> {
    let parent = destination.parent().ok_or("invalid backup destination")?;
    let scratch = media::Temp(parent.join(format!(".lexicue-export-{}", uuid::Uuid::new_v4())));
    fs::create_dir(&scratch.0).map_err(err)?;
    let temporary = scratch.0.join("archive");
    let file = File::create(&temporary).map_err(err)?;
    let snapshot =
        rusqlite::Transaction::new_unchecked(db, TransactionBehavior::Deferred).map_err(err)?;
    let payload = export::backup_payload(&snapshot)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("library.json", options).map_err(err)?;
    serde_json::to_writer(&mut zip, &payload).map_err(err)?;
    let mut index = Index {
        version: 1,
        entries: Vec::new(),
    };
    let mut after = String::new();
    let mut written = HashSet::new();
    loop {
        let page = wire::list(&snapshot, &after)?;
        if page.is_empty() {
            break;
        }
        for entry in page {
            after = entry.order();
            if let Some(member) = name(&entry)? {
                if written.insert(member.clone()) {
                    zip.start_file(&member, SimpleFileOptions::default())
                        .map_err(err)?;
                    match &entry {
                        wire::Entry::Cover { .. } => {
                            let data = wire::read(&snapshot, media_dir, &entry, 0)?
                                .ok_or("backup is missing artwork")?;
                            zip.write_all(&STANDARD.decode(data).map_err(err)?)
                                .map_err(err)?;
                        }
                        wire::Entry::Audio { key, manifest } => {
                            let (_, path) = wire::target(&snapshot, media_dir, key, manifest)?
                                .ok_or("backup is missing audio")?;
                            stream_file(&mut zip, &path, &manifest.sha256, entry.bytes())?;
                        }
                        wire::Entry::Original { hash, bytes } => {
                            let path = wire::original_target(&snapshot, media_dir, hash, *bytes)?
                                .ok_or("backup is missing an original document")?;
                            stream_file(&mut zip, &path, hash, *bytes)?;
                        }
                        wire::Entry::AudioState { .. } => unreachable!(),
                    }
                }
            }
            index.entries.push(entry);
        }
    }
    zip.start_file("attachments.json", options).map_err(err)?;
    serde_json::to_writer(&mut zip, &index).map_err(err)?;
    zip.finish()
        .and_then(|file| {
            file.sync_all()
                .map(|_| file)
                .map_err(zip::result::ZipError::Io)
        })
        .map_err(err)?;
    snapshot.commit().map_err(err)?;
    fs::rename(&temporary, destination).map_err(err)?;
    sync_parent(destination)
}

fn stream_file(writer: &mut impl Write, path: &Path, hash: &str, size: usize) -> Result<()> {
    let file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() != size as u64 || media::file_digest(path)? != hash {
        return Err("backup attachment failed verification".into());
    }
    let read = std::io::copy(&mut file.take(size as u64 + 1), writer).map_err(err)?;
    if read != size as u64 {
        return Err("backup attachment changed".into());
    }
    Ok(())
}

pub(super) struct Prepared {
    pub payload: BackupPayload,
    index: Index,
    _scratch: media::Temp,
    staged: HashMap<String, PathBuf>,
}

pub(super) fn prepare_archive(path: &Path, media_dir: &Path) -> Result<Prepared> {
    let mut zip = ZipArchive::new(File::open(path).map_err(err)?).map_err(err)?;
    let payload = read_json(&mut zip, "library.json", 512 * 1024 * 1024)?;
    let index: Index = read_json(&mut zip, "attachments.json", 32 * 1024 * 1024)?;
    if index.version != 1 {
        return Err("unsupported library archive version".into());
    }
    let scratch = media::Temp(media_dir.join(format!(".part-restore-{}", uuid::Uuid::new_v4())));
    fs::create_dir(&scratch.0).map_err(err)?;
    let mut staged = HashMap::new();
    let mut seen = HashSet::new();
    for entry in &index.entries {
        if !seen.insert(entry.order()) {
            return Err("duplicate backup attachment".into());
        }
        let Some(member) = name(entry)? else {
            continue;
        };
        if staged.contains_key(&member) {
            continue;
        }
        let mut file = zip.by_name(&member).map_err(err)?;
        if file.size() != entry.bytes() as u64 || !file.is_file() {
            return Err("invalid backup attachment length".into());
        }
        let output = scratch.0.join(staged.len().to_string());
        let mut out = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&output)
            .map_err(err)?;
        let written = std::io::copy(&mut file.by_ref().take(entry.bytes() as u64 + 1), &mut out)
            .map_err(err)?;
        let (_, hash) = member.split_once('/').ok_or("invalid backup member")?;
        if written != entry.bytes() as u64 || media::file_digest(&output)? != hash {
            return Err("backup attachment checksum mismatch".into());
        }
        out.sync_all().map_err(err)?;
        staged.insert(member, output);
    }
    Ok(Prepared {
        payload,
        index,
        _scratch: scratch,
        staged,
    })
}

fn read_json<T: serde::de::DeserializeOwned>(
    zip: &mut ZipArchive<File>,
    name: &str,
    limit: u64,
) -> Result<T> {
    let file = zip.by_name(name).map_err(err)?;
    if file.size() > limit || !file.is_file() {
        return Err("oversized library manifest".into());
    }
    serde_json::from_reader(std::io::BufReader::new(file.take(limit + 1))).map_err(err)
}

impl Prepared {
    pub(super) fn install(&self, db: &Connection, dir: &Path) -> Result<()> {
        db.execute("DELETE FROM library_audio_state", [])
            .map_err(err)?;
        for entry in &self.index.entries {
            let path = name(entry)?.and_then(|name| self.staged.get(&name));
            match entry {
                wire::Entry::AudioState {
                    key,
                    revision,
                    deleted,
                } => {
                    db.execute(
                        "INSERT INTO library_audio_state VALUES(?,?,?)",
                        params![key, revision, deleted],
                    )
                    .map_err(err)?;
                }
                wire::Entry::Cover { key, .. } => {
                    let bytes = fs::read(path.ok_or("missing backup cover")?).map_err(err)?;
                    store_cover(db, key, &bytes)?;
                }
                wire::Entry::Audio { key, manifest } => {
                    let (source, dest) = wire::target(db, dir, key, manifest)?
                        .ok_or("backup audio has no matching material")?;
                    install_verified_file(
                        path.ok_or("missing backup audio")?,
                        &dest,
                        &manifest.sha256,
                    )?;
                    wire::bind_audio(db, key, &source, manifest)?;
                }
                wire::Entry::Original { hash, bytes } => {
                    let dest = wire::original_target(db, dir, hash, *bytes)?
                        .ok_or("backup original has no matching material")?;
                    install_verified_file(path.ok_or("missing backup original")?, &dest, hash)?;
                    put_original(db, hash, *bytes as u64)?;
                }
            }
        }
        Ok(())
    }
}

fn install_verified_file(source: &Path, destination: &Path, hash: &str) -> Result<()> {
    if fs::symlink_metadata(destination).is_ok_and(|metadata| !metadata.is_file()) {
        return Err("invalid backup restore destination".into());
    }
    if !destination.exists() {
        fs::hard_link(source, destination).map_err(err)?;
    } else if media::file_digest(destination)? != hash {
        let replacement = source.with_extension("replacement");
        fs::hard_link(source, &replacement).map_err(err)?;
        fs::rename(replacement, destination).map_err(err)?;
    }
    sync_parent(destination)
}

#[tauri::command]
pub async fn export_library_archive(
    app: AppHandle,
    state: State<'_, DbState>,
    path: String,
) -> Result<()> {
    let destination = user_path(&app, &path)?;
    let dir = media::root(&app)?;
    let database = state
        .conn
        .lock()
        .map_err(err)?
        .path()
        .ok_or("library has no database path")?
        .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let connection =
            Connection::open_with_flags(database, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(err)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(err)?;
        export_archive(&connection, &dir, &destination)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn restore_library_archive(
    app: AppHandle,
    state: State<'_, DbState>,
    path: String,
) -> Result<RestoreResult> {
    let path = user_path(&app, &path)?;
    let dir = media::root(&app)?;
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_archive(&path, &dir)?;
        let db = shared.lock().map_err(err)?;
        export::restore_with_attachments(&db, &prepared.payload, |transaction| {
            prepared.install(transaction, &dir)
        })
    })
    .await
    .map_err(err)?
}
