//! Isolated integration checks. Controlled inputs here are not corpus quality
//! references and do not stand in for the real WKWebView extraction route.
use super::{document_source::*, export, import::SegmentInput, materials, saved};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub(crate) fn input(op: &str, format: &str) -> materials::MaterialInput {
    let content = "Hello 😀 world. We should not lose 42.";
    let original = if format == "clipboard" {
        digest(content)
    } else if format == "webpage" {
        digest(&format!(
            "https://example.com/one\nhttps://example.com/one\n{content}"
        ))
    } else {
        digest(&format!("controlled-original-{format}"))
    };
    let selection = DocumentSelection::All;
    let page = if format == "pdf" { Some(1) } else { None };
    let timed = matches!(format, "srt" | "vtt");
    let source = DocumentSource {
        origin: None,
        schema_version: 1,
        original_format: format.into(),
        display_name: format!("lesson.{format}"),
        source_sha256: original.clone(),
        extractor_version: "controlled-test-v1".into(),
        normalized_sha256: digest(content),
        offset_unit: "utf16".into(),
        extraction_status: "complete".into(),
        warnings: vec![],
        sections: vec![DocumentSection {
            id: "section-1".into(),
            title: "First chapter".into(),
            page,
            spine_id: None,
        }],
        blocks: vec![DocumentBlock {
            id: "block-1".into(),
            section_id: "section-1".into(),
            kind: "paragraph".into(),
            text: content.into(),
            locations: vec![DocumentLocation {
                section_id: "section-1".into(),
                paragraph: 1,
                page,
                spine_id: None,
                cue_id: timed.then(|| "cue-1".into()),
                start_ms: timed.then_some(1000),
                end_ms: timed.then_some(4000),
            }],
            start_utf16: 0,
            end_utf16: content.encode_utf16().count(),
            segment_indices: vec![0],
        }],
        selection,
        identity: digest(&format!("{original}\n{format}\n{{\"kind\":\"all\"}}")),
    };
    materials::MaterialInput {
        operation_id: op.into(),
        name: source.display_name.clone(),
        content: content.into(),
        segments: vec![SegmentInput {
            index: 0,
            en_text: content.into(),
            zh_text: None,
            start_time: timed.then(|| "00:00:01.000".into()),
            end_time: timed.then(|| "00:00:04.000".into()),
        }],
        source: None,
        document: Some(source),
        normalized_kind: Some(if timed { "srt" } else { "txt" }.into()),
    }
}
fn db() -> (tempfile::TempDir, Connection) {
    let d = tempfile::tempdir().unwrap();
    let c = crate::db::init_db(&d.path().join("source.db")).unwrap();
    (d, c)
}
fn save(c: &Connection, segment: i64, expression: &str, op: &str) -> saved::SavedRecord {
    let sentence: String = c
        .query_row("SELECT en_text FROM segments WHERE id=?1", [segment], |r| {
            r.get(0)
        })
        .unwrap();
    let byte = sentence.find(expression).unwrap();
    let start = sentence[..byte].encode_utf16().count();
    saved::mutate(
        c,
        op,
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: segment,
                expression: expression.into(),
                start_offset: start,
                end_offset: start + expression.encode_utf16().count(),
                explanation: Some("原始上下文释义".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap()
    .record
}
#[test]
fn import_restart_and_receipt_keep_utf16_provenance() {
    let (d, c) = db();
    let x = input("one", "pdf");
    let a = materials::import_material(&c, &x).unwrap();
    assert_eq!(
        materials::import_material(&c, &x).unwrap().file_id,
        a.file_id
    );
    let view = materials::open(&c, a.file_id).unwrap();
    assert_eq!(view.material.document.as_ref(), x.document.as_ref());
    assert!(view.media_refs.is_empty());
    assert!(view.material.source.is_none());
    let saved = save(&c, view.segments[0].id, "world", "save-word");
    assert_eq!(saved.source.as_ref().unwrap().start_offset, Some(9));
    assert_eq!(
        saved
            .source
            .as_ref()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .locations[0]
            .page,
        Some(1)
    );
    drop(c);
    let c = crate::db::init_db(&d.path().join("source.db")).unwrap();
    assert_eq!(
        materials::open(&c, a.file_id).unwrap().segments[0].en_text,
        x.content
    );
    assert_eq!(
        saved::resolve_source(&c, &saved.record_id)
            .unwrap()
            .unwrap()
            .file_id,
        a.file_id
    );
    assert_eq!(
        materials::import_material(&c, &x).unwrap().outcome,
        "created"
    );
}
#[test]
fn same_text_formats_and_ranges_never_cross_bind() {
    let (_d, c) = db();
    let pdf = input("pdf", "pdf");
    let txt = input("txt", "txt");
    let mut range = input("range", "pdf");
    let source = range.document.as_mut().unwrap();
    source.selection = DocumentSelection::Pages { start: 1, end: 1 };
    source.identity = digest(&format!(
        "{}\npdf\n{{\"kind\":\"pages\",\"start\":1,\"end\":1}}",
        source.source_sha256
    ));
    let mut ids = vec![];
    let mut saved_ids = vec![];
    for (i, x) in [pdf, txt, range].iter().enumerate() {
        let id = materials::import_material(&c, x).unwrap().file_id;
        ids.push(id);
        let s = materials::open(&c, id).unwrap().segments[0].id;
        let record = save(&c, s, "should not", &format!("save-{i}"));
        assert_eq!(
            saved::resolve_source(&c, &record.record_id)
                .unwrap()
                .unwrap()
                .file_id,
            id
        );
        saved_ids.push(record.record_id);
    }
    assert_eq!(
        ids.iter().collect::<std::collections::HashSet<_>>().len(),
        3
    );
    assert_eq!(
        saved_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len(),
        3
    );
    // A legacy TXT with the same normalized body cannot steal the PDF source.
    let mut legacy = input("legacy", "txt");
    legacy.document = None;
    legacy.normalized_kind = None;
    let id = materials::import_material(&c, &legacy).unwrap().file_id;
    assert!(!ids.contains(&id));
}
#[test]
fn extractor_upgrade_and_retry_preserve_original_body_and_saved_snapshot() {
    let (_d, c) = db();
    let x = input("v1", "docx");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let s = materials::open(&c, id).unwrap().segments[0].id;
    let record = save(&c, s, "world", "save");
    let mut newer = input("v2", "docx");
    newer.content = "Hello 😀 world. We should not lose 43.".into();
    newer.segments[0].en_text = newer.content.clone();
    let d = newer.document.as_mut().unwrap();
    d.extractor_version = "controlled-test-v2".into();
    d.normalized_sha256 = digest(&newer.content);
    d.blocks[0].text = newer.content.clone();
    let result = materials::import_material(&c, &newer).unwrap();
    assert_eq!(result.outcome, "duplicate");
    assert_eq!(result.file_id, id);
    assert_eq!(materials::import_material(&c, &newer).unwrap().file_id, id);
    assert_eq!(
        materials::open(&c, id).unwrap().segments[0].en_text,
        x.content
    );
    assert_eq!(saved::get(&c, &record.record_id).unwrap().unwrap(), record);
    newer.name = "renamed.docx".into();
    newer.document.as_mut().unwrap().display_name = newer.name.clone();
    assert_eq!(
        materials::import_material(&c, &newer).unwrap_err(),
        "material_operation_conflict"
    );
    c.execute("DELETE FROM files WHERE id=?1", [id]).unwrap();
    assert_eq!(
        materials::import_material(&c, &x).unwrap_err(),
        "material_source_removed"
    );
}
#[test]
fn old_text_duplicate_keeps_original_hash_indices_and_receipt() {
    let (_d, c) = db();
    let mut old = input("legacy", "txt");
    old.document = None;
    old.normalized_kind = None;
    let id = materials::import_material(&c, &old).unwrap().file_id;
    let before = materials::open(&c, id).unwrap();
    let mut new = input("new", "txt");
    let doc = new.document.as_mut().unwrap();
    doc.source_sha256 = digest(&old.content);
    doc.identity = digest(&format!("{}\ntxt\n{{\"kind\":\"all\"}}", doc.source_sha256));
    assert_eq!(materials::import_material(&c, &new).unwrap().file_id, id);
    assert_eq!(
        materials::import_material(&c, &new).unwrap().outcome,
        "duplicate"
    );
    let after = materials::open(&c, id).unwrap();
    assert_eq!(before.material.content_hash, after.material.content_hash);
    assert!(after.material.document.is_none());
    assert_eq!(before.segments[0].id, after.segments[0].id);
}
#[test]
fn phrase_word_edit_delete_undo_and_backup_are_independent_of_original_file() {
    let (d, c) = db();
    let x = input("book", "epub");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let segment = materials::open(&c, id).unwrap().segments[0].id;
    let word = save(&c, segment, "world", "word");
    let phrase = save(&c, segment, "should not", "phrase");
    let edited = saved::mutate(
        &c,
        "edit",
        &saved::Mutation::Edit {
            record_id: phrase.record_id.clone(),
            expected_revision: phrase.revision.clone(),
            explanation: "personal meaning".into(),
        },
    )
    .unwrap()
    .record;
    let removed = saved::mutate(
        &c,
        "remove",
        &saved::Mutation::Remove {
            record_id: word.record_id.clone(),
            expected_revision: word.revision.clone(),
        },
    )
    .unwrap()
    .record;
    assert!(removed.deleted_at.is_some());
    saved::undo(&c, "remove").unwrap();
    c.execute("DELETE FROM files WHERE id=?1", [id]).unwrap();
    assert!(saved::resolve_source(&c, &word.record_id)
        .unwrap()
        .is_none());
    let backup = export::backup_payload(&c).unwrap();
    assert_eq!(backup.schema_version, 11);
    let encoded = serde_json::to_string(&backup).unwrap();
    assert!(!encoded.contains(d.path().to_string_lossy().as_ref()));
    let target = crate::db::init_db(&d.path().join("restore.db")).unwrap();
    export::restore_backup(&target, &backup).unwrap();
    let restored = saved::get(&target, &phrase.record_id).unwrap().unwrap();
    assert_eq!(restored, edited);
    assert_eq!(
        restored.source.unwrap().document.unwrap().section_title,
        "First chapter"
    );
    assert_eq!(
        saved::get(&target, &word.record_id)
            .unwrap()
            .unwrap()
            .sentence,
        word.sentence
    );
}
#[test]
fn new_backup_preserves_document_and_old_backup_defaults_missing_fields() {
    let (d, c) = db();
    let x = input("pdf", "pdf");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let view = materials::open(&c, id).unwrap();
    let r = save(&c, view.segments[0].id, "world", "save");
    let backup = export::backup_payload(&c).unwrap();
    assert_eq!(backup.schema_version, 11);
    let target = crate::db::init_db(&d.path().join("new.db")).unwrap();
    export::restore_backup(&target, &backup).unwrap();
    assert_eq!(
        materials::open(&target, id).unwrap().material.document,
        x.document
    );
    assert!(saved::resolve_source(&target, &r.record_id)
        .unwrap()
        .is_some());
    let mut legacy = serde_json::to_value(&backup).unwrap();
    legacy["schema_version"] = json!(10);
    for row in legacy["data"]["files"].as_array_mut().unwrap() {
        let o = row.as_object_mut().unwrap();
        o.remove("document_source");
        o.remove("document_identity");
    }
    legacy["data"]["saved_records"] = json!([]);
    legacy["data"]["saved_actions"] = json!([]);
    legacy["data"]["material_import_actions"] = json!([]);
    let old = crate::db::init_db(&d.path().join("old.db")).unwrap();
    export::restore_backup(&old, &serde_json::from_value(legacy).unwrap()).unwrap();
    assert!(materials::open(&old, id)
        .unwrap()
        .material
        .document
        .is_none());
    assert_eq!(export::backup_payload(&old).unwrap().schema_version, 10);
}
#[test]
fn rejects_surrogate_split_paths_bad_hashes_and_incomplete_segment_mapping() {
    let (_d, c) = db();
    let mut x = input("bad-utf16", "pdf");
    x.document.as_mut().unwrap().blocks[0].end_utf16 = 7;
    assert_eq!(
        materials::import_material(&c, &x).unwrap_err(),
        "material_invalid_document"
    );
    let mut x = input("bad-path", "pdf");
    x.name = "/Users/person/private.pdf".into();
    x.document.as_mut().unwrap().display_name = x.name.clone();
    assert!(materials::import_material(&c, &x).is_err());
    let mut x = input("bad-hash", "pdf");
    x.document.as_mut().unwrap().normalized_sha256 = "a".repeat(64);
    assert!(materials::import_material(&c, &x).is_err());
    let mut x = input("bad-map", "pdf");
    x.document.as_mut().unwrap().blocks[0]
        .segment_indices
        .clear();
    assert!(materials::import_material(&c, &x).is_err());
    assert_eq!(materials::list(&c, &[], false).unwrap().len(), 0);
}
#[test]
fn corrupt_backup_rolls_back_without_damaging_existing_material() {
    let (d, c) = db();
    let id = materials::import_material(&c, &input("one", "pdf"))
        .unwrap()
        .file_id;
    let backup = export::backup_payload(&c).unwrap();
    let target = crate::db::init_db(&d.path().join("target.db")).unwrap();
    let existing = materials::import_material(&target, &input("existing", "docx"))
        .unwrap()
        .file_id;
    let mut raw = serde_json::to_value(&backup).unwrap();
    let source = raw["data"]["files"][0]["document_source"].as_str().unwrap();
    let mut source: serde_json::Value = serde_json::from_str(source).unwrap();
    source["blocks"][0]["end_utf16"] = json!(6);
    raw["data"]["files"][0]["document_source"] = json!(source.to_string());
    assert!(export::restore_backup(&target, &serde_json::from_value(raw).unwrap()).is_err());
    assert_eq!(
        materials::open(&target, existing).unwrap().material.name,
        "lesson.docx"
    );
    assert_eq!(materials::open(&c, id).unwrap().material.name, "lesson.pdf");
}
#[test]
fn translation_compare_and_swap_only_fills_current_empty_text_and_never_snapshots() {
    let (_d, c) = db();
    let x = input("book", "md");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let view = materials::open(&c, id).unwrap();
    let segment = view.segments[0].id;
    let r = save(&c, segment, "world", "save");
    let patch = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "翻译".into(),
    };
    assert_eq!(
        materials::fill_translations(&c, id, &view.material.content_hash, &[patch])
            .unwrap()
            .len(),
        1
    );
    assert_eq!(saved::get(&c, &r.record_id).unwrap().unwrap(), r);
    let again = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "迟到的覆盖".into(),
    };
    let confirmed =
        materials::fill_translations(&c, id, &view.material.content_hash, &[again]).unwrap();
    assert_eq!(confirmed.len(), 1);
    assert_eq!(confirmed[0].zh_text, "翻译");
    c.execute(
        "UPDATE segments SET en_text='A user edited the original.',zh_text=NULL WHERE id=?1",
        [segment],
    )
    .unwrap();
    let stale = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "旧文本译文".into(),
    };
    assert!(
        materials::fill_translations(&c, id, &view.material.content_hash, &[stale])
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        materials::fill_translations(&c, id, "stale-hash", &[])
            .err()
            .unwrap(),
        "material_source_removed"
    );
    c.execute("DELETE FROM files WHERE id=?1", [id]).unwrap();
    assert!(materials::fill_translations(&c, id, &view.material.content_hash, &[]).is_err());
}
#[test]
fn vtt_uses_explicit_subtitle_storage_without_fabricated_media() {
    let (_d, c) = db();
    let x = input("subtitles", "vtt");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let view = materials::open(&c, id).unwrap();
    assert_eq!(view.material.name, "lesson.vtt");
    assert_eq!(view.material.document.unwrap().original_format, "vtt");
    assert!(view.material.source.is_none());
    assert!(view.media_refs.is_empty());
    assert_eq!(
        c.query_row("SELECT type FROM files WHERE id=?1", [id], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "srt"
    );
    let record = save(&c, view.segments[0].id, "world", "save");
    assert!(record.source.as_ref().unwrap().media.is_none());
    assert_eq!(
        record.source.unwrap().document.unwrap().locations[0].start_ms,
        Some(1000)
    );
}
#[test]
fn snapshot_validates_document_identity_and_forbids_audio_document_mix() {
    let (_d, c) = db();
    let id = materials::import_material(&c, &input("one", "pdf"))
        .unwrap()
        .file_id;
    let view = materials::open(&c, id).unwrap();
    let mut record = save(&c, view.segments[0].id, "world", "save");
    record
        .source
        .as_mut()
        .unwrap()
        .document
        .as_mut()
        .unwrap()
        .locations[0]
        .section_id = "/private/tmp/private.pdf".into();
    assert!(saved::write_record(&c, &record).is_err());
    let mut row = json!({"document_source":serde_json::to_string(&input("x","pdf").document.unwrap()).unwrap(),"document_identity":"a".repeat(64),"content":view.segments[0].en_text,"media_identity":"other"});
    assert!(validate_file_source(row.as_object().unwrap()).is_err());
    row.as_object_mut().unwrap().remove("media_identity");
    assert!(validate_file_source(row.as_object().unwrap()).is_err());
}
#[test]
fn migration_is_idempotent_and_preserves_legacy_records() {
    let (_d, c) = db();
    let mut old = input("old", "txt");
    old.document = None;
    old.normalized_kind = None;
    let id = materials::import_material(&c, &old).unwrap().file_id;
    let before = materials::open(&c, id).unwrap();
    migrate(&c).unwrap();
    migrate(&c).unwrap();
    let after = materials::open(&c, id).unwrap();
    assert_eq!(before.material.content_hash, after.material.content_hash);
    assert_eq!(before.segments[0].id, after.segments[0].id);
    assert!(after.material.document.is_none());
    let total: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM files WHERE id=?1 AND type='txt' AND document_identity IS NULL",
            params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(total, 1);
}

#[test]
fn unrelated_segment_cannot_be_bound_to_a_valid_document_location() {
    let (_d, c) = db();
    let mut x = input("unrelated", "pdf");
    x.segments[0].en_text = "A completely different sentence.".into();
    assert_eq!(
        materials::import_material(&c, &x).unwrap_err(),
        "material_invalid_document"
    );
    let mut x = input("time", "vtt");
    x.segments[0].start_time = Some("00:00:02.000".into());
    assert_eq!(
        materials::import_material(&c, &x).unwrap_err(),
        "material_invalid_document"
    );
}

#[test]
fn restore_rejects_unrelated_segments_and_wrong_metadata_types() {
    let (d, c) = db();
    materials::import_material(&c, &input("one", "pdf")).unwrap();
    let backup = export::backup_payload(&c).unwrap();
    let target = crate::db::init_db(&d.path().join("unrelated.db")).unwrap();
    let mut raw = serde_json::to_value(&backup).unwrap();
    raw["data"]["segments"][0]["en_text"] = json!("Unrelated text is not from this page.");
    assert!(export::restore_backup(&target, &serde_json::from_value(raw).unwrap()).is_err());
    assert!(materials::list(&target, &[], false).unwrap().is_empty());
    let mut raw = serde_json::to_value(&backup).unwrap();
    raw["data"]["files"][0]["document_source"] = json!({});
    raw["data"]["files"][0]["document_identity"] = json!(null);
    assert!(export::restore_backup(&target, &serde_json::from_value(raw).unwrap()).is_err());
    assert!(materials::list(&target, &[], false).unwrap().is_empty());
}

#[test]
fn translation_retry_after_cancelled_response_returns_existing_without_writing() {
    let (_d, c) = db();
    let x = input("book", "pdf");
    let id = materials::import_material(&c, &x).unwrap().file_id;
    let view = materials::open(&c, id).unwrap();
    let segment = view.segments[0].id;
    let first = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "第一次已提交，客户端取消或丢响应".into(),
    };
    // Simulate a native transaction that committed before the UI abort check.
    drop(materials::fill_translations(&c, id, &view.material.content_hash, &[first]).unwrap());
    let before: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    let retry = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "重试候选不得覆盖".into(),
    };
    let confirmed =
        materials::fill_translations(&c, id, &view.material.content_hash, &[retry]).unwrap();
    assert_eq!(confirmed.len(), 1);
    assert_eq!(confirmed[0].zh_text, "第一次已提交，客户端取消或丢响应");
    assert_eq!(
        c.query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        before
    );
    c.execute(
        "UPDATE segments SET zh_text='用户手工修改优先' WHERE id=?1",
        [segment],
    )
    .unwrap();
    let before: i64 = c
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .unwrap();
    let retry = materials::ReadingTranslationPatch {
        id: segment,
        en_text: x.content.clone(),
        zh_text: "迟到翻译".into(),
    };
    assert_eq!(
        materials::fill_translations(&c, id, &view.material.content_hash, &[retry]).unwrap()[0]
            .zh_text,
        "用户手工修改优先"
    );
    assert_eq!(
        c.query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        before
    );
}

#[test]
fn clipboard_webpage_provenance_survives_backup_receipts_and_saved_context() {
    let dir = tempfile::tempdir().unwrap();
    let conn = crate::db::init_db(&dir.path().join("content.db")).unwrap();
    let mut data = input("clipboard-op", "clipboard");
    let doc = data.document.as_mut().unwrap();
    doc.schema_version = 2;
    doc.origin = Some(ContentOrigin::Clipboard {
        title: doc.display_name.clone(),
    });
    let first = materials::import_material(&conn, &data).unwrap();
    assert_eq!(
        materials::import_material(&conn, &data).unwrap().file_id,
        first.file_id
    );
    let opened = materials::open(&conn, first.file_id).unwrap();
    let saved = saved::mutate(
        &conn,
        "save-clipboard",
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: opened.segments[0].id,
                expression: "Hello".into(),
                start_offset: 0,
                end_offset: 5,
                explanation: None,
                explanation_source: "unknown".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap();
    assert_eq!(
        saved
            .record
            .source
            .as_ref()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .origin,
        data.document.as_ref().unwrap().origin
    );
    let backup = export::backup_payload(&conn).unwrap();
    assert_eq!(backup.schema_version, 12);
    let restored = crate::db::init_db(&dir.path().join("restore.db")).unwrap();
    export::restore_backup(&restored, &backup).unwrap();
    assert_eq!(
        materials::open(&restored, first.file_id)
            .unwrap()
            .material
            .document
            .unwrap()
            .origin,
        data.document.as_ref().unwrap().origin
    );
    let mut future = backup;
    future.schema_version = 13;
    assert!(export::restore_backup(&restored, &future).is_err());
    let mut web = input("web-op", "webpage");
    let doc = web.document.as_mut().unwrap();
    doc.schema_version = 2;
    doc.origin = Some(ContentOrigin::Webpage {
        title: doc.display_name.clone(),
        submitted_url: "https://example.com/one".into(),
        final_url: "https://example.com/one".into(),
        fetched_at: 1793350000000,
    });
    let result = materials::import_material(&conn, &web).unwrap();
    assert_ne!(result.file_id, first.file_id);
    assert_eq!(export::backup_payload(&conn).unwrap().schema_version, 12);
    let mut invalid = web;
    invalid.operation_id = "bad".into();
    invalid.document.as_mut().unwrap().schema_version = 1;
    assert!(materials::import_material(&conn, &invalid).is_err());
}
