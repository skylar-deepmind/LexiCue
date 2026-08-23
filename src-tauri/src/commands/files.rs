use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct LearningProgress {
    pub total: i64,
    pub unprocessed: i64,
    pub learning: i64,
    pub known: i64,
    pub ignored: i64,
}

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
    pub word_progress: LearningProgress,
    pub phrase_progress: LearningProgress,
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
    query_files(&conn, language.as_deref(), folder_id).map_err(|e| e.to_string())
}

fn query_files(
    conn: &rusqlite::Connection,
    language: Option<&str>,
    folder_id: Option<i64>,
) -> Result<Vec<FileInfo>, rusqlite::Error> {
    let mut stmt = conn
        .prepare(
            "WITH selected_files AS (
                 SELECT * FROM files
                 WHERE (?1 IS NULL OR language = ?1)
                   AND ((?2 IS NULL AND folder_id IS NULL) OR folder_id = ?2)
             ),
             segment_stats AS (
                 SELECT s.file_id, COUNT(*) AS total
                 FROM segments s JOIN selected_files f ON f.id = s.file_id
                 GROUP BY s.file_id
             ),
             word_stats AS (
                 SELECT s.file_id,
                        COUNT(DISTINCT o.word_id) AS total,
                        COUNT(DISTINCT CASE WHEN w.status='unprocessed' THEN o.word_id END) AS unprocessed,
                        COUNT(DISTINCT CASE WHEN w.status='learning' THEN o.word_id END) AS learning,
                        COUNT(DISTINCT CASE WHEN w.status='known' THEN o.word_id END) AS known,
                        COUNT(DISTINCT CASE WHEN w.status='ignored' THEN o.word_id END) AS ignored
                 FROM segments s
                 JOIN selected_files f ON f.id = s.file_id
                 JOIN occurrences o ON o.segment_id = s.id
                 JOIN words w ON w.id = o.word_id
                 GROUP BY s.file_id
             ),
             phrase_stats AS (
                 SELECT s.file_id,
                        COUNT(DISTINCT po.phrase_id) AS total,
                        COUNT(DISTINCT CASE WHEN p.status='unprocessed' THEN po.phrase_id END) AS unprocessed,
                        COUNT(DISTINCT CASE WHEN p.status='learning' THEN po.phrase_id END) AS learning,
                        COUNT(DISTINCT CASE WHEN p.status='known' THEN po.phrase_id END) AS known,
                        COUNT(DISTINCT CASE WHEN p.status='ignored' THEN po.phrase_id END) AS ignored
                 FROM segments s
                 JOIN selected_files f ON f.id = s.file_id
                 JOIN phrase_occurrences po ON po.segment_id = s.id
                 JOIN phrases p ON p.id = po.phrase_id
                 GROUP BY s.file_id
             )
             SELECT f.id, f.name, f.type, f.imported_at, COALESCE(ss.total, 0), f.language,
                    a.file_id IS NOT NULL, a.completed_at, f.folder_id,
                    COALESCE(ws.total, 0), COALESCE(ws.unprocessed, 0), COALESCE(ws.learning, 0), COALESCE(ws.known, 0), COALESCE(ws.ignored, 0),
                    COALESCE(ps.total, 0), COALESCE(ps.unprocessed, 0), COALESCE(ps.learning, 0), COALESCE(ps.known, 0), COALESCE(ps.ignored, 0)
             FROM selected_files f
             LEFT JOIN segment_stats ss ON ss.file_id = f.id
             LEFT JOIN word_stats ws ON ws.file_id = f.id
             LEFT JOIN phrase_stats ps ON ps.file_id = f.id
             LEFT JOIN file_phrase_analysis a ON a.file_id = f.id
             ORDER BY f.imported_at DESC",
        )?;

    let rows = stmt.query_map(params![language, folder_id], |row| {
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
            word_progress: LearningProgress {
                total: row.get(9)?,
                unprocessed: row.get(10)?,
                learning: row.get(11)?,
                known: row.get(12)?,
                ignored: row.get(13)?,
            },
            phrase_progress: LearningProgress {
                total: row.get(14)?,
                unprocessed: row.get(15)?,
                learning: row.get(16)?,
                known: row.get(17)?,
                ignored: row.get(18)?,
            },
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

#[tauri::command]
pub fn get_file_info(state: State<DbState>, file_id: i64) -> Result<FileInfo, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_file_info(&conn, file_id).map_err(|e| e.to_string())
}

fn query_file_info(conn: &rusqlite::Connection, file_id: i64) -> Result<FileInfo, rusqlite::Error> {
    conn.query_row(
        "SELECT f.id, f.name, f.type, f.imported_at,
                (SELECT COUNT(*) FROM segments WHERE file_id = f.id), f.language,
                EXISTS(SELECT 1 FROM file_phrase_analysis a WHERE a.file_id = f.id),
                (SELECT completed_at FROM file_phrase_analysis a WHERE a.file_id = f.id), f.folder_id,
                (SELECT COUNT(DISTINCT o.word_id) FROM segments s JOIN occurrences o ON o.segment_id=s.id WHERE s.file_id=f.id),
                (SELECT COUNT(DISTINCT o.word_id) FROM segments s JOIN occurrences o ON o.segment_id=s.id JOIN words w ON w.id=o.word_id WHERE s.file_id=f.id AND w.status='unprocessed'),
                (SELECT COUNT(DISTINCT o.word_id) FROM segments s JOIN occurrences o ON o.segment_id=s.id JOIN words w ON w.id=o.word_id WHERE s.file_id=f.id AND w.status='learning'),
                (SELECT COUNT(DISTINCT o.word_id) FROM segments s JOIN occurrences o ON o.segment_id=s.id JOIN words w ON w.id=o.word_id WHERE s.file_id=f.id AND w.status='known'),
                (SELECT COUNT(DISTINCT o.word_id) FROM segments s JOIN occurrences o ON o.segment_id=s.id JOIN words w ON w.id=o.word_id WHERE s.file_id=f.id AND w.status='ignored'),
                (SELECT COUNT(DISTINCT po.phrase_id) FROM segments s JOIN phrase_occurrences po ON po.segment_id=s.id WHERE s.file_id=f.id),
                (SELECT COUNT(DISTINCT po.phrase_id) FROM segments s JOIN phrase_occurrences po ON po.segment_id=s.id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=f.id AND p.status='unprocessed'),
                (SELECT COUNT(DISTINCT po.phrase_id) FROM segments s JOIN phrase_occurrences po ON po.segment_id=s.id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=f.id AND p.status='learning'),
                (SELECT COUNT(DISTINCT po.phrase_id) FROM segments s JOIN phrase_occurrences po ON po.segment_id=s.id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=f.id AND p.status='known'),
                (SELECT COUNT(DISTINCT po.phrase_id) FROM segments s JOIN phrase_occurrences po ON po.segment_id=s.id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=f.id AND p.status='ignored')
         FROM files f WHERE f.id=?1",
        params![file_id],
        |row| Ok(FileInfo {
            id: row.get(0)?, name: row.get(1)?, file_type: row.get(2)?, imported_at: row.get(3)?,
            segment_count: row.get(4)?, language: row.get(5)?, phrase_analyzed: row.get::<_, i32>(6)? != 0,
            phrase_analysis_at: row.get(7)?, folder_id: row.get(8)?,
            word_progress: LearningProgress { total: row.get(9)?, unprocessed: row.get(10)?, learning: row.get(11)?, known: row.get(12)?, ignored: row.get(13)? },
            phrase_progress: LearningProgress { total: row.get(14)?, unprocessed: row.get(15)?, learning: row.get(16)?, known: row.get(17)?, ignored: row.get(18)? },
        }),
    )
}

#[tauri::command]
pub fn list_folders(
    state: State<DbState>,
    language: Option<String>,
) -> Result<Vec<FolderInfo>, String> {
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
        folder_stmt
            .execute(params![id])
            .map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::{query_file_info, query_files};
    use rusqlite::Connection;

    #[test]
    fn file_progress_is_unique_isolated_and_includes_hidden_occurrences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE files (id INTEGER PRIMARY KEY, name TEXT, type TEXT, imported_at INTEGER, language TEXT, folder_id INTEGER);
             CREATE TABLE segments (id INTEGER PRIMARY KEY, file_id INTEGER, index_num INTEGER);
             CREATE TABLE words (id INTEGER PRIMARY KEY, status TEXT);
             CREATE TABLE occurrences (id INTEGER PRIMARY KEY, word_id INTEGER, segment_id INTEGER, hidden INTEGER DEFAULT 0);
             CREATE TABLE phrases (id INTEGER PRIMARY KEY, status TEXT);
             CREATE TABLE phrase_occurrences (id INTEGER PRIMARY KEY, phrase_id INTEGER, segment_id INTEGER, hidden INTEGER DEFAULT 0);
             CREATE TABLE file_phrase_analysis (file_id INTEGER PRIMARY KEY, completed_at INTEGER);
             INSERT INTO files VALUES (1, 'one.txt', 'txt', 1, 'en', NULL), (2, 'two.txt', 'txt', 2, 'en', 9), (3, 'empty.txt', 'txt', 3, 'de', NULL);
             INSERT INTO segments VALUES (10, 1, 0), (11, 1, 1), (20, 2, 0);
             INSERT INTO words VALUES (1, 'unprocessed'), (2, 'learning'), (3, 'known'), (4, 'ignored'), (5, 'known');
             INSERT INTO occurrences VALUES (1, 1, 10, 0), (2, 1, 11, 0), (3, 2, 10, 1), (4, 3, 10, 0), (5, 4, 11, 0), (6, 5, 20, 0);
             INSERT INTO phrases VALUES (1, 'known'), (2, 'ignored');
             INSERT INTO phrase_occurrences VALUES (1, 1, 10, 1), (2, 1, 11, 0), (3, 2, 20, 0);
             INSERT INTO file_phrase_analysis VALUES (1, 99);",
        ).unwrap();

        let first = query_file_info(&conn, 1).unwrap();
        assert_eq!(first.segment_count, 2);
        assert_eq!(first.word_progress.total, 4);
        assert_eq!(
            (
                first.word_progress.unprocessed,
                first.word_progress.learning,
                first.word_progress.known,
                first.word_progress.ignored
            ),
            (1, 1, 1, 1)
        );
        assert_eq!(first.phrase_progress.total, 1);
        assert_eq!(first.phrase_progress.known, 1);
        assert!(first.phrase_analyzed);

        let second = query_file_info(&conn, 2).unwrap();
        assert_eq!(second.word_progress.total, 1);
        assert_eq!(second.phrase_progress.total, 1);
        assert_eq!(second.phrase_progress.ignored, 1);
        assert!(!second.phrase_analyzed);

        let root_english = query_files(&conn, Some("en"), None).unwrap();
        assert_eq!(root_english.len(), 1);
        assert_eq!(root_english[0].id, 1);
        assert_eq!(root_english[0].word_progress.total, 4);
        assert_eq!(root_english[0].phrase_progress.known, 1);

        let folder_english = query_files(&conn, Some("en"), Some(9)).unwrap();
        assert_eq!(folder_english.len(), 1);
        assert_eq!(folder_english[0].id, 2);
        assert_eq!(folder_english[0].word_progress.known, 1);

        let empty = query_files(&conn, Some("de"), None).unwrap();
        assert_eq!(empty.len(), 1);
        assert_eq!(empty[0].segment_count, 0);
        assert_eq!(empty[0].word_progress.total, 0);
        assert_eq!(empty[0].phrase_progress.total, 0);
    }
}
