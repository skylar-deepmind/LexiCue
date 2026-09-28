use super::{
    ai_client, batch_ranges, cancel_registry, chat_detailed, now_ms, AiConfig, ChatFailure, ChatResult,
    CancelGuard, CancellationToken, OllamaAnalysisResult, RetryNotifier, CANCELLED_MESSAGE,
};
use crate::commands::{collins, english};
use crate::db::DbState;
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

mod diagnostics;
mod parsing;
use parsing::ParseOutcome;

const PIPELINE_VERSION: i64 = 3;
const CATEGORIES: [&str; 4] = ["phrasal_verb", "idiom", "fixed_expression", "collocation"];

#[derive(Clone)]
struct SegmentRow {
    index: i32,
    text: String,
}

#[derive(Clone, Deserialize)]
struct Candidate {
    segment_index: i32,
    canonical: String,
    token_positions: Vec<i32>,
    category: String,
}

#[derive(Clone, Deserialize, serde::Serialize)]
struct OtherSense {
    meaning_en: String,
    meaning_zh: String,
    example_en: String,
}

#[derive(Deserialize)]
struct Interpretation {
    segment_index: i32,
    canonical: String,
    token_positions: Vec<i32>,
    supported: bool,
    meaning_en: String,
    usage_en: String,
    meaning_zh: String,
    usage_zh: String,
    #[serde(default)]
    collins_sense_id: Option<i64>,
    #[serde(default)]
    other_senses: Vec<OtherSense>,
}

struct Accepted {
    candidate: Candidate,
    surface: String,
    meaning_en: String,
    usage_en: String,
    meaning_zh: String,
    usage_zh: String,
    other_senses: Vec<OtherSense>,
    collins_sense_id: Option<i64>,
}

fn access_allowed(config: &AiConfig) -> bool {
    // A later hosted plan can enforce entitlement here. User supplied models stay available.
    !config.model.trim().is_empty()
}

fn extraction_schema() -> serde_json::Value {
    serde_json::json!({
        "type":"object", "properties":{"phrases":{"type":"array","items":{
            "type":"object","properties":{
                "segment_index":{"type":"integer"},
                "canonical":{"type":"string"},
                "token_positions":{"type":"array","items":{"type":"integer"}},
                "category":{"type":"string"}
            },"required":["segment_index","canonical","token_positions","category"]
        }}},"required":["phrases"]
    })
}

fn interpretation_schema() -> serde_json::Value {
    serde_json::json!({
        "type":"object", "properties":{"interpretations":{"type":"array","items":{
            "type":"object","properties":{
                "segment_index":{"type":"integer"},
                "canonical":{"type":"string"},
                "token_positions":{"type":"array","items":{"type":"integer"}},
                "supported":{"type":"boolean"},
                "meaning_en":{"type":"string"},
                "usage_en":{"type":"string"},
                "meaning_zh":{"type":"string"},
                "usage_zh":{"type":"string"},
                "collins_sense_id":{"type":["integer","null"]},
                "other_senses":{"type":"array","items":{"type":"object","properties":{
                    "meaning_en":{"type":"string"},"meaning_zh":{"type":"string"},"example_en":{"type":"string"}
                },"required":["meaning_en","meaning_zh","example_en"]}}
            },"required":["segment_index","canonical","token_positions","supported","meaning_en","usage_en","meaning_zh","usage_zh","collins_sense_id","other_senses"]
        }}},"required":["interpretations"]
    })
}

fn normalized(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn key(index: i32, canonical: &str, positions: &[i32]) -> String {
    format!("{index}|{}|{:?}", normalized(canonical), positions)
}

fn matched_collins_sense(requested: Option<i64>, evidence: &[collins::Sense]) -> Option<i64> {
    requested.filter(|id| evidence.iter().any(|sense| sense.id == *id))
}

fn validate_candidate(candidate: &Candidate, segment: &SegmentRow) -> Option<String> {
    if candidate.segment_index != segment.index || !CATEGORIES.contains(&candidate.category.as_str()) {
        return None;
    }
    let canonical = normalized(&candidate.canonical);
    let words: Vec<&str> = canonical.split_whitespace().collect();
    if words.len() < 2 || words.len() > 8 || canonical.len() > 100 || candidate.token_positions.len() != words.len() {
        return None;
    }
    if candidate.token_positions.windows(2).any(|pair| pair[0] >= pair[1]) {
        return None;
    }
    if candidate.category != "phrasal_verb"
        && candidate.token_positions.windows(2).any(|pair| pair[1] != pair[0] + 1)
    {
        return None;
    }
    let tokens = english::tokenize_english_text(&segment.text);
    let mut surfaces = Vec::new();
    for (word, position) in words.iter().zip(&candidate.token_positions) {
        let surface = tokens.iter().find(|(_, token_position)| token_position == position)?.0.clone();
        if !english::surface_matches_lemma(&surface, word) {
            return None;
        }
        surfaces.push(surface);
    }
    Some(surfaces.join(" "))
}

fn example_uses_phrase(example: &str, canonical: &str, category: &str) -> bool {
    let phrase: Vec<&str> = canonical.split_whitespace().collect();
    let tokens: Vec<String> = english::tokenize_english_text(example).into_iter()
        .map(|(surface, _)| surface).collect();
    if phrase.len() < 2 { return false; }
    for start in 0..tokens.len() {
        if !english::surface_matches_lemma(&tokens[start], phrase[0]) { continue; }
        let mut cursor = start;
        let mut matches = true;
        for word in phrase.iter().skip(1) {
            let limit = if category == "phrasal_verb" { (cursor + 4).min(tokens.len().saturating_sub(1)) } else { cursor + 1 };
            let Some(next) = (cursor + 1..=limit).find(|position| {
                tokens.get(*position).is_some_and(|surface| {
                    english::surface_matches_lemma(surface, word)
                })
            }) else { matches = false; break; };
            cursor = next;
        }
        if matches { return true; }
    }
    false
}

fn emit_progress(app: &AppHandle, file_id: i64, phase: &str, completed: usize, total: usize, status: &str) {
    let percent = if status == "completed" { 100 } else { (completed * 100 / total.max(1)).min(99) };
    let diagnostic = diagnostics::summary(file_id);
    let _ = app.emit("ollama-analysis-progress", serde_json::json!({
        "fileId":file_id,"status":status,"phase":phase,
        "processedSegments":completed,"totalSegments":total,"percent":percent,
        "runId":diagnostic.as_ref().map(|value| value.run_id.as_str()),
        "skippedItems":diagnostic.as_ref().map(|value| value.total_skipped).unwrap_or(0),
        "errorCode":diagnostic.as_ref().map(|value| value.code.as_str())
    }));
}

pub(super) fn diagnostic_summary(file_id: i64) -> Option<serde_json::Value> {
    diagnostics::summary(file_id).and_then(|summary| serde_json::to_value(summary).ok())
}

pub(super) fn raw_diagnostic_report(file_id: i64) -> Option<String> {
    diagnostics::raw_report(file_id)
}

fn record_batch(file_id: i64, stage: &str, batch: usize, code: &str, response: Option<&ChatResult>, duration_ms: u128, valid: usize, skipped: usize, missing_fields: Vec<String>, raw: Option<&str>) {
    if let Some(mut summary) = diagnostics::summary(file_id) {
        summary.stage = stage.into();
        summary.batch = batch;
        summary.code = code.into();
        summary.error_kind = None;
        summary.http_status = None;
        summary.request_id = response.and_then(|value| value.request_id.clone());
        summary.finish_reason = response.and_then(|value| value.finish_reason.clone());
        summary.prompt_tokens = response.and_then(|value| value.prompt_tokens);
        summary.completion_tokens = response.and_then(|value| value.completion_tokens);
        summary.duration_ms = duration_ms;
        summary.valid_count = valid;
        summary.skipped_count = skipped;
        summary.missing_fields = missing_fields;
        summary.occurred_at = now_ms();
        diagnostics::record(file_id, summary, raw);
    }
}

fn record_request_failure(file_id: i64, stage: &str, batch: usize, failure: &ChatFailure, duration_ms: u128) {
    if let Some(mut summary) = diagnostics::summary(file_id) {
        summary.stage = stage.into();
        summary.batch = batch;
        summary.code = "REQUEST_FAILED".into();
        summary.error_kind = Some(failure.kind.into());
        summary.http_status = failure.http_status;
        summary.request_id = failure.request_id.clone();
        summary.finish_reason = None;
        summary.prompt_tokens = None;
        summary.completion_tokens = None;
        summary.duration_ms = duration_ms;
        summary.valid_count = 0;
        summary.skipped_count = 0;
        summary.missing_fields.clear();
        summary.occurred_at = now_ms();
        diagnostics::record(file_id, summary, None);
    }
}

#[derive(Debug)]
struct BatchFailure {
    code: &'static str,
    stage: &'static str,
    batch: usize,
}

impl BatchFailure {
    fn as_error(&self) -> String {
        if self.code == "CANCELLED" { return CANCELLED_MESSAGE.to_string(); }
        format!("{}: {}第 {} 批无法获得有效结果；旧分析已保留", self.code, self.stage, self.batch)
    }
}

async fn request_extraction(client: &Client, config: &AiConfig, token: &CancellationToken, notifier: Option<&RetryNotifier>, file_id: i64, batch: usize, segments: &[SegmentRow], allow_retry: bool) -> Result<ParseOutcome<Candidate>, BatchFailure> {
    let input = segments.iter().map(|segment| {
        let tokens = english::tokenize_english_text(&segment.text).iter()
            .map(|(surface, position)| format!("{position}:{surface}"))
            .collect::<Vec<_>>().join(" ");
        format!("[{}] {}\n词位: {}", segment.index, segment.text, tokens)
    }).collect::<Vec<_>>().join("\n");
    let base_prompt = format!("从英文学习材料提取值得作为整体学习的习语、短语动词、固定表达和高价值搭配。只选择有约定用法且在本句有学习价值的表达。排除普通临时组合、专名、不能确定词位的表达。每一项必须包含整数 segment_index、标准形式 canonical、原句 token_positions、category。可分离短语动词只列词组本身的词位。其他类别必须是连续词位。category 仅可为 phrasal_verb、idiom、fixed_expression、collocation。宁可遗漏，不要猜测。示例：输入 [12] I picked it up.，输出 {{\"phrases\":[{{\"segment_index\":12,\"canonical\":\"pick up\",\"token_positions\":[1,3],\"category\":\"phrasal_verb\"}}]}}。没有目标词组时返回 {{\"phrases\":[]}}。只返回 JSON。\n{input}");
    let attempts = if allow_retry { 2 } else { 1 };
    for attempt in 0..attempts {
        if token.cancelled() { return Err(BatchFailure { code: "CANCELLED", stage: "提取", batch }); }
        let prompt = if attempt == 0 { base_prompt.clone() } else { format!("{base_prompt}\n上一次回复无效。请严格检查每项都有 segment_index、canonical、token_positions、category；不要输出无法定位的项。") };
        let started = Instant::now();
        let response = match chat_detailed(client, config, token, notifier, prompt, extraction_schema()).await {
            Ok(value) => value,
            Err(_) if token.cancelled() => return Err(BatchFailure { code: "CANCELLED", stage: "提取", batch }),
            Err(failure) => {
                record_request_failure(file_id, "extraction", batch, &failure, started.elapsed().as_millis());
                return Err(BatchFailure { code: "REQUEST_FAILED", stage: "提取", batch });
            }
        };
        let elapsed = started.elapsed().as_millis();
        if response.finish_reason.as_deref() == Some("length") {
            let final_failure = segments.len() == 1 && attempt + 1 == attempts;
            record_batch(file_id, "extraction", batch, "OUTPUT_TRUNCATED", Some(&response), elapsed, 0, 0, Vec::new(), final_failure.then_some(response.content.as_str()));
            if segments.len() > 1 || final_failure {
                return Err(BatchFailure { code: "OUTPUT_TRUNCATED", stage: "提取", batch });
            }
            continue;
        }
        match parsing::candidates(&response.content, segments) {
            Ok(outcome) if outcome.raw_count == 0 || !outcome.items.is_empty() => {
                record_batch(file_id, "extraction", batch, "OK", Some(&response), elapsed, outcome.items.len(), outcome.skipped_count, outcome.missing_fields.iter().cloned().collect(), None);
                return Ok(outcome);
            }
            Ok(outcome) => {
                let last = attempt + 1 == attempts;
                record_batch(file_id, "extraction", batch, "ALL_ITEMS_INVALID", Some(&response), elapsed, 0, outcome.skipped_count, outcome.missing_fields.iter().cloned().collect(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "ALL_ITEMS_INVALID", stage: "提取", batch }); }
            }
            Err(code) => {
                let last = attempt + 1 == attempts;
                record_batch(file_id, "extraction", batch, &code, Some(&response), elapsed, 0, 0, Vec::new(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "INVALID_JSON", stage: "提取", batch }); }
            }
        }
    }
    unreachable!()
}

async fn request_interpretation(client: &Client, config: &AiConfig, token: &CancellationToken, notifier: Option<&RetryNotifier>, file_id: i64, batch: usize, input: &[serde_json::Value], candidates: &[&Candidate], allow_retry: bool) -> Result<ParseOutcome<Interpretation>, BatchFailure> {
    let base_prompt = format!("For each candidate, decide whether the expression is genuinely used in this sentence. Use adjacent sentences only to resolve context; subtitles are reference, not a translation key. Reject literal, ordinary or unsupported combinations with supported=false and empty meaning_en, usage_en, meaning_zh and usage_zh. Collins senses are editorial evidence, not automatic matches: choose collins_sense_id only when that exact sense fits. A matching spelling with another meaning must use null. A genuine expression can still be supported when no Collins sense matches. Give a natural, concise Chinese translation for this occurrence (meaning_zh), brief Chinese usage guidance (usage_zh), and concise English meaning and usage. For up to two other common senses, provide distinct Chinese and English meanings and an English example that uses the phrase; do not invent senses to fill the quota. Never claim AI text is a Collins quotation. Preserve segment_index, canonical and token_positions. The top-level JSON key MUST be interpretations. Example output: {{\"interpretations\":[{{\"segment_index\":12,\"canonical\":\"pick up\",\"token_positions\":[1,3],\"supported\":true,\"meaning_zh\":\"捡起\",\"usage_zh\":\"宾语可置于动词和小品词之间。\",\"meaning_en\":\"lift something\",\"usage_en\":\"The object may separate the verb and particle.\",\"collins_sense_id\":null,\"other_senses\":[]}}]}}. Return only JSON. Input: {}", serde_json::to_string(input).unwrap());
    let attempts = if allow_retry { 2 } else { 1 };
    for attempt in 0..attempts {
        if token.cancelled() { return Err(BatchFailure { code: "CANCELLED", stage: "解释", batch }); }
        let prompt = if attempt == 0 { base_prompt.clone() } else { format!("{base_prompt}\nThe previous response was invalid. The ONLY top-level key must be interpretations containing an array. Every item needs segment_index, canonical, token_positions, supported, meaning_en, usage_en, meaning_zh, usage_zh, collins_sense_id (null if unknown), and other_senses (empty array if none). Keep all locating fields from input. If unsupported, use supported=false with empty meanings.") };
        let started = Instant::now();
        let response = match chat_detailed(client, config, token, notifier, prompt, interpretation_schema()).await {
            Ok(value) => value,
            Err(_) if token.cancelled() => return Err(BatchFailure { code: "CANCELLED", stage: "解释", batch }),
            Err(failure) => {
                record_request_failure(file_id, "explanation", batch, &failure, started.elapsed().as_millis());
                return Err(BatchFailure { code: "REQUEST_FAILED", stage: "解释", batch });
            }
        };
        let elapsed = started.elapsed().as_millis();
        if response.finish_reason.as_deref() == Some("length") {
            let final_failure = candidates.len() == 1 && attempt + 1 == attempts;
            record_batch(file_id, "explanation", batch, "OUTPUT_TRUNCATED", Some(&response), elapsed, 0, 0, Vec::new(), final_failure.then_some(response.content.as_str()));
            if candidates.len() > 1 || final_failure {
                return Err(BatchFailure { code: "OUTPUT_TRUNCATED", stage: "解释", batch });
            }
            continue;
        }
        match parsing::interpretations(&response.content, candidates) {
            Ok(outcome) if !outcome.items.is_empty() => {
                record_batch(file_id, "explanation", batch, "OK", Some(&response), elapsed, outcome.items.len(), outcome.skipped_count, outcome.missing_fields.iter().cloned().collect(), None);
                return Ok(outcome);
            }
            Ok(outcome) => {
                let last = attempt + 1 == attempts;
                record_batch(file_id, "explanation", batch, "ALL_ITEMS_INVALID", Some(&response), elapsed, 0, outcome.skipped_count, outcome.missing_fields.iter().cloned().collect(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "ALL_ITEMS_INVALID", stage: "解释", batch }); }
            }
            Err(code) => {
                let last = attempt + 1 == attempts;
                record_batch(file_id, "explanation", batch, &code, Some(&response), elapsed, 0, 0, Vec::new(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "INVALID_JSON", stage: "解释", batch }); }
            }
        }
    }
    unreachable!()
}

pub(super) async fn analyze(
    app: AppHandle,
    state: State<'_, DbState>,
    file_id: i64,
    config: AiConfig,
) -> Result<OllamaAnalysisResult, String> {
    if !access_allowed(&config) {
        return Err("请先选择 AI 模型".to_string());
    }
    let token = CancellationToken::default();
    {
        let mut registry = cancel_registry().lock().map_err(|error| error.to_string())?;
        if registry.contains_key(&file_id) {
            return Err("这个文件正在分析中".to_string());
        }
        registry.insert(file_id, token.clone());
    }
    let _guard = CancelGuard { file_id };
    diagnostics::start(file_id, &config.provider, &config.model);
    let result = analyze_inner(&app, &state, file_id, &config, &token).await;
    match &result {
        Ok(_) => {
            diagnostics::finish(file_id, "COMPLETED", "completed");
            emit_progress(&app, file_id, "completed", 1, 1, "completed");
        }
        Err(error) => {
            let code = if token.cancelled() { "CANCELLED" }
                else if error.starts_with("EMPTY_REANALYSIS:") { "EMPTY_REANALYSIS" }
                else if error.starts_with("OUTPUT_TRUNCATED:") { "OUTPUT_TRUNCATED" }
                else if error.starts_with("ALL_ITEMS_INVALID:") { "ALL_ITEMS_INVALID" }
                else if error.starts_with("INVALID_JSON:") { "INVALID_JSON" }
                else if error.starts_with("REQUEST_FAILED:") { "REQUEST_FAILED" }
                else if error.starts_with("SAVE_FAILED:") { "SAVE_FAILED" }
                else { "ANALYSIS_FAILED" };
            diagnostics::finish(file_id, code, "error");
            emit_progress(&app, file_id, "error", 0, 1, "error");
        }
    }
    result
}

async fn analyze_inner(
    app: &AppHandle,
    state: &State<'_, DbState>,
    file_id: i64,
    config: &AiConfig,
    token: &CancellationToken,
) -> Result<OllamaAnalysisResult, String> {
    let segments = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let mut stmt = conn.prepare("SELECT s.index_num,s.en_text FROM segments s JOIN files f ON f.id=s.file_id WHERE s.file_id=?1 AND f.language='en' ORDER BY s.index_num")
            .map_err(|error| error.to_string())?;
        let rows = stmt.query_map([file_id], |row| Ok(SegmentRow { index: row.get(0)?, text: row.get(1)? }))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        rows
    };
    if segments.is_empty() {
        return Err("英文文件没有可分析的句子".to_string());
    }
    let segment_map: HashMap<i32, &SegmentRow> = segments.iter().map(|segment| (segment.index, segment)).collect();
    let ranges = batch_ranges(&segments.iter().map(|s| (s.index, s.text.clone())).collect::<Vec<_>>());
    let total_steps = ranges.len() * 2;
    let client: Client = ai_client(std::time::Duration::from_secs(600), &config.base_url)?;
    let collins_path = collins::index_path(app)?;
    let collins_available = collins_path.is_file();
    let notifier = RetryNotifier { app: app.clone(), file_id };
    let mut candidates = Vec::new();
    emit_progress(app, file_id, "extraction", 0, total_steps, "processing");
    for (batch_number, (start, end)) in ranges.iter().enumerate() {
        if token.cancelled() { return Err(CANCELLED_MESSAGE.to_string()); }
        let batch = batch_number + 1;
        let source = &segments[*start..*end];
        match request_extraction(&client, config, token, Some(&notifier), file_id, batch, source, true).await {
            Ok(outcome) => candidates.extend(outcome.items),
            Err(error) if error.code == "OUTPUT_TRUNCATED" && source.len() > 1 => {
                let middle = source.len() / 2;
                for (part, slice) in [&source[..middle], &source[middle..]].into_iter().enumerate() {
                    let outcome = request_extraction(&client, config, token, Some(&notifier), file_id, batch * 100 + part + 1, slice, false).await
                        .map_err(|failure| failure.as_error())?;
                    candidates.extend(outcome.items);
                }
            }
            Err(error) => return Err(error.as_error()),
        }
        emit_progress(app, file_id, "extraction", batch_number + 1, total_steps, "processing");
    }
    let mut accepted = Vec::new();
    for (batch_number, (start, end)) in ranges.iter().enumerate() {
        if token.cancelled() { return Err(CANCELLED_MESSAGE.to_string()); }
        let segment_ids: HashSet<i32> = segments[*start..*end].iter().map(|segment| segment.index).collect();
        let batch_candidates: Vec<&Candidate> = candidates.iter().filter(|candidate| segment_ids.contains(&candidate.segment_index)).collect();
        if !batch_candidates.is_empty() {
            let mut evidence = HashMap::new();
            for candidate in &batch_candidates {
                let senses = collins::lookup_phrase(&collins_path, &candidate.canonical)?;
                evidence.insert(key(candidate.segment_index, &candidate.canonical, &candidate.token_positions), senses);
            }
            let input = batch_candidates.iter().map(|candidate| {
                let index = segments.iter().position(|segment| segment.index == candidate.segment_index).unwrap();
                let segment = &segments[index];
                serde_json::json!({
                    "segment_index":candidate.segment_index,"canonical":candidate.canonical,
                    "token_positions":candidate.token_positions,"category":candidate.category,
                    "sentence":segment.text,
                    "previous":index.checked_sub(1).map(|i| segments[i].text.chars().take(200).collect::<String>()),
                    "next":segments.get(index+1).map(|s| s.text.chars().take(200).collect::<String>()),
                    "collins_senses":evidence.get(&key(candidate.segment_index, &candidate.canonical, &candidate.token_positions))
                        .map(|senses| senses.iter().collect::<Vec<_>>()).unwrap_or_default()
                })
            }).collect::<Vec<_>>();
            let batch = batch_number + 1;
            let interpretations = match request_interpretation(&client, config, token, Some(&notifier), file_id, batch, &input, &batch_candidates, true).await {
                Ok(outcome) => outcome.items,
                Err(error) if error.code == "OUTPUT_TRUNCATED" && batch_candidates.len() > 1 => {
                    let middle = batch_candidates.len() / 2;
                    let mut items = Vec::new();
                    for (part, (input_part, candidates_part)) in [(&input[..middle], &batch_candidates[..middle]), (&input[middle..], &batch_candidates[middle..])].into_iter().enumerate() {
                        let outcome = request_interpretation(&client, config, token, Some(&notifier), file_id, batch * 100 + part + 1, input_part, candidates_part, false).await
                            .map_err(|failure| failure.as_error())?;
                        items.extend(outcome.items);
                    }
                    items
                }
                Err(error) => return Err(error.as_error()),
            };
            let lookup: HashMap<String, &Candidate> = batch_candidates.iter().map(|candidate| (key(candidate.segment_index, &candidate.canonical, &candidate.token_positions), *candidate)).collect();
            let mut seen = HashSet::new();
            for item in interpretations {
                let item_key = key(item.segment_index, &item.canonical, &item.token_positions);
                let Some(candidate) = lookup.get(&item_key) else { continue; };
                if !seen.insert(item_key.clone()) || !item.supported || item.meaning_en.trim().is_empty() || item.usage_en.trim().is_empty() || item.meaning_zh.trim().is_empty() || item.usage_zh.trim().is_empty() { continue; }
                let Some(segment) = segment_map.get(&candidate.segment_index) else { continue; };
                let Some(surface) = validate_candidate(candidate, segment) else { continue; };
                let mut sense_seen = HashSet::new();
                let other_senses = item.other_senses.into_iter().filter_map(|sense| {
                    let meaning = sense.meaning_en.trim().to_string();
                    let meaning_zh = sense.meaning_zh.trim().to_string();
                    let example = sense.example_en.trim().to_string();
                    if meaning.is_empty() || meaning_zh.is_empty() || example.is_empty() || meaning == item.meaning_en.trim() || meaning_zh == item.meaning_zh.trim() || !sense_seen.insert(meaning.clone()) || !example_uses_phrase(&example, &candidate.canonical, &candidate.category) { return None; }
                    Some(OtherSense { meaning_en: meaning, meaning_zh, example_en: example })
                }).take(2).collect();
                let collins_sense_id = matched_collins_sense(item.collins_sense_id,
                    evidence.get(&item_key).map(Vec::as_slice).unwrap_or_default());
                accepted.push(Accepted { candidate: (*candidate).clone(), surface, meaning_en: item.meaning_en.trim().to_string(), usage_en: item.usage_en.trim().to_string(), meaning_zh: item.meaning_zh.trim().to_string(), usage_zh: item.usage_zh.trim().to_string(), other_senses, collins_sense_id });
            }
        }
        emit_progress(app, file_id, "explanation", ranges.len() + batch_number + 1, total_steps, "processing");
    }
    if token.cancelled() { return Err(CANCELLED_MESSAGE.to_string()); }
    if accepted.is_empty() {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let previous_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM phrase_occurrences po JOIN segments s ON s.id=po.segment_id WHERE s.file_id=?1",
            [file_id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if previous_count > 0 {
            return Err("EMPTY_REANALYSIS: 没有可验证的词组，旧分析已保留".into());
        }
    }
    emit_progress(app, file_id, "saving", total_steps, total_steps, "processing");
    save_results(state, file_id, config, &accepted, collins_available).map_err(|error| {
        record_batch(file_id, "saving", 0, "SAVE_FAILED", None, 0, 0, 0, Vec::new(), None);
        format!("SAVE_FAILED: {error}")
    })
}

fn save_results(state: &State<'_, DbState>, file_id: i64, config: &AiConfig, accepted: &[Accepted], collins_available: bool) -> Result<OllamaAnalysisResult, String> {
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    let skipped_items = diagnostics::summary(file_id).map(|summary| summary.total_skipped as i64).unwrap_or(0);
    save_results_on_connection(&conn, file_id, config, accepted, collins_available, skipped_items)
}

fn save_results_on_connection(conn: &Connection, file_id: i64, config: &AiConfig, accepted: &[Accepted], collins_available: bool, skipped_items: i64) -> Result<OllamaAnalysisResult, String> {
    conn.execute("BEGIN IMMEDIATE", []).map_err(|error| error.to_string())?;
    let result = (|| {
        let old = {
            let mut stmt = conn.prepare("SELECT po.id,p.text,s.index_num,po.position,po.token_positions_json,po.hidden,po.meaning_zh,po.usage_zh,po.meaning_edited,po.meaning_en,po.usage_en,po.meaning_en_edited,po.collins_sense_id FROM phrase_occurrences po JOIN phrases p ON p.id=po.phrase_id JOIN segments s ON s.id=po.segment_id WHERE s.file_id=?1")
                .map_err(|error| error.to_string())?;
            let rows = stmt.query_map([file_id], |row| Ok((row.get::<_, i64>(0)?,row.get::<_, String>(1)?,row.get::<_, i32>(2)?,row.get::<_, i32>(3)?,row.get::<_, Option<String>>(4)?,row.get::<_, i64>(5)?,row.get::<_, Option<String>>(6)?,row.get::<_, Option<String>>(7)?,row.get::<_, i64>(8)?,row.get::<_, Option<String>>(9)?,row.get::<_, Option<String>>(10)?,row.get::<_, i64>(11)?,row.get::<_, Option<i64>>(12)?)))
                .map_err(|error| error.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|error| error.to_string())?;
            rows
        };
        let old_map: HashMap<(String,i32,String), (i64,i64,Option<String>,Option<String>,i64,Option<String>,Option<String>,i64,Option<i64>)> = old.into_iter().map(|(id,text,index,position,positions,hidden,meaning,usage,edited,meaning_en,usage_en,edited_en,sense_id)| {
            // Legacy occurrences have no token list; preserve edits at their original start.
            let positions = positions.unwrap_or_else(|| format!("[{position}]"));
            ((text,index,positions),(id,hidden,meaning,usage,edited,meaning_en,usage_en,edited_en,sense_id))
        }).collect();
        // Unmatched manual, hidden and edited occurrences are user work and survive reanalysis.
        conn.execute("DELETE FROM phrase_occurrences WHERE segment_id IN (SELECT id FROM segments WHERE file_id=?1) AND hidden=0 AND meaning_edited=0 AND meaning_en_edited=0 AND phrase_id IN (SELECT id FROM phrases WHERE source='detected')", [file_id]).map_err(|error| error.to_string())?;
        let mut unique = HashSet::new();
        for item in accepted {
            let text = &item.candidate.canonical;
            conn.execute("INSERT OR IGNORE INTO phrases(language,text,source) VALUES('en',?1,'detected')", [text]).map_err(|error| error.to_string())?;
            let phrase_id: i64 = conn.query_row("SELECT id FROM phrases WHERE language='en' AND text=?1", [text], |row| row.get(0)).map_err(|error| error.to_string())?;
            let segment_id: i64 = conn.query_row("SELECT id FROM segments WHERE file_id=?1 AND index_num=?2", params![file_id,item.candidate.segment_index], |row| row.get(0)).map_err(|error| error.to_string())?;
            let position = item.candidate.token_positions[0];
            let positions_json = serde_json::to_string(&item.candidate.token_positions).map_err(|error| error.to_string())?;
            let exact_key = (text.clone(),item.candidate.segment_index,positions_json.clone());
            let legacy_key = (text.clone(),item.candidate.segment_index,format!("[{position}]"));
            let previous = old_map.get(&exact_key).or_else(|| old_map.get(&legacy_key));
            if let Some(previous) = previous {
                conn.execute("DELETE FROM phrase_occurrences WHERE id=?1", [previous.0]).map_err(|error| error.to_string())?;
            }
            let hidden = previous.map(|value| value.1).unwrap_or(0);
            let edited = previous.map(|value| value.4).unwrap_or(0);
            let meaning_zh = if edited != 0 { previous.and_then(|value| value.2.clone()).unwrap_or_else(|| item.meaning_zh.clone()) } else { item.meaning_zh.clone() };
            let usage_zh = if edited != 0 { previous.and_then(|value| value.3.clone()).unwrap_or_else(|| item.usage_zh.clone()) } else { item.usage_zh.clone() };
            let edited_en = previous.map(|value| value.7).unwrap_or(0);
            let meaning_en = if edited_en != 0 { previous.and_then(|value| value.5.clone()).unwrap_or_else(|| item.meaning_en.clone()) } else { item.meaning_en.clone() };
            let usage_en = if edited_en != 0 { previous.and_then(|value| value.6.clone()).unwrap_or_else(|| item.usage_en.clone()) } else { item.usage_en.clone() };
            let sense_id = if edited_en != 0 { previous.and_then(|value| value.8) } else { item.collins_sense_id };
            conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden,surface_text,token_positions_json,meaning_zh,usage_zh,meaning_edited,meaning_en,usage_en,meaning_en_edited,collins_sense_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)", params![phrase_id,segment_id,position,hidden,item.surface,positions_json,meaning_zh,usage_zh,edited,meaning_en,usage_en,edited_en,sense_id]).map_err(|error| error.to_string())?;
            if unique.insert(text.clone()) {
                let other_json = serde_json::to_string(&item.other_senses.iter().map(|sense| serde_json::json!({"meaning_zh":sense.meaning_zh,"example_en":sense.example_en})).collect::<Vec<_>>()).map_err(|error| error.to_string())?;
                let other_en_json = serde_json::to_string(&item.other_senses.iter().map(|sense| serde_json::json!({"meaning_en":sense.meaning_en,"example_en":sense.example_en})).collect::<Vec<_>>()).map_err(|error| error.to_string())?;
                conn.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,usage_zh,category,provider,updated_at,meaning_en,usage_en,other_senses_json,other_senses_en_json) VALUES('en',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(language,text) DO UPDATE SET translation=excluded.translation,usage_zh=excluded.usage_zh,category=excluded.category,provider=excluded.provider,updated_at=excluded.updated_at,meaning_en=excluded.meaning_en,usage_en=excluded.usage_en,other_senses_json=CASE WHEN phrase_dictionary_entries.other_senses_edited=1 THEN phrase_dictionary_entries.other_senses_json ELSE excluded.other_senses_json END,other_senses_en_json=CASE WHEN phrase_dictionary_entries.other_senses_en_edited=1 THEN phrase_dictionary_entries.other_senses_en_json ELSE excluded.other_senses_en_json END", params![text,item.meaning_zh,item.usage_zh,item.candidate.category,config.model,now_ms(),item.meaning_en,item.usage_en,other_json,other_en_json]).map_err(|error| error.to_string())?;
            }
        }
        conn.execute("DELETE FROM phrases WHERE language='en' AND source='detected' AND status='unprocessed' AND definition IS NULL AND NOT EXISTS(SELECT 1 FROM phrase_occurrences po WHERE po.phrase_id=phrases.id) AND NOT EXISTS(SELECT 1 FROM phrase_reviews pr WHERE pr.phrase_id=phrases.id)", []).map_err(|error| error.to_string())?;
        conn.execute("INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version,collins_evidence_available,skipped_items) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(file_id) DO UPDATE SET model=excluded.model,completed_at=excluded.completed_at,pipeline_version=excluded.pipeline_version,collins_evidence_available=excluded.collins_evidence_available,skipped_items=excluded.skipped_items", params![file_id,config.model,now_ms(),PIPELINE_VERSION,collins_available as i64,skipped_items]).map_err(|error| error.to_string())?;
        Ok(OllamaAnalysisResult { phrase_count: unique.len(), occurrence_count: accepted.len() })
    })();
    match result {
        Ok(value) => { conn.execute("COMMIT", []).map_err(|error| error.to_string())?; Ok(value) }
        Err(error) => { let _ = conn.execute("ROLLBACK", []); Err(error) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn mock_deepseek(replies: &[(&str, &str)]) -> (AiConfig, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let responses: Vec<String> = replies.iter().enumerate().map(|(index, (content, finish_reason))| {
            serde_json::json!({
                "id": format!("test-request-{index}"),
                "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20}
            }).to_string()
        }).collect();
        let handle = std::thread::spawn(move || {
            for body in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut buffer = [0u8; 4096];
                loop {
                    let count = stream.read(&mut buffer).unwrap();
                    request.extend_from_slice(&buffer[..count]);
                    let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") else { continue; };
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers.lines().find_map(|line| {
                        line.to_ascii_lowercase().strip_prefix("content-length:")
                            .and_then(|length| length.trim().parse::<usize>().ok())
                    }).unwrap_or(0);
                    if request.len() >= header_end + 4 + content_length { break; }
                }
                let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(body.as_bytes()).unwrap();
            }
        });
        (AiConfig { provider: "openai".into(), base_url: format!("http://{address}"), model: "deepseek-chat".into(), api_key: Some("TEST_API_KEY_NEVER_LOG".into()) }, handle)
    }

    fn segment(text: &str) -> SegmentRow { SegmentRow { index: 1, text: text.to_string() } }

    #[test]
    fn request_failure_records_status_without_provider_body_or_secret() {
        let file_id = -105;
        diagnostics::start(file_id, "openai", "deepseek-flash");
        let failure = ChatFailure {
            message: "provider body with subtitle and TEST_API_KEY_NEVER_LOG".into(),
            kind: "HTTP_ERROR",
            http_status: Some(401),
            request_id: Some("trace-123".into()),
        };
        record_request_failure(file_id, "extraction", 2, &failure, 150);
        let safe = serde_json::to_string(&diagnostics::summary(file_id).unwrap()).unwrap();
        assert!(safe.contains("HTTP_ERROR"));
        assert!(safe.contains("trace-123"));
        assert!(safe.contains("401"));
        assert!(!safe.contains("TEST_API_KEY_NEVER_LOG"));
        assert!(!safe.contains("subtitle"));
        assert!(diagnostics::raw_report(file_id).is_none());
    }

    #[tokio::test]
    async fn retries_all_invalid_items_then_keeps_recovered_result_without_leaking_key() {
        let invalid = r#"{"phrases":[{"canonical":"pick up","category":"phrasal_verb"}]}"#;
        let valid = r#"{"phrases":[{"canonical":"pick up","token_positions":[1,3],"category":"phrasal_verb"}]}"#;
        let (config, server) = mock_deepseek(&[(invalid, "stop"), (valid, "stop")]);
        let file_id = -101;
        diagnostics::start(file_id, &config.provider, &config.model);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let result = request_extraction(&client, &config, &CancellationToken::default(), None, file_id, 1, &[SegmentRow { index: 4, text: "I picked it up.".into() }], true).await.unwrap();
        server.join().unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].segment_index, 4);
        assert_eq!(result.recovered_count, 1);
        let safe = serde_json::to_string(&diagnostics::summary(file_id).unwrap()).unwrap();
        assert!(safe.contains("test-request-1"));
        assert!(!safe.contains("TEST_API_KEY_NEVER_LOG"));
        assert!(!safe.contains("I picked it up"));
        assert!(diagnostics::raw_report(file_id).is_none());
    }

    #[tokio::test]
    async fn retry_exhaustion_keeps_final_response_only_in_memory() {
        let invalid = r#"{"phrases":[{"canonical":"pick up","category":"phrasal_verb"}]}"#;
        let (config, server) = mock_deepseek(&[(invalid, "stop"), (invalid, "stop")]);
        let file_id = -102;
        diagnostics::start(file_id, &config.provider, &config.model);
        let client = ai_client(std::time::Duration::from_secs(5), &config.base_url).unwrap();
        let failure = request_extraction(&client, &config, &CancellationToken::default(), None, file_id, 1, &[SegmentRow { index: 4, text: "I picked it up.".into() }], true).await.err().unwrap();
        server.join().unwrap();
        assert_eq!(failure.code, "ALL_ITEMS_INVALID");
        assert_eq!(diagnostics::summary(file_id).unwrap().missing_fields, vec!["segment_index", "token_positions"]);
        assert!(diagnostics::raw_report(file_id).unwrap().contains("pick up"));
    }

    #[tokio::test]
    async fn empty_and_length_limited_replies_follow_bounded_retry() {
        let (empty_config, empty_server) = mock_deepseek(&[("", "stop"), ("", "stop")]);
        let empty_id = -103;
        diagnostics::start(empty_id, &empty_config.provider, &empty_config.model);
        let client = ai_client(std::time::Duration::from_secs(5), &empty_config.base_url).unwrap();
        let failure = request_extraction(&client, &empty_config, &CancellationToken::default(), None, empty_id, 1, &[SegmentRow { index: 4, text: "I picked it up.".into() }], true).await.err().unwrap();
        empty_server.join().unwrap();
        assert_eq!(failure.code, "INVALID_JSON");
        assert_eq!(diagnostics::summary(empty_id).unwrap().code, "empty_response");

        let (length_config, length_server) = mock_deepseek(&[("{\"phrases\":[", "length")]);
        let length_id = -104;
        diagnostics::start(length_id, &length_config.provider, &length_config.model);
        let client = ai_client(std::time::Duration::from_secs(5), &length_config.base_url).unwrap();
        let failure = request_extraction(&client, &length_config, &CancellationToken::default(), None, length_id, 1, &[SegmentRow { index: 4, text: "I picked it up.".into() }, SegmentRow { index: 5, text: "She picked it up.".into() }], true).await.err().unwrap();
        length_server.join().unwrap();
        assert_eq!(failure.code, "OUTPUT_TRUNCATED");
        assert_eq!(diagnostics::summary(length_id).unwrap().finish_reason.as_deref(), Some("length"));
    }

    #[test]
    fn separated_phrasal_verb_matches_lemma_and_positions() {
        let candidate = Candidate { segment_index: 1, canonical: "pick up".into(), token_positions: vec![0,2], category: "phrasal_verb".into() };
        assert_eq!(validate_candidate(&candidate, &segment("Picked it up quickly.")), Some("Picked up".into()));
    }

    #[test]
    fn supplied_subtitle_example_maps_inflected_phrase_to_exact_tokens() {
        let candidate = Candidate { segment_index: 1, canonical: "blow up".into(), token_positions: vec![7,8], category: "phrasal_verb".into() };
        assert_eq!(validate_candidate(&candidate, &segment("Like, you know, my channel kind of blew up.")), Some("blew up".into()));
    }

    #[test]
    fn rejects_wrong_positions_and_noncontiguous_collocations() {
        let segment = segment("I picked it up quickly.");
        let wrong = Candidate { segment_index: 1, canonical: "pick up".into(), token_positions: vec![0,3], category: "phrasal_verb".into() };
        assert!(validate_candidate(&wrong, &segment).is_none());
        let gap = Candidate { segment_index: 1, canonical: "pick up".into(), token_positions: vec![1,3], category: "collocation".into() };
        assert!(validate_candidate(&gap, &segment).is_none());
    }

    #[test]
    fn expanded_example_must_use_the_expression() {
        assert!(example_uses_phrase("She picked the book up.", "pick up", "phrasal_verb"));
        assert!(!example_uses_phrase("She picked a book.", "pick up", "phrasal_verb"));
        assert!(example_uses_phrase("We made a decision.", "make a decision", "collocation"));
    }

    #[test]
    fn collins_provenance_requires_a_selected_sense_from_the_retrieved_entry() {
        let book_club = collins::Sense {
            id: 42, phrase: "book club".into(), headword: "book club".into(),
            grammar: "N-COUNT".into(), definition: "A bookselling organization.".into(), example: None,
        };
        assert_eq!(matched_collins_sense(None, &[book_club.clone()]), None);
        assert_eq!(matched_collins_sense(Some(99), &[book_club.clone()]), None);
        assert_eq!(matched_collins_sense(Some(42), &[book_club]), Some(42));
    }

    #[test]
    fn reanalysis_preserves_edits_reviews_and_rolls_back_a_failed_save() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("analysis.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('demo.txt','txt','I picked it up.','hash',1,'en')", []).unwrap();
        let file_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(?1,0,'I picked it up.')", [file_id]).unwrap();
        let segment_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO phrases(language,text,status,definition) VALUES('en','pick up','learning','My note')", []).unwrap();
        let phrase_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden,token_positions_json,meaning_zh,usage_zh,meaning_edited) VALUES(?1,?2,1,1,'[1,3]','我的修订','我的用法',1)", params![phrase_id,segment_id]).unwrap();
        conn.execute("INSERT INTO phrase_reviews(phrase_id,due_at,reps) VALUES(?1,123,4)", [phrase_id]).unwrap();
        conn.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited) VALUES('en','pick up','旧翻译','old',1,'[{\"meaning_zh\":\"自定义\",\"example_en\":\"Pick it up.\"}]',1)", []).unwrap();
        conn.execute("INSERT INTO phrases(language,text,source) VALUES('en','take off','manual')", []).unwrap();
        let manual_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden) VALUES(?1,?2,0,0)", params![manual_id,segment_id]).unwrap();
        conn.execute("INSERT INTO phrases(language,text) VALUES('en','look up')", []).unwrap();
        let edited_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden,meaning_zh,meaning_edited) VALUES(?1,?2,2,0,'保留此释义',1)", params![edited_id,segment_id]).unwrap();
        let config = AiConfig { provider: "ollama".into(), base_url: "http://localhost".into(), model: "test".into(), api_key: None };
        let accepted = Accepted { candidate: Candidate { segment_index: 0, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into(), meaning_en: "pick something up".into(), usage_en: "Separable phrasal verb".into(), meaning_zh: "捡起".into(), usage_zh: "可分离".into(), other_senses: vec![], collins_sense_id: None };
        save_results_on_connection(&conn, file_id, &config, &[accepted], false, 0).unwrap();
        let preserved: (i64,String,String,i64,i64,String,String,i64) = conn.query_row(
            "SELECT po.hidden,po.meaning_zh,po.usage_zh,po.meaning_edited,pr.reps,p.status,pde.other_senses_json,pde.other_senses_edited FROM phrase_occurrences po JOIN phrases p ON p.id=po.phrase_id JOIN phrase_reviews pr ON pr.phrase_id=p.id JOIN phrase_dictionary_entries pde ON pde.text=p.text WHERE p.text='pick up'",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)),
        ).unwrap();
        assert_eq!(preserved.0, 1);
        assert_eq!((preserved.1.as_str(),preserved.2.as_str(),preserved.3,preserved.4,preserved.5.as_str()), ("我的修订","我的用法",1,4,"learning"));
        assert!(preserved.6.contains("自定义"));
        assert_eq!(preserved.7, 1);
        let retained: i64 = conn.query_row("SELECT COUNT(*) FROM phrase_occurrences WHERE phrase_id IN (?1,?2)", params![manual_id,edited_id], |row| row.get(0)).unwrap();
        assert_eq!(retained, 2);

        let invalid = Accepted { candidate: Candidate { segment_index: 99, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into(), meaning_en: "invalid".into(), usage_en: "invalid".into(), meaning_zh: "无效".into(), usage_zh: "无效".into(), other_senses: vec![], collins_sense_id: None };
        assert!(save_results_on_connection(&conn, file_id, &config, &[invalid], false, 0).is_err());
        let meaning: String = conn.query_row("SELECT meaning_zh FROM phrase_occurrences WHERE phrase_id=?1", [phrase_id], |row| row.get(0)).unwrap();
        assert_eq!(meaning, "我的修订");
    }

    #[test]
    fn bilingual_context_and_other_senses_are_saved_separately() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("bilingual.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at) VALUES('demo.txt','txt','I picked it up.','hash',1)", []).unwrap();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,'I picked it up.')", []).unwrap();
        let config = AiConfig { provider: "ollama".into(), base_url: "http://localhost".into(), model: "test".into(), api_key: None };
        let accepted = Accepted { candidate: Candidate { segment_index: 0, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into(), meaning_en: "lift it".into(), usage_en: "separable".into(), meaning_zh: "把它捡起来".into(), usage_zh: "宾语可置于中间".into(), other_senses: vec![OtherSense { meaning_en: "learn".into(), meaning_zh: "学会".into(), example_en: "She picked up French quickly.".into() }], collins_sense_id: Some(7) };
        save_results_on_connection(&conn, 1, &config, &[accepted], true, 7).unwrap();
        let skipped: i64 = conn.query_row("SELECT skipped_items FROM file_phrase_analysis WHERE file_id=1", [], |row| row.get(0)).unwrap();
        assert_eq!(skipped, 7);
        let (zh, en, sense): (String, String, Option<i64>) = conn.query_row("SELECT meaning_zh,meaning_en,collins_sense_id FROM phrase_occurrences", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
        assert_eq!((zh.as_str(), en.as_str(), sense), ("把它捡起来", "lift it", Some(7)));
        let (zh_json, en_json): (String, String) = conn.query_row("SELECT other_senses_json,other_senses_en_json FROM phrase_dictionary_entries WHERE text='pick up'", [], |row| Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&zh_json).unwrap()[0]["meaning_zh"], "学会");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&en_json).unwrap()[0]["meaning_en"], "learn");
    }
}
