use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Clone, Debug)]
pub struct TagInfo {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

pub fn name_key(name: &str) -> Result<String, String> {
    let key = name.trim().to_lowercase();
    if key.is_empty() {
        return Err("tag name cannot be empty".into());
    }
    Ok(key)
}

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS file_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(file_id,tag_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS file_tags_tag ON file_tags(tag_id,file_id);
    CREATE TABLE IF NOT EXISTS legacy_tag_folders (
        folder_id INTEGER PRIMARY KEY,
        tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS file_tag_state (
        file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE
    ) STRICT;",
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn ensure_tag(conn: &Connection, name: &str) -> Result<i64, String> {
    let key = name_key(name)?;
    conn.execute(
        "INSERT OR IGNORE INTO tags(name,name_key,created_at) VALUES(?1,?2,?3)",
        params![name.trim(), key, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row("SELECT id FROM tags WHERE name_key=?1", [key], |r| r.get(0))
        .map_err(|e| e.to_string())
}

pub fn file_tags(conn: &Connection, file_id: i64) -> rusqlite::Result<Vec<TagInfo>> {
    let mut stmt = conn.prepare("SELECT t.id,t.name,t.created_at FROM tags t JOIN file_tags ft ON ft.tag_id=t.id WHERE ft.file_id=?1 ORDER BY t.name_key,t.id")?;
    let rows = stmt.query_map([file_id], |r| {
        Ok(TagInfo {
            id: r.get(0)?,
            name: r.get(1)?,
            created_at: r.get(2)?,
        })
    })?;
    rows.collect()
}

/// Caller owns the transaction: new names and associations must commit with the file.
pub fn replace_file_tags(
    conn: &Connection,
    file_id: i64,
    ids: &[i64],
    names: &[String],
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE id=?1)",
            [file_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("file not found".into());
    }
    let mut desired = ids.iter().copied().collect::<HashSet<_>>();
    for id in &desired {
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM tags WHERE id=?1)", [id], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err("tag not found".into());
        }
    }
    for name in names {
        desired.insert(ensure_tag(conn, name)?);
    }
    for tag in file_tags(conn, file_id).map_err(|e| e.to_string())? {
        if !desired.contains(&tag.id) {
            conn.execute(
                "DELETE FROM file_tags WHERE file_id=?1 AND tag_id=?2",
                params![file_id, tag.id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    for tag_id in desired {
        conn.execute(
            "INSERT OR IGNORE INTO file_tags(file_id,tag_id) VALUES(?1,?2)",
            params![file_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    // An explicitly empty selection must never be reclassified by legacy sync.
    conn.execute(
        "INSERT OR IGNORE INTO file_tag_state(file_id) VALUES(?1)",
        [file_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn transaction<T>(
    conn: &Connection,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("SAVEPOINT tag_operation")
        .map_err(|e| e.to_string())?;
    match action() {
        Ok(value) => {
            conn.execute_batch("RELEASE tag_operation")
                .map_err(|e| e.to_string())?;
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO tag_operation; RELEASE tag_operation");
            Err(error)
        }
    }
}

/// Also used after old backup restores and legacy cloud downloads. Per-source
/// markers preserve subsequent renames, deletions and explicitly empty edits.
pub fn migrate_legacy(conn: &Connection) -> Result<(), String> {
    transaction(conn, || {
        let folders: HashMap<i64, (String, Option<i64>)> = {
            let mut stmt = conn
                .prepare("SELECT id,name,parent_id FROM folders")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))
                .map_err(|e| e.to_string())?;
            rows.collect::<rusqlite::Result<_>>()
                .map_err(|e| e.to_string())?
        };
        for id in folders.keys() {
            let migrated: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM legacy_tag_folders WHERE folder_id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if migrated {
                continue;
            }
            let mut parts = Vec::new();
            let mut current = Some(*id);
            let mut visited = HashSet::new();
            while let Some(next) = current {
                if !visited.insert(next) {
                    return Err("cyclic legacy folder hierarchy".into());
                }
                let Some((name, parent)) = folders.get(&next) else {
                    break;
                };
                parts.push(name.trim().to_string());
                current = *parent;
            }
            parts.reverse();
            let tag_id = ensure_tag(conn, &parts.join(" / "))?;
            conn.execute(
                "INSERT INTO legacy_tag_folders(folder_id,tag_id) VALUES(?1,?2)",
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute("INSERT OR IGNORE INTO file_tags(file_id,tag_id)
            SELECT f.id,m.tag_id FROM files f JOIN legacy_tag_folders m ON m.folder_id=f.folder_id
            WHERE m.tag_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM file_tag_state s WHERE s.file_id=f.id)", []).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO file_tag_state(file_id) SELECT id FROM files",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO sync_runtime(key,value) VALUES('folder_tags_migrated','1') ON CONFLICT(key) DO UPDATE SET value='1'", []).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn list_tags(state: State<DbState>) -> Result<Vec<TagInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id,name,created_at FROM tags ORDER BY name_key,id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tag(state: State<DbState>, name: String) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    ensure_tag(&conn, &name)
}

pub fn rename(conn: &Connection, tag_id: i64, name: &str) -> Result<(), String> {
    let key = name_key(name)?;
    let other: Option<i64> = conn
        .query_row(
            "SELECT id FROM tags WHERE name_key=?1 AND id<>?2",
            params![key, tag_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if other.is_some() {
        return Err("tag name already exists".into());
    }
    if conn
        .execute(
            "UPDATE tags SET name=?1,name_key=?2 WHERE id=?3",
            params![name.trim(), key, tag_id],
        )
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("tag not found".into());
    }
    Ok(())
}

#[tauri::command]
pub fn rename_tag(state: State<DbState>, tag_id: i64, name: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    rename(&conn, tag_id, &name)
}

#[tauri::command]
pub fn delete_tag(state: State<DbState>, tag_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    transaction(&conn, || {
        conn.execute("DELETE FROM tags WHERE id=?1", [tag_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_file_tags(
    state: State<DbState>,
    file_id: i64,
    tag_ids: Vec<i64>,
    new_tag_names: Vec<String>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    transaction(&conn, || {
        replace_file_tags(&conn, file_id, &tag_ids, &new_tag_names)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{export, files, import};

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        (dir, conn)
    }
    fn file(conn: &Connection, language: &str, folder: Option<i64>) -> i64 {
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language,folder_id) VALUES('test','txt','text',lower(hex(randomblob(16))),1,?1,?2)",params![language,folder]).unwrap();
        conn.last_insert_rowid()
    }
    fn payload(ids: Vec<i64>, names: Vec<&str>, replace: Option<i64>) -> import::ImportPayload {
        serde_json::from_value(serde_json::json!({
            "name":"new.txt","file_type":"txt","content":"Hello world","content_hash":"new-hash","language":"en",
            "segments":[{"index":0,"en_text":"Hello world","zh_text":null,"start_time":null,"end_time":null}],
            "lemmas":[],"occurrences":[],"replace_file_id":replace,"tag_ids":ids,"new_tag_names":names
        })).unwrap()
    }

    #[test]
    fn and_filter_untagged_and_language_are_independent() {
        let (_dir, conn) = db();
        let first = file(&conn, "en", None);
        let second = file(&conn, "en", None);
        let third = file(&conn, "ja", None);
        let empty = file(&conn, "en", None);
        let a = ensure_tag(&conn, "Podcast").unwrap();
        let b = ensure_tag(&conn, "Study").unwrap();
        replace_file_tags(&conn, first, &[a, b], &[]).unwrap();
        replace_file_tags(&conn, second, &[a], &[]).unwrap();
        replace_file_tags(&conn, third, &[a, b], &[]).unwrap();
        let result = files::query_files(&conn, Some("en"), &[a, b, a], false).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, first);
        assert_eq!(result[0].tags.len(), 2);
        assert_eq!(
            files::query_files(&conn, None, &[a, b], false)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            files::query_files(&conn, Some("en"), &[], true).unwrap()[0].id,
            empty
        );
        assert!(files::query_files(&conn, None, &[999], false)
            .unwrap()
            .is_empty());
        assert_eq!(
            files::query_files(&conn, None, &[], false).unwrap().len(),
            4
        );
    }

    #[test]
    fn legacy_paths_empty_folders_and_duplicate_paths_convert_once() {
        let (dir, conn) = db();
        conn.execute_batch("INSERT INTO folders(id,name,parent_id,created_at) VALUES(1,'日语',NULL,1),(2,'播客',1,2),(3,'播客',1,3),(4,'空文件夹',NULL,4);").unwrap();
        let nested = file(&conn, "ja", Some(2));
        let duplicate = file(&conn, "en", Some(3));
        let root = file(&conn, "en", None);
        migrate_legacy(&conn).unwrap();
        let converted = file_tags(&conn, nested).unwrap();
        assert_eq!(converted.len(), 1);
        assert_eq!(converted[0].name, "日语 / 播客");
        assert_eq!(file_tags(&conn, duplicate).unwrap()[0].id, converted[0].id);
        assert!(file_tags(&conn, root).unwrap().is_empty());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
        rename(&conn, converted[0].id, "Podcast").unwrap();
        replace_file_tags(&conn, nested, &[], &[]).unwrap();
        conn.execute("DELETE FROM tags WHERE id=?1", [converted[0].id])
            .unwrap();
        migrate_legacy(&conn).unwrap();
        assert!(file_tags(&conn, nested).unwrap().is_empty());
        assert!(file_tags(&conn, duplicate).unwrap().is_empty());
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(file_tags(&conn, nested).unwrap().is_empty());
    }

    #[test]
    fn import_saves_names_atomically_and_failed_replacement_keeps_original() {
        let (_dir, conn) = db();
        let first = import::import_payload(
            &conn,
            payload(vec![], vec![" Podcast ", "podcast", "学习"], None),
        )
        .unwrap();
        assert_eq!(file_tags(&conn, first).unwrap().len(), 2);
        let tags_before = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
            .unwrap();
        // Creating one valid new name and then failing must roll back both
        // the replacement deletion and the newly inserted tag.
        assert!(import::import_payload(
            &conn,
            payload(vec![], vec!["Should roll back", " "], Some(first))
        )
        .is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM files WHERE id=?1", [first], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            tags_before
        );
        assert_eq!(file_tags(&conn, first).unwrap().len(), 2);
        assert!(import::import_payload(&conn, payload(vec![999], vec![], Some(first))).is_err());
        let tag = file_tags(&conn, first).unwrap()[0].id;
        let replaced =
            import::import_payload(&conn, payload(vec![tag], vec![], Some(first))).unwrap();
        assert_ne!(first, replaced);
        assert_eq!(file_tags(&conn, replaced).unwrap().len(), 1);
        let untagged = import::import_payload(&conn, payload(vec![], vec![], None)).unwrap();
        assert!(file_tags(&conn, untagged).unwrap().is_empty());
    }

    #[test]
    fn names_cannot_collide_and_delete_keeps_files_and_unused_tags() {
        let (_dir, conn) = db();
        let id = file(&conn, "en", None);
        let tag = ensure_tag(&conn, " Podcast ").unwrap();
        assert_eq!(ensure_tag(&conn, "PODCAST").unwrap(), tag);
        let other = ensure_tag(&conn, "Other").unwrap();
        assert!(rename(&conn, other, " podcast ").is_err());
        assert!(ensure_tag(&conn, " ").is_err());
        replace_file_tags(&conn, id, &[tag, tag], &[]).unwrap();
        conn.execute("DELETE FROM tags WHERE id=?1", [tag]).unwrap();
        assert!(file_tags(&conn, id).unwrap().is_empty());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM files", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(transaction(&conn, || replace_file_tags(
            &conn,
            id,
            &[999],
            &["Never created".into()]
        ))
        .is_err());
    }

    #[test]
    fn v8_round_trip_and_v7_restore_keep_classification_without_resurrection() {
        let (_dir, source) = db();
        source
            .execute(
                "INSERT INTO folders(id,name,parent_id,created_at) VALUES(1,'Legacy',NULL,1)",
                [],
            )
            .unwrap();
        let id = file(&source, "en", Some(1));
        migrate_legacy(&source).unwrap();
        replace_file_tags(&source, id, &[], &[]).unwrap();
        let mut backup = export::backup_payload(&source).unwrap();
        assert_eq!(backup.schema_version, 8);
        let (_dir2, target) = db();
        export::restore_backup(&target, &backup).unwrap();
        migrate_legacy(&target).unwrap();
        assert!(file_tags(&target, id).unwrap().is_empty());
        backup.schema_version = 7;
        backup.data.tags.clear();
        backup.data.file_tags.clear();
        backup.data.legacy_tag_folders.clear();
        backup.data.file_tag_state.clear();
        export::restore_backup(&target, &backup).unwrap();
        assert_eq!(file_tags(&target, id).unwrap()[0].name, "Legacy");
        migrate_legacy(&target).unwrap();
        assert_eq!(file_tags(&target, id).unwrap().len(), 1);
        let v8 = export::backup_payload(&target).unwrap();
        export::restore_backup(&source, &v8).unwrap();
        assert_eq!(file_tags(&source, id).unwrap()[0].name, "Legacy");
    }
}
