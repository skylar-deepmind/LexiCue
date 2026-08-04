use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct FileInfo {
    pub id: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub imported_at: i64,
    pub segment_count: i64,
    pub phrase_analyzed: bool,
    pub phrase_analysis_at: Option<i64>,
    pub language: String,
}

#[derive(Serialize)]
pub struct SegmentInfo {
    pub id: i64,
    pub index_num: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[tauri::command]
pub fn list_files(
    state: State<DbState>,
    language: Option<String>,
) -> Result<Vec<FileInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.name, f.type, f.imported_at, COUNT(s.id) AS segment_count,
                    f.language,
                    EXISTS(SELECT 1 FROM file_phrase_analysis a WHERE a.file_id = f.id) AS phrase_analyzed,
                    (SELECT completed_at FROM file_phrase_analysis a WHERE a.file_id = f.id) AS phrase_analysis_at
             FROM files f
             LEFT JOIN segments s ON s.file_id = f.id
             WHERE (?1 IS NULL OR f.language = ?1)
             GROUP BY f.id
             ORDER BY f.imported_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![language.as_deref()], |row| {
            Ok(FileInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                file_type: row.get(2)?,
                imported_at: row.get(3)?,
                segment_count: row.get(4)?,
                phrase_analyzed: row.get::<_, i32>(6)? != 0,
                language: row.get(5)?,
                phrase_analysis_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn delete_file(state: State<DbState>, file_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files WHERE id = ?1", params![file_id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_file_segments(state: State<DbState>, file_id: i64) -> Result<Vec<SegmentInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, index_num, en_text, zh_text, start_time, end_time
             FROM segments
             WHERE file_id = ?1
             ORDER BY index_num",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(SegmentInfo {
                id: row.get(0)?,
                index_num: row.get(1)?,
                en_text: row.get(2)?,
                zh_text: row.get(3)?,
                start_time: row.get(4)?,
                end_time: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
