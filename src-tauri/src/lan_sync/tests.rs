use super::*;
use crate::commands::{export, import::SegmentInput, materials, saved};
use crate::db::init_db;
use tempfile::tempdir;

fn seed(db: &Connection, sentence: &str, meaning: &str) -> saved::SavedRecord {
    let input = materials::MaterialInput {
        operation_id: Uuid::new_v4().to_string(),
        name: "trip.srt".into(),
        content: format!("1\n00:00:01,000 --> 00:00:02,500\n{sentence}\n"),
        segments: vec![SegmentInput {
            index: 0,
            en_text: sentence.into(),
            zh_text: Some(meaning.into()),
            start_time: Some("00:00:01.000".into()),
            end_time: Some("00:00:02.500".into()),
        }],
        source: None,
        document: None,
        normalized_kind: None,
    };
    let material = materials::import_material(db, &input).unwrap();
    let segment = materials::open(db, material.file_id)
        .unwrap()
        .segments
        .remove(0);
    saved::mutate(
        db,
        "save",
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: segment.id,
                expression: "Take off".into(),
                start_offset: 0,
                end_offset: 8,
                explanation: Some(meaning.into()),
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
fn both_pre_merge_backups_recover_distinct_contexts_and_survive_retry() {
    let operation = Uuid::new_v4();
    let mut records = Vec::new();
    for (sentence, meaning) in [
        ("Take off at noon.", "中午起飞。"),
        ("Take off your coat.", "脱下外套。"),
    ] {
        let dir = tempdir().unwrap();
        let path = dir.path().join("lexicue.db");
        let live = init_db(&path).unwrap();
        let record = seed(&live, sentence, meaning);
        let backup = MergeBackup::prepare(&path, operation).unwrap();
        saved::mutate(
            &live,
            "edit",
            &saved::Mutation::Edit {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
                explanation: "later offline edit".into(),
            },
        )
        .unwrap();
        drop(live);
        let resumed = MergeBackup::prepare(&path, operation).unwrap();
        assert_eq!(backup.path(), resumed.path());
        let snapshot = resumed.open_verified().unwrap();
        assert!(snapshot.execute("DELETE FROM segments", []).is_err());
        // Exercise the existing portable recovery reader and restore to a fresh
        // disposable database. The two live device databases are never restored.
        let restored = init_db(&dir.path().join("recovered.db")).unwrap();
        export::restore_backup(&restored, &export::backup_payload(&snapshot).unwrap()).unwrap();
        let copy = saved::get(&restored, &record.record_id).unwrap().unwrap();
        assert_eq!(copy, record);
        assert_eq!(copy.explanation.as_deref(), Some(meaning));
        let material = materials::open(&restored, 1).unwrap();
        assert_eq!(material.segments[0].en_text, sentence);
        assert_eq!(material.segments[0].zh_text.as_deref(), Some(meaning));
        assert_eq!(
            material.segments[0].start_time.as_deref(),
            Some("00:00:01.000")
        );
        assert_eq!(
            material.segments[0].end_time.as_deref(),
            Some("00:00:02.500")
        );
        let raw: String = restored
            .query_row("SELECT content FROM files", [], |r| r.get(0))
            .unwrap();
        assert!(raw.contains(sentence));
        records.push(record.record_id);
    }
    assert_ne!(records[0], records[1]);
}

#[test]
fn failed_or_corrupt_backup_never_becomes_ready_or_replaces_original() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("lexicue.db");
    let live = init_db(&path).unwrap();
    let record = seed(&live, "Take off now.", "现在起飞。");
    let directory = dir.path().join("backups");
    fs::write(&directory, "blocked").unwrap();
    let id = Uuid::new_v4();
    assert!(prepare_sentence_ids(&path, id).is_err());
    let installed: bool = live
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='lan_sentence_ids')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!installed);
    fs::remove_file(&directory).unwrap();
    let backup = MergeBackup::prepare(&path, id).unwrap();
    fs::write(backup.path(), "corrupt").unwrap();
    assert!(MergeBackup::prepare(&path, id).is_err());
    assert_eq!(fs::read(backup.path()).unwrap(), b"corrupt");
    assert_eq!(saved::get(&live, &record.record_id).unwrap(), Some(record));
}

#[test]
fn sentence_ids_cover_existing_and_future_rows_atomically_without_cloud_events() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("lexicue.db");
    let live = init_db(&path).unwrap();
    seed(&live, "Take off now.", "现在起飞。");
    live.execute_batch(
        "INSERT INTO files(name,type,content,content_hash,language,imported_at)
         VALUES ('history','txt','昔','old','ja',0);
         INSERT INTO segments(file_id,index_num,en_text) VALUES (2,0,'昔');",
    )
    .unwrap();
    let count = |sql: &str| live.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
    let queued = count("SELECT COUNT(*) FROM sync_changes");
    let operation = Uuid::new_v4();
    prepare_sentence_ids(&path, operation).unwrap();
    assert_eq!(queued, count("SELECT COUNT(*) FROM sync_changes"));
    assert_eq!(count("SELECT COUNT(*) FROM lan_sentence_ids"), 1);
    let id = |segment: i64| {
        live.query_row(
            "SELECT stable_id FROM lan_sentence_ids WHERE local_id=?1",
            [segment],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    };
    let first = id(1);
    live.execute_batch(
        "BEGIN;
         INSERT INTO segments(file_id,index_num,en_text) VALUES (1,1,'Take off now.');
         ROLLBACK;",
    )
    .unwrap();
    assert_eq!(count("SELECT COUNT(*) FROM lan_sentence_ids"), 1);
    live.execute_batch(
        "INSERT INTO segments(file_id,index_num,en_text) VALUES (1,1,'Take off now.');
         UPDATE segments SET zh_text='人工译文' WHERE id=1;",
    )
    .unwrap();
    let second = id(3);
    assert_ne!(first, second);
    prepare_sentence_ids(&path, operation).unwrap();
    assert_eq!(id(1), first);
    assert_eq!(id(3), second);
    live.execute("DELETE FROM segments WHERE id=3", []).unwrap();
    let retired: Option<i64> = live
        .query_row(
            "SELECT local_id FROM lan_sentence_ids WHERE stable_id=?1",
            [second],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(retired, None);
}

#[test]
fn simultaneous_retries_publish_one_backup() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("lexicue.db");
    let live = init_db(&path).unwrap();
    seed(&live, "Take off together.", "一同起飞。");
    let id = Uuid::new_v4();
    let start = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        let prepare = || {
            start.wait();
            MergeBackup::prepare(&path, id).unwrap().path
        };
        let a = scope.spawn(prepare);
        let b = scope.spawn(prepare);
        assert_eq!(a.join().unwrap(), b.join().unwrap());
    });
    assert_eq!(fs::read_dir(dir.path().join("backups")).unwrap().count(), 1);
}

mod delta;
mod material;
