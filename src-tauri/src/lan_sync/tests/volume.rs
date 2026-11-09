//! Reproducible storage/merge measurement with a deliberately stalled link.
use crate::commands::{import::SegmentInput, materials};
use crate::db::init_db;
use crate::lan_sync::{prepare_library, saved_delta::ReaderSaves};
use lexicue_lan_journal::{
    session::{self, Operation},
    Route,
};
use rusqlite::Connection;
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[test]
#[ignore = "50 MiB two-library benchmark; run explicitly with --ignored --nocapture"]
fn volume_and_foreground_writes() {
    let temp = tempfile::tempdir().unwrap();
    let mac = temp.path().join("mac.db");
    let phone = temp.path().join("phone.db");
    let a = init_db(&mac).unwrap();
    let b = init_db(&phone).unwrap();
    let route = Route {
        pair: Uuid::new_v4(),
        from: Uuid::new_v4(),
        to: Uuid::new_v4(),
    };
    let line = "A long sentence keeps the original context for a saved expression. ".repeat(39);
    let mut bytes = 0;
    let mut file = 0;
    let mut n = 0;
    while bytes < 50 * 1024 * 1024 {
        let segments: Vec<_> = (0..512)
            .map(|i| SegmentInput {
                index: i,
                en_text: format!("Material {n}, sentence {i}. {line}"),
                zh_text: Some(format!("已有译文 {i}")),
                start_time: None,
                end_time: None,
            })
            .collect();
        let content = segments
            .iter()
            .map(|s| s.en_text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        bytes += content.len();
        file = materials::import_material(
            &a,
            &materials::MaterialInput {
                operation_id: Uuid::new_v4().to_string(),
                name: format!("Lecture {n}.txt"),
                content,
                segments,
                source: None,
                document: None,
                normalized_kind: Some("txt".into()),
            },
        )
        .unwrap()
        .file_id;
        n += 1;
    }
    let start = Instant::now();
    prepare_library(&mac, route.pair, &route).unwrap();
    prepare_library(&phone, route.pair, &route.reverse()).unwrap();
    let prepared = start.elapsed();
    let foreground = Connection::open(&mac).unwrap();
    foreground.busy_timeout(Duration::from_secs(2)).unwrap();
    let (stalled, resume) = mpsc::sync_channel(0);
    let (release, wait) = mpsc::sync_channel(0);
    let worker = std::thread::spawn(move || {
        let (mut a, mut b) = (a, b);
        let mut first = true;
        session::catch_up(&mut a, &route, &ReaderSaves, |req| {
            if first && matches!(req.operation, Operation::PutChunk(_)) {
                first = false;
                stalled.send(()).unwrap();
                wait.recv_timeout(Duration::from_secs(30)).unwrap();
            }
            session::respond(&mut b, &route.reverse(), req, &ReaderSaves)
        })
        .unwrap();
        session::catch_up(&mut a, &route, &ReaderSaves, |req| {
            session::respond(&mut b, &route.reverse(), req, &ReaderSaves)
        })
        .unwrap();
        let count: i64 = b
            .query_row("SELECT count(*) FROM files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, n);
        let last: String = b
            .query_row(
                "SELECT zh_text FROM segments WHERE zh_text='离线回读'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(last, "离线回读");
    });
    resume.recv_timeout(Duration::from_secs(30)).unwrap();
    let local = Instant::now();
    let english: String = foreground
        .query_row(
            "SELECT en_text FROM segments WHERE file_id=? AND index_num=0",
            [file],
            |row| row.get(0),
        )
        .unwrap();
    assert!(english.contains("original context"));
    assert_eq!(
        foreground
            .execute(
                "UPDATE segments SET zh_text='离线回读' WHERE file_id=? AND index_num=0",
                [file]
            )
            .unwrap(),
        1
    );
    let local_latency = local.elapsed();
    release.send(()).unwrap();
    worker.join().unwrap();
    println!("{} files, {} source bytes; backups + baselines {:?}; total {:?}; foreground read + committed edit during suspended link {:?}",n,bytes,prepared,start.elapsed(),local_latency);
}
