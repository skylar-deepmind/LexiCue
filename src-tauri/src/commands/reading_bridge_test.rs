//! Opt-in browser → production command cores → temporary SQLite evidence.
//! This module is compiled only for tests and never starts with the application.
use super::{dictionary, export, history, materials, saved, tags};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;

fn route(c: &rusqlite::Connection, command: &str, a: &Value) -> Result<Value, String> {
    let text = |key: &str| a[key].as_str().unwrap_or("");
    let id = |key: &str| a[key].as_i64().unwrap_or(0);
    let encode = |v| Ok(v);
    match command {
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
        "open_reading_material" => {
            serde_json::to_value(materials::open(c, id("fileId"))?).map_err(|e| e.to_string())
        }
        "lookup_reading_expression" => {
            serde_json::to_value(materials::lookup(c, text("expression"))?)
                .map_err(|e| e.to_string())
        }
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
#[test]
#[ignore = "Opt-in temporary SQLite HTTP bridge for browser validation"]
fn serve_reading_bridge() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reading.db");
    let mut conn = crate::db::init_db(&path).unwrap();
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
        let result = if command == "test_stop" {
            Ok(Value::Null)
        } else if command == "test_reopen" {
            drop(conn);
            conn = crate::db::init_db(&path).unwrap();
            Ok(json!(true))
        } else if options {
            Ok(Value::Null)
        } else {
            route(&conn, command, args)
        };
        let body = match result {
            Ok(value) => json!({"value":value}),
            Err(error) => json!({"error":error}),
        }
        .to_string();
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: http://127.0.0.1:5173\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body);
        stream.write_all(response.as_bytes()).unwrap();
        if command == "test_stop" {
            break;
        }
    }
}
