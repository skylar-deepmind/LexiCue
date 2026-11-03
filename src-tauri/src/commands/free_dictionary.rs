//! English-only Wiktionary adapter. The API source locator is evidence supplied
//! by FreeDictionaryAPI.com, not an independent verification of Wiktionary.
use reqwest::{redirect::Policy, Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub const SERVICE: &str = "https://freedictionaryapi.com";
pub const ADAPTER: &str = "freedictionaryapi-v1.0.0";
pub const ATTRIBUTION: &str = "Wiktionary contributors via FreeDictionaryAPI.com";
pub const MODIFICATIONS: &str = "Adapted English definitions and ordinary examples; translations, quotations and audio omitted.";
const MAX_JSON: usize = 2 * 1024 * 1024;
const CACHE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_ITEMS: usize = 256;
const MAX_SENSES: usize = 2048;
const MAX_DEPTH: usize = 8;
static CACHE_ROOT: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
type QueryState = tokio::sync::Mutex<Option<(Instant, Value)>>;
static IN_FLIGHT: OnceLock<tokio::sync::Mutex<HashMap<String, Weak<QueryState>>>> = OnceLock::new();
static COOLDOWN: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static SLOTS: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn timestamp() -> String {
    time::OffsetDateTime::from_unix_timestamp_nanos(now() as i128 * 1_000_000)
        .unwrap()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}
pub fn configure(app: &tauri::AppHandle) {
    *CACHE_ROOT
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("cache/freedictionaryapi-v1"));
}
fn clean(v: &Value) -> Result<Option<String>, String> {
    if v.is_null() {
        return Ok(None);
    }
    let s = v.as_str().ok_or("online_free_shape_changed")?.trim();
    if s.len() > 16_384
        || s.contains(['<', '>'])
        || s.chars().any(|c| c.is_control() && !c.is_whitespace())
    {
        return Err("online_free_invalid_text".into());
    }
    Ok((!s.is_empty()).then(|| s.to_owned()))
}
fn array<'a>(v: &'a Value, key: &str, required: bool) -> Result<&'a [Value], String> {
    if !required && v.get(key).is_none() {
        return Ok(&[]);
    }
    let a = v[key].as_array().ok_or("online_free_shape_changed")?;
    if a.len() > MAX_ITEMS {
        return Err("online_free_structure_limit".into());
    }
    Ok(a)
}
fn hash(v: &Value) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(v).unwrap()))
}
fn id(kind: &str, v: &Value) -> String {
    format!("wiktionary:{ADAPTER}:{kind}:{}", hash(v))
}
/// Decode a source page exactly once. Underscore has MediaWiki's documented
/// space meaning; case, punctuation and number of spaces remain significant.
pub fn source_identity(url: &str, expression: &str) -> bool {
    if expression.trim().is_empty()
        || expression.len() > 256
        || expression.chars().any(char::is_control)
    {
        return false;
    }
    let Ok(u) = Url::parse(url) else {
        return false;
    };
    if u.scheme() != "https"
        || u.host_str() != Some("en.wiktionary.org")
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return false;
    }
    let Some(path) = u.path().strip_prefix("/wiki/") else {
        return false;
    };
    if path.is_empty() || path.contains('/') {
        return false;
    }
    let bytes = path.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit()
            {
                return false;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()
        .is_some_and(|p| p.replace('_', " ") == expression.replace('_', " "))
}
/// Complete relationship patterns are deliberately conservative. Short synonym
/// definitions and complete abbreviation expansions remain definitions.
pub fn relation_only(definition: &str, tags: &[Value]) -> bool {
    if tags
        .iter()
        .any(|t| matches!(t.as_str(), Some("form of" | "alt-of" | "misspelling")))
    {
        return true;
    }
    static RELATION: OnceLock<regex::Regex> = OnceLock::new();
    RELATION.get_or_init(|| regex::Regex::new(r"(?i)^(?:\([^)]*\)\s*)*(?:(?:plural|singular|past(?:\s+(?:tense|simple|participle))?|present(?:\s+(?:tense|participle))?|third-person(?:\s+singular)?(?:\s+simple)?(?:\s+present)?(?:\s+indicative)?|gerund|(?:present participle and )?gerund|present participle and gerund|clipping|misspelling|(?:alternative|alternate|nonstandard|standard)\s+(?:form|spelling)|inflection|comparative|superlative|contraction|variant)\s+of\b.+|(?:the\s+)?(?:act|process|act or process|action)\s+of\s+\S+ing[.!]?|something\s+\w+(?:ed|ized)\.?)$").unwrap()).is_match(definition.trim())
}
fn labels(v: &[Value]) -> Result<Vec<Value>, String> {
    v.iter()
        .map(|x| {
            clean(x)?
                .ok_or_else(|| "online_free_invalid_text".to_owned())
                .map(|s| json!({"kind":"register","text":s}))
        })
        .collect()
}
fn pos(s: &str) -> &str {
    match s {
        "noun" | "verb" | "adjective" | "adverb" | "pronoun" | "determiner" | "preposition"
        | "conjunction" | "interjection" | "numeral" | "particle" | "prefix" | "suffix"
        | "abbreviation" | "symbol" => s,
        "number" => "numeral",
        _ => "other",
    }
}
fn pronunciations(entry: &Value) -> Result<Vec<Value>, String> {
    let mut out = vec![];
    for p in array(entry, "pronunciations", false)? {
        if !p.is_object() {
            return Err("online_free_shape_changed".into());
        }
        let tags = array(p, "tags", false)?;
        let us = tags.iter().any(|t| {
            matches!(
                t.as_str(),
                Some("US" | "General American" | "United States")
            )
        });
        let uk = tags.iter().any(|t| {
            matches!(
                t.as_str(),
                Some("UK" | "Received Pronunciation" | "British" | "United Kingdom")
            )
        });
        if p["type"] != "ipa" || us == uk {
            continue;
        }
        if let Some(ipa) = clean(&p["text"])? {
            let ipa = ipa.trim_matches('/').trim();
            if ipa.is_empty() || ipa.contains('/') || ipa.chars().any(char::is_control) {
                continue;
            }
            let item =
                json!({"region":if us{"us"}else{"uk"},"ipa":ipa,"audio":null,"form_label":null});
            if !out.contains(&item) {
                out.push(item);
            }
        }
    }
    Ok(out)
}
// The explicit recursive traversal carries source scope and bounded shared output.
#[allow(clippy::too_many_arguments)]
fn visit_sense(
    raw: &Value,
    path: &str,
    scope: &Value,
    ancestors: &[Value],
    depth: usize,
    count: &mut usize,
    out: &mut Vec<Value>,
    duplicates: &mut HashMap<String, usize>,
) -> Result<(), String> {
    *count += 1;
    if depth > MAX_DEPTH || *count > MAX_SENSES {
        return Err("online_free_structure_limit".into());
    }
    if !raw.is_object() {
        return Err("online_free_shape_changed".into());
    }
    let definition = clean(&raw["definition"])?.ok_or("online_free_missing_definition")?;
    let raw_tags = array(raw, "tags", false)?;
    let sense_labels = labels(raw_tags)?;
    // Validate arrays even for fields intentionally omitted from the product.
    for key in ["quotes", "synonyms", "antonyms", "translations"] {
        array(raw, key, false)?;
    }
    let kind = if relation_only(&definition, raw_tags) {
        "relation"
    } else {
        "definition"
    };
    let ancestor_semantics: Vec<Value> = ancestors
        .iter()
        .map(|a| json!([a["meaning"], a["labels"]]))
        .collect();
    let content = json!([scope, definition, sense_labels, ancestor_semantics]);
    let duplicate = duplicates.entry(hash(&content)).or_default();
    let sid = id("sense", &json!([content, *duplicate]));
    *duplicate += 1;
    let mut examples = vec![];
    for example in array(raw, "examples", false)? {
        if let Some(english) = clean(example)? {
            let ex = json!({"id":id("example",&json!([sid,english])),"english":english,"chinese":null,"audio":null});
            if !examples.contains(&ex) {
                examples.push(ex);
            }
        }
    }
    let meaning = json!({"en":definition,"zh":null});
    out.push(json!({"id":sid,"meaning":meaning,"labels":sense_labels,"patterns":[],"examples":examples,"notes":[],"source_path":path,"ancestors":ancestors,"content_kind":kind}));
    let mut parents = ancestors.to_vec();
    parents.push(json!({"source_path":path,"meaning":meaning,"labels":sense_labels}));
    for (i, sub) in array(raw, "subsenses", false)?.iter().enumerate() {
        visit_sense(
            sub,
            &format!("{path}/subsenses/{i}"),
            scope,
            &parents,
            depth + 1,
            count,
            out,
            duplicates,
        )?;
    }
    Ok(())
}
pub fn convert(raw: &Value, expression: &str, received_at: &str) -> Result<Value, String> {
    if serde_json::to_vec(raw)
        .map_err(|_| "online_free_shape_changed")?
        .len()
        > MAX_JSON
    {
        return Err("online_response_too_large".into());
    }
    let raw_entries = array(raw, "entries", true)?;
    if raw_entries.is_empty() {
        return Err("online_free_not_found".into());
    }
    let source = &raw["source"];
    let source_url = source["url"]
        .as_str()
        .ok_or("online_free_identity_unconfirmed")?;
    if !source_identity(source_url, expression) {
        return Err("online_free_identity_unconfirmed".into());
    }
    let source_url = Url::parse(source_url)
        .map_err(|_| "online_free_identity_unconfirmed")?
        .to_string();
    if source["license"]["name"] != "CC BY-SA 4.0"
        || source["license"]["url"] != "https://creativecommons.org/licenses/by-sa/4.0/"
    {
        return Err("online_free_license_unconfirmed".into());
    }
    if !super::cambridge::valid_retrieved_at(received_at) {
        return Err("online_clock_error".into());
    }
    let content_hash = hash(raw);
    let mut entries = vec![];
    let mut total = 0;
    let mut entry_duplicates = HashMap::<String, usize>::new();
    for (ei, e) in raw_entries.iter().enumerate() {
        if e["language"]["code"] != "en" || e["language"]["name"] != "English" {
            return Err("online_free_language_unconfirmed".into());
        }
        let source_pos = clean(&e["partOfSpeech"])?.ok_or("online_free_missing_pos")?;
        let raw_senses = array(e, "senses", true)?;
        if raw_senses.is_empty() {
            return Err("online_free_missing_definition".into());
        }
        let content = json!([source_url, e]);
        let occurrence = entry_duplicates.entry(hash(&content)).or_default();
        let eid = id("entry", &json!([content, *occurrence]));
        *occurrence += 1;
        let gid = id("group", &json!([eid, source_pos]));
        let mut senses = vec![];
        let mut duplicates = HashMap::new();
        for (si, s) in raw_senses.iter().enumerate() {
            visit_sense(
                s,
                &format!("/entries/{ei}/senses/{si}"),
                &json!([eid, gid]),
                &[],
                0,
                &mut total,
                &mut senses,
                &mut duplicates,
            )?;
        }
        let locator = format!("/entries/{ei}");
        entries.push(json!({"id":eid,"headword":expression,"kind":if expression.split_whitespace().count()>1{"expression"}else{"word"},"expression_type":null,"origin":"headword","parent_headword":null,
          "source":{"provider":"wiktionary","dataset":"Wiktionary","edition":null,"release":null,"adapter_version":ADAPTER,"delivery":"online","entry_key":eid,"locator":locator,"entry_url":source_url,"retrieved_at":received_at,"access_channel":"freedictionaryapi","service_url":SERVICE,"received_at":received_at,"content_hash":content_hash,"license":source["license"],"attribution":ATTRIBUTION,"modifications":MODIFICATIONS},
          "match":{"type":"exact","pattern":null,"note":null,"sense_ids":[]},"groups":[{"id":gid,"part_of_speech":pos(&source_pos),"source_part_of_speech":source_pos,"pronunciations":pronunciations(e)?,"forms":[],"labels":[],"senses":senses,"notes":[]}],"notes":[],"related_expressions":[]}));
    }
    let default = entries
        .iter()
        .find(|e| {
            e["groups"][0]["senses"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["content_kind"] == "definition")
        })
        .map(|e| e["id"].clone())
        .ok_or("online_free_relation_only")?;
    let result = json!({"schema_version":1,"query":{"text":expression,"language":"en","context":null},"status":"partial","default_entry_id":default,"entries":entries,"notices":[{"code":"online_free_english_only","text":"Wiktionary 仅提供英文释义。","entry_id":null}]});
    validate_result(&result, expression)?;
    Ok(result)
}
fn schema() -> &'static jsonschema::JSONSchema {
    static SCHEMA: OnceLock<jsonschema::JSONSchema> = OnceLock::new();
    SCHEMA.get_or_init(|| {
        jsonschema::JSONSchema::options()
            .with_draft(jsonschema::Draft::Draft202012)
            .should_validate_formats(true)
            .compile(
                &serde_json::from_str::<Value>(include_str!(
                    "../../../docs/implementation/dictionary-result-v1.schema.json"
                ))
                .unwrap(),
            )
            .expect("dictionary V1 schema")
    })
}
pub fn valid_source(source: &Value) -> bool {
    text(source, "entry_key").starts_with(&format!("wiktionary:{ADAPTER}:entry:"))
        && source["provider"] == "wiktionary"
        && source["dataset"] == "Wiktionary"
        && source["adapter_version"] == ADAPTER
        && source["access_channel"] == "freedictionaryapi"
        && source["service_url"] == SERVICE
        && source["edition"].is_null()
        && source["release"].is_null()
        && source["attribution"] == ATTRIBUTION
        && source["modifications"] == MODIFICATIONS
        && source["license"]["name"] == "CC BY-SA 4.0"
        && source["license"]["url"] == "https://creativecommons.org/licenses/by-sa/4.0/"
        && super::cambridge::valid_retrieved_at(text(source, "received_at"))
        && source["received_at"] == source["retrieved_at"]
        && source["content_hash"].as_str().is_some_and(|s| {
            s.len() == 64
                && s.bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        })
        && source["locator"].as_str().is_some_and(|p| {
            p.strip_prefix("/entries/")
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        })
}
pub fn validate_result(value: &Value, expression: &str) -> Result<(), String> {
    if !schema().is_valid(value)
        || value["query"]["text"] != expression
        || !value["query"]["context"].is_null()
        || value["status"] != "partial"
    {
        return Err("online_free_invalid_result".into());
    }
    let mut ids = HashSet::new();
    fn scan(v: &Value, ids: &mut HashSet<String>) -> bool {
        match v {
            Value::Object(m) => {
                if let Some(i) = m.get("id") {
                    if !i.as_str().is_some_and(|s| {
                        s.starts_with(&format!("wiktionary:{ADAPTER}:")) && ids.insert(s.to_owned())
                    }) {
                        return false;
                    }
                }
                if m.get("audio").is_some_and(|v| !v.is_null()) {
                    return false;
                }
                m.values().all(|v| scan(v, ids))
            }
            Value::Array(a) => a.iter().all(|v| scan(v, ids)),
            Value::String(s) => {
                s.len() <= 16_384
                    && !s.contains(['<', '>'])
                    && !s.chars().any(|c| c.is_control() && !c.is_whitespace())
            }
            _ => true,
        }
    }
    if !scan(&value["entries"], &mut ids) {
        return Err("online_invalid_identity".into());
    }
    static PATH: OnceLock<regex::Regex> = OnceLock::new();
    let sense_path = PATH.get_or_init(|| {
        regex::Regex::new(r"^/entries/[0-9]+/senses/[0-9]+(?:/subsenses/[0-9]+){0,8}$").unwrap()
    });
    let mut definition = false;
    let mut default = false;
    for entry in value["entries"].as_array().unwrap() {
        let source = &entry["source"];
        if !valid_source(source)
            || source["entry_key"] != entry["id"]
            || !source_identity(text(source, "entry_url"), expression)
            || !matches!(text(source, "delivery"), "online" | "cache")
            || entry["headword"] != expression
            || entry["origin"] != "headword"
            || !entry["parent_headword"].is_null()
            || !entry["expression_type"].is_null()
            || entry["kind"]
                != if expression.split_whitespace().count() > 1 {
                    "expression"
                } else {
                    "word"
                }
            || !entry["notes"].as_array().unwrap().is_empty()
            || !entry["related_expressions"].as_array().unwrap().is_empty()
            || entry["groups"].as_array().unwrap().len() != 1
            || entry["match"]["type"] != "exact"
            || !entry["match"]["pattern"].is_null()
            || !entry["match"]["note"].is_null()
            || !entry["match"]["sense_ids"].as_array().unwrap().is_empty()
        {
            return Err("online_free_invalid_source".into());
        }
        let mut entry_definition = false;
        for g in entry["groups"].as_array().unwrap() {
            if text(g, "source_part_of_speech").trim().is_empty()
                || g["part_of_speech"] != pos(text(g, "source_part_of_speech"))
                || !g["notes"].as_array().unwrap().is_empty()
                || !g["forms"].as_array().unwrap().is_empty()
                || g["pronunciations"].as_array().unwrap().iter().any(|p| {
                    !matches!(text(p, "region"), "us" | "uk") || text(p, "ipa").trim().is_empty()
                })
            {
                return Err("online_free_invalid_scope".into());
            }
            for s in g["senses"].as_array().unwrap() {
                if !s["meaning"]["zh"].is_null()
                    || s["meaning"]["en"].as_str().is_none()
                    || !matches!(text(s, "content_kind"), "definition" | "relation")
                    || s["ancestors"].as_array().is_none()
                    || !s["patterns"].as_array().unwrap().is_empty()
                    || !s["notes"].as_array().unwrap().is_empty()
                    || s["examples"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|e| !e["chinese"].is_null())
                    || !text(s, "source_path")
                        .starts_with(&format!("{}/senses/", text(source, "locator")))
                {
                    return Err("online_free_invalid_scope".into());
                }
                let path = text(s, "source_path");
                if !sense_path.is_match(path) {
                    return Err("online_free_invalid_scope".into());
                }
                let chain: Vec<&str> = path.split("/subsenses/").collect();
                let ancestors = s["ancestors"].as_array().unwrap();
                if ancestors.len() != chain.len() - 1 {
                    return Err("online_free_invalid_scope".into());
                }
                for (index, a) in ancestors.iter().enumerate() {
                    if !a["meaning"]["zh"].is_null()
                        || a["meaning"]["en"].as_str().is_none()
                        || text(a, "source_path") != chain[..index + 1].join("/subsenses/")
                    {
                        return Err("online_free_invalid_scope".into());
                    }
                }
                let tags: Vec<Value> = s["labels"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|l| l["text"].clone())
                    .collect();
                if (s["content_kind"] == "relation")
                    != relation_only(text(&s["meaning"], "en"), &tags)
                {
                    return Err("online_free_invalid_scope".into());
                }
                entry_definition |= s["content_kind"] == "definition";
            }
        }
        definition |= entry_definition;
        default |= entry_definition && entry["id"] == value["default_entry_id"];
    }
    if !definition || !default {
        return Err("online_free_relation_only".into());
    }
    Ok(())
}
fn request_origin() -> String {
    #[cfg(test)]
    if let Ok(origin) = std::env::var("LEXICUE_FREE_DICTIONARY_TEST_URL") {
        if let Ok(u) = Url::parse(&origin) {
            if u.scheme() == "http"
                && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
                && u.username().is_empty()
                && u.password().is_none()
                && u.query().is_none()
                && u.fragment().is_none()
                && u.path() == "/"
            {
                return origin;
            }
        }
    }
    SERVICE.into()
}
fn url(expression: &str) -> Url {
    let mut u = Url::parse(&request_origin()).unwrap();
    u.path_segments_mut()
        .unwrap()
        .extend(["api", "v1", "entries", "en", expression]);
    u.query_pairs_mut().append_pair("translations", "false");
    u
}
fn cache_key(expression: &str) -> String {
    hash(
        &json!([1,"wiktionary",ADAPTER,SERVICE,request_origin(),expression,{"translations":false}]),
    )
}
fn cache_root() -> Option<PathBuf> {
    std::env::var_os("LEXICUE_FREE_DICTIONARY_CACHE_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            CACHE_ROOT
                .get_or_init(|| Mutex::new(None))
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        })
}
async fn cached(root: Option<&PathBuf>, key: &str, expression: &str) -> Option<(Value, u64)> {
    let p = root?.join(format!("{key}.json"));
    if tokio::fs::metadata(&p).await.ok()?.len() > MAX_JSON as u64 {
        return None;
    }
    let envelope: Value = serde_json::from_slice(&tokio::fs::read(p).await.ok()?).ok()?;
    let v = envelope["value"].clone();
    let saved = envelope["received_ms"].as_u64()?;
    if envelope["cache_version"] != ADAPTER
        || saved > now()
        || validate_result(&v, expression).is_err()
    {
        return None;
    }
    let received = time::OffsetDateTime::parse(
        text(&v["entries"][0]["source"], "received_at"),
        &time::format_description::well_known::Rfc3339,
    )
    .ok()?;
    if (received.unix_timestamp_nanos() / 1_000_000) as u64 != saved {
        return None;
    }
    Some((v, saved))
}
async fn write_cache(root: Option<&PathBuf>, key: &str, v: &Value) {
    let Some(root) = root else {
        return;
    };
    let Ok(received) = time::OffsetDateTime::parse(
        text(&v["entries"][0]["source"], "received_at"),
        &time::format_description::well_known::Rfc3339,
    ) else {
        return;
    };
    if tokio::fs::create_dir_all(root).await.is_err() {
        return;
    }
    let tmp = root.join(format!("{key}.{}.tmp", uuid::Uuid::new_v4()));
    let path = root.join(format!("{key}.json"));
    let body=serde_json::to_vec(&json!({"cache_version":ADAPTER,"received_ms":(received.unix_timestamp_nanos()/1_000_000) as u64,"value":v})).unwrap();
    if tokio::fs::write(&tmp, body).await.is_ok() && tokio::fs::rename(&tmp, &path).await.is_err() {
        let _ = tokio::fs::remove_file(tmp).await;
    }
}
fn delivered(mut v: Value, stale: bool) -> Value {
    for e in v["entries"].as_array_mut().unwrap() {
        e["source"]["delivery"] = json!("cache");
    }
    if stale {
        v["notices"].as_array_mut().unwrap().push(json!({"code":"online_cache_stale","text":"在线补查暂不可用，显示此前查询的 Wiktionary 内容。","entry_id":null}));
    }
    v
}
fn context(mut v: Value, c: Option<&str>) -> Value {
    v["query"]["context"] = c
        .filter(|s| !s.trim().is_empty())
        .map(|s| json!(s))
        .unwrap_or(Value::Null);
    v
}
fn failure(q: &str, code: &str) -> Value {
    json!({"schema_version":1,"query":{"text":q,"language":"en","context":null},"status":"unavailable","default_entry_id":null,"entries":[],"notices":[{"code":code,"text":"本次在线查询未获取到可用解释。","entry_id":null}]})
}
fn cooldown() -> bool {
    COOLDOWN
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&request_origin())
        .is_some_and(|i| *i > Instant::now())
}
fn cool_for(seconds: u64) {
    COOLDOWN
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            request_origin(),
            Instant::now()
                .checked_add(Duration::from_secs(seconds))
                .unwrap_or_else(|| Instant::now() + Duration::from_secs(u32::MAX as u64)),
        );
}
fn retry_after(value: Option<&str>) -> u64 {
    value
        .and_then(|v| {
            v.parse::<u64>().ok().or_else(|| {
                time::OffsetDateTime::parse(v, &time::format_description::well_known::Rfc2822)
                    .ok()
                    .map(|date| {
                        date.unix_timestamp()
                            .saturating_sub((now() / 1000) as i64)
                            .max(0) as u64
                    })
            })
        })
        .unwrap_or(60)
        .max(1)
}
async fn fetch(expression: &str) -> Result<Value, String> {
    let u = url(expression);
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(7))
        .redirect(Policy::none())
        .build()
        .map_err(|_| "online_transport_error")?;
    let mut response = client
        .get(u.clone())
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
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if status == 429 {
        cool_for(retry_after(
            response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_JSON as u64)
    {
        return Err("online_response_too_large".into());
    }
    let mut body = vec![];
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            "online_timeout"
        } else {
            "online_transport_error"
        }
    })? {
        if body.len() + chunk.len() > MAX_JSON {
            return Err("online_response_too_large".into());
        }
        body.extend_from_slice(&chunk);
    }
    #[cfg(test)]
    if let Some(path) = std::env::var_os("LEXICUE_FREE_DICTIONARY_CAPTURE_RAW") {
        std::fs::write(path,serde_json::to_vec_pretty(&json!({"client":"native reqwest default; TLS validation; no redirect; no proxy override","url":u.as_str(),"status":status,"content_type":content_type,"received_ms":now(),"raw_body_utf8":String::from_utf8_lossy(&body),"raw_json":serde_json::from_slice::<Value>(&body).ok()})).unwrap()).map_err(|_|"test_evidence_write_failed")?;
    }
    match status {
        200..=299 => (),
        404 => return Err("online_free_not_found".into()),
        403 => return Err("online_forbidden".into()),
        429 => return Err("online_rate_limited".into()),
        500..=599 => return Err("online_service_unavailable".into()),
        300..=399 => return Err("online_redirect_rejected".into()),
        _ => return Err("online_http_error".into()),
    }
    if content_type.split(';').next() != Some("application/json") {
        return Err("online_invalid_content".into());
    }
    let raw: Value = serde_json::from_slice(&body).map_err(|_| "online_free_shape_changed")?;
    convert(&raw, expression, &timestamp())
}
pub async fn query(
    expression: &str,
    reading_context: Option<&str>,
    refresh: bool,
    timeout_ms: Option<u64>,
) -> Value {
    if expression.trim().is_empty()
        || expression.len() > 256
        || expression.chars().any(char::is_control)
    {
        return context(failure(expression, "online_invalid_query"), reading_context);
    }
    let key = cache_key(expression);
    let root = cache_root();
    let started = Instant::now();
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
    // Keep a validated fallback in memory. A deadline must not start another
    // filesystem read after it has canceled the actual HTTP operation.
    let fallback = Mutex::new(None::<Value>);
    let operation = async {
        let mut state = lock.lock().await;
        if let Some((completed, v)) = state.as_ref() {
            if *completed >= started {
                return v.clone();
            }
        }
        let old = cached(root.as_ref(), &key, expression).await;
        if let Some((v, _)) = &old {
            *fallback.lock().unwrap_or_else(|e| e.into_inner()) = Some(v.clone());
        }
        if let Some((v, received)) = &old {
            if !refresh && now().saturating_sub(*received) < CACHE_TTL_MS {
                return delivered(v.clone(), false);
            }
        }
        let fetched = if cooldown() {
            Err("online_rate_limited".to_owned())
        } else {
            let _slot = SLOTS
                .get_or_init(|| tokio::sync::Semaphore::new(2))
                .acquire()
                .await
                .unwrap();
            if cooldown() {
                Err("online_rate_limited".to_owned())
            } else {
                fetch(expression).await
            }
        };
        let value = match fetched {
            Ok(v) => {
                write_cache(root.as_ref(), &key, &v).await;
                v
            }
            Err(code) => match old {
                Some((v, _)) => delivered(v, true),
                None => failure(expression, &code),
            },
        };
        *state = Some((Instant::now(), value.clone()));
        value
    };
    let limit = timeout_ms.unwrap_or(8000).clamp(1, 8000);
    let value = match tokio::time::timeout(Duration::from_millis(limit), operation).await {
        Ok(v) => v,
        Err(_) => match fallback.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            Some(v) => delivered(v, true),
            None => failure(expression, "online_timeout"),
        },
    };
    context(value, reading_context)
}
#[tauri::command]
pub async fn lookup_free_dictionary_expression(
    expression: String,
    context: Option<String>,
    refresh: Option<bool>,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    Ok(query(
        &expression,
        context.as_deref(),
        refresh.unwrap_or(false),
        timeout_ms,
    )
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    static ENV: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    const RECEIVED: &str = "2026-10-28T12:00:00Z";
    fn raw(q: &str) -> Value {
        json!({"word":"query echo is not identity evidence","entries":[{"language":{"code":"en","name":"English"},"partOfSpeech":"noun","pronunciations":[],"senses":[{"definition":"A complete synthetic target definition.","tags":[],"examples":["","  ","A synthetic example."],"quotes":[{"text":"omitted quote","reference":"omitted reference"}],"translations":[{"language":{"code":"zh"},"word":"不可成为中文解释"}],"subsenses":[]}]}],"source":{"url":format!("https://en.wiktionary.org/wiki/{}",q),"license":{"name":"CC BY-SA 4.0","url":"https://creativecommons.org/licenses/by-sa/4.0/"}}})
    }
    fn serve(
        status: u16,
        headers: &str,
        body: String,
        delay: Duration,
    ) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/", listener.local_addr().unwrap());
        let headers = headers.to_owned();
        let h = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let wait_started = Instant::now();
            let (mut s, _) = loop {
                match listener.accept() {
                    Ok(v) => break v,
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && wait_started.elapsed() < Duration::from_secs(3) =>
                    {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(e) => panic!("fixture accept: {e}"),
                }
            };
            s.set_nonblocking(false).unwrap();
            s.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut b = [0; 16384];
            let n = s.read(&mut b).unwrap();
            std::thread::sleep(delay);
            let _=write!(s,"HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",body.len());
            String::from_utf8_lossy(&b[..n]).into_owned()
        });
        (origin, h)
    }
    fn env(origin: &str, root: &std::path::Path) {
        std::env::set_var("LEXICUE_FREE_DICTIONARY_TEST_URL", origin);
        std::env::set_var("LEXICUE_FREE_DICTIONARY_CACHE_DIR", root);
    }
    fn clear() {
        for k in [
            "LEXICUE_FREE_DICTIONARY_TEST_URL",
            "LEXICUE_FREE_DICTIONARY_CACHE_DIR",
            "LEXICUE_FREE_DICTIONARY_CAPTURE_RAW",
        ] {
            std::env::remove_var(k);
        }
    }
    #[test]
    fn identity_requires_exact_trusted_source_not_echo() {
        let value = convert(&raw("my bad"), "my bad", RECEIVED).unwrap();
        assert_eq!(value["entries"][0]["headword"], "my bad");
        for u in [
            "http://en.wiktionary.org/wiki/my_bad",
            "https://evil.example/wiki/my_bad",
            "https://en.wiktionary.org:444/wiki/my_bad",
            "https://user@en.wiktionary.org/wiki/my_bad",
            "https://en.wiktionary.org/wiki/my_bad?x=1",
            "https://en.wiktionary.org/wiki/my_bad#English",
            "https://en.wiktionary.org/wiki/my%2520bad",
            "https://en.wiktionary.org/wiki/my%20%20bad",
            "https://en.wiktionary.org/wiki/My_bad",
            "https://en.wiktionary.org/wiki/my%xxbad",
        ] {
            assert!(!source_identity(u, "my bad"), "{u}");
        }
        assert!(source_identity(
            "https://en.wiktionary.org/wiki/my_bad",
            "my bad"
        ));
        assert!(source_identity(
            "https://en.wiktionary.org/wiki/my%20bad",
            "my bad"
        ));
        assert!(source_identity("https://en.wiktionary.org/wiki/%25", "%"));
        assert!(!source_identity("https://en.wiktionary.org/wiki/%0A", "\n"));
        let mut wrong = raw("my bad");
        wrong["word"] = json!("other");
        assert!(convert(&wrong, "my bad", RECEIVED).is_ok());
        wrong["source"]["url"] = json!("https://en.wiktionary.org/wiki/other");
        assert_eq!(
            convert(&wrong, "my bad", RECEIVED).unwrap_err(),
            "online_free_identity_unconfirmed"
        );
        wrong = raw("term");
        wrong["entries"][0]["language"]["code"] = json!("fr");
        assert_eq!(
            convert(&wrong, "term", RECEIVED).unwrap_err(),
            "online_free_language_unconfirmed"
        );
        wrong = raw("term");
        wrong["source"]["license"]["name"] = json!("");
        assert_eq!(
            convert(&wrong, "term", RECEIVED).unwrap_err(),
            "online_free_license_unconfirmed"
        );
    }
    #[test]
    fn definitions_hierarchy_duplicate_pos_stable_ids_and_english_only() {
        let mut v = raw("term");
        let mut second = v["entries"][0].clone();
        second["senses"][0]["definition"] =
            json!("A second homograph with the same part of speech.");
        v["entries"].as_array_mut().unwrap().push(second);
        v["entries"][0]["senses"][0]["subsenses"] = json!([{"definition":"A child limited by its parent.","tags":["computing"],"examples":[]}]);
        v["entries"][0]["pronunciations"] = json!([{"type":"ipa","text":"/ambiguous/","tags":[]},{"type":"ipa","text":"/confirmed/","tags":["US"]},{"type":"ipa","text":"//","tags":["US"]}]);
        let one = convert(&v, "term", RECEIVED).unwrap();
        assert_eq!(one["entries"].as_array().unwrap().len(), 2);
        let senses = &one["entries"][0]["groups"][0]["senses"];
        assert_eq!(senses.as_array().unwrap().len(), 2);
        assert_eq!(
            senses[1]["ancestors"][0]["meaning"]["en"],
            "A complete synthetic target definition."
        );
        assert_eq!(senses[1]["source_path"], "/entries/0/senses/0/subsenses/0");
        assert_eq!(senses[0]["examples"].as_array().unwrap().len(), 1);
        assert!(senses[0]["meaning"]["zh"].is_null());
        assert_eq!(
            one["entries"][0]["groups"][0]["pronunciations"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(!one.to_string().contains("omitted quote"));
        assert!(!one.to_string().contains("不可成为中文解释"));
        v["entries"].as_array_mut().unwrap().swap(0, 1);
        let two = convert(&v, "term", RECEIVED).unwrap();
        assert_eq!(one["entries"][0]["id"], two["entries"][1]["id"]);
        assert_eq!(
            one["entries"][0]["groups"][0]["senses"][1]["id"],
            two["entries"][1]["groups"][0]["senses"][1]["id"]
        );
        let mut tamper = one.clone();
        tamper["entries"][0]["groups"][0]["senses"][1]["ancestors"][0]["source_path"] =
            json!("/entries/99");
        assert!(validate_result(&tamper, "term").is_err());
        tamper = one.clone();
        tamper["entries"][0]["groups"][0]["senses"][0]["examples"][0]["chinese"] =
            json!("untrusted translation");
        assert!(validate_result(&tamper, "term").is_err());
        tamper = one.clone();
        tamper["entries"][0]["groups"][0]["senses"][0]["patterns"] = json!([{"id":id("pattern",&json!("tamper")),"text":"scope injection","explanation":{"en":"injected","zh":null},"labels":[],"examples":[],"notes":[]}]);
        assert!(validate_result(&tamper, "term").is_err());
        tamper = one.clone();
        tamper["entries"][0]["groups"][0]["senses"][1]["ancestors"] = json!([]);
        assert!(validate_result(&tamper, "term").is_err());
        tamper = one;
        tamper["entries"][0]["groups"][0]["senses"][0]["meaning"]["zh"] = json!("不允许");
        assert!(validate_result(&tamper, "term").is_err());
    }
    #[test]
    fn relationships_do_not_masquerade_as_expanded_definitions() {
        for s in [
            "plural of term",
            "(informal) Clipping of a compound.",
            "Misspelling of correct.",
            "Alternative spelling of another.",
            "present participle and gerund of act",
            "The act or process of tokenizing.",
            "Something tokenized.",
        ] {
            assert!(relation_only(s, &[]), "{s}");
            let mut v = raw("term");
            v["entries"][0]["senses"][0]["definition"] = json!(s);
            assert_eq!(
                convert(&v, "term", RECEIVED).unwrap_err(),
                "online_free_relation_only"
            );
        }
        for s in [
            "Suspicious.",
            "Delusional.",
            "United States.",
            "A modal used to express a future action.",
            "The process of turning plain text into a sequence of units.",
        ] {
            assert!(!relation_only(s, &[]), "{s}");
        }
        let mut mixed = raw("term");
        mixed["entries"][0]["senses"]
            .as_array_mut()
            .unwrap()
            .push(json!({"definition":"plural of a related word","tags":["form of"]}));
        let result = convert(&mixed, "term", RECEIVED).unwrap();
        assert_eq!(
            result["entries"][0]["groups"][0]["senses"][1]["content_kind"],
            "relation"
        );
    }
    #[test]
    fn malformed_limits_and_missing_structures_are_distinct() {
        let mut v = raw("term");
        v["entries"] = json!([]);
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_free_not_found"
        );
        v = raw("term");
        v["entries"][0].as_object_mut().unwrap().remove("senses");
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_free_shape_changed"
        );
        v = raw("term");
        v["entries"][0]["senses"][0]["definition"] = json!("<b>not text</b>");
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_free_invalid_text"
        );
        v = raw("term");
        v["entries"][0]["senses"] = json!(vec![json!({"definition":"x"}); MAX_ITEMS + 1]);
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_free_structure_limit"
        );
        v = raw("term");
        let mut s = json!({"definition":"leaf"});
        for _ in 0..MAX_DEPTH + 1 {
            s = json!({"definition":"parent","subsenses":[s]});
        }
        v["entries"][0]["senses"] = json!([s]);
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_free_structure_limit"
        );
        v = raw("term");
        v["extra"] = json!("x".repeat(MAX_JSON));
        assert_eq!(
            convert(&v, "term", RECEIVED).unwrap_err(),
            "online_response_too_large"
        );
    }
    #[test]
    fn exact_cache_keys_options_and_percent_encoding() {
        let keys = [
            "US",
            "us",
            "takeoff",
            "take off",
            "what's up",
            "what’s up",
            "my bad",
            "my  bad",
        ]
        .map(cache_key);
        assert_eq!(keys.iter().collect::<HashSet<_>>().len(), keys.len());
        let u = url("a/b?# %");
        assert_eq!(u.path(), "/api/v1/entries/en/a%2Fb%3F%23%20%25");
        assert_eq!(u.query(), Some("translations=false"));
        assert_eq!(retry_after(Some("123")), 123);
        assert_eq!(retry_after(None), 60);
    }
    #[tokio::test]
    async fn invalid_parameters_make_zero_requests() {
        let _guard = ENV.lock().await;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let root = tempfile::tempdir().unwrap();
        env(
            &format!("http://{}/", listener.local_addr().unwrap()),
            root.path(),
        );
        for q in [
            "".to_owned(),
            " ".to_owned(),
            "x\ny".to_owned(),
            "x".repeat(257),
        ] {
            assert_eq!(
                query(&q, None, false, None).await["notices"][0]["code"],
                "online_invalid_query"
            );
        }
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        clear();
    }
    #[tokio::test]
    async fn real_transport_coalesces_is_private_and_preserves_success_on_failure() {
        let _guard = ENV.lock().await;
        let root = tempfile::tempdir().unwrap();
        let (origin, h) = serve(
            200,
            "Content-Type: application/json\r\n",
            raw("term").to_string(),
            Duration::from_millis(60),
        );
        env(&origin, root.path());
        let (a, b) = tokio::join!(
            query("term", Some("PRIVATE ONE"), false, None),
            query("term", Some("PRIVATE TWO"), false, None)
        );
        assert_eq!(a["status"], "partial");
        assert_eq!(b["status"], "partial");
        assert_eq!(a["query"]["context"], "PRIVATE ONE");
        assert_eq!(b["query"]["context"], "PRIVATE TWO");
        let request = h.join().unwrap();
        assert!(request.starts_with("GET /api/v1/entries/en/term?translations=false HTTP/1.1"));
        assert!(!request.contains("PRIVATE"));
        assert!(!request.contains("context"));
        let path = root.path().join(format!("{}.json", cache_key("term")));
        let disk = std::fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&disk).contains("PRIVATE"));
        let warm = query("term", None, false, None).await;
        assert_eq!(warm["entries"][0]["source"]["delivery"], "cache");
        let failed = query("term", None, true, None).await;
        assert_eq!(failed["status"], "partial");
        assert_eq!(failed["notices"][1]["code"], "online_cache_stale");
        assert_eq!(std::fs::read(&path).unwrap(), disk);
        let old_ms = now() - CACHE_TTL_MS - 1000;
        let at = time::OffsetDateTime::from_unix_timestamp_nanos(old_ms as i128 * 1_000_000)
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        let old = convert(&raw("term"), "term", &at).unwrap();
        write_cache(Some(&root.path().to_path_buf()), &cache_key("term"), &old).await;
        let stale = query("term", None, false, None).await;
        assert_eq!(stale["notices"][1]["code"], "online_cache_stale");
        assert_eq!(stale["entries"][0]["source"]["retrieved_at"], at);
        clear();
    }
    #[tokio::test]
    async fn changed_valid_payload_replaces_cache_but_empty_relation_and_timeout_preserve_it() {
        let _guard = ENV.lock().await;
        let root = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}/", listener.local_addr().unwrap());
        env(&origin, root.path());
        let mut richer = raw("term");
        richer["entries"][0]["senses"]
            .as_array_mut()
            .unwrap()
            .push(json!({"definition":"An older second meaning."}));
        let mut changed = raw("term");
        changed["entries"][0]["senses"][0]["definition"] =
            json!("A changed valid meaning from a newer response.");
        let mut relation = raw("term");
        relation["entries"][0]["senses"][0]["definition"] = json!("plural of another term");
        let bodies = [
            richer.to_string(),
            changed.to_string(),
            json!({"entries":[]}).to_string(),
            relation.to_string(),
            changed.to_string(),
        ];
        let server = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            for (index, body) in bodies.iter().enumerate() {
                let started = Instant::now();
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(v) => break v,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && started.elapsed() < Duration::from_secs(3) =>
                        {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(e) => panic!("fixture accept: {e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = [0; 4096];
                assert!(stream.read(&mut request).unwrap() > 0);
                if index == 4 {
                    std::thread::sleep(Duration::from_millis(200));
                }
                let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
            }
        });
        let initial = query("term", None, true, None).await;
        let frozen = initial.clone();
        let updated = query("term", None, true, None).await;
        assert_ne!(
            initial["entries"][0]["source"]["content_hash"],
            updated["entries"][0]["source"]["content_hash"]
        );
        assert_eq!(
            updated["entries"][0]["groups"][0]["senses"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            frozen["entries"][0]["groups"][0]["senses"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let path = root.path().join(format!("{}.json", cache_key("term")));
        let disk = std::fs::read(&path).unwrap();
        for _ in 0..2 {
            let preserved = query("term", None, true, None).await;
            assert_eq!(
                preserved["entries"][0]["source"]["content_hash"],
                updated["entries"][0]["source"]["content_hash"]
            );
            assert_eq!(preserved["notices"][1]["code"], "online_cache_stale");
            assert_eq!(std::fs::read(&path).unwrap(), disk);
        }
        let started = Instant::now();
        let deadline = query("term", None, true, Some(80)).await;
        assert!(started.elapsed() < Duration::from_millis(160));
        assert_eq!(deadline["notices"][1]["code"], "online_cache_stale");
        assert_eq!(
            deadline["entries"][0]["source"]["content_hash"],
            updated["entries"][0]["source"]["content_hash"]
        );
        assert_eq!(std::fs::read(&path).unwrap(), disk);
        server.join().unwrap();
        clear();
    }
    #[tokio::test]
    async fn real_transport_failure_statuses_cooldown_limits_and_deadline() {
        let _guard = ENV.lock().await;
        let root = tempfile::tempdir().unwrap();
        for (status, headers, body, code) in [
            (
                404,
                "Content-Type: application/json\r\n",
                "{}",
                "online_free_not_found",
            ),
            (
                403,
                "Content-Type: application/json\r\n",
                "{}",
                "online_forbidden",
            ),
            (
                503,
                "Content-Type: application/json\r\n",
                "{}",
                "online_service_unavailable",
            ),
            (
                302,
                "Location: https://evil.invalid\r\n",
                "",
                "online_redirect_rejected",
            ),
            (
                200,
                "Content-Type: text/html\r\n",
                "no",
                "online_invalid_content",
            ),
            (
                200,
                "Content-Type: application/json\r\n",
                "not-json",
                "online_free_shape_changed",
            ),
            (
                200,
                "Content-Type: application/json\r\n",
                "{\"entries\":[]}",
                "online_free_not_found",
            ),
        ] {
            let (origin, h) = serve(status, headers, body.into(), Duration::ZERO);
            env(&origin, root.path());
            assert_eq!(
                query("term", None, false, None).await["notices"][0]["code"],
                code
            );
            h.join().unwrap();
        }
        let (origin, h) = serve(
            429,
            "Content-Type: application/json\r\nRetry-After: 120\r\n",
            "{}".into(),
            Duration::ZERO,
        );
        env(&origin, root.path());
        assert_eq!(
            query("term", None, false, None).await["notices"][0]["code"],
            "online_rate_limited"
        );
        h.join().unwrap();
        assert_eq!(
            query("another", None, false, None).await["notices"][0]["code"],
            "online_rate_limited"
        );
        let (origin, h) = serve(
            200,
            "Content-Type: application/json\r\n",
            "x".repeat(MAX_JSON + 1),
            Duration::ZERO,
        );
        env(&origin, root.path());
        assert_eq!(
            query("term", None, false, None).await["notices"][0]["code"],
            "online_response_too_large"
        );
        h.join().unwrap();
        let (origin, h) = serve(
            200,
            "Content-Type: application/json\r\n",
            raw("term").to_string(),
            Duration::from_millis(150),
        );
        env(&origin, root.path());
        let t = Instant::now();
        assert_eq!(
            query("term", None, false, Some(25)).await["notices"][0]["code"],
            "online_timeout"
        );
        assert!(t.elapsed() < Duration::from_millis(100));
        h.join().unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        clear();
    }
}
