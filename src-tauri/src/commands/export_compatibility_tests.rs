//! Controlled historical formats and real current importer payloads. Fixture
//! provenance/limits are recorded in fixtures/README.md; no user DB is opened.
use super::super::{document_source::ContentOrigin, materials, saved};
use super::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn canonical_row(table: &str, row: &Value) -> Value {
    let mut row = row.clone();
    if table == "saved_records" {
        row.as_object_mut().unwrap().remove("id");
    }
    for field in [
        "snapshot_json",
        "before_json",
        "request_json",
        "report_json",
        "local_value",
        "remote_value",
    ] {
        if let Some(raw) = row.get(field).and_then(Value::as_str) {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                row[field] = parsed;
            }
        }
    }
    row
}
fn canonical(data: &BackupData) -> Value {
    let mut data = serde_json::to_value(data).unwrap();
    for (table, rows) in data.as_object_mut().unwrap() {
        let rows = rows.as_array_mut().unwrap();
        for row in rows.iter_mut() {
            *row = canonical_row(table, row);
        }
        rows.sort_by_key(|row| serde_json::to_string(row).unwrap());
    }
    data
}
fn preserves_original_fields(original: &BackupData, restored: &BackupData, label: &str) {
    let before = serde_json::to_value(original).unwrap();
    let after = serde_json::to_value(restored).unwrap();
    for (table, rows) in before.as_object().unwrap() {
        let candidates: Vec<_> = after[table]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| canonical_row(table, r))
            .collect();
        for row in rows.as_array().unwrap() {
            let row = canonical_row(table, row);
            assert!(
                candidates.iter().any(|candidate| row
                    .as_object()
                    .unwrap()
                    .iter()
                    .all(|(key, value)| candidate.get(key) == Some(value))),
                "{label}: lost original {table} row {row}"
            );
        }
    }
}
fn two_hops(dir: &std::path::Path, input: &BackupPayload, label: &str) -> Connection {
    let first = crate::db::init_db(&dir.join(format!("{label}-first.db"))).unwrap();
    restore_backup(&first, input).unwrap_or_else(|e| panic!("{label}: first restore: {e}"));
    let output = backup_payload(&first).unwrap();
    preserves_original_fields(&input.data, &output.data, label);
    let second = crate::db::init_db(&dir.join(format!("{label}-second.db"))).unwrap();
    restore_backup(&second, &output).unwrap_or_else(|e| panic!("{label}: second restore: {e}"));
    assert_eq!(
        canonical(&output.data),
        canonical(&backup_payload(&second).unwrap().data),
        "{label}: second hop changed portable data"
    );
    // Replacement in an already populated DB must not duplicate snapshots or
    // lose receipts when SQLite assigns different local autoincrement IDs.
    restore_backup(&second, &output).unwrap();
    assert_eq!(
        canonical(&output.data),
        canonical(&backup_payload(&second).unwrap().data),
        "{label}: repeat restore changed portable data"
    );
    assert!(second.is_autocommit());
    second
}
fn assert_non_english_history(conn: &Connection, label: &str) {
    for (language, lemma) in [("ja", "昔"), ("de", "Wort")] {
        // History's third parameter is a literal title query, not a language filter.
        let page = super::super::history::list(conn, "words", lemma, 0).unwrap();
        assert_eq!(page.rows.len(), 1, "{label}: {language} history lookup");
        let row = &page.rows[0];
        assert_eq!(row["language"], language, "{label}: retained language");
        assert_eq!(row["definition"], format!("保留个人备注-{language}"));
        let detail =
            super::super::history::detail(conn, "words", row["id"].as_i64().unwrap()).unwrap();
        assert_eq!(detail["record"], *row);
        assert_eq!(
            detail["contexts"].as_array().unwrap().len(),
            1,
            "{label}: retained original context"
        );
        assert_eq!(
            detail["contexts"][0]["zh_text"],
            format!("保留原句-{language}")
        );
    }
}
fn historical() -> Vec<Value> {
    serde_json::from_str(include_str!("fixtures/historical_backups.json")).unwrap()
}

#[test]
fn schema_one_to_three_missing_optional_tables_and_per_row_defaults_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let base = historical().remove(0)["backup"].clone();
    for version in 1..=3 {
        // No v1..3 producer exists in the available Git history. Exercise the
        // public defaulting contract explicitly, with distinct input shapes.
        let mut raw = base.clone();
        raw["schema_version"] = json!(version);
        let allowed = match version {
            1 => vec![
                "files",
                "segments",
                "words",
                "occurrences",
                "reviews",
                "review_logs",
            ],
            2 => vec![
                "files",
                "segments",
                "words",
                "occurrences",
                "reviews",
                "review_logs",
                "dictionary_entries",
                "dictionary_sources",
            ],
            _ => vec![
                "files",
                "segments",
                "words",
                "occurrences",
                "reviews",
                "review_logs",
                "phrases",
                "phrase_occurrences",
                "phrase_reviews",
                "phrase_review_logs",
                "phrase_dictionary_entries",
                "file_phrase_analysis",
            ],
        };
        raw["data"]
            .as_object_mut()
            .unwrap()
            .retain(|key, _| allowed.contains(&key.as_str()));
        // Omit optional columns on one row, while retaining explicit Japanese
        // and German values on the later rows in the same arrays.
        for table in ["files", "words"] {
            raw["data"][table][0]
                .as_object_mut()
                .unwrap()
                .remove("language");
        }
        let input: BackupPayload = serde_json::from_value(raw).unwrap();
        let result = two_hops(dir.path(), &input, &format!("minimal-v{version}"));
        assert_eq!(
            result
                .query_row("SELECT language FROM files WHERE id=1", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "en"
        );
        assert_eq!(
            result
                .query_row("SELECT language FROM words WHERE id=2", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "ja"
        );
    }
}

#[test]
fn historical_schema_four_to_nine_preserves_notes_history_tags_and_old_tombstone_receipt() {
    let dir = tempfile::tempdir().unwrap();
    for fixture in historical() {
        let version = fixture["version"].as_i64().unwrap();
        let input: BackupPayload = serde_json::from_value(fixture["backup"].clone()).unwrap();
        let result = two_hops(dir.path(), &input, &format!("historical-v{version}"));
        assert_non_english_history(&result, &format!("v{version}"));
        assert_eq!(result.query_row("SELECT COUNT(*) FROM saved_records WHERE normalized_expression IN ('昔','wort')",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        if version == 9 {
            let deleted: saved::SavedRecord = serde_json::from_str(
                input.data.saved_records[1]["snapshot_json"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(
                saved::get(&result, &deleted.record_id).unwrap().unwrap(),
                deleted
            );
            assert!(deleted.deleted_at.is_some());
            let undone = saved::undo(&result, "old-remove").unwrap();
            assert!(undone.deleted_at.is_none());
            assert_eq!(undone.explanation.as_deref(), Some("旧保存备注-take off"));
            assert_eq!(undone.source, deleted.source);
            assert_eq!(undone.record_id, deleted.record_id);
            assert_eq!(undone.generation, deleted.generation + 1);
        }
    }
}

#[test]
fn tag_v045_schema_upgrade_keeps_pre_migration_copy_and_mixed_language_records() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tag-v045.db");
    let old = Connection::open(&path).unwrap();
    old.execute_batch(
        "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;",
    )
    .unwrap();
    old.execute_batch(include_str!("fixtures/v0_4_5_schema.sql"))
        .unwrap();
    let fixture = historical()
        .into_iter()
        .find(|v| v["version"] == 8)
        .unwrap();
    let input: BackupPayload = serde_json::from_value(fixture["backup"].clone()).unwrap();
    // These rows use the tag's columns, rather than a current database with
    // renamed version metadata. Keep the old connection open so WAL is real.
    let data = serde_json::to_value(&input.data).unwrap();
    for table in [
        "files",
        "folders",
        "tags",
        "file_tags",
        "legacy_tag_folders",
        "file_tag_state",
        "segments",
        "words",
        "word_aliases",
        "occurrences",
        "reviews",
        "review_logs",
        "dictionary_entries",
        "dictionary_sources",
        "phrases",
        "phrase_occurrences",
        "phrase_reviews",
        "phrase_review_logs",
        "phrase_dictionary_entries",
        "file_phrase_analysis",
    ] {
        let rows = data[table].as_array().unwrap();
        if rows.is_empty() {
            continue;
        }
        let exists: bool = old
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get(0),
            )
            .unwrap();
        assert!(exists, "unexpected post-tag table {table}");
        // The same per-row insert implementation validates actual old columns.
        super::insert_from_json(&old, table, rows).unwrap();
    }
    let upgraded = crate::db::init_db(&path).unwrap();
    let copies: Vec<_> = std::fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .collect();
    assert_eq!(copies.len(), 1);
    let before = Connection::open(copies[0].as_ref().unwrap().path()).unwrap();
    assert_eq!(before.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('saved_records','product_migrations','material_import_actions')",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    assert_eq!(
        before
            .query_row("SELECT COUNT(*) FROM words", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    let current = backup_payload(&upgraded).unwrap();
    preserves_original_fields(&input.data, &current.data, "tag upgrade");
    assert_eq!(current.data.saved_records.len(), 2);
    let result = two_hops(dir.path(), &current, "tag-upgraded");
    assert_non_english_history(&result, "tag upgrade");
    drop(upgraded);
    crate::db::init_db(&path).unwrap();
    assert_eq!(
        std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .count(),
        1,
        "confirmed migration must not create another backup"
    );
}

fn save(conn: &Connection, segment: i64, expression: &str, op: &str) -> saved::SavedRecord {
    let sentence: String = conn
        .query_row("SELECT en_text FROM segments WHERE id=?1", [segment], |r| {
            r.get(0)
        })
        .unwrap();
    let byte = sentence.find(expression).unwrap();
    let start = sentence[..byte].encode_utf16().count();
    saved::mutate(
        conn,
        op,
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: segment,
                expression: expression.into(),
                start_offset: start,
                end_offset: start + expression.encode_utf16().count(),
                explanation: Some("保留个人原句备注".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap()
    .record
}
fn youtube_input() -> materials::MaterialInput {
    use super::super::{
        import::SegmentInput,
        source_media,
        youtube::{self, downloads::SubtitleSource},
    };
    let content = "1\n00:00:01,000 --> 00:00:03,000\nHello world.\n";
    let track = youtube::SubtitleTrack {
        lang: "en".into(),
        is_auto: false,
        language: "en".into(),
        source: SubtitleSource::Manual,
        source_language: Some("en".into()),
    };
    let source = source_media::source_from_subtitles("abcdefghijk",&track,content,&json!({"title":"fixture","duration":8,"formats":[{"vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","format_id":"140","language":"en"}]})).unwrap();
    materials::MaterialInput {
        operation_id: "youtube-v10".into(),
        name: "fixture.srt".into(),
        content: content.into(),
        segments: vec![SegmentInput {
            index: 0,
            en_text: "Hello world.".into(),
            zh_text: Some("你好，世界。".into()),
            start_time: Some("00:00:01.000".into()),
            end_time: Some("00:00:03.000".into()),
        }],
        source: Some(source),
        document: None,
        normalized_kind: None,
    }
}

#[test]
fn schema_ten_to_twelve_imported_sources_missing_files_tombstones_conflicts_and_undo_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    for version in 10..=12 {
        let source =
            crate::db::init_db(&dir.path().join(format!("provenance-v{version}.db"))).unwrap();
        let mut input = if version == 10 {
            youtube_input()
        } else {
            super::super::document_source_tests::input("doc", "pdf")
        };
        if version == 12 {
            input = super::super::document_source_tests::input("clipboard", "clipboard");
            let document = input.document.as_mut().unwrap();
            document.schema_version = 2;
            document.origin = Some(ContentOrigin::Clipboard {
                title: document.display_name.clone(),
            });
            let mut web = super::super::document_source_tests::input("webpage", "webpage");
            let document = web.document.as_mut().unwrap();
            document.schema_version = 2;
            document.origin = Some(ContentOrigin::Webpage {
                title: document.display_name.clone(),
                submitted_url: "https://example.com/one".into(),
                final_url: "https://example.com/one".into(),
                fetched_at: 1793350000000,
            });
            materials::import_material(&source, &web).unwrap();
        }
        let material = materials::import_material(&source, &input).unwrap();
        let segment = materials::open(&source, material.file_id).unwrap().segments[0].id;
        let record = save(&source, segment, "Hello", "save-first");
        let active = save(&source, segment, "world", "save-active");
        let removed = saved::mutate(
            &source,
            "remove-first",
            &saved::Mutation::Remove {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
            },
        )
        .unwrap()
        .record;
        source.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) VALUES('saved_records',?1,?2,?3,123)",params![record.record_id,serde_json::to_string(&record).unwrap(),serde_json::to_string(&removed).unwrap()]).unwrap();
        // Remove only this source; keep complete portable snapshots and receipts.
        source
            .execute("DELETE FROM files WHERE id=?1", [material.file_id])
            .unwrap();
        assert!(saved::resolve_source(&source, &active.record_id)
            .unwrap()
            .is_none());
        let backup = backup_payload(&source).unwrap();
        assert_eq!(
            backup.schema_version, version,
            "version must come from actual nested provenance, not a manually changed number"
        );
        let result = two_hops(dir.path(), &backup, &format!("source-v{version}"));
        assert_eq!(
            saved::get(&result, &active.record_id).unwrap().unwrap(),
            active
        );
        assert_eq!(
            saved::get(&result, &removed.record_id).unwrap().unwrap(),
            removed
        );
        assert!(saved::resolve_source(&result, &active.record_id)
            .unwrap()
            .is_none());
        let undone = saved::undo(&result, "remove-first").unwrap();
        assert_eq!(undone.explanation, record.explanation);
        assert_eq!(undone.source, record.source);
        assert_eq!(undone.sentence, record.sentence);
        assert!(undone.deleted_at.is_none());
        let raw = serde_json::to_string(&backup).unwrap();
        assert!(!raw.contains("source-media/"));
        assert!(!raw.contains("manifest_json"));
    }
}
