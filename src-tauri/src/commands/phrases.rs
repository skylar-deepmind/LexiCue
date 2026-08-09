use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::commands::chinese;
use crate::commands::language;

#[derive(Serialize)]
pub struct PhraseInfo {
    pub id: i64,
    pub text: String,
    pub status: String,
    pub definition: Option<String>,
    pub source: String,
    pub frequency: i64,
    pub language: String,
}

#[derive(Serialize)]
pub struct PhraseDetail {
    pub phrase: PhraseInfo,
    pub occurrences: Vec<PhraseOccurrenceDetail>,
}

#[derive(Serialize)]
pub struct PhraseOccurrenceDetail {
    pub id: i64,
    pub position: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub file_name: String,
}

fn query_phrases(
    conn: &rusqlite::Connection,
    status_filter: Option<&str>,
    sort_by: Option<&str>,
    language: Option<&str>,
) -> Result<Vec<PhraseInfo>, rusqlite::Error> {
    let order_clause = match sort_by {
        Some("alpha") => "p.text ASC",
        Some("recent") => "p.id DESC",
        _ => "frequency DESC",
    };

    let mut rows: Vec<PhraseInfo> = Vec::new();

    match status_filter {
        Some(s) => {
            let sql = format!(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language
                 FROM phrases p
                 LEFT JOIN phrase_occurrences po ON po.phrase_id = p.id
                 WHERE p.status = ?1 AND (?2 IS NULL OR p.language = ?2)
                 GROUP BY p.id
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![s, language], |row| {
                Ok(PhraseInfo {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    source: row.get(4)?,
                    frequency: row.get(5)?,
                    language: row.get(6)?,
                })
            })?;
            for row in mapped {
                rows.push(row?);
            }
        }
        None => {
            let sql = format!(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language
                 FROM phrases p
                 LEFT JOIN phrase_occurrences po ON po.phrase_id = p.id
                 WHERE (?1 IS NULL OR p.language = ?1)
                 GROUP BY p.id
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![language], |row| {
                Ok(PhraseInfo {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    source: row.get(4)?,
                    frequency: row.get(5)?,
                    language: row.get(6)?,
                })
            })?;
            for row in mapped {
                rows.push(row?);
            }
        }
    }

    Ok(rows)
}

#[tauri::command]
pub fn list_phrases(
    state: State<DbState>,
    status_filter: Option<String>,
    sort_by: Option<String>,
    language: Option<String>,
) -> Result<Vec<PhraseInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_phrases(
        &conn,
        status_filter.as_deref(),
        sort_by.as_deref(),
        language.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn phrase_detail(state: State<DbState>, phrase_id: i64) -> Result<PhraseDetail, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let phrase = {
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language
                 FROM phrases p
                 LEFT JOIN phrase_occurrences po ON po.phrase_id = p.id
                 WHERE p.id = ?1
                 GROUP BY p.id",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![phrase_id], |row| {
            Ok(PhraseInfo {
                id: row.get(0)?,
                text: row.get(1)?,
                status: row.get(2)?,
                definition: row.get(3)?,
                source: row.get(4)?,
                frequency: row.get(5)?,
                language: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
    };

    let occurrences = {
        let mut stmt = conn
            .prepare(
                "SELECT po.id, po.position,
                        s.en_text, s.zh_text, s.start_time, s.end_time,
                        f.name AS file_name
                 FROM phrase_occurrences po
                 JOIN segments s ON s.id = po.segment_id
                 JOIN files f ON f.id = s.file_id
                 WHERE po.phrase_id = ?1
                 ORDER BY f.name, s.index_num",
            )
            .map_err(|e| e.to_string())?;

        let mapped = stmt
            .query_map(params![phrase_id], |row| {
                Ok(PhraseOccurrenceDetail {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    en_text: row.get(2)?,
                    zh_text: row.get(3)?,
                    start_time: row.get(4)?,
                    end_time: row.get(5)?,
                    file_name: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in mapped {
            result.push(row.map_err(|e| e.to_string())?);
        }
        result
    };

    Ok(PhraseDetail {
        phrase,
        occurrences,
    })
}

#[tauri::command]
pub fn update_phrase_status(
    state: State<DbState>,
    phrase_id: i64,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let valid = matches!(
        status.as_str(),
        "unprocessed" | "learning" | "known" | "ignored"
    );
    if !valid {
        return Err(format!("Invalid status: {}", status));
    }

    conn.execute(
        "UPDATE phrases SET status = ?1 WHERE id = ?2",
        params![status, phrase_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_phrase_definition(
    state: State<DbState>,
    phrase_id: i64,
    definition: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE phrases SET definition = ?1 WHERE id = ?2",
        params![definition, phrase_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn batch_update_phrase_status(
    state: State<DbState>,
    phrase_ids: Vec<i64>,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let valid = matches!(
        status.as_str(),
        "unprocessed" | "learning" | "known" | "ignored"
    );
    if !valid {
        return Err(format!("Invalid status: {}", status));
    }

    for id in &phrase_ids {
        conn.execute(
            "UPDATE phrases SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_manual_phrase(
    state: State<DbState>,
    text: String,
    definition: Option<String>,
    language: Option<String>,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let trimmed = text.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    if trimmed.is_empty() {
        return Err("phrase text cannot be empty".to_string());
    }

    conn.execute(
        "INSERT OR IGNORE INTO phrases (language, text, status, definition, source) VALUES (?1, ?2, 'unprocessed', ?3, 'manual')",
        params![language, trimmed, definition],
    )
    .map_err(|e| e.to_string())?;

    let id: i64 = conn
        .query_row(
            "SELECT id FROM phrases WHERE language = ?1 AND text = ?2",
            params![language, trimmed],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(id)
}

#[derive(Serialize)]
pub struct SegmentPhrase {
    pub phrase_id: i64,
    pub text: String,
    pub status: String,
    pub definition: Option<String>,
    pub source: String,
    pub position: i32,
    pub segment_index: i32,
    pub word_count: i32,
}

#[tauri::command]
pub fn get_file_phrases(state: State<DbState>, file_id: i64) -> Result<Vec<SegmentPhrase>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.text, p.status, p.definition, p.source,
                    po.position, s.index_num, p.language,
                    LENGTH(p.text) - LENGTH(REPLACE(p.text, ' ', '')) + 1
             FROM phrase_occurrences po
             JOIN phrases p ON p.id = po.phrase_id
             JOIN segments s ON s.id = po.segment_id
             WHERE s.file_id = ?1
             ORDER BY s.index_num, po.position",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, i32>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i32>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (id, text, status, definition, source, position, segment_index, language, spaced_word_count) =
            row.map_err(|e| e.to_string())?;
        // Chinese and Japanese have no spaces, so the SQL word count is always
        // 1. Re-tokenize with the same tokenizer used during import so the
        // reading page can highlight the full phrase span.
        let word_count = if language == "zh" {
            chinese::tokenize_chinese_with_offsets(&text).len() as i32
        } else if language == "ja" {
            language::tokenize_japanese_with_offsets(&text).len() as i32
        } else {
            spaced_word_count
        };
        result.push(SegmentPhrase {
            phrase_id: id,
            text,
            status,
            definition,
            source,
            position,
            segment_index,
            word_count,
        });
    }

    Ok(result)
}
