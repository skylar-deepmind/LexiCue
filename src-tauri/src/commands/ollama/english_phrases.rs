use super::{
    ai_client, batch_ranges, cancel_registry, now_ms, AiConfig, ChatFailure, ChatResult,
    CancelGuard, CancellationToken, OllamaAnalysisResult, RetryNotifier, CANCELLED_MESSAGE,
};
use crate::commands::english;
use crate::db::DbState;
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

mod cache;
mod pipeline;
mod diagnostics;
mod parsing;
mod streaming;
mod preview;
use parsing::ParseOutcome;

const PIPELINE_VERSION: i64 = 5;
const CATEGORIES: [&str; 4] = ["phrasal_verb", "idiom", "fixed_expression", "collocation"];

#[derive(Clone)]
struct SegmentRow {
    index: i32,
    text: String,
}

#[derive(Clone, Deserialize, serde::Serialize)]
struct Candidate {
    segment_index: i32,
    canonical: String,
    token_positions: Vec<i32>,
    category: String,
}

#[derive(Clone)]
struct Accepted {
    candidate: Candidate,
    surface: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HighlightRange {
    start: usize,
    end: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewPhrase {
    segment_index: i32,
    canonical: String,
    category: String,
    surface: String,
    token_positions: Vec<i32>,
    ranges: Vec<HighlightRange>,
}

fn preview_phrase(item: &Accepted, segment: &SegmentRow) -> PreviewPhrase {
    let spans = english::tokenize_english_spans(&segment.text);
    PreviewPhrase {
        segment_index: item.candidate.segment_index,
        canonical: item.candidate.canonical.clone(),
        category: item.candidate.category.clone(),
        surface: item.surface.clone(),
        token_positions: item.candidate.token_positions.clone(),
        ranges: spans.into_iter().filter(|span| item.candidate.token_positions.contains(&span.position))
            .map(|span| HighlightRange { start: span.start, end: span.end }).collect(),
    }
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

fn normalized(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

fn key(index: i32, canonical: &str, positions: &[i32]) -> String {
    format!("{index}|{}|{:?}", normalized(canonical), positions)
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

fn emit_progress(app: &AppHandle, file_id: i64, phase: &str, completed: usize, total: usize, status: &str) {
    let percent = if status == "completed" { 100 } else { match phase {
        "extraction" => (completed * 95 / total.max(1)).min(95),
        "saving" => 95,
        _ => 0,
    } };
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

pub(super) fn preview_snapshot(file_id: i64, run_id: &str) -> Option<serde_json::Value> {
    preview::snapshot(file_id,run_id).and_then(|snapshot|serde_json::to_value(snapshot).ok())
}

pub(super) fn raw_diagnostic_report(file_id: i64) -> Option<String> {
    diagnostics::raw_report(file_id)
}

pub(super) fn diagnostic_transport_retry(file_id: i64) { diagnostics::transport_retry(file_id); }

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
        if self.code == "STREAM_INTERRUPTED" { return format!("STREAM_INTERRUPTED: 第 {} 批连接中断，尚未保存；可继续分析",self.batch); }
        format!("{}: {}第 {} 批无法获得有效结果；旧分析已保留", self.code, self.stage, self.batch)
    }
}

fn extraction_prompt(segments: &[SegmentRow]) -> String {
    let input = segments.iter().map(|segment| {
        let tokens = english::tokenize_english_text(&segment.text).iter()
            .map(|(surface, position)| format!("{position}:{surface}"))
            .collect::<Vec<_>>().join(" ");
        format!("[{}] {}\n词位: {}", segment.index, segment.text, tokens)
    }).collect::<Vec<_>>().join("\n");
    format!("从英文学习材料提取值得作为整体学习的习语、短语动词、固定表达和高价值搭配。只选择有约定用法且在本句有学习价值的表达。排除普通临时组合、专名、不能确定词位的表达。每一项必须包含整数 segment_index、标准形式 canonical、原句 token_positions、category。可分离短语动词只列词组本身的词位。其他类别必须是连续词位。category 仅可为 phrasal_verb、idiom、fixed_expression、collocation。宁可遗漏，不要猜测。示例：输入 [12] I picked it up.，输出 {{\"phrases\":[{{\"segment_index\":12,\"canonical\":\"pick up\",\"token_positions\":[1,3],\"category\":\"phrasal_verb\"}}]}}。没有目标词组时返回 {{\"phrases\":[]}}。只返回 JSON。\n{input}")
}

#[cfg(test)]
async fn request_extraction(client: &Client, config: &AiConfig, token: &CancellationToken, notifier: Option<&RetryNotifier>, file_id: i64, batch: usize, segments: &[SegmentRow], allow_retry: bool) -> Result<ParseOutcome<Candidate>, BatchFailure> {
    request_extraction_streaming(client,config,token,notifier,file_id,batch,segments,allow_retry,&streaming::Session::default(),&|_,_| {}).await
}

async fn request_extraction_streaming(client: &Client, config: &AiConfig, token: &CancellationToken, notifier: Option<&RetryNotifier>, file_id: i64, batch: usize, segments: &[SegmentRow], allow_retry: bool, session: &streaming::Session, preview: &pipeline::PreviewCallback<'_>) -> Result<ParseOutcome<Candidate>, BatchFailure> {
    let base_prompt = extraction_prompt(segments);
    let attempts = if allow_retry { 2 } else { 1 };
    for attempt in 0..attempts {
        if token.cancelled() { return Err(BatchFailure { code: "CANCELLED", stage: "提取", batch }); }
        let prompt = if attempt == 0 { base_prompt.clone() } else { format!("{base_prompt}\n上一次回复无效。请严格检查每项都有 segment_index、canonical、token_positions、category；不要输出无法定位的项。") };
        diagnostics::begin_request(file_id, "extraction", &prompt, attempt > 0);
        let started = Instant::now();
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let emit = |operation,items| preview(segments,pipeline::PreviewUpdate {operation,batch_id:batch,attempt_id:attempt_id.clone(),origin:"ai",items});
        emit("begin",Vec::new());
        let parser = std::sync::Mutex::new(parsing::IncrementalCandidates::new(segments));
        let last_activity = std::sync::Mutex::new(None::<Instant>);
        let response = match streaming::chat(client, config, token, notifier, prompt, extraction_schema(),file_id,session,
            |fragment| {
                let items = parser.lock().unwrap().push(fragment);
                if !items.is_empty() { emit("append",pipeline::accepted(segments,&items)); }
            }, || {
                let mut last = last_activity.lock().unwrap();
                if last.is_none_or(|time|time.elapsed().as_secs()>=1) { emit("activity",Vec::new()); *last=Some(Instant::now()); }
            }).await {
            Ok(value) => value,
            Err(_) if token.cancelled() => { emit("rollback",Vec::new()); diagnostics::response_usage(file_id, "extraction", None); return Err(BatchFailure { code: "CANCELLED", stage: "提取", batch }); },
            Err(failure) => {
                emit("rollback",Vec::new());
                diagnostics::response_usage(file_id, "extraction", None);
                record_request_failure(file_id, "extraction", batch, &failure, started.elapsed().as_millis());
                return Err(BatchFailure { code: if failure.kind.starts_with("STREAM_") { "STREAM_INTERRUPTED" } else { "REQUEST_FAILED" }, stage: "提取", batch });
            }
        };
        diagnostics::response_usage(file_id, "extraction", Some(&response));
        if token.cancelled() { emit("rollback",Vec::new()); return Err(BatchFailure {code:"CANCELLED",stage:"提取",batch}); }
        let elapsed = started.elapsed().as_millis();
        if response.finish_reason.as_deref() == Some("length") {
            emit("rollback",Vec::new());
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
                emit("commit",pipeline::accepted(segments,&outcome.items));
                return Ok(outcome);
            }
            Ok(outcome) => {
                emit("rollback",Vec::new());
                let last = attempt + 1 == attempts;
                record_batch(file_id, "extraction", batch, "ALL_ITEMS_INVALID", Some(&response), elapsed, 0, outcome.skipped_count, outcome.missing_fields.iter().cloned().collect(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "ALL_ITEMS_INVALID", stage: "提取", batch }); }
            }
            Err(code) => {
                emit("rollback",Vec::new());
                let last = attempt + 1 == attempts;
                record_batch(file_id, "extraction", batch, &code, Some(&response), elapsed, 0, 0, Vec::new(), last.then_some(response.content.as_str()));
                if last { return Err(BatchFailure { code: "INVALID_JSON", stage: "提取", batch }); }
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
    force_refresh: bool,
    run_id: Option<String>,
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
    let run_id = diagnostics::start_with_id(file_id, &config.provider, &config.model, run_id);
    preview::start(file_id,&run_id);
    let result = analyze_inner(&app, &state, file_id, &config, &token, force_refresh, &run_id).await;
    preview::finish(file_id,&run_id);
    let (completed, total) = preview::counts(file_id, &run_id);
    match &result {
        Ok(_) => {
            diagnostics::finish(file_id, "COMPLETED", "completed");
            emit_progress(&app, file_id, "completed", completed, total, "completed");
        }
        Err(error) => {
            let code = if token.cancelled() { "CANCELLED" }
                else if error.starts_with("EMPTY_REANALYSIS:") { "EMPTY_REANALYSIS" }
                else if error.starts_with("OUTPUT_TRUNCATED:") { "OUTPUT_TRUNCATED" }
                else if error.starts_with("ALL_ITEMS_INVALID:") { "ALL_ITEMS_INVALID" }
                else if error.starts_with("INVALID_JSON:") { "INVALID_JSON" }
                else if error.starts_with("STREAM_INTERRUPTED:") { "STREAM_INTERRUPTED" }
                else if error.starts_with("REQUEST_FAILED:") { "REQUEST_FAILED" }
                else if error.starts_with("SAVE_FAILED:") { "SAVE_FAILED" }
                else { "ANALYSIS_FAILED" };
            diagnostics::finish(file_id, code, "error");
            emit_progress(&app, file_id, "error", completed, total, "error");
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
    force_refresh: bool,
    run_id: &str,
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
    preview::set_total(file_id, run_id, segments.len());
    if segments.is_empty() {
        return Err("英文文件没有可分析的句子".to_string());
    }
    let client = ai_client(std::time::Duration::from_secs(600), &config.base_url)?;
    let notifier = RetryNotifier { app: app.clone(), file_id };
    let pipeline = pipeline::Pipeline {
        client: &client, config, token, notifier: Some(&notifier),
        checkpoints: cache::Checkpoints { conn: &state.conn, file_id, force: force_refresh }
    };
    emit_progress(app, file_id, "extraction", 0, segments.len(), "processing");
    let accepted = pipeline.run_events(&segments, |source,update| {
        let committed = update.operation == "commit";
        if let Some((event,count)) = preview::publish(file_id,run_id,source,update) {
            let _ = app.emit("ollama-analysis-preview",event);
            if committed { emit_progress(app,file_id,"extraction",count,segments.len(),"processing"); }
        }
    }).await?;
    if token.cancelled() { return Err(CANCELLED_MESSAGE.to_string()); }
    if accepted.is_empty() {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let previous_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM phrase_occurrences po JOIN segments s ON s.id=po.segment_id WHERE s.file_id=?1",
            [file_id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if previous_count > 0 {
            return Err("EMPTY_REANALYSIS: 没有提取到词组，旧分析已保留".into());
        }
    }
    emit_progress(app, file_id, "saving", segments.len(), segments.len(), "processing");
    save_results(state, file_id, config, &accepted).map_err(|error| {
        record_batch(file_id, "saving", 0, "SAVE_FAILED", None, 0, 0, 0, Vec::new(), None);
        format!("SAVE_FAILED: {error}")
    })
}

fn save_results(state: &State<'_, DbState>, file_id: i64, config: &AiConfig, accepted: &[Accepted]) -> Result<OllamaAnalysisResult, String> {
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    let skipped_items = diagnostics::summary(file_id).map(|summary| summary.total_skipped as i64).unwrap_or(0);
    save_results_on_connection(&conn, file_id, config, accepted, skipped_items)
}

fn save_results_on_connection(conn: &Connection, file_id: i64, config: &AiConfig, accepted: &[Accepted], skipped_items: i64) -> Result<OllamaAnalysisResult, String> {
    conn.execute("BEGIN IMMEDIATE", []).map_err(|error| error.to_string())?;
    let result = (|| {
        let old = {
            let mut stmt = conn.prepare("SELECT po.id,p.text,s.index_num,po.position,po.token_positions_json FROM phrase_occurrences po JOIN phrases p ON p.id=po.phrase_id JOIN segments s ON s.id=po.segment_id WHERE s.file_id=?1")
                .map_err(|error| error.to_string())?;
            let rows = stmt.query_map([file_id], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?,row.get::<_,i32>(2)?,row.get::<_,i32>(3)?,row.get::<_,Option<String>>(4)?)))
                .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
            rows
        };
        let old_map: HashMap<(String,i32,String), i64> = old.into_iter().map(|(id,text,index,position,positions)| {
            // Legacy occurrences have no token list; match their original start.
            ((text,index,positions.unwrap_or_else(|| format!("[{position}]"))),id)
        }).collect();
        let mut retained = HashSet::new();
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
            if let Some(previous) = previous.filter(|previous| retained.insert(**previous)) {
                // Updating locating fields preserves all legacy context fields, edits and ID.
                conn.execute("UPDATE phrase_occurrences SET position=?2,surface_text=?3,token_positions_json=?4 WHERE id=?1",
                    params![previous, position, item.surface, positions_json]).map_err(|e| e.to_string())?;
            } else {
                conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,surface_text,token_positions_json) VALUES(?1,?2,?3,?4,?5)",
                    params![phrase_id,segment_id,position,item.surface,positions_json]).map_err(|e| e.to_string())?;
                retained.insert(conn.last_insert_rowid());
            }
            if unique.insert(text.clone()) {
                conn.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,category,provider,updated_at) VALUES('en',?1,'',?2,?3,?4) ON CONFLICT(language,text) DO UPDATE SET category=excluded.category",
                    params![text,item.candidate.category,config.model,now_ms()]).map_err(|e| e.to_string())?;
            }
        }
        let mut stmt = conn.prepare("SELECT po.id FROM phrase_occurrences po JOIN segments s ON s.id=po.segment_id JOIN phrases p ON p.id=po.phrase_id WHERE s.file_id=?1 AND po.hidden=0 AND po.meaning_edited=0 AND po.meaning_en_edited=0 AND p.source='detected'").map_err(|e| e.to_string())?;
        let removable = stmt.query_map([file_id], |row| row.get::<_,i64>(0)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        for id in removable {
            if !retained.contains(&id) { conn.execute("DELETE FROM phrase_occurrences WHERE id=?1", [id]).map_err(|e| e.to_string())?; }
        }
        conn.execute("DELETE FROM phrases WHERE language='en' AND source='detected' AND status='unprocessed' AND definition IS NULL AND NOT EXISTS(SELECT 1 FROM phrase_occurrences po WHERE po.phrase_id=phrases.id) AND NOT EXISTS(SELECT 1 FROM phrase_reviews pr WHERE pr.phrase_id=phrases.id)", []).map_err(|error| error.to_string())?;
        conn.execute("INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version,collins_evidence_available,skipped_items) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(file_id) DO UPDATE SET model=excluded.model,completed_at=excluded.completed_at,pipeline_version=excluded.pipeline_version,collins_evidence_available=excluded.collins_evidence_available,skipped_items=excluded.skipped_items", params![file_id,config.model,now_ms(),PIPELINE_VERSION,0,skipped_items]).map_err(|error| error.to_string())?;
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

    pub(super) fn mock_deepseek(replies: &[(&str, &str)]) -> (AiConfig, std::thread::JoinHandle<Vec<serde_json::Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let responses: Vec<String> = replies.iter().enumerate().map(|(index, (content, finish_reason))| {
            serde_json::json!({
                "id": format!("test-request-{index}"),
                "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20}
            }).to_string()
        }).collect();
        listener.set_nonblocking(true).unwrap();
        let handle = std::thread::spawn(move || {
            let mut captured = Vec::new();
            for body in responses {
                let deadline = Instant::now() + std::time::Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(10)),
                        Err(error) => panic!("mock request missing: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
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
                    if request.len() >= header_end + 4 + content_length {
                        captured.push(serde_json::from_slice(&request[header_end+4..header_end+4+content_length]).unwrap());
                        break;
                    }
                }
                let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                stream.write_all(header.as_bytes()).unwrap();
                stream.write_all(body.as_bytes()).unwrap();
            }
            captured
        });
        (AiConfig { provider: "openai".into(), base_url: format!("http://{address}"), model: "deepseek-chat".into(), api_key: Some("TEST_API_KEY_NEVER_LOG".into()) }, handle)
    }

    #[test]
    fn ollama_usage_is_optional_and_deserialized_when_available() {
        let response: super::super::ChatResponse = serde_json::from_value(serde_json::json!({
            "message":{"content":"{}"},"done_reason":"stop","prompt_eval_count":12,"eval_count":34
        })).unwrap();
        assert_eq!((response.prompt_eval_count,response.eval_count),(Some(12),Some(34)));
        let absent: super::super::ChatResponse = serde_json::from_value(serde_json::json!({"message":{"content":"{}"}})).unwrap();
        assert_eq!((absent.prompt_eval_count,absent.eval_count),(None,None));
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
        let accepted = Accepted { candidate: Candidate { segment_index: 0, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into() };
        save_results_on_connection(&conn, file_id, &config, &[accepted], 0).unwrap();
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

        let invalid = Accepted { candidate: Candidate { segment_index: 99, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into() };
        assert!(save_results_on_connection(&conn, file_id, &config, &[invalid], 0).is_err());
        let meaning: String = conn.query_row("SELECT meaning_zh FROM phrase_occurrences WHERE phrase_id=?1", [phrase_id], |row| row.get(0)).unwrap();
        assert_eq!(meaning, "我的修订");
    }

    #[test]
    fn reanalysis_preserves_unedited_legacy_explanations_and_occurrence_identity() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("legacy.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at) VALUES('a','txt','text','h',1)", []).unwrap();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,'I picked it up.')", []).unwrap();
        conn.execute("INSERT INTO phrases(language,text,source) VALUES('en','pick up','detected'),('en','take off','detected')", []).unwrap();
        // Null token positions exercise the legacy start-position fallback.
        conn.execute("INSERT INTO phrase_occurrences(id,phrase_id,segment_id,position,meaning_zh,usage_zh,meaning_en,usage_en,collins_sense_id) VALUES(41,1,1,1,'旧释义','旧用法','old meaning','old usage',17),(42,2,1,0,NULL,NULL,NULL,NULL,NULL)", []).unwrap();
        conn.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,meaning_en,provider,updated_at,other_senses_json) VALUES('en','pick up','旧翻译','old definition','old model',1,'[{\"meaning_zh\":\"旧含义\",\"example_en\":\"Pick it up.\"}]')", []).unwrap();
        let config = AiConfig { provider: "ollama".into(), base_url: "http://localhost".into(), model: "new".into(), api_key: None };
        let accepted = Accepted { candidate: Candidate { segment_index: 0, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into() };
        save_results_on_connection(&conn, 1, &config, &[accepted], 0).unwrap();
        let old: (i64,String,String,i64,String) = conn.query_row("SELECT id,meaning_zh,meaning_en,collins_sense_id,token_positions_json FROM phrase_occurrences", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
        assert_eq!(old, (41,"旧释义".into(),"old meaning".into(),17,"[1,3]".into()));
        let dictionary: (String,String,String) = conn.query_row("SELECT translation,provider,other_senses_json FROM phrase_dictionary_entries WHERE text='pick up'", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(dictionary.0, "旧翻译");
        assert_eq!(dictionary.1, "old model");
        assert!(dictionary.2.contains("旧含义"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM phrases WHERE text='take off'", [], |r| r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn extraction_saves_no_meanings_and_is_visible_without_a_dictionary_sense() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("extraction.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at) VALUES('demo.txt','txt','I picked it up.','hash',1)", []).unwrap();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,'I picked it up.')", []).unwrap();
        let config = AiConfig { provider: "ollama".into(), base_url: "http://localhost".into(), model: "test".into(), api_key: None };
        let accepted = Accepted { candidate: Candidate { segment_index: 0, canonical: "pick up".into(), token_positions: vec![1,3], category: "phrasal_verb".into() }, surface: "picked up".into() };
        save_results_on_connection(&conn, 1, &config, &[accepted], 7).unwrap();
        let fields: (Option<String>,Option<String>,Option<i64>) = conn.query_row("SELECT meaning_zh,meaning_en,collins_sense_id FROM phrase_occurrences", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(fields, (None,None,None));
        conn.execute("UPDATE file_phrase_analysis SET collins_evidence_available=1", []).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM study_phrase_occurrences", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
        assert_eq!(conn.query_row("SELECT translation FROM phrase_dictionary_entries", [], |r| r.get::<_,String>(0)).unwrap(), "");
    }
}

/// Explicit local-model smoke check; no database, cache, or learning records are used.
#[cfg(test)]
mod gemma_model_smoke {
    use super::*;
    use std::sync::Mutex;

    #[tokio::test]
    #[ignore = "requires the explicitly downloaded local Gemma 4 12B model"]
    async fn gemma4_local_streaming_smoke() {
        let config = AiConfig { provider: "ollama".into(), base_url: "http://localhost:11434".into(), model: "gemma4:12b-it-q4_K_M".into(), api_key: None };
        let client = ai_client(std::time::Duration::from_secs(600), &config.base_url).unwrap();
        let loading_started = Instant::now();
        let loaded: serde_json::Value = client.post("http://localhost:11434/api/chat")
            .json(&serde_json::json!({"model":config.model,"messages":[],"stream":false}))
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        let loading_request_ms = loading_started.elapsed().as_millis();
        let segments: Vec<_> = ["I picked it up.", "She ran into an old friend.", "We need to break the ice."]
            .into_iter().enumerate().map(|(index, text)| SegmentRow { index: index as i32, text: text.into() }).collect();
        let file_id = -40_004;
        diagnostics::start(file_id, &config.provider, &config.model);
        let started = Instant::now();
        let first = Mutex::new(None);
        let phases = Mutex::new(Vec::new());
        let result = request_extraction_streaming(&client, &config, &CancellationToken::default(), None, file_id, 1, &segments, false, &streaming::Session::default(), &|_, update| {
            if update.operation == "append" && !update.items.is_empty() {
                let mut time = first.lock().unwrap();
                if time.is_none() { *time = Some(started.elapsed().as_millis()); }
            }
            phases.lock().unwrap().push(update.operation);
        }).await;
        let outcome = result.unwrap_or_else(|error| panic!("{}", error.code));
        let accepted = pipeline::accepted(&segments, &outcome.items);
        assert!(!accepted.is_empty(), "the fixed phrases must produce a locally validated result");
        let phrases: Vec<_> = accepted.iter().map(|item| preview_phrase(item, &segments[item.candidate.segment_index as usize])).collect();
        let pick = phrases.iter().find(|phrase| phrase.canonical == "pick up").expect("separated pick up must be recognized");
        let highlighted: Vec<_> = pick.ranges.iter().map(|range| String::from_utf16(&segments[0].text.encode_utf16().skip(range.start).take(range.end-range.start).collect::<Vec<_>>()).unwrap()).collect();
        assert_eq!(highlighted, ["picked", "up"]);
        assert!(phases.lock().unwrap().contains(&"commit"));
        assert!(first.lock().unwrap().is_some());
        println!("GEMMA_SMOKE_REPORT={}", serde_json::json!({
            "loadingRequestMs":loading_request_ms,
            "loadMs":loaded.get("load_duration").and_then(serde_json::Value::as_u64).map(|ns| ns / 1_000_000),
            "firstValidPreviewMs":*first.lock().unwrap(), "totalExtractionMs":started.elapsed().as_millis(),
            "phrases":phrases, "diagnostic":diagnostic_summary(file_id), "writesLearningData":false,
            "loadingRequests":1
        }));
    }
}
