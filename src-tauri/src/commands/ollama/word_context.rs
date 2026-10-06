use super::{ai_client, chat, parse_ai_json, AiConfig, CancellationToken};
use crate::commands::{collins, english};
use crate::db::DbState;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, State};

static WORD_CANCELLATIONS: OnceLock<Mutex<HashMap<i64, CancellationToken>>> = OnceLock::new();

fn cancellations() -> &'static Mutex<HashMap<i64, CancellationToken>> {
    WORD_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct AnalysisGuard(i64, CancellationToken);

impl Drop for AnalysisGuard {
    fn drop(&mut self) {
        if let Ok(mut values) = cancellations().lock() {
            if values.get(&self.0).is_some_and(|current| std::sync::Arc::ptr_eq(&current.0, &self.1.0)) { values.remove(&self.0); }
        }
    }
}

#[derive(Deserialize)]
struct AiMeaning {
    meaning_zh: String,
    usage_zh: String,
    #[serde(default)]
    collins_sense_id: Option<i64>,
}

#[derive(Serialize)]
pub struct WordOccurrenceMeaning {
    pub occurrence_id: i64,
    pub meaning_zh: String,
    pub usage_zh: String,
    pub collins_sense_id: Option<i64>,
    pub dictionary_verified: bool,
    pub analysis_model: String,
    pub analyzed_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

fn validate_meaning(parsed: AiMeaning, allowed: &[i64]) -> Result<(String, String, Option<i64>), String> {
    let meaning = parsed.meaning_zh.trim().to_string();
    let usage = parsed.usage_zh.trim().to_string();
    if meaning.is_empty() || usage.is_empty() { return Err("AI 未返回可用的本句释义".into()); }
    let sense = parsed.collins_sense_id.filter(|id| allowed.contains(id));
    Ok((meaning, usage, sense))
}

fn local_meaning_prompt(lemma: &str, original: &str, sentence: &str, before: &str, after: &str, evidence: &str) -> String {
    format!("只分析所选单词在目标句中的意思。meaning_zh 是简短中文本句释义，不要罗列其他词义；usage_zh 是中文用法说明，不要复制目标句。如果 Collins 候选的定义与本句含义相符，collins_sense_id 必须选择对应编号；仅没有匹配的候选时返回 null。候选定义可以是英文，解释始终使用中文。\n单词: {lemma}\n原文词形: {original}\n上句: {before}\n目标句: {sentence}\n下句: {after}\nCollins 候选:\n{evidence}")
}

fn meaning_schema(allowed: &[i64], local: bool) -> serde_json::Value {
    let mut schema = serde_json::json!({"type":"object", "properties": {"meaning_zh":{"type":"string","minLength":1},"usage_zh":{"type":"string","minLength":1},"collins_sense_id":{"type":["integer","null"],"enum": allowed.iter().map(|id| serde_json::json!(id)).chain(std::iter::once(serde_json::Value::Null)).collect::<Vec<_>>() }}, "required":["meaning_zh","usage_zh","collins_sense_id"],"additionalProperties":false});
    if local { for field in ["meaning_zh","usage_zh"] { schema["properties"][field]["pattern"] = serde_json::json!("[一-鿿]"); } }
    schema
}

#[tauri::command]
pub async fn analyze_word_occurrence(
    app: AppHandle,
    state: State<'_, DbState>,
    occurrence_id: i64,
    config: AiConfig,
) -> Result<WordOccurrenceMeaning, String> {
    let _activity_guard = super::models::generation_guard(&config, &app)?;
    let token = CancellationToken::default();
    {
        let mut values = cancellations().lock().map_err(|error| error.to_string())?;
        if let Some(previous) = values.insert(occurrence_id, token.clone()) {
            previous.cancel();
        }
    }
    let _guard = AnalysisGuard(occurrence_id, token.clone());
    let (lemma, original, sentence, before, after, edited, old_meaning, old_usage, old_sense) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT w.lemma,o.original_form,s.en_text,
                    (SELECT en_text FROM segments WHERE file_id=s.file_id AND index_num=s.index_num-1),
                    (SELECT en_text FROM segments WHERE file_id=s.file_id AND index_num=s.index_num+1),
                    o.meaning_edited,o.meaning_zh,o.usage_zh,o.collins_sense_id
             FROM occurrences o JOIN words w ON w.id=o.word_id JOIN segments s ON s.id=o.segment_id WHERE o.id=?1",
            [occurrence_id],
            |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,Option<String>>(3)?,row.get::<_,Option<String>>(4)?,row.get::<_,i64>(5)? != 0,row.get::<_,Option<String>>(6)?,row.get::<_,Option<String>>(7)?,row.get::<_,Option<i64>>(8)?)),
        ).map_err(|e| e.to_string())?
    };
    if edited {
        return Ok(WordOccurrenceMeaning { occurrence_id, meaning_zh: old_meaning.unwrap_or_default(), usage_zh: old_usage.unwrap_or_default(), collins_sense_id: old_sense, dictionary_verified: old_sense.is_some(), analysis_model: "user".into(), analyzed_at: now_ms() });
    }

    let mut senses = Vec::new();
    if let Ok(path) = collins::index_path(&app) {
        let mut heads = vec![lemma.clone(), original.to_lowercase()];
        heads.extend(english::lemma_candidates(&original).into_iter().map(|v| v.0));
        heads.extend(english::spelling_variants(&lemma));
        heads.sort(); heads.dedup();
        for head in heads {
            let found = collins::lookup_word(&path, &head)?;
            if !found.is_empty() { senses = found; break; }
        }
    }
    let allowed: Vec<i64> = senses.iter().map(|sense| sense.id).collect();
    let evidence = senses.iter().map(|sense| format!("{}: [{}] {} 示例: {}", sense.id, sense.grammar, sense.definition, sense.example.as_deref().unwrap_or("无"))).collect::<Vec<_>>().join("\n");
    let prompt = format!(
        "只分析所选单词在目标句中的意思。相邻句只用于补足上下文。返回自然、简洁的中文本句义 meaning_zh 和用法说明 usage_zh。只有确实对应下列 Collins 义项时才填写 collins_sense_id，否则为 null。不得编造编号。只返回 JSON，例如 {{\"meaning_zh\":\"报名参加\",\"usage_zh\":\"此处作不及物动词\",\"collins_sense_id\":123}}。\n单词资料拼写: {lemma}\n原文词形: {original}\n上句: {}\n目标句: {sentence}\n下句: {}\nCollins 候选:\n{}",
        before.as_deref().unwrap_or("无"), after.as_deref().unwrap_or("无"), if evidence.is_empty() { "无" } else { &evidence });
    let prompt = if config.is_gemma() { local_meaning_prompt(&lemma, &original, &sentence, before.as_deref().unwrap_or(""), after.as_deref().unwrap_or(""), &evidence) } else { prompt };
    let client = ai_client(std::time::Duration::from_secs(90), &config.base_url)?;
    let content = chat(&client, &config, &token, None, prompt, meaning_schema(&allowed,config.is_gemma())).await?;
    let parsed: AiMeaning = parse_ai_json(&content).map_err(|e| format!("AI 本句释义 JSON 无效：{e}"))?;
    let (meaning, usage, sense) = validate_meaning(parsed, &allowed)?;
    if token.cancelled() { return Err(super::CANCELLED_MESSAGE.to_string()); }
    let timestamp = now_ms();
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE occurrences SET meaning_zh=?1,usage_zh=?2,collins_sense_id=?3,analysis_model=?4,analyzed_at=?5 WHERE id=?6 AND meaning_edited=0",
            params![meaning,usage,sense,config.model,timestamp,occurrence_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(WordOccurrenceMeaning { occurrence_id, meaning_zh: meaning, usage_zh: usage, collins_sense_id: sense, dictionary_verified: sense.is_some(), analysis_model: config.model, analyzed_at: timestamp })
}

#[tauri::command]
pub fn cancel_word_occurrence_analysis(occurrence_id: i64) -> Result<(), String> {
    if let Some(token) = cancellations().lock().map_err(|error| error.to_string())?.get(&occurrence_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
pub(super) async fn native_smoke(model: &str) -> Result<(), String> {
    let prompt = local_meaning_prompt("bank", "bank", "She deposited money at the bank.", "", "", "12: [noun] a financial institution that holds money");
    let generated = crate::commands::gemma::runtime::chat(model, prompt, meaning_schema(&[12],true), &CancellationToken::default(), |_| {}, || {}).await.map_err(|error| error.message)?;
    let parsed: AiMeaning = parse_ai_json(&generated.content)?;
    let (meaning, usage, sense) = validate_meaning(parsed, &[12])?;
    if !meaning.contains("银行") || sense != Some(12) || usage.contains("She deposited") || !usage.chars().any(|c| ('一'..='鿿').contains(&c)) { return Err(generated.content); }
    println!("WORD_MEANING={}", generated.content);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_required_text_and_never_accepts_an_unknown_dictionary_id() {
        let valid = validate_meaning(AiMeaning { meaning_zh: "报名".into(), usage_zh: "此处作动词".into(), collins_sense_id: Some(99) }, &[12]).unwrap();
        assert_eq!(valid.2, None);
        assert!(validate_meaning(AiMeaning { meaning_zh: " ".into(), usage_zh: "说明".into(), collins_sense_id: Some(12) }, &[12]).is_err());
    }

    #[test]
    fn cancellation_token_is_scoped_to_the_occurrence() {
        let token = CancellationToken::default();
        cancellations().lock().unwrap().insert(-9001, token.clone());
        cancel_word_occurrence_analysis(-9001).unwrap();
        assert!(token.cancelled());
        cancellations().lock().unwrap().remove(&-9001);
    }

    #[test]
    fn finishing_a_replaced_request_cannot_remove_the_new_cancellation_token() {
        let old = CancellationToken::default(); let new = CancellationToken::default();
        cancellations().lock().unwrap().insert(-9002,new.clone());
        drop(AnalysisGuard(-9002,old));
        cancel_word_occurrence_analysis(-9002).unwrap();
        assert!(new.cancelled());
        cancellations().lock().unwrap().remove(&-9002);
    }
}
