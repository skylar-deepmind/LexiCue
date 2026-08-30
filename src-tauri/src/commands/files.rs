use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::{commands::export, db::DbState};

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
pub fn delete_file_start(state: State<DbState>, file_id: i64) -> Result<DeleteJobStatus, String> {
    let conn = state.conn.lock().map_err(|_| "local_delete_failed")?;
    let existing: Option<String> = conn
        .query_row(
            "SELECT job_id FROM sync_delete_jobs WHERE file_id=?1 AND phase NOT IN ('done','failed') ORDER BY created_at DESC LIMIT 1",
            [file_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "local_delete_failed")?;
    if let Some(job_id) = existing {
        return delete_job_status(&conn, &job_id);
    }
    let file_sync_id: String = conn
        .query_row(
            "SELECT sync_id FROM sync_entity_state WHERE table_name='files' AND local_id=?1",
            [file_id],
            |row| row.get(0),
        )
        .map_err(|_| "local_delete_failed")?;
    let total_segments: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM segments WHERE file_id=?1",
            [file_id],
            |row| row.get(0),
        )
        .map_err(|_| "local_delete_failed")?;
    let total_occurrences: i64 = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM occurrences o JOIN segments s ON s.id=o.segment_id WHERE s.file_id=?1) + (SELECT COUNT(*) FROM phrase_occurrences p JOIN segments s ON s.id=p.segment_id WHERE s.file_id=?1)",
            [file_id],
            |row| row.get(0),
        )
        .map_err(|_| "local_delete_failed")?;
    let total_bytes: i64 = conn
        .query_row(
            "SELECT COALESCE((SELECT length(content) FROM files WHERE id=?1),0) + COALESCE((SELECT SUM(length(en_text)+COALESCE(length(zh_text),0)) FROM segments WHERE file_id=?1),0)",
            [file_id],
            |row| row.get(0),
        )
        .map_err(|_| "local_delete_failed")?;
    write_delete_backup(&conn)?;
    let job_id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO sync_delete_jobs(job_id,file_id,file_sync_id,phase,total_segments,total_occurrences,total_bytes,created_at,updated_at) VALUES(?1,?2,?3,'queued',?4,?5,?6,?7,?7)",
        params![job_id, file_id, file_sync_id, total_segments, total_occurrences, total_bytes, now],
    )
    .map_err(|_| "local_delete_failed")?;
    let status = delete_job_status(&conn, &job_id)?;
    let worker_conn = state.conn.clone();
    let worker_job = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || run_delete_job(worker_conn, worker_job));
    Ok(status)
}

#[derive(Serialize, Clone)]
pub struct DeleteJobStatus {
    pub job_id: String,
    pub file_id: i64,
    pub phase: String,
    pub completed_items: i64,
    pub total_items: i64,
    pub completed_bytes: i64,
    pub total_bytes: i64,
    pub error_code: Option<String>,
}

#[tauri::command]
pub fn delete_file_status(
    state: State<DbState>,
    job_id: String,
) -> Result<DeleteJobStatus, String> {
    let conn = state.conn.lock().map_err(|_| "local_delete_failed")?;
    delete_job_status(&conn, &job_id)
}

fn delete_job_status(conn: &rusqlite::Connection, job_id: &str) -> Result<DeleteJobStatus, String> {
    conn.query_row(
        "SELECT job_id,file_id,phase,deleted_segments+deleted_occurrences,total_segments+total_occurrences,deleted_bytes,total_bytes,error_code FROM sync_delete_jobs WHERE job_id=?1",
        [job_id],
        |row| Ok(DeleteJobStatus {
            job_id: row.get(0)?, file_id: row.get(1)?, phase: row.get(2)?, completed_items: row.get(3)?, total_items: row.get(4)?, completed_bytes: row.get(5)?, total_bytes: row.get(6)?, error_code: row.get(7)?,
        }),
    )
    .map_err(|_| "local_delete_failed".to_string())
}

fn write_delete_backup(conn: &rusqlite::Connection) -> Result<(), String> {
    let backup = export::backup_payload(conn).map_err(|_| "local_backup_failed")?;
    let path = conn
        .path()
        .and_then(|value| {
            std::path::Path::new(value)
                .parent()
                .map(|dir| dir.join(format!("lexicue-before-delete-{}.json", now_ms())))
        })
        .ok_or("local_backup_failed")?;
    let bytes = serde_json::to_vec_pretty(&backup).map_err(|_| "local_backup_failed")?;
    std::fs::write(path, bytes).map_err(|_| "local_backup_failed".to_string())
}

fn run_delete_job(conn: Arc<Mutex<rusqlite::Connection>>, job_id: String) {
    loop {
        match delete_job_step(&conn, &job_id) {
            Ok(true) => continue,
            Ok(false) => break,
            Err(_) => {
                if let Ok(connection) = conn.lock() {
                    let _ = connection.execute("UPDATE sync_delete_jobs SET phase='failed',error_code='local_delete_failed',updated_at=?1 WHERE job_id=?2 AND phase NOT IN ('done','failed')", params![now_ms(), job_id]);
                }
                break;
            }
        }
    }
}

fn delete_job_step(conn: &Arc<Mutex<rusqlite::Connection>>, job_id: &str) -> Result<bool, String> {
    let connection = conn.lock().map_err(|_| "local_delete_failed")?;
    let job: (i64, String, String, i64, i64, i64, i64, i64, i64) = connection
        .query_row(
            "SELECT file_id,file_sync_id,phase,deleted_segments,deleted_occurrences,total_segments,total_occurrences,deleted_bytes,total_bytes FROM sync_delete_jobs WHERE job_id=?1",
            [job_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?)),
        )
        .map_err(|_| "local_delete_failed")?;
    let (
        file_id,
        file_sync_id,
        phase,
        deleted_segments,
        deleted_occurrences,
        total_segments,
        total_occurrences,
        _deleted_bytes,
        total_bytes,
    ): (i64, String, String, i64, i64, i64, i64, i64, i64) = job;
    if phase == "done" || phase == "failed" {
        return Ok(false);
    }
    let tx = connection
        .unchecked_transaction()
        .map_err(|_| "local_delete_failed")?;
    tx.execute("INSERT INTO sync_runtime(key,value) VALUES('applying','1') ON CONFLICT(key) DO UPDATE SET value='1'", [])
        .map_err(|_| "local_delete_failed")?;
    let result = (|| -> Result<bool, String> {
        if phase == "queued" || phase == "deleting_occurrences" {
            let occurrences = tx.execute(
                "DELETE FROM occurrences WHERE id IN (SELECT o.id FROM occurrences o JOIN segments s ON s.id=o.segment_id WHERE s.file_id=?1 LIMIT 500)",
                [file_id],
            ).map_err(|_| "local_delete_failed")? as i64;
            let phrase_occurrences = tx.execute(
                "DELETE FROM phrase_occurrences WHERE id IN (SELECT p.id FROM phrase_occurrences p JOIN segments s ON s.id=p.segment_id WHERE s.file_id=?1 LIMIT 500)",
                [file_id],
            ).map_err(|_| "local_delete_failed")? as i64;
            let deleted = deleted_occurrences + occurrences + phrase_occurrences;
            let next = if deleted >= total_occurrences {
                "deleting_segments"
            } else {
                "deleting_occurrences"
            };
            tx.execute("UPDATE sync_delete_jobs SET phase=?1,deleted_occurrences=?2,updated_at=?3 WHERE job_id=?4", params![next, deleted, now_ms(), job_id]).map_err(|_| "local_delete_failed")?;
            return Ok(true);
        }
        if phase == "deleting_segments" {
            let segment_bytes: i64 = tx.query_row(
                "SELECT COALESCE(SUM(length(en_text)+COALESCE(length(zh_text),0)),0) FROM (SELECT en_text,zh_text FROM segments WHERE file_id=?1 LIMIT 500)",
                [file_id],
                |row| row.get(0),
            ).map_err(|_| "local_delete_failed")?;
            let deleted = tx.execute(
                "DELETE FROM segments WHERE id IN (SELECT id FROM segments WHERE file_id=?1 LIMIT 500)",
                [file_id],
            ).map_err(|_| "local_delete_failed")? as i64;
            let total = deleted_segments + deleted;
            let next = if total >= total_segments {
                "finalizing"
            } else {
                "deleting_segments"
            };
            tx.execute("UPDATE sync_delete_jobs SET phase=?1,deleted_segments=?2,deleted_bytes=deleted_bytes+?3,updated_at=?4 WHERE job_id=?5", params![next, total, segment_bytes, now_ms(), job_id]).map_err(|_| "local_delete_failed")?;
            return Ok(true);
        }
        tx.execute("DELETE FROM sync_changes WHERE uploaded_at IS NULL AND ((table_name IN ('files','library_item') AND sync_id=?1) OR table_name='library_item' AND sync_id=?1)", [file_sync_id.as_str()]).map_err(|_| "local_delete_failed")?;
        tx.execute("DELETE FROM files WHERE id=?1", [file_id])
            .map_err(|_| "local_delete_failed")?;
        tx.execute("UPDATE sync_entity_state SET deleted_at=?1,updated_at=?1 WHERE table_name='files' AND local_id=?2", params![now_ms(), file_id]).map_err(|_| "local_delete_failed")?;
        tx.execute("INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) VALUES('library_item',?1,'delete',?2)", params![file_sync_id, now_ms()]).map_err(|_| "local_delete_failed")?;
        tx.execute("UPDATE sync_delete_jobs SET phase='done',deleted_bytes=?1,updated_at=?2 WHERE job_id=?3", params![total_bytes, now_ms(), job_id]).map_err(|_| "local_delete_failed")?;
        Ok(false)
    })();
    tx.execute("INSERT INTO sync_runtime(key,value) VALUES('applying','0') ON CONFLICT(key) DO UPDATE SET value='0'", [])
        .map_err(|_| "local_delete_failed")?;
    match result {
        Ok(value) => {
            tx.commit().map_err(|_| "local_delete_failed")?;
            Ok(value)
        }
        Err(error) => {
            let _ = tx.rollback();
            Err(error)
        }
    }
}

pub fn resume_pending_delete_jobs(conn: Arc<Mutex<rusqlite::Connection>>) {
    let jobs: Vec<String> = conn.lock().ok().and_then(|connection| {
        connection.prepare("SELECT job_id FROM sync_delete_jobs WHERE phase NOT IN ('done','failed') ORDER BY created_at").ok().and_then(|mut statement| statement.query_map([], |row| row.get(0)).ok().map(|rows| rows.filter_map(Result::ok).collect()))
    }).unwrap_or_default();
    for job_id in jobs {
        let worker_conn = conn.clone();
        tauri::async_runtime::spawn_blocking(move || run_delete_job(worker_conn, job_id));
    }
}

#[tauri::command]
pub fn delete_file(state: State<DbState>, file_id: i64) -> Result<DeleteJobStatus, String> {
    delete_file_start(state, file_id)
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
    use super::{query_file_info, query_files, run_delete_job};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

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

    #[test]
    fn background_delete_batches_cascade_and_emits_one_library_tombstone() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('large.txt','txt','content','hash',1,'en')", []).unwrap();
        let file_id = connection.last_insert_rowid();
        let file_sync_id: String = connection
            .query_row(
                "SELECT sync_id FROM sync_entity_state WHERE table_name='files' AND local_id=?1",
                [file_id],
                |row| row.get(0),
            )
            .unwrap();
        connection
            .execute("INSERT INTO words(language,lemma) VALUES('en','word')", [])
            .unwrap();
        let word_id = connection.last_insert_rowid();
        for index in 0..1200 {
            connection
                .execute(
                    "INSERT INTO segments(file_id,index_num,en_text) VALUES(?1,?2,?3)",
                    rusqlite::params![file_id, index, "text"],
                )
                .unwrap();
            let segment_id = connection.last_insert_rowid();
            connection.execute("INSERT INTO occurrences(word_id,segment_id,original_form,position) VALUES(?1,?2,'word',0)", rusqlite::params![word_id, segment_id]).unwrap();
        }
        let job_id = "delete-test";
        connection.execute("INSERT INTO sync_delete_jobs(job_id,file_id,file_sync_id,phase,total_segments,total_occurrences,total_bytes,created_at,updated_at) SELECT ?1,?2,?3,'queued',COUNT(*),(SELECT COUNT(*) FROM occurrences o JOIN segments s ON s.id=o.segment_id WHERE s.file_id=?2),0,1,1 FROM segments WHERE file_id=?2", rusqlite::params![job_id, file_id, file_sync_id]).unwrap();
        let shared = Arc::new(Mutex::new(connection));
        run_delete_job(shared.clone(), job_id.into());
        let connection = shared.lock().unwrap();
        let remaining: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM segments WHERE file_id=?1",
                [file_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
        let tombstones: i64 = connection.query_row("SELECT COUNT(*) FROM sync_changes WHERE table_name='library_item' AND sync_id=?1 AND operation='delete' AND uploaded_at IS NULL", [file_sync_id], |row| row.get(0)).unwrap();
        assert_eq!(tombstones, 1);
        let phase: String = connection
            .query_row(
                "SELECT phase FROM sync_delete_jobs WHERE job_id=?1",
                [job_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(phase, "done");
    }
}
