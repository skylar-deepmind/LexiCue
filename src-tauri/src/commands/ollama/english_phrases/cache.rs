//! Disposable, file-scoped checkpoints. Only validated results belong here.
use super::{diagnostics, AiConfig};
use crate::commands::ollama::{now_ms, SYSTEM_PROMPT};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES: i64 = 100 * 1024 * 1024;

pub(super) fn fingerprint(config: &AiConfig, stage: &str, input: &Value) -> String {
    // Exact prompts retain extraction work when only presentation changes.
    let value = serde_json::json!({
        "stage": stage, "version": 2,
        "tokenizer_version": 1, "system": SYSTEM_PROMPT,
        "provider": config.provider, "base_url": config.base_url.trim().trim_end_matches('/'),
        "model": config.model, "temperature": 0, "input": input
    });
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).expect("JSON value"))
    )
}

pub(super) struct Checkpoints<'a> {
    pub conn: &'a Mutex<Connection>,
    pub file_id: i64,
    pub force: bool,
}

impl Checkpoints<'_> {
    pub fn read(&self, stage: &str, key: &str) -> Option<Value> {
        if self.force {
            return None;
        }
        let result = (|| -> Result<Option<Value>, String> {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            // Expiry uses its index; capacity maintenance belongs to writes,
            // rather than rescanning the entire cache for every occurrence hit.
            conn.execute(
                "DELETE FROM phrase_analysis_cache WHERE expires_at<=?1",
                [now_ms()],
            )
            .map_err(|e| e.to_string())?;
            let raw: Option<String> = conn.query_row(
                "SELECT result_json FROM phrase_analysis_cache WHERE file_id=?1 AND stage=?2 AND cache_key=?3",
                params![self.file_id, stage, key], |row| row.get(0),
            ).optional().map_err(|e| e.to_string())?;
            let Some(raw) = raw else {
                return Ok(None);
            };
            let Ok(value) = serde_json::from_str(&raw) else {
                conn.execute("DELETE FROM phrase_analysis_cache WHERE file_id=?1 AND stage=?2 AND cache_key=?3", params![self.file_id, stage, key]).map_err(|e| e.to_string())?;
                return Ok(None);
            };
            conn.execute("UPDATE phrase_analysis_cache SET last_used_at=?4 WHERE file_id=?1 AND stage=?2 AND cache_key=?3", params![self.file_id, stage, key, now_ms()]).map_err(|e| e.to_string())?;
            Ok(Some(value))
        })();
        match result {
            Ok(value) => value,
            Err(_) => {
                diagnostics::cache_error(self.file_id);
                None
            }
        }
    }

    pub fn write(&self, stage: &str, key: &str, value: &Value) {
        let result = (|| -> Result<(), String> {
            let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            let now = now_ms();
            conn.execute(
                "INSERT INTO phrase_analysis_cache(file_id,stage,cache_key,result_json,payload_bytes,created_at,expires_at,last_used_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?6) ON CONFLICT(file_id,stage,cache_key) DO UPDATE SET result_json=excluded.result_json,payload_bytes=excluded.payload_bytes,created_at=excluded.created_at,expires_at=excluded.expires_at,last_used_at=excluded.last_used_at",
                params![self.file_id, stage, key, raw, raw.len() as i64, now, now + TTL_MS],
            ).map_err(|e| e.to_string())?;
            prune(&conn, now, MAX_BYTES).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            diagnostics::cache_error(self.file_id);
        }
    }
}

fn prune(conn: &Connection, now: i64, max_bytes: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM phrase_analysis_cache WHERE expires_at<=?1",
        [now],
    )?;
    let mut total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(payload_bytes),0) FROM phrase_analysis_cache",
        [],
        |row| row.get(0),
    )?;
    while total > max_bytes {
        let (id, bytes): (i64, i64) = conn.query_row("SELECT rowid,payload_bytes FROM phrase_analysis_cache ORDER BY last_used_at,created_at,rowid LIMIT 1", [], |row| Ok((row.get(0)?, row.get(1)?)))?;
        conn.execute("DELETE FROM phrase_analysis_cache WHERE rowid=?1", [id])?;
        total -= bytes;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> (tempfile::TempDir, Mutex<Connection>) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("cache.sqlite")).unwrap();
        conn.execute("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'a','txt','text','h',1),(2,'b','txt','text','h',1)", []).unwrap();
        (dir, Mutex::new(conn))
    }

    #[test]
    fn checkpoints_persist_are_file_scoped_and_force_bypasses_reads() {
        let (dir, conn) = database();
        let cache = Checkpoints {
            conn: &conn,
            file_id: 1,
            force: false,
        };
        let value = serde_json::json!({"phrases":[]});
        cache.write("extraction", "key", &value);
        assert_eq!(cache.read("extraction", "key"), Some(value.clone()));
        assert!(Checkpoints {
            conn: &conn,
            file_id: 2,
            force: false
        }
        .read("extraction", "key")
        .is_none());
        let forced = Checkpoints {
            conn: &conn,
            file_id: 1,
            force: true,
        };
        assert!(forced.read("extraction", "key").is_none());
        forced.write("extraction", "key", &serde_json::json!({"new":true}));
        let reopened = Mutex::new(crate::db::init_db(&dir.path().join("cache.sqlite")).unwrap());
        assert_eq!(
            Checkpoints {
                conn: &reopened,
                file_id: 1,
                force: false
            }
            .read("extraction", "key"),
            Some(serde_json::json!({"new":true}))
        );
    }

    #[test]
    fn expiry_corruption_lru_and_file_deletion_clean_up() {
        let (_dir, conn) = database();
        let cache = Checkpoints {
            conn: &conn,
            file_id: 1,
            force: false,
        };
        cache.write("extraction", "expired", &serde_json::json!([]));
        conn.lock()
            .unwrap()
            .execute("UPDATE phrase_analysis_cache SET expires_at=0", [])
            .unwrap();
        assert!(cache.read("extraction", "expired").is_none());
        cache.write("extraction", "bad", &serde_json::json!([]));
        conn.lock()
            .unwrap()
            .execute("UPDATE phrase_analysis_cache SET result_json='{'", [])
            .unwrap();
        assert!(cache.read("extraction", "bad").is_none());
        cache.write("extraction", "old", &serde_json::json!([1]));
        conn.lock()
            .unwrap()
            .execute("UPDATE phrase_analysis_cache SET last_used_at=1", [])
            .unwrap();
        cache.write("extraction", "new", &serde_json::json!([2]));
        prune(&conn.lock().unwrap(), now_ms(), 3).unwrap();
        assert!(cache.read("extraction", "old").is_none());
        assert!(cache.read("extraction", "new").is_some());
        conn.lock()
            .unwrap()
            .execute("DELETE FROM files WHERE id=1", [])
            .unwrap();
        assert!(cache.read("extraction", "new").is_none());
    }

    #[test]
    fn fingerprints_exclude_secrets_and_include_model_endpoint_and_input() {
        let mut config = AiConfig {
            provider: "openai".into(),
            base_url: "https://example.invalid/v1/".into(),
            model: "a".into(),
            api_key: Some("secret".into()),
        };
        let input = serde_json::json!({"sentence":"I picked it up.","evidence":[]});
        let original = fingerprint(&config, "explanation", &input);
        config.api_key = Some("another".into());
        assert_eq!(original, fingerprint(&config, "explanation", &input));
        config.base_url = "https://example.invalid/v1".into();
        assert_eq!(original, fingerprint(&config, "explanation", &input));
        config.model = "b".into();
        assert_ne!(original, fingerprint(&config, "explanation", &input));
        config.model = "a".into();
        config.base_url = "https://other.invalid/v1".into();
        assert_ne!(original, fingerprint(&config, "explanation", &input));
        assert_ne!(
            original,
            fingerprint(
                &config,
                "explanation",
                &serde_json::json!({"sentence":"She picked it up."})
            )
        );
    }

    #[test]
    fn upgrade_removes_only_obsolete_explanation_checkpoints() {
        let (dir, conn) = database();
        {
            let cache = Checkpoints { conn: &conn, file_id: 1, force: false };
            cache.write("extraction", "keep", &serde_json::json!({"phrases":[]}));
            cache.write("explanation", "obsolete", &serde_json::json!({"interpretations":[]}));
        }
        drop(conn);
        let reopened = Mutex::new(crate::db::init_db(&dir.path().join("cache.sqlite")).unwrap());
        let cache = Checkpoints { conn: &reopened, file_id: 1, force: false };
        assert!(cache.read("extraction", "keep").is_some());
        assert!(cache.read("explanation", "obsolete").is_none());
    }

    #[test]
    fn restore_removes_checkpoints_and_backup_excludes_them() {
        let (_dir, conn) = database();
        let cache = Checkpoints {
            conn: &conn,
            file_id: 1,
            force: false,
        };
        cache.write("extraction", "key", &serde_json::json!({"phrases":[]}));
        let db = conn.lock().unwrap();
        let backup = crate::commands::export::backup_payload(&db).unwrap();
        assert!(!serde_json::to_string(&backup)
            .unwrap()
            .contains("phrase_analysis_cache"));
        crate::commands::export::restore_backup(&db, &backup).unwrap();
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM phrase_analysis_cache", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}
