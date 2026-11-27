use super::{exchange::*, *};
use crate::commands::{
    import::SegmentInput,
    materials::{self, MaterialInput},
    saved::{self, Mutation, SaveInput},
    source_media::AudioTrack,
};
use crate::lan_sync::saved_delta::ReaderSaves;
use lexicue_lan_journal::{self as journal, session, Route};
use uuid::Uuid;

fn material(video: &str, sentence: &str) -> MaterialInput {
    let content = format!("1\n00:00:01,000 --> 00:00:02,500\n{sentence}\n");
    let source = YoutubeSource::from_imported_captions(
        video,
        "Test source".into(),
        4_000,
        "en",
        &content,
        "manual",
        Some(AudioTrack {
            format_id: "140".into(),
            language: "en".into(),
            language_basis: "metadata".into(),
        }),
    )
    .unwrap();
    MaterialInput {
        operation_id: Uuid::new_v4().to_string(),
        name: format!("{video}.srt"),
        content,
        segments: vec![SegmentInput {
            index: 0,
            en_text: sentence.into(),
            zh_text: Some("同步测试。".into()),
            start_time: Some("00:00:01.000".into()),
            end_time: Some("00:00:02.500".into()),
        }],
        source: Some(source),
        document: None,
        tag_ids: Vec::new(),
        new_tag_names: Vec::new(),
        normalized_kind: None,
    }
}

fn seed(
    db: &Connection,
    dir: &Path,
    video: &str,
    sentence: &str,
    bytes: &[u8],
) -> (String, String) {
    let input = material(video, sentence);
    materials::import_material(db, &input).unwrap();
    let source = input.source.unwrap();
    let hash = media::digest(bytes);
    let manifest = Manifest {
        video_id: video.into(),
        format_id: "140".into(),
        language: "en".into(),
        language_basis: "metadata".into(),
        codec: "aac".into(),
        bytes: bytes.len() as u64,
        duration_ms: 4_000,
        start_ms: 0,
        offset_ms: 0,
        sha256: hash.clone(),
    };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode(&vec![91; 120 * 90], 120, 90, image::ExtendedColorType::L8)
        .unwrap();
    store_cover(db, video, &jpeg).unwrap();
    fs::write(dir.join(format!("{hash}.m4a")), bytes).unwrap();
    db.execute(
        "INSERT INTO source_media VALUES(?,?,?,'ready',NULL,?,0)",
        params![
            source.key,
            serde_json::to_string(&source).unwrap(),
            hash,
            serde_json::to_string(&manifest).unwrap()
        ],
    )
    .unwrap();
    (source.key, hash)
}

#[test]
fn automatic_duplex_attachments_resume_and_delete_with_material_while_saves_survive() {
    let temp = tempfile::tempdir().unwrap();
    let left_path = temp.path().join("left.db");
    let right_path = temp.path().join("right.db");
    let mut left = crate::db::init_db(&left_path).unwrap();
    let mut right = crate::db::init_db(&right_path).unwrap();
    let left_files = temp.path().join("left");
    let right_files = temp.path().join("right");
    fs::create_dir(&left_files).unwrap();
    fs::create_dir(&right_files).unwrap();
    let small = vec![6; 85_000];
    let long = vec![91; 2 * 1024 * 1024];
    let (deleted_key, left_hash) = seed(
        &left,
        &left_files,
        "abcdefghijk",
        "The original version begins here.",
        &long,
    );
    let (right_key, right_hash) = seed(
        &right,
        &right_files,
        "abcdefghijl",
        "The other device has a different sentence.",
        &small,
    );
    let route = Route {
        pair: Uuid::new_v4(),
        from: Uuid::new_v4(),
        to: Uuid::new_v4(),
    };
    journal::install_library(&mut left, &route).unwrap();
    journal::install_library(&mut right, &route.reverse()).unwrap();
    let supports = session::catch_up_capabilities(&mut left, &route, &ReaderSaves, |request| {
        session::respond(&mut right, &route.reverse(), request, &ReaderSaves)
    })
    .unwrap();
    assert!(supports);
    let first = sync_round(&left, &left_files, |request| {
        if matches!(&request, Request::Write { entry: Entry::Audio { .. }, offset, .. } if *offset > 0)
        {
            return Err("link disconnected".into());
        }
        respond(&right, &right_files, request)
    });
    assert_eq!(first.unwrap_err(), "link disconnected");
    assert!(!right_files.join(format!("{left_hash}.m4a")).exists());
    assert_eq!(
        fs::read(left_files.join(format!("{right_hash}.m4a"))).unwrap(),
        small
    );
    drop((left, right));

    let mut left = crate::db::init_db(&left_path).unwrap();
    let mut right = crate::db::init_db(&right_path).unwrap();
    let mut resumed_at = None;
    let status = sync_round(&left, &left_files, |request| {
        if let Request::Write {
            entry: Entry::Audio { .. },
            offset,
            ..
        } = &request
        {
            resumed_at.get_or_insert(*offset);
        }
        // The exchange is serialized on the native transport.
        respond(
            &right,
            &right_files,
            serde_json::from_value(serde_json::to_value(request).unwrap()).unwrap(),
        )
    })
    .unwrap();
    assert!(!status.pending);
    assert!(resumed_at.is_some_and(|offset| offset > 0));
    assert_eq!(
        fs::read(right_files.join(format!("{left_hash}.m4a"))).unwrap(),
        long
    );
    for db in [&left, &right] {
        assert_eq!(
            db.query_row("SELECT count(*) FROM library_youtube_artwork", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            media::bound_hash(db, &right_key).unwrap().as_deref(),
            Some(right_hash.as_str())
        );
    }

    // Save from the Mac while the other device deletes the source offline.
    let segment_id: i64 = left
        .query_row(
            "SELECT s.id FROM segments s JOIN files f ON f.id=s.file_id WHERE f.media_identity=?",
            [&deleted_key],
            |row| row.get(0),
        )
        .unwrap();
    let record = saved::mutate(
        &left,
        "favorite-before-delete",
        &Mutation::Save {
            input: SaveInput {
                segment_id,
                expression: "original".into(),
                start_offset: 4,
                end_offset: 12,
                explanation: Some("A personal meaning from the subtitle.".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap()
    .record;
    assert_eq!(
        record.sentence.as_deref(),
        Some("The original version begins here.")
    );
    let old_audio = list(&left, "")
        .unwrap()
        .into_iter()
        .find(|entry| matches!(entry, Entry::Audio { key, .. } if key == &deleted_key))
        .unwrap();

    right
        .execute("DELETE FROM files WHERE media_identity=?", [&deleted_key])
        .unwrap();
    cleanup_deleted(&right, &right_files, &right_files).unwrap();
    session::catch_up_capabilities(&mut left, &route, &ReaderSaves, |request| {
        session::respond(&mut right, &route.reverse(), request, &ReaderSaves)
    })
    .unwrap();
    cleanup_deleted(&left, &left_files, &left_files).unwrap();
    sync_round(&left, &left_files, |request| {
        respond(&right, &right_files, request)
    })
    .unwrap();

    for (db, dir) in [(&left, &left_files), (&right, &right_files)] {
        assert_eq!(media::bound_hash(db, &deleted_key).unwrap(), None);
        assert!(!dir.join(format!("{left_hash}.m4a")).exists());
        assert!(dir.join(format!("{right_hash}.m4a")).exists());
        assert!(!cover_attached(db, "abcdefghijk").unwrap());
        assert_eq!(
            db.query_row("SELECT video_id FROM library_youtube_artwork", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "abcdefghijl"
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM segments", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        let kept = saved::get(db, &record.record_id).unwrap().unwrap();
        assert_eq!(kept.sentence, record.sentence);
        assert_eq!(kept.sentence_translation, record.sentence_translation);
        assert_eq!(kept.explanation, record.explanation);
        assert!(saved::resolve_source(db, &record.record_id)
            .unwrap()
            .is_none());
        assert!(matches!(
            respond(db, dir, Request::Offer(old_audio.clone())).unwrap(),
            Reply::Need(Need::Done)
        ));
    }

    // Verify the reverse deletion using the same pair.
    left.execute("DELETE FROM files WHERE media_identity=?", [&right_key])
        .unwrap();
    cleanup_deleted(&left, &left_files, &left_files).unwrap();
    session::catch_up_capabilities(&mut left, &route, &ReaderSaves, |request| {
        session::respond(&mut right, &route.reverse(), request, &ReaderSaves)
    })
    .unwrap();
    cleanup_deleted(&right, &right_files, &right_files).unwrap();
    assert!(!right_files.join(format!("{right_hash}.m4a")).exists());
    assert!(list(&right, "").unwrap().is_empty());
    assert!(saved::get(&right, &record.record_id).unwrap().is_some());
}

#[test]
fn complete_archive_restores_covers_and_original_audio_with_a_portable_library() {
    let temp = tempfile::tempdir().unwrap();
    let from_dir = temp.path().join("source-attachments");
    let to_dir = temp.path().join("target-attachments");
    fs::create_dir(&from_dir).unwrap();
    fs::create_dir(&to_dir).unwrap();
    let source = crate::db::init_db(&temp.path().join("source.db")).unwrap();
    let target = crate::db::init_db(&temp.path().join("target.db")).unwrap();
    let data = vec![25; 420_000];
    let (key, hash) = seed(
        &source,
        &from_dir,
        "abcdefghijk",
        "A complete backup keeps this context.",
        &data,
    );
    let filename = temp.path().join("fixture.lexicuebackup");
    backup::export_archive(&source, &from_dir, &filename).unwrap();
    let prepared = backup::prepare_archive(&filename, &to_dir).unwrap();
    crate::commands::export::restore_with_attachments(&target, &prepared.payload, |tx| {
        prepared.install(tx, &to_dir)
    })
    .unwrap();
    assert_eq!(
        media::bound_hash(&target, &key).unwrap().as_deref(),
        Some(hash.as_str())
    );
    assert_eq!(fs::read(to_dir.join(format!("{hash}.m4a"))).unwrap(), data);
    let artwork: Vec<u8> = target
        .query_row("SELECT data FROM library_youtube_artwork", [], |r| r.get(0))
        .unwrap();
    let expected: Vec<u8> = source
        .query_row("SELECT data FROM library_youtube_artwork", [], |r| r.get(0))
        .unwrap();
    assert_eq!(artwork, expected);
    assert_eq!(
        materials::open(&target, 1).unwrap().segments[0]
            .zh_text
            .as_deref(),
        Some("同步测试。")
    );
}

#[test]
fn last_material_reference_removes_shared_files_and_interrupted_transfers() {
    let temp = tempfile::tempdir().unwrap();
    let dir = temp.path();
    let db = crate::db::init_db(&dir.join("library.db")).unwrap();
    let video = "abcdefghijk";
    let (first, hash) = seed(&db, dir, video, "First library entry.", b"shared audio");
    let (second, _) = seed(&db, dir, video, "Second library entry.", b"shared audio");
    let original = media::digest(b"test original");
    let partial_audio = dir.join(format!(".lan-{first}-{hash}.part"));
    let partial_document = dir.join(format!(".lan-{original}-{original}.part"));
    let legacy_cover = dir.join(format!("{video}.jpg"));
    for staged in [&partial_audio, &partial_document, &legacy_cover] {
        fs::write(staged, b"partial").unwrap();
    }
    let source_document = serde_json::json!({"source_sha256": original}).to_string();
    db.execute("UPDATE files SET document_source=?", [source_document])
        .unwrap();
    fs::write(original_path(dir, &original), b"test original").unwrap();
    put_original(&db, &original, 13).unwrap();

    // A failed transaction must not enqueue deletion.
    let tx = db.unchecked_transaction().unwrap();
    tx.execute("DELETE FROM files WHERE media_identity=?", [&first])
        .unwrap();
    tx.rollback().unwrap();
    cleanup_deleted(&db, dir, dir).unwrap();
    assert!(partial_audio.exists());

    db.execute("DELETE FROM files WHERE media_identity=?", [&first])
        .unwrap();
    cleanup_deleted(&db, dir, dir).unwrap();
    assert!(!partial_audio.exists());
    assert_eq!(media::bound_hash(&db, &first).unwrap(), None);
    assert!(dir.join(format!("{hash}.m4a")).exists());
    assert!(original_path(dir, &original).exists());
    assert!(legacy_cover.exists());
    assert!(partial_document.exists());

    db.execute("DELETE FROM files WHERE media_identity=?", [&second])
        .unwrap();
    drop(db);
    let reopened = crate::db::init_db(&dir.join("library.db")).unwrap();
    cleanup_deleted(&reopened, dir, dir).unwrap();
    assert!(!dir.join(format!("{hash}.m4a")).exists());
    assert!(!original_path(dir, &original).exists());
    assert!(!partial_document.exists());
    assert!(!legacy_cover.exists());
    assert!(list(&reopened, "").unwrap().is_empty());
    assert_eq!(reopened.query_row("SELECT (SELECT count(*) FROM library_document_originals)
       +(SELECT count(*) FROM library_youtube_artwork)+(SELECT count(*) FROM library_attachment_cleanup)",
       [], |row| row.get::<_, i64>(0)).unwrap(), 0);
}
