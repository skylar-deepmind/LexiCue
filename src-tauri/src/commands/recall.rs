//! Read-only catalog-proven form indexes and source context pages for re-encounters.
use super::saved::SavedRecord;
use crate::db::DbState;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

#[cfg(test)]
use super::dictionary_packs::relation_catalog_configured;
use super::dictionary_packs::relation_catalog_with_forms;
use super::longman::RelationCatalog;
use super::saved::archive_with_catalog;
use std::sync::Arc;

#[cfg(test)]
pub fn index(conn: &Connection) -> Result<Vec<String>, String> {
    Ok(archive_with_catalog(conn, relation_catalog_configured())?
        .expressions()
        .to_vec())
}

#[derive(Serialize)]
pub struct RecallCatalog {
    pub expressions: Vec<String>,
    pub case_exclusions: Vec<String>,
    pub literal_only: bool,
}

#[cfg(test)]
pub fn catalog(conn: &Connection) -> Result<RecallCatalog, String> {
    catalog_with_relations(conn, relation_catalog_configured())
}

fn catalog_with_relations(
    conn: &Connection,
    relations: Arc<RelationCatalog>,
) -> Result<RecallCatalog, String> {
    let archive = archive_with_catalog(conn, relations)?;
    Ok(RecallCatalog {
        expressions: archive.expressions().to_vec(),
        case_exclusions: archive.case_exclusions(),
        literal_only: archive.literal_only(),
    })
}

#[derive(Serialize)]
pub struct ContextPage {
    pub records: Vec<SavedRecord>,
    pub total: i64,
}

#[cfg(test)]
pub fn contexts(
    conn: &Connection,
    expression: &str,
    offset: i64,
    limit: i64,
) -> Result<ContextPage, String> {
    contexts_with_relations(
        conn,
        expression,
        offset,
        limit,
        relation_catalog_configured(),
    )
}

pub(super) fn contexts_with_relations(
    conn: &Connection,
    expression: &str,
    offset: i64,
    limit: i64,
    relations: Arc<RelationCatalog>,
) -> Result<ContextPage, String> {
    let archive = archive_with_catalog(conn, relations)?;
    let page = super::saved::context_page(conn, archive.resolve(expression), limit, offset)?;
    Ok(ContextPage {
        records: page.records,
        total: page.total as i64,
    })
}

#[tauri::command]
pub async fn saved_recall_index(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    state
        .read_prepared(
            "saved_recall_index",
            relation_catalog_with_forms,
            |conn, relations| {
                Ok(archive_with_catalog(conn, relations)?
                    .expressions()
                    .to_vec())
            },
        )
        .await
}

/// One batch carries source case reservations with the existing literal index.
/// No per-word IPC or user-data fields are needed; the old Vec command remains.
#[tauri::command]
pub async fn saved_recall_catalog(state: State<'_, DbState>) -> Result<RecallCatalog, String> {
    state
        .read_prepared(
            "saved_recall_catalog",
            relation_catalog_with_forms,
            catalog_with_relations,
        )
        .await
}

#[tauri::command]
pub async fn saved_recall_contexts(
    state: State<'_, DbState>,
    expression: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<ContextPage, String> {
    state
        .read_prepared(
            "saved_recall_contexts",
            relation_catalog_with_forms,
            move |conn, relations| {
                contexts_with_relations(
                    conn,
                    &expression,
                    offset.unwrap_or(0),
                    limit.unwrap_or(10),
                    relations,
                )
            },
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::super::saved::{self, Mutation, SaveInput};
    use super::*;
    use rusqlite::params;
    #[test]
    fn exact_recall_keeps_contexts_orders_known_times_and_filters_tombstones() {
        let _catalog = super::super::longman::test_relation_catalog(std::sync::Arc::new(
            super::super::longman::RelationCatalog::test_fixture(
                "hermetic-recall-case-v1",
                &[("take off", "take off"), ("takeoff", "takeoff")],
            ),
        ));
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
                        dictionary_snapshot: None,
                        dictionary_reference: None,
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
        let expressions = index(&c).unwrap();
        assert!(expressions.contains(&"take off".into()));
        assert!(expressions.contains(&"takeoff".into()));
        assert!(!expressions.contains(&"take".into()));
        assert!(!expressions.contains(&"taked off".into()));
        assert_eq!(contexts(&c, "TAKE \t OFF", 0, 1).unwrap().total, 0);
        let page = contexts(&c, "take \t off", 0, 1).unwrap();
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
