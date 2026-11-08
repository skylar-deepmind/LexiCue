//! Readable material revisions use the same ordered outbox as reader saves.
//! A manifest occupies one sequence number regardless of the number of chunks.
use super::*;
use rusqlite::types::Value;
use std::collections::HashSet;

pub(crate) mod transfer;
pub const SENTENCE_SCHEMA: &str = include_str!("sentences.sql");
pub(crate) const MAX_BLOB: usize = 256 * 1024 * 1024;

pub(crate) fn schema(tx: &Connection) -> Result<()> {
    tx.execute_batch(SENTENCE_SCHEMA).map_err(err)?;
    tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
    Ok(())
}
pub(crate) fn install(tx: &Connection) -> Result<()> {
    schema(tx)?;
    tx.execute("INSERT INTO lan_material_capture(local_id) SELECT f.id FROM files f WHERE f.language='en' AND f.type IN ('txt','srt') AND NOT EXISTS(SELECT 1 FROM lan_material_files m WHERE m.local_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM lan_quarantine q WHERE q.kind IN('files','files-local') AND q.local_id=f.id) AND NOT EXISTS(SELECT 1 FROM sync_delete_jobs j WHERE j.file_id=f.id AND j.phase NOT IN ('done','failed')) ORDER BY f.id",[]).map_err(err)?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "material_op", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Change {
    Saved {
        entity: String,
        bytes: usize,
        sha256: String,
    },
    Create {
        file: String,
        bytes: usize,
        sha256: String,
    },
    Attach {
        file: String,
        source: Source,
    },
    Large {
        file: String,
        bytes: usize,
        sha256: String,
    },
    Field {
        file: String,
        field: String,
        revision: String,
        generation: i64,
        value: Option<String>,
        basis: String,
        automatic: i64,
        #[serde(default)]
        parents: Vec<String>,
    },
    Metadata {
        file: String,
        field: String,
        value: Option<String>,
        parents: Vec<String>,
        generation: i64,
    },
    Resolution {
        file: String,
        field: String,
        parents: Vec<String>,
        picked: String,
    },
    Recovery {
        file: String,
        revision: String,
        done: bool,
    },
    Delete {
        file: String,
        #[serde(default)]
        seen: i64,
        #[serde(default)]
        epoch: Option<String>,
    },
}
pub(crate) fn parse(text: &str) -> Result<Option<Change>> {
    if text.starts_with("{\"material_op\":") {
        serde_json::from_str(text).map(Some).map_err(err)
    } else {
        Ok(None)
    }
}
pub(crate) fn id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn title_ok(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty()
        && !s.starts_with(['/', '\\'])
        && !s.starts_with("~/")
        && !s.to_ascii_lowercase().starts_with("file:")
        && !s.to_ascii_lowercase().starts_with("content:")
        && !s
            .as_bytes()
            .get(1..3)
            .is_some_and(|v| v == b":/" || v == b":\\")
}
impl Change {
    pub(crate) fn blob_limit(&self) -> usize {
        // Existing SQLite TEXT values may exceed the material import limit.
        // SQLite's default maximum row length bounds valid historical saves.
        if matches!(self, Self::Saved { .. }) {
            1_000_000_000
        } else {
            MAX_BLOB
        }
    }
    pub(crate) fn blob(&self) -> Option<(usize, &str)> {
        match self {
            Self::Saved { bytes, sha256, .. }
            | Self::Create { bytes, sha256, .. }
            | Self::Large { bytes, sha256, .. } => Some((*bytes, sha256)),
            _ => None,
        }
    }
    fn file(&self) -> &str {
        match self {
            Self::Saved { entity, .. } => entity,
            Self::Create { file, .. }
            | Self::Attach { file, .. }
            | Self::Large { file, .. }
            | Self::Field { file, .. }
            | Self::Resolution { file, .. }
            | Self::Metadata { file, .. }
            | Self::Recovery { file, .. }
            | Self::Delete { file, .. } => file,
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        if self.file().is_empty()
            || self.file().len() > 160
            || !self
                .file()
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        {
            return Err("invalid material identity".into());
        }
        if let Some((bytes, hash)) = self.blob() {
            if !(1..=self.blob_limit()).contains(&bytes)
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("invalid material manifest".into());
            }
        }
        if let Self::Recovery { revision, .. } = self {
            if !id(revision) {
                return Err("invalid recoverable revision".into());
            }
        }
        if let Self::Resolution {
            parents,
            picked,
            field,
            ..
        } = self
        {
            if parents.len() < 2
                || parents.len() > 128
                || !parents.contains(picked)
                || field.len() > 160
                || parents.iter().any(|s| s.is_empty() || s.len() > 128)
            {
                return Err("invalid conflict resolution".into());
            }
        }
        if let Self::Metadata {
            field,
            value,
            parents,
            generation,
            ..
        } = self
        {
            super::metadata::validate(field, value.as_deref(), *generation, parents)?;
        }
        if let Self::Field {
            field,
            revision,
            generation,
            value,
            automatic,
            basis,
            ..
        } = self
        {
            if (!basis.is_empty() && !id(basis))
                || !id(revision)
                || *generation < 1
                || !matches!(automatic, 0 | 1)
            {
                return Err("invalid material field version".into());
            }
            let valid = match field.as_str() {
                "title" => value.as_deref().is_some_and(title_ok),
                "body" => value.as_ref().is_some_and(|s| s.len() <= 32 * 1024 * 1024),
                s if s.starts_with("cue:") => {
                    id(&s[4..])
                        && value
                            .as_ref()
                            .is_some_and(|s| serde_json::from_str::<Cue>(s).is_ok())
                }
                s => id(s),
            };
            if !valid {
                return Err("invalid material field".into());
            }
        }
        Ok(())
    }
}

type Cue = (i64, String, Option<String>, Option<String>);
// Snapshot arrays follow this field order to avoid repeating keys for every cue.
#[derive(Serialize, Deserialize)]
struct Sentence {
    id: String,
    index: i64,
    english: String,
    chinese: Option<String>,
    start: Option<String>,
    end: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    #[serde(default)]
    source: Option<Source>,
    title: String,
    kind: String,
    body: String,
    imported_at: i64,
    sentences: Vec<Sentence>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub media_source: Option<String>,
    pub media_identity: Option<String>,
    pub document_source: Option<String>,
    pub document_identity: Option<String>,
}

pub(crate) fn check_outgoing_source(
    db: &Connection,
    eid: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    type Origin = (String, String, usize, String);
    let origin: Option<Origin> = db
        .query_row(
            "SELECT json_extract(CAST(data AS TEXT),'$.body'),json_extract(CAST(data AS TEXT),'$.kind'),
       json_array_length(CAST(data AS TEXT),'$.sentences'),json_extract(CAST(data AS TEXT),'$.source') FROM lan_material_blobs
       WHERE event=? AND json_type(CAST(data AS TEXT),'$.source')='object'",
            [eid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((body, kind, n, source)) = origin {
        store.validate_source(
            &serde_json::from_str(&source).map_err(err)?,
            &body,
            &kind,
            n,
        )?;
    }
    Ok(())
}

// Delayed attachments carry no readable body. Their exact original subtitle
// hash and portable source DTO must still validate before bytes leave this host.
fn validate_attachment(source: &Source, store: &impl session::SavedStore) -> Result<String> {
    if source.document_source.is_some()
        || source.document_identity.is_some()
        || source.media_identity.is_none()
    {
        return Err("invalid attached media source".into());
    }
    store.validate_source(source, "", "srt", 0)?;
    let raw: serde_json::Value = serde_json::from_str(
        source
            .media_source
            .as_deref()
            .ok_or("missing attached media source")?,
    )
    .map_err(err)?;
    let hash = raw["subtitle_sha256"]
        .as_str()
        .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("invalid attached subtitle hash")?;
    Ok(hash.into())
}
pub(crate) fn check_outgoing_attachment(
    db: &Connection,
    eid: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    let raw:Option<Vec<u8>>=db.query_row("SELECT data FROM lan_material_blobs WHERE event=? AND json_extract(CAST(data AS TEXT),'$.material_op')='attach'",[eid],|r|r.get(0)).optional().map_err(err)?;
    if let Some(raw) = raw {
        let Change::Attach { source, .. } = serde_json::from_slice(&raw).map_err(err)? else {
            return Err("invalid attachment".into());
        };
        validate_attachment(&source, store)?;
    }
    Ok(())
}
fn apply_attachment(
    db: &Connection,
    file: &str,
    source: &Source,
    store: &impl session::SavedStore,
) -> Result<()> {
    let subtitle_hash = validate_attachment(source, store)?;
    if let Some(local) = local_file(db, file)? {
        let body: String = db
            .query_row("SELECT content FROM files WHERE id=?", [local], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if format!("{:x}", Sha256::digest(body.as_bytes())) == subtitle_hash {
            // Competing verified sources remain in history. Pick the same
            // descriptor on both replicas without replacing document identity.
            db.execute("UPDATE files SET media_source=?,media_identity=? WHERE id=? AND type='srt' AND document_identity IS NULL AND (media_identity IS NULL OR media_identity>?)",
                params![source.media_source,source.media_identity,local,source.media_identity]).map_err(err)?;
        }
    }
    Ok(())
}
fn local_file(db: &Connection, file: &str) -> Result<Option<i64>> {
    db.query_row(
        "SELECT local_id FROM lan_material_files WHERE file=?",
        [file],
        |r| r.get(0),
    )
    .map_err(err)
}
fn hash_body(body: &str) -> String {
    format!("{:x}", Sha256::digest(body.as_bytes()))[..16].to_string()
}

fn publish(
    db: &Connection,
    file: &str,
    s: Snapshot,
    store: &impl session::SavedStore,
) -> Result<()> {
    if let Some(source) = &s.source {
        store.validate_source(source, &s.body, &s.kind, s.sentences.len())?;
    }
    if !title_ok(&s.title)
        || !matches!(s.kind.as_str(), "srt" | "txt")
        || s.body.len() > 32 * 1024 * 1024
    {
        return Err("invalid material snapshot".into());
    }
    let mut ids = HashSet::new();
    let mut indices = HashSet::new();
    for cue in &s.sentences {
        if !id(&cue.id) || !ids.insert(&cue.id) || !indices.insert(cue.index) {
            return Err("ambiguous material sentence".into());
        }
    }
    let existing: Option<Option<i64>> = db
        .query_row(
            "SELECT local_id FROM lan_material_files WHERE file=?",
            [file],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(existing) = existing {
        if let Some(local) = existing {
            join_existing(db, file, local, &s)?;
        }
        return Ok(());
    }
    db.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES(?,?,?,?,?,'en')",params![s.title,s.kind,s.body,hash_body(&s.body),s.imported_at]).map_err(err)?;
    let local = db.last_insert_rowid();
    if let Some(origin) = &s.source {
        db.execute("UPDATE files SET media_source=?,media_identity=?,document_source=?,document_identity=? WHERE id=?",params![origin.media_source,origin.media_identity,origin.document_source,origin.document_identity,local]).map_err(err)?;
    }
    db.execute("INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at) VALUES('files',?,?,?)",params![local,file,s.imported_at]).map_err(err)?;
    db.execute(
        "INSERT INTO lan_material_files(file,local_id) VALUES(?,?)",
        params![file, local],
    )
    .map_err(err)?;
    let mut insert=db.prepare("INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?,?,?,?,?,?)").map_err(err)?;
    let mut bind = db
        .prepare("UPDATE lan_sentence_ids SET stable_id=? WHERE local_id=?")
        .map_err(err)?;
    for cue in s.sentences {
        insert
            .execute(params![
                local,
                cue.index,
                cue.english,
                cue.chinese,
                cue.start,
                cue.end
            ])
            .map_err(err)?;
        if bind
            .execute(params![cue.id, db.last_insert_rowid()])
            .map_err(err)?
            != 1
        {
            return Err("missing sentence binding".into());
        }
    }
    Ok(())
}
// Both copies may predate sentence-ID assignment. Alias only if the stable
// file ID, original body and every source position/text/time prove the match.
fn join_existing(db: &Connection, file: &str, local: i64, incoming: &Snapshot) -> Result<()> {
    let original:Vec<u8>=db.query_row("SELECT b.data FROM lan_material_blobs b JOIN lan_history h ON b.event=h.eid WHERE json_extract(h.snapshot,'$.file')=?1 AND json_extract(h.snapshot,'$.material_op')='create' ORDER BY h.ordinal LIMIT 1",[file],|r|r.get(0)).map_err(err)?;
    let baseline: Snapshot = serde_json::from_slice(&original).map_err(err)?;
    if baseline.body != incoming.body
        || baseline.kind != incoming.kind
        || baseline.sentences.len() != incoming.sentences.len()
    {
        return Err("material baseline diverged; reconciliation required".into());
    }
    if let Some(source) = &incoming.source {
        let same: bool = db
            .query_row(
                "SELECT (media_identity IS NULL OR media_identity IS ?2)
             AND (document_identity IS NULL OR document_identity IS ?3) FROM files WHERE id=?1",
                params![local, source.media_identity, source.document_identity],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !same {
            return Err("material source identity diverged; reconciliation required".into());
        }
        db.execute(
            "UPDATE files SET media_source=?,media_identity=?,document_source=?,document_identity=?
           WHERE id=? AND media_identity IS NULL AND document_identity IS NULL",
            params![
                source.media_source,
                source.media_identity,
                source.document_source,
                source.document_identity,
                local
            ],
        )
        .map_err(err)?;
    }
    for (ours, theirs) in baseline.sentences.iter().zip(&incoming.sentences) {
        if ours.index != theirs.index
            || ours.english != theirs.english
            || ours.start != theirs.start
            || ours.end != theirs.end
        {
            return Err("material sentence baseline diverged; reconciliation required".into());
        }
        if ours.id != theirs.id {
            db.execute(
                "INSERT INTO lan_material_aliases(file,alias,sentence) VALUES(?,?,?)",
                params![file, theirs.id, ours.id],
            )
            .map_err(err)?;
        }
        if ours.chinese != theirs.chinese {
            merge_baseline(
                db,
                file,
                local,
                &ours.id,
                ours.index,
                ours.chinese.as_deref(),
                theirs.chinese.as_deref(),
            )?;
        }
    }
    if baseline.title != incoming.title {
        merge_baseline(
            db,
            file,
            local,
            "title",
            -1,
            Some(&baseline.title),
            Some(&incoming.title),
        )?;
    }
    Ok(())
}

fn merge_baseline(
    db: &Connection,
    file: &str,
    local: i64,
    field: &str,
    index: i64,
    a: Option<&str>,
    b: Option<&str>,
) -> Result<()> {
    for value in [a, b]
        .into_iter()
        .flatten()
        .filter(|s| !s.trim().is_empty())
    {
        let bytes = serde_json::to_vec(&(file, index, value)).map_err(err)?;
        let revision = format!("{:x}", Sha256::digest(bytes))[..32].to_string();
        db.execute("INSERT OR IGNORE INTO lan_material_values(file,field,revision,generation,value) VALUES(?,?,?,0,?)",params![file,field,revision,value]).map_err(err)?;
    }
    let best:Option<Option<String>>=db.query_row("SELECT value FROM lan_material_values WHERE file=? AND field=? AND basis='' ORDER BY automatic,generation DESC,revision DESC LIMIT 1",params![file,field],|r|r.get(0)).optional().map_err(err)?;
    if let Some(value) = best {
        if field == "title" {
            db.execute("UPDATE files SET name=? WHERE id=?", params![value, local])
                .map_err(err)?;
        } else {
            db.execute("UPDATE segments SET zh_text=? WHERE file_id=? AND id=(SELECT local_id FROM lan_sentence_ids WHERE stable_id=?) AND NOT EXISTS(SELECT 1 FROM lan_material_basis WHERE local_id=segments.id AND revision<>'')",params![value,local,field]).map_err(err)?;
        }
    }
    Ok(())
}

pub(crate) fn apply_field(db: &Connection, change: &Change, eid: &str) -> Result<()> {
    let Change::Field {
        file,
        field,
        revision,
        generation,
        value,
        automatic,
        basis,
        parents,
    } = change
    else {
        return Err("expected material field".into());
    };
    change.validate()?;
    if revision != eid {
        return Err("incorrect material field revision".into());
    }
    let canonical = db
        .query_row(
            "SELECT sentence FROM lan_material_aliases WHERE file=? AND alias=?",
            params![file, field.trim_start_matches("cue:")],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?;
    let field = match canonical {
        Some(s) if field.starts_with("cue:") => format!("cue:{s}"),
        Some(s) => s,
        None => field.clone(),
    };
    if parents.len() > 128 {
        return Err("too many material parent revisions".into());
    }
    for parent in parents {
        let known:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM lan_material_values WHERE file=? AND field=? AND basis=? AND revision=? AND generation<?)",params![file,field,basis,parent,generation],|r|r.get(0)).map_err(err)?;
        if !known {
            return Err("missing material parent".into());
        }
        db.execute(
            "INSERT OR IGNORE INTO lan_field_edges(parent,child) VALUES(?,?)",
            params![parent, revision],
        )
        .map_err(err)?;
    }
    db.execute("INSERT INTO lan_material_values(file,field,revision,generation,value,automatic,basis) VALUES(?,?,?,?,?,?,?)",params![file,field,revision,generation,value,automatic,basis]).map_err(err)?;
    let Some(local) = local_file(db, file)? else {
        if *automatic == 0 {
            record_recovery(db, file, revision, false)?;
        }
        return Ok(());
    };
    // Competing cue revisions can have different English bases; a translation
    // competes only within the exact English revision its author saw.
    let is_translation = id(&field);
    let winner:String=db.query_row("SELECT revision FROM lan_material_values WHERE file=? AND field=? AND (?=0 OR basis=?) ORDER BY automatic,generation DESC,revision DESC LIMIT 1",params![file,field,is_translation,basis],|r|r.get(0)).map_err(err)?;
    if winner != *revision {
        return Ok(());
    }
    let n = match field.as_str() {
        "title" => db.execute("UPDATE files SET name=? WHERE id=?", params![value, local]),
        "body" => {
            let body = value.as_deref().ok_or("missing material body")?;
            db.execute(
                "UPDATE files SET content=?,content_hash=? WHERE id=?",
                params![body, hash_body(body), local],
            )
        }
        key if key.starts_with("cue:") => {
            let sid = &key[4..];
            let row = sentence_row(db, local, sid)?;
            let (index, en, start, end): Cue =
                serde_json::from_str(value.as_deref().ok_or("missing subtitle cue")?)
                    .map_err(err)?;
            if current_basis(db, row)? != *basis {
                db.execute(
                    "INSERT OR REPLACE INTO lan_material_basis(local_id,revision) VALUES(?,?)",
                    params![row, basis],
                )
                .map_err(err)?;
                db.execute(
                    "UPDATE segments SET zh_text=(
                    SELECT value FROM lan_material_values WHERE file=? AND field=? AND basis=?
                    ORDER BY automatic,generation DESC,revision DESC LIMIT 1) WHERE id=?",
                    params![file, sid, basis, row],
                )
                .map_err(err)?;
            }
            db.execute(
                "UPDATE segments SET index_num=?,en_text=?,start_time=?,end_time=? WHERE id=?",
                params![index, en, start, end, row],
            )
        }
        _ => {
            let row = sentence_row(db, local, &field)?;
            if current_basis(db, row)? != *basis {
                return Ok(());
            }
            db.execute(
                "UPDATE segments SET zh_text=? WHERE id=?",
                params![value, row],
            )
        }
    }
    .map_err(err)?;
    if n != 1 {
        return Err("material field missing its sentence".into());
    }
    Ok(())
}
fn sentence_row(db: &Connection, file: i64, sid: &str) -> Result<i64> {
    db.query_row(
        "SELECT s.id FROM segments s JOIN lan_sentence_ids i ON i.local_id=s.id
                  WHERE i.stable_id=? AND s.file_id=?",
        params![sid, file],
        |r| r.get(0),
    )
    .map_err(err)
}
fn current_basis(db: &Connection, row: i64) -> Result<String> {
    Ok(db
        .query_row(
            "SELECT revision FROM lan_material_basis WHERE local_id=?",
            [row],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_default())
}
pub(crate) fn apply(
    db: &Connection,
    event: &Event,
    change: Change,
    store: &impl session::SavedStore,
) -> Result<()> {
    change.validate()?;
    let old: Option<Value> = db
        .query_row(
            "SELECT value FROM sync_runtime WHERE key='applying'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    db.execute(
        "INSERT OR REPLACE INTO sync_runtime(key,value) VALUES('applying','1')",
        [],
    )
    .map_err(err)?;
    match &change {
        Change::Create {
            file,
            bytes,
            sha256,
        }
        | Change::Large {
            file,
            bytes,
            sha256,
        } => {
            if matches!(change, Change::Create { .. }) {
                publish(
                    db,
                    file,
                    transfer::decode(db, &event.id, *bytes, sha256)?,
                    store,
                )?
            } else {
                let field: Change = transfer::decode(db, &event.id, *bytes, sha256)?;
                if field.file() != file {
                    return Err("misdirected field payload".into());
                }
                match &field {
                    Change::Attach { source, .. } => apply_attachment(db, file, source, store)?,
                    _ => apply_field(db, &field, &event.id)?,
                }
            }
            db.execute("DELETE FROM lan_material_stage WHERE id=1", [])
                .map_err(err)?;
        }
        Change::Saved { .. } => return Err("saved manifest requires saved store".into()),
        Change::Attach { .. } => return Err("expected chunked source".into()),
        Change::Field { .. } => apply_field(db, &change, &event.id)?,
        Change::Resolution { .. } => return Err("resolution must use saved store".into()),
        Change::Metadata {
            file,
            field,
            value,
            generation,
            parents,
        } => super::metadata::apply(
            db,
            file,
            field,
            value.as_deref(),
            &event.id,
            parents,
            *generation,
        )?,
        Change::Recovery {
            file,
            revision,
            done,
        } => {
            db.execute("INSERT INTO lan_recoverable_edits(file,revision,done) VALUES(?,?,?)
                ON CONFLICT(revision) DO UPDATE SET done=max(done,excluded.done) WHERE file=excluded.file",params![file,revision,done]).map_err(err)?;
        }
        Change::Delete { file, seen, epoch } => {
            let mut edits=db.prepare("SELECT v.revision FROM lan_material_values v JOIN lan_saved_outbox o ON o.eid=v.revision
                JOIN lan_saved_peer p WHERE v.file=? AND v.automatic=0 AND p.pair=? AND o.seq>?").map_err(err)?;
            let revisions = edits
                .query_map(params![file, epoch, seen], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            for rev in revisions {
                record_recovery(db, file, &rev, false)?;
            }
            db.execute("INSERT INTO lan_material_files(file,local_id) VALUES(?,NULL) ON CONFLICT(file) DO NOTHING",[file]).map_err(err)?;
            if let Some(local) = local_file(db, file)? {
                db.execute("DELETE FROM files WHERE id=?", [local])
                    .map_err(err)?;
                db.execute("UPDATE sync_entity_state SET deleted_at=updated_at WHERE table_name='files' AND local_id=?",[local]).map_err(err)?;
            }
        }
    }
    if let Some(v) = old {
        db.execute("UPDATE sync_runtime SET value=? WHERE key='applying'", [v])
    } else {
        db.execute("DELETE FROM sync_runtime WHERE key='applying'", [])
    }
    .map_err(err)?;
    Ok(())
}

pub(crate) fn record_recovery(
    db: &Connection,
    file: &str,
    revision: &str,
    done: bool,
) -> Result<()> {
    let n=db.execute("INSERT INTO lan_recoverable_edits(file,revision,done) VALUES(?,?,?)
       ON CONFLICT(revision) DO UPDATE SET done=excluded.done WHERE file=excluded.file AND done<excluded.done",params![file,revision,done]).map_err(err)?;
    if n == 1 {
        let event = Change::Recovery {
            file: file.to_string(),
            revision: revision.to_string(),
            done,
        };
        db.execute(
            "INSERT INTO lan_saved_outbox(snapshot) VALUES(?)",
            [serde_json::to_string(&event).map_err(err)?],
        )
        .map_err(err)?;
    }
    Ok(())
}

/// An explicit recovery creates a new material from the archived baseline and
/// visible edits. The deleted stable ID remains retired on every replica.
pub(crate) fn recover_copy(
    db: &Connection,
    file: &str,
    picked: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    let original:Vec<u8>=db.query_row("SELECT b.data FROM lan_material_blobs b JOIN lan_history h ON h.eid=b.event
        WHERE json_extract(h.snapshot,'$.material_op')='create' AND json_extract(h.snapshot,'$.file')=? ORDER BY h.ordinal LIMIT 1",[file],|r|r.get(0)).map_err(err)?;
    let mut s: Snapshot = serde_json::from_slice(&original).map_err(err)?;
    let field = |name: &str, basis: Option<&str>| -> Result<Option<(Option<String>, String)>> {
        db.query_row("SELECT value,basis FROM lan_material_values WHERE file=?1 AND field=?2 AND (?3 IS NULL OR basis=?3)
            ORDER BY revision=?4 DESC,automatic,generation DESC,revision DESC LIMIT 1",params![file,name,basis,picked],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)
    };
    if let Some((Some(title), _)) = field("title", None)? {
        s.title = title;
    }
    if let Some((Some(body), _)) = field("body", None)? {
        s.body = body;
    }
    for sentence in &mut s.sentences {
        let canonical:String=db.query_row("SELECT coalesce((SELECT sentence FROM lan_material_aliases WHERE file=? AND alias=?2),?2)",params![file,sentence.id],|r|r.get(0)).map_err(err)?;
        let mut basis = String::new();
        if let Some((Some(value), v)) = field(&format!("cue:{canonical}"), None)? {
            let (index, en, start, end): Cue = serde_json::from_str(&value).map_err(err)?;
            sentence.index = index;
            sentence.english = en;
            sentence.start = start;
            sentence.end = end;
            basis = v;
        }
        if let Some((value, _)) = field(&canonical, Some(&basis))? {
            sentence.chinese = value;
        }
        sentence.id = Uuid::new_v4().simple().to_string();
    }
    // A user is recovering readable text. Source manifests may refer to an
    // older body; retain them only while their original content still validates.
    if s.source.as_ref().is_some_and(|source| {
        store
            .validate_source(source, &s.body, &s.kind, s.sentences.len())
            .is_err()
    }) {
        s.source = None;
    }
    let new_id = Uuid::new_v4().simple().to_string();
    let event = Uuid::new_v4().simple().to_string();
    let bytes = serde_json::to_vec(&s).map_err(err)?;
    let n = bytes.len();
    let old: Option<String> = db
        .query_row(
            "SELECT value FROM sync_runtime WHERE key='applying'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    db.execute(
        "INSERT OR REPLACE INTO sync_runtime(key,value) VALUES('applying','1')",
        [],
    )
    .map_err(err)?;
    publish(db, &new_id, s, store)?;
    if let Some(value) = old {
        db.execute(
            "UPDATE sync_runtime SET value=? WHERE key='applying'",
            [value],
        )
    } else {
        db.execute("DELETE FROM sync_runtime WHERE key='applying'", [])
    }
    .map_err(err)?;
    db.execute(
        "INSERT INTO lan_material_blobs(event,data) VALUES(?,?)",
        params![event, bytes],
    )
    .map_err(err)?;
    let change = Change::Create {
        file: new_id,
        bytes: n,
        sha256: String::new(),
    };
    db.execute(
        "INSERT INTO lan_saved_outbox(eid,snapshot) VALUES(?,?)",
        params![event, serde_json::to_string(&change).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}
