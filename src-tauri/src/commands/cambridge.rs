//! The desktop only sends the selected expression to the configured service.
//! Reading context is bound after validation and is never written to this cache.
use reqwest::{redirect::Policy, Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Manager;

#[path = "cambridge_public.rs"]
mod public;

const MAX_JSON: usize = 2 * 1024 * 1024;
const CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
// A parser change must advance this contract together with the service. Cached
// meanings from another adapter are never silently reused by a newer client.
const SUPPORTED_ADAPTER: &str = "cambridge-v1.0.0";
static CACHE_ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
type QueryLock = tokio::sync::Mutex<()>;
static IN_FLIGHT: OnceLock<tokio::sync::Mutex<HashMap<String, Weak<QueryLock>>>> = OnceLock::new();
static REQUEST_SLOTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn unavailable(expression: &str, code: &str) -> Value {
    json!({"schema_version":1,"query":{"text":expression,"language":"en","context":null},"status":"unavailable","default_entry_id":null,"entries":[],"notices":[{"code":code,"text":"剑桥补查暂不可用，稍后可重试。","entry_id":null}]})
}
pub fn configure(app: &tauri::AppHandle) {
    *CACHE_ROOT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("cache/cambridge-v1"));
}
fn cache_root() -> Option<PathBuf> {
    std::env::var_os("LEXICUE_CAMBRIDGE_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            CACHE_ROOT
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        })
}
fn endpoint() -> Result<Url, String> {
    let configured = std::env::var("LEXICUE_CAMBRIDGE_API_URL")
        .ok()
        .or_else(|| option_env!("LEXICUE_CAMBRIDGE_API_URL").map(str::to_owned))
        .filter(|s| !s.trim().is_empty())
        .ok_or("online_not_configured")?;
    validate_endpoint(&configured, cfg!(debug_assertions))
}
fn validate_endpoint(configured: &str, allow_loopback: bool) -> Result<Url, String> {
    let mut url = Url::parse(configured).map_err(|_| "online_configuration_invalid")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || (allow_loopback && local && url.scheme() == "http"))
        || !matches!(url.path(), "" | "/" | "/v1/lookup")
    {
        return Err("online_configuration_invalid".into());
    }
    url.set_path("/v1/lookup");
    Ok(url)
}
pub fn valid_entry_url(location: &str) -> bool {
    Url::parse(location)
        .map(|u| {
            u.scheme() == "https"
                && u.host_str() == Some("dictionary.cambridge.org")
                && u.username().is_empty()
                && u.password().is_none()
                && u.port().is_none()
                && (u.path().starts_with("/dictionary/") || u.path().starts_with("/us/dictionary/"))
        })
        .unwrap_or(false)
}
fn audio_url(location: &str) -> Result<Url, String> {
    let url = Url::parse(location).map_err(|_| "dictionary_audio_invalid")?;
    if url.scheme() != "https"
        || url.host_str() != Some("dictionary.cambridge.org")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.path().starts_with("/media/") || url.path().starts_with("/us/media/"))
        || !url.path().ends_with(".mp3")
    {
        return Err("dictionary_audio_invalid".into());
    }
    Ok(url)
}
fn schema() -> &'static jsonschema::JSONSchema {
    static SCHEMA: OnceLock<jsonschema::JSONSchema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        let value: Value = serde_json::from_str(include_str!(
            "../../../docs/implementation/dictionary-result-v1.schema.json"
        ))
        .expect("V1 schema");
        jsonschema::JSONSchema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .should_validate_formats(true)
            .compile(&value)
            .expect("valid V1 schema")
    })
}
pub fn valid_retrieved_at(value: &str) -> bool {
    static FORMAT: OnceLock<jsonschema::JSONSchema> = OnceLock::new();
    FORMAT
        .get_or_init(|| {
            jsonschema::JSONSchema::options()
                .should_validate_formats(true)
                .compile(&json!({"type":"string","format":"date-time"}))
                .unwrap()
        })
        .is_valid(&json!(value))
}
/// JSON Schema checks shape, then these checks enforce the source and selection boundary.
pub fn validate_result(value: &Value, expression: &str) -> Result<(), String> {
    if !schema().is_valid(value)
        || value["query"]["text"] != expression
        || !value["query"]["context"].is_null()
    {
        return Err("online_invalid_result".into());
    }
    if !public::valid_result_scope(value) {
        return Err("online_public_scope_unconfirmed".into());
    }
    let mut all_ids = HashSet::new();
    fn scan_ids(value: &Value, ids: &mut HashSet<String>) -> Result<(), String> {
        match value {
            Value::Object(map) => {
                if let Some(id) = map.get("id").and_then(Value::as_str) {
                    if !id.starts_with("cambridge:") || !ids.insert(id.into()) {
                        return Err("online_invalid_identity".into());
                    }
                }
                if map.contains_key("location")
                    && map.contains_key("kind")
                    && (map.get("kind").and_then(Value::as_str) != Some("remote_url")
                        || audio_url(map.get("location").and_then(Value::as_str).unwrap_or(""))
                            .is_err())
                {
                    return Err("online_invalid_audio".into());
                }
                for v in map.values() {
                    scan_ids(v, ids)?;
                }
            }
            Value::Array(items) => {
                for v in items {
                    scan_ids(v, ids)?;
                }
            }
            _ => (),
        }
        Ok(())
    }
    scan_ids(&value["entries"], &mut all_ids)?;
    for entry in value["entries"].as_array().unwrap() {
        let source = &entry["source"];
        let public_source = public::is_public_source(source);
        let valid_source = if public_source {
            public::valid_entry(entry, expression)
        } else {
            source["provider"] == "cambridge"
                && valid_entry_url(text(source, "entry_url"))
                && source["adapter_version"] == SUPPORTED_ADAPTER
                && source.get("access_channel").is_none()
                && source.get("service_url").is_none()
                && source.get("received_at").is_none()
        };
        if !valid_source || !matches!(text(source, "delivery"), "online" | "cache") {
            return Err("online_invalid_source".into());
        }
        let mut scope = HashSet::new();
        let mut owner_ids = HashSet::from([text(entry, "id")]);
        for group in entry["groups"].as_array().unwrap() {
            owner_ids.insert(text(group, "id"));
            for sense in group["senses"].as_array().unwrap() {
                scope.insert(text(sense, "id"));
                owner_ids.insert(text(sense, "id"));
            }
            for pron in group["pronunciations"].as_array().unwrap() {
                if !pron["audio"].is_null()
                    && (pron["audio"]["kind"] != "remote_url"
                        || audio_url(text(&pron["audio"], "location")).is_err())
                {
                    return Err("online_invalid_audio".into());
                }
            }
        }
        let selected = entry["match"]["sense_ids"].as_array().unwrap();
        if !selected.is_empty()
            && (selected.len() != scope.len()
                || selected
                    .iter()
                    .any(|s| !scope.contains(s.as_str().unwrap())))
        {
            return Err("online_invalid_scope".into());
        }
        if entry["related_expressions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| !owner_ids.contains(text(r, "scope_id")))
        {
            return Err("online_invalid_scope".into());
        }
    }
    let entries = value["entries"].as_array().unwrap();
    if matches!(text(value, "status"), "found" | "partial")
        && !entries.iter().any(|e| e["id"] == value["default_entry_id"])
    {
        return Err("online_invalid_default".into());
    }
    if value["status"] == "found" {
        let entry = entries
            .iter()
            .find(|e| e["id"] == value["default_entry_id"])
            .unwrap();
        if !entry["groups"].as_array().unwrap().iter().any(|g| {
            g["senses"].as_array().unwrap().iter().any(|s| {
                s["meaning"]["zh"]
                    .as_str()
                    .is_some_and(|t| !t.trim().is_empty())
            })
        }) {
            return Err("online_invalid_status".into());
        }
    }
    Ok(())
}
fn key(expression: &str, origin: &str) -> String {
    // Exact JSON tuple preserves case, punctuation, whitespace and query scope.
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(1, SUPPORTED_ADAPTER, origin, expression)).unwrap())
    )
}
async fn cached(root: Option<&PathBuf>, cache_key: &str, expression: &str) -> Option<(Value, u64)> {
    let path = root?.join(format!("{cache_key}.json"));
    if tokio::fs::metadata(&path).await.ok()?.len() > MAX_JSON as u64 {
        return None;
    }
    let envelope: Value = serde_json::from_slice(&tokio::fs::read(path).await.ok()?).ok()?;
    if envelope["cache_version"] != 1 {
        return None;
    }
    let value = envelope["value"].clone();
    if validate_result(&value, expression).is_err()
        || !matches!(text(&value, "status"), "found" | "partial")
    {
        return None;
    }
    Some((value, envelope["saved_ms"].as_u64()?))
}
fn delivered(mut value: Value, context: Option<&str>, stale: bool) -> Value {
    value["query"]["context"] = context
        .filter(|s| !s.trim().is_empty())
        .map(|s| json!(s))
        .unwrap_or(Value::Null);
    for entry in value["entries"].as_array_mut().unwrap() {
        entry["source"]["delivery"] = json!("cache");
    }
    if stale {
        value["notices"].as_array_mut().unwrap().push(json!({"code":"online_cache_stale","text":"在线补查暂不可用，显示此前查询的剑桥内容。","entry_id":null}));
    }
    without_recordings(value)
}
async fn bounded_body(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("online_response_too_large".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "online_transport_error")?
    {
        if body.len() + chunk.len() > limit {
            return Err("online_response_too_large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
async fn fetch_result(mut url: Url, expression: &str, refresh: bool) -> Result<Value, String> {
    url.query_pairs_mut().append_pair("text", expression);
    if refresh {
        url.query_pairs_mut().append_pair("refresh", "1");
    }
    let client = Client::builder()
        .timeout(Duration::from_millis(9_000))
        .connect_timeout(Duration::from_secs(3))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "online_transport_error")?;
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "online_timeout"
            } else {
                "online_transport_error"
            }
        })?;
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next() == Some("application/json"))
    {
        return Err("online_invalid_content".into());
    }
    let status = response.status();
    let value: Value = serde_json::from_slice(&bounded_body(response, MAX_JSON).await?)
        .map_err(|_| "online_invalid_result")?;
    validate_result(&value, expression)?;
    if !status.is_success() && value["status"] != "unavailable" {
        return Err("online_invalid_status".into());
    }
    Ok(value)
}
async fn query_legacy(expression: &str, context: Option<&str>, refresh: bool) -> Value {
    if expression.trim().is_empty()
        || expression.len() > 256
        || expression.chars().any(char::is_control)
    {
        return unavailable(expression, "online_invalid_query");
    }
    let endpoint = endpoint();
    let origin = endpoint
        .as_ref()
        .map(|u| u.as_str())
        .unwrap_or("configured-service");
    let cache_key = key(expression, origin);
    let root = cache_root();
    let locks = IN_FLIGHT.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let lock = {
        let mut map = locks.lock().await;
        map.retain(|_, v| v.strong_count() > 0);
        if let Some(lock) = map.get(&cache_key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(QueryLock::new(()));
            map.insert(cache_key.clone(), Arc::downgrade(&lock));
            lock
        }
    };
    let started = now();
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let _guard = lock.lock().await;
        let previous = cached(root.as_ref(), &cache_key, expression).await;
        if let Some((value, saved)) = &previous {
            if (!refresh && now().saturating_sub(*saved) < CACHE_TTL_MS) || *saved >= started {
                return delivered(value.clone(), context, false);
            }
        }
        let _slot = REQUEST_SLOTS
            .get_or_init(|| tokio::sync::Semaphore::new(4))
            .acquire()
            .await
            .unwrap();
        let fetched = match &endpoint {
            Ok(url) => fetch_result(url.clone(), expression, refresh).await,
            Err(code) => Err(code.clone()),
        };
        match fetched {
            Ok(mut value) if matches!(text(&value, "status"), "found" | "partial") => {
                if value["status"] == "partial" {
                    if let Some((previous, _)) = &previous {
                        if previous["status"] == "found" {
                            let mut preserved = delivered(previous.clone(), context, false);
                            preserved["notices"].as_array_mut().unwrap().push(json!({
                                "code":"online_cache_more_complete",
                                "text":"显示此前查询的完整剑桥内容。","entry_id":null
                            }));
                            return preserved;
                        }
                    }
                }
                if let Some(root) = &root {
                    if tokio::fs::create_dir_all(root).await.is_ok() {
                        let path = root.join(format!("{cache_key}.json"));
                        let tmp = root.join(format!("{cache_key}.{}.tmp", uuid::Uuid::new_v4()));
                        let envelope = json!({"cache_version":1,"saved_ms":now(),"value":value});
                        if tokio::fs::write(&tmp, serde_json::to_vec(&envelope).unwrap())
                            .await
                            .is_ok()
                        {
                            if tokio::fs::rename(&tmp, &path).await.is_err() {
                                let _ = tokio::fs::remove_file(&tmp).await;
                            }
                        }
                    }
                }
                value["query"]["context"] = context
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| json!(s))
                    .unwrap_or(Value::Null);
                value
            }
            Ok(mut value) if value["status"] == "not_found" => {
                value["query"]["context"] = context
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| json!(s))
                    .unwrap_or(Value::Null);
                value
            }
            result => {
                if let Some((value, _)) = previous {
                    return delivered(value, context, true);
                }
                let mut value = result.unwrap_or_else(|code| unavailable(expression, &code));
                value["query"]["context"] = context
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| json!(s))
                    .unwrap_or(Value::Null);
                value
            }
        }
    })
    .await;
    match result {
        Ok(value) => value,
        Err(_) => {
            if let Some((value, _)) = cached(root.as_ref(), &cache_key, expression).await {
                return delivered(value, context, true);
            }
            let mut value = unavailable(expression, "online_timeout");
            value["query"]["context"] = context
                .filter(|s| !s.trim().is_empty())
                .map(|s| json!(s))
                .unwrap_or(Value::Null);
            value
        }
    }
}
/// Keep old text caches usable while retiring all dictionary recordings.
fn without_recordings(mut value: Value) -> Value {
    fn strip(value: &mut Value) {
        match value {
            Value::Array(items) => items.iter_mut().for_each(strip),
            Value::Object(map) => {
                for (key, value) in map.iter_mut() {
                    if key == "audio" {
                        *value = Value::Null;
                    } else {
                        strip(value);
                    }
                }
                if let Some(Value::Array(pronunciations)) = map.get_mut("pronunciations") {
                    pronunciations.retain(|pronunciation| {
                        pronunciation["ipa"]
                            .as_str()
                            .is_some_and(|ipa| !ipa.trim().is_empty())
                    });
                }
            }
            _ => {}
        }
    }
    strip(&mut value);
    value
}
/// Production uses the author's API; the previous protocol is a debug-only opt-in.
pub async fn query_configured(expression: &str, context: Option<&str>, refresh: bool) -> Value {
    let result = if cfg!(debug_assertions)
        && std::env::var("LEXICUE_CAMBRIDGE_CHANNEL").as_deref() == Ok("self_hosted_dev")
    {
        query_legacy(expression, context, refresh).await
    } else {
        public::query(expression, context, refresh).await
    };
    without_recordings(result)
}
#[cfg(debug_assertions)]
pub async fn run_public_transport_diagnostic(config: Value) -> Value {
    public::run_transport_diagnostic(config).await
}
#[tauri::command]
pub async fn lookup_cambridge_expression(
    expression: String,
    context: Option<String>,
    refresh: Option<bool>,
) -> Result<Value, String> {
    Ok(query_configured(&expression, context.as_deref(), refresh.unwrap_or(false)).await)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    static ENV: Mutex<()> = Mutex::new(());
    /// Synthetic contract/transport fixture, never represented as dictionary evidence.
    fn fixture(query: &str) -> Value {
        json!({"schema_version":1,"query":{"text":query,"language":"en","context":null},"status":"found","default_entry_id":"cambridge:test:entry","entries":[{
            "id":"cambridge:test:entry","headword":query,"kind":"word","expression_type":null,"origin":"headword","parent_headword":null,
            "source":{"provider":"cambridge","dataset":"test-en-cn","edition":null,"release":null,"adapter_version":SUPPORTED_ADAPTER,"delivery":"online","entry_key":"test","locator":"test","entry_url":"https://dictionary.cambridge.org/dictionary/english-chinese-simplified/test","retrieved_at":"2026-10-26T01:02:03Z"},
            "match":{"type":"exact","pattern":null,"note":null,"sense_ids":[]},"groups":[{"id":"cambridge:test:group","part_of_speech":"noun","source_part_of_speech":"noun","pronunciations":[],"forms":[],"labels":[],"senses":[{"id":"cambridge:test:sense","meaning":{"en":"synthetic contract fixture","zh":"结构测试"},"labels":[],"patterns":[],"examples":[],"notes":[]}],"notes":[]}],"notes":[],"related_expressions":[]
        }],"notices":[]})
    }
    #[test]
    fn old_cache_retains_text_ipa_and_provenance_without_recordings() {
        let mut old = fixture("record");
        let group = &mut old["entries"][0]["groups"][0];
        group["pronunciations"] = json!([{"region":"uk","ipa":"rɪˈkɔːd","audio":{"kind":"remote_url","location":"https://dictionary.cambridge.org/media/test.mp3"},"form_label":null},{"region":"us","ipa":null,"audio":{"kind":"remote_url","location":"https://dictionary.cambridge.org/media/us.mp3"},"form_label":null}]);
        group["senses"][0]["examples"] = json!([{"id":"cambridge:test:example","english":"Record the result.","chinese":"记录结果。","audio":{"kind":"remote_url","location":"https://dictionary.cambridge.org/media/example.mp3"}}]);
        let result = delivered(old.clone(), Some("My private context"), false);
        let group = &result["entries"][0]["groups"][0];
        assert_eq!(group["pronunciations"].as_array().unwrap().len(), 1);
        assert_eq!(group["pronunciations"][0]["ipa"], "rɪˈkɔːd");
        assert!(group["pronunciations"][0]["audio"].is_null());
        assert!(group["senses"][0]["examples"][0]["audio"].is_null());
        assert_eq!(
            group["senses"][0]["meaning"],
            old["entries"][0]["groups"][0]["senses"][0]["meaning"]
        );
        assert_eq!(group["senses"][0]["examples"][0]["chinese"], "记录结果。");
        assert_eq!(
            result["entries"][0]["source"]["retrieved_at"],
            old["entries"][0]["source"]["retrieved_at"]
        );
        assert_eq!(result["entries"][0]["source"]["delivery"], "cache");
        assert_eq!(result["query"]["context"], "My private context");
        assert!(old["entries"][0]["groups"][0]["pronunciations"][0]["audio"].is_object());
        let mut cache_body = result;
        cache_body["query"]["context"] = Value::Null;
        validate_result(&cache_body, "record").unwrap();
    }
    fn server(
        status: u16,
        content_type: &str,
        body: String,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let content_type = content_type.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = [0; 8192];
            let n = stream.read(&mut bytes).unwrap();
            let response=format!("HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&bytes[..n]).into_owned()
        });
        (origin, handle)
    }
    #[test]
    fn strict_schema_and_semantic_boundaries() {
        let value = fixture("US");
        validate_result(&value, "US").unwrap();
        assert!(validate_result(&value, "us").is_err());
        for path in [
            "extra",
            "source",
            "scope",
            "default",
            "date",
            "audio",
            "duplicate",
            "found",
        ] {
            let mut bad = value.clone();
            match path {
                "extra" => bad["html"] = json!("unknown"),
                "source" => bad["entries"][0]["source"]["provider"] = json!("longman"),
                "scope" => {
                    bad["entries"][0]["match"]["sense_ids"] = json!(["cambridge:other:sense"])
                }
                "default" => bad["default_entry_id"] = json!("cambridge:missing"),
                "date" => bad["entries"][0]["source"]["retrieved_at"] = json!("not-a-date"),
                "audio" => {
                    bad["entries"][0]["groups"][0]["pronunciations"] = json!([{"region":"uk","ipa":null,"audio":{"kind":"remote_url","location":"https://example.invalid/test.mp3"},"form_label":null}])
                }
                "duplicate" => {
                    bad["entries"][0]["groups"][0]["senses"][0]["id"] =
                        json!("cambridge:test:entry")
                }
                "found" => {
                    bad["entries"][0]["groups"][0]["senses"][0]["meaning"]["zh"] = Value::Null
                }
                _ => unreachable!(),
            }
            assert!(validate_result(&bad, "US").is_err(), "{path}");
        }
        assert!(valid_retrieved_at("2026-10-26T01:02:03Z"));
        assert!(!valid_retrieved_at("2026-99-99"));
    }
    #[test]
    fn controlled_service_and_audio_urls_and_collision_free_keys() {
        assert!(validate_endpoint("http://127.0.0.1:3211", true).is_ok());
        assert!(validate_endpoint("http://127.0.0.1:3211", false).is_err());
        assert!(validate_endpoint("http://example.com", true).is_err());
        assert!(validate_endpoint("https://user:pass@example.com", true).is_err());
        assert!(validate_endpoint("https://example.com?context=secret", true).is_err());
        for location in [
            "http://dictionary.cambridge.org/media/a.mp3",
            "https://dictionary.cambridge.org.evil.test/media/a.mp3",
            "https://dictionary.cambridge.org/media/a.mp3?redirect=https://example.com",
            "https://dictionary.cambridge.org:444/media/a.mp3",
            "file:///tmp/audio.mp3",
            "https://dictionary.cambridge.org/media/../x.mp3",
        ] {
            assert!(audio_url(location).is_err(), "{location}");
        }
        assert!(
            audio_url("https://dictionary.cambridge.org/us/media/english/us_pron/t/test.mp3")
                .is_ok()
        );
        let keys = [
            "US",
            "us",
            "run-in",
            "run in",
            "look up",
            "look it up",
            "rock & roll",
            "rock_roll",
        ]
        .map(|q| key(q, "service"));
        assert_eq!(keys.iter().collect::<HashSet<_>>().len(), keys.len());
    }
    #[tokio::test]
    async fn native_transport_context_privacy_persistent_cache_and_stale_refresh() {
        let _guard = ENV.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let query = "US & us";
        let (origin, handle) = server(200, "application/json", fixture(query).to_string());
        std::env::set_var("LEXICUE_CAMBRIDGE_API_URL", &origin);
        std::env::set_var("LEXICUE_CAMBRIDGE_CACHE_DIR", dir.path());
        let first = query_legacy(query, Some("PRIVATE READING CONTEXT"), false).await;
        assert_eq!(first["status"], "found");
        assert_eq!(first["query"]["context"], "PRIVATE READING CONTEXT");
        let request = handle.join().unwrap();
        assert!(
            request.starts_with("GET /v1/lookup?text=US+%26+us HTTP/1.1"),
            "{request}"
        );
        assert!(!request.contains("PRIVATE"));
        assert!(!request.contains("context"));
        let cache = std::fs::read_dir(dir.path())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        // Ensure refresh follows the failure branch instead of same-millisecond coalescing.
        let mut envelope: Value = serde_json::from_slice(&std::fs::read(&cache).unwrap()).unwrap();
        envelope["saved_ms"] = json!(now().saturating_sub(1000));
        std::fs::write(&cache, serde_json::to_vec(&envelope).unwrap()).unwrap();
        let disk = std::fs::read_to_string(&cache).unwrap();
        assert!(!disk.contains("PRIVATE"));
        assert!(disk.contains("\"context\":null"));
        // The fixture listener is closed: fresh persistent content and refresh failure remain readable.
        let cached = query_legacy(query, Some("NEW CONTEXT"), false).await;
        assert_eq!(cached["entries"][0]["source"]["delivery"], "cache");
        assert_eq!(cached["query"]["context"], "NEW CONTEXT");
        assert_eq!(
            cached["entries"][0]["source"]["retrieved_at"],
            first["entries"][0]["source"]["retrieved_at"]
        );
        let stale = query_legacy(query, None, true).await;
        assert_eq!(stale["status"], "found");
        assert!(stale["notices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["code"] == "online_cache_stale"));
        assert_eq!(std::fs::read_to_string(cache).unwrap(), disk);
        std::env::remove_var("LEXICUE_CAMBRIDGE_API_URL");
        std::env::remove_var("LEXICUE_CAMBRIDGE_CACHE_DIR");
    }
    #[tokio::test]
    async fn native_transport_rejects_html_foreign_identity_and_false_not_found() {
        let _guard = ENV.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("LEXICUE_CAMBRIDGE_CACHE_DIR", dir.path());
        let mut wrong = fixture("wrong");
        wrong["status"] = json!("found");
        for (status,kind,body) in [(200,"text/html","<html>verification</html>".into()),(200,"application/json",wrong.to_string()),(403,"application/json",json!({"schema_version":1,"query":{"text":"test","language":"en","context":null},"status":"not_found","default_entry_id":null,"entries":[],"notices":[]}).to_string()),(429,"application/json",unavailable("test","upstream_rate_limited").to_string()),(503,"application/json",unavailable("test","upstream_unavailable").to_string())] {
            let (origin,handle)=server(status,kind,body);std::env::set_var("LEXICUE_CAMBRIDGE_API_URL",origin);
            let result=query_legacy("test",None,false).await;
            assert_eq!(result["status"],"unavailable");assert!(result["entries"].as_array().unwrap().is_empty());
            handle.join().unwrap();
        }
        assert_eq!(
            std::fs::read_dir(dir.path())
                .map(|d| d.count())
                .unwrap_or(0),
            0
        );
        std::env::remove_var("LEXICUE_CAMBRIDGE_API_URL");
        std::env::remove_var("LEXICUE_CAMBRIDGE_CACHE_DIR");
    }
    #[tokio::test]
    async fn partial_refresh_does_not_replace_a_complete_cached_entry() {
        let _guard = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let mut partial = fixture("test");
        partial["status"] = json!("partial");
        partial["entries"][0]["groups"][0]["senses"][0]["meaning"]["zh"] = Value::Null;
        partial["notices"] = json!([{"code":"english_only","text":"Only English","entry_id":null}]);
        let (origin, handle) = server(200, "application/json", partial.to_string());
        std::env::set_var("LEXICUE_CAMBRIDGE_API_URL", &origin);
        std::env::set_var("LEXICUE_CAMBRIDGE_CACHE_DIR", dir.path());
        let url = validate_endpoint(&origin, true).unwrap();
        let cache_key = key("test", url.as_str());
        let path = dir.path().join(format!("{cache_key}.json"));
        let envelope=json!({"cache_version":1,"saved_ms":now().saturating_sub(1000),"value":fixture("test")}).to_string();
        std::fs::write(&path, &envelope).unwrap();
        let result = query_legacy("test", None, true).await;
        assert_eq!(result["status"], "found");
        assert_eq!(result["entries"][0]["source"]["delivery"], "cache");
        assert!(result["notices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["code"] == "online_cache_more_complete"));
        assert!(handle
            .join()
            .unwrap()
            .starts_with("GET /v1/lookup?text=test&refresh=1 HTTP/1.1"));
        assert_eq!(std::fs::read_to_string(path).unwrap(), envelope);
        std::env::remove_var("LEXICUE_CAMBRIDGE_API_URL");
        std::env::remove_var("LEXICUE_CAMBRIDGE_CACHE_DIR");
    }
    #[tokio::test]
    #[ignore = "requires the explicitly configured local Cambridge service; records live/replay mode separately"]
    async fn configured_service_roundtrip() {
        let query = std::env::var("LEXICUE_CAMBRIDGE_TEST_QUERY")
            .unwrap_or_else(|_| "cost an arm and a leg".into());
        let result = query_legacy(&query, Some("context stays on this device"), true).await;
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
        assert!(matches!(text(&result, "status"), "found" | "partial"));
    }
}
