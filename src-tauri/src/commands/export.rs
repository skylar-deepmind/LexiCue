use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Deserialize)]
pub struct BackupPayload {
    pub schema_version: i32,
    pub exported_at: i64,
    pub app_version: String,
    pub data: BackupData,
}

#[derive(Serialize, Deserialize)]
pub struct BackupData {
    pub files: Vec<serde_json::Value>,
    #[serde(default)]
    pub folders: Vec<serde_json::Value>,
    pub segments: Vec<serde_json::Value>,
    pub words: Vec<serde_json::Value>,
    #[serde(default)]
    pub word_aliases: Vec<serde_json::Value>,
    pub occurrences: Vec<serde_json::Value>,
    pub reviews: Vec<serde_json::Value>,
    pub review_logs: Vec<serde_json::Value>,
    #[serde(default)]
    pub dictionary_entries: Vec<serde_json::Value>,
    #[serde(default)]
    pub dictionary_sources: Vec<serde_json::Value>,
    #[serde(default)]
    pub phrases: Vec<serde_json::Value>,
    #[serde(default)]
    pub phrase_occurrences: Vec<serde_json::Value>,
    #[serde(default)]
    pub phrase_reviews: Vec<serde_json::Value>,
    #[serde(default)]
    pub phrase_review_logs: Vec<serde_json::Value>,
    #[serde(default)]
    pub phrase_dictionary_entries: Vec<serde_json::Value>,
    #[serde(default)]
    pub file_phrase_analysis: Vec<serde_json::Value>,
}

fn query_all(conn: &rusqlite::Connection, table: &str) -> Result<Vec<serde_json::Value>, String> {
    let sql = format!("SELECT * FROM {}", table);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let col_names: Vec<String> = (0..stmt.column_count())
        .map(|i| stmt.column_name(i).unwrap_or("?").to_string())
        .collect();

    let rows = stmt
        .query_map([], |row| {
            let mut map = serde_json::Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let val: rusqlite::types::Value = row.get_unwrap(i);
                let json_val = match val {
                    rusqlite::types::Value::Null => serde_json::Value::Null,
                    rusqlite::types::Value::Integer(v) => serde_json::json!(v),
                    rusqlite::types::Value::Real(v) => serde_json::json!(v),
                    rusqlite::types::Value::Text(v) => serde_json::json!(v),
                    rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
                };
                map.insert(name.clone(), json_val);
            }
            Ok(serde_json::Value::Object(map))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

fn json_to_sql_value(val: &serde_json::Value) -> Box<dyn rusqlite::types::ToSql> {
    match val {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Bool(b) => Box::new(*b as i32),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(rusqlite::types::Null)
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        _ => Box::new(rusqlite::types::Null),
    }
}

fn insert_from_json(
    conn: &rusqlite::Connection,
    table: &str,
    rows: &[serde_json::Value],
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }

    let first = &rows[0];
    let obj = first.as_object().ok_or("invalid row format")?;
    let columns: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
    let placeholders: Vec<String> = columns
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 1))
        .collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table,
        columns.join(", "),
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    for row in rows {
        let obj = row.as_object().ok_or("invalid row format")?;
        let values: Vec<Box<dyn rusqlite::types::ToSql>> = columns
            .iter()
            .map(|col| json_to_sql_value(obj.get(*col).unwrap_or(&serde_json::Value::Null)))
            .collect();

        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        stmt.execute(params.as_slice()).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[tauri::command]
pub fn export_all(state: State<DbState>) -> Result<BackupPayload, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    backup_payload(&conn)
}

/// Builds the portable user-data payload used by manual export and by the
/// encrypted sync transport. Built-in dictionary tables are deliberately not
/// included because each app installation owns those resources.
pub fn backup_payload(conn: &rusqlite::Connection) -> Result<BackupPayload, String> {
    let files = query_all(conn, "files")?;
    let folders = query_all(conn, "folders")?;
    let segments = query_all(conn, "segments")?;
    let words = query_all(conn, "words")?;
    let word_aliases = query_all(conn, "word_aliases")?;
    let occurrences = query_all(conn, "occurrences")?;
    let reviews = query_all(conn, "reviews")?;
    let review_logs = query_all(conn, "review_logs")?;
    let dictionary_entries = query_all(conn, "dictionary_entries")?;
    let dictionary_sources = query_all(conn, "dictionary_sources")?;
    let phrases = query_all(conn, "phrases")?;
    let phrase_occurrences = query_all(conn, "phrase_occurrences")?;
    let phrase_reviews = query_all(conn, "phrase_reviews")?;
    let phrase_review_logs = query_all(conn, "phrase_review_logs")?;
    let phrase_dictionary_entries = query_all(conn, "phrase_dictionary_entries")?;
    let file_phrase_analysis = query_all(conn, "file_phrase_analysis")?;

    Ok(BackupPayload {
        schema_version: 7,
        exported_at: now_ms(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        data: BackupData {
            files,
            folders,
            segments,
            words,
            word_aliases,
            occurrences,
            reviews,
            review_logs,
            dictionary_entries,
            dictionary_sources,
            phrases,
            phrase_occurrences,
            phrase_reviews,
            phrase_review_logs,
            phrase_dictionary_entries,
            file_phrase_analysis,
        },
    })
}

#[tauri::command]
pub fn restore_all(state: State<DbState>, backup: BackupPayload) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    restore_backup(&conn, &backup)
}

/// Restores a portable backup into an existing database connection. Cloud
/// recovery uses this after making a local safety export; keeping it separate
/// from the Tauri command makes the destructive step testable and atomic.
pub fn restore_backup(conn: &rusqlite::Connection, backup: &BackupPayload) -> Result<(), String> {
    if backup.schema_version != 1
        && backup.schema_version != 2
        && backup.schema_version != 3
        && backup.schema_version != 4
        && backup.schema_version != 5
        && backup.schema_version != 6
        && backup.schema_version != 7
    {
        return Err(format!(
            "Unsupported backup schema version: {}",
            backup.schema_version
        ));
    }

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        conn.execute("DELETE FROM annotation_actions", []).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM phrase_review_logs", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM file_phrase_analysis", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM phrase_dictionary_entries", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM phrase_reviews", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM phrase_occurrences", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM phrases", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM review_logs", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM dictionary_entries", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM dictionary_sources", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM reviews", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM occurrences", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM word_aliases", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM segments", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM words", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM files", [])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM folders", [])
            .map_err(|e| e.to_string())?;

        insert_from_json(conn, "files", &backup.data.files)?;
        insert_from_json(conn, "folders", &backup.data.folders)?;
        insert_from_json(conn, "words", &backup.data.words)?;
        insert_from_json(conn, "word_aliases", &backup.data.word_aliases)?;
        insert_from_json(conn, "segments", &backup.data.segments)?;
        insert_from_json(conn, "occurrences", &backup.data.occurrences)?;
        insert_from_json(conn, "reviews", &backup.data.reviews)?;
        insert_from_json(conn, "review_logs", &backup.data.review_logs)?;
        insert_from_json(conn, "dictionary_entries", &backup.data.dictionary_entries)?;
        insert_from_json(conn, "dictionary_sources", &backup.data.dictionary_sources)?;
        insert_from_json(conn, "phrases", &backup.data.phrases)?;
        insert_from_json(conn, "phrase_occurrences", &backup.data.phrase_occurrences)?;
        insert_from_json(conn, "phrase_reviews", &backup.data.phrase_reviews)?;
        insert_from_json(conn, "phrase_review_logs", &backup.data.phrase_review_logs)?;
        insert_from_json(
            conn,
            "phrase_dictionary_entries",
            &backup.data.phrase_dictionary_entries,
        )?;
        insert_from_json(
            conn,
            "file_phrase_analysis",
            &backup.data.file_phrase_analysis,
        )?;

        let violations: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA foreign_key_check")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(format!(
                        "table={} rowid={} parent={} fkid={}",
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        if !violations.is_empty() {
            return Err(format!(
                "Foreign key integrity check failed:\n{}",
                violations.join("\n")
            ));
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[cfg(test)]
mod english_learning_tests {
    use super::*;

    #[test]
    fn backup_round_trip_keeps_context_meaning_and_other_senses() {
        let source_file = tempfile::NamedTempFile::new().unwrap();
        let source = crate::db::init_db(source_file.path()).unwrap();
        source.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('test.txt','txt','I picked it up.','hash',1,'en')", []).unwrap();
        let file_id = source.last_insert_rowid();
        source.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(?1,0,'I picked it up.')", [file_id]).unwrap();
        let segment_id = source.last_insert_rowid();
        source.execute("INSERT INTO words(language,lemma,word_kind) VALUES('en','enroll','common')", []).unwrap();
        let word_id = source.last_insert_rowid();
        source.execute("INSERT INTO occurrences(word_id,segment_id,original_form,position,meaning_zh,usage_zh,meaning_edited,analysis_model,analyzed_at) VALUES(?1,?2,'enrolled',0,'报名','过去式',1,'user',2)", rusqlite::params![word_id,segment_id]).unwrap();
        source.execute("INSERT INTO word_aliases(word_id,alias,alias_kind) VALUES(?1,'enrolled','surface')", [word_id]).unwrap();
        source.execute("INSERT INTO phrases(language,text,status) VALUES('en','pick up','learning')", []).unwrap();
        let phrase_id = source.last_insert_rowid();
        source.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,surface_text,token_positions_json,meaning_zh,usage_zh,meaning_edited) VALUES(?1,?2,1,'picked up','[1,3]','拾起','可分离短语动词',1)", rusqlite::params![phrase_id,segment_id]).unwrap();
        source.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited) VALUES('en','pick up','拾起','test-model',1,'[{\"meaning_zh\":\"学会\",\"example_en\":\"She picked it up quickly.\"}]',1)", []).unwrap();
        source.execute("INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version) VALUES(?1,'test-model',1,2)", [file_id]).unwrap();
        let backup = backup_payload(&source).unwrap();
        assert_eq!(backup.schema_version, 7);

        let target_file = tempfile::NamedTempFile::new().unwrap();
        let target = crate::db::init_db(target_file.path()).unwrap();
        restore_backup(&target, &backup).unwrap();
        let restored: (String,String,String,i64,i64) = target.query_row(
            "SELECT po.meaning_zh,po.token_positions_json,pde.other_senses_json,po.meaning_edited,fpa.pipeline_version FROM phrase_occurrences po JOIN phrase_dictionary_entries pde ON pde.text='pick up' JOIN file_phrase_analysis fpa ON fpa.file_id=(SELECT file_id FROM segments WHERE id=po.segment_id)",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
        ).unwrap();
        assert_eq!(restored.0, "拾起");
        assert_eq!(restored.1, "[1,3]");
        assert!(restored.2.contains("学会"));
        assert_eq!((restored.3,restored.4), (1,2));
        let restored_word: (String,String,String,i64) = target.query_row(
            "SELECT w.lemma,a.alias,o.meaning_zh,o.meaning_edited FROM words w JOIN word_aliases a ON a.word_id=w.id JOIN occurrences o ON o.word_id=w.id WHERE w.lemma='enroll'",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
        ).unwrap();
        assert_eq!(restored_word, ("enroll".into(),"enrolled".into(),"报名".into(),1));
    }
}
