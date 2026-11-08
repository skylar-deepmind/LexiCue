//! Readable material revisions use the same ordered outbox as reader saves.
//! A manifest occupies one sequence number regardless of the number of chunks.
use super::*;
use rusqlite::types::Value;
use std::collections::HashSet;

pub(crate) mod transfer;
pub const SENTENCE_SCHEMA: &str = include_str!("sentences.sql");
pub(crate) const MAX_BLOB: usize = 256 * 1024 * 1024;

pub(crate) fn install(tx: &Connection) -> Result<()> {
    tx.execute_batch(SENTENCE_SCHEMA).map_err(err)?;
    tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
    tx.execute("INSERT INTO lan_material_capture(local_id) SELECT f.id FROM files f WHERE f.language='en' AND f.type IN ('txt','srt') AND NOT EXISTS(SELECT 1 FROM lan_material_files m WHERE m.local_id=f.id)
        AND NOT EXISTS(SELECT 1 FROM sync_delete_jobs j WHERE j.file_id=f.id AND j.phase NOT IN ('done','failed')) ORDER BY f.id",[]).map_err(err)?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "material_op", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Change {
    Create {
        file: String,
        bytes: usize,
        sha256: String,
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
    },
    Delete {
        file: String,
    },
}
pub(crate) fn parse(text: &str) -> Result<Option<Change>> {
    if text.starts_with("{\"material_op\":") {
        serde_json::from_str(text).map(Some).map_err(err)
    } else {
        Ok(None)
    }
}
fn id(s: &str) -> bool {
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
    pub(crate) fn blob(&self) -> Option<(usize, &str)> {
        match self {
            Self::Create { bytes, sha256, .. } | Self::Large { bytes, sha256, .. } => {
                Some((*bytes, sha256))
            }
            _ => None,
        }
    }
    fn file(&self) -> &str {
        match self {
            Self::Create { file, .. }
            | Self::Large { file, .. }
            | Self::Field { file, .. }
            | Self::Delete { file } => file,
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
            if !(1..=MAX_BLOB).contains(&bytes)
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("invalid material manifest".into());
            }
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
#[derive(Deserialize)]
struct Sentence {
    id: String,
    index: i64,
    english: String,
    chinese: Option<String>,
    start: Option<String>,
    end: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    title: String,
    kind: String,
    body: String,
    imported_at: i64,
    sentences: Vec<Sentence>,
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

fn publish(db: &Connection, file: &str, s: Snapshot) -> Result<()> {
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
    let original:Vec<u8>=db.query_row("SELECT b.data FROM lan_material_capture c JOIN lan_material_blobs b ON b.event=c.event WHERE c.local_id=?",[local],|r|r.get(0)).map_err(err)?;
    let baseline: Snapshot = serde_json::from_slice(&original).map_err(err)?;
    if baseline.body != incoming.body
        || baseline.kind != incoming.kind
        || baseline.sentences.len() != incoming.sentences.len()
    {
        return Err("material baseline diverged; reconciliation required".into());
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

fn apply_field(db: &Connection, change: &Change, eid: &str) -> Result<()> {
    let Change::Field {
        file,
        field,
        revision,
        generation,
        value,
        automatic,
        basis,
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
    db.execute("INSERT INTO lan_material_values(file,field,revision,generation,value,automatic,basis) VALUES(?,?,?,?,?,?,?)",params![file,field,revision,generation,value,automatic,basis]).map_err(err)?;
    let Some(local) = local_file(db, file)? else {
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
pub(crate) fn apply(db: &Connection, event: &Event, change: Change) -> Result<()> {
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
                publish(db, file, transfer::decode(db, &event.id, *bytes, sha256)?)?
            } else {
                let field: Change = transfer::decode(db, &event.id, *bytes, sha256)?;
                if field.file() != file {
                    return Err("misdirected field payload".into());
                }
                apply_field(db, &field, &event.id)?;
            }
            db.execute("DELETE FROM lan_material_stage WHERE id=1", [])
                .map_err(err)?;
        }
        Change::Field { .. } => apply_field(db, &change, &event.id)?,
        Change::Delete { file } => {
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
