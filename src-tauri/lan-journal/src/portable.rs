//! Portable logical state. Connection grants, routes, ACKs and staged bytes
//! are intentionally absent. The outer backup owns the business table rows.
use super::*;
use rusqlite::types::{Value, ValueRef};
use serde_json::Value as Json;
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    pub version: u8,
    tables: BTreeMap<String, Vec<Vec<Json>>>,
}

// A fixed schema is used in both directions; SQL identifiers never come from a backup.
const TABLES: &[(&str, &str)] = &[
    ("lan_sentence_ids", "stable_id,local_id"),
    ("lan_material_files", "file,local_id"),
    ("lan_material_blobs", "event,data,digest"),
    ("lan_material_capture", "local_id,event"),
    ("lan_material_aliases", "file,alias,sentence"),
    ("lan_material_basis", "local_id,revision"),
    (
        "lan_material_values",
        "file,field,revision,generation,value,basis,automatic",
    ),
    ("lan_recoverable_edits", "file,revision,done"),
    ("lan_field_edges", "parent,child"),
    ("lan_tag_bindings", "tag,local_id"),
    (
        "lan_metadata_versions",
        "entity,field,revision,value,parents,generation",
    ),
    ("lan_saved_versions", "entity,rev,parent,depth,snapshot"),
    ("lan_saved_edges", "parent,child"),
    ("lan_quarantine", "kind,local_id"),
    ("lan_history", "ordinal,eid,parent,snapshot"),
];

fn exists(db: &Connection, table: &str) -> Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?)",
        [table],
        |r| r.get(0),
    )
    .map_err(err)
}

pub fn export(db: &Connection) -> Result<Option<Checkpoint>> {
    if !exists(db, "lan_history")? {
        return Ok(None);
    }
    let mut tables = BTreeMap::new();
    for &(name, columns) in TABLES {
        if !exists(db, name)? {
            continue;
        }
        let mut stmt = db
            .prepare(&format!("SELECT {columns} FROM {name} ORDER BY rowid"))
            .map_err(err)?;
        let mut rows = stmt.query([]).map_err(err)?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next().map_err(err)? {
            let mut entry = Vec::new();
            for i in 0..columns.split(',').count() {
                entry.push(match row.get_ref(i).map_err(err)? {
                    ValueRef::Null => Json::Null,
                    ValueRef::Integer(n) => Json::from(n),
                    ValueRef::Text(b) | ValueRef::Blob(b) => {
                        Json::String(std::str::from_utf8(b).map_err(err)?.to_string())
                    }
                    _ => return Err("invalid checkpoint field".into()),
                });
            }
            entries.push(entry);
        }
        tables.insert(name.to_string(), entries);
    }
    Ok(Some(Checkpoint { version: 1, tables }))
}

pub fn guard_before_restore(tx: &Connection) -> Result<()> {
    // Old deletion evidence survives replacing the local library with an older
    // backup. A subsequent explicit re-pair can never republish that old copy.
    tx.execute_batch("CREATE TABLE IF NOT EXISTS lan_preserved_graves(kind TEXT,entity TEXT,value TEXT,PRIMARY KEY(kind,entity)) STRICT;").map_err(err)?;
    if exists(tx, "lan_saved_peer")? {
        tx.execute("UPDATE lan_saved_peer SET active=0,applying=1", [])
            .map_err(err)?;
        if exists(tx, "lan_saved_versions")? {
            tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
            tx.execute("INSERT OR REPLACE INTO lan_preserved_graves SELECT 'saved',record_id,snapshot FROM lan_portable_saves WHERE json_extract(snapshot,'$.deleted_at') IS NOT NULL",[]).map_err(err)?;
        }
    }
    if exists(tx, "lan_material_files")? {
        tx.execute("INSERT OR IGNORE INTO lan_preserved_graves SELECT 'file',file,NULL FROM lan_material_files WHERE local_id IS NULL",[]).map_err(err)?;
    }
    if exists(tx, "lan_metadata_versions")? {
        tx.execute("INSERT OR IGNORE INTO lan_preserved_graves SELECT 'tag',entity,NULL FROM lan_metadata_versions WHERE field='deleted'",[]).map_err(err)?;
    }
    Ok(())
}

pub fn restore(tx: &Connection, checkpoint: Option<&Checkpoint>) -> Result<()> {
    let old = exists(tx, "lan_saved_peer")?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS lan_quarantine(kind TEXT NOT NULL,local_id INTEGER NOT NULL,PRIMARY KEY(kind,local_id)) STRICT;
        DELETE FROM lan_quarantine;").map_err(err)?;
    if checkpoint.is_none() {
        tx.execute_batch(
            "INSERT INTO lan_quarantine SELECT 'files',id FROM files WHERE NOT EXISTS(SELECT 1 FROM restored_material_ids r WHERE r.file_id=files.id);
            INSERT INTO lan_quarantine SELECT 'tags',id FROM tags;",
        )
        .map_err(err)?;
        if !old {
            return Ok(());
        }
    }
    tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
    // Install only schemas here. Capture observes the post-restore baseline
    // once in the same transaction, after stable references are in place.
    tx.execute(
        "INSERT INTO lan_saved_peer(singleton,pair,local_replica,peer_replica,active,applying)
        VALUES(1,?,?,?,0,1) ON CONFLICT(singleton) DO UPDATE SET active=0,applying=1",
        params![
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string(),
            Uuid::new_v4().to_string()
        ],
    )
    .map_err(err)?;
    material::schema(tx)?;
    tx.execute_batch(include_str!("metadata.sql"))
        .map_err(err)?;
    tx.execute_batch(
        "DROP TRIGGER lan_material_snapshot;
        DELETE FROM lan_metadata_edges; DELETE FROM lan_material_stage;",
    )
    .map_err(err)?;
    for &(name, _) in TABLES.iter().rev() {
        if name != "lan_quarantine" {
            tx.execute(&format!("DELETE FROM {name}"), [])
                .map_err(err)?;
        }
    }
    if let Some(checkpoint) = checkpoint {
        if checkpoint.version != 1
            || checkpoint
                .tables
                .keys()
                .any(|k| !TABLES.iter().any(|t| t.0 == k))
        {
            return Err("unsupported LAN checkpoint".into());
        }
        for &(name, columns) in TABLES {
            let Some(rows) = checkpoint.tables.get(name) else {
                continue;
            };
            let n = columns.split(',').count();
            let mut stmt = tx
                .prepare(&format!(
                    "INSERT INTO {name}({columns}) VALUES({})",
                    vec!["?"; n].join(",")
                ))
                .map_err(err)?;
            for row in rows {
                if row.len() != n {
                    return Err("invalid checkpoint row".into());
                }
                let mut values = Vec::with_capacity(n);
                for (i, v) in row.iter().enumerate() {
                    let value = match v {
                        Json::Null => Value::Null,
                        Json::String(s) if name == "lan_material_blobs" && i == 1 => {
                            Value::Blob(s.as_bytes().to_vec())
                        }
                        Json::String(s) => Value::Text(s.clone()),
                        Json::Number(n) => {
                            Value::Integer(n.as_i64().ok_or("invalid checkpoint number")?)
                        }
                        _ => return Err("invalid checkpoint value".into()),
                    };
                    values.push(value);
                }
                stmt.execute(rusqlite::params_from_iter(values))
                    .map_err(err)?;
            }
        }
    }
    // Trigger installation backfills sentence IDs only for unmapped live rows.
    material::schema(tx)?;
    tx.execute_batch("UPDATE lan_saved_peer SET applying=0;
        INSERT INTO lan_saved_outbox(snapshot) SELECT s.snapshot FROM lan_portable_saves s WHERE NOT EXISTS(SELECT 1 FROM lan_saved_versions v WHERE v.entity=s.record_id AND v.rev=s.revision);").map_err(err)?;
    // Old receipts stay inaccessible. If an old eID already exists in the
    // delivery table it is removed at rotation before replaying the checkpoint.
    Ok(())
}

pub(crate) fn enforce_graves(tx: &Connection) -> Result<()> {
    if !exists(tx, "lan_preserved_graves")? {
        return Ok(());
    }
    if exists(tx, "lan_material_files")? {
        tx.execute_batch("DELETE FROM files WHERE id IN(SELECT local_id FROM lan_material_files WHERE file IN(SELECT entity FROM lan_preserved_graves WHERE kind='file'));
            INSERT INTO lan_material_files(file,local_id) SELECT entity,NULL FROM lan_preserved_graves WHERE kind='file' ON CONFLICT(file) DO NOTHING;
            INSERT INTO lan_saved_outbox(snapshot) SELECT json_object('material_op','delete','file',g.entity) FROM lan_preserved_graves g
             WHERE kind='file' AND NOT EXISTS(SELECT 1 FROM lan_history h WHERE json_extract(h.snapshot,'$.material_op')='delete' AND json_extract(h.snapshot,'$.file')=g.entity);
            DELETE FROM tags WHERE id IN(SELECT local_id FROM lan_tag_bindings WHERE tag IN(SELECT entity FROM lan_preserved_graves WHERE kind='tag'));
            INSERT INTO lan_meta_input SELECT entity,'deleted',NULL FROM lan_preserved_graves g WHERE kind='tag'
             AND NOT EXISTS(SELECT 1 FROM lan_metadata_versions m WHERE m.entity=g.entity AND m.field='deleted');").map_err(err)?;
    }
    // Keep a replaced note as a branch before recording the durable tombstone.
    tx.execute_batch("INSERT INTO lan_saved_outbox(snapshot) SELECT value FROM lan_preserved_graves g WHERE kind='saved'
        AND NOT EXISTS(SELECT 1 FROM lan_saved_versions v WHERE v.entity=g.entity AND v.rev=json_extract(g.value,'$.revision'));
        UPDATE lan_saved_peer SET applying=1;
        INSERT INTO saved_records(record_id,normalized_expression,source_key,snapshot_json,saved_at,updated_at,revision,generation,deleted_at)
        SELECT entity,json_extract(value,'$.normalized_expression'),json_extract(value,'$.source_key'),value,json_extract(value,'$.saved_at'),
          json_extract(value,'$.updated_at'),json_extract(value,'$.revision'),json_extract(value,'$.generation'),json_extract(value,'$.deleted_at')
        FROM lan_preserved_graves WHERE kind='saved'
        ON CONFLICT(record_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at,
           revision=excluded.revision,generation=excluded.generation,deleted_at=excluded.deleted_at WHERE excluded.generation>=saved_records.generation;
        UPDATE lan_saved_peer SET applying=0;").map_err(err)?;
    Ok(())
}
