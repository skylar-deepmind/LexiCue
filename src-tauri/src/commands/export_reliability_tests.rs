//! Bounded disposable SQLite fault checks. SIGKILL is process interruption, not
//! a claim of physical power-loss testing. max_page_count never fills the disk.
use super::*;
use rusqlite::{Connection, TransactionBehavior};
use std::{
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn seed(conn: &Connection, label: &str) {
    conn.execute("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,?1,'txt',?1,?1,1)",[label]).unwrap();
    conn.execute("INSERT INTO file_tag_state(file_id) VALUES(1)", [])
        .unwrap();
    conn.execute(
        "INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,?1)",
        [label],
    )
    .unwrap();
}
fn portable(conn: &Connection) -> serde_json::Value {
    serde_json::to_value(backup_payload(conn).unwrap().data).unwrap()
}
fn assert_integrity(conn: &Connection) {
    assert_eq!(
        conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        0
    );
}

#[test]
#[ignore = "subprocess worker invoked only with explicit disposable paths by parent fault test"]
fn restore_process_worker() {
    let path = std::path::PathBuf::from(std::env::var("LEXICUE_FAULT_DB").expect("disposable DB"));
    let marker = std::path::PathBuf::from(std::env::var("LEXICUE_FAULT_MARKER").expect("marker"));
    let phase = std::env::var("LEXICUE_FAULT_PHASE").unwrap();
    let input: BackupPayload =
        serde_json::from_slice(&std::fs::read(path.with_extension("json")).unwrap()).unwrap();
    let conn = crate::db::init_db(&path).unwrap();
    crate::db::consistent_backup(&conn, &path, "lexicue-pre-restore").unwrap();
    let transaction =
        rusqlite::Transaction::new_unchecked(&conn, TransactionBehavior::Immediate).unwrap();
    // Exercise production replacement statements, not a test imitation.
    restore_rows(&conn, &input).unwrap();
    if phase == "after-commit" {
        transaction.commit().unwrap();
    }
    std::fs::write(marker, b"ready").unwrap();
    // Parent deterministically SIGKILLs this disposable worker at this boundary.
    std::thread::sleep(Duration::from_secs(30));
}

#[test]
fn process_kill_at_restore_commit_boundary_preserves_one_complete_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let source = crate::db::init_db(&dir.path().join("incoming.db")).unwrap();
    seed(&source, "After replacement.");
    let incoming = backup_payload(&source).unwrap();
    for phase in ["before-commit", "after-commit"] {
        let case = dir.path().join(phase);
        std::fs::create_dir(&case).unwrap();
        let path = case.join("target.db");
        let conn = crate::db::init_db(&path).unwrap();
        seed(&conn, "Before replacement.");
        let before = portable(&conn);
        let original_queue = query_all(&conn, "sync_changes").unwrap();
        drop(conn);
        std::fs::write(
            path.with_extension("json"),
            serde_json::to_vec(&incoming).unwrap(),
        )
        .unwrap();
        let marker = case.join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "commands::export::reliability_tests::restore_process_worker",
                "--ignored",
                "--exact",
            ])
            .env("LEXICUE_FAULT_DB", &path)
            .env("LEXICUE_FAULT_MARKER", &marker)
            .env("LEXICUE_FAULT_PHASE", phase)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(15);
        while !marker.exists() {
            if let Some(exit) = child.try_wait().unwrap() {
                panic!("fault worker exited before boundary: {exit}");
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("fault worker boundary timeout");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        child.kill().unwrap();
        assert!(!child.wait().unwrap().success());
        let reopened = crate::db::init_db(&path).unwrap();
        assert_integrity(&reopened);
        let expected = if phase == "before-commit" {
            before.clone()
        } else {
            serde_json::to_value(&incoming.data).unwrap()
        };
        assert_eq!(
            portable(&reopened),
            expected,
            "{phase}: complete old/new snapshot only"
        );
        if phase == "before-commit" {
            assert_eq!(
                query_all(&reopened, "sync_changes").unwrap(),
                original_queue
            );
        }
        let copies: Vec<_> = std::fs::read_dir(case.join("backups")).unwrap().collect();
        assert_eq!(copies.len(), 1);
        let copy = Connection::open(copies[0].as_ref().unwrap().path()).unwrap();
        assert_integrity(&copy);
        assert_eq!(
            portable(&copy),
            before,
            "{phase}: pre-restore safety copy remains independently readable"
        );
    }
}

#[test]
fn database_page_limit_causes_real_sqlite_full_and_atomic_manual_restore_failure() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("full.db");
    let conn = crate::db::init_db(&path).unwrap();
    seed(&conn, "Before constrained restore.");
    let before = portable(&conn);
    let queue = query_all(&conn, "sync_changes").unwrap();
    let mut oversized = backup_payload(&conn).unwrap();
    oversized.data.files[0]["content"] =
        serde_json::json!("Synthetic large replacement content. ".repeat(32_768));
    let pages: i64 = conn
        .query_row("PRAGMA page_count", [], |r| r.get(0))
        .unwrap();
    conn.execute_batch(&format!("PRAGMA max_page_count={}", pages + 4))
        .unwrap();
    let error = restore_with_safety_backup(&conn, &oversized).unwrap_err();
    assert!(
        error.starts_with("restore_failed; safety_backup_path="),
        "{error}"
    );
    assert!(
        error.contains("full"),
        "must be actual SQLITE_FULL, not injected failure: {error}"
    );
    assert!(conn.is_autocommit());
    assert_integrity(&conn);
    assert_eq!(portable(&conn), before);
    assert_eq!(query_all(&conn, "sync_changes").unwrap(), queue);
    assert_eq!(
        std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
    // Recover normally after removing only the artificial per-DB page limit.
    conn.execute_batch("PRAGMA max_page_count=1073741823")
        .unwrap();
    restore_backup(&conn, &oversized).unwrap();
    assert_integrity(&conn);
}

#[test]
fn bounded_five_thousand_sentence_backup_restore_sanity_preserves_all_rows() {
    let dir = tempfile::tempdir().unwrap();
    let source = crate::db::init_db(&dir.path().join("source.db")).unwrap();
    seed(&source, "Synthetic bounded material.");
    let transaction =
        rusqlite::Transaction::new_unchecked(&source, TransactionBehavior::Immediate).unwrap();
    for index in 1..5_000 {
        transaction.execute("INSERT INTO segments(file_id,index_num,en_text,zh_text) VALUES(1,?1,?2,'合成验收原句')",rusqlite::params![index,format!("This synthetic sentence number {index} checks a bounded backup and restore without private material.")]).unwrap();
    }
    transaction.commit().unwrap();
    let input = backup_payload(&source).unwrap();
    assert_eq!(input.data.segments.len(), 5_000);
    let target = crate::db::init_db(&dir.path().join("target.db")).unwrap();
    let result = restore_with_safety_backup(&target, &input).unwrap();
    assert!(Path::new(&result.safety_backup_path).is_file());
    assert_integrity(&target);
    assert_eq!(portable(&target), serde_json::to_value(input.data).unwrap());
}
