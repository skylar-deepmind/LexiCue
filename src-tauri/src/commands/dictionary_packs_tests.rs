use super::*;
fn detached() -> Operation {
    Operation(
        Arc::new(AtomicBool::new(false)),
        tempfile::tempfile().unwrap(),
    )
}
fn serve(body: &'static [u8], length: usize) -> (String, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        let _ = stream.read(&mut request);
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let _ = stream.write_all(body);
    });
    (format!("http://{address}/fixture.zip"), thread)
}
#[tokio::test]
async fn download_validates_stream_length_hash_cancellation_and_progress() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("download.zip");
    let op = detached();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let expected = json!({"bytes":3,"sha256":format!("{:x}",Sha256::digest(b"abc"))});
    let (url, server) = serve(b"abc", 3);
    let mut progress = Vec::new();
    fetch_archive(&client, &url, &path, &expected, &op, |n, t| {
        progress.push((n, t))
    })
    .await
    .unwrap();
    server.join().unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"abc");
    assert_eq!(progress.last(), Some(&(3, 3)));
    for (body, length) in [
        (b"abd".as_slice(), 3),
        (b"ab".as_slice(), 3),
        (b"abcd".as_slice(), 4),
    ] {
        let (url, server) = serve(body, length);
        assert!(
            fetch_archive(&client, &url, &path, &expected, &op, |_, _| {})
                .await
                .is_err()
        );
        server.join().unwrap();
    }
    let active = detached();
    let (url, server) = serve(b"abc", 3);
    assert_eq!(
        fetch_archive(&client, &url, &path, &expected, &active, |n, _| {
            if n > 0 {
                active.0.store(true, Ordering::Relaxed);
            }
        })
        .await
        .unwrap_err(),
        "dictionary_pack_cancelled"
    );
    server.join().unwrap();
    op.0.store(true, Ordering::Relaxed);
    assert_eq!(
        fetch_archive(
            &client,
            "http://127.0.0.1:9/no-request",
            &path,
            &expected,
            &op,
            |_, _| {}
        )
        .await
        .unwrap_err(),
        "dictionary_pack_cancelled"
    );
}
#[test]
fn rejects_wrong_pack_and_cleans_staging_on_failure() {
    assert!(optional("daily").is_err());
    assert!(item("../extended").is_err());
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage");
    fs::create_dir(&stage).unwrap();
    let archive = stage.join("wrong.zip");
    fs::write(&archive, b"not a dictionary").unwrap();
    {
        let _stage = Staging(stage.clone());
        assert!(extract(&archive, &stage.join("pack"), "extended", &detached()).is_err());
        assert!(!stage.join("pack").exists());
    }
    assert!(!stage.exists());
}
#[test]
#[ignore = "Uses explicitly supplied genuine optional ZIPs; never user dictionaries"]
fn real_optional_install_merge_remove_and_saved_reference_survives() {
    let inputs = PathBuf::from(
        std::env::var("LEXICUE_DICTIONARY_TEST_ARCHIVES").expect("Set genuine archive directory"),
    );
    let dir = tempfile::tempdir().unwrap();
    let installed = dir.path().join("packs");
    configure_test(installed.clone());
    assert_eq!(query_configured("ichthyology", None)["status"], "not_found");
    for id in ["specialist", "extended"] {
        let spec = item(id).unwrap();
        install_test(id, &inputs.join(local::text(spec, "filename"))).unwrap();
    }
    assert_eq!(
        status_configured().unwrap()["packs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["installed"] == true)
            .count(),
        3
    );
    let result = query_configured("ichthyology", None);
    assert_eq!(result["status"], "found");
    assert_ne!(query_configured("monodrama", None)["status"], "not_found");
    let entry = &result["entries"][0];
    let group = &entry["groups"][0];
    let sense = &group["senses"][0];
    let snapshot = json!({"schema_version":1,"headword":entry["headword"],"source":entry["source"],"entry_id":entry["id"],"group_id":group["id"],"sense_id":sense["id"],"part_of_speech":group["part_of_speech"],"meaning":sense["meaning"],"labels":[],"examples":[],"patterns":[],"source_path":sense["source_path"],"content_kind":sense["content_kind"],"ancestors":sense["ancestors"]});
    let conn = crate::db::init_db(&dir.path().join("learning.db")).unwrap();
    conn.execute_batch("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'fixture.txt','txt','ichthyology','fixture',1);INSERT INTO segments(id,file_id,index_num,en_text) VALUES(1,1,0,'ichthyology');").unwrap();
    let mutation=serde_json::from_value(json!({"kind":"save","input":{"segment_id":1,"expression":"ichthyology","start_offset":0,"end_offset":11,"explanation":null,"explanation_source":"unknown","dictionary_reference":{"schema_version":1,"kind":"dictionary_excerpt","headword":entry["headword"],"senses":[snapshot]}}})).unwrap();
    let saved = super::super::saved::mutate(&conn, "pack-optional-save", &mutation)
        .unwrap()
        .record;
    let paths = [
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources/dictionaries/daily/dictionary.sqlite3"),
        installed.join("extended/dictionary.sqlite3"),
        installed.join("specialist/dictionary.sqlite3"),
    ];
    let a = paths
        .iter()
        .zip(["daily", "extended", "specialist"])
        .map(|(p, id)| Pack::open(p, id).unwrap())
        .collect::<Vec<_>>();
    let mut b = paths
        .iter()
        .zip(["daily", "extended", "specialist"])
        .rev()
        .map(|(p, id)| Pack::open(p, id).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        local::query(&a, "field", None).unwrap(),
        local::query(&b, "field", None).unwrap()
    );
    b.clear();
    drop(a);
    remove("specialist").unwrap();
    remove("extended").unwrap();
    assert_eq!(query_configured("ichthyology", None)["status"], "not_found");
    assert_eq!(query_configured("pneumonia", None)["status"], "found");
    assert_eq!(
        super::super::saved::get(&conn, &saved.record_id)
            .unwrap()
            .unwrap(),
        saved
    );
    let backup = super::super::export::backup_payload(&conn).unwrap();
    let restored = crate::db::init_db(&dir.path().join("restored.db")).unwrap();
    super::super::export::restore_backup(&restored, &backup).unwrap();
    assert_eq!(
        super::super::saved::get(&restored, &saved.record_id)
            .unwrap()
            .unwrap()
            .dictionary_reference,
        saved.dictionary_reference
    );
    assert!(!fs::read_dir(&installed).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".staging-")));
}
