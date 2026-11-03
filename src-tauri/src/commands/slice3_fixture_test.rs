//! Explicit native QA provisioning. Never compiled into an application binary.
use super::{materials, source_media};
use rusqlite::params;
use std::path::PathBuf;

#[test]
#[ignore = "explicit P3 controlled AAC fixture; only /tmp input/output"]
fn prepare_p3_native_audio_fixture() {
    let input_dir = PathBuf::from(std::env::var("LEXICUE_P3_FIXTURE_INPUT").unwrap());
    let output = PathBuf::from(std::env::var("LEXICUE_P3_FIXTURE_OUTPUT").unwrap());
    assert!(input_dir.starts_with("/tmp/"));
    assert!(output.starts_with("/tmp/"));
    std::fs::create_dir_all(output.join("source-media")).unwrap();
    let conn = crate::db::init_db(&output.join("lexicue.db")).unwrap();
    let input: materials::MaterialInput =
        serde_json::from_slice(&std::fs::read(input_dir.join("input.json")).unwrap()).unwrap();
    let source = input.source.as_ref().unwrap();
    source.validate().unwrap();
    let file = materials::import_material(&conn, &input).unwrap().file_id;
    let bytes = std::fs::read(input_dir.join("fixture.m4a")).unwrap();
    assert!(bytes.len() > 1024);
    let hash = source_media::digest(&bytes);
    std::fs::write(
        output.join("source-media").join(format!("{hash}.m4a")),
        &bytes,
    )
    .unwrap();
    let manifest = source_media::Manifest {
        video_id: source.video_id.clone(),
        format_id: "140".into(),
        language: "en".into(),
        language_basis: "metadata".into(),
        codec: "aac".into(),
        bytes: bytes.len() as u64,
        duration_ms: source.duration_ms,
        start_ms: 0,
        offset_ms: 0,
        sha256: hash.clone(),
    };
    conn.execute("INSERT OR REPLACE INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at) VALUES(?1,?2,?3,'ready',?4,0)", params![source.key,serde_json::to_string(source).unwrap(),hash,serde_json::to_string(&manifest).unwrap()]).unwrap();
    let opened = materials::open(&conn, file).unwrap();
    let resolved = source_media::resolve_reading(
        &conn,
        &output.join("source-media"),
        &source_media::ReadingMediaTarget {
            file_id: file,
            segment_id: opened.segments[0].id,
            source_key: source.key.clone(),
        },
    )
    .unwrap();
    assert_eq!(resolved.anchors.len(), 2);
    assert_eq!(resolved.duration_ms, source.duration_ms);
    std::fs::write(output.join("fixture-evidence.json"), serde_json::to_vec_pretty(&serde_json::json!({"controlled":true,"downloaded":false,"providerMetadata":"test-only synthetic provenance; no external video request","fileId":file,"assetSha256":hash,"durationMs":source.duration_ms,"anchors":resolved.anchors})).unwrap()).unwrap();
}
