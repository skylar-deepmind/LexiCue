//! App adapter for the authenticated transport's saved-record messages.
use super::MergeBackup;
use crate::commands::saved::{self, SavedRecord};
use lexicue_lan_journal::session::SavedStore;
pub use lexicue_lan_journal::{session, Route};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use uuid::Uuid;

pub fn prepare(database: &Path, operation: Uuid, route: &Route) -> Result<MergeBackup, String> {
    super::prepare_library(database, operation, route)
}

pub struct ReaderSaves;

// Older records may omit fields that now have defaults. Never forward extra
// fields that the typed reader would silently discard at the destination.
fn only_known_fields(input: &serde_json::Value, typed: &serde_json::Value) -> bool {
    match (input, typed) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => a
            .iter()
            .all(|(k, v)| b.get(k).is_some_and(|t| only_known_fields(v, t))),
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(v, t)| only_known_fields(v, t))
        }
        _ => input == typed,
    }
}

impl SavedStore for ReaderSaves {
    fn validate(&self, json: &str) -> Result<(), String> {
        let record: SavedRecord = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if record.origin != "reader" || record.legacy.is_some() {
            return Err("invalid LAN reader save".into());
        }
        let source = record.source.as_ref().ok_or("missing reader context")?;
        let name = source.file_name.trim().to_ascii_lowercase();
        if name.starts_with(['/', '\\'])
            || name.starts_with("~/")
            || name.starts_with("file:")
            || name.starts_with("content:")
            || (name.as_bytes().get(1) == Some(&b':')
                && matches!(name.as_bytes().get(2), Some(b'/' | b'\\')))
        {
            return Err("non-portable saved source name".into());
        }
        let input = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let typed = serde_json::to_value(&record).map_err(|e| e.to_string())?;
        if !only_known_fields(&input, &typed) {
            return Err("unsupported saved snapshot fields".into());
        }
        saved::validate_record(&record)
    }

    fn write(&self, tx: &Connection, json: &str) -> Result<(), String> {
        let record: SavedRecord = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if saved::get(tx, &record.record_id)?.as_ref() == Some(&record) {
            return Ok(());
        }
        // Preserve local sync identity bookkeeping without emitting a second
        // event into either LAN or the retired cloud queue. The caller owns
        // the entire SQLite transaction, including restoring this guard.
        let old: Option<String> = tx
            .query_row(
                "SELECT value FROM sync_runtime WHERE key='applying'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO sync_runtime(key,value) VALUES('applying','1') ON CONFLICT(key) DO UPDATE SET value='1'",[]).map_err(|e|e.to_string())?;
        let local = saved::write_record(tx, &record)?;
        tx.execute(
            "INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at)
            VALUES('saved_records',?1,?2,?3,?4) ON CONFLICT(table_name,local_id) DO UPDATE SET
            updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
            params![
                local,
                record.record_id,
                record.updated_at,
                record.deleted_at
            ],
        )
        .map_err(|e| e.to_string())?;
        if let Some(value) = old {
            tx.execute(
                "UPDATE sync_runtime SET value=?1 WHERE key='applying'",
                [value],
            )
        } else {
            tx.execute("DELETE FROM sync_runtime WHERE key='applying'", [])
        }
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
