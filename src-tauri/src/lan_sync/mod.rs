//! Local first-merge preparation. No LAN operation is exposed over IPC yet.
pub mod saved_delta;
mod sentences;
pub use sentences::prepare_sentence_ids;

use crate::db::consistent_backup;
use rusqlite::{Connection, OpenFlags};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// A private SQLite recovery point. Never serialize this database to a peer.
pub struct MergeBackup {
    path: PathBuf,
}

impl MergeBackup {
    /// Call on a blocking worker with the trusted local app database path.
    /// Persist the operation ID before calling. A retry reopens the original
    /// point in time even after new local edits or a process restart.
    pub fn prepare(database: &Path, operation: Uuid) -> Result<Self, String> {
        let parent = database.parent().ok_or("invalid local database path")?;
        let directory = parent.join("backups");
        let backup = Self {
            path: directory.join(format!("lexicue-pre-merge-{operation}.db")),
        };
        let mut verified = false;
        if !backup.path.try_exists().map_err(|e| e.to_string())? {
            // Separate read connection: do not hold the shared app mutex while
            // SQLite reads committed WAL pages and verifies the safety copy.
            let source = open_local(database)?;
            let private = consistent_backup(&source, database, "lexicue-merge-preparing")
                .map_err(|e| e.to_string())?;
            let published = (|| {
                let snapshot = open_local(&private)?;
                validate(&snapshot)?;
                // Atomic no-clobber publication, including concurrent retries.
                match fs::hard_link(&private, &backup.path) {
                    Ok(()) => Ok(true),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
                    Err(e) => Err(e.to_string()),
                }
            })();
            // A crash can leave an unreferenced private copy, but never a
            // partially written receipt. Do not remove the published backup.
            fs::remove_file(&private).map_err(|e| e.to_string())?;
            verified = published?;
        }
        if !verified {
            backup.open_verified()?;
        }
        #[cfg(unix)]
        {
            fs::File::open(&directory)
                .and_then(|dir| dir.sync_all())
                .and_then(|()| fs::File::open(parent)?.sync_all())
                .map_err(|e| e.to_string())?;
        }
        Ok(backup)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Recovery and snapshot readers get a read-only handle. Verification on
    /// reopen catches corruption and missing schema before accepting a receipt.
    pub fn open_verified(&self) -> Result<Connection, String> {
        let connection = open_local(&self.path)?;
        let status: String = connection
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if status != "ok" {
            return Err("invalid merge backup integrity".into());
        }
        validate(&connection)?;
        Ok(connection)
    }
}

fn open_local(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())
}

fn validate(connection: &Connection) -> Result<(), String> {
    // A structurally valid but empty SQLite file is not a recovery point.
    for query in [
        "SELECT id,content FROM files LIMIT 0",
        "SELECT file_id,en_text,zh_text,start_time,end_time FROM segments LIMIT 0",
        "SELECT record_id,snapshot_json FROM saved_records LIMIT 0",
        "SELECT sync_id FROM sync_entity_state LIMIT 0",
    ] {
        connection.prepare(query).map_err(|e| e.to_string())?;
    }
    let invalid: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_foreign_key_check)",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if invalid {
        return Err("invalid merge backup foreign key".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
