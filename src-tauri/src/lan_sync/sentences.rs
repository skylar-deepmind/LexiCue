use super::MergeBackup;
use rusqlite::{Connection, OpenFlags, TransactionBehavior};
use std::path::Path;
use uuid::Uuid;

/// First opt-in migration. Existing integer keys and cloud tracking stay in
/// place. Call with the same operation ID when retrying after a restart.
pub fn prepare_sentence_ids(database: &Path, operation: Uuid) -> Result<MergeBackup, String> {
    let backup = MergeBackup::prepare(database, operation)?;
    let mut connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;")
        .map_err(|e| e.to_string())?;
    let tx = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    tx.execute_batch(lexicue_lan_journal::material::SENTENCE_SCHEMA)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(backup)
}
