use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct WordInfo {
    pub id: i64,
    pub lemma: String,
    pub status: String,
    pub definition: Option<String>,
    pub frequency: i64,
    pub language: String,
    pub reading: Option<String>,
    pub part_of_speech: Option<String>,
}

#[derive(Serialize)]
pub struct WordDetail {
    pub word: WordInfo,
    pub occurrences: Vec<OccurrenceDetail>,
}

#[derive(Serialize)]
pub struct FileWordToken {
    pub original_form: String,
    pub lemma: String,
    pub id: i64,
    pub status: String,
}

#[tauri::command]
pub fn list_file_word_tokens(
    state: State<DbState>,
    file_id: i64,
) -> Result<Vec<FileWordToken>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT o.original_form, w.lemma, w.id, w.status
         FROM occurrences o JOIN words w ON w.id = o.word_id
         JOIN segments s ON s.id = o.segment_id
         WHERE s.file_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(FileWordToken {
                original_form: row.get(0)?,
                lemma: row.get(1)?,
                id: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[derive(Serialize)]
pub struct SegmentToken {
    pub segment_index: i32,
    pub surface: String,
    pub lemma: String,
    pub position: i32,
}

#[tauri::command]
pub fn get_file_segment_tokens(
    state: State<DbState>,
    file_id: i64,
) -> Result<Vec<SegmentToken>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.index_num, o.original_form, w.lemma, o.position
             FROM occurrences o
             JOIN words w ON w.id = o.word_id
             JOIN segments s ON s.id = o.segment_id
             WHERE s.file_id = ?1
             ORDER BY s.index_num, o.position",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(SegmentToken {
                segment_index: row.get(0)?,
                surface: row.get(1)?,
                lemma: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[derive(Serialize)]
pub struct OccurrenceDetail {
    pub id: i64,
    pub original_form: String,
    pub position: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub file_name: String,
}

fn query_words(
    conn: &rusqlite::Connection,
    status_filter: Option<&str>,
    sort_by: Option<&str>,
    language: Option<&str>,
) -> Result<Vec<WordInfo>, rusqlite::Error> {
    let order_clause = match sort_by {
        Some("alpha") => "w.lemma ASC",
        Some("recent") => "w.id DESC",
        _ => "frequency DESC",
    };

    let mut rows: Vec<WordInfo> = Vec::new();

    match status_filter {
        Some(s) => {
            let sql = format!(
                "SELECT w.id, w.lemma, w.status, w.definition, COUNT(o.id) AS frequency,
                         w.language, w.reading, w.part_of_speech
                 FROM words w
                 LEFT JOIN occurrences o ON o.word_id = w.id
                 WHERE w.status = ?1 AND (?2 IS NULL OR w.language = ?2)
                 GROUP BY w.id
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![s, language], |row| {
                Ok(WordInfo {
                    id: row.get(0)?,
                    lemma: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    frequency: row.get(4)?,
                    language: row.get(5)?,
                    reading: row.get(6)?,
                    part_of_speech: row.get(7)?,
                })
            })?;
            for row in mapped {
                rows.push(row?);
            }
        }
        None => {
            let sql = format!(
                "SELECT w.id, w.lemma, w.status, w.definition, COUNT(o.id) AS frequency,
                         w.language, w.reading, w.part_of_speech
                 FROM words w
                 LEFT JOIN occurrences o ON o.word_id = w.id
                 WHERE (?1 IS NULL OR w.language = ?1)
                 GROUP BY w.id
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![language], |row| {
                Ok(WordInfo {
                    id: row.get(0)?,
                    lemma: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    frequency: row.get(4)?,
                    language: row.get(5)?,
                    reading: row.get(6)?,
                    part_of_speech: row.get(7)?,
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
pub fn list_words(
    state: State<DbState>,
    status_filter: Option<String>,
    sort_by: Option<String>,
    language: Option<String>,
) -> Result<Vec<WordInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_words(
        &conn,
        status_filter.as_deref(),
        sort_by.as_deref(),
        language.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn word_detail(state: State<DbState>, word_id: i64) -> Result<WordDetail, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let word = {
        let mut stmt = conn
            .prepare(
                "SELECT w.id, w.lemma, w.status, w.definition, COUNT(o.id) AS frequency,
                         w.language, w.reading, w.part_of_speech
                 FROM words w
                 LEFT JOIN occurrences o ON o.word_id = w.id
                 WHERE w.id = ?1
                 GROUP BY w.id",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![word_id], |row| {
            Ok(WordInfo {
                id: row.get(0)?,
                lemma: row.get(1)?,
                status: row.get(2)?,
                definition: row.get(3)?,
                frequency: row.get(4)?,
                language: row.get(5)?,
                reading: row.get(6)?,
                part_of_speech: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
    };

    let occurrences = {
        let mut stmt = conn
            .prepare(
                "SELECT o.id, o.original_form, o.position,
                        s.en_text, s.zh_text, s.start_time, s.end_time,
                        f.name AS file_name
                 FROM occurrences o
                 JOIN segments s ON s.id = o.segment_id
                 JOIN files f ON f.id = s.file_id
                 WHERE o.word_id = ?1
                 ORDER BY f.name, s.index_num",
            )
            .map_err(|e| e.to_string())?;

        let mapped = stmt
            .query_map(params![word_id], |row| {
                Ok(OccurrenceDetail {
                    id: row.get(0)?,
                    original_form: row.get(1)?,
                    position: row.get(2)?,
                    en_text: row.get(3)?,
                    zh_text: row.get(4)?,
                    start_time: row.get(5)?,
                    end_time: row.get(6)?,
                    file_name: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in mapped {
            result.push(row.map_err(|e| e.to_string())?);
        }
        result
    };

    Ok(WordDetail { word, occurrences })
}

#[tauri::command]
pub fn update_word_status(
    state: State<DbState>,
    word_id: i64,
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
        "UPDATE words SET status = ?1 WHERE id = ?2",
        params![status, word_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_word_definition(
    state: State<DbState>,
    word_id: i64,
    definition: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE words SET definition = ?1 WHERE id = ?2",
        params![definition, word_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn batch_update_status(
    state: State<DbState>,
    word_ids: Vec<i64>,
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

    for id in &word_ids {
        conn.execute(
            "UPDATE words SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
