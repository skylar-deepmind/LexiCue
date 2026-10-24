//! Explicit read-only access to retained legacy records. No analysis or review scheduling.
use crate::db::DbState;
use rusqlite::{params, types::ValueRef, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

fn spec(kind: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match kind {
        "files" => Ok(("files", "id", "name")),
        "words" => Ok(("words", "id", "lemma")),
        "phrases" => Ok(("phrases", "id", "text")),
        "reviews" => Ok(("reviews", "word_id", "word_id")),
        "phrase_reviews" => Ok(("phrase_reviews", "phrase_id", "phrase_id")),
        "review_logs" => Ok(("review_logs", "id", "word_id")),
        "phrase_review_logs" => Ok(("phrase_review_logs", "id", "phrase_id")),
        "frequency_baseline_profiles" => Ok(("frequency_baseline_profiles", "rowid", "language")),
        "frequency_baseline_marks" => Ok(("frequency_baseline_marks", "rowid", "language")),
        "frequency_baseline_daily_checks" => {
            Ok(("frequency_baseline_daily_checks", "rowid", "language"))
        }
        "file_phrase_analysis" => Ok(("file_phrase_analysis", "rowid", "model")),
        _ => Err("history_unknown_kind".into()),
    }
}
fn rows(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<Value>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names = statement
        .column_names()
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>();
    let result = statement
        .query_map(args, |row| {
            let mut object = serde_json::Map::new();
            for (index, name) in names.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => json!(v),
                    ValueRef::Real(v) => json!(v),
                    ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                    ValueRef::Blob(_) => Value::Null,
                };
                object.insert(name.clone(), value);
            }
            Ok(Value::Object(object))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}
#[derive(Serialize)]
pub struct HistoryPage {
    pub rows: Vec<Value>,
    pub more: bool,
}
pub fn list(
    conn: &Connection,
    kind: &str,
    query: &str,
    offset: i64,
) -> Result<HistoryPage, String> {
    let (table, key, title) = spec(kind)?;
    // Only whitelisted identifiers enter SQL. Search is literal, including % and _.
    let columns = if table == "files" {
        "id,name,type,language,imported_at"
    } else if key == "rowid" {
        "rowid AS legacy_rowid,*"
    } else {
        "*"
    };
    let mut found = rows(conn, &format!("SELECT {columns} FROM {table} WHERE instr(lower(CAST({title} AS TEXT)),lower(?1))>0 ORDER BY {key} DESC LIMIT 81 OFFSET ?2"), params![query, offset.max(0)])?;
    let more = found.len() > 80;
    found.truncate(80);
    Ok(HistoryPage { rows: found, more })
}
pub fn detail(conn: &Connection, kind: &str, id: i64) -> Result<Value, String> {
    let (table, key, _) = spec(kind)?;
    let record = rows(conn, &format!("SELECT * FROM {table} WHERE {key}=?1"), [id])?
        .into_iter()
        .next()
        .ok_or("history_missing")?;
    let mut result = json!({"record":record});
    if kind == "words" || kind == "phrases" {
        let (occurrences, fk, cache, term) = if kind == "words" {
            ("occurrences", "word_id", "dictionary_entries", "lemma")
        } else {
            (
                "phrase_occurrences",
                "phrase_id",
                "phrase_dictionary_entries",
                "text",
            )
        };
        result["contexts"] = json!(rows(conn, &format!("SELECT o.*,s.en_text,s.zh_text,s.index_num,f.name AS file_name FROM {occurrences} o LEFT JOIN segments s ON s.id=o.segment_id LEFT JOIN files f ON f.id=s.file_id WHERE o.{fk}=?1 ORDER BY o.id"),[id])?);
        result["explanations"] = json!(rows(
            conn,
            &format!("SELECT * FROM {cache} WHERE language=?1 AND {term}=?2"),
            params![
                record["language"].as_str().unwrap_or("en"),
                record[term].as_str().unwrap_or("")
            ]
        )?);
    }
    Ok(result)
}
#[tauri::command]
pub fn list_legacy_records(
    state: State<DbState>,
    kind: String,
    query: String,
    offset: i64,
) -> Result<HistoryPage, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    list(&conn, &kind, &query, offset)
}
#[tauri::command]
pub fn legacy_record_detail(state: State<DbState>, kind: String, id: i64) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    detail(&conn, &kind, id)
}
#[cfg(test)]
mod tests {
    #[test]
    fn read_only_history_keeps_all_languages_and_missing_contexts() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("history.db")).unwrap();
        c.execute("INSERT INTO words(language,lemma,status,definition) VALUES('ja','昔','learning','個人メモ')",[]).unwrap();
        assert_eq!(super::list(&c, "words", "昔", 0).unwrap().rows.len(), 1);
        assert_eq!(
            super::detail(&c, "words", 1).unwrap()["record"]["definition"],
            "個人メモ"
        );
        assert!(super::spec("words; DELETE FROM words").is_err());
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
