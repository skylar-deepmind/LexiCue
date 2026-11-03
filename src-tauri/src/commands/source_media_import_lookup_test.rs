use super::*;
use crate::commands::{import::SegmentInput, materials, saved};
fn base() -> YoutubeSource {
    super::tests::source("abcdefghijk")
}
fn one_cue(start: i64, end: i64) -> YoutubeSource {
    let mut s = base();
    s.cues = vec![Cue {
        id: 0,
        start_ms: start,
        end_ms: end,
        text: "Tail words.".into(),
    }];
    s
}
fn target(s: &YoutubeSource) -> MediaRef {
    MediaRef {
        source: s.clone(),
        cue_ids: vec![0],
        start_ms: s.cues[0].start_ms,
        end_ms: s.cues[0].end_ms,
        precision: "cue".into(),
        padding_before_ms: 0,
        padding_after_ms: 0,
        expected_sha256: None,
    }
}
fn put_asset(c: &Connection, dir: &Path, s: &YoutubeSource, duration: i64) {
    let bytes = b"contract fixture only, native decoding is tested separately";
    let hash = digest(bytes);
    std::fs::write(asset_path(dir, &hash).unwrap(), bytes).unwrap();
    let m = Manifest {
        video_id: s.video_id.clone(),
        format_id: s.audio.as_ref().unwrap().format_id.clone(),
        language: "en".into(),
        language_basis: "metadata".into(),
        codec: "aac".into(),
        bytes: bytes.len() as u64,
        duration_ms: duration,
        start_ms: 0,
        offset_ms: 0,
        sha256: hash.clone(),
    };
    c.execute("INSERT INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at)VALUES(?1,?2,?3,'ready',?4,0)",params![s.key,serde_json::to_string(s).unwrap(),hash,serde_json::to_string(&m).unwrap()]).unwrap();
}
#[test]
fn bounded_caption_tail_preserves_declaration_and_clamps_only_playback() {
    for end in [7800, 8200, 10320] {
        let d = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&d.path().join("db")).unwrap();
        let s = one_cue(6000, end);
        s.validate().unwrap();
        let r = reference_for_segment(
            &s,
            "Tail words.",
            Some("00:00:06.000"),
            Some(&format!("00:00:{:02}.{:03}", end / 1000, end % 1000)),
            None,
        )
        .unwrap();
        r.validate().unwrap();
        assert_eq!(r.end_ms, end);
        put_asset(&c, d.path(), &s, 8000);
        let p = resolve(&c, d.path(), &r).unwrap();
        assert_eq!(p.end_ms, end.min(8000));
        assert_eq!(p.duration_ms, 8000);
    }
    for (start, end) in [(6000, 14000), (-1, 7000), (6000, 6000), (7000, 6000)] {
        assert!(one_cue(start, end).validate().is_err());
    }
    // Portable cue times are integer milliseconds; non-finite/overflow and
    // fractional JSON values must fail before they can reach a playback range.
    for invalid in ["NaN", "Infinity", "1e999", "0.5"] {
        assert!(serde_json::from_str::<Cue>(&format!(
            r#"{{"id":0,"start_ms":{invalid},"end_ms":7000,"text":"Tail words."}}"#
        ))
        .is_err());
        assert!(serde_json::from_str::<Cue>(&format!(
            r#"{{"id":0,"start_ms":6000,"end_ms":{invalid},"text":"Tail words."}}"#
        ))
        .is_err());
    }
    let after = one_cue(8100, 9000);
    after.validate().unwrap();
    assert!(reference_for_segment(
        &after,
        "Tail words.",
        Some("00:00:08.100"),
        Some("00:00:09.000"),
        None
    )
    .is_none());
    let d = tempfile::tempdir().unwrap();
    let c = crate::db::init_db(&d.path().join("db")).unwrap();
    put_asset(&c, d.path(), &after, 8000);
    assert!(resolve(&c, d.path(), &target(&after)).is_err());
}
#[test]
fn original_english_selection_and_metadata_failures_are_explicit() {
    let track = youtube::SubtitleTrack {
        lang: "en-orig".into(),
        language: "en".into(),
        is_auto: true,
        source: SubtitleSource::Original,
        source_language: Some("en".into()),
    };
    let content = "1\n00:00:06,000 --> 00:00:10,320\nTail words.\n";
    let metadata = serde_json::json!({"duration":8,"language":"en-US","formats":[{"format_id":"a-original","vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","language":"en-US","format_note":"English original (default)","abr":120},{"format_id":"a-dub","vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","language":"en-US","format_note":"English dubbed","abr":200},{"format_id":"b","vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","language":"fr","abr":300}]});
    let s = checked_source_from_subtitles("abcdefghijk", &track, content, &metadata).unwrap();
    assert_eq!(s.audio.unwrap().format_id, "a-original");
    let foreign = serde_json::json!({"duration":8,"language":"es","formats":[{"format_id":"en-dub","vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","language":"en","format_note":"English dubbed"},{"format_id":"es","vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","language":"es","format_note":"Spanish original"}]});
    assert!(
        checked_source_from_subtitles("abcdefghijk", &track, content, &foreign)
            .unwrap()
            .audio
            .is_none()
    );
    let mut translated = track.clone();
    translated.source = SubtitleSource::Translated;
    assert!(
        checked_source_from_subtitles("abcdefghijk", &translated, content, &metadata)
            .unwrap()
            .audio
            .is_none()
    );
    assert_eq!(
        checked_source_from_subtitles("abcdefghijk", &track, content, &serde_json::json!({}))
            .unwrap_err(),
        "media_metadata_missing"
    );
    let changed = checked_source_from_subtitles(
        "abcdefghijk",
        &track,
        &content.replace("Tail", "Changed"),
        &metadata,
    )
    .unwrap();
    let original =
        checked_source_from_subtitles("abcdefghijk", &track, content, &metadata).unwrap();
    assert_ne!(changed.key, original.key);
}
#[test]
fn tail_saved_snapshot_round_trips_without_rewriting_declared_times() {
    let d = tempfile::tempdir().unwrap();
    let c = crate::db::init_db(&d.path().join("db")).unwrap();
    let source = one_cue(6000, 10320);
    let input = materials::MaterialInput {
        document: None,
        normalized_kind: None,
        operation_id: "tail".into(),
        name: "tail.srt".into(),
        content: "1\n00:00:06,000 --> 00:00:10,320\nTail words.\n".into(),
        segments: vec![SegmentInput {
            index: 0,
            en_text: "Tail words.".into(),
            zh_text: None,
            start_time: Some("00:00:06.000".into()),
            end_time: Some("00:00:10.320".into()),
        }],
        source: Some(source.clone()),
    };
    let id = materials::import_material(&c, &input).unwrap().file_id;
    let opened = materials::open(&c, id).unwrap();
    put_asset(&c, d.path(), &source, 8000);
    let full = resolve_reading(
        &c,
        d.path(),
        &ReadingMediaTarget {
            file_id: id,
            segment_id: opened.segments[0].id,
            source_key: source.key.clone(),
        },
    )
    .unwrap();
    assert_eq!(full.anchors[0].end_ms, 8000);
    let record = saved::mutate(
        &c,
        "save-tail",
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: opened.segments[0].id,
                expression: "Tail".into(),
                start_offset: 0,
                end_offset: 4,
                explanation: Some("Personal meaning".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap()
    .record;
    assert_eq!(
        record
            .source
            .as_ref()
            .unwrap()
            .media
            .as_ref()
            .unwrap()
            .end_ms,
        10320
    );
    let payload = crate::commands::export::backup_payload(&c).unwrap();
    let fresh = crate::db::init_db(&d.path().join("fresh")).unwrap();
    crate::commands::export::restore_backup(&fresh, &payload).unwrap();
    let restored = saved::get(&fresh, &record.record_id).unwrap().unwrap();
    assert_eq!(restored, record);
    restored.source.unwrap().media.unwrap().validate().unwrap();
}
#[test]
#[ignore = "uses captured public-video fixture under /tmp, no network or real user DB"]
fn actual_video_exact_reimport_preserves_ids_translations_and_saved_records() {
    let x: serde_json::Value = serde_json::from_slice(
        &std::fs::read("/tmp/lexicue-import-lookup-qa/real-fixture.json").unwrap(),
    )
    .unwrap();
    let d = tempfile::tempdir().unwrap();
    let c = crate::db::init_db(&d.path().join("db")).unwrap();
    let mut input = materials::MaterialInput {
        document: None,
        normalized_kind: None,
        operation_id: "before".into(),
        name: x["name"].as_str().unwrap().into(),
        content: x["content"].as_str().unwrap().into(),
        segments: serde_json::from_value(x["segments"].clone()).unwrap(),
        source: None,
    };
    let id = materials::import_material(&c, &input).unwrap().file_id;
    let original = materials::open(&c, id).unwrap();
    assert_eq!(original.segments.len(), 206);
    c.execute(
        "UPDATE segments SET zh_text='Keep my edited translation' WHERE id=?1",
        [original.segments[0].id],
    )
    .unwrap();
    let record = saved::mutate(
        &c,
        "before-save",
        &saved::Mutation::Save {
            input: saved::SaveInput {
                segment_id: original.segments[0].id,
                expression: "Last".into(),
                start_offset: 0,
                end_offset: 4,
                explanation: Some("Keep my personal explanation".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        },
    )
    .unwrap()
    .record;
    input.operation_id = "recover".into();
    input.source = Some(serde_json::from_value(x["source"].clone()).unwrap());
    let result = materials::import_material(&c, &input).unwrap();
    assert_eq!(result.file_id, id);
    assert_eq!(result.outcome, "duplicate");
    let recovered = materials::open(&c, id).unwrap();
    assert_eq!(
        recovered.segments.iter().map(|s| s.id).collect::<Vec<_>>(),
        original.segments.iter().map(|s| s.id).collect::<Vec<_>>()
    );
    assert_eq!(
        recovered.segments[0].zh_text.as_deref(),
        Some("Keep my edited translation")
    );
    assert_eq!(saved::get(&c, &record.record_id).unwrap().unwrap(), record);
    assert!(recovered.material.source.is_some());
    input.operation_id = "recover-again".into();
    assert_eq!(materials::import_material(&c, &input).unwrap().file_id, id);
    input.operation_id = "before".into();
    input.source = None;
    assert_eq!(materials::import_material(&c, &input).unwrap().file_id, id);
    let edited = crate::db::init_db(&d.path().join("edited")).unwrap();
    input.operation_id = "edited-before".into();
    let source = Some(serde_json::from_value(x["source"].clone()).unwrap());
    input.source = None;
    let old_id = materials::import_material(&edited, &input).unwrap().file_id;
    edited
        .execute(
            "UPDATE segments SET en_text=en_text||' User edit' WHERE file_id=?1 AND index_num=0",
            [old_id],
        )
        .unwrap();
    input.source = source;
    input.operation_id = "edited-reimport".into();
    let separate = materials::import_material(&edited, &input).unwrap();
    assert_ne!(separate.file_id, old_id);
    assert_eq!(separate.outcome, "created");
    assert!(materials::open(&edited, old_id)
        .unwrap()
        .material
        .source
        .is_none());
    println!("actual source recovery: file_id={}, segment_ids_preserved={}, saved_revision={}, explanation preserved, repeat imports idempotent",id,recovered.segments.len(),record.revision);
}
#[test]
#[ignore = "local captured DASH media, probes and stream-copy tools"]
fn normalization_is_deterministic_and_probed_before_final_hash() {
    let base=Path::new("/tmp/lexicue-youtube-audio-v1/pipeline/a01b38c896d27707ef852301f1ccc6c39cebe792852c868109e85753ef159e47.m4a");
    let d = tempfile::tempdir().unwrap();
    let a = d.path().join("a.m4a");
    let b = d.path().join("b.m4a");
    tauri::async_runtime::block_on(async {
        normalize_container(base, &a, None).await.unwrap();
        normalize_container(base, &b, None).await.unwrap();
    });
    assert_eq!(file_digest(&a).unwrap(), file_digest(&b).unwrap());
    assert_ne!(file_digest(base).unwrap(), file_digest(&a).unwrap());
}

#[test]
#[ignore = "captured actual 206-row source and verified local audio, no network"]
fn actual_reading_anchors_are_exported_without_guessing_unmapped_rows() {
    let base = Path::new("/tmp/lexicue-import-lookup-qa");
    let x: serde_json::Value =
        serde_json::from_slice(&std::fs::read(base.join("real-fixture.json")).unwrap()).unwrap();
    let d = tempfile::tempdir().unwrap();
    let c = crate::db::init_db(&d.path().join("db")).unwrap();
    let source: YoutubeSource = serde_json::from_value(x["source"].clone()).unwrap();
    let input = materials::MaterialInput {
        document: None,
        normalized_kind: None,
        operation_id: "anchors".into(),
        name: x["name"].as_str().unwrap().into(),
        content: x["content"].as_str().unwrap().into(),
        segments: serde_json::from_value(x["segments"].clone()).unwrap(),
        source: Some(source.clone()),
    };
    let id = materials::import_material(&c, &input).unwrap().file_id;
    let manifest: Manifest =
        serde_json::from_slice(&std::fs::read(base.join("manifest.json")).unwrap()).unwrap();
    let bytes = std::fs::read(base.join("verified.m4a")).unwrap();
    assert_eq!(digest(&bytes), manifest.sha256);
    std::fs::write(asset_path(d.path(), &manifest.sha256).unwrap(), bytes).unwrap();
    c.execute("INSERT INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at)VALUES(?1,?2,?3,'ready',?4,0)",params![source.key,serde_json::to_string(&source).unwrap(),manifest.sha256,serde_json::to_string(&manifest).unwrap()]).unwrap();
    let opened = materials::open(&c, id).unwrap();
    let result = resolve_reading(
        &c,
        d.path(),
        &ReadingMediaTarget {
            file_id: id,
            segment_id: opened.segments[0].id,
            source_key: source.key,
        },
    )
    .unwrap();
    assert_eq!(opened.segments.len(), 206);
    assert_eq!(result.anchors.len(), opened.media_refs.len());
    for index in [203, 204, 205] {
        let anchor = result.anchors.iter().find(|a| a.index == index).unwrap();
        assert_eq!(anchor.end_ms, manifest.duration_ms);
    }
    let unmapped: Vec<_> = (0..206)
        .filter(|i| !result.anchors.iter().any(|a| a.index == *i))
        .collect();
    let out = serde_json::json!({"anchors":result.anchors,"unmapped_indices":unmapped,"asset_id":result.asset_id,"duration_ms":result.duration_ms,"method":"Actual production Rust material/reference/reading resolver on an isolated copy; same verified audio bytes as the native capture."});
    std::fs::write(
        base.join("resolved-reading.json"),
        serde_json::to_vec_pretty(&out).unwrap(),
    )
    .unwrap();
    println!(
        "actual anchors={}, unmapped={:?}",
        opened.media_refs.len(),
        unmapped
    );
}
