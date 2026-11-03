//! Explicit live upstream checks using only fresh synthetic English text.
use super::*;

#[tokio::test]
#[ignore = "opt-in public translation network; fresh synthetic text and isolated cache"]
async fn fresh_native_translation_and_cache_probe() {
    let output = std::path::PathBuf::from(
        std::env::var("LEXICUE_EXTERNAL_EVIDENCE").expect("explicit evidence directory"),
    );
    std::fs::create_dir_all(&output).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let nonce = uuid::Uuid::new_v4().to_string();
    let batch = vec![
        Sentence {
            index: 7,
            text: format!("The blue notebook rests beside a warm lamp in this new test {nonce}."),
        },
        Sentence {
            index: 11,
            text: "We will open the window after the rain stops.".into(),
        },
    ];
    assert!(cached(dir.path(), &batch).is_none());
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent("LexiCue/0.4.5")
        .build()
        .unwrap();
    let started = std::time::Instant::now();
    let result = translate_batch(&client, ENDPOINT, &batch, dir.path()).await;
    let mut report = serde_json::json!({"method":"production native Rust translate_batch and actual Google endpoint; no IPC/AppHandle or UI claim", "synthetic_text_only":true,"fresh_cache_before":true,"batch_indices":[7,11],"elapsed_ms":started.elapsed().as_millis(),"passed":false});
    match &result {
        Ok(values) => {
            assert_eq!(values.len(), 2);
            assert!(values.iter().all(|value| value
                .chars()
                .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))));
            let cache_key = key(&batch);
            assert!(dir.path().join(format!("{cache_key}.json")).is_file());
            // An unreachable endpoint proves the second read is cache-only.
            let again =
                translate_batch(&client, "http://127.0.0.1:9/not-called", &batch, dir.path())
                    .await
                    .unwrap();
            assert_eq!(&again, values);
            report["translated_char_counts"] =
                serde_json::json!(values.iter().map(|v| v.chars().count()).collect::<Vec<_>>());
            report["cache_only_second_read"] = serde_json::json!(true);
            report["passed"] = serde_json::json!(true);
        }
        Err(error) => report["error"] = serde_json::json!(error),
    }
    std::fs::write(
        output.join("fresh-translation.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    assert!(
        result.is_ok(),
        "live native translation failed; see isolated evidence JSON"
    );
}
