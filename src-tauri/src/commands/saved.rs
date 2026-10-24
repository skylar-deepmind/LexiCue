//! Context snapshots are independent of files, vocabulary and review schedules.
//! All user mutations and their retry/undo receipts commit in one transaction.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::db::DbState;

pub const MIGRATION: &str = "saved-context-v1";

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn normalize(expression: &str) -> String {
    expression
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn identity(expression: &str, source_key: &str) -> String {
    let bytes = serde_json::to_vec(&(normalize(expression), source_key)).unwrap();
    format!("saved-{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedSource {
    pub content_hash: String,
    pub file_name: String,
    pub segment_index: i64,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedRecord {
    pub record_id: String,
    pub expression: String,
    pub normalized_expression: String,
    pub source_key: String,
    pub sentence: Option<String>,
    pub sentence_translation: Option<String>,
    pub source: Option<SavedSource>,
    pub explanation: Option<String>,
    pub explanation_source: String,
    pub origin: String,
    /// Preserves every old personal field, including English edits and notes.
    pub legacy: Option<serde_json::Value>,
    /// Unknown legacy save times stay unknown, rather than becoming migration time.
    pub saved_at: Option<i64>,
    pub updated_at: i64,
    pub revision: String,
    /// Only an explicit restore/undo advances this epoch. Delete wins over edits
    /// within an epoch, even if an offline device uploads its edit later.
    pub generation: i64,
    pub deleted_at: Option<i64>,
}

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id TEXT NOT NULL UNIQUE,
            normalized_expression TEXT NOT NULL,
            source_key TEXT NOT NULL,
            snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
            saved_at INTEGER,
            updated_at INTEGER NOT NULL,
            revision TEXT NOT NULL,
            generation INTEGER NOT NULL CHECK(generation>=0),
            deleted_at INTEGER,
            UNIQUE(normalized_expression,source_key)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS saved_active_sort ON saved_records(deleted_at,saved_at DESC,record_id);
        CREATE INDEX IF NOT EXISTS saved_expression ON saved_records(normalized_expression,deleted_at);
        CREATE TABLE IF NOT EXISTS saved_actions (
            operation_id TEXT PRIMARY KEY,
            request_json TEXT NOT NULL,
            record_id TEXT NOT NULL,
            before_json TEXT,
            after_revision TEXT NOT NULL,
            changed INTEGER NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE IF NOT EXISTS product_migrations (
            migration_key TEXT PRIMARY KEY,
            completed_at INTEGER NOT NULL,
            report_json TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS saved_sync_insert AFTER INSERT ON saved_records
        WHEN COALESCE((SELECT value FROM sync_runtime WHERE key='applying'),'0') <> '1' BEGIN
            INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at)
            VALUES('saved_records',NEW.id,NEW.record_id,NEW.updated_at,NEW.deleted_at)
            ON CONFLICT(table_name,sync_id) DO UPDATE SET local_id=excluded.local_id,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
            INSERT INTO sync_changes(table_name,sync_id,operation,changed_at)
            VALUES('saved_records',NEW.record_id,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,NEW.updated_at);
        END;
        CREATE TRIGGER IF NOT EXISTS saved_sync_update AFTER UPDATE ON saved_records
        WHEN COALESCE((SELECT value FROM sync_runtime WHERE key='applying'),'0') <> '1' BEGIN
            UPDATE sync_entity_state SET updated_at=NEW.updated_at,deleted_at=NEW.deleted_at WHERE table_name='saved_records' AND local_id=NEW.id;
            INSERT INTO sync_changes(table_name,sync_id,operation,changed_at)
            VALUES('saved_records',NEW.record_id,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,NEW.updated_at);
        END;",
    ).map_err(|e| e.to_string())
}

pub fn init(conn: &Connection) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    create_tables(&tx)?;
    migrate_legacy(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<SavedRecord>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM saved_records WHERE record_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()
}

/// Used by backup and the encrypted record protocol; no local FK crosses devices.
pub fn write_record(conn: &Connection, record: &SavedRecord) -> Result<i64, String> {
    if record.record_id != identity(&record.expression, &record.source_key)
        || record.normalized_expression != normalize(&record.expression)
        || record.generation < 0
        || !matches!(
            record.explanation_source.as_str(),
            "dictionary" | "ai" | "personal" | "unknown"
        )
    {
        return Err("invalid_saved_record".into());
    }
    conn.execute(
        "INSERT INTO saved_records(record_id,normalized_expression,source_key,snapshot_json,saved_at,updated_at,revision,generation,deleted_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(record_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at,revision=excluded.revision,generation=excluded.generation,deleted_at=excluded.deleted_at",
        params![record.record_id,record.normalized_expression,record.source_key,serde_json::to_string(record).map_err(|e|e.to_string())?,record.saved_at,record.updated_at,record.revision,record.generation,record.deleted_at],
    ).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id FROM saved_records WHERE record_id=?1",
        [&record.record_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct SaveInput {
    pub segment_id: i64,
    pub expression: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub explanation: Option<String>,
    pub explanation_source: String,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Mutation {
    Save {
        input: SaveInput,
    },
    Edit {
        record_id: String,
        expected_revision: String,
        explanation: String,
    },
    Remove {
        record_id: String,
        expected_revision: String,
    },
}

#[derive(Serialize)]
pub struct MutationResult {
    pub record: SavedRecord,
    pub changed: bool,
    pub operation_id: String,
}

fn from_input(conn: &Connection, input: &SaveInput) -> Result<SavedRecord, String> {
    let (sentence,translation,hash,name,index,start_time,end_time,language): (String,Option<String>,String,String,i64,Option<String>,Option<String>,String) = conn.query_row(
        "SELECT s.en_text,s.zh_text,f.content_hash,f.name,s.index_num,s.start_time,s.end_time,f.language FROM segments s JOIN files f ON f.id=s.file_id WHERE s.id=?1", [input.segment_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
    ).map_err(|_|"saved_source_missing".to_string())?;
    if language != "en" {
        return Err("saved_english_only".into());
    }
    let units: Vec<u16> = sentence.encode_utf16().collect();
    let selection = units
        .get(input.start_offset..input.end_offset)
        .and_then(|slice| String::from_utf16(slice).ok())
        .ok_or("saved_selection_invalid")?;
    let normalized = normalize(&input.expression);
    if normalized.is_empty()
        || normalized.len() > 1000
        || normalize(&selection) != normalized
        || !normalized.chars().any(|c| c.is_ascii_alphabetic())
        || !matches!(
            input.explanation_source.as_str(),
            "dictionary" | "ai" | "personal" | "unknown"
        )
    {
        return Err("saved_selection_invalid".into());
    }
    let start_offset = input.start_offset
        + selection
            .chars()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf16)
            .sum::<usize>();
    let end_offset = input.end_offset
        - selection
            .chars()
            .rev()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf16)
            .sum::<usize>();
    let source_key = serde_json::to_string(&(&hash, index, start_offset)).unwrap();
    Ok(SavedRecord {
        record_id: identity(&input.expression, &source_key),
        expression: input.expression.trim().into(),
        normalized_expression: normalized,
        source_key,
        sentence: Some(sentence),
        sentence_translation: translation,
        source: Some(SavedSource {
            content_hash: hash,
            file_name: name,
            segment_index: index,
            start_offset: Some(start_offset as i64),
            end_offset: Some(end_offset as i64),
            start_time,
            end_time,
        }),
        explanation: input.explanation.clone(),
        explanation_source: input.explanation_source.clone(),
        origin: "reader".into(),
        legacy: None,
        saved_at: Some(now_ms()),
        updated_at: now_ms(),
        revision: Uuid::new_v4().to_string(),
        generation: 0,
        deleted_at: None,
    })
}

pub fn mutate(
    conn: &Connection,
    operation_id: &str,
    mutation: &Mutation,
) -> Result<MutationResult, String> {
    if operation_id.is_empty() || operation_id.len() > 200 {
        return Err("saved_operation_invalid".into());
    }
    let request = serde_json::to_string(mutation).map_err(|e| e.to_string())?;
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let receipt: Option<(String, String, bool, bool)> = tx
        .query_row(
            "SELECT request_json,record_id,changed,undone FROM saved_actions WHERE operation_id=?1",
            [operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((previous, id, changed, undone)) = receipt {
        if previous != request || undone {
            return Err("saved_operation_conflict".into());
        }
        return Ok(MutationResult {
            record: get(&tx, &id)?.ok_or("saved_missing")?,
            changed,
            operation_id: operation_id.into(),
        });
    }
    let (before, mut record) = match mutation {
        Mutation::Save { input } => {
            let proposed = from_input(&tx, input)?;
            let before = get(&tx, &proposed.record_id)?;
            let mut record = before.clone().unwrap_or(proposed);
            if record.deleted_at.is_some() {
                record.deleted_at = None;
                record.generation += 1;
                record.revision = Uuid::new_v4().to_string();
                record.updated_at = now_ms();
            }
            (before, record)
        }
        Mutation::Edit {
            record_id,
            expected_revision,
            explanation,
        } => {
            let before = get(&tx, record_id)?.ok_or("saved_missing")?;
            if before.deleted_at.is_some() || before.revision != *expected_revision {
                return Err("saved_conflict".into());
            }
            let mut record = before.clone();
            record.explanation = Some(explanation.clone());
            record.explanation_source = "personal".into();
            (Some(before), record)
        }
        Mutation::Remove {
            record_id,
            expected_revision,
        } => {
            let before = get(&tx, record_id)?.ok_or("saved_missing")?;
            if before.revision != *expected_revision {
                return Err("saved_conflict".into());
            }
            let mut record = before.clone();
            if record.deleted_at.is_none() {
                record.deleted_at = Some(now_ms());
            }
            (Some(before), record)
        }
    };
    let changed = before.as_ref() != Some(&record);
    if changed {
        record.revision = Uuid::new_v4().to_string();
        record.updated_at = now_ms();
        write_record(&tx, &record)?;
    }
    tx.execute("INSERT INTO saved_actions(operation_id,request_json,record_id,before_json,after_revision,changed) VALUES(?1,?2,?3,?4,?5,?6)",
        params![operation_id,request,record.record_id,before.map(|v|serde_json::to_string(&v)).transpose().map_err(|e|e.to_string())?,record.revision,changed]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(MutationResult {
        record,
        changed,
        operation_id: operation_id.into(),
    })
}

pub fn undo(conn: &Connection, operation_id: &str) -> Result<SavedRecord, String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (id,before,revision,changed,undone): (String,Option<String>,String,bool,bool)=tx.query_row(
        "SELECT record_id,before_json,after_revision,changed,undone FROM saved_actions WHERE operation_id=?1",[operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).map_err(|_|"saved_operation_missing".to_string())?;
    let current = get(&tx, &id)?.ok_or("saved_missing")?;
    if undone || !changed {
        return Ok(current);
    }
    if current.revision != revision {
        return Err("saved_conflict".into());
    }
    let mut record = before
        .map(|v| serde_json::from_str::<SavedRecord>(&v))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| {
            let mut r = current.clone();
            r.deleted_at = Some(now_ms());
            r
        });
    record.generation =
        current.generation + i64::from(current.deleted_at.is_some() && record.deleted_at.is_none());
    record.revision = Uuid::new_v4().to_string();
    record.updated_at = now_ms();
    write_record(&tx, &record)?;
    tx.execute(
        "UPDATE saved_actions SET undone=1 WHERE operation_id=?1",
        [operation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(record)
}

#[derive(Default, Serialize, Deserialize)]
pub struct MigrationReport {
    pub eligible_words: usize,
    pub eligible_phrases: usize,
    pub saved_contexts: usize,
    pub missing_sources: usize,
    #[serde(default)]
    pub merged_duplicate_positions: usize,
    pub history_only: Vec<HistoryReason>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryReason {
    pub kind: String,
    pub legacy_id: i64,
    pub reason: String,
}

/// Caller owns the transaction. The marker and every snapshot commit together.
/// A repeat never overwrites a personal edit or resurrects a removed snapshot.
pub fn migrate_legacy(conn: &Connection) -> Result<MigrationReport, String> {
    if let Some(raw) = conn
        .query_row(
            "SELECT report_json FROM product_migrations WHERE migration_key=?1",
            [MIGRATION],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    let mut report = MigrationReport::default();
    for (kind, table, term, occ, fk) in [
        ("word", "words", "lemma", "occurrences", "word_id"),
        (
            "phrase",
            "phrases",
            "text",
            "phrase_occurrences",
            "phrase_id",
        ),
    ] {
        let extra = if kind == "phrase" {
            "OR i.source='manual' OR EXISTS(SELECT 1 FROM phrase_dictionary_entries d WHERE d.language='en' AND d.text=i.text AND (d.other_senses_edited=1 OR d.other_senses_en_edited=1))"
        } else {
            ""
        };
        let edited = if kind == "phrase" {
            "o.meaning_edited=1 OR o.meaning_en_edited=1"
        } else {
            "o.meaning_edited=1"
        };
        let sql=format!("SELECT i.id,i.{term},i.language,i.definition,(i.status='learning' OR i.definition IS NOT NULL {extra} OR EXISTS(SELECT 1 FROM {occ} o WHERE o.{fk}=i.id AND ({edited}))) FROM {table} i ORDER BY i.id");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let entries = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, bool>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for entry in entries {
            let (id, expression, language, definition, eligible) =
                entry.map_err(|e| e.to_string())?;
            if language != "en" || !eligible {
                report.history_only.push(HistoryReason {
                    kind: kind.into(),
                    legacy_id: id,
                    reason: if language != "en" {
                        "non_english"
                    } else {
                        "no_active_intent_evidence"
                    }
                    .into(),
                });
                continue;
            }
            if kind == "word" {
                report.eligible_words += 1;
            } else {
                report.eligible_phrases += 1;
            }
            let dictionary = if kind == "phrase" {
                legacy_row(
                    conn,
                    "phrase_dictionary_entries",
                    "text",
                    &expression,
                    Some("en"),
                )?
            } else {
                None
            };
            let contexts = legacy_contexts(conn, occ, fk, id)?;
            let contexts = if contexts.is_empty() {
                vec![None]
            } else {
                contexts.into_iter().map(Some).collect()
            };
            for context in contexts {
                let mut source = None;
                let mut sentence = None;
                let mut translation = None;
                let mut source_key = format!("legacy:{kind}:{}", normalize(&expression));
                if let Some(ref row) = context {
                    sentence = row
                        .get("en_text")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    translation = row
                        .get("zh_text")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    if let (Some(text), Some(hash), Some(name), Some(index)) = (
                        sentence.as_deref(),
                        row.get("content_hash").and_then(|v| v.as_str()),
                        row.get("file_name").and_then(|v| v.as_str()),
                        row.get("index_num").and_then(|v| v.as_i64()),
                    ) {
                        let position = row.get("position").and_then(|v| v.as_i64()).unwrap_or(-1);
                        let spans = super::english::tokenize_english_spans(text);
                        let span = spans.iter().find(|s| s.position as i64 == position);
                        let start = span.map(|s| s.start as i64);
                        source_key = if let Some(start) = start {
                            serde_json::to_string(&(hash, index, start)).unwrap()
                        } else {
                            serde_json::to_string(&(
                                hash,
                                index,
                                format!("legacy-position:{position}"),
                            ))
                            .unwrap()
                        };
                        source = Some(SavedSource {
                            content_hash: hash.into(),
                            file_name: name.into(),
                            segment_index: index,
                            start_offset: start,
                            end_offset: if kind == "word" {
                                span.map(|s| s.end as i64)
                            } else {
                                None
                            },
                            start_time: json_text(row, "start_time"),
                            end_time: json_text(row, "end_time"),
                        });
                    }
                }
                let meaning = context.as_ref().and_then(|r| json_text(r, "meaning_zh"));
                let edited = context
                    .as_ref()
                    .is_some_and(|r| r.get("meaning_edited").and_then(|v| v.as_i64()) == Some(1));
                let english_edit = context
                    .as_ref()
                    .filter(|r| r.get("meaning_en_edited").and_then(|v| v.as_i64()) == Some(1))
                    .and_then(|r| json_text(r, "meaning_en"));
                let (explanation, explanation_source) = if edited {
                    (meaning.clone(), "personal")
                } else if definition.is_some() {
                    (definition.clone(), "personal")
                } else if english_edit.is_some() {
                    (english_edit, "personal")
                } else if meaning.is_some() {
                    (meaning, "ai")
                } else {
                    (None, "unknown")
                };
                let record = SavedRecord {
                    record_id: identity(&expression, &source_key),
                    expression: expression.clone(),
                    normalized_expression: normalize(&expression),
                    source_key,
                    sentence,
                    sentence_translation: translation,
                    source,
                    explanation,
                    explanation_source: explanation_source.into(),
                    origin: "legacy".into(),
                    legacy: Some(
                        serde_json::json!({"kind":kind,"legacy_id":id,"definition":definition,"occurrence":context,"dictionary":dictionary}),
                    ),
                    saved_at: None,
                    updated_at: now_ms(),
                    revision: Uuid::new_v4().to_string(),
                    generation: 0,
                    deleted_at: None,
                };
                if record.source.is_none() {
                    report.missing_sources += 1;
                }
                if let Some(mut existing) = get(conn, &record.record_id)? {
                    // Legacy import/analysis could leave two occurrences at one
                    // position. Keep one saved identity and every old edit, even
                    // when the two personal explanations disagree.
                    if existing.origin == "legacy" {
                        if let Some(serde_json::Value::Object(ref mut metadata)) = existing.legacy {
                            metadata
                                .entry("same_position_records")
                                .or_insert_with(|| serde_json::json!([]))
                                .as_array_mut()
                                .ok_or("invalid_legacy_metadata")?
                                .push(record.legacy.clone().unwrap_or_default());
                        }
                        if existing.explanation_source != "personal"
                            && record.explanation_source == "personal"
                        {
                            existing.explanation = record.explanation;
                            existing.explanation_source = record.explanation_source;
                        }
                        write_record(conn, &existing)?;
                    }
                    report.merged_duplicate_positions += 1;
                } else {
                    write_record(conn, &record)?;
                    report.saved_contexts += 1;
                }
            }
        }
    }
    conn.execute(
        "INSERT INTO product_migrations(migration_key,completed_at,report_json) VALUES(?1,?2,?3)",
        params![
            MIGRATION,
            now_ms(),
            serde_json::to_string(&report).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(report)
}

fn json_text(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(str::to_string)
}
fn row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    let mut value = serde_json::Map::new();
    for i in 0..row.as_ref().column_count() {
        let v: rusqlite::types::Value = row.get(i)?;
        let v = match v {
            rusqlite::types::Value::Integer(v) => serde_json::json!(v),
            rusqlite::types::Value::Real(v) => serde_json::json!(v),
            rusqlite::types::Value::Text(v) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        };
        value.insert(row.as_ref().column_name(i)?.into(), v);
    }
    Ok(serde_json::Value::Object(value))
}
fn legacy_row(
    conn: &Connection,
    table: &str,
    key: &str,
    value: &str,
    language: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    conn.query_row(
        &format!("SELECT * FROM {table} WHERE {key}=?1 AND (?2 IS NULL OR language=?2)"),
        params![value, language],
        row_json,
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn legacy_contexts(
    conn: &Connection,
    table: &str,
    key: &str,
    id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt=conn.prepare(&format!("SELECT o.*,s.en_text,s.zh_text,s.index_num,s.start_time,s.end_time,f.name AS file_name,f.content_hash FROM {table} o LEFT JOIN segments s ON s.id=o.segment_id LEFT JOIN files f ON f.id=s.file_id WHERE o.{key}=?1 ORDER BY o.id")).map_err(|e|e.to_string())?;
    let rows = stmt.query_map([id], row_json).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

pub fn list(
    conn: &Connection,
    query: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SavedRecord>, String> {
    let pattern = format!(
        "%{}%",
        normalize(query)
            .replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_")
    );
    let mut stmt=conn.prepare("SELECT snapshot_json FROM saved_records WHERE deleted_at IS NULL AND (normalized_expression LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.explanation') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.sentence') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.source.file_name') LIKE ?1 ESCAPE '!') ORDER BY saved_at IS NULL,saved_at DESC,record_id LIMIT ?2 OFFSET ?3").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![pattern, limit.clamp(1, 1000), offset.max(0)], |r| {
            r.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn list_saved_records(
    state: State<DbState>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<SavedRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    list(
        &conn,
        &query.unwrap_or_default(),
        limit.unwrap_or(200),
        offset.unwrap_or(0),
    )
}
#[tauri::command]
pub fn mutate_saved_record(
    state: State<DbState>,
    operation_id: String,
    mutation: Mutation,
) -> Result<MutationResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    mutate(&conn, &operation_id, &mutation)
}
#[tauri::command]
pub fn undo_saved_mutation(
    state: State<DbState>,
    operation_id: String,
) -> Result<SavedRecord, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    undo(&conn, &operation_id)
}
#[derive(Serialize)]
pub struct SourceLocation {
    pub file_id: i64,
    pub segment_index: i64,
}
pub fn resolve_source(
    conn: &Connection,
    record_id: &str,
) -> Result<Option<SourceLocation>, String> {
    let record = get(conn, record_id)?.ok_or("saved_missing")?;
    let Some(source) = record.source else {
        return Ok(None);
    };
    conn.query_row("SELECT f.id,s.index_num FROM files f JOIN segments s ON s.file_id=f.id WHERE f.language='en' AND f.content_hash=?1 AND s.index_num=?2 AND s.en_text=?3 ORDER BY f.id LIMIT 1",params![source.content_hash,source.segment_index,record.sentence],|r|Ok(SourceLocation{file_id:r.get(0)?,segment_index:r.get(1)?})).optional().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn saved_record_source(
    state: State<DbState>,
    record_id: String,
) -> Result<Option<SourceLocation>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    resolve_source(&conn, &record_id)
}
#[tauri::command]
pub fn saved_migration_report(state: State<DbState>) -> Result<MigrationReport, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let raw: String = conn
        .query_row(
            "SELECT report_json FROM product_migrations WHERE migration_key=?1",
            [MIGRATION],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SavedConflict {
    pub id: i64,
    pub record_id: String,
    pub local: SavedRecord,
    pub remote: SavedRecord,
}
#[tauri::command]
pub fn saved_record_conflicts(state: State<DbState>) -> Result<Vec<SavedConflict>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT id,sync_id,local_value,remote_value FROM sync_conflicts WHERE table_name='saved_records' AND resolved_at IS NULL ORDER BY created_at DESC,id DESC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (id, record_id, left, right) = row.map_err(|e| e.to_string())?;
        Ok(SavedConflict {
            id,
            record_id,
            local: serde_json::from_str(&left).map_err(|e| e.to_string())?,
            remote: serde_json::from_str(&right).map_err(|e| e.to_string())?,
        })
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::export::{backup_payload, restore_backup, BackupPayload};

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        conn.execute_batch("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'flight.srt','srt','The plane will take off soon.','flight-hash',1);
            INSERT INTO segments(id,file_id,index_num,en_text,zh_text,start_time) VALUES(1,1,0,'The plane will take off soon.','飞机即将起飞。','00:00:01,000');
            INSERT INTO segments(id,file_id,index_num,en_text) VALUES(2,1,1,'We take off at noon.');").unwrap();
        (dir, conn)
    }
    fn input(segment: i64) -> Mutation {
        Mutation::Save {
            input: SaveInput {
                segment_id: segment,
                expression: "take off".into(),
                start_offset: if segment == 1 { 15 } else { 3 },
                end_offset: if segment == 1 { 23 } else { 11 },
                explanation: Some("起飞".into()),
                explanation_source: "dictionary".into(),
            },
        }
    }
    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }
    fn edit(conn: &Connection, record: &SavedRecord, text: &str) -> SavedRecord {
        mutate(
            conn,
            &Uuid::new_v4().to_string(),
            &Mutation::Edit {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
                explanation: text.into(),
            },
        )
        .unwrap()
        .record
    }
    fn remove(conn: &Connection, record: &SavedRecord) -> MutationResult {
        mutate(
            conn,
            &Uuid::new_v4().to_string(),
            &Mutation::Remove {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
            },
        )
        .unwrap()
    }

    #[test]
    fn ten_clicks_dedupe_context_but_new_sentence_is_distinct_and_no_review_is_created() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "first", &input(1)).unwrap();
        for n in 0..10 {
            let duplicate = mutate(&conn, &format!("duplicate-{n}"), &input(1)).unwrap();
            assert!(!duplicate.changed);
            undo(&conn, &duplicate.operation_id).unwrap();
        }
        assert_eq!(count(&conn, "saved_records"), 1);
        assert_eq!(list(&conn, "", 200, 0).unwrap().len(), 1);
        let next = mutate(&conn, "next", &input(2)).unwrap();
        assert_ne!(next.record.record_id, first.record.record_id);
        assert_eq!(
            next.record.sentence.as_deref(),
            Some("We take off at noon.")
        );
        for table in ["words", "phrases", "reviews", "phrase_reviews"] {
            assert_eq!(count(&conn, table), 0);
        }
    }

    #[test]
    fn save_retry_is_idempotent_and_undo_is_crash_safe() {
        let (dir, conn) = db();
        let first = mutate(&conn, "save", &input(1)).unwrap();
        let again = mutate(&conn, "save", &input(1)).unwrap();
        assert_eq!(first.record, again.record);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let undone = undo(&conn, "save").unwrap();
        assert!(undone.deleted_at.is_some());
        assert_eq!(undo(&conn, "save").unwrap(), undone);
        assert!(list(&conn, "", 200, 0).unwrap().is_empty());
        assert!(mutate(&conn, "save", &input(1)).is_err());
        let restored = mutate(&conn, "new-intent", &input(1)).unwrap();
        assert_eq!(restored.record.record_id, first.record.record_id);
        assert_eq!(restored.record.generation, 1);
    }

    #[test]
    fn whitespace_around_a_selection_does_not_create_a_second_source_position() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "first", &input(1)).unwrap();
        let mut spaced = input(1);
        if let Mutation::Save { input } = &mut spaced {
            input.expression = "  TAKE   OFF  ".into();
            input.start_offset = 14;
            input.end_offset = 24;
        }
        let duplicate = mutate(&conn, "spaced", &spaced).unwrap();
        assert_eq!(duplicate.record.record_id, first.record.record_id);
        assert!(!duplicate.changed);
        assert_eq!(count(&conn, "saved_records"), 1);
    }

    #[test]
    fn undo_remove_restores_exact_context_metadata_and_stale_actions_fail() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "save", &input(1)).unwrap().record;
        let personal = edit(&conn, &first, "我的个人解释");
        assert_eq!(undo(&conn, "save").unwrap_err(), "saved_conflict");
        let removed = remove(&conn, &personal);
        let restored = undo(&conn, &removed.operation_id).unwrap();
        let mut expected = personal.clone();
        expected.revision = restored.revision.clone();
        expected.updated_at = restored.updated_at;
        expected.generation = 1;
        assert_eq!(restored, expected);
        assert_eq!(count(&conn, "saved_records"), 1);
        assert!(mutate(
            &conn,
            "stale",
            &Mutation::Edit {
                record_id: first.record_id,
                expected_revision: first.revision,
                explanation: "old async answer".into()
            }
        )
        .is_err());
        assert_eq!(
            get(&conn, &restored.record_id)
                .unwrap()
                .unwrap()
                .explanation
                .as_deref(),
            Some("我的个人解释")
        );
    }

    #[test]
    fn receipt_failure_rolls_back_snapshot_and_sync_queue() {
        let (_dir, conn) = db();
        let before = count(&conn, "sync_changes");
        conn.execute_batch("CREATE TRIGGER fail_saved_receipt BEFORE INSERT ON saved_actions BEGIN SELECT RAISE(ABORT,'disk write failure'); END;").unwrap();
        assert!(mutate(&conn, "failed", &input(1)).is_err());
        assert_eq!(count(&conn, "saved_records"), 0);
        assert_eq!(count(&conn, "saved_actions"), 0);
        assert_eq!(count(&conn, "sync_changes"), before);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sync_entity_state WHERE table_name='saved_records'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn save_without_explanation_preserves_snapshot_after_source_deletion() {
        let (_dir, conn) = db();
        let mut mutation = input(1);
        if let Mutation::Save { input } = &mut mutation {
            input.explanation = None;
            input.explanation_source = "unknown".into();
        }
        let saved = mutate(&conn, "save", &mutation).unwrap().record;
        assert!(resolve_source(&conn, &saved.record_id).unwrap().is_some());
        conn.execute("DELETE FROM files WHERE id=1", []).unwrap();
        assert_eq!(get(&conn, &saved.record_id).unwrap().unwrap(), saved);
        assert!(resolve_source(&conn, &saved.record_id).unwrap().is_none());
        assert_eq!(list(&conn, "flight", 200, 0).unwrap().len(), 1);
        assert!(list(&conn, "%", 200, 0).unwrap().is_empty());
    }

    #[test]
    fn concurrent_connections_enforce_dedupe_in_database() {
        let (dir, conn) = db();
        drop(conn);
        let path = dir.path().join("test.db");
        let threads = (0..10)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let c = Connection::open(path).unwrap();
                    c.busy_timeout(std::time::Duration::from_secs(10)).unwrap();
                    mutate(&c, &format!("thread-{n}"), &input(1))
                        .unwrap()
                        .record
                        .record_id
                })
            })
            .collect::<Vec<_>>();
        let ids = threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(ids.len(), 1);
        let conn = Connection::open(path).unwrap();
        assert_eq!(count(&conn, "saved_records"), 1);
    }

    fn old_data(conn: &Connection) {
        conn.execute("DELETE FROM product_migrations", []).unwrap();
        conn.execute_batch("INSERT INTO words(id,lemma,status) VALUES(1,'take','learning'),(2,'plane','known'),(3,'soon','unprocessed');
            INSERT INTO words(id,lemma,status,definition) VALUES(4,'note','known','个人注释');
            INSERT INTO words(id,language,lemma,status,definition) VALUES(5,'ja','飛ぶ','learning','旧日语');
            INSERT INTO occurrences(word_id,segment_id,original_form,position,meaning_zh,analysis_model) VALUES(1,1,'take',3,'拿','ai'),(1,2,'take',1,'拿','ai'),(3,1,'soon',5,'很快','ai');
            INSERT INTO phrases(id,text,source) VALUES(1,'keep going','manual'),(2,'take off','detected'),(3,'make sense','detected');
            INSERT INTO phrase_occurrences(phrase_id,segment_id,position,meaning_zh,meaning_edited,meaning_en,meaning_en_edited,hidden,token_positions_json) VALUES(2,1,3,'我的起飞',1,'my meaning',1,1,'[3,4]');
            INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited) VALUES('en','make sense','','manual',1,'[{\"meaning_zh\":\"人工扩展义\",\"example_en\":\"It makes sense.\"}]',1);
            INSERT INTO reviews(word_id,due_at) VALUES(1,123);
            INSERT INTO review_logs(word_id,rating,reviewed_at) VALUES(1,3,123);").unwrap();
    }

    #[test]
    fn migration_keeps_every_context_edits_and_history_without_inventing_source_or_time() {
        let (_dir, conn) = db();
        old_data(&conn);
        init(&conn).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        assert_eq!(
            (
                report.eligible_words,
                report.eligible_phrases,
                report.saved_contexts,
                report.missing_sources
            ),
            (2, 3, 6, 3)
        );
        assert_eq!(report.history_only.len(), 3);
        let records = list(&conn, "", 200, 0).unwrap();
        assert!(records.iter().all(|r| r.saved_at.is_none()));
        assert_eq!(records.iter().filter(|r| r.expression == "take").count(), 2);
        let edited = records.iter().find(|r| r.expression == "take off").unwrap();
        assert_eq!(edited.explanation.as_deref(), Some("我的起飞"));
        assert_eq!(edited.explanation_source, "personal");
        let raw = edited.legacy.as_ref().unwrap();
        assert_eq!(raw["occurrence"]["meaning_en"], "my meaning");
        assert_eq!(raw["occurrence"]["hidden"], 1);
        let missing = records.iter().find(|r| r.expression == "note").unwrap();
        assert!(missing.sentence.is_none());
        assert!(missing.source.is_none());
        let removed = remove(&conn, edited);
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
        assert!(get(&conn, &removed.record.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some());
        assert_eq!(
            (
                count(&conn, "words"),
                count(&conn, "occurrences"),
                count(&conn, "reviews"),
                count(&conn, "review_logs")
            ),
            (5, 3, 1, 1)
        );
    }

    #[test]
    fn migration_interruption_rolls_back_records_marker_and_queue() {
        let (_dir, conn) = db();
        old_data(&conn);
        let before = count(&conn, "sync_changes");
        conn.execute_batch("CREATE TRIGGER fail_migration BEFORE INSERT ON product_migrations BEGIN SELECT RAISE(ABORT,'interrupted'); END;").unwrap();
        assert!(init(&conn).is_err());
        assert_eq!(count(&conn, "saved_records"), 0);
        assert_eq!(count(&conn, "product_migrations"), 0);
        assert_eq!(count(&conn, "sync_changes"), before);
        conn.execute("DROP TRIGGER fail_migration", []).unwrap();
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
    }

    #[test]
    fn duplicate_legacy_position_keeps_both_personal_versions_under_one_saved_identity() {
        let (_dir, conn) = db();
        old_data(&conn);
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,meaning_zh,meaning_edited) VALUES(2,1,3,'另一次个人解释',1)",[]).unwrap();
        init(&conn).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        assert_eq!(report.saved_contexts, 6);
        assert_eq!(report.merged_duplicate_positions, 1);
        let record = list(&conn, "take off", 200, 0).unwrap().pop().unwrap();
        let raw = serde_json::to_string(&record.legacy).unwrap();
        assert!(raw.contains("我的起飞"));
        assert!(raw.contains("另一次个人解释"));
    }

    #[test]
    fn backup_roundtrip_keeps_tombstones_identity_and_undo_receipts() {
        let (_dir, source) = db();
        source
            .execute("UPDATE files SET category='legacy-category' WHERE id=1", [])
            .unwrap();
        let record = mutate(&source, "save", &input(1)).unwrap().record;
        let personal = edit(&source, &record, "个人修正");
        source.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) VALUES('saved_records',?1,?2,?3,1)",params![record.record_id,serde_json::to_string(&record).unwrap(),serde_json::to_string(&personal).unwrap()]).unwrap();
        let removed = remove(&source, &personal);
        let backup = backup_payload(&source).unwrap();
        assert_eq!(backup.schema_version, 9);
        let (_dir2, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(
            target
                .query_row("SELECT category FROM files WHERE id=1", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "legacy-category"
        );
        assert_eq!(
            get(&target, &record.record_id).unwrap().unwrap(),
            removed.record
        );
        let versions:(String,String)=target.query_row("SELECT local_value,remote_value FROM sync_conflicts WHERE table_name='saved_records'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert!(versions.0.contains("起飞"));
        assert!(versions.1.contains("个人修正"));
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.explanation, personal.explanation);
        assert_eq!(restored.source, personal.source);
        assert_eq!(restored.saved_at, personal.saved_at);
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), 1);
    }

    #[test]
    fn old_backup_missing_new_fields_migrates_atomically_and_failed_restore_preserves_current_data()
    {
        let (_dir, source) = db();
        old_data(&source);
        source
            .execute("UPDATE words SET word_kind='proper_noun' WHERE id=4", [])
            .unwrap();
        let mut json = serde_json::to_value(backup_payload(&source).unwrap()).unwrap();
        json["schema_version"] = serde_json::json!(8);
        json["data"]["words"][0]
            .as_object_mut()
            .unwrap()
            .remove("word_kind");
        for name in [
            "saved_records",
            "saved_actions",
            "saved_conflicts",
            "annotation_actions",
            "product_migrations",
        ] {
            json["data"].as_object_mut().unwrap().remove(name);
        }
        let backup: BackupPayload = serde_json::from_value(json).unwrap();
        let (_dir2, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), 6);
        assert_eq!(
            target
                .query_row("SELECT word_kind FROM words WHERE id=4", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "proper_noun"
        );
        let before = backup_payload(&target).unwrap();
        let mut invalid = serde_json::to_value(&before).unwrap();
        invalid["data"]["saved_records"][0]["snapshot_json"] = serde_json::json!("{invalid");
        let invalid: BackupPayload = serde_json::from_value(invalid).unwrap();
        assert!(restore_backup(&target, &invalid).is_err());
        assert_eq!(
            serde_json::to_value(&before.data).unwrap(),
            serde_json::to_value(backup_payload(&target).unwrap().data).unwrap()
        );
    }

    #[test]
    fn upgrade_creates_consistent_backup_before_migration_and_backup_failure_stops_upgrade() {
        let (dir, conn) = db();
        old_data(&conn);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
        let backups = std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
        assert_eq!(count(&backup, "product_migrations"), 0);
        assert_eq!(count(&backup, "words"), 5);
        drop(conn);
        crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(
            std::fs::read_dir(dir.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
        let (faildir, c) = db();
        old_data(&c);
        drop(c);
        std::fs::write(faildir.path().join("backups"), "blocked").unwrap();
        assert!(crate::db::init_db(&faildir.path().join("test.db")).is_err());
        let c = Connection::open(faildir.path().join("test.db")).unwrap();
        assert_eq!(count(&c, "saved_records"), 0);
    }

    #[test]
    #[ignore = "requires an explicitly supplied temporary database copy"]
    fn audit_temporary_legacy_copy() {
        fn fingerprint(mut rows: Vec<serde_json::Value>, saved_rows: bool) -> String {
            if saved_rows {
                for row in &mut rows {
                    row.as_object_mut().unwrap().remove("id");
                }
            }
            let mut canonical = rows
                .iter()
                .map(|row| serde_json::to_string(row).unwrap())
                .collect::<Vec<_>>();
            canonical.sort();
            format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&canonical).unwrap())
            )
        }
        fn table_fingerprint(conn: &Connection, table: &str) -> String {
            let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
            let rows = stmt
                .query_map([], row_json)
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            fingerprint(rows, false)
        }
        let source = std::path::PathBuf::from(
            std::env::var("LEXICUE_V31_TEST_DB").expect("temporary copy path"),
        );
        let canonical = source.canonicalize().unwrap();
        assert!(
            canonical.starts_with("/private/tmp")
                || canonical.starts_with(std::env::temp_dir().canonicalize().unwrap())
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.db");
        std::fs::copy(&source, &path).unwrap();
        let before = Connection::open(&path).unwrap();
        let tables = [
            "files",
            "segments",
            "words",
            "occurrences",
            "phrases",
            "phrase_occurrences",
            "reviews",
            "review_logs",
            "phrase_reviews",
            "phrase_review_logs",
        ];
        let counts = tables.map(|t| count(&before, t));
        let originals = tables.map(|t| table_fingerprint(&before, t));
        drop(before);
        let started = std::time::Instant::now();
        let conn = crate::db::init_db(&path).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        println!("migration audit: words={}, phrases={}, saved={}, missing={}, merged={}, duration_ms={}",report.eligible_words,report.eligible_phrases,report.saved_contexts,report.missing_sources,report.merged_duplicate_positions,started.elapsed().as_millis());
        assert_eq!(tables.map(|t| count(&conn, t)), counts);
        for (table, expected) in tables.iter().zip(originals.iter()) {
            assert_eq!(
                &table_fingerprint(&conn, table),
                expected,
                "legacy data fingerprint changed: {table}"
            );
        }
        let saved = count(&conn, "saved_records");
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), saved);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
        let backup = backup_payload(&conn).unwrap();
        let target = crate::db::init_db(&dir.path().join("restore.db")).unwrap();
        let restore_started = std::time::Instant::now();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), saved);
        println!(
            "restore duration_ms={}",
            restore_started.elapsed().as_millis()
        );
        let original = serde_json::to_value(&backup.data).unwrap();
        let restored = serde_json::to_value(backup_payload(&target).unwrap().data).unwrap();
        for (table, rows) in original.as_object().unwrap() {
            // Saved integer row IDs are device-local; record_id is the stable
            // identity. Every user-visible field, receipt and legacy ID is exact.
            let expected = fingerprint(rows.as_array().unwrap().clone(), table == "saved_records");
            let actual = fingerprint(
                restored[table].as_array().unwrap().clone(),
                table == "saved_records",
            );
            assert_eq!(
                expected, actual,
                "restored data fingerprint changed: {table}"
            );
        }
        println!("verified saved={saved}; legacy table counts preserved={counts:?}");
    }
}
