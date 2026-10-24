//! Read-only indexes and exact-expression context pages for re-encounter hints.
use super::saved::{normalize, SavedRecord};
use crate::db::DbState;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

pub fn index(conn: &Connection) -> Result<Vec<String>, String> {
    let mut statement = conn.prepare("SELECT DISTINCT normalized_expression FROM saved_records WHERE deleted_at IS NULL ORDER BY normalized_expression").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ContextPage {
    pub records: Vec<SavedRecord>,
    pub total: i64,
}

pub fn contexts(
    conn: &Connection,
    expression: &str,
    offset: i64,
    limit: i64,
) -> Result<ContextPage, String> {
    let expression = normalize(expression);
    let total = conn.query_row("SELECT COUNT(*) FROM saved_records WHERE deleted_at IS NULL AND normalized_expression=?1", [&expression], |r| r.get(0)).map_err(|e| e.to_string())?;
    let mut statement=conn.prepare("SELECT snapshot_json FROM saved_records WHERE deleted_at IS NULL AND normalized_expression=?1 ORDER BY saved_at DESC,record_id LIMIT ?2 OFFSET ?3").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map(
            params![expression, limit.clamp(1, 50), offset.max(0)],
            |r| r.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?;
    let records = rows
        .map(|row| {
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect::<Result<_, String>>()?;
    Ok(ContextPage { records, total })
}

#[tauri::command]
pub async fn saved_recall_index(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        index(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn saved_recall_contexts(
    state: State<'_, DbState>,
    expression: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<ContextPage, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        contexts(&conn, &expression, offset.unwrap_or(0), limit.unwrap_or(10))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::super::saved::{self, Mutation, SaveInput};
    use super::*;
    #[test]
    fn exact_recall_keeps_contexts_orders_known_times_and_filters_tombstones() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("recall.db")).unwrap();
        c.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('old.srt','srt','source','hash',1,'en')",[]).unwrap();
        for (id, text) in [
            (1, "We take off now."),
            (2, "Please take off your coat."),
            (3, "Takeoff was smooth."),
        ] {
            c.execute(
                "INSERT INTO segments(id,file_id,index_num,en_text) VALUES(?1,1,?1,?2)",
                params![id, text],
            )
            .unwrap();
        }
        let save = |op: &str, segment, expression: &str, start, end| {
            saved::mutate(
                &c,
                op,
                &Mutation::Save {
                    input: SaveInput {
                        segment_id: segment,
                        expression: expression.into(),
                        start_offset: start,
                        end_offset: end,
                        explanation: Some(op.into()),
                        explanation_source: "personal".into(),
                    },
                },
            )
            .unwrap()
            .record
        };
        let mut older = save("old", 1, "take off", 3, 11);
        older.saved_at = None;
        saved::write_record(&c, &older).unwrap();
        let recent = save("recent", 2, "take off", 7, 15);
        save("other", 3, "Takeoff", 0, 7);
        assert_eq!(index(&c).unwrap(), vec!["take off", "takeoff"]);
        let page = contexts(&c, "TAKE \t OFF", 0, 1).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.records[0].record_id, recent.record_id);
        assert_eq!(
            contexts(&c, "take off", 1, 10).unwrap().records[0].saved_at,
            None
        );
        assert_eq!(contexts(&c, "take", 0, 10).unwrap().total, 0);
        let removed = saved::mutate(
            &c,
            "remove",
            &Mutation::Remove {
                record_id: recent.record_id.clone(),
                expected_revision: recent.revision,
            },
        )
        .unwrap();
        assert_eq!(contexts(&c, "take off", 0, 10).unwrap().total, 1);
        saved::undo(&c, &removed.operation_id).unwrap();
        c.execute("DELETE FROM files", []).unwrap();
        assert_eq!(contexts(&c, "take off", 0, 10).unwrap().total, 2);
        assert_eq!(
            contexts(&c, "take off", 0, 10).unwrap().records[0]
                .sentence
                .as_deref(),
            Some("Please take off your coat.")
        );
        for table in [
            "words",
            "phrases",
            "reviews",
            "phrase_reviews",
            "review_logs",
            "phrase_review_logs",
        ] {
            assert_eq!(
                c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
}
