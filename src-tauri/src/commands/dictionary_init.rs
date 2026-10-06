//! A recoverable, observable coordinator; each dictionary owns its completion receipt.
use super::dictionary;
use rusqlite::Connection;
use serde::Serialize;
use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

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
type Initializer = fn(&Connection) -> Result<(), String>;
const SOURCES: &[(&str, &str, Initializer)] = &[
    ("ECDICT", "en", dictionary::initialize_builtin_dictionary),
    (
        "JMdict",
        "ja",
        dictionary::initialize_builtin_japanese_dictionary,
    ),
    (
        "GermanDict",
        "de",
        dictionary::initialize_builtin_german_dictionary,
    ),
    (
        "CC-CEDICT",
        "zh",
        dictionary::initialize_builtin_chinese_dictionary,
    ),
    (
        "CC-CEDICT Phrases",
        "zh",
        dictionary::initialize_builtin_chinese_phrase_dictionary,
    ),
    (
        "PhraseDict",
        "en",
        dictionary::initialize_builtin_phrase_dictionary,
    ),
    (
        "JMdict Idioms",
        "ja",
        dictionary::initialize_builtin_japanese_phrase_dictionary,
    ),
];
#[derive(Clone)]
pub struct DictionaryStatus(Arc<Mutex<Snapshot>>);
impl Default for DictionaryStatus {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Snapshot {
            run_id: 0,
            sequence: 0,
            state: "idle".into(),
            current_source: None,
            sources: SOURCES
                .iter()
                .map(|(name, language, _)| SourceStatus {
                    name: (*name).into(),
                    language: (*language).into(),
                    state: "pending".into(),
                    processed_rows: 0,
                    error: None,
                })
                .collect(),
        })))
    }
}
impl DictionaryStatus {
    pub fn snapshot(&self) -> Snapshot {
        self.0.lock().unwrap().clone()
    }
    pub fn is_ready(&self) -> bool {
        self.snapshot().state == "ready"
    }
    pub fn language_ready(&self, language: &str) -> bool {
        self.snapshot()
            .sources
            .iter()
            .filter(|s| {
                s.language == language && !s.name.contains("Phrase") && !s.name.contains("Idioms")
            })
            .all(|s| s.state == "ready")
    }
    pub fn language_failed(&self, language: &str) -> bool {
        self.snapshot().sources.iter().any(|s| {
            s.language == language
                && !s.name.contains("Phrase")
                && !s.name.contains("Idioms")
                && s.state == "failed"
        })
    }
    fn update(&self, app: &AppHandle, edit: impl FnOnce(&mut Snapshot)) {
        let snapshot = {
            let mut value = self.0.lock().unwrap();
            edit(&mut value);
            value.sequence += 1;
            value.clone()
        };
        let _ = app.emit("dictionary-init-progress", snapshot);
    }
    fn begin(&self) -> bool {
        let mut value = self.0.lock().unwrap();
        if value.state == "running" || value.state == "ready" {
            return false;
        }
        value.run_id += 1;
        value.sequence += 1;
        value.state = "running".into();
        true
    }
}
struct Reporter {
    status: DictionaryStatus,
    app: AppHandle,
    index: usize,
    last: Instant,
}
thread_local! { static REPORTER: RefCell<Option<Reporter>> = const { RefCell::new(None) }; }
pub fn report_rows(rows: u64) {
    REPORTER.with(|cell| {
        if let Some(reporter) = cell.borrow_mut().as_mut() {
            {
                let mut value = reporter.status.0.lock().unwrap();
                value.sources[reporter.index].processed_rows = rows;
                value.sequence += 1;
            }
            if reporter.last.elapsed() >= Duration::from_millis(200) {
                let _ = reporter
                    .app
                    .emit("dictionary-init-progress", reporter.status.snapshot());
                reporter.last = Instant::now();
            }
        }
    });
}
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
pub fn start(app: AppHandle, status: DictionaryStatus) {
    if !status.begin() {
        return;
    }
    let _ = app.emit("dictionary-init-progress", status.snapshot());
    let spawned_status = status.clone();
    let spawned_app = app.clone();
    let result = std::thread::Builder::new()
        .name("dictionary-init".into())
        .spawn(move || {
            let status = spawned_status;
            let app = spawned_app;
            let opened = (|| {
                let path = app
                    .path()
                    .app_data_dir()
                    .map_err(|e| e.to_string())?
                    .join("lexicue.db");
                let conn = Connection::open(path).map_err(|e| e.to_string())?;
                conn.busy_timeout(Duration::from_secs(5))
                    .map_err(|e| e.to_string())?;
                conn.execute_batch("PRAGMA foreign_keys=ON;")
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>(conn)
            })();
            let conn = match opened {
                Ok(conn) => conn,
                Err(error) => {
                    status.update(&app, |s| {
                        s.state = "failed".into();
                        for source in &mut s.sources {
                            if source.state != "ready" {
                                source.state = "failed".into();
                                source.error = Some(error.clone());
                            }
                        }
                    });
                    return;
                }
            };
            for (index, (name, language, initialize)) in SOURCES.iter().enumerate() {
                if status.snapshot().sources[index].state == "ready" {
                    continue;
                }
                status.update(&app, |s| {
                    s.current_source = Some((*name).into());
                    s.sources[index].state = "running".into();
                    s.sources[index].error = None;
                    s.sources[index].processed_rows = 0;
                });
                REPORTER.with(|cell| {
                    *cell.borrow_mut() = Some(Reporter {
                        status: status.clone(),
                        app: app.clone(),
                        index,
                        last: Instant::now() - Duration::from_secs(1),
                    })
                });
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    validate_source_receipt(&conn, name, language)?;
                    initialize(&conn)
                }))
                .unwrap_or_else(|_| Err("Dictionary initialization worker failed".into()));
                REPORTER.with(|cell| *cell.borrow_mut() = None);
                status.update(&app, |s| match result {
                    Ok(()) => s.sources[index].state = "ready".into(),
                    Err(error) => {
                        log::error!("dictionary init {name}: {error}");
                        s.sources[index].state = "failed".into();
                        s.sources[index].error = Some(error);
                    }
                });
            }
            status.update(&app, |s| {
                s.current_source = None;
                s.state = if s.sources.iter().all(|s| s.state == "ready") {
                    "ready"
                } else {
                    "failed"
                }
                .into();
            });
            let _ = app.emit("dictionary-ready", status.is_ready());
            if let Err(error) = super::english::run_migrate_english_lemmas(&conn) {
                log::error!("english lemma migration: {error}");
            }
        });
    if let Err(error) = result {
        status.update(&app, |s| {
            s.state = "failed".into();
            for source in &mut s.sources {
                if source.state != "ready" {
                    source.state = "failed".into();
                    source.error = Some(error.to_string());
                }
            }
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
    fn failure_retry_preserves_completed_sources_and_advances_run() {
        let status = DictionaryStatus::default();
        assert!(status.begin());
        {
            let mut snapshot = status.0.lock().unwrap();
            snapshot.state = "failed".into();
            snapshot.sources[0].state = "ready".into();
            snapshot.sources[1].state = "failed".into();
            snapshot.sources[1].error = Some("database busy".into());
        }
        assert!(status.language_ready("en"));
        assert!(status.language_failed("ja"));
        assert!(status.begin());
        assert_eq!(status.snapshot().run_id, 2);
        assert_eq!(status.snapshot().sources[0].state, "ready");
        assert!(!status.begin());
    }
}
