//! Opt-in browser → production command cores → temporary SQLite evidence.
//! This module is compiled only for tests and never starts with the application.
use super::{
    cambridge, dictionary, example::ExampleState, export, free_dictionary, history, longman,
    materials, recall, saved, tags,
};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;

fn route(
    c: &rusqlite::Connection,
    examples: &ExampleState,
    command: &str,
    a: &Value,
) -> Result<Value, String> {
    let text = |key: &str| a[key].as_str().unwrap_or("");
    let id = |key: &str| a[key].as_i64().unwrap_or(0);
    let encode = |v| Ok(v);
    match command {
        "begin_example_session" => {
            serde_json::to_value(examples.begin("test-main", text("sessionId"))?)
                .map_err(|e| e.to_string())
        }
        "end_example_session" => {
            examples.end("test-main", text("sessionId"))?;
            Ok(Value::Null)
        }
        "example_saved_for_selection" => {
            serde_json::to_value(examples.with("test-main", text("sessionId"), |c| {
                saved::selection(
                    c,
                    &serde_json::from_value(a["input"].clone()).map_err(|e| e.to_string())?,
                )
            })?)
            .map_err(|e| e.to_string())
        }
        "mutate_example_saved_record" => {
            serde_json::to_value(examples.with("test-main", text("sessionId"), |c| {
                saved::mutate(
                    c,
                    text("operationId"),
                    &serde_json::from_value(a["mutation"].clone()).map_err(|e| e.to_string())?,
                )
            })?)
            .map_err(|e| e.to_string())
        }
        "undo_example_saved_mutation" => {
            serde_json::to_value(examples.with("test-main", text("sessionId"), |c| {
                saved::undo(c, text("operationId"))
            })?)
            .map_err(|e| e.to_string())
        }
        "saved_recall_index" => serde_json::to_value(recall::index(c)?).map_err(|e| e.to_string()),
        "saved_recall_catalog" => {
            serde_json::to_value(recall::catalog(c)?).map_err(|e| e.to_string())
        }
        "saved_recall_contexts" => serde_json::to_value(recall::contexts(
            c,
            text("expression"),
            id("offset"),
            a["limit"].as_i64().unwrap_or(10),
        )?)
        .map_err(|e| e.to_string()),
        "test_seed_recall" => seed_recall(c, a),
        "import_reading_material" => serde_json::to_value(materials::import_material(
            c,
            &serde_json::from_value(a["input"].clone()).map_err(|e| e.to_string())?,
        )?)
        .map_err(|e| e.to_string()),
        "list_materials" => serde_json::to_value(materials::list(
            c,
            &serde_json::from_value::<Vec<i64>>(a["tagIds"].clone()).unwrap_or_default(),
            a["untagged"].as_bool().unwrap_or(false),
        )?)
        .map_err(|e| e.to_string()),
        "fill_reading_translations" => serde_json::to_value(materials::fill_translations(
            c,
            id("fileId"),
            text("contentHash"),
            &serde_json::from_value::<Vec<materials::ReadingTranslationPatch>>(
                a["segments"].clone(),
            )
            .map_err(|e| e.to_string())?,
        )?)
        .map_err(|e| e.to_string()),
        "test_edit_segment" => {
            c.execute(
                "UPDATE segments SET en_text=COALESCE(?1,en_text),zh_text=?2 WHERE id=?3",
                rusqlite::params![a["enText"].as_str(), a["zhText"].as_str(), id("segmentId")],
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open_reading_material" => {
            serde_json::to_value(materials::open(c, id("fileId"))?).map_err(|e| e.to_string())
        }
        "lookup_reading_expression" => {
            serde_json::to_value(materials::lookup(c, text("expression"))?)
                .map_err(|e| e.to_string())
        }
        "lookup_longman_expression" => Ok(longman::query_configured(
            text("expression"),
            a["context"].as_str(),
        )),
        "longman_dictionary_status" => Ok(longman::status_configured()),
        "lookup_cambridge_expression" => {
            Ok(tauri::async_runtime::block_on(cambridge::query_configured(
                text("expression"),
                a["context"].as_str(),
                a["refresh"].as_bool().unwrap_or(false),
            )))
        }
        "lookup_free_dictionary_expression" => {
            Ok(tauri::async_runtime::block_on(free_dictionary::query(
                text("expression"),
                a["context"].as_str(),
                a["refresh"].as_bool().unwrap_or(false),
                a["timeoutMs"].as_u64(),
            )))
        }
        "parse_free_dictionary_fixture" => free_dictionary::convert(
            &a["raw"],
            text("expression"),
            a["receivedAt"].as_str().unwrap_or("2026-10-28T12:00:00Z"),
        ),
        "mutate_saved_record" => serde_json::to_value(saved::mutate(
            c,
            text("operationId"),
            &serde_json::from_value(a["mutation"].clone()).map_err(|e| e.to_string())?,
        )?)
        .map_err(|e| e.to_string()),
        "undo_saved_mutation" => {
            serde_json::to_value(saved::undo(c, text("operationId"))?).map_err(|e| e.to_string())
        }
        "saved_for_selection" => serde_json::to_value(saved::selection(
            c,
            &serde_json::from_value(a["input"].clone()).map_err(|e| e.to_string())?,
        )?)
        .map_err(|e| e.to_string()),
        "list_saved_groups" => serde_json::to_value(saved::groups(
            c,
            text("query"),
            a["limit"].as_i64().unwrap_or(50),
            id("offset"),
        )?)
        .map_err(|e| e.to_string()),
        "saved_group_contexts" => serde_json::to_value(saved::group_contexts(
            c,
            text("groupId"),
            a["limit"].as_i64().unwrap_or(10),
            id("offset"),
        )?)
        .map_err(|e| e.to_string()),
        "list_saved_records" => serde_json::to_value(saved::list(
            c,
            text("query"),
            a["limit"].as_i64().unwrap_or(100),
            id("offset"),
        )?)
        .map_err(|e| e.to_string()),
        "saved_record_source" => serde_json::to_value(saved::resolve_source(c, text("recordId"))?)
            .map_err(|e| e.to_string()),
        "saved_migration_report" => {
            let v: String = c
                .query_row(
                    "SELECT report_json FROM product_migrations WHERE migration_key=?1",
                    [saved::MIGRATION],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            serde_json::from_str(&v).map_err(|e| e.to_string())
        }
        "saved_record_conflicts" => encode(json!([])),
        "list_legacy_records" => {
            serde_json::to_value(history::list(c, text("kind"), text("query"), id("offset"))?)
                .map_err(|e| e.to_string())
        }
        "legacy_record_detail" => history::detail(c, text("kind"), id("id")),
        "export_all" => serde_json::to_value(export::backup_payload(c)?).map_err(|e| e.to_string()),
        "restore_all" => {
            export::restore_backup(
                c,
                &serde_json::from_value(a["backup"].clone()).map_err(|e| e.to_string())?,
            )?;
            Ok(Value::Null)
        }
        "list_tags" => {
            let mut s = c
                .prepare("SELECT id,name,created_at FROM tags ORDER BY name")
                .map_err(|e| e.to_string())?;
            let v=s.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?,"created_at":r.get::<_,i64>(2)?}))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
            Ok(json!(v))
        }
        "create_tag" => Ok(json!(tags::ensure_tag(c, text("name"))?)),
        "rename_tag" => {
            tags::rename(c, id("tagId"), text("name"))?;
            Ok(Value::Null)
        }
        "delete_tag" => {
            c.execute("DELETE FROM tags WHERE id=?1", [id("tagId")])
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "set_file_tags" => {
            tags::replace_file_tags(
                c,
                id("fileId"),
                &serde_json::from_value::<Vec<i64>>(a["tagIds"].clone()).unwrap_or_default(),
                &serde_json::from_value::<Vec<String>>(a["newTagNames"].clone())
                    .unwrap_or_default(),
            )?;
            Ok(Value::Null)
        }
        "test_delete_source" => {
            c.execute("DELETE FROM files WHERE id=?1", [id("fileId")])
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "test_counts" => {
            let mut v = json!({});
            for table in [
                "files",
                "segments",
                "saved_records",
                "words",
                "phrases",
                "reviews",
                "phrase_reviews",
                "review_logs",
                "phrase_review_logs",
                "material_import_actions",
            ] {
                v[table] = json!(c
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                        .get::<_, i64>(0))
                    .map_err(|e| e.to_string())?);
            }
            Ok(v)
        }
        "test_reset" => {
            c.execute_batch("DELETE FROM files;DELETE FROM saved_records;DELETE FROM saved_actions;DELETE FROM sync_conflicts;DELETE FROM material_import_actions;DELETE FROM tags;").map_err(|e|e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err(format!("Unsupported bridge command: {command}")),
    }
}
// Synthetic benchmark data stays in this test-only disposable database. The
// important old contexts use the actual material/save commands. Filler snapshots
// use the production canonical record writer, including identity validation.
fn seed_recall(c: &rusqlite::Connection, a: &Value) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    let rows = a["records"].as_array().ok_or("missing records")?;
    let content = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            format!(
                "{}\n00:00:01,000 --> 00:00:03,000\n{}\n",
                i + 1,
                r["sentence"].as_str().unwrap()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let imported = materials::import_material(
        c,
        &materials::MaterialInput {
            document: None,
            normalized_kind: None,
            source: None,
            operation_id: "seed-source".into(),
            name: "earlier-flight.srt".into(),
            content,
            segments: rows
                .iter()
                .enumerate()
                .map(|(i, r)| super::import::SegmentInput {
                    index: i as i32,
                    en_text: r["sentence"].as_str().unwrap().into(),
                    zh_text: None,
                    start_time: Some("00:00:01.000".into()),
                    end_time: Some("00:00:03.000".into()),
                })
                .collect(),
        },
    )?;
    let opened = materials::open(c, imported.file_id)?;
    for (i, row) in rows.iter().enumerate() {
        let expression = row["expression"].as_str().unwrap();
        let sentence = &opened.segments[i].en_text;
        let start = sentence
            .to_lowercase()
            .find(&expression.to_lowercase())
            .ok_or("missing expression")?;
        let input = saved::SaveInput {
            segment_id: opened.segments[i].id,
            expression: expression.into(),
            start_offset: sentence[..start].encode_utf16().count(),
            end_offset: sentence[..start].encode_utf16().count()
                + expression.encode_utf16().count(),
            explanation: row["explanation"].as_str().map(str::to_string),
            explanation_source: "personal".into(),
            dictionary_snapshot: None,
            dictionary_reference: None,
        };
        let mut record = saved::mutate(
            c,
            &format!("seed-save-{i}"),
            &saved::Mutation::Save { input },
        )?
        .record;
        record.saved_at = row["saved_at"].as_i64();
        saved::write_record(c, &record)?;
    }
    let fixed: std::collections::HashSet<String> = rows
        .iter()
        .map(|r| saved::normalize(r["expression"].as_str().unwrap()))
        .collect();
    let vocabulary = {
        let mut statement=c.prepare("SELECT lemma FROM builtin_dictionary_entries WHERE length(lemma) BETWEEN 3 AND 18 AND lemma NOT GLOB '*[^a-z]*' ORDER BY (rowid * 1103515245 + 12345) % 2147483647 LIMIT 20000").map_err(|e|e.to_string())?;
        let found = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
        found
            .into_iter()
            .filter(|word| !fixed.contains(word) && !word.contains("curiosity"))
            .collect::<Vec<_>>()
    };
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    let target = a["count"].as_u64().unwrap_or(10000).min(10000) as usize;
    for i in rows.len()..target {
        let word = vocabulary
            .get(i - rows.len())
            .ok_or("benchmark dictionary incomplete")?;
        let expression = if i % 2 == 0 {
            word.clone()
        } else {
            format!("remember {word}")
        };
        let source_key = format!("synthetic-recall-{i}");
        let record_id = format!(
            "saved-{:x}",
            Sha256::digest(
                serde_json::to_vec(&(saved::normalize(&expression), &source_key)).unwrap()
            )
        );
        saved::write_record(
            &tx,
            &saved::SavedRecord {
                record_id,
                normalized_expression: saved::normalize(&expression),
                source_key,
                expression: expression.clone(),
                sentence: Some(format!("An earlier sentence includes {expression}.")),
                sentence_translation: None,
                source: Some(saved::SavedSource {
                    document: None,
                    media: None,
                    media_identity: None,
                    youtube: None,
                    content_hash: "synthetic-recall-material".into(),
                    file_name: "benchmark.srt".into(),
                    segment_index: i as i64,
                    start_offset: Some(29),
                    end_offset: Some((29 + expression.len()) as i64),
                    start_time: None,
                    end_time: None,
                }),
                explanation: Some("临时性能样本".into()),
                explanation_source: "personal".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
                origin: "reader".into(),
                legacy: None,
                saved_at: Some(1700000000000 + i as i64),
                updated_at: 1700000000000 + i as i64,
                revision: format!("fixture-{i}"),
                generation: 0,
                deleted_at: None,
            },
        )?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(
        json!({"records":target,"expressions":recall::index(c)?.len(),"source_file_id":imported.file_id,"filler":"deterministic ECDICT sample: single words and two-word phrases"}),
    )
}
#[test]
#[ignore = "Opt-in temporary SQLite HTTP bridge for browser validation"]
fn serve_reading_bridge() {
    // UI runs may use a separate local Vite port to avoid the user's dev server.
    let ui_url = std::env::var("LEXICUE_UI_URL").unwrap_or_else(|_| "http://127.0.0.1:5173".into());
    let ui_url = reqwest::Url::parse(&ui_url).expect("valid local UI URL");
    assert_eq!(ui_url.scheme(), "http");
    assert!(matches!(ui_url.host_str(), Some("127.0.0.1" | "localhost")));
    let ui_origin = ui_url.origin().ascii_serialization();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reading.db");
    let mut conn = crate::db::init_db(&path).unwrap();
    let examples = ExampleState::default();
    let tts_service = super::tts::TtsService::new(dir.path().join("edge-tts-v1"));
    dictionary::initialize_builtin_dictionary(&conn).unwrap();
    dictionary::initialize_builtin_phrase_dictionary(&conn).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let info =
        std::env::var("LEXICUE_READING_BRIDGE_INFO").expect("Set an explicit /tmp evidence path");
    assert!(info.starts_with("/tmp/") || info.starts_with("/private/tmp/"));
    std::fs::write(info, json!({"port":port,"temporary":true}).to_string()).unwrap();
    println!("Temporary SQLite reading bridge ready on port {port}");
    for stream in listener.incoming() {
        let mut stream = stream.unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 16384];
        let (header_end, length) = loop {
            let n = stream.read(&mut buffer).unwrap();
            if n == 0 {
                break (bytes.len(), 0);
            }
            bytes.extend_from_slice(&buffer[..n]);
            if let Some(p) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let h = String::from_utf8_lossy(&bytes[..p]);
                let length = h
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                break (p + 4, length);
            }
        };
        while bytes.len() < header_end + length {
            let n = stream.read(&mut buffer).unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..n]);
        }
        let options = bytes.starts_with(b"OPTIONS");
        let request: Value = serde_json::from_slice(&bytes[header_end..]).unwrap_or(Value::Null);
        let command = request["command"].as_str().unwrap_or("");
        let args = &request["args"];
        if matches!(
            command,
            "resolve_tts_audio" | "cancel_tts" | "clear_tts_cache" | "invalidate_tts_cache"
        ) {
            // Speech waits run independently so stop/clear can interrupt a pending synthesis.
            let service = tts_service.clone();
            let command = command.to_string();
            let args = args.clone();
            let origin = ui_origin.clone();
            std::thread::spawn(move || {
                let result = match command.as_str() {
                    "resolve_tts_audio" => match serde_json::from_value::<super::tts::TtsRequest>(
                        args["request"].clone(),
                    ) {
                        Ok(request) => tauri::async_runtime::block_on(service.resolve(request))
                            .map(|a| serde_json::to_value(a).unwrap()),
                        Err(_) => Err(super::tts::TtsError {
                            code: "invalid_input".into(),
                            message: "invalid_input".into(),
                            retryable: false,
                        }),
                    },
                    "cancel_tts" => {
                        service.cancel(args["requestId"].as_str().unwrap_or(""));
                        Ok(Value::Null)
                    }
                    "clear_tts_cache" => service.clear().map(|_| Value::Null),
                    _ => service
                        .invalidate(args["cacheKey"].as_str().unwrap_or(""))
                        .map(|_| Value::Null),
                };
                let body = match result {
                    Ok(value) => json!({"value":value}),
                    Err(error) => json!({"error":error}),
                }
                .to_string();
                let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body);
                let _ = stream.write_all(response.as_bytes());
            });
            continue;
        }
        let result = if command == "test_stop" {
            Ok(Value::Null)
        } else if command == "test_reopen" {
            drop(conn);
            conn = crate::db::init_db(&path).unwrap();
            Ok(json!(true))
        } else if options {
            Ok(Value::Null)
        } else {
            route(&conn, &examples, command, args)
        };
        let body = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":error}),
        }
        .to_string();
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: {ui_origin}\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body);
        stream.write_all(response.as_bytes()).unwrap();
        if command == "test_stop" {
            break;
        }
    }
}
