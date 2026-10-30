//! Conservative adapter for the author's flattened public JSON. It cannot
//! reconstruct the original page's subentry or homograph boundaries.
use super::{delivered, now, text, unavailable, validate_result, CACHE_TTL_MS, MAX_JSON};
use reqwest::{redirect::Policy, Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

pub(super) const SERVICE: &str = "https://dictionary-api.eliaschen.dev";
pub(super) const ADAPTER: &str = "cambridge-public-v1.1.0";
const DATASET: &str = "Cambridge Dictionary (author public API)";
type QueryState = tokio::sync::Mutex<Option<(Instant, Value)>>;
static IN_FLIGHT: OnceLock<tokio::sync::Mutex<HashMap<String, Weak<QueryState>>>> = OnceLock::new();
static SLOTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
static TRACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Only static phase names, durations, status numbers and error categories are
/// retained. This trace never receives an expression, URL, body or proxy value.
struct TransportTrace {
    id: u64,
    started: Instant,
    state: Mutex<TraceState>,
}
struct TraceState {
    phase: &'static str,
    phase_started: Instant,
    events: Vec<Value>,
}
impl TransportTrace {
    fn new() -> Self {
        Self {
            id: TRACE_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
            started: Instant::now(),
            state: Mutex::new(TraceState {
                phase: "created",
                phase_started: Instant::now(),
                events: vec![],
            }),
        }
    }
    fn enter(&self, phase: &'static str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.phase = phase;
        state.phase_started = Instant::now();
        self.record_locked(&mut state, "start", json!({}));
    }
    fn complete(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.record_locked(&mut state, "complete", json!({}));
    }
    fn event(&self, event: &'static str, fields: Value) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.record_locked(&mut state, event, fields);
    }
    fn record_locked(&self, state: &mut TraceState, event: &'static str, fields: Value) {
        let value = json!({"trace":self.id,"phase":state.phase,"event":event,"elapsed_ms":self.started.elapsed().as_millis(),"phase_elapsed_ms":state.phase_started.elapsed().as_millis(),"details":fields});
        log::info!("Public dictionary diagnostic {value}");
        if state.events.len() < 64 {
            state.events.push(value);
        }
    }
    fn reqwest_error(&self, error: &reqwest::Error) {
        let mut categories = vec![];
        let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
        for _ in 0..12 {
            let Some(source) = current else {
                break;
            };
            let category = if source.is::<reqwest::Error>() {
                "reqwest"
            } else if source.is::<std::io::Error>() {
                "io"
            } else if source.is::<tokio::time::error::Elapsed>() {
                "elapsed"
            } else if source.is::<serde_json::Error>() {
                "json"
            } else {
                "opaque_transport_source"
            };
            let io = source.downcast_ref::<std::io::Error>();
            categories.push(json!({"category":category,"io_kind":io.map(|e|format!("{:?}",e.kind())),"os_code":io.and_then(std::io::Error::raw_os_error)}));
            current = source.source();
        }
        self.event("reqwest_error",json!({"is_timeout":error.is_timeout(),"is_connect":error.is_connect(),"is_body":error.is_body(),"is_decode":error.is_decode(),"is_builder":error.is_builder(),"is_request":error.is_request(),"is_redirect":error.is_redirect(),"is_status":error.is_status(),"status":error.status().map(|s|s.as_u16()),"chain_categories":categories}));
    }
    #[cfg(debug_assertions)]
    fn report(&self) -> Value {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        json!({"trace":self.id,"elapsed_ms":self.started.elapsed().as_millis(),"last_phase":state.phase,"events":state.events})
    }
}

pub(super) fn is_public_source(source: &Value) -> bool {
    source.get("access_channel").is_some()
        || source.get("service_url").is_some()
        || source.get("received_at").is_some()
        || source["adapter_version"] == ADAPTER
}
pub(super) fn valid_source(source: &Value) -> bool {
    source["provider"] == "cambridge"
        && source["access_channel"] == "author_public_api"
        && source["service_url"] == SERVICE
        && source["adapter_version"] == ADAPTER
        && source["dataset"] == DATASET
        && source["entry_url"].is_null()
        && source["retrieved_at"].is_null()
        && source["edition"].is_null()
        && source["release"].is_null()
        && source["locator"].is_null()
        && super::valid_retrieved_at(text(source, "received_at"))
}
pub(super) fn valid_entry(entry: &Value, expression: &str) -> bool {
    fn namespaced_ids(value: &Value) -> bool {
        match value {
            Value::Object(map) => {
                map.get("id").is_none_or(|id| {
                    id.as_str()
                        .is_some_and(|id| id.starts_with(&format!("cambridge:public:{ADAPTER}:")))
                }) && map.values().all(namespaced_ids)
            }
            Value::Array(items) => items.iter().all(namespaced_ids),
            _ => true,
        }
    }
    let mut source_pos = HashSet::new();
    let mut has_abbreviation = false;
    let mut translated = false;
    let mut english_only = false;
    for group in entry["groups"].as_array().into_iter().flatten() {
        if let Some(pos) = group["source_part_of_speech"].as_str() {
            source_pos.insert(pos);
        }
        for sense in group["senses"].as_array().into_iter().flatten() {
            observe_translation_scope(
                &sense["meaning"]["en"],
                &sense["meaning"]["zh"],
                &mut translated,
                &mut english_only,
            );
            has_abbreviation |= sense["meaning"]["en"]
                .as_str()
                .is_some_and(abbreviation_relation);
        }
    }
    namespaced_ids(entry)
        && !(has_abbreviation && source_pos.len() > 1)
        && !(translated && english_only)
        && valid_source(&entry["source"])
        && matches_target(expression, text(entry, "headword")).is_some()
        && entry["kind"] == "word"
        && entry["origin"] == "headword"
        && entry["parent_headword"].is_null()
        && entry["expression_type"].is_null()
}
fn observe_translation_scope(
    en: &Value,
    zh: &Value,
    translated: &mut bool,
    english_only: &mut bool,
) {
    let has_chinese = zh.as_str().is_some_and(|s| !s.trim().is_empty());
    *translated |= has_chinese;
    *english_only |= !has_chinese && en.as_str().is_some_and(|s| !s.trim().is_empty());
}
/// The flat transport has no per-definition target evidence. Mixed translation
/// availability can cross a hidden subentry boundary, so no subset is guessed.
pub(super) fn valid_result_scope(result: &Value) -> bool {
    let mut translated = false;
    let mut english_only = false;
    for entry in result["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| is_public_source(&entry["source"]))
    {
        for group in entry["groups"].as_array().into_iter().flatten() {
            for sense in group["senses"].as_array().into_iter().flatten() {
                observe_translation_scope(
                    &sense["meaning"]["en"],
                    &sense["meaning"]["zh"],
                    &mut translated,
                    &mut english_only,
                );
            }
        }
    }
    !(translated && english_only)
}
fn clean(value: &Value) -> Result<Option<String>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let value = value.as_str().ok_or("online_public_shape_changed")?.trim();
    if value.contains('<')
        || value.contains('>')
        || value.chars().any(|c| c.is_control() && !c.is_whitespace())
    {
        return Err("online_public_invalid_text".into());
    }
    Ok((!value.is_empty()).then(|| value.to_owned()))
}
/// Only one-token exact identity is supported. The API does not establish
/// sentence position, alternative spellings or the scope of whole expressions.
pub(super) fn matches_target(query: &str, headword: &str) -> Option<&'static str> {
    if query.split_whitespace().count() != 1 || headword.split_whitespace().count() != 1 {
        return None;
    }
    if query == headword {
        return Some("exact");
    }
    None
}
fn id(kind: &str, value: &Value) -> String {
    format!(
        "cambridge:public:{ADAPTER}:{kind}:{:x}",
        Sha256::digest(serde_json::to_vec(value).unwrap())
    )
}
fn dangling_relation(value: &str) -> bool {
    let text = value
        .trim()
        .trim_end_matches([':', '.', ';', '：', '。'])
        .trim()
        .to_lowercase();
    [
        "abbreviation for",
        "abbreviation of",
        "short for",
        "past tense of",
        "past simple of",
        "past simple and past participle of",
        "past participle of",
        "past tense and past participle of",
        "plural of",
        "present participle of",
        "variant of",
        "spelling of",
    ]
    .iter()
    .any(|tail| text.ends_with(tail))
        || matches!(
            text.as_str(),
            "的缩写" | "的过去式" | "的过去分词" | "的复数"
        )
}
fn abbreviation_relation(value: &str) -> bool {
    let text = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    text.contains("abbreviation for ")
        || text.contains("abbreviation of ")
        || text.starts_with("short for ")
}
fn normalized_pos(value: Option<&str>) -> Option<&'static str> {
    match value? {
        "noun" => Some("noun"),
        "verb" => Some("verb"),
        "adjective" => Some("adjective"),
        "adverb" => Some("adverb"),
        "pronoun" => Some("pronoun"),
        "determiner" => Some("determiner"),
        "preposition" => Some("preposition"),
        "conjunction" => Some("conjunction"),
        "exclamation" | "interjection" => Some("interjection"),
        "auxiliary verb" | "auxiliary" => Some("auxiliary"),
        "modal verb" | "modal" => Some("modal"),
        "number" | "numeral" => Some("numeral"),
        "prefix" => Some("prefix"),
        "suffix" => Some("suffix"),
        "abbreviation" => Some("abbreviation"),
        "symbol" => Some("symbol"),
        _ => None,
    }
}
fn pronunciations(raw: &[Value], pos: Option<&str>) -> (Vec<Value>, bool) {
    let Some(pos) = pos else {
        return (vec![], !raw.is_empty());
    };
    let mut candidates: HashMap<&str, Vec<Value>> = HashMap::new();
    let mut omitted = !raw.is_empty();
    let mut matched_pos = false;
    for pron in raw {
        if pron["pos"].as_str().map(str::trim) != Some(pos) {
            continue;
        }
        if !matched_pos {
            omitted = false;
            matched_pos = true;
        }
        let region = match text(pron, "lang").trim().to_ascii_lowercase().as_str() {
            "uk" => "uk",
            "us" => "us",
            _ => {
                omitted = true;
                continue;
            }
        };
        let ipa = match clean(&pron["pron"]) {
            Ok(Some(p))
                if !p.contains('/')
                    || (p.len() > 1
                        && p.starts_with('/')
                        && p.ends_with('/')
                        && p[1..p.len() - 1].find('/').is_none()) =>
            {
                Some(p.trim_matches('/').trim().to_owned()).filter(|p| !p.is_empty())
            }
            _ => None,
        };
        if ipa.is_none() {
            omitted = true;
        }
        if ipa.is_none() {
            continue;
        }
        let item = json!({"region":region,"ipa":ipa,"audio":null,"form_label":null});
        let items = candidates.entry(region).or_default();
        if !items.contains(&item) {
            items.push(item);
        }
    }
    let mut result = vec![];
    for region in ["uk", "us"] {
        if let Some(items) = candidates.get(region) {
            if items.len() == 1 {
                result.push(items[0].clone());
            } else {
                omitted = true;
            }
        }
    }
    (result, omitted)
}
pub(super) fn convert(raw: &Value, expression: &str, received_at: &str) -> Result<Value, String> {
    let map = raw.as_object().ok_or("online_public_shape_changed")?;
    for required in ["word", "pos", "pronunciation", "definition"] {
        if !map.contains_key(required) {
            return Err("online_public_shape_changed".into());
        }
    }
    let headword = clean(&raw["word"])?.ok_or("online_public_missing_headword")?;
    let match_type = matches_target(expression, &headword).ok_or_else(|| {
        if expression.split_whitespace().count() > 1 {
            "online_public_expression_unconfirmed"
        } else {
            "online_public_identity_mismatch"
        }
        .to_owned()
    })?;
    let _global_pos = raw["pos"].as_array().ok_or("online_public_shape_changed")?;
    let pronunciation = raw["pronunciation"]
        .as_array()
        .ok_or("online_public_shape_changed")?;
    let definitions = raw["definition"]
        .as_array()
        .filter(|d| !d.is_empty())
        .ok_or("online_public_missing_definition")?;
    // A flattened response may mix a lowercase word with an uppercase
    // abbreviation. Per-definition headwords are absent, so the relation plus
    // multiple POS families exposes an unresolved scope boundary. Reject the
    // whole response; selecting apparently relevant definitions would guess.
    let mut source_pos = HashSet::new();
    let mut has_abbreviation = false;
    let mut translated = false;
    let mut english_only_scope = false;
    for definition in definitions {
        if let Some(pos) = clean(&definition["pos"])? {
            source_pos.insert(pos);
        }
        has_abbreviation |= clean(&definition["text"])?
            .as_deref()
            .is_some_and(abbreviation_relation);
        let en = clean(&definition["text"])?;
        let zh = clean(&definition["translation"])?;
        translated |= zh.is_some();
        english_only_scope |= en.is_some() && zh.is_none();
    }
    if has_abbreviation && source_pos.len() > 1 {
        return Err("online_public_scope_unconfirmed".into());
    }
    if translated && english_only_scope {
        return Err("online_public_scope_unconfirmed".into());
    }
    let entry_id = id("entry", &json!([headword]));
    let mut groups = vec![];
    let mut group_ids = HashSet::new();
    let mut english_only = false;
    let mut omitted_pronunciation = false;
    for definition in definitions {
        let object = definition
            .as_object()
            .ok_or("online_public_shape_changed")?;
        if !["text", "translation", "pos", "example"]
            .iter()
            .all(|key| object.contains_key(*key))
        {
            return Err("online_public_shape_changed".into());
        }
        let en = clean(&definition["text"])?;
        let zh = clean(&definition["translation"])?;
        if en.is_none() && zh.is_none() {
            return Err("online_public_missing_definition".into());
        }
        if en.as_deref().is_some_and(dangling_relation)
            || zh.as_deref().is_some_and(dangling_relation)
        {
            return Err("online_public_incomplete_relation".into());
        }
        let pos = clean(&definition["pos"])?;
        let examples_raw = definition["example"]
            .as_array()
            .ok_or("online_public_shape_changed")?;
        let mut examples_content = vec![];
        for example in examples_raw {
            if !example.is_object()
                || example.get("text").is_none()
                || example.get("translation").is_none()
            {
                return Err("online_public_shape_changed".into());
            }
            let english = clean(&example["text"])?.ok_or("online_public_invalid_example")?;
            let chinese = clean(&example["translation"])?;
            let content = json!([english, chinese]);
            if !examples_content.contains(&content) {
                examples_content.push(content);
            }
        }
        let content = json!([
            headword,
            pos,
            definition["source"],
            en,
            zh,
            examples_content
        ]);
        let group_id = id("group", &content);
        if !group_ids.insert(group_id.clone()) {
            continue;
        }
        let sense_id = id("sense", &content);
        let examples: Vec<Value> = examples_content.into_iter().map(|ex| json!({"id":id("example", &json!([sense_id, ex])),"english":ex[0],"chinese":ex[1],"audio":null})).collect();
        let (prons, omitted) = pronunciations(pronunciation, pos.as_deref());
        omitted_pronunciation |= omitted;
        english_only |= zh.is_none();
        groups.push(json!({"id":group_id,"part_of_speech":normalized_pos(pos.as_deref()),"source_part_of_speech":pos,"pronunciations":prons,"forms":[],"labels":[],"senses":[{"id":sense_id,"meaning":{"en":en,"zh":zh},"labels":[],"patterns":[],"examples":examples,"notes":[]}],"notes":[]}));
    }
    let has_chinese = groups
        .iter()
        .any(|g| !g["senses"][0]["meaning"]["zh"].is_null());
    let mut notices = vec![];
    if english_only {
        notices.push(json!({"code":"online_public_english_only","text":"本次查询仅有英文释义。","entry_id":entry_id}));
    }
    if omitted_pronunciation {
        notices.push(json!({"code":"online_public_pronunciation_unconfirmed","text":"部分音标归属无法确认，已省略。","entry_id":entry_id}));
    }
    let result = json!({"schema_version":1,"query":{"text":expression,"language":"en","context":null},"status":if has_chinese {"found"} else {"partial"},"default_entry_id":entry_id,"entries":[{
        "id":entry_id,"headword":headword,"kind":"word","expression_type":null,"origin":"headword","parent_headword":null,
        "source":{"provider":"cambridge","dataset":DATASET,"edition":null,"release":null,"adapter_version":ADAPTER,"delivery":"online","entry_key":id("target",&json!([headword])),"locator":null,"entry_url":null,"retrieved_at":null,"access_channel":"author_public_api","service_url":SERVICE,"received_at":received_at},
        "match":{"type":match_type,"pattern":null,"note":null,"sense_ids":[]},"groups":groups,"notes":[],"related_expressions":[]
    }],"notices":notices});
    validate_result(&result, expression)?;
    Ok(result)
}
fn request_origin() -> String {
    // Compiled only into the isolated test bridge, never shipped in the app.
    #[cfg(test)]
    if let Ok(origin) = std::env::var("LEXICUE_CAMBRIDGE_PUBLIC_TEST_URL") {
        if let Ok(url) = Url::parse(&origin) {
            if url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none()
                && url.path() == "/"
            {
                return origin;
            }
        }
    }
    SERVICE.into()
}
fn url(expression: &str) -> Url {
    let mut url = Url::parse(&request_origin()).expect("fixed author service");
    url.path_segments_mut()
        .unwrap()
        .extend(["api", "dictionary", "en-cn", expression]);
    url
}
fn cache_key(expression: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                1,
                "author_public_api",
                ADAPTER,
                SERVICE,
                request_origin(),
                expression,
                "entire_confirmed_word"
            ))
            .unwrap()
        )
    )
}
fn cache_root() -> Option<PathBuf> {
    std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            super::cache_root()
                .and_then(|p| p.parent().map(|root| root.join("cambridge-public-v1")))
        })
}
async fn cached(root: Option<&PathBuf>, key: &str, expression: &str) -> Option<(Value, u64)> {
    let path = root?.join(format!("{key}.json"));
    if tokio::fs::metadata(&path).await.ok()?.len() > MAX_JSON as u64 {
        return None;
    }
    let envelope: Value = serde_json::from_slice(&tokio::fs::read(path).await.ok()?).ok()?;
    let result = envelope["value"].clone();
    let saved = envelope["received_ms"].as_u64()?;
    if envelope["cache_version"] != "cambridge-public-v1"
        || validate_result(&result, expression).is_err()
        || !matches!(text(&result, "status"), "found" | "partial")
        || result["entries"]
            .as_array()?
            .iter()
            .any(|e| !valid_source(&e["source"]))
    {
        return None;
    }
    let received = time::OffsetDateTime::parse(
        text(&result["entries"][0]["source"], "received_at"),
        &time::format_description::well_known::Rfc3339,
    )
    .ok()?;
    if (received.unix_timestamp_nanos() / 1_000_000) as u64 != saved || saved > now() {
        return None;
    }
    Some((result, saved))
}
async fn write_cache(root: Option<&PathBuf>, key: &str, value: &Value) {
    let Some(root) = root else {
        return;
    };
    let Ok(received) = time::OffsetDateTime::parse(
        text(&value["entries"][0]["source"], "received_at"),
        &time::format_description::well_known::Rfc3339,
    ) else {
        return;
    };
    if tokio::fs::create_dir_all(root).await.is_err() {
        return;
    }
    let path = root.join(format!("{key}.json"));
    let tmp = root.join(format!("{key}.{}.tmp", uuid::Uuid::new_v4()));
    let envelope = json!({"cache_version":"cambridge-public-v1","received_ms":(received.unix_timestamp_nanos()/1_000_000) as u64,"value":value});
    if tokio::fs::write(&tmp, serde_json::to_vec(&envelope).unwrap())
        .await
        .is_ok()
        && tokio::fs::rename(&tmp, &path).await.is_err()
    {
        let _ = tokio::fs::remove_file(tmp).await;
    }
}
fn richness(value: &Value) -> [usize; 5] {
    let mut count = [0; 5];
    for entry in value["entries"].as_array().into_iter().flatten() {
        for group in entry["groups"].as_array().into_iter().flatten() {
            for sense in group["senses"].as_array().into_iter().flatten() {
                count[0] += 1;
                count[1] += usize::from(!sense["meaning"]["en"].is_null());
                count[2] += usize::from(!sense["meaning"]["zh"].is_null());
                for example in sense["examples"].as_array().into_iter().flatten() {
                    count[3] += 1;
                    count[4] += usize::from(!example["chinese"].is_null());
                }
            }
        }
    }
    count
}
fn public_client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .timeout(Duration::from_secs(9))
        .connect_timeout(Duration::from_secs(3))
        .redirect(Policy::none())
}
async fn traced_body(
    mut response: reqwest::Response,
    trace: &TransportTrace,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|n| n > MAX_JSON as u64)
    {
        return Err("online_response_too_large".into());
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        trace.reqwest_error(&error);
        "online_transport_error"
    })? {
        if body.len() + chunk.len() > MAX_JSON {
            return Err("online_response_too_large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
async fn fetch_at(
    url: Url,
    expression: &str,
    trace: &TransportTrace,
    builder: reqwest::ClientBuilder,
) -> Result<Value, String> {
    trace.enter("client_build");
    let client = builder.build().map_err(|error| {
        trace.reqwest_error(&error);
        "online_transport_error"
    })?;
    trace.complete();
    trace.enter("send_headers");
    let response = client
        .get(url.clone())
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| {
            trace.reqwest_error(&error);
            if error.is_timeout() {
                "online_timeout"
            } else {
                "online_transport_error"
            }
        })?;
    trace.complete();
    let status = response.status().as_u16();
    trace.event("http_status", json!({"status":status}));
    if !(200..=299).contains(&status) {
        log::warn!("Public dictionary HTTP status={status}");
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    trace.enter("body");
    let body = traced_body(response, trace).await?;
    trace.complete();
    #[cfg(test)]
    if let Some(path) = std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_CAPTURE_RAW") {
        let evidence = json!({"client":"native reqwest default; no user-agent override","url":url.as_str(),"status":status,"content_type":content_type,"received_ms":now(),"raw_body_utf8":String::from_utf8_lossy(&body),"raw_json":serde_json::from_slice::<Value>(&body).ok()});
        std::fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap())
            .map_err(|_| "test_evidence_write_failed")?;
    }
    match status {
        404 => return Err("online_public_not_obtained".into()),
        429 => return Err("online_rate_limited".into()),
        500..=599 => return Err("online_service_unavailable".into()),
        200..=299 => (),
        _ => return Err("online_http_error".into()),
    }
    if content_type.split(';').next() != Some("application/json") {
        return Err("online_invalid_content".into());
    }
    trace.enter("json_decode");
    let raw: Value = serde_json::from_slice(&body).map_err(|error| {
        trace.event(
            "json_error",
            json!({"category":format!("{:?}",error.classify())}),
        );
        "online_public_shape_changed"
    })?;
    trace.complete();
    let received_at = time::OffsetDateTime::from_unix_timestamp_nanos(now() as i128 * 1_000_000)
        .map_err(|_| "online_clock_error")?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| "online_clock_error")?;
    trace.enter("convert_validate");
    let result = convert(&raw, expression, &received_at);
    trace.complete();
    result
}
fn context(mut value: Value, context: Option<&str>) -> Value {
    value["query"]["context"] = context
        .filter(|s| !s.trim().is_empty())
        .map(|s| json!(s))
        .unwrap_or(Value::Null);
    value
}
fn failure(expression: &str, code: &str) -> Value {
    let mut result = unavailable(expression, code);
    result["notices"][0]["text"] = json!("本次在线查询未获取到可靠结果。");
    result
}
pub(super) async fn query(expression: &str, reading_context: Option<&str>, refresh: bool) -> Value {
    if expression.trim().is_empty()
        || expression.len() > 256
        || expression.chars().any(char::is_control)
    {
        return context(failure(expression, "online_invalid_query"), reading_context);
    }
    // The flat public channel cannot confirm any whole multiword scope. Do
    // not spend an author request on an expression we must reject anyway.
    if expression.split_whitespace().count() > 1 {
        return context(
            failure(expression, "online_public_expression_unconfirmed"),
            reading_context,
        );
    }
    let trace = TransportTrace::new();
    trace.enter("queue_lock");
    let key = cache_key(expression);
    let root = cache_root();
    let locks = IN_FLIGHT.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()));
    let lock = {
        let mut map = locks.lock().await;
        map.retain(|_, v| v.strong_count() > 0);
        if let Some(lock) = map.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(QueryState::new(None));
            map.insert(key.clone(), Arc::downgrade(&lock));
            lock
        }
    };
    let started = Instant::now();
    let operation = async {
        let mut state = lock.lock().await;
        trace.complete();
        // Concurrent callers share both successes and failures. A failure is
        // not persisted and does not replace a good disk cache.
        if let Some((completed, value)) = state.as_ref() {
            if *completed >= started {
                return value.clone();
            }
        }
        trace.enter("cache");
        let previous = cached(root.as_ref(), &key, expression).await;
        trace.complete();
        trace.event("cache_state", json!({"hit":previous.is_some()}));
        if let Some((value, received)) = &previous {
            if !refresh && now().saturating_sub(*received) < CACHE_TTL_MS {
                return delivered(value.clone(), None, false);
            }
        }
        trace.enter("slot");
        let _slot = SLOTS
            .get_or_init(|| tokio::sync::Semaphore::new(2))
            .acquire()
            .await
            .unwrap();
        trace.complete();
        let fetched = fetch_at(url(expression), expression, &trace, public_client_builder()).await;
        let value = match fetched {
            Ok(value) => {
                if previous.as_ref().is_some_and(|(v, _)| {
                    (value["status"] == "partial" && v["status"] == "found")
                        || richness(&value)
                            .iter()
                            .zip(richness(v))
                            .any(|(new, old)| *new < old)
                }) {
                    let mut preserved =
                        delivered(previous.as_ref().unwrap().0.clone(), None, false);
                    preserved["notices"].as_array_mut().unwrap().push(json!({"code":"online_cache_more_complete","text":"显示此前查询的完整剑桥内容。","entry_id":null}));
                    preserved
                } else {
                    trace.enter("cache_write");
                    write_cache(root.as_ref(), &key, &value).await;
                    trace.complete();
                    value
                }
            }
            Err(code) => {
                // Internal codes only: reading content, expressions, response
                // bodies and query-bearing URLs never enter diagnostics.
                trace.event("failure", json!({"code":code}));
                log::warn!("Public dictionary lookup unavailable; code={code}");
                match previous {
                    Some((value, _)) => delivered(value, None, true),
                    None => failure(expression, &code),
                }
            }
        };
        *state = Some((Instant::now(), value.clone()));
        value
    };
    let value = match tokio::time::timeout(Duration::from_secs(10), operation).await {
        Ok(value) => value,
        Err(_) => {
            trace.event("outer_timeout", json!({"code":"online_timeout"}));
            log::warn!("Public dictionary lookup unavailable; code=online_timeout");
            match cached(root.as_ref(), &key, expression).await {
                Some((value, _)) => delivered(value, None, true),
                None => failure(expression, "online_timeout"),
            }
        }
    };
    trace.event("total", json!({"status":value["status"]}));
    context(value, reading_context)
}

/// Debug-only native/libtest comparison over controlled loopback fixtures.
/// Default production routing is never replaced by this diagnostic function.
#[cfg(debug_assertions)]
pub(super) async fn run_transport_diagnostic(config: Value) -> Value {
    fn loopback(value: &Value, scheme: &str) -> Option<Url> {
        let url = Url::parse(value.as_str()?).ok()?;
        (url.scheme() == scheme
            && matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
            && url.port().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none())
        .then_some(url)
    }
    let Some(cases) = config["cases"]
        .as_array()
        .filter(|cases| !cases.is_empty() && cases.len() <= 8)
    else {
        return json!({"error":"diagnostic_config_invalid"});
    };
    let mut results = vec![];
    for case in cases {
        let id = match text(case, "id") {
            "normal_http" => "normal_http",
            "delayed_headers" => "delayed_headers",
            "delayed_body" => "delayed_body",
            "stalled_tls" => "stalled_tls",
            _ => return json!({"error":"diagnostic_case_invalid"}),
        };
        let builder = public_client_builder().no_proxy();
        let (target, builder) = match text(case, "route") {
            "direct_loopback" => {
                let Some(target) = loopback(&case["url"], "http") else {
                    return json!({"error":"diagnostic_target_invalid"});
                };
                (target, builder)
            }
            "controlled_https_proxy" => {
                let (Some(target), Some(proxy)) = (
                    loopback(&case["url"], "https"),
                    loopback(&case["proxy_url"], "http"),
                ) else {
                    return json!({"error":"diagnostic_proxy_invalid"});
                };
                if proxy.path() != "/" {
                    return json!({"error":"diagnostic_proxy_invalid"});
                }
                let Ok(proxy) = reqwest::Proxy::https(proxy.as_str()) else {
                    return json!({"error":"diagnostic_proxy_invalid"});
                };
                (target, builder.proxy(proxy))
            }
            _ => return json!({"error":"diagnostic_route_invalid"}),
        };
        let trace = TransportTrace::new();
        trace.enter("slot");
        let result = tokio::time::timeout(Duration::from_secs(10), async {
            let _slot = SLOTS
                .get_or_init(|| tokio::sync::Semaphore::new(2))
                .acquire()
                .await
                .unwrap();
            trace.complete();
            fetch_at(target, "important", &trace, builder).await
        })
        .await;
        let (outcome, code) = match result {
            Ok(Ok(value)) => (text(&value, "status").to_owned(), None),
            Ok(Err(code)) => {
                trace.event("failure", json!({"code":code}));
                ("unavailable".into(), Some(code))
            }
            Err(_) => {
                trace.event("outer_timeout", json!({"code":"online_timeout"}));
                ("unavailable".into(), Some("online_timeout".into()))
            }
        };
        trace.event("total", json!({"status":outcome}));
        results.push(json!({"case":id,"outcome":outcome,"code":code,"diagnostic":trace.report()}));
    }
    json!({"mode":"controlled_loopback_transport_comparison","production_client_builder":true,"production_transport_and_conversion":true,"fixture_routing":"explicit_loopback_only; user proxy settings not used for diagnostic fixtures","budgets_ms":{"http":9000,"connect":3000,"total":10000},"max_concurrent_requests":2,"retries":0,"cases":results})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    static ENV: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    const RECEIVED: &str = "2026-10-26T01:02:03Z";
    /// Synthetic transport fixtures exercise structure, not lexical accuracy.
    fn raw(word: &str) -> Value {
        json!({"word":word,"pos":["noun","verb"],"verbs":[{"text":"FOREIGN WIKTIONARY MUST NOT LEAK"}],"pronunciation":[
            {"pos":"noun","lang":"uk","url":"https://dictionary.cambridge.org/media/english/uk_pron/r/rec/recor/record.mp3","pron":"/ˈrek.ɔːd/"},
            {"pos":"verb","lang":"uk","url":"https://dictionary.cambridge.org/media/english/uk_pron/r/rec/recor/record2.mp3","pron":"/rɪˈkɔːd/"}],
            "definition":[{"id":0,"pos":"noun","source":"opaque-source-id","text":"first English unit","translation":"第一义","example":[{"id":0,"text":"first example","translation":"第一例句"}]},{"id":1,"pos":"verb","source":"opaque-source-id","text":"second English unit","translation":"第二义","example":[{"id":0,"text":"second example","translation":"第二例句"}]}]})
    }
    fn serve(
        status: u16,
        content_type: &str,
        body: String,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/", listener.local_addr().unwrap());
        let content_type = content_type.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_nonblocking(false).unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0; 8192];
            let n = stream.read(&mut bytes).unwrap();
            std::thread::sleep(delay);
            let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = stream.write_all(response.as_bytes());
            String::from_utf8_lossy(&bytes[..n]).into_owned()
        });
        (origin, handle)
    }
    fn environment(origin: &str, dir: &std::path::Path) {
        std::env::set_var("LEXICUE_CAMBRIDGE_PUBLIC_TEST_URL", origin);
        std::env::set_var("LEXICUE_CAMBRIDGE_PUBLIC_CACHE_DIR", dir);
    }
    fn clear_environment() {
        std::env::remove_var("LEXICUE_CAMBRIDGE_PUBLIC_TEST_URL");
        std::env::remove_var("LEXICUE_CAMBRIDGE_PUBLIC_CACHE_DIR");
    }
    #[test]
    fn payload_fixture_preserves_each_accepted_bilingual_unit() {
        let raw: Value =
            serde_json::from_str(include_str!("test_data/cambridge-public-important.json"))
                .unwrap();
        let result = convert(&raw, "important", RECEIVED).unwrap();
        assert_eq!(result["status"], "found");
        assert_eq!(
            result["entries"][0]["source"]["adapter_version"],
            "cambridge-public-v1.1.0"
        );
        let groups = result["entries"][0]["groups"].as_array().unwrap();
        assert_eq!(groups.len(), raw["definition"].as_array().unwrap().len());
        assert!(groups.len() > 1);
        for (group, definition) in groups.iter().zip(raw["definition"].as_array().unwrap()) {
            let sense = &group["senses"][0];
            assert_eq!(
                sense["meaning"]["en"],
                clean(&definition["text"])
                    .unwrap()
                    .map(Value::String)
                    .unwrap_or(Value::Null)
            );
            assert_eq!(
                sense["meaning"]["zh"],
                clean(&definition["translation"])
                    .unwrap()
                    .map(Value::String)
                    .unwrap_or(Value::Null)
            );
            assert_eq!(
                sense["examples"].as_array().unwrap().len(),
                definition["example"].as_array().unwrap().len()
            );
            for (example, original) in sense["examples"]
                .as_array()
                .unwrap()
                .iter()
                .zip(definition["example"].as_array().unwrap())
            {
                assert_eq!(
                    example["english"],
                    clean(&original["text"]).unwrap().unwrap()
                );
                assert_eq!(
                    example["chinese"],
                    clean(&original["translation"])
                        .unwrap()
                        .map(Value::String)
                        .unwrap_or(Value::Null)
                );
            }
            assert_eq!(group["source_part_of_speech"], definition["pos"]);
            assert_eq!(group["pronunciations"].as_array().unwrap().len(), 2);
        }
    }
    #[test]
    fn payload_fixture_rejects_unproven_mixed_translation_scope() {
        let raw: Value =
            serde_json::from_str(include_str!("test_data/cambridge-public-record.json")).unwrap();
        let definitions = raw["definition"].as_array().unwrap();
        assert!(definitions
            .iter()
            .any(|d| clean(&d["translation"]).unwrap().is_some()));
        assert!(definitions
            .iter()
            .any(|d| clean(&d["text"]).unwrap().is_some()
                && clean(&d["translation"]).unwrap().is_none()));
        assert_eq!(
            convert(&raw, "record", RECEIVED).unwrap_err(),
            "online_public_scope_unconfirmed"
        );
    }
    #[test]
    fn mixed_translation_scope_rejects_whole_payload_and_normalized_entry() {
        let original = raw("synthetic");
        let admitted = convert(&original, "synthetic", RECEIVED).unwrap();
        let mut mixed = original.clone();
        mixed["definition"][1]["translation"] = Value::Null;
        assert_eq!(
            convert(&mixed, "synthetic", RECEIVED).unwrap_err(),
            "online_public_scope_unconfirmed"
        );
        let mut normalized = admitted.clone();
        normalized["entries"][0]["groups"][1]["senses"][0]["meaning"]["zh"] = Value::Null;
        assert!(!valid_entry(&normalized["entries"][0], "synthetic"));
        assert!(!valid_result_scope(&normalized));
        assert!(validate_result(&normalized, "synthetic").is_err());
        mixed["definition"][0]["translation"] = json!(" ");
        let partial = convert(&mixed, "synthetic", RECEIVED).unwrap();
        assert_eq!(partial["status"], "partial");
        assert!(valid_entry(&partial["entries"][0], "synthetic"));
        let mut old_source = admitted.clone();
        old_source["entries"][0]["source"]["adapter_version"] = json!("cambridge-public-v1.0.0");
        assert!(!valid_source(&old_source["entries"][0]["source"]));
        assert!(validate_result(&old_source, "synthetic").is_err());
        let old_namespace: Value = serde_json::from_str(&admitted.to_string().replace(
            "cambridge:public:cambridge-public-v1.1.0:",
            "cambridge:public:cambridge-public-v1.0.0:",
        ))
        .unwrap();
        assert!(!valid_entry(&old_namespace["entries"][0], "synthetic"));
        assert!(validate_result(&old_namespace, "synthetic").is_err());
    }
    #[test]
    fn mixed_abbreviation_scope_rejects_entire_result_without_filtering_senses() {
        let fixture: Value =
            serde_json::from_str(include_str!("test_data/cambridge-public-us.json")).unwrap();
        assert_eq!(
            convert(&fixture, "us", RECEIVED).unwrap_err(),
            "online_public_scope_unconfirmed"
        );
        let mut mixed = raw("synthetic");
        mixed["definition"][0]["text"] = json!("abbreviation for a complete target");
        assert_eq!(
            convert(&mixed, "synthetic", RECEIVED).unwrap_err(),
            "online_public_scope_unconfirmed"
        );
        mixed["definition"].as_array_mut().unwrap().pop();
        assert!(convert(&mixed, "synthetic", RECEIVED).is_ok());
    }
    #[test]
    fn conversion_preserves_per_object_correspondence_identity_and_source() {
        let value = convert(&raw("record"), "record", RECEIVED).unwrap();
        assert_eq!(value["status"], "found");
        let e = &value["entries"][0];
        assert_eq!(e["groups"].as_array().unwrap().len(), 2);
        for (index, (en, zh, example)) in [
            ("first English unit", "第一义", "first example"),
            ("second English unit", "第二义", "second example"),
        ]
        .iter()
        .enumerate()
        {
            let sense = &e["groups"][index]["senses"][0];
            assert_eq!(sense["meaning"]["en"], *en);
            assert_eq!(sense["meaning"]["zh"], *zh);
            assert_eq!(sense["examples"][0]["english"], *example);
        }
        assert!(e["groups"][0]["pronunciations"][0]["ipa"]
            .as_str()
            .unwrap()
            .starts_with('ˈ'));
        assert!(e["groups"][1]["pronunciations"][0]["ipa"]
            .as_str()
            .unwrap()
            .starts_with('r'));
        assert_eq!(e["source"]["entry_url"], Value::Null);
        assert_eq!(e["source"]["retrieved_at"], Value::Null);
        assert_eq!(e["source"]["received_at"], RECEIVED);
        assert!(!value.to_string().contains("FOREIGN WIKTIONARY"));
        let newer = convert(&raw("record"), "record", "2026-10-27T01:02:03Z").unwrap();
        assert_eq!(e["groups"], newer["entries"][0]["groups"]);
        assert_eq!(value["default_entry_id"], newer["default_entry_id"]);
        assert!(convert(&raw("look"), "look it up", RECEIVED).is_err());
        assert!(convert(&raw("car"), "a red car", RECEIVED).is_err());
        assert!(convert(&raw("look up"), "look up", RECEIVED).is_err());
        assert!(convert(&raw("us"), "US", RECEIVED).is_err());
        assert!(convert(&raw("us"), "Us", RECEIVED).is_err());
        assert!(convert(&raw("record"), "Record", RECEIVED).is_err());
        assert!(convert(&raw("Record"), "Record", RECEIVED).is_ok());
        assert!(convert(&raw("record"), "rEcord", RECEIVED).is_err());
        assert!(convert(&raw("take"), "took", RECEIVED).is_err());
    }
    #[test]
    fn uncertain_pronunciation_optional_content_and_shape_failures() {
        let mut data = raw("record");
        let mut second = data["pronunciation"][0].clone();
        second["pron"] = json!("alternative");
        second["url"] = json!("https://dictionary.cambridge.org/media/alternative.mp3");
        data["pronunciation"].as_array_mut().unwrap().push(second);
        let value = convert(&data, "record", RECEIVED).unwrap();
        assert!(value["entries"][0]["groups"][0]["pronunciations"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(
            value["entries"][0]["groups"][1]["pronunciations"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        data["definition"][0]["translation"] = json!(" ");
        data["definition"][1]["translation"] = Value::Null;
        data["definition"][0]["example"][0]["translation"] = json!("");
        data["pronunciation"] = json!([]);
        let value = convert(&data, "record", RECEIVED).unwrap();
        assert_eq!(value["status"], "partial");
        assert!(value["entries"][0]["groups"][0]["senses"][0]["examples"][0]["chinese"].is_null());
        for field in ["definition", "word", "pronunciation", "pos"] {
            let mut invalid = raw("record");
            invalid.as_object_mut().unwrap().remove(field);
            assert!(convert(&invalid, "record", RECEIVED).is_err(), "{field}");
        }
        for tail in ["abbreviation for ", "past tense of:", "short for"] {
            let mut invalid = raw("record");
            invalid["definition"][0]["text"] = json!(tail);
            assert!(convert(&invalid, "record", RECEIVED).is_err());
        }
        let mut invalid = raw("record");
        invalid["definition"][0]["text"] = json!("<b>HTML</b>");
        assert!(convert(&invalid, "record", RECEIVED).is_err());
        let mut invalid = convert(&raw("record"), "record", RECEIVED).unwrap();
        invalid["entries"][0]["source"]["service_url"] = json!("https://example.com");
        assert!(validate_result(&invalid, "record").is_err());
        let keys = [
            "US",
            "us",
            "run-in",
            "run in",
            "look up",
            "look it up",
            "record",
            " record",
        ]
        .map(cache_key);
        assert_eq!(keys.iter().collect::<HashSet<_>>().len(), keys.len());
        assert_eq!(
            url("US & us/?#").path(),
            "/api/dictionary/en-cn/US%20&%20us%2F%3F%23"
        );
    }
    #[tokio::test]
    async fn unsupported_multiword_scope_uses_zero_http_requests() {
        let _guard = ENV.lock().await;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}/", listener.local_addr().unwrap());
        let dir = tempfile::tempdir().unwrap();
        environment(&origin, dir.path());
        let result = query("look it up", Some("PRIVATE LOCAL CONTEXT"), false).await;
        assert_eq!(result["status"], "unavailable");
        assert_eq!(
            result["notices"][0]["code"],
            "online_public_expression_unconfirmed"
        );
        assert_eq!(result["query"]["context"], "PRIVATE LOCAL CONTEXT");
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        clear_environment();
    }
    #[tokio::test]
    #[ignore = "explicit controlled loopback fixture comparison; no public service requests"]
    async fn public_local_runtime_diagnostic() {
        let config_path = std::env::var_os("LEXICUE_PUBLIC_TRANSPORT_DIAGNOSTIC_CONFIG")
            .expect("explicit local fixture config");
        let output_path = std::env::var_os("LEXICUE_PUBLIC_TRANSPORT_DIAGNOSTIC_REPORT")
            .expect("explicit safe report path");
        let config: Value = serde_json::from_slice(&std::fs::read(config_path).unwrap()).unwrap();
        let report = run_transport_diagnostic(config).await;
        assert!(
            report.get("error").is_none(),
            "invalid controlled fixture config"
        );
        std::fs::write(
            output_path,
            serde_json::to_vec_pretty(
                &json!({"runtime":"tokio_test_current_thread","report":report}),
            )
            .unwrap(),
        )
        .unwrap();
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    }
    #[tokio::test]
    async fn current_cache_revalidates_scope_and_rejects_old_adapter_without_deletion() {
        let _guard = ENV.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let received_at =
            time::OffsetDateTime::from_unix_timestamp_nanos(now() as i128 * 1_000_000)
                .unwrap()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap();
        let current = convert(&raw("synthetic"), "synthetic", &received_at).unwrap();
        let key = cache_key("synthetic");
        write_cache(Some(&root), &key, &current).await;
        assert!(cached(Some(&root), &key, "synthetic").await.is_some());
        let old_key = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&(
                    1,
                    "author_public_api",
                    "cambridge-public-v1.0.0",
                    SERVICE,
                    request_origin(),
                    "synthetic",
                    "entire_confirmed_word"
                ))
                .unwrap()
            )
        );
        assert_ne!(key, old_key);
        let old: Value = serde_json::from_str(
            &current
                .to_string()
                .replace("cambridge-public-v1.1.0", "cambridge-public-v1.0.0"),
        )
        .unwrap();
        write_cache(Some(&root), &old_key, &old).await;
        let old_path = root.join(format!("{old_key}.json"));
        let old_bytes = std::fs::read(&old_path).unwrap();
        assert!(cached(Some(&root), &old_key, "synthetic").await.is_none());
        assert_eq!(std::fs::read(&old_path).unwrap(), old_bytes);
        let mut mixed = current.clone();
        mixed["entries"][0]["groups"][1]["senses"][0]["meaning"]["zh"] = Value::Null;
        write_cache(Some(&root), &key, &mixed).await;
        assert!(cached(Some(&root), &key, "synthetic").await.is_none());
        write_cache(Some(&root), &key, &old).await;
        assert!(cached(Some(&root), &key, "synthetic").await.is_none());
    }
    #[tokio::test]
    async fn public_transport_cache_context_privacy_and_failure_coalescing() {
        let _guard = ENV.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let (origin, handle) = serve(
            200,
            "application/json",
            raw("record").to_string(),
            Duration::from_millis(100),
        );
        environment(&origin, dir.path());
        let (one, two) = tokio::join!(
            query("record", Some("PRIVATE CONTEXT ONE"), false),
            query("record", Some("PRIVATE CONTEXT TWO"), false)
        );
        assert_eq!(one["status"], "found");
        assert_eq!(two["status"], "found");
        assert_eq!(one["query"]["context"], "PRIVATE CONTEXT ONE");
        assert_eq!(two["query"]["context"], "PRIVATE CONTEXT TWO");
        let request = handle.join().unwrap();
        assert!(
            request.starts_with("GET /api/dictionary/en-cn/record HTTP/1.1"),
            "{request}"
        );
        assert!(!request.contains("PRIVATE"));
        assert!(!request.contains("context"));
        let path = dir.path().join(format!("{}.json", cache_key("record")));
        let disk = std::fs::read_to_string(&path).unwrap();
        assert!(!disk.contains("PRIVATE"));
        assert!(disk.contains("\"context\":null"));
        let cached_value = query("record", None, false).await;
        assert_eq!(cached_value["entries"][0]["source"]["delivery"], "cache");
        assert_eq!(
            cached_value["entries"][0]["source"]["received_at"],
            one["entries"][0]["source"]["received_at"]
        );
        let stale = query("record", None, true).await;
        assert_eq!(stale["status"], "found");
        assert!(stale["notices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["code"] == "online_cache_stale"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), disk);
        let (origin, handle) = serve(
            404,
            "application/json",
            json!({"error":"word not found"}).to_string(),
            Duration::from_millis(100),
        );
        environment(&origin, dir.path());
        let (one, two) = tokio::join!(query("missing", None, false), query("missing", None, false));
        assert_eq!(one["status"], "unavailable");
        assert_eq!(one, two);
        handle.join().unwrap();
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        clear_environment();
    }
    #[tokio::test]
    async fn less_complete_refresh_preserves_complete_cache_and_expired_failure_is_stale() {
        let _guard = ENV.lock().await;
        let dir = tempfile::tempdir().unwrap();
        let mut partial = raw("record");
        partial["definition"][0]["translation"] = Value::Null;
        partial["definition"][1]["translation"] = Value::Null;
        let (origin, handle) = serve(200, "application/json", partial.to_string(), Duration::ZERO);
        environment(&origin, dir.path());
        let old_ms = now().saturating_sub(CACHE_TTL_MS + 1000);
        let old_at = time::OffsetDateTime::from_unix_timestamp_nanos(old_ms as i128 * 1_000_000)
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        let complete = convert(&raw("record"), "record", &old_at).unwrap();
        let key = cache_key("record");
        write_cache(Some(&dir.path().to_path_buf()), &key, &complete).await;
        let path = dir.path().join(format!("{key}.json"));
        let disk = std::fs::read_to_string(&path).unwrap();
        let preserved = query("record", None, true).await;
        assert_eq!(preserved["status"], "found");
        assert!(preserved["notices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["code"] == "online_cache_more_complete"));
        handle.join().unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), disk);
        let stale = query("record", None, false).await;
        assert!(stale["notices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["code"] == "online_cache_stale"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), disk);
        clear_environment();
    }
    #[tokio::test]
    async fn public_http_errors_and_changed_payload_never_create_negative_cache() {
        let _guard = ENV.lock().await;
        let dir = tempfile::tempdir().unwrap();
        for (status, kind, body, code) in [
            (
                404,
                "application/json",
                "{\"error\":\"word not found\"}",
                "online_public_not_obtained",
            ),
            (429, "application/json", "{}", "online_rate_limited"),
            (503, "application/json", "{}", "online_service_unavailable"),
            (
                200,
                "text/html",
                "<html>Error</html>",
                "online_invalid_content",
            ),
            (200, "application/json", "{}", "online_public_shape_changed"),
            (
                200,
                "application/json",
                "not-json",
                "online_public_shape_changed",
            ),
        ] {
            let (origin, handle) = serve(status, kind, body.into(), Duration::ZERO);
            environment(&origin, dir.path());
            let value = query("missing", None, false).await;
            assert_eq!(value["status"], "unavailable");
            assert_eq!(value["notices"][0]["code"], code);
            handle.join().unwrap();
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        clear_environment();
    }
    #[tokio::test]
    #[ignore = "one bounded real author-service request; saves evidence even when service rejects the client"]
    async fn public_live_record_evidence() {
        assert!(
            std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_TEST_URL").is_none(),
            "live test cannot use fixture URL"
        );
        let query_text = std::env::var("LEXICUE_CAMBRIDGE_PUBLIC_TEST_QUERY")
            .unwrap_or_else(|_| "record".into());
        let result = query(
            &query_text,
            Some("private context stays on this device"),
            true,
        )
        .await;
        if let Some(path) = std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_CAPTURE_RESULT") {
            std::fs::write(path, serde_json::to_vec_pretty(&result).unwrap()).unwrap();
        }
        println!("{}", serde_json::to_string_pretty(&result).unwrap());
        assert!(matches!(
            text(&result, "status"),
            "found" | "partial" | "unavailable"
        ));
    }
    #[test]
    #[ignore = "offline-only final adapter replay; writes evidence only to explicit output directory"]
    fn public_replay_captured_live_evidence() {
        let input = PathBuf::from(
            std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_REPLAY_INPUT_DIR")
                .expect("explicit captured input directory"),
        );
        let output = PathBuf::from(
            std::env::var_os("LEXICUE_CAMBRIDGE_PUBLIC_REPLAY_OUTPUT_DIR")
                .expect("explicit output directory"),
        );
        std::fs::create_dir_all(&output).unwrap();
        let mut paths: Vec<_> = std::fs::read_dir(input)
            .unwrap()
            .map(|p| p.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("native-live-")
                    && p.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .ends_with("-raw.json")
            })
            .collect();
        paths.sort();
        for path in paths {
            let captured: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            let source_url = Url::parse(captured["url"].as_str().unwrap()).unwrap();
            assert_eq!(source_url.host_str(), Some("dictionary-api.eliaschen.dev"));
            let expression = percent_encoding::percent_decode_str(
                source_url.path_segments().unwrap().next_back().unwrap(),
            )
            .decode_utf8()
            .unwrap()
            .into_owned();
            let received_at = time::OffsetDateTime::from_unix_timestamp_nanos(
                captured["received_ms"].as_u64().unwrap() as i128 * 1_000_000,
            )
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
            let result = match captured["status"].as_u64().unwrap() {
                200..=299 => convert(&captured["raw_json"], &expression, &received_at)
                    .unwrap_or_else(|code| failure(&expression, &code)),
                404 => failure(&expression, "online_public_not_obtained"),
                429 => failure(&expression, "online_rate_limited"),
                500..=599 => failure(&expression, "online_service_unavailable"),
                _ => failure(&expression, "online_http_error"),
            };
            let name = path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .replace("-raw.json", "-final-result.json");
            std::fs::write(output.join(name),serde_json::to_vec_pretty(&json!({"mode":"offline replay of captured real author HTTP response through final adapter; no new network request","captured_http_status":captured["status"],"source_capture":path,"result":result})).unwrap()).unwrap();
            println!(
                "{}",
                json!({"expression":expression,"status":result["status"],"notice_codes":result["notices"].as_array().unwrap().iter().map(|n|n["code"].clone()).collect::<Vec<_>>()})
            );
        }
    }
}
