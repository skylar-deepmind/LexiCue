use super::{exchange::*, *};
use crate::commands::{
    import::SegmentInput,
    materials::{self, MaterialInput},
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
fn automatic_duplex_attachments_resume_and_ignore_old_audio_after_deletion() {
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

    let left = crate::db::init_db(&left_path).unwrap();
    let right = crate::db::init_db(&right_path).unwrap();
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

    set_audio_deleted(&right, &deleted_key, true).unwrap();
    sync_round(&left, &left_files, |request| {
        respond(&right, &right_files, request)
    })
    .unwrap();
    for db in [&left, &right] {
        assert!(audio_removed(db, &deleted_key).unwrap());
        let count: i64 = db
            .query_row(
                "SELECT count(*) FROM segments WHERE zh_text='同步测试。'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
    // An old device still has the same bytes and proposes an active state.
    let old = Entry::AudioState {
        key: deleted_key.clone(),
        revision: 1,
        deleted: false,
    };
    respond(&left, &left_files, Request::Offer(old)).unwrap();
    assert!(audio_removed(&left, &deleted_key).unwrap());

    set_audio_deleted(&left, &deleted_key, false).unwrap();
    sync_round(&left, &left_files, |request| {
        respond(&right, &right_files, request)
    })
    .unwrap();
    assert!(!audio_removed(&right, &deleted_key).unwrap());
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
