use super::*;
use crate::lan_sync::saved_delta::{self, ReaderSaves};
use lexicue_lan_journal::{
    self as journal,
    session::{catch_up, respond, Operation, Reply},
    Route,
};
use rusqlite::params;

fn pair() -> Route {
    Route {
        pair: Uuid::new_v4(),
        from: Uuid::new_v4(),
        to: Uuid::new_v4(),
    }
}
fn twin(dir: &Path, route: &Route) -> (PathBuf, Connection) {
    fs::create_dir(dir).unwrap();
    let path = dir.join("lexicue.db");
    let db = init_db(&path).unwrap();
    saved_delta::prepare(&path, Uuid::new_v4(), route).unwrap();
    (path, db)
}
fn round(a: &mut Connection, b: &mut Connection, route: &Route) -> journal::Result<()> {
    catch_up(a, route, &ReaderSaves, |req| {
        respond(b, &route.reverse(), req, &ReaderSaves)
    })
}
fn rows(db: &Connection, query: &str) -> i64 {
    db.query_row(query, [], |r| r.get(0)).unwrap()
}
fn edit(db: &Connection, record: &saved::SavedRecord, text: &str) -> saved::SavedRecord {
    saved::mutate(
        db,
        &Uuid::new_v4().to_string(),
        &saved::Mutation::Edit {
            record_id: record.record_id.clone(),
            expected_revision: record.revision.clone(),
            explanation: text.into(),
        },
    )
    .unwrap()
    .record
}

#[test]
fn offline_saves_commit_before_ack_and_catch_up_after_both_restart() {
    let dir = tempdir().unwrap();
    let route = pair();
    let (ap, mut a) = twin(&dir.path().join("mac"), &route);
    let (bp, mut b) = twin(&dir.path().join("phone"), &route.reverse());
    let left = seed(&a, "Take off from here.", "从此起飞");
    let right = seed(&b, "Take off your shoes.", "脱鞋");
    let a_queue = rows(&a, "SELECT count(*) FROM sync_changes");
    let b_queue = rows(&b, "SELECT count(*) FROM sync_changes");
    assert!(catch_up(&mut a, &route, &ReaderSaves, |_| Err("offline".into())).is_err());
    assert!(saved::get(&b, &left.record_id).unwrap().is_none());

    let lost = catch_up(&mut a, &route, &ReaderSaves, |req| {
        let reply = respond(&mut b, &route.reverse(), req, &ReaderSaves)?;
        if matches!(reply, Reply::Applied(_)) {
            return Err("lost ACK".into());
        }
        Ok(reply)
    });
    assert_eq!(lost.unwrap_err(), "lost ACK");
    drop((a, b));
    let (mut a, mut b) = (init_db(&ap).unwrap(), init_db(&bp).unwrap());
    assert_eq!(journal::progress(&a, &route).unwrap().acked, 0);
    assert_eq!(journal::progress(&b, &route.reverse()).unwrap().received, 1);
    assert_eq!(saved::get(&b, &left.record_id).unwrap(), Some(left.clone()));
    // Drop the opposite direction's ACK on the next connection as well.
    assert!(catch_up(&mut a, &route, &ReaderSaves, |req| {
        if matches!(req.operation, Operation::Confirm(_)) {
            return Err("link down".into());
        }
        respond(&mut b, &route.reverse(), req, &ReaderSaves)
    })
    .is_err());
    round(&mut a, &mut b, &route).unwrap();
    round(&mut b, &mut a, &route.reverse()).unwrap();
    for (db, r) in [(&a, route.clone()), (&b, route.reverse())] {
        let p = journal::progress(db, &r).unwrap();
        assert_eq!((p.head, p.acked, p.received), (1, 1, 1));
        assert_eq!(rows(db, "SELECT COUNT(*) FROM saved_records"), 2);
        assert_eq!(saved::get(db, &left.record_id).unwrap(), Some(left.clone()));
        assert_eq!(
            saved::get(db, &right.record_id).unwrap(),
            Some(right.clone())
        );
    }
    assert_eq!(rows(&a, "SELECT count(*) FROM sync_changes"), a_queue);
    assert_eq!(rows(&b, "SELECT count(*) FROM sync_changes"), b_queue);
}

#[test]
fn local_log_failure_and_receiver_commit_failure_roll_back_the_business_write() {
    let dir = tempdir().unwrap();
    let r = pair();
    let (_, mut a) = twin(&dir.path().join("mac"), &r);
    let (_, mut b) = twin(&dir.path().join("phone"), &r.reverse());
    let original = seed(&a, "Take off today.", "今天起飞");
    a.execute_batch("CREATE TRIGGER no_log BEFORE INSERT ON lan_saved_outbox BEGIN SELECT RAISE(ABORT,'injected log failure'); END;").unwrap();
    assert!(saved::mutate(
        &a,
        "failed edit",
        &saved::Mutation::Edit {
            record_id: original.record_id.clone(),
            expected_revision: original.revision.clone(),
            explanation: "new".into()
        }
    )
    .is_err());
    assert_eq!(
        saved::get(&a, &original.record_id).unwrap().unwrap(),
        original
    );
    assert_eq!(
        rows(
            &a,
            "SELECT COUNT(*) FROM saved_actions WHERE operation_id='failed edit'"
        ),
        0
    );
    a.execute_batch("DROP TRIGGER no_log").unwrap();
    let edited = edit(&a, &original, "今天出发");
    b.execute_batch("CREATE TABLE fixture_parent(id INTEGER PRIMARY KEY);
    CREATE TABLE fixture_child(id INTEGER REFERENCES fixture_parent DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER break_commit AFTER INSERT ON lan_saved_inbox BEGIN INSERT INTO fixture_child VALUES(42); END;").unwrap();
    assert!(round(&mut a, &mut b, &r).is_err());
    assert_eq!(journal::progress(&a, &r).unwrap().acked, 0);
    assert_eq!(journal::progress(&b, &r.reverse()).unwrap().received, 0);
    assert_eq!(rows(&b, "SELECT COUNT(*) FROM lan_saved_inbox"), 0);
    assert!(saved::get(&b, &original.record_id).unwrap().is_none());
    b.execute_batch("DROP TRIGGER break_commit").unwrap();
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(
        saved::get(&b, &original.record_id).unwrap().unwrap(),
        edited
    );
    assert_eq!(rows(&b, "SELECT COUNT(*) FROM lan_saved_versions"), 2);
}

#[test]
fn concurrent_edits_delete_and_undo_preserve_versions_across_batches() {
    let dir = tempdir().unwrap();
    let r = pair();
    let (_, mut a) = twin(&dir.path().join("mac"), &r);
    let (_, mut b) = twin(&dir.path().join("phone"), &r.reverse());
    let base = seed(&a, "Take off again.", "再次起飞");
    round(&mut a, &mut b, &r).unwrap();
    let left = edit(&a, &base, "left");
    let right = edit(&b, &base, "right");
    round(&mut b, &mut a, &r.reverse()).unwrap();
    let current = saved::get(&a, &base.record_id).unwrap().unwrap();
    assert_eq!(
        Some(current.clone()),
        saved::get(&b, &base.record_id).unwrap()
    );
    for db in [&a, &b] {
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM lan_saved_versions WHERE rev IN (?1,?2)",
                params![left.revision, right.revision],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            2
        );
    }
    saved::mutate(
        &a,
        "delete",
        &saved::Mutation::Remove {
            record_id: base.record_id.clone(),
            expected_revision: current.revision.clone(),
        },
    )
    .unwrap();
    let mut last = edit(&b, &current, "recoverable");
    for i in 0..70 {
        last = edit(&b, &last, &format!("note {i}"));
    }
    round(&mut a, &mut b, &r).unwrap();
    assert!(saved::get(&b, &base.record_id)
        .unwrap()
        .unwrap()
        .deleted_at
        .is_some());
    assert_eq!(rows(&a,"SELECT COUNT(*) FROM lan_saved_versions WHERE json_extract(snapshot,'$.explanation')='note 69'"),1);
    let restored = saved::undo(&a, "delete").unwrap();
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(saved::get(&b, &base.record_id).unwrap().unwrap(), restored);
}

#[test]
fn restore_deactivates_old_epoch_and_rejects_old_receipts() {
    let dir = tempdir().unwrap();
    let r = pair();
    let (_, mut a) = twin(&dir.path().join("mac"), &r);
    let (_, mut b) = twin(&dir.path().join("phone"), &r.reverse());
    seed(&a, "Take off now.", "起飞");
    let copy = export::backup_payload(&a).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    export::restore_backup(&a, &copy).unwrap();
    assert!(round(&mut a, &mut b, &r).is_err());
    assert_eq!(rows(&a, "SELECT COUNT(*) FROM lan_saved_outbox"), 1);
}

#[test]
fn bad_payload_or_receipt_cannot_advance_durable_progress() {
    let dir = tempdir().unwrap();
    let r = pair();
    let (_, mut a) = twin(&dir.path().join("mac"), &r);
    let (_, mut b) = twin(&dir.path().join("phone"), &r.reverse());
    let original = seed(&a, "Take off soon.", "很快出发");
    let result = catch_up(&mut a, &r, &ReaderSaves, |mut req| {
        if let Operation::Deliver(batch) = &mut req.operation {
            batch.events[0].snapshot.push(' ');
        }
        respond(&mut b, &r.reverse(), req, &ReaderSaves)
    });
    assert!(result.unwrap_err().contains("invalid saved event"));
    assert_eq!(journal::progress(&b, &r.reverse()).unwrap().received, 0);
    let result = catch_up(&mut a, &r, &ReaderSaves, |req| {
        let mut reply = respond(&mut b, &r.reverse(), req, &ReaderSaves)?;
        if let Reply::Applied(ack) = &mut reply {
            ack.digest.clear();
        }
        Ok(reply)
    });
    assert!(result.unwrap_err().contains("checksum mismatch"));
    assert_eq!(journal::progress(&a, &r).unwrap().acked, 0);
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(saved::get(&b, &original.record_id).unwrap(), Some(original));
    assert_eq!(rows(&b, "SELECT COUNT(*) FROM saved_records"), 1);
}

#[test]
fn nonportable_or_unknown_saved_metadata_never_leaves_the_sender() {
    for (field, value) in [
        ("$.source.file_name", "file:///private/example.txt"),
        ("$.future_private_key", "sentinel"),
    ] {
        let dir = tempdir().unwrap();
        let route = pair();
        let (_, mut b) = twin(&dir.path().join("phone"), &route.reverse());
        let pre = dir.path().join("older.db");
        let mut pre_db = init_db(&pre).unwrap();
        seed(&pre_db, "Take off soon.", "很快出发");
        // Model an unsupported snapshot already present at first pairing.
        pre_db
            .execute(
                "UPDATE saved_records SET snapshot_json=json_set(snapshot_json,?1,?2)",
                params![field, value],
            )
            .unwrap();
        saved_delta::prepare(&pre, Uuid::new_v4(), &route).unwrap();
        assert!(catch_up(&mut pre_db, &route, &ReaderSaves, |req| {
            assert!(matches!(req.operation, Operation::Hello));
            respond(&mut b, &route.reverse(), req, &ReaderSaves)
        })
        .is_err());
        assert_eq!(journal::progress(&pre_db, &route).unwrap().offered, 0);
        assert_eq!(rows(&b, "SELECT COUNT(*) FROM saved_records"), 0);
    }
}
