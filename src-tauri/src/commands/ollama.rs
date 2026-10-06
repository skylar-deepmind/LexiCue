use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, State};

use super::import::{
    detect_chinese_phrases_in_segments, detect_japanese_phrases_in_segments,
    detect_phrases_in_segments,
};
use crate::db::DbState;

mod english_phrases;
pub mod models;
pub mod word_context;

#[tauri::command]
pub fn get_analysis_diagnostic(file_id: i64) -> Option<serde_json::Value> {
    english_phrases::diagnostic_summary(file_id)
}

#[tauri::command]
pub fn get_analysis_preview_snapshot(file_id: i64, run_id: String) -> Option<serde_json::Value> {
    english_phrases::preview_snapshot(file_id, &run_id)
}

#[tauri::command]
pub fn get_analysis_raw_diagnostic(file_id: i64) -> Option<String> {
    english_phrases::raw_diagnostic_report(file_id)
}

const CANCELLED_MESSAGE: &str = "ERR_CANCELLED";

#[derive(Clone, Default)]
pub(crate) struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub(crate) fn cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    pub(crate) fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub(crate) async fn cancelled_future(&self) {
        while !self.cancelled() {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    async fn sleep_interruptible(&self, duration: std::time::Duration) -> bool {
        tokio::select! {
            _ = tokio::time::sleep(duration) => true,
            _ = self.cancelled_future() => false,
        }
    }
}

static CANCEL_REGISTRY: OnceLock<Mutex<HashMap<i64, CancellationToken>>> = OnceLock::new();

fn cancel_registry() -> &'static Mutex<HashMap<i64, CancellationToken>> {
    CANCEL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct CancelGuard {
    file_id: i64,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = cancel_registry().lock() {
            registry.remove(&self.file_id);
        }
    }
}

#[derive(Clone)]
struct RetryNotifier {
    app: AppHandle,
    file_id: i64,
}

impl RetryNotifier {
    fn notify(&self, attempt: usize, reason: String) {
        english_phrases::diagnostic_transport_retry(self.file_id);
        let _ = self.app.emit(
            "ollama-analysis-retry",
            serde_json::json!({
                "fileId": self.file_id,
                "attempt": attempt,
                "maxAttempts": MAX_ATTEMPTS,
                "runId": english_phrases::diagnostic_summary(self.file_id).and_then(|value| value.get("runId").cloned()),
                "reason": reason,
            }),
        );
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    pub size: Option<u64>,
    pub digest: Option<String>,
    pub modified_at: Option<String>,
}

#[cfg(test)]
#[derive(Deserialize)]
struct ChatResponse {
    message: ChatMessage,
    #[serde(default)]
    done_reason: Option<String>,
    #[serde(default)]
    prompt_eval_count: Option<u64>,
    #[serde(default)]
    eval_count: Option<u64>,
}

#[cfg(test)]
#[derive(Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Deserialize)]
struct PhraseAnalysisResponse {
    #[serde(default)]
    phrases: Vec<AnalyzedPhrase>,
}

#[derive(Deserialize)]
struct AnalyzedPhrase {
    text: String,
    #[serde(default, deserialize_with = "de_i32_flexible")]
    segment_index: i32,
    #[serde(default)]
    meaning_zh: Option<String>,
    #[serde(default)]
    usage_zh: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    pinyin: Option<String>,
    #[serde(default)]
    translation_en: Option<String>,
}

#[derive(Serialize)]
pub struct OllamaAnalysisResult {
    pub phrase_count: usize,
    pub occurrence_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

impl AiConfig {
    pub(crate) fn is_gemma(&self) -> bool { self.provider == "gemma" }
    pub(crate) fn is_openai(&self) -> bool {
        self.provider.trim().eq_ignore_ascii_case("openai")
    }
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    #[serde(default)]
    id: Option<String>,
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

pub(crate) struct ChatResult {
    pub(crate) content: String,
    pub(crate) request_id: Option<String>,
    pub(crate) finish_reason: Option<String>,
    pub(crate) prompt_tokens: Option<u64>,
    pub(crate) completion_tokens: Option<u64>,
}

#[derive(Debug)]
pub(crate) struct ChatFailure {
    pub(crate) message: String,
    pub(crate) kind: &'static str,
    pub(crate) http_status: Option<u16>,
    pub(crate) request_id: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: String,
}

#[derive(Deserialize)]
struct OpenAiModelListResponse {
    data: Vec<OpenAiModelInfo>,
}

#[derive(Deserialize)]
struct OpenAiModelInfo {
    id: String,
}

fn endpoint(base_url: &str, path: &str) -> String {
    let base = base_url
        .trim()
        .trim_end_matches('/')
        .trim_end_matches("/api");
    format!("{}/api{}", base, path)
}

fn openai_endpoint(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim().trim_end_matches('/'), path)
}

fn chat_endpoint(config: &AiConfig) -> String {
    if config.is_openai() {
        openai_endpoint(&config.base_url, "/chat/completions")
    } else {
        endpoint(&config.base_url, "/chat")
    }
}

fn request_id(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers.get("x-request-id").or_else(|| headers.get("x-ds-trace-id"))
        .and_then(|value| value.to_str().ok()).map(str::to_string)
}

fn models_endpoint(config: &AiConfig) -> String {
    if config.is_openai() {
        openai_endpoint(&config.base_url, "/models")
    } else {
        endpoint(&config.base_url, "/tags")
    }
}

fn is_local_url(base_url: &str) -> bool {
    let normalized = base_url.trim().to_ascii_lowercase();
    normalized.starts_with("http://localhost")
        || normalized.starts_with("https://localhost")
        || normalized.starts_with("http://127.0.0.1")
        || normalized.starts_with("https://127.0.0.1")
        || normalized.starts_with("http://[::1]")
        || normalized.starts_with("https://[::1]")
}

fn ai_client(timeout: std::time::Duration, base_url: &str) -> Result<Client, String> {
    let builder = Client::builder().connect_timeout(std::time::Duration::from_secs(15));
    let builder = if is_local_url(base_url) {
        // Keep explicitly configured loopback cloud adapters off the system proxy.
        builder.no_proxy()
    } else {
        builder
    };
    builder
        .timeout(timeout)
        .build()
        .map_err(|error| error.to_string())
}

async fn native_batch_ranges(config: &AiConfig, segments: &[(i32, String)], token: &CancellationToken, prompt: impl Fn(&str) -> String) -> Result<Vec<(usize, usize)>, String> {
    let ranges = batch_ranges(segments);
    if !config.is_gemma() { return Ok(ranges); }
    let mut pending: Vec<_> = ranges.into_iter().rev().collect();
    let mut result = Vec::new();
    while let Some((start, end)) = pending.pop() {
        let input = segments[start..end].iter().map(|(index, text)| format!("[{}] {}", index, text)).collect::<Vec<_>>().join("\n");
        let tokens = crate::commands::gemma::runtime::count(&config.model, prompt(&input), token).await?;
        if tokens <= crate::commands::gemma::runtime::INPUT_LIMIT { result.push((start, end)); }
        else if end-start > 1 { let mid = start+(end-start)/2; pending.push((mid,end)); pending.push((start,mid)); }
        else { return Err(format!("ERR_CONTEXT_LIMIT: segment {} exceeds local context", segments[start].0)); }
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)] // Mirrors the shared business adapter with batch-specific builders.
async fn native_batch_chat(config: &AiConfig, client: &Client, batch: &[(i32, String)], token: &CancellationToken, notifier: Option<&RetryNotifier>, prompt: impl Fn(&str) -> String, schema: impl Fn(&[(i32, String)]) -> serde_json::Value, collection: &str) -> Result<String, String> {
    let mut pending = vec![(0, batch.len())];
    let mut items = Vec::new();
    while let Some((start, end)) = pending.pop() {
        if token.cancelled() { return Err(CANCELLED_MESSAGE.into()); }
        let source = &batch[start..end];
        let input = source.iter().map(|(index,text)| format!("[{index}] {text}")).collect::<Vec<_>>().join("\n");
        match chat_detailed(client, config, token, notifier, prompt(&input), schema(source)).await {
            Ok(value) => {
                let value: serde_json::Value = serde_json::from_str(&value.content).map_err(|_| "ERR_MODEL_JSON")?;
                items.extend(value.get(collection).and_then(serde_json::Value::as_array).ok_or("ERR_MODEL_SCHEMA")?.iter().cloned());
            },
            Err(error) if end-start > 1 && matches!(error.kind,"CONTEXT_LIMIT"|"OUTPUT_TRUNCATED"|"INVALID_JSON") => {
                let mid = start+(end-start)/2; pending.push((mid,end)); pending.push((start,mid));
            },
            Err(error) => return Err(format!("{}: segment {}", error.message, source[0].0)),
        }
    }
    Ok(serde_json::json!({collection:items}).to_string())
}

fn batch_ranges(segments: &[(i32, String)]) -> Vec<(usize, usize)> {
    const MAX_SEGMENTS: usize = 30;
    const MAX_INPUT_CHARS: usize = 12_000;
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut input_chars = 0;

    for (index, (_, text)) in segments.iter().enumerate() {
        let next_chars = input_chars + text.chars().count() + 16;
        if index > start && (index - start >= MAX_SEGMENTS || next_chars > MAX_INPUT_CHARS) {
            ranges.push((start, index));
            start = index;
            input_chars = 0;
        }
        input_chars += text.chars().count() + 16;
    }

    if start < segments.len() {
        ranges.push((start, segments.len()));
    }
    ranges
}

fn de_i32_flexible<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum IntOrString {
        Int(i32),
        Str(String),
    }
    match IntOrString::deserialize(deserializer)? {
        IntOrString::Int(value) => Ok(value),
        IntOrString::Str(value) => value
            .trim()
            .parse::<i32>()
            .map_err(serde::de::Error::custom),
    }
}

fn extract_json(content: &str) -> &str {
    let trimmed = content.trim();
    let stripped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    if stripped.starts_with('{') || stripped.starts_with('[') {
        return stripped;
    }
    let open_index = stripped
        .char_indices()
        .find(|(_, c)| *c == '{' || *c == '[')
        .map(|(index, _)| index);
    let Some(open_index) = open_index else {
        return stripped;
    };
    let open_char = stripped[open_index..].chars().next().unwrap();
    let close_char = if open_char == '[' { ']' } else { '}' };
    match stripped.rfind(close_char) {
        Some(close_index) if close_index > open_index => &stripped[open_index..=close_index],
        _ => stripped,
    }
}

fn repair_json(content: &str) -> String {
    let normalized = content.replace(['\u{201C}', '\u{201D}'], "\"");
    let normalized = repair_key(&normalized, "segment index", "segment_index");
    let normalized = repair_key(&normalized, "meaning zh", "meaning_zh");
    let normalized = repair_key(&normalized, "usage zh", "usage_zh");
    let with_commas = repair_missing_commas(&normalized);
    repair_bare_keys(&with_commas)
}

fn repair_key(content: &str, spaced: &str, underscored: &str) -> String {
    content.replace(
        &format!("\"{}\":", spaced),
        &format!("\"{}\":", underscored),
    )
}

fn repair_missing_commas(content: &str) -> String {
    let chars: Vec<char> = content.chars().collect();
    let mut out = String::with_capacity(content.len() + 16);
    for (i, &c) in chars.iter().enumerate() {
        out.push(c);
        if c == '"' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && chars[j] == '"' {
                out.push(',');
            }
        }
    }
    out
}

fn repair_bare_keys(content: &str) -> String {
    let chars: Vec<char> = content.chars().collect();
    let mut out = String::with_capacity(content.len() + 16);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let is_ident_start = c.is_alphabetic() || c == '_';
        if is_ident_start {
            let prev_sig = (0..i)
                .rev()
                .find(|&k| !chars[k].is_whitespace())
                .map(|k| chars[k]);
            if matches!(prev_sig, Some('{' | ',')) {
                let mut j = i;
                while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '_') {
                    j += 1;
                }
                let mut k = j;
                while k < chars.len() && chars[k].is_whitespace() {
                    k += 1;
                }
                if k < chars.len() && chars[k] == '"' {
                    let m = k + 1;
                    if m < chars.len() && chars[m] == ':' {
                        out.push('"');
                        out.extend(chars[i..j].iter());
                        i = j;
                        continue;
                    }
                }
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

fn parse_ai_json<T: serde::de::DeserializeOwned>(content: &str) -> Result<T, String> {
    match serde_json::from_str(extract_json(content)) {
        Ok(parsed) => Ok(parsed),
        Err(first) => {
            let repaired = repair_json(content);
            serde_json::from_str(extract_json(&repaired))
                .map_err(|second| format!("{}。修复后仍失败：{}", first, second))
        }
    }
}

fn parse_phrase_response(content: &str) -> Result<PhraseAnalysisResponse, String> {
    match parse_phrase_content(content) {
        Ok(parsed) => Ok(parsed),
        Err(first) => {
            let repaired = repair_json(content);
            match parse_phrase_content(&repaired) {
                Ok(parsed) => Ok(parsed),
                Err(second) => {
                    let preview: String = content.chars().take(400).collect();
                    Err(format!(
                        "{}。修复后仍失败：{}。原始内容：{}",
                        first, second, preview
                    ))
                }
            }
        }
    }
}

fn parse_phrase_content(json: &str) -> Result<PhraseAnalysisResponse, String> {
    let extracted = extract_json(json);
    match serde_json::from_str::<PhraseAnalysisResponse>(extracted) {
        Ok(parsed) => Ok(parsed),
        Err(object_error) => serde_json::from_str::<Vec<AnalyzedPhrase>>(extracted)
            .map(|phrases| PhraseAnalysisResponse { phrases })
            .map_err(|array_error| format!("{}；数组解析：{}", object_error, array_error)),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn language_display_name(code: &str) -> String {
    match code {
        "en" => "英语".to_string(),
        "ja" => "日语".to_string(),
        "de" => "德语".to_string(),
        "zh" => "中文".to_string(),
        _ => code.to_string(),
    }
}

fn count_han_chars(text: &str) -> usize {
    text.chars()
        .filter(|c| {
            matches!(
                c,
                '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
            )
        })
        .count()
}

/// Count script characters in text (Han, kana, Latin letters and digits),
/// excluding whitespace and punctuation. Used for CJK languages where a
/// phrase is not space-delimited.
fn count_content_chars(text: &str) -> usize {
    text.chars().filter(|c| c.is_alphanumeric()).count()
}

// Chinese and Japanese text has no spaces, so "at least two words" does not
// apply. For those languages we require a minimum number of content
// characters; for space-separated languages we keep the original multi-word
// rule. Japanese uses a higher threshold than Chinese so common two-character
// words like 寿司 do not slip through.
fn phrase_passes_filter(text: &str, language: &str) -> bool {
    if language == "ja" {
        count_content_chars(text) >= 3 && text.chars().count() <= 24
    } else if language == "zh" {
        count_han_chars(text) >= 2 && text.chars().count() <= 24
    } else {
        text.split_whitespace().count() >= 2 && text.len() <= 120
    }
}

fn find_phrase_position(text: &str, phrase: &str, language: &str) -> Option<i32> {
    super::language::map_phrase_position(language, text, phrase)
}

fn phrase_schema(language: &str) -> serde_json::Value {
    let mut schema = serde_json::json!({
        "type": "object",
        "properties": {
            "phrases": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" },
                        "segment_index": { "type": "integer" },
                        "meaning_zh": { "type": "string" },
                        "usage_zh": { "type": "string" },
                        "category": { "type": "string" }
                    },
                    "required": ["text", "segment_index", "meaning_zh", "usage_zh", "category"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["phrases"],
        "additionalProperties": false
    });
    if language == "zh" {
        if let Some(props) = schema["properties"]["phrases"]["items"]["properties"].as_object_mut()
        {
            props.insert(
                "pinyin".to_string(),
                serde_json::json!({ "type": "string" }),
            );
            props.insert(
                "translation_en".to_string(),
                serde_json::json!({ "type": "string" }),
            );
        }
    }
    schema
}

fn local_phrase_schema(language: &str, source: &[(i32,String)]) -> serde_json::Value {
    let mut schema = phrase_schema(language);
    let props = &mut schema["properties"]["phrases"]["items"]["properties"];
    props["segment_index"]["enum"] = serde_json::json!(source.iter().map(|(index,_)| *index).collect::<Vec<_>>());
    props["text"]["minLength"] = serde_json::json!(1);
    for field in ["meaning_zh","usage_zh"] { props[field]["pattern"] = serde_json::json!("[一-鿿]"); }
    if language=="zh" {
        // Extraction and romanization are separate tasks on small local models.
        // Keep this schema focused; enrichment cannot change source positions.
        if let Some(props)=props.as_object_mut() { props.remove("pinyin"); props.remove("translation_en"); }
    }
    schema
}

fn build_phrase_prompt(language: &str, input: &str) -> String {
    if language == "zh" {
        format!(
            "提取以下中文分段中的成语、惯用语和固定搭配。不要输出单个普通词或专有名词。text 必须是连续原文；segment_index 是输入方括号内的整数编号；meaning_zh 是中文释义；usage_zh 是简短中文用法；category 是成语、惯用语或固定搭配；pinyin 用声调数字；translation_en 是英文释义。没有词组时返回空数组。仅返回完整 JSON {{\"phrases\":[...]}}。\n输入：\n{input}"
        )
    } else if language == "ja" {
        format!(
            "次の番号付きの文から日本語の慣用句・決まった表現を抽出してください。猫の手も借りたい、肩を並べる、話が通じないなどが対象です。単語や固有名詞は対象外です。\n規則：\n- text は原文からそのまま抜き出す。活用形のまま保存し、空白を追加・削除しない。\n- segment_index は入力の角括弧の番号（整数）。\n- meaning_zh（意味）と usage_zh（用法説明）は必ず中国語（簡体字）で書く。\n- category は慣用句・連語・固定搭配など。\n- 該当表現がない文は空配列でよい。JSON の phrases 配列のみを返す。Markdown は不要。\n例：{{\"phrases\":[{{\"text\":\"話が通じない\",\"segment_index\":0,\"meaning_zh\":\"无法沟通，说不通\",\"usage_zh\":\"形容双方无法互相理解\",\"category\":\"慣用句\"}}]}}\n入力：\n{}", input
        )
    } else if language == "de" {
        format!("Extrahiere deutsche Redewendungen und feste Wortverbindungen aus den nummerierten Zeilen, z. B. die Daumen drücken oder eine Entscheidung treffen. Keine einzelnen Wörter oder beliebigen Wortfolgen. text muss exakt und zusammenhängend aus dem Original kopiert werden, einschließlich der Flexion. segment_index ist die Zahl in eckigen Klammern. meaning_zh und usage_zh müssen auf vereinfachtem Chinesisch sein. category ist 固定搭配 oder 习语. Antworte nur als JSON {{\"phrases\":[...]}}; leeres Array, wenn keine Wendung vorhanden ist.\nEingabe:\n{input}")
    } else {
        format!(
            "请从下面的{}资料中识别有独立语义和学习价值的词组，包括固定搭配、习语和常见语块。不要输出普通连续词、专有名词或没有独立意义的短组合。\n规则：\n- text 必须是对应分段中出现的连续原文。\n- segment_index 必须是词组所属分段的输入编号（整数）。\n- 只返回 JSON 对象 {{\"phrases\": [...]}}，不要添加 Markdown 或任何解释。\n\n输出格式示例：\n{{\"phrases\": [{{\"text\": \"look forward to\", \"segment_index\": 1, \"meaning_zh\": \"期待\", \"usage_zh\": \"后接名词或动名词\", \"category\": \"固定搭配\"}}, {{\"text\": \"as well as\", \"segment_index\": 2, \"meaning_zh\": \"以及\", \"usage_zh\": \"连接并列成分\", \"category\": \"固定搭配\"}}]}}\n\n输入：\n{}",
            language_display_name(language),
            input
        )
    }
}

fn build_local_phrase_prompt(language: &str, input: &str) -> String {
    match language {
        "zh" => format!("提取中文成语和固定搭配本身，不要提取整句或周围的主语、副词、标点。text 保留连续原文，segment_index 为编号，meaning_zh 和 usage_zh 为中文释义与用法，category 为成语或固定搭配。例：她一心一意地工作 → 一心一意。输入：\n{input}"),
        "ja" => format!("提取日语句子中的习语或固定搭配，text 只写固定表达本身的连续原文，segment_index 为编号，meaning_zh 和 usage_zh 用中文，category 为习语或搭配。输入：{input}"),
        "de" => format!("提取德语句子中的习语或固定搭配，text 只写固定表达本身的连续原文，segment_index 为编号，meaning_zh 和 usage_zh 用中文，category 为习语或搭配。输入：{input}"),
        _ => format!("Extract {} fixed expressions and idioms. Return phrases with original text of the expression only (keep its inflection, exclude the surrounding sentence words), integer segment_index, simplified Chinese meaning_zh and usage_zh, category. Input:\n{input}", language_display_name(language)),
    }
}

fn phrase_prompt(config: &AiConfig, language: &str, input: &str) -> String {
    if config.is_gemma() { build_local_phrase_prompt(language, input) } else { build_phrase_prompt(language, input) }
}

fn grounded_phrase_text(text: &str, index: i32, known: &[super::import::PhraseOccurrenceInput]) -> Option<String> {
    let text=text.trim();
    let matches:HashSet<_>=known.iter().filter(|p|p.segment_index==index && text.contains(&p.text)).map(|p|p.text.as_str()).collect();
    if matches.contains(text) || matches.is_empty() { return Some(text.into()); }
    // A unique dictionary expression supplies a reliable boundary when a
    // small model copies its surrounding clause. Multiple matches are ambiguous;
    // retain their separate builtin detections rather than assigning one meaning.
    if matches.len()==1 { matches.into_iter().next().map(String::from) } else { None }
}

async fn local_chinese_details(client: &Client, config: &AiConfig, token: &CancellationToken, notifier: Option<&RetryNotifier>, text: &str) -> Result<(String,String), String> {
    let prompt = format!("为这个中文词组填写数字声调拼音 pinyin 和简短英文释义 translation_en：{}。不要扩展成句子。",serde_json::json!(text));
    let schema = serde_json::json!({"type":"object","properties":{"pinyin":{"type":"string","pattern":"[A-Za-z]"},"translation_en":{"type":"string","pattern":"[A-Za-z]"}},"required":["pinyin","translation_en"],"additionalProperties":false});
    let response = chat(client,config,token,notifier,prompt,schema).await?;
    let value:serde_json::Value = parse_ai_json(&response)?;
    let field = |name: &str| value[name].as_str().map(|text|text.trim().trim_start_matches([':', '：']).trim()).filter(|text| !text.is_empty() && text.chars().any(|c|c.is_ascii_alphabetic())).map(String::from).ok_or_else(||"ERR_MODEL_SCHEMA: Chinese details".to_string());
    Ok((field("pinyin")?,field("translation_en")?))
}

fn retain_phrase_occurrence(conn: &Connection, phrase_id: i64, segment_id: i64, position: i32) -> Result<i64, String> {
    if let Some(id) = conn.query_row("SELECT id FROM phrase_occurrences WHERE phrase_id=?1 AND segment_id=?2 AND position=?3 ORDER BY id LIMIT 1", params![phrase_id,segment_id,position], |r| r.get(0)).optional().map_err(|e|e.to_string())? { return Ok(id); }
    conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position) VALUES(?1,?2,?3)", params![phrase_id,segment_id,position]).map_err(|e|e.to_string())?;
    Ok(conn.last_insert_rowid())
}

fn prune_phrase_occurrences(conn: &Connection, file_id: i64, retained: &HashSet<i64>) -> Result<(), String> {
    let mut stmt = conn.prepare("SELECT po.id FROM phrase_occurrences po JOIN segments s ON s.id=po.segment_id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=?1 AND po.hidden=0 AND po.meaning_edited=0 AND po.meaning_en_edited=0 AND p.source='detected' AND p.status='unprocessed' AND p.definition IS NULL").map_err(|e|e.to_string())?;
    let old = stmt.query_map([file_id], |r| r.get::<_,i64>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    for id in old { if !retained.contains(&id) { conn.execute("DELETE FROM phrase_occurrences WHERE id=?1", [id]).map_err(|e|e.to_string())?; } }
    Ok(())
}

pub(crate) const SYSTEM_PROMPT: &str =
    "你是多语言学习助手，只返回符合 JSON Schema 的 JSON，不要添加 Markdown 或解释。";

const MAX_ATTEMPTS: usize = 3;

async fn send_retry(
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    build: impl Fn() -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut attempt = 0;
    loop {
        if token.cancelled() {
            return Err(CANCELLED_MESSAGE.to_string());
        }
        let outcome = tokio::select! {
            result = build().send() => result,
            _ = token.cancelled_future() => return Err(CANCELLED_MESSAGE.to_string()),
        };
        match outcome {
            Ok(response) if response.status().is_server_error() && attempt + 1 < MAX_ATTEMPTS => {
                if let Some(notifier) = notifier {
                    notifier.notify(attempt + 1, format!("HTTP {}", response.status()));
                }
                if !token
                    .sleep_interruptible(std::time::Duration::from_millis(500 * (1 << attempt)))
                    .await
                {
                    return Err(CANCELLED_MESSAGE.to_string());
                }
                attempt += 1;
            }
            Ok(response) => return Ok(response),
            Err(_) if attempt + 1 < MAX_ATTEMPTS => {
                if let Some(notifier) = notifier {
                    notifier.notify(attempt + 1, "连接失败".to_string());
                }
                if !token
                    .sleep_interruptible(std::time::Duration::from_millis(500 * (1 << attempt)))
                    .await
                {
                    return Err(CANCELLED_MESSAGE.to_string());
                }
                attempt += 1;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

async fn chat(
    client: &Client,
    config: &AiConfig,
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    prompt: String,
    format: serde_json::Value,
) -> Result<String, String> {
    chat_detailed(client, config, token, notifier, prompt, format)
        .await
        .map(|result| result.content)
        .map_err(|error| error.message)
}

async fn chat_detailed(
    client: &Client,
    config: &AiConfig,
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    prompt: String,
    format: serde_json::Value,
) -> Result<ChatResult, ChatFailure> {
    if config.is_gemma() {
        let first = super::gemma::runtime::chat(&config.model, prompt.clone(), format.clone(), token, |_| {}, || {}).await;
        match first {
            Err(error) if error.kind == "INVALID_JSON" && !token.cancelled() => {
                super::gemma::runtime::chat(&config.model, format!("{prompt}\n上一回复的 JSON 未闭合。请完整闭合每个字符串、对象和数组，并严格使用指定字段。"), format, token, |_| {}, || {}).await
            },
            result => result,
        }
    } else if config.is_openai() {
        chat_openai(client, config, token, notifier, prompt, format).await
    } else {
        #[cfg(test)]
        if config.provider == "ollama" { return chat_ollama(client, config, token, notifier, prompt, format).await; }
        Err(ChatFailure { message: "ERR_AI_PROVIDER".into(), kind: "INVALID_PROVIDER", http_status: None, request_id: None })
    }
}

#[cfg(test)]
async fn chat_ollama(
    client: &Client,
    config: &AiConfig,
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    prompt: String,
    format: serde_json::Value,
) -> Result<ChatResult, ChatFailure> {
    let url = chat_endpoint(config);
    let body = serde_json::json!({
        "model": config.model,
        "stream": false,
        "format": format,
        "options": { "temperature": 0 },
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": prompt }
        ]
    });
    let response = send_retry(token, notifier, || client.post(&url).json(&body))
        .await
        .map_err(|error| {
            let cancelled = error == CANCELLED_MESSAGE;
            ChatFailure {
                message: if cancelled { error } else { format!("无法连接 Ollama（{}）：{}", url, error) },
                kind: if cancelled { "CANCELLED" } else { "NETWORK_ERROR" },
                http_status: None,
                request_id: None,
            }
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let request_id = request_id(response.headers());
        let body = response.text().await.unwrap_or_default();
        let message = if status.is_server_error() {
            format!(
                "Ollama 服务暂时不可用（HTTP {}），请稍后重试。服务端返回：{}",
                status, body
            )
        } else { format!("Ollama 返回错误 {}：{}", status, body) };
        return Err(ChatFailure { message, kind: "HTTP_ERROR", http_status: Some(status.as_u16()), request_id });
    }

    let request_id = request_id(response.headers());
    response
        .json::<ChatResponse>()
        .await
        .map(|result| ChatResult {
            content: result.message.content,
            request_id,
            finish_reason: result.done_reason,
            prompt_tokens: result.prompt_eval_count,
            completion_tokens: result.eval_count,
        })
        .map_err(|error| ChatFailure { message: format!("无法读取 Ollama 响应：{}", error), kind: "RESPONSE_DECODE_FAILED", http_status: None, request_id: None })
}

async fn chat_openai(
    client: &Client,
    config: &AiConfig,
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    prompt: String,
    format: serde_json::Value,
) -> Result<ChatResult, ChatFailure> {
    let url = chat_endpoint(config);
    let mut body = serde_json::json!({
        "model": config.model,
        "temperature": 0,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": prompt }
        ]
    });
    if !format.is_null() {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    let response = send_retry(token, notifier, || {
        let mut request = client.post(&url).json(&body);
        if let Some(key) = config
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        {
            request = request.bearer_auth(key);
        }
        request
    })
    .await
    .map_err(|error| {
        let cancelled = error == CANCELLED_MESSAGE;
        ChatFailure {
            message: if cancelled { error } else { format!("无法连接 AI 服务（{}）：{}", url, error) },
            kind: if cancelled { "CANCELLED" } else { "NETWORK_ERROR" },
            http_status: None,
            request_id: None,
        }
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let request_id = request_id(response.headers());
        let body = response.text().await.unwrap_or_default();
        let message = if status.is_server_error() {
            format!(
                "AI 服务暂时不可用（HTTP {}），请稍后重试。服务端返回：{}",
                status, body
            )
        } else { format!("AI 服务返回错误 {}：{}", status, body) };
        return Err(ChatFailure { message, kind: "HTTP_ERROR", http_status: Some(status.as_u16()), request_id });
    }

    let header_request_id = request_id(response.headers());
    let result: OpenAiChatResponse = response
        .json()
        .await
        .map_err(|error| ChatFailure { message: format!("无法读取 AI 响应：{}", error), kind: "RESPONSE_DECODE_FAILED", http_status: None, request_id: header_request_id.clone() })?;
    let request_id = header_request_id.or(result.id);
    let usage = result.usage;
    result.choices
        .into_iter()
        .next()
        .map(|choice| ChatResult {
            content: choice.message.content,
            request_id,
            finish_reason: choice.finish_reason,
            prompt_tokens: usage.as_ref().and_then(|value| value.prompt_tokens),
            completion_tokens: usage.as_ref().and_then(|value| value.completion_tokens),
        })
        .ok_or_else(|| ChatFailure { message: "AI 服务未返回任何内容".into(), kind: "EMPTY_CHOICES", http_status: None, request_id: None })
}

fn build_models_request(client: &Client, config: &AiConfig, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);
    if config.is_openai() {
        if let Some(key) = config
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        {
            return request.bearer_auth(key);
        }
    }
    request
}

/// Minimal chat request used to verify that the configured AI service can
/// actually process a chat call, matching the path the real analysis uses.
/// Only called when the model list endpoint is unreachable but a model is set.
async fn probe_chat(client: &Client, config: &AiConfig) -> Result<(), String> {
    let url = chat_endpoint(config);
    let body = serde_json::json!({
        "model": config.model,
        "stream": false,
        "messages": [
            { "role": "user", "content": "ping" }
        ]
    });
    let response = send_retry(&CancellationToken::default(), None, || {
        let mut request = client.post(&url).json(&body);
        if config.is_openai() {
            if let Some(key) = config
                .api_key
                .as_deref()
                .map(str::trim)
                .filter(|key| !key.is_empty())
            {
                request = request.bearer_auth(key);
            }
        }
        request
    })
    .await
    .map_err(|error| {
        if error == CANCELLED_MESSAGE {
            error
        } else {
            format!("无法连接 AI 服务（{}）：{}", url, error)
        }
    })?;
    if response.status().is_success() {
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("AI 服务返回错误 {}：{}", status, body))
    }
}

#[tauri::command]
pub async fn ai_status(config: AiConfig) -> Result<(), String> {
    if config.is_gemma() { return super::gemma::runtime::available(); }
    if !config.is_openai() { return Err("ERR_AI_PROVIDER".into()); }
    let client = ai_client(std::time::Duration::from_secs(15), &config.base_url)?;
    let url = models_endpoint(&config);
    let connected = async {
        send_retry(&CancellationToken::default(), None, || {
            build_models_request(&client, &config, &url)
        })
        .await
        .map_err(|error| format!("无法连接 AI 服务（{}）：{}", url, error))?
        .error_for_status()
        .map_err(|error| format!("AI 服务不可用：{}", error))?;
        Ok::<(), String>(())
    }
    .await;
    match connected {
        Ok(()) => Ok(()),
        Err(models_error) => {
            if !config.is_openai() || models::is_loopback_service(&config.base_url) || config.model.trim().is_empty() {
                return Err(models_error);
            }
            probe_chat(&client, &config).await.map_err(|chat_error| {
                format!("{}；聊天接口探测也失败：{}", models_error, chat_error)
            })
        }
    }
}

#[tauri::command]
pub async fn ai_models(config: AiConfig) -> Result<Vec<OllamaModel>, String> {
    if config.is_gemma() { return super::gemma::models::installed_models(); }
    if !config.is_openai() { return Err("ERR_AI_PROVIDER".into()); }
    let client = ai_client(std::time::Duration::from_secs(15), &config.base_url)?;
    let url = models_endpoint(&config);
    let response = send_retry(&CancellationToken::default(), None, || {
        build_models_request(&client, &config, &url)
    })
    .await
    .map_err(|error| format!("无法连接 AI 服务（{}）：{}", url, error))?
    .error_for_status()
    .map_err(|error| format!("AI 服务不可用：{}", error))?;

    let parsed: OpenAiModelListResponse = response.json().await.map_err(|error| format!("无法读取 AI 模型列表：{}", error))?;
    Ok(parsed.data.into_iter().map(|model| OllamaModel { name: model.id, size: None, digest: None, modified_at: None }).collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentForTranslation {
    pub index: i32,
    pub text: String,
}

#[derive(Serialize)]
pub struct SegmentTranslation {
    pub index: i32,
    pub translation: String,
}

fn translation_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "translations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": { "type": "integer" },
                        "translation": { "type": "string" }
                    },
                    "required": ["index", "translation"]
                }
            }
        },
        "required": ["translations"]
    })
}

fn local_translation_schema(batch: &[(i32, String)]) -> serde_json::Value {
    serde_json::json!({"type":"object","properties":{"translations":{"type":"array","minItems":batch.len(),"maxItems":batch.len(),"prefixItems":batch.iter().map(|(index,_)| serde_json::json!({"type":"object","properties":{"index":{"type":"integer","const":index},"translation":{"type":"string","minLength":1}},"required":["index","translation"],"additionalProperties":false})).collect::<Vec<_>>()}},"required":["translations"],"additionalProperties":false})
}

fn build_translation_prompt(language: &str, input: &str) -> String {
    format!(
        "请将下面的{}字幕内容逐条翻译成简体中文。\n规则：\n- index 必须对应每条输入方括号里的编号。\n- 只输出翻译，不要添加任何解释或原文。\n- 只返回 JSON 对象 {{\"translations\": [{{\"index\": 编号, \"translation\": \"中文译文\"}}]}}，不要添加 Markdown。\n\n输入：\n{}",
        language_display_name(language),
        input
    )
}

/// Translate subtitle segments into Chinese, batching with progress events and
/// cancellation. Reuses the same AI machinery as phrase analysis.
#[tauri::command]
pub async fn translate_segments(
    app: AppHandle,
    job_id: i64,
    config: AiConfig,
    language: String,
    segments: Vec<SegmentForTranslation>,
) -> Result<Vec<SegmentTranslation>, String> {
    let _activity_guard = models::generation_guard(&config, &app)?;
    if config.model.trim().is_empty() {
        return Err("请先选择 AI 模型".to_string());
    }
    if segments.is_empty() {
        return Ok(Vec::new());
    }


    let token = CancellationToken::default();
    cancel_registry()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(job_id, token.clone());
    let _guard = CancelGuard { file_id: job_id };
    let notifier = RetryNotifier {
        app: app.clone(),
        file_id: job_id,
    };

    let pairs: Vec<(i32, String)> = segments.iter().map(|s| (s.index, s.text.clone())).collect();
    let total_segments = pairs.len();
    let ranges = native_batch_ranges(&config, &pairs, &token, |input| build_translation_prompt(&language, input)).await?;
    let total_batches = ranges.len();
    let _ = app.emit(
        "translate-progress",
        serde_json::json!({
            "jobId": job_id,
            "status": "processing",
            "processedSegments": 0,
            "totalSegments": total_segments,
            "completedBatches": 0,
            "totalBatches": total_batches,
            "percent": 0,
        }),
    );

    let client = ai_client(std::time::Duration::from_secs(600), &config.base_url)?;
    let schema = translation_schema();
    let mut by_index: HashMap<i32, String> = HashMap::new();

    for (batch_index, (start, end)) in ranges.iter().enumerate() {
        if token.cancelled() {
            return Err(CANCELLED_MESSAGE.to_string());
        }
        let batch = &pairs[*start..*end];
        let input = batch
            .iter()
            .map(|(index, text)| format!("[{index}] {text}"))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = build_translation_prompt(&language, &input);
        let content = if config.is_gemma() {
            native_batch_chat(&config, &client, batch, &token, Some(&notifier), |input| build_translation_prompt(&language, input), local_translation_schema, "translations").await?
        } else {
            chat(
            &client,
            &config,
            &token,
            Some(&notifier),
            prompt,
            schema.clone(),
        )
        .await?
        };
        let parsed: serde_json::Value =
            parse_ai_json(&content).map_err(|error| format!("AI 返回的翻译 JSON 无效：{error}"))?;
        if let Some(array) = parsed["translations"].as_array() {
            for item in array {
                let index = item["index"]
                    .as_i64()
                    .or_else(|| item["index"].as_str().and_then(|s| s.trim().parse().ok()))
                    .map(|i| i as i32);
                let translation = item["translation"]
                    .as_str()
                    .map(str::trim)
                    .map(String::from);
                if let (Some(i), Some(t)) = (index, translation) {
                    if !t.is_empty() {
                        by_index.insert(i, t);
                    }
                }
            }
        }
        let percent = ((batch_index + 1) * 100 / total_batches).min(99);
        let _ = app.emit(
            "translate-progress",
            serde_json::json!({
                "jobId": job_id,
                "status": "processing",
                "processedSegments": *end,
                "totalSegments": total_segments,
                "completedBatches": batch_index + 1,
                "totalBatches": total_batches,
                "percent": percent,
            }),
        );
    }

    let ordered = segments
        .iter()
        .filter_map(|s| {
            by_index
                .get(&s.index)
                .map(|translation| SegmentTranslation {
                    index: s.index,
                    translation: translation.clone(),
                })
        })
        .collect::<Vec<_>>();

    let _ = app.emit(
        "translate-progress",
        serde_json::json!({
            "jobId": job_id,
            "status": "completed",
            "processedSegments": total_segments,
            "totalSegments": total_segments,
            "completedBatches": total_batches,
            "totalBatches": total_batches,
            "percent": 100,
        }),
    );
    Ok(ordered)
}

#[tauri::command]
pub async fn cancel_translate_segments(job_id: i64) -> Result<(), String> {
    if let Some(token) = cancel_registry()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&job_id)
    {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_phrase_analysis(file_id: i64) -> Result<(), String> {
    if let Some(token) = cancel_registry()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&file_id)
    {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub async fn analyze_file_phrases(
    app: AppHandle,
    state: State<'_, DbState>,
    file_id: i64,
    config: AiConfig,
    force_refresh: Option<bool>,
    run_id: Option<String>,
) -> Result<OllamaAnalysisResult, String> {
    let _activity_guard = models::generation_guard(&config, &app)?;
    if config.model.trim().is_empty() {
        return Err("请先选择 AI 模型".to_string());
    }

    let (language, segments): (String, Vec<(i32, String)>) = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT f.language, s.index_num, s.en_text FROM segments s JOIN files f ON f.id = s.file_id WHERE s.file_id = ?1 ORDER BY s.index_num",
            )
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map(params![file_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|error| error.to_string())?;
        let rows = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let language = rows
            .first()
            .map(|row| row.0.clone())
            .unwrap_or_else(|| "en".to_string());
        (
            language,
            rows.into_iter()
                .map(|(_, index, text)| (index, text))
                .collect(),
        )
    };

    if segments.is_empty() {
        return Err(format!(
            "文件中没有可分析的{}内容",
            language_display_name(&language)
        ));
    }

    if language == "en" {
        return english_phrases::analyze(app, state, file_id, config, force_refresh.unwrap_or(false), run_id).await;
    }

    {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let analyzed: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM file_phrase_analysis WHERE file_id = ?1
                 ) AND EXISTS(
                    SELECT 1 FROM phrase_occurrences po
                    JOIN segments s ON s.id = po.segment_id
                    WHERE s.file_id = ?1
                 )",
                params![file_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if analyzed {
            return Err("这个文件已经完成 AI 词组分析".to_string());
        }
    }

    let token = CancellationToken::default();
    cancel_registry()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(file_id, token.clone());
    let _guard = CancelGuard { file_id };
    let notifier = RetryNotifier {
        app: app.clone(),
        file_id,
    };

    let client = ai_client(std::time::Duration::from_secs(600), &config.base_url)?;
    let total_segments = segments.len();
    let ranges = native_batch_ranges(&config, &segments, &token, |input| phrase_prompt(&config, &language, input)).await?;
    let total_batches = ranges.len();
    let _ = app.emit(
        "ollama-analysis-progress",
        serde_json::json!({
            "fileId": file_id,
            "status": "processing",
            "processedSegments": 0,
            "totalSegments": total_segments,
            "completedBatches": 0,
            "totalBatches": total_batches,
            "percent": 0,
        }),
    );
    let schema = phrase_schema(&language);
    let mut analyzed = Vec::new();
    for (batch_index, (start, end)) in ranges.iter().enumerate() {
        if token.cancelled() {
            return Err(CANCELLED_MESSAGE.to_string());
        }
        let batch = &segments[*start..*end];
        let input = batch
            .iter()
            .map(|(index, text)| format!("[{}] {}", index, text))
            .collect::<Vec<_>>()
            .join("\n");
        let prompt = phrase_prompt(&config, &language, &input);
        let content = if config.is_gemma() {
            native_batch_chat(&config, &client, batch, &token, Some(&notifier), |input| phrase_prompt(&config, &language, input), |source| local_phrase_schema(&language,source), "phrases").await?
        } else {
            chat(
            &client,
            &config,
            &token,
            Some(&notifier),
            prompt,
            schema.clone(),
        )
        .await?
        };
        let result = parse_phrase_response(&content)
            .map_err(|error| format!("AI 返回的词组 JSON 无效：{}", error))?;
        analyzed.extend(result.phrases);
        let processed_segments = *end;
        let percent = ((batch_index + 1) * 100 / total_batches).min(99);
        let _ = app.emit(
            "ollama-analysis-progress",
            serde_json::json!({
                "fileId": file_id,
                "status": "processing",
                "processedSegments": processed_segments,
                "totalSegments": total_segments,
                "completedBatches": batch_index + 1,
                "totalBatches": total_batches,
                "percent": percent,
            }),
        );
    }

    let builtin = {
        let conn=state.conn.lock().map_err(|e|e.to_string())?;
        match language.as_str() {
            "en" => detect_phrases_in_segments(&conn,&segments)?,
            "zh" => detect_chinese_phrases_in_segments(&conn,&segments)?,
            "ja" => detect_japanese_phrases_in_segments(&conn,&segments)?,
            _ => Vec::new(),
        }
    };
    let segment_map: HashMap<i32, &str> = segments
        .iter()
        .map(|(index, text)| (*index, text.as_str()))
        .collect();
    let is_zh = language == "zh";
    let mut unique: HashMap<String, (AnalyzedPhrase, Vec<(i32, i32)>)> = HashMap::new();
    for mut phrase in analyzed {
        if config.is_gemma() {
            let Some(source)=segment_map.get(&phrase.segment_index) else { continue; };
            if find_phrase_position(source,&phrase.text,&language).is_none() { continue; }
            let Some(text)=grounded_phrase_text(&phrase.text,phrase.segment_index,&builtin) else { continue; };
            phrase.text=text;
        }
        let text = phrase.text.trim().to_lowercase();
        if !phrase_passes_filter(&text, &language) {
            continue;
        }
        let Some(segment_text) = segment_map.get(&phrase.segment_index) else {
            continue;
        };
        let Some(position) = find_phrase_position(segment_text, &phrase.text, &language) else {
            continue;
        };
        let entry = unique.entry(text).or_insert_with(|| (phrase, Vec::new()));
        entry.1.push((entry.0.segment_index, position));
    }

    if is_zh && config.is_gemma() {
        for (text,(phrase,_)) in &mut unique {
            let (pinyin,translation) = local_chinese_details(&client,&config,&token,Some(&notifier),text).await?;
            phrase.pinyin=Some(pinyin); phrase.translation_en=Some(translation);
        }
    }

    if token.cancelled() { return Err(CANCELLED_MESSAGE.into()); }
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|error| error.to_string())?;
    let result = (|| -> Result<OllamaAnalysisResult, String> {
        let mut phrase_texts: HashSet<String> =
            builtin.iter().map(|phrase| phrase.text.clone()).collect();
        phrase_texts.extend(unique.keys().cloned());
        for text in &phrase_texts {
            conn.execute(
                "INSERT OR IGNORE INTO phrases (language, text, source) VALUES (?1, ?2, 'detected')",
                params![language, text],
            )
            .map_err(|error| error.to_string())?;
        }

        let mut phrase_ids = HashMap::new();
        let mut stmt = conn
            .prepare("SELECT id FROM phrases WHERE language = ?1 AND text = ?2")
            .map_err(|error| error.to_string())?;
        for text in &phrase_texts {
            let id: i64 = stmt
                .query_row(params![language, text], |row| row.get(0))
                .map_err(|error| error.to_string())?;
            phrase_ids.insert(text.clone(), id);
        }
        drop(stmt);

        let provider_label = {
            let model = config.model.trim();
            if model.is_empty() {
                config.provider.clone()
            } else {
                model.to_string()
            }
        };
        for (text, (phrase, _)) in &unique {
            let translation = if is_zh {
                phrase
                    .translation_en
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .or_else(|| phrase.meaning_zh.as_deref().map(str::trim))
                    .unwrap_or("")
                    .to_string()
            } else {
                phrase
                    .meaning_zh
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .to_string()
            };
            let pinyin = if is_zh {
                phrase
                    .pinyin
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
            } else {
                None
            };
            conn.execute(
                "INSERT INTO phrase_dictionary_entries
                 (language, text, translation, pinyin, usage_zh, category, provider, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(language,text) DO UPDATE SET translation=excluded.translation,pinyin=excluded.pinyin,usage_zh=excluded.usage_zh,category=excluded.category,provider=excluded.provider,updated_at=excluded.updated_at",
                params![
                    language,
                    text,
                    translation,
                    pinyin,
                    phrase.usage_zh.as_deref().map(str::trim),
                    phrase.category.as_deref().map(str::trim),
                    provider_label,
                    now_ms(),
                ],
            )
            .map_err(|error| error.to_string())?;
        }

        let mut retained = HashSet::new();
        for phrase in &builtin {
            let real_segment_id: i64 = conn
                .query_row(
                    "SELECT id FROM segments WHERE file_id = ?1 AND index_num = ?2",
                    params![file_id, phrase.segment_index],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            let phrase_id = phrase_ids.get(&phrase.text).ok_or("内置词组写入失败")?;
            retained.insert(retain_phrase_occurrence(&conn, *phrase_id, real_segment_id, phrase.position)?);
        }
        for (text, (_phrase, positions)) in &unique {
            let phrase_id = phrase_ids.get(text).ok_or("AI 词组写入失败")?;
            for (segment_index, position) in positions {
                let real_segment_id: i64 = conn
                    .query_row(
                        "SELECT id FROM segments WHERE file_id = ?1 AND index_num = ?2",
                        params![file_id, segment_index],
                        |row| row.get(0),
                    )
                    .map_err(|error| error.to_string())?;
                retained.insert(retain_phrase_occurrence(&conn, *phrase_id, real_segment_id, *position)?);
            }
        }
        prune_phrase_occurrences(&conn, file_id, &retained)?;
        if token.cancelled() { return Err(CANCELLED_MESSAGE.into()); }
        conn.execute(
            "INSERT INTO file_phrase_analysis (file_id, model, completed_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(file_id) DO UPDATE SET model = excluded.model, completed_at = excluded.completed_at",
             params![file_id, config.model, now_ms()],
        )
        .map_err(|error| error.to_string())?;
        Ok(OllamaAnalysisResult {
            phrase_count: phrase_texts.len(),
            occurrence_count: retained.len(),
        })
    })();

    match result {
        Ok(value) => {
            conn.execute("COMMIT", [])
                .map_err(|error| error.to_string())?;
            let _ = app.emit(
                "ollama-analysis-progress",
                serde_json::json!({
                    "fileId": file_id,
                    "status": "completed",
                    "processedSegments": total_segments,
                    "totalSegments": total_segments,
                    "completedBatches": total_batches,
                    "totalBatches": total_batches,
                    "percent": 100,
                }),
            );
            Ok(value)
        }
        Err(error) => {
            let _ = conn.execute("ROLLBACK", []);
            let _ = app.emit(
                "ollama-analysis-progress",
                serde_json::json!({
                    "fileId": file_id,
                    "status": "error",
                    "processedSegments": 0,
                    "totalSegments": total_segments,
                    "completedBatches": 0,
                    "totalBatches": total_batches,
                    "percent": 0,
                }),
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictionary_boundaries_are_used_only_with_unambiguous_same_segment_evidence() {
        let known=vec![super::super::import::PhraseOccurrenceInput {text:"肩を並べる".into(),segment_index:4,position:2},super::super::import::PhraseOccurrenceInput {text:"話が通じない".into(),segment_index:4,position:6}];
        assert_eq!(grounded_phrase_text("彼と肩を並べる",4,&known).as_deref(),Some("肩を並べる"));
        assert_eq!(grounded_phrase_text("彼と肩を並べる",5,&known).as_deref(),Some("彼と肩を並べる"));
        assert_eq!(grounded_phrase_text("肩を並べるが話が通じない",4,&known),None);
    }

    #[test]
    fn non_english_reanalysis_preserves_occurrence_edits_and_learning_data() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("retention.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('de.txt','txt','text','hash',1,'de')", []).unwrap();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,'die Daumen drücken')", []).unwrap();
        conn.execute("INSERT INTO phrases(language,text,source,status) VALUES('de','die daumen drücken','detected','learning'),('de','user phrase','manual','unprocessed'),('de','edited phrase','detected','unprocessed'),('de','stale phrase','detected','unprocessed')", []).unwrap();
        conn.execute("INSERT INTO phrase_occurrences(id,phrase_id,segment_id,position,meaning_zh,meaning_edited,hidden) VALUES(11,1,1,0,'我的银行义',1,0),(12,2,1,1,NULL,0,0),(13,3,1,2,'我的释义',1,1),(14,4,1,3,NULL,0,0)", []).unwrap();
        conn.execute("INSERT INTO phrase_reviews(phrase_id,due_at,reps) VALUES(1,42,5)", []).unwrap();
        let id = retain_phrase_occurrence(&conn,1,1,0).unwrap();
        assert_eq!(id,11);
        assert_eq!(retain_phrase_occurrence(&conn,1,1,0).unwrap(),id);
        prune_phrase_occurrences(&conn,1,&HashSet::from([id])).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM phrase_occurrences",[],|r|r.get::<_,i64>(0)).unwrap(),3);
        assert_eq!(conn.query_row("SELECT meaning_zh FROM phrase_occurrences WHERE id=11",[],|r|r.get::<_,String>(0)).unwrap(),"我的银行义");
        assert_eq!(conn.query_row("SELECT reps FROM phrase_reviews WHERE phrase_id=1",[],|r|r.get::<_,i64>(0)).unwrap(),5);
        assert!(conn.query_row("SELECT id FROM phrase_occurrences WHERE id=14",[],|r|r.get::<_,i64>(0)).optional().unwrap().is_none());
    }

    #[test]
    fn repair_handles_malformed_phrase_json() {
        let content = r#"{"phrases":[{"text":"tobe projected outwards""segment index":60,"meaning_zh":"向外投射""usage_zh":"用于描述形象、价值观等向外传播""category":"固定搭配"},{text":"starts from the inside","segment index":60,"meaning_zh":"从内部开始","usage_zh":"强调某事应先从内部着手","category":"常见语块"},{“text":"viewcore values","segment index":61,"meaning_zh":"核心价值观","usage_zh":"指一组织或个人最重要的信念","category":"固定搭配"}]}"#;
        let parsed = parse_phrase_response(content).expect("parse should succeed after repair");
        assert_eq!(parsed.phrases.len(), 3);
        assert_eq!(parsed.phrases[0].text, "tobe projected outwards");
        assert_eq!(parsed.phrases[0].segment_index, 60);
        assert_eq!(parsed.phrases[1].text, "starts from the inside");
        assert_eq!(parsed.phrases[1].segment_index, 60);
        assert_eq!(parsed.phrases[2].text, "viewcore values");
        assert_eq!(parsed.phrases[2].segment_index, 61);
    }

    #[test]
    fn repair_leaves_valid_json_untouched() {
        let content = r#"{"phrases":[{"text":"look forward to","segment_index":1,"meaning_zh":"期待","usage_zh":"后接名词或动名词","category":"固定搭配"}]}"#;
        let parsed = parse_phrase_response(content).expect("valid JSON should parse directly");
        assert_eq!(parsed.phrases.len(), 1);
        assert_eq!(parsed.phrases[0].segment_index, 1);
    }

    #[test]
    fn repair_handles_bare_array_top_level() {
        let content = r#"[{"text":"ahead of","segment_index":2,"meaning_zh":"在…之前","usage_zh":"用于表示时间或位置","category":"常见语块"}]"#;
        let parsed = parse_phrase_response(content).expect("array fallback should parse");
        assert_eq!(parsed.phrases.len(), 1);
        assert_eq!(parsed.phrases[0].text, "ahead of");
    }

    #[test]
    fn phrase_filter_keeps_chinese_phrases() {
        assert!(phrase_passes_filter("与此同时", "zh"));
        assert!(phrase_passes_filter("举足轻重", "zh"));
        assert!(phrase_passes_filter("发挥作用", "zh"));
    }

    #[test]
    fn phrase_filter_rejects_single_han_char() {
        assert!(!phrase_passes_filter("的", "zh"));
        assert!(!phrase_passes_filter("我", "zh"));
    }

    #[test]
    fn phrase_filter_keeps_space_separated_phrases() {
        assert!(phrase_passes_filter("look forward to", "en"));
        assert!(!phrase_passes_filter("look", "en"));
        assert!(!phrase_passes_filter("as", "en"));
    }

    #[test]
    fn phrase_filter_handles_mixed_scripts() {
        assert!(phrase_passes_filter("用 Python 写代码", "zh"));
    }

    #[test]
    fn phrase_filter_keeps_japanese_phrases() {
        assert!(phrase_passes_filter("話が通じない", "ja"));
        assert!(phrase_passes_filter("肩を並べる", "ja"));
        assert!(phrase_passes_filter("あっという間", "ja"));
        assert!(phrase_passes_filter("阿吽の呼吸", "ja"));
    }

    #[test]
    fn phrase_filter_rejects_short_japanese_text() {
        assert!(!phrase_passes_filter("寿司", "ja"));
        assert!(!phrase_passes_filter("、", "ja"));
    }

    #[test]
    fn finds_japanese_phrase_position_via_lindera() {
        let text = "彼は話が通じない人だ。";
        // Content tokens: 彼(0), 話(1), 通じ(2), 人(3). Particles are filtered.
        assert_eq!(find_phrase_position(text, "話が通じない", "ja"), Some(1));
        assert_eq!(find_phrase_position(text, "通じ", "ja"), Some(2));
    }

    #[test]
    fn japanese_phrase_ignores_inserted_spaces() {
        let text = "彼は話が通じない人だ。";
        assert_eq!(find_phrase_position(text, "話が 通じない", "ja"), Some(1));
    }

    #[test]
    fn japanese_phrase_not_found_returns_none() {
        let text = "彼は話が通じない人だ。";
        assert_eq!(find_phrase_position(text, "存在しない", "ja"), None);
    }
}
