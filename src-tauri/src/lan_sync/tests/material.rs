use super::*;
use crate::lan_sync::saved_delta::ReaderSaves;
use lexicue_lan_journal::{
    self as journal,
    session::{self, Operation, Reply},
    Route,
};
use rusqlite::params;

fn route() -> Route {
    Route {
        pair: Uuid::new_v4(),
        from: Uuid::new_v4(),
        to: Uuid::new_v4(),
    }
}
fn input(n: i32) -> materials::MaterialInput {
    let mut content = String::new();
    let segments = (0..n)
        .map(|i| {
            let start = format!("00:{:02}:{:02}.000", i / 60, i % 60);
            let end = format!("00:{:02}:{:02}.750", i / 60, i % 60);
            let en = format!("Sentence {i} has a distinct subtitle and context.");
            content.push_str(&format!(
                "{}\r\n{} --> {}\r\n{}\r\n\r\n",
                i + 1,
                start.replace('.', ","),
                end.replace('.', ","),
                en
            ));
            SegmentInput {
                index: i,
                en_text: en,
                zh_text: (i % 5 != 0).then(|| format!("已有的第 {i} 句译文。")),
                start_time: Some(start),
                end_time: Some(end),
            }
        })
        .collect();
    materials::MaterialInput {
        operation_id: Uuid::new_v4().to_string(),
        name: "长字幕.srt".into(),
        content,
        segments,
        source: None,
        document: None,
        normalized_kind: None,
    }
}
fn round(a: &mut Connection, b: &mut Connection, r: &Route) -> Result<(), String> {
    session::catch_up(a, r, &ReaderSaves, |req| {
        session::respond(b, &r.reverse(), req, &ReaderSaves)
    })
}
fn count(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn restart_after_partial_material_then_exchange_one_translation_only() {
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("mac.db");
    let bp = dir.path().join("phone.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    let small = input(2);
    materials::import_material(&b, &small).unwrap(); // Existing before opt-in.
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    let long = input(2048);
    let file = materials::import_material(&a, &long).unwrap().file_id;
    assert!(session::catch_up(&mut a, &r, &ReaderSaves, |req| {
        let reply = session::respond(&mut b, &r.reverse(), req, &ReaderSaves)?;
        if matches!(reply, Reply::Staged(_)) {
            Err("lost connection".into())
        } else {
            Ok(reply)
        }
    })
    .is_err());
    let filled = count(&b, "SELECT filled FROM lan_material_stage");
    assert!(filled > 0);
    assert_eq!(count(&b, "SELECT count(*) FROM files"), 1);
    assert_eq!(journal::progress(&a, &r).unwrap().acked, 0);
    assert_eq!(journal::progress(&b, &r.reverse()).unwrap().received, 0);
    drop((a, b));
    a = init_db(&ap).unwrap();
    b = init_db(&bp).unwrap();
    let mut first = None;
    session::catch_up(&mut a, &r, &ReaderSaves, |req| {
        if let Operation::PutChunk(c) = &req.operation {
            first.get_or_insert(c.cursor.offset);
        }
        session::respond(&mut b, &r.reverse(), req, &ReaderSaves)
    })
    .unwrap();
    assert_eq!(first, Some(filled as usize));
    let received: i64 = b
        .query_row(
            "SELECT id FROM files WHERE content=?",
            [&long.content],
            |r| r.get(0),
        )
        .unwrap();
    let data = materials::open(&b, received).unwrap();
    assert_eq!(data.material.name, long.name);
    assert_eq!(data.segments.len(), long.segments.len());
    for (got, want) in data.segments.iter().zip(&long.segments) {
        assert_eq!(
            (&got.en_text, &got.zh_text, &got.start_time, &got.end_time),
            (
                &want.en_text,
                &want.zh_text,
                &want.start_time,
                &want.end_time
            )
        );
    }
    let queue = count(&a, "SELECT count(*) FROM sync_changes");
    let edited = data.segments[101].id;
    b.execute(
        "UPDATE segments SET zh_text=? WHERE id=?",
        params!["真机改译", edited],
    )
    .unwrap();
    let mut events = Vec::new();
    session::catch_up(&mut b, &r.reverse(), &ReaderSaves, |req| {
        match &req.operation {
            Operation::Deliver(batch) => {
                events.extend(batch.events.iter().map(|e| e.snapshot.clone()))
            }
            Operation::Hello(_) => {}
            _ => panic!("unnecessary transfer for a single translation"),
        }
        session::respond(&mut a, &r, req, &ReaderSaves)
    })
    .unwrap();
    assert_eq!(events.len(), 1);
    assert!(events[0].contains("真机改译"));
    assert!(!events[0].contains("Sentence"));
    assert!(events[0].len() < 512);
    assert_eq!(
        a.query_row(
            "SELECT zh_text FROM segments WHERE file_id=? AND index_num=101",
            [file],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "真机改译"
    );
    assert_eq!(count(&a, "SELECT count(*) FROM sync_changes"), queue);
    assert_eq!(count(&a, "SELECT count(*) FROM files"), 2);
    assert_eq!(count(&a, "SELECT count(*) FROM lan_saved_outbox"), 1);
}
#[test]
fn failed_material_publication_never_acks_and_reuses_complete_stage() {
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("mac.db");
    let bp = dir.path().join("phone.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    materials::import_material(&a, &input(24)).unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    b.execute_batch("CREATE TRIGGER fail_cue BEFORE INSERT ON segments WHEN NEW.index_num=3 BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(round(&mut a, &mut b, &r).unwrap_err().contains("injected"));
    assert_eq!(count(&b, "SELECT count(*) FROM files"), 0);
    assert_eq!(count(&b, "SELECT filled=bytes FROM lan_material_stage"), 1);
    assert_eq!(journal::progress(&a, &r).unwrap().acked, 0);
    b.execute_batch("DROP TRIGGER fail_cue").unwrap();
    session::catch_up(&mut a, &r, &ReaderSaves, |req| {
        assert!(!matches!(&req.operation, Operation::PutChunk(_)));
        session::respond(&mut b, &r.reverse(), req, &ReaderSaves)
    })
    .unwrap();
    assert_eq!(count(&b, "SELECT count(*) FROM segments"), 24);
}

#[test]
fn shared_file_identity_joins_existing_translations_and_aliases_future_edits() {
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("left.db");
    let bp = dir.path().join("right.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    let fixture = input(6);
    for db in [&a, &b] {
        materials::import_material(db, &fixture).unwrap();
        db.execute(
            "UPDATE sync_entity_state SET sync_id='shared-file-id' WHERE table_name='files'",
            [],
        )
        .unwrap();
    }
    a.execute(
        "UPDATE segments SET zh_text='以前的译文' WHERE index_num=0",
        [],
    )
    .unwrap();
    b.execute(
        "UPDATE segments SET zh_text='另一份初始译文' WHERE index_num=1",
        [],
    )
    .unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    let visible = |db: &Connection| {
        db.query_row(
            "SELECT json_group_array(zh_text ORDER BY index_num) FROM segments",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
    };
    assert_eq!(visible(&a), visible(&b));
    for db in [&a, &b] {
        assert_eq!(count(db, "SELECT count(*) FROM files"), 1);
        assert_eq!(
            count(
                db,
                "SELECT count(*) FROM segments WHERE zh_text='以前的译文'"
            ),
            1
        );
        assert_eq!(count(db,"SELECT count(*) FROM lan_material_values WHERE generation=0 AND value IN ('已有的第 1 句译文。','另一份初始译文')"),2);
    }
    a.execute(
        "UPDATE segments SET zh_text='left note' WHERE index_num=2",
        [],
    )
    .unwrap();
    b.execute(
        "UPDATE segments SET zh_text='right note' WHERE index_num=2",
        [],
    )
    .unwrap();
    round(&mut b, &mut a, &r.reverse()).unwrap();
    assert_eq!(visible(&a), visible(&b));
    for db in [&a, &b] {
        assert_eq!(count(db,"SELECT count(*) FROM lan_material_values WHERE value IN ('left note','right note')"),2);
    }
}

#[test]
fn concurrent_automatic_fill_or_old_english_never_replaces_personal_translation() {
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("left.db");
    let bp = dir.path().join("right.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    let fixture = input(6);
    materials::import_material(&a, &fixture).unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    let hash: String = a
        .query_row("SELECT content_hash FROM files", [], |r| r.get(0))
        .unwrap();
    let patch = materials::ReadingTranslationPatch {
        id: 1,
        en_text: fixture.segments[0].en_text.clone(),
        zh_text: "机器译文".into(),
    };
    materials::fill_translations(&a, 1, &hash, &[patch]).unwrap();
    b.execute(
        "UPDATE segments SET zh_text='手工译文' WHERE index_num=0",
        [],
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for db in [&a, &b] {
        assert_eq!(
            count(db, "SELECT count(*) FROM segments WHERE zh_text='手工译文'"),
            1
        );
    }
    a.execute(
        "UPDATE segments SET en_text='A different original.' WHERE index_num=0",
        [],
    )
    .unwrap();
    b.execute(
        "UPDATE segments SET zh_text='旧原文的迟到修改' WHERE index_num=0",
        [],
    )
    .unwrap();
    round(&mut b, &mut a, &r.reverse()).unwrap();
    for db in [&a, &b] {
        assert_eq!(count(db,"SELECT count(*) FROM segments WHERE en_text='A different original.' AND zh_text IS NULL"),1);
        assert_eq!(
            count(
                db,
                "SELECT count(*) FROM lan_material_values WHERE value='旧原文的迟到修改'"
            ),
            1
        );
    }
    // A new large body uses chunk staging in the pull direction too.
    let new_body = "正文 chunk across a Unicode boundary.\n".repeat(4000);
    b.execute("UPDATE files SET name='Renamed.srt',content=?", [&new_body])
        .unwrap();
    b.execute(
        "UPDATE segments SET start_time='00:00:04.001' WHERE index_num=0",
        [],
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(
        a.query_row(
            "SELECT content FROM files WHERE name='Renamed.srt'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        new_body
    );
    assert_eq!(
        count(
            &a,
            "SELECT count(*) FROM segments WHERE start_time='00:00:04.001'"
        ),
        1
    );
    b.execute("DELETE FROM files", []).unwrap();
    a.execute(
        "UPDATE segments SET zh_text='离线改译' WHERE index_num=3",
        [],
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for db in [&a, &b] {
        assert_eq!(count(db, "SELECT count(*) FROM files"), 0);
        assert_eq!(
            count(
                db,
                "SELECT count(*) FROM lan_material_values WHERE value='离线改译'"
            ),
            1
        );
    }
}

#[test]
fn damaged_chunk_is_retried_without_publishing_or_acknowledging_the_material() {
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("left.db");
    let bp = dir.path().join("right.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    materials::import_material(&a, &input(240)).unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    let error = session::catch_up(&mut a, &r, &ReaderSaves, |mut req| {
        if let Operation::PutChunk(c) = &mut req.operation {
            c.checksum.clear();
        }
        session::respond(&mut b, &r.reverse(), req, &ReaderSaves)
    })
    .unwrap_err();
    assert!(error.contains("checksum"));
    assert_eq!(count(&b, "SELECT filled FROM lan_material_stage"), 0);
    assert_eq!(count(&b, "SELECT count(*) FROM files"), 0);
    assert_eq!(journal::progress(&a, &r).unwrap().acked, 0);
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(count(&b, "SELECT count(*) FROM segments"), 240);
}

#[test]
fn compatibility_import_captures_complete_english_material_only() {
    use crate::commands::import::{import_payload, ImportPayload};
    let dir = tempdir().unwrap();
    let r = route();
    let ap = dir.path().join("mac.db");
    let bp = dir.path().join("phone.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    for lang in ["en", "de"] {
        let fixture = input(6);
        import_payload(
            &a,
            ImportPayload {
                name: fixture.name,
                file_type: "srt".into(),
                content: fixture.content,
                content_hash: "legacy".into(),
                segments: fixture.segments,
                lemmas: vec![],
                occurrences: vec![],
                phrase_occurrences: None,
                replace_file_id: None,
                tag_ids: vec![],
                new_tag_names: vec![],
                language: lang.to_string(),
            },
        )
        .unwrap();
    }
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(count(&b, "SELECT count(*) FROM files"), 1);
    assert_eq!(count(&b, "SELECT count(*) FROM segments"), 6);
    assert_eq!(
        count(&a, "SELECT count(*) FROM files WHERE language='de'"),
        1
    );
}

#[test]
fn portable_restore_rejoins_with_a_new_epoch_and_keeps_the_deletion() {
    let dir = tempdir().unwrap();
    let ap = dir.path().join("library-a.db");
    let bp = dir.path().join("library-b.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    let old = route();
    prepare_library(&ap, Uuid::new_v4(), &old).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &old.reverse()).unwrap();
    let id = materials::import_material(&a, &input(8)).unwrap().file_id;
    let tag = crate::commands::tags::ensure_tag(&a, "Lecture").unwrap();
    crate::commands::tags::replace_file_tags(&a, id, &[tag], &[]).unwrap();
    a.execute("UPDATE tags SET tone='purple'", []).unwrap();
    round(&mut a, &mut b, &old).unwrap();
    let backup = export::backup_payload(&a).unwrap();
    assert_eq!(backup.schema_version, 13);
    a.execute("DELETE FROM files WHERE id=?", [id]).unwrap();
    round(&mut a, &mut b, &old).unwrap();
    export::restore_backup(&a, &backup).unwrap();
    assert_eq!(count(&a, "SELECT count(*) FROM files"), 1);
    assert!(round(&mut a, &mut b, &old).is_err());
    b.execute("UPDATE lan_saved_peer SET active=0", []).unwrap();
    let new = Route {
        pair: Uuid::new_v4(),
        ..old.clone()
    };
    prepare_library(&ap, Uuid::new_v4(), &new).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &new.reverse()).unwrap();
    round(&mut a, &mut b, &new).unwrap();
    for c in [&a, &b] {
        assert_eq!(count(c, "SELECT count(*) FROM files"), 0);
        assert_eq!(
            count(
                c,
                "SELECT count(*) FROM tags WHERE name='Lecture' AND tone='purple'"
            ),
            1
        );
    }
}

/// Populate only the designated, independently installed QA app. This goes
/// through the same import and position write paths as the product.
#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires the dedicated com.lexicue.dev.lansyncqa installation"]
fn seed_signed_qa_library() {
    let path = std::path::PathBuf::from(std::env::var_os("HOME").unwrap())
        .join("Library/Application Support/com.lexicue.dev.lansyncqa/lexicue.db");
    assert!(path
        .with_file_name("lan-installation")
        .join("replica")
        .is_file());
    let db =
        Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
    let mut fixture = input(2048);
    fixture.operation_id = "ab417786-d213-47ad-ba34-ab2206829a3b".into();
    fixture.name = "LAN acceptance · 2048 cues.srt".into();
    let file = materials::import_material(&db, &fixture).unwrap().file_id;
    let tag = crate::commands::tags::ensure_tag(&db, "LAN acceptance").unwrap();
    crate::commands::tags::replace_file_tags(&db, file, &[tag], &[]).unwrap();
    db.execute("UPDATE tags SET tone='purple' WHERE id=?", [tag])
        .unwrap();
    let material = materials::open(&db, file).unwrap();
    materials::write_position(
        &db,
        file,
        12,
        &material.material.content_hash,
        None,
        false,
        true,
    )
    .unwrap();
}

#[test]
fn two_independent_contexts_and_a_source_url_survive_bidirectional_catch_up() {
    use crate::commands::document_source::ContentOrigin;
    let dir = tempdir().unwrap();
    let ap = dir.path().join("mac.db");
    let bp = dir.path().join("phone.db");
    let mut a = init_db(&ap).unwrap();
    let mut b = init_db(&bp).unwrap();
    let r = route();
    let left = seed(&a, "Take off tomorrow.", "起飞");
    let right = seed(&b, "Take off tomorrow.", "启程");
    assert_ne!(left.record_id, right.record_id);
    let mut webpage = crate::commands::document_source_tests::input("lan-source", "webpage");
    let doc = webpage.document.as_mut().unwrap();
    doc.schema_version = 2;
    doc.origin = Some(ContentOrigin::Webpage {
        title: doc.display_name.clone(),
        submitted_url: "https://example.com/one".into(),
        final_url: "https://example.com/one".into(),
        fetched_at: 1,
    });
    doc.warnings.push("/private/import/diagnostic".into());
    materials::import_material(&a, &webpage).unwrap();
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for c in [&a, &b] {
        assert_eq!(count(c, "SELECT count(*) FROM saved_records"), 2);
        let x = saved::resolve_source(c, &left.record_id)
            .unwrap()
            .unwrap()
            .file_id;
        let y = saved::resolve_source(c, &right.record_id)
            .unwrap()
            .unwrap()
            .file_id;
        assert_ne!(x, y);
    }
    let raw: String = b
        .query_row(
            "SELECT document_source FROM files WHERE document_source IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(raw.contains("https://example.com/one"));
    assert!(!raw.contains("/private/"));
    assert_eq!(count(&b, "SELECT count(*) FROM source_media"), 0);
}

#[test]
fn private_web_link_and_device_path_are_omitted_while_text_and_saved_context_sync() {
    use crate::commands::document_source::ContentOrigin;
    use sha2::{Digest, Sha256};
    let hash = |s: &str| format!("{:x}", Sha256::digest(s.as_bytes()));
    let dir = tempdir().unwrap();
    let (ap, bp) = (dir.path().join("mac.db"), dir.path().join("phone.db"));
    let (mut a, mut b) = (init_db(&ap).unwrap(), init_db(&bp).unwrap());
    let r = route();
    let mut input = crate::commands::document_source_tests::input("private-link", "webpage");
    let url = "https://example.com/one?X-Amz-Signature=SENSITIVE";
    let doc = input.document.as_mut().unwrap();
    doc.schema_version = 2;
    doc.origin = Some(ContentOrigin::Webpage {
        title: doc.display_name.clone(),
        submitted_url: url.into(),
        final_url: url.into(),
        fetched_at: 1,
    });
    doc.source_sha256 = hash(&format!("{url}\n{url}\n{}", input.content));
    doc.identity = hash(&format!(
        "{}\nwebpage\n{{\"kind\":\"all\"}}",
        doc.source_sha256
    ));
    let imported = materials::import_material(&a, &input).unwrap().file_id;
    a.execute(
        "UPDATE files SET name='/private/local-path' WHERE id=?",
        [imported],
    )
    .unwrap();
    let segment = materials::open(&a, imported).unwrap().segments[0].id;
    let saved =
        crate::commands::document_source_tests::save(&a, segment, "world", "private-context");
    prepare_library(&ap, Uuid::new_v4(), &r).unwrap();
    prepare_library(&bp, Uuid::new_v4(), &r.reverse()).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    assert!(
        count(
            &b,
            "SELECT COUNT(*) FROM files WHERE document_source IS NULL AND content LIKE '%world%'"
        ) == 1
    );
    for sql in ["SELECT COUNT(*) FROM lan_history WHERE snapshot LIKE '%SENSITIVE%' OR snapshot LIKE '%local-path%'",
        "SELECT COUNT(*) FROM lan_material_blobs WHERE CAST(data AS TEXT) LIKE '%SENSITIVE%' OR CAST(data AS TEXT) LIKE '%local-path%'"] {
        assert_eq!(count(&b,sql),0);
        assert_eq!(count(&a,sql),0);
    }
    let remote = saved::get(&b, &saved.record_id).unwrap().unwrap();
    assert_eq!(remote.sentence, saved.sentence);
    let source = remote.source.as_ref().unwrap();
    assert!(source.document.is_none());
    assert_eq!(source.file_name, "Imported material");
    saved::mutate(
        &b,
        "edit",
        &saved::Mutation::Edit {
            record_id: saved.record_id.clone(),
            expected_revision: saved.revision,
            explanation: "changed elsewhere".into(),
        },
    )
    .unwrap();
    round(&mut b, &mut a, &r.reverse()).unwrap();
    let updated = saved::get(&a, &saved.record_id).unwrap().unwrap();
    assert_eq!(updated.source, saved.source);
    assert_eq!(updated.explanation.as_deref(), Some("changed elsewhere"));
}

#[test]
fn upgrade_paired_offline_library_captures_late_media_without_sending_the_book_again() {
    use crate::commands::{source_media, youtube};
    for attached_before_upgrade in [false, true] {
        let dir = tempdir().unwrap();
        let (ap, bp) = (dir.path().join("old.db"), dir.path().join("phone.db"));
        let (mut a, mut b) = (init_db(&ap).unwrap(), init_db(&bp).unwrap());
        let r = route();
        let mut import = input(3);
        let file = materials::import_material(&a, &import).unwrap().file_id;
        prepare_library(&ap, r.pair, &r).unwrap();
        prepare_library(&bp, r.pair, &r.reverse()).unwrap();
        round(&mut a, &mut b, &r).unwrap();
        let head = journal::progress(&a, &r).unwrap().head;
        a.execute_batch("DROP TRIGGER lan_capture_media_attachment;")
            .unwrap();
        import.operation_id = Uuid::new_v4().to_string();
        import.source=Some(source_media::source_from_subtitles("abcdefghijk",
            &youtube::SubtitleTrack{lang:"en".into(),is_auto:false,language:"en".into(),source:youtube::downloads::SubtitleSource::Manual,source_language:Some("en".into())},
            &import.content,&serde_json::json!({"title":"Captions","duration":6,"formats":[{"vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","format_id":"140","language":"en"}]})).unwrap());
        let attach = |c: &Connection| {
            let added = materials::import_material(c, &import).unwrap();
            assert_eq!((added.file_id, added.outcome.as_str()), (file, "duplicate"));
        };
        if attached_before_upgrade {
            attach(&a);
        }
        drop(a);
        let mut a = init_db(&ap).unwrap();
        if !attached_before_upgrade {
            attach(&a);
        }
        assert_eq!(journal::progress(&a, &r).unwrap().head, head + 1);
        let raw:String=a.query_row("SELECT CAST(b.data AS TEXT) FROM lan_saved_outbox o JOIN lan_material_blobs b ON b.event=o.eid ORDER BY o.seq DESC LIMIT 1",[],|r|r.get(0)).unwrap();
        let descriptor: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(descriptor["material_op"], "attach");
        assert!(
            descriptor.get("body").is_none()
                && descriptor.get("sentences").is_none()
                && !raw.contains("已有的第")
        );
        round(&mut a, &mut b, &r).unwrap();
        drop(a);
        let a = init_db(&ap).unwrap();
        assert_eq!(journal::progress(&a, &r).unwrap().head, head + 1);
        for c in [&a, &b] {
            assert_eq!(
                count(
                    c,
                    "SELECT count(*) FROM files WHERE media_identity IS NOT NULL"
                ),
                1
            );
            assert_eq!(
                count(c, "SELECT count(*) FROM segments WHERE zh_text IS NOT NULL"),
                2
            );
            assert_eq!(count(c, "SELECT count(*) FROM source_media"), 0);
        }
    }
}
