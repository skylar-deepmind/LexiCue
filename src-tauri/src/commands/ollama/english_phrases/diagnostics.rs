use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::super::now_ms;

const RAW_TTL_MS: i64 = 15 * 60 * 1000;
const RAW_MAX_BYTES: usize = 64 * 1024;
const MAX_RECORDS: usize = 100;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StageUsage {
    pub requests: usize,
    pub content_retries: usize,
    pub transport_retries: usize,
    pub splits: usize,
    pub cache_hits: usize,
    pub input_chars: usize,
    #[serde(skip)]
    last_input_chars: usize,
    #[serde(skip)]
    last_stream: bool,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
}
impl Default for StageUsage {
    fn default() -> Self { Self { requests: 0, content_retries: 0, transport_retries: 0, splits: 0,
        cache_hits: 0, input_chars: 0, last_input_chars: 0, last_stream: false, prompt_tokens: Some(0), completion_tokens: Some(0) } }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticSummary {
    pub run_id: String,
    pub file_id: i64,
    pub stage: String,
    pub status: String,
    pub batch: usize,
    pub code: String,
    pub error_kind: Option<String>,
    pub http_status: Option<u16>,
    pub provider: String,
    pub model: String,
    pub request_id: Option<String>,
    pub finish_reason: Option<String>,
    pub duration_ms: u128,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub valid_count: usize,
    pub skipped_count: usize,
    pub total_skipped: usize,
    pub missing_fields: Vec<String>,
    pub raw_available: bool,
    pub occurred_at: i64,
    pub extraction: StageUsage,
    pub explanation: StageUsage,
    pub cache_errors: usize,
    pub stream_requests: usize,
    pub stream_fallbacks: usize,
    pub first_preview_ms: Option<u128>,
    pub usage_incomplete: bool,
}

struct DiagnosticRecord {
    summary: DiagnosticSummary,
    raw_response: Option<String>,
    raw_truncated: bool,
    raw_at: i64,
}

static DIAGNOSTICS: OnceLock<Mutex<HashMap<i64, DiagnosticRecord>>> = OnceLock::new();

fn records() -> &'static Mutex<HashMap<i64, DiagnosticRecord>> {
    DIAGNOSTICS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
pub(super) fn start(file_id: i64, provider: &str, model: &str) -> String {
    start_with_id(file_id, provider, model, None)
}

pub(super) fn start_with_id(file_id: i64, provider: &str, model: &str, run_id: Option<String>) -> String {
    let run_id = run_id.unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    let summary = DiagnosticSummary {
        run_id: run_id.clone(), file_id, stage: "starting".into(), status: "processing".into(), batch: 0,
        code: "STARTED".into(), error_kind: None, http_status: None,
        provider: provider.into(), model: model.into(),
        request_id: None, finish_reason: None, duration_ms: 0,
        prompt_tokens: None, completion_tokens: None,
        valid_count: 0, skipped_count: 0, total_skipped: 0,
        missing_fields: Vec::new(), raw_available: false, occurred_at: now_ms(),
        extraction: StageUsage::default(), explanation: StageUsage::default(), cache_errors: 0,
        stream_requests: 0, stream_fallbacks: 0, first_preview_ms: None, usage_incomplete: false,
    };
    if let Ok(mut entries) = records().lock() {
        if entries.len() >= MAX_RECORDS && !entries.contains_key(&file_id) {
            if let Some(oldest) = entries.iter().min_by_key(|(_, entry)| entry.summary.occurred_at).map(|(id, _)| *id) {
                entries.remove(&oldest);
            }
        }
        entries.insert(file_id, DiagnosticRecord { summary, raw_response: None, raw_truncated: false, raw_at: 0 });
    }
    run_id
}

fn mutate(file_id: i64, action: impl FnOnce(&mut DiagnosticSummary)) {
    if let Ok(mut entries) = records().lock() {
        if let Some(entry) = entries.get_mut(&file_id) { action(&mut entry.summary); }
    }
}
fn stage_usage<'a>(summary: &'a mut DiagnosticSummary, stage: &str) -> &'a mut StageUsage {
    if stage == "extraction" { &mut summary.extraction } else { &mut summary.explanation }
}
pub(super) fn begin_request(file_id: i64, stage: &str, prompt: &str, retry: bool) {
    mutate(file_id, |summary| {
        summary.stage = stage.into();
        let usage = stage_usage(summary, stage);
        usage.requests += 1;
        usage.last_input_chars = prompt.chars().count() + super::super::SYSTEM_PROMPT.chars().count();
        usage.input_chars += usage.last_input_chars;
        usage.content_retries += usize::from(retry);
    });
}
pub(super) fn response_usage(file_id: i64, stage: &str, response: Option<&super::ChatResult>) {
    mutate(file_id, |summary| {
        if response.and_then(|r| r.prompt_tokens).is_none() || response.and_then(|r| r.completion_tokens).is_none() { summary.usage_incomplete = true; }
        let usage = stage_usage(summary, stage);
        usage.prompt_tokens = usage.prompt_tokens.zip(response.and_then(|r| r.prompt_tokens)).map(|(a,b)| a+b);
        usage.completion_tokens = usage.completion_tokens.zip(response.and_then(|r| r.completion_tokens)).map(|(a,b)| a+b);
    });
}
pub(super) fn cache_hit(file_id: i64, stage: &str) {
    mutate(file_id, |summary| stage_usage(summary, stage).cache_hits += 1);
}
#[cfg(test)]
pub(super) fn split(file_id: i64, stage: &str) {
    mutate(file_id, |summary| stage_usage(summary, stage).splits += 1);
}
pub(super) fn cache_error(file_id: i64) { mutate(file_id, |summary| summary.cache_errors += 1); }
pub(super) fn transport_retry(file_id: i64) {
    mutate(file_id, |summary| {
        if summary.stage == "extraction" || summary.stage == "explanation" {
            let stage = summary.stage.clone();
            if summary.extraction.last_stream { summary.stream_requests += 1; }
            summary.usage_incomplete = true;
            let usage = stage_usage(summary, &stage);
            usage.requests += 1;
            usage.transport_retries += 1;
            usage.input_chars += usage.last_input_chars;
            usage.prompt_tokens = None;
            usage.completion_tokens = None;
        }
    });
}

pub(super) fn stream_request(file_id: i64, stream: bool) {
    mutate(file_id, |summary| { summary.extraction.last_stream = stream; summary.stream_requests += usize::from(stream); });
}
pub(super) fn compatibility_retry(file_id: i64) {
    mutate(file_id, |summary| {
        summary.stream_fallbacks += 1;
        summary.extraction.requests += 1;
        summary.extraction.input_chars += summary.extraction.last_input_chars;
        summary.usage_incomplete = true;
        summary.extraction.prompt_tokens = None; summary.extraction.completion_tokens = None;
    });
}
pub(super) fn batch_response(file_id: i64) { mutate(file_id, |summary| summary.stream_fallbacks += 1); }
pub(super) fn preview(file_id: i64, elapsed: u128) {
    mutate(file_id, |summary| { if summary.first_preview_ms.is_none() { summary.first_preview_ms = Some(elapsed); } });
}

pub(super) fn record(file_id: i64, mut update: DiagnosticSummary, raw: Option<&str>) {
    if let Ok(mut entries) = records().lock() {
        if let Some(entry) = entries.get_mut(&file_id) {
            update.total_skipped = entry.summary.total_skipped
                + if update.code == "OK" { update.skipped_count } else { 0 };
            entry.summary = update.clone();
            if let Some(content) = raw {
                let mut end = content.len().min(RAW_MAX_BYTES);
                while !content.is_char_boundary(end) { end -= 1; }
                entry.raw_response = Some(content[..end].to_string());
                entry.raw_truncated = end < content.len();
                entry.raw_at = now_ms();
                entry.summary.raw_available = true;
            }
        }
    }
    // Deliberately emit only structured metadata. Never log prompts, subtitles or model text.
    if let Ok(line) = serde_json::to_string(&update) {
        log::info!(target: "lexicue::ai_analysis", "{line}");
    }
}

pub(super) fn finish(file_id: i64, code: &str, stage: &str) {
    if let Ok(mut entries) = records().lock() {
        if let Some(entry) = entries.get_mut(&file_id) {
            entry.summary.code = code.to_string();
            entry.summary.status = stage.to_string();
            if code == "COMPLETED" { entry.summary.stage = "completed".into(); }
            entry.summary.occurred_at = now_ms();
            if code == "COMPLETED" || code == "CANCELLED" {
                entry.raw_response = None;
                entry.summary.raw_available = false;
            }
            if let Ok(line) = serde_json::to_string(&entry.summary) {
                log::info!(target: "lexicue::ai_analysis", "{line}");
            }
        }
    }
}

pub(super) fn summary(file_id: i64) -> Option<DiagnosticSummary> {
    let mut entries = records().lock().ok()?;
    let entry = entries.get_mut(&file_id)?;
    if now_ms() - entry.raw_at > RAW_TTL_MS {
        entry.raw_response = None;
        entry.summary.raw_available = false;
    }
    Some(entry.summary.clone())
}

pub(super) fn raw_report(file_id: i64) -> Option<String> {
    let entries = records().lock().ok()?;
    let entry = entries.get(&file_id)?;
    if now_ms() - entry.raw_at > RAW_TTL_MS { return None; }
    let raw = entry.raw_response.as_ref()?;
    serde_json::to_string_pretty(&serde_json::json!({
        "diagnostic": entry.summary,
        "rawModelResponse": raw,
        "rawResponseTruncated": entry.raw_truncated,
    })).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_excludes_response_and_clears_raw_on_completion() {
        let file_id = -42;
        let run = start(file_id, "openai", "deepseek-chat");
        let mut update = summary(file_id).unwrap();
        update.stage = "extraction".into();
        update.code = "ALL_ITEMS_INVALID".into();
        update.missing_fields = vec!["segment_index".into()];
        record(file_id, update, Some("secret subtitle and model reply"));
        let safe = serde_json::to_string(&summary(file_id).unwrap()).unwrap();
        assert!(safe.contains(&run));
        assert!(safe.contains("segment_index"));
        assert!(!safe.contains("secret subtitle"));
        assert!(raw_report(file_id).unwrap().contains("secret subtitle"));
        finish(file_id, "COMPLETED", "completed");
        assert!(raw_report(file_id).is_none());
    }
    #[test]
    fn stage_totals_count_retries_once_and_unknown_usage_stays_unknown() {
        let file_id = -204;
        start(file_id, "ollama", "test");
        let response = super::super::ChatResult { content: "{}".into(), request_id: None, finish_reason: None,
            prompt_tokens: Some(10), completion_tokens: Some(20) };
        begin_request(file_id,"extraction","first",false);
        response_usage(file_id,"extraction",Some(&response));
        begin_request(file_id,"extraction","retry",true);
        response_usage(file_id,"extraction",Some(&response));
        cache_hit(file_id,"extraction");
        split(file_id,"extraction");
        finish(file_id,"COMPLETED","completed");
        let value = summary(file_id).unwrap();
        assert_eq!((value.extraction.requests,value.extraction.content_retries,value.extraction.cache_hits,value.extraction.splits),(2,1,1,1));
        assert_eq!((value.extraction.prompt_tokens,value.extraction.completion_tokens),(Some(20),Some(40)));
        begin_request(file_id,"explanation","unknown",false);
        response_usage(file_id,"explanation",None);
        begin_request(file_id,"explanation","known",true);
        response_usage(file_id,"explanation",Some(&response));
        let before = summary(file_id).unwrap().explanation.input_chars;
        transport_retry(file_id);
        let value = summary(file_id).unwrap();
        assert_eq!((value.explanation.prompt_tokens,value.explanation.completion_tokens),(None,None));
        assert_eq!((value.explanation.requests,value.explanation.transport_retries),(3,1));
        assert!(value.explanation.input_chars > before);
    }

}
