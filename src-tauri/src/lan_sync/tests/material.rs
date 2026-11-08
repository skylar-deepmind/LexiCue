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
            Operation::Hello => {}
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
