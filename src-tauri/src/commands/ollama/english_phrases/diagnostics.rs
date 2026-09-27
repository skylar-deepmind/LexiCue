use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::super::now_ms;

const RAW_TTL_MS: i64 = 15 * 60 * 1000;
const RAW_MAX_BYTES: usize = 64 * 1024;
const MAX_RECORDS: usize = 100;

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

pub(super) fn start(file_id: i64, provider: &str, model: &str) -> String {
    let run_id = uuid::Uuid::new_v4().simple().to_string();
    let summary = DiagnosticSummary {
        run_id: run_id.clone(), file_id, stage: "starting".into(), status: "processing".into(), batch: 0,
        code: "STARTED".into(), error_kind: None, http_status: None,
        provider: provider.into(), model: model.into(),
        request_id: None, finish_reason: None, duration_ms: 0,
        prompt_tokens: None, completion_tokens: None,
        valid_count: 0, skipped_count: 0, total_skipped: 0,
        missing_fields: Vec::new(), raw_available: false, occurred_at: now_ms(),
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
}
