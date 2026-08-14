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
    pub folder_id: Option<i64>,
}

#[derive(Serialize)]
pub struct FolderInfo {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub created_at: i64,
    pub file_count: i64,
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
    folder_id: Option<i64>,
) -> Result<Vec<FileInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.name, f.type, f.imported_at, COUNT(s.id) AS segment_count,
                    f.language,
                    EXISTS(SELECT 1 FROM file_phrase_analysis a WHERE a.file_id = f.id) AS phrase_analyzed,
                    (SELECT completed_at FROM file_phrase_analysis a WHERE a.file_id = f.id) AS phrase_analysis_at,
                    f.folder_id
             FROM files f
             LEFT JOIN segments s ON s.file_id = f.id
             WHERE (?1 IS NULL OR f.language = ?1)
               AND ((?2 IS NULL AND f.folder_id IS NULL) OR f.folder_id = ?2)
             GROUP BY f.id
             ORDER BY f.imported_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![language.as_deref(), folder_id], |row| {
            Ok(FileInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                file_type: row.get(2)?,
                imported_at: row.get(3)?,
                segment_count: row.get(4)?,
                phrase_analyzed: row.get::<_, i32>(6)? != 0,
                language: row.get(5)?,
                phrase_analysis_at: row.get(7)?,
                folder_id: row.get(8)?,
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
pub fn list_folders(state: State<DbState>, language: Option<String>) -> Result<Vec<FolderInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT fo.id, fo.name, fo.parent_id, fo.created_at, COUNT(f.id) AS file_count
             FROM folders fo
             LEFT JOIN files f ON f.folder_id = fo.id AND (?1 IS NULL OR f.language = ?1)
             GROUP BY fo.id
             ORDER BY fo.created_at, fo.id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![language.as_deref()], |row| {
            Ok(FolderInfo {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
                file_count: row.get(4)?,
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
pub fn create_folder(
    state: State<DbState>,
    name: String,
    parent_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".to_string());
    }
    conn.execute(
        "INSERT INTO folders (name, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![trimmed, parent_id, now_ms()],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn rename_folder(state: State<DbState>, folder_id: i64, name: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".to_string());
    }
    conn.execute(
        "UPDATE folders SET name = ?1 WHERE id = ?2",
        params![trimmed, folder_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn folder_subtree_ids(conn: &rusqlite::Connection, folder_id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE subtree(id) AS (
                 SELECT ?1
                 UNION ALL
                 SELECT fo.id FROM folders fo JOIN subtree s ON fo.parent_id = s.id
             )
             SELECT id FROM subtree",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![folder_id], |row| row.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| e.to_string())?);
    }
    Ok(ids)
}

#[tauri::command]
pub fn delete_folder(state: State<DbState>, folder_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let ids = folder_subtree_ids(&conn, folder_id)?;

    let mut file_stmt = conn
        .prepare("UPDATE files SET folder_id = NULL WHERE folder_id = ?1")
        .map_err(|e| e.to_string())?;
    for id in &ids {
        file_stmt.execute(params![id]).map_err(|e| e.to_string())?;
    }

    let mut folder_stmt = conn
        .prepare("DELETE FROM folders WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    for id in &ids {
        folder_stmt.execute(params![id]).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_folder(
    state: State<DbState>,
    folder_id: i64,
    target_parent_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    if let Some(target) = target_parent_id {
        if folder_id == target {
            return Err("cannot move a folder into itself".to_string());
        }
        let descendants = folder_subtree_ids(&conn, folder_id)?;
        if descendants.contains(&target) {
            return Err("cannot move a folder into its own descendant".to_string());
        }
    }

    conn.execute(
        "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
        params![target_parent_id, folder_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn move_file(
    state: State<DbState>,
    file_id: i64,
    folder_id: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE files SET folder_id = ?1 WHERE id = ?2",
        params![folder_id, file_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
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
