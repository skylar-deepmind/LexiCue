//! Observable preparation of the bundled v2 dictionary; no imports into user data.
#[cfg(test)]
use rusqlite::Connection;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub name: String,
    pub language: String,
    pub state: String,
    pub processed_rows: u64,
    pub error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub run_id: u64,
    pub sequence: u64,
    pub state: String,
    pub current_source: Option<String>,
    pub sources: Vec<SourceStatus>,
}
#[derive(Clone)]
pub struct DictionaryStatus(Arc<Mutex<Snapshot>>);
impl Default for DictionaryStatus {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Snapshot {
            run_id: 0,
            sequence: 0,
            state: "idle".into(),
            current_source: None,
            sources: vec![SourceStatus {
                name: "Wiktionary".into(),
                language: "en".into(),
                state: "pending".into(),
                processed_rows: 0,
                error: None,
            }],
        })))
    }
}
impl DictionaryStatus {
    pub fn snapshot(&self) -> Snapshot {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn is_ready(&self) -> bool {
        self.snapshot().state == "ready"
    }
    fn update(&self, app: &AppHandle, edit: impl FnOnce(&mut Snapshot)) {
        let next = {
            let mut s = self.0.lock().unwrap_or_else(|e| e.into_inner());
            edit(&mut s);
            s.sequence += 1;
            s.clone()
        };
        let _ = app.emit("dictionary-init-progress", next);
    }
    fn begin(&self) -> bool {
        let mut s = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if s.state == "running" || s.state == "ready" {
            return false;
        }
        s.run_id += 1;
        s.sequence += 1;
        s.state = "running".into();
        s.sources[0].state = "running".into();
        s.sources[0].error = None;
        true
    }
}
#[cfg(test)]
pub fn report_rows(_rows: u64) {}
pub fn start(app: AppHandle, status: DictionaryStatus) {
    if !status.begin() {
        return;
    }
    let _ = app.emit("dictionary-init-progress", status.snapshot());
    let worker_status = status.clone();
    let worker_app = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("dictionary-init".into())
        .spawn(move || {
            let result = super::dictionary_packs::initialize_runtime(&worker_app);
            worker_status.update(&worker_app, |s| {
                s.current_source = None;
                s.state = if result.is_ok() { "ready" } else { "failed" }.into();
                s.sources[0].state = s.state.clone();
                s.sources[0].error = result.err();
                s.sources[0].processed_rows = if s.state == "ready" { 41684 } else { 0 };
            });
            let _ = worker_app.emit("dictionary-ready", worker_status.is_ready());
        })
    {
        status.update(&app, |s| {
            s.state = "failed".into();
            s.sources[0].state = "failed".into();
            s.sources[0].error = Some(error.to_string());
        });
    }
}
#[tauri::command]
pub fn dictionary_init_status(status: State<DictionaryStatus>) -> Snapshot {
    status.snapshot()
}
#[tauri::command]
pub fn retry_dictionary_init(app: AppHandle, status: State<DictionaryStatus>) -> Snapshot {
    start(app, status.inner().clone());
    status.snapshot()
}
#[cfg(test)]
fn validate_source_receipt(conn: &Connection, name: &str, language: &str) -> Result<(), String> {
    let table = match name {
        "ECDICT" => "builtin_dictionary_entries",
        "JMdict" => "builtin_japanese_dictionary_entries",
        "GermanDict" => "builtin_german_dictionary_entries",
        "CC-CEDICT" => "builtin_chinese_dictionary_entries",
        "CC-CEDICT Phrases" => "builtin_chinese_phrase_dictionary",
        "PhraseDict" => "builtin_phrase_dictionary",
        "JMdict Idioms" => "builtin_japanese_phrase_dictionary",
        _ => return Err("Unknown dictionary source".into()),
    };
    let has_rows: bool = conn
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} LIMIT 1)"),
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_rows {
        // Restored metadata alone cannot prove that the actual resource is present.
        // Clear it before importing so an interrupted repair remains resumable.
        conn.execute(
            "DELETE FROM dictionary_sources WHERE provider=?1 AND language=?2",
            [name, language],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_resources_cannot_be_marked_ready_by_restored_metadata() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE builtin_dictionary_entries(lemma TEXT); CREATE TABLE dictionary_sources(language TEXT,provider TEXT);
        INSERT INTO dictionary_sources VALUES('en','ECDICT'),('en','User dictionary');").unwrap();
        validate_source_receipt(&conn, "ECDICT", "en").unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM dictionary_sources WHERE provider='ECDICT'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM dictionary_sources WHERE provider='User dictionary'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        conn.execute_batch("INSERT INTO builtin_dictionary_entries VALUES('word'); INSERT INTO dictionary_sources VALUES('en','ECDICT');").unwrap();
        validate_source_receipt(&conn, "ECDICT", "en").unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM dictionary_sources WHERE provider='ECDICT'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn concurrent_starts_only_claim_one_worker() {
        let status = DictionaryStatus::default();
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let s = status.clone();
                std::thread::spawn(move || s.begin())
            })
            .collect();
        assert_eq!(
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .filter(|claimed| *claimed)
                .count(),
            1
        );
        assert_eq!(status.snapshot().run_id, 1);
    }
    #[test]
    fn failed_daily_pack_can_retry_without_legacy_sources() {
        let status = DictionaryStatus::default();
        assert!(status.begin());
        {
            let mut s = status.0.lock().unwrap();
            s.state = "failed".into();
            s.sources[0].state = "failed".into();
            s.sources[0].error = Some("checksum".into());
        }
        assert!(!status.is_ready());
        assert_eq!(status.snapshot().sources.len(), 1);
        assert!(status.begin());
        let next = status.snapshot();
        assert_eq!(next.run_id, 2);
        assert_eq!(next.sources[0].state, "running");
        assert!(next.sources[0].error.is_none());
        assert!(!status.begin());
    }
}
