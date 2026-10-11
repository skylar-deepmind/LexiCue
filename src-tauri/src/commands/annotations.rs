//! Local annotation receipts make submit/undo retryable across a frontend restart.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{commands::frequency_baseline, db::DbState};

fn tables(kind: &str) -> Result<(&'static str, &'static str, &'static str, &'static str), String> {
    match kind {
        "word" => Ok(("words", "lemma", "reviews", "word_id")),
        "phrase" => Ok(("phrases", "text", "phrase_reviews", "phrase_id")),
        _ => Err("Invalid annotation kind".into()),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Caller owns the transaction, including the receipt when used by annotation.
pub fn save_status(
    conn: &Connection,
    kind: &str,
    id: i64,
    status: &str,
) -> Result<Option<i64>, String> {
    let (table, _, review, column) = tables(kind)?;
    if !matches!(status, "unprocessed" | "learning" | "known" | "ignored") {
        return Err("Invalid status".into());
    }
    let changed = conn
        .execute(
            &format!("UPDATE {table} SET status=?1 WHERE id=?2"),
            params![status, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("annotation_missing".into());
    }
    if kind == "word" {
        frequency_baseline::record_manual_status(conn, id, status).map_err(|e| e.to_string())?;
    }
    if status == "learning" {
        let due = now_ms();
        let inserted = conn.execute(&format!("INSERT OR IGNORE INTO {review} ({column},due_at,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review_at) VALUES (?1,?2,0,0,0,0,0,0,0,NULL)"), params![id, due]).map_err(|e| e.to_string())?;
        if inserted > 0 {
            return Ok(Some(due));
        }
    }
    Ok(None)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Baseline {
    language: String,
    tier: i64,
    pack_id: String,
    pack_version: String,
    verification: String,
    marked_at: i64,
    last_sampled_day: Option<String>,
}

fn baseline(conn: &Connection, kind: &str, id: i64) -> Result<Option<Baseline>, String> {
    if kind != "word" {
        return Ok(None);
    }
    conn.query_row("SELECT language,tier,pack_id,pack_version,verification,marked_at,last_sampled_day FROM frequency_baseline_marks WHERE word_id=?1", [id], |row| Ok(Baseline {
        language: row.get(0)?, tier: row.get(1)?, pack_id: row.get(2)?, pack_version: row.get(3)?,
        verification: row.get(4)?, marked_at: row.get(5)?, last_sampled_day: row.get(6)?,
    })).optional().map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
struct Action {
    kind: String,
    item_id: i64,
    term: String,
    language: String,
    before: String,
    after: String,
    baseline_before: Option<Baseline>,
    baseline_after: Option<Baseline>,
    created_review_due: Option<i64>,
}

fn identity(
    conn: &Connection,
    kind: &str,
    id: i64,
) -> Result<Option<(String, String, String)>, String> {
    let (table, term, _, _) = tables(kind)?;
    conn.query_row(
        &format!("SELECT {term},language,status FROM {table} WHERE id=?1"),
        [id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AnnotationIdentity {
    id: i64,
    term: String,
    language: String,
}

#[tauri::command]
pub fn annotation_identities(
    state: State<DbState>,
    kind: String,
    ids: Vec<i64>,
) -> Result<Vec<AnnotationIdentity>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for id in ids {
        if let Some((term, language, _)) = identity(&conn, &kind, id)? {
            result.push(AnnotationIdentity { id, term, language });
        }
    }
    Ok(result)
}

fn submit(
    conn: &Connection,
    operation_id: &str,
    kind: &str,
    item_id: i64,
    term: &str,
    language: &str,
    status: &str,
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let saved: Option<(String, bool)> = tx
        .query_row(
            "SELECT payload,undone FROM annotation_actions WHERE operation_id=?1",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((json, undone)) = saved {
        let action: Action = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        if undone
            || action.kind != kind
            || action.item_id != item_id
            || action.term != term
            || action.language != language
            || action.after != status
        {
            return Err("annotation_conflict".into());
        }
        return Ok(());
    }
    let (actual_term, actual_language, before) =
        identity(&tx, kind, item_id)?.ok_or("annotation_missing")?;
    if actual_term != term || actual_language != language {
        return Err("annotation_identity_changed".into());
    }
    let baseline_before = baseline(&tx, kind, item_id)?;
    let created_review_due = save_status(&tx, kind, item_id, status)?;
    let action = Action {
        kind: kind.into(),
        item_id,
        term: term.into(),
        language: language.into(),
        before,
        after: status.into(),
        baseline_before,
        baseline_after: baseline(&tx, kind, item_id)?,
        created_review_due,
    };
    tx.execute(
        "INSERT INTO annotation_actions(operation_id,payload,undone) VALUES (?1,?2,0)",
        params![
            operation_id,
            serde_json::to_string(&action).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn annotate_item(
    state: State<DbState>,
    operation_id: String,
    kind: String,
    item_id: i64,
    term: String,
    language: String,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    submit(
        &conn,
        &operation_id,
        &kind,
        item_id,
        &term,
        &language,
        &status,
    )
}

fn undo(conn: &Connection, operation_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let (json, undone): (String, bool) = tx
        .query_row(
            "SELECT payload,undone FROM annotation_actions WHERE operation_id=?1",
            [operation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if undone {
        return Ok(());
    }
    let action: Action = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let (term, language, status) =
        identity(&tx, &action.kind, action.item_id)?.ok_or("annotation_missing")?;
    if term != action.term || language != action.language {
        return Err("annotation_identity_changed".into());
    }
    if status != action.after
        || baseline(&tx, &action.kind, action.item_id)? != action.baseline_after
    {
        return Err("annotation_conflict".into());
    }
    let (table, _, review, column) = tables(&action.kind)?;
    tx.execute(
        &format!("UPDATE {table} SET status=?1 WHERE id=?2"),
        params![action.before, action.item_id],
    )
    .map_err(|e| e.to_string())?;
    if action.kind == "word" {
        tx.execute(
            "DELETE FROM frequency_baseline_marks WHERE word_id=?1",
            [action.item_id],
        )
        .map_err(|e| e.to_string())?;
        if let Some(mark) = action.baseline_before {
            tx.execute("INSERT INTO frequency_baseline_marks(word_id,language,tier,pack_id,pack_version,verification,marked_at,last_sampled_day) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![action.item_id, mark.language, mark.tier, mark.pack_id, mark.pack_version, mark.verification, mark.marked_at, mark.last_sampled_day]).map_err(|e| e.to_string())?;
        }
    }
    if let Some(due) = action.created_review_due {
        tx.execute(&format!("DELETE FROM {review} WHERE {column}=?1 AND due_at=?2 AND reps=0 AND lapses=0 AND state=0 AND last_review_at IS NULL"), params![action.item_id, due]).map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE annotation_actions SET undone=1 WHERE operation_id=?1",
        [operation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn undo_annotation(state: State<DbState>, operation_id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    undo(&conn, &operation_id)
}

/// Recovery queries the receipt, rather than guessing whether a rejected invoke committed.
#[tauri::command]
pub fn annotation_operation(
    state: State<DbState>,
    operation_id: String,
) -> Result<Option<bool>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT undone FROM annotation_actions WHERE operation_id=?1",
        [operation_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE words(id INTEGER PRIMARY KEY,lemma TEXT,language TEXT,status TEXT);
            CREATE TABLE phrases(id INTEGER PRIMARY KEY,text TEXT,language TEXT,status TEXT);
            CREATE TABLE frequency_baseline_marks(word_id INTEGER PRIMARY KEY,language TEXT,tier INTEGER,pack_id TEXT,pack_version TEXT,verification TEXT,marked_at INTEGER,last_sampled_day TEXT);
            CREATE TABLE reviews(word_id INTEGER PRIMARY KEY,due_at INTEGER,stability REAL,difficulty REAL,elapsed_days INTEGER,scheduled_days INTEGER,reps INTEGER,lapses INTEGER,state INTEGER,last_review_at INTEGER);
            CREATE TABLE phrase_reviews(phrase_id INTEGER PRIMARY KEY,due_at INTEGER,stability REAL,difficulty REAL,elapsed_days INTEGER,scheduled_days INTEGER,reps INTEGER,lapses INTEGER,state INTEGER,last_review_at INTEGER);
            CREATE TABLE annotation_actions(operation_id TEXT PRIMARY KEY,payload TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
            INSERT INTO words VALUES(1,'book','en','known'); INSERT INTO phrases VALUES(1,'look up','en','unprocessed');
            INSERT INTO frequency_baseline_marks VALUES(1,'en',1000,'pack','v1','pending',1,NULL);").unwrap();
        conn
    }
    #[test]
    fn retry_is_idempotent_and_undo_restores_baseline_and_removes_unused_card() {
        let conn = db();
        submit(&conn, "op", "word", 1, "book", "en", "learning").unwrap();
        submit(&conn, "op", "word", 1, "book", "en", "learning").unwrap();
        assert_eq!(
            baseline(&conn, "word", 1).unwrap().unwrap().verification,
            "corrected"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        undo(&conn, "op").unwrap();
        undo(&conn, "op").unwrap();
        assert_eq!(identity(&conn, "word", 1).unwrap().unwrap().2, "known");
        assert_eq!(
            baseline(&conn, "word", 1).unwrap().unwrap().verification,
            "pending"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn existing_or_reviewed_card_history_is_preserved() {
        let conn = db();
        conn.execute("INSERT INTO reviews VALUES(1,100,4,5,6,7,8,1,2,99)", [])
            .unwrap();
        submit(&conn, "op", "word", 1, "book", "en", "learning").unwrap();
        undo(&conn, "op").unwrap();
        assert_eq!(
            conn.query_row("SELECT reps FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            8
        );
        submit(&conn, "phrase", "phrase", 1, "look up", "en", "learning").unwrap();
        conn.execute("UPDATE phrase_reviews SET reps=1,last_review_at=5", [])
            .unwrap();
        undo(&conn, "phrase").unwrap();
        assert_eq!(
            conn.query_row("SELECT reps FROM phrase_reviews", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn deleted_baseline_mark_is_restored_and_external_changes_are_not_overwritten() {
        let conn = db();
        submit(&conn, "op", "word", 1, "book", "en", "ignored").unwrap();
        assert!(baseline(&conn, "word", 1).unwrap().is_none());
        undo(&conn, "op").unwrap();
        assert_eq!(
            baseline(&conn, "word", 1).unwrap().unwrap().verification,
            "pending"
        );
        submit(&conn, "next", "word", 1, "book", "en", "learning").unwrap();
        conn.execute("UPDATE words SET status='ignored'", [])
            .unwrap();
        assert_eq!(undo(&conn, "next").unwrap_err(), "annotation_conflict");
        assert_eq!(identity(&conn, "word", 1).unwrap().unwrap().2, "ignored");
    }
    #[test]
    fn failed_receipt_write_rolls_back_status_baseline_and_card() {
        let conn = db();
        conn.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON annotation_actions BEGIN SELECT RAISE(ABORT,'failure'); END;").unwrap();
        assert!(submit(&conn, "op", "word", 1, "book", "en", "learning").is_err());
        assert_eq!(identity(&conn, "word", 1).unwrap().unwrap().2, "known");
        assert_eq!(
            baseline(&conn, "word", 1).unwrap().unwrap().verification,
            "pending"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(submit(&conn, "wrong", "word", 1, "other", "en", "learning").is_err());
        assert!(submit(&conn, "gone", "phrase", 9, "gone", "en", "learning").is_err());
    }
}
