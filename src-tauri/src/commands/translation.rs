//! Keyless web translation. Small adjacent batches share context; ambiguous
//! line alignment falls back to individual requests. Never guess sentence IDs.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";
const MAX_BATCH_CHARS: usize = 1400;
const CACHE_TTL: u64 = 30 * 24 * 3600;
const CACHE_LIMIT: u64 = 20 * 1024 * 1024;
static JOBS: OnceLock<Mutex<HashMap<i64, Arc<AtomicBool>>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<i64, Arc<AtomicBool>>> {
    JOBS.get_or_init(Default::default)
}
struct Guard(i64);
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut map) = jobs().lock() {
            map.remove(&self.0);
        }
    }
}

#[derive(Clone, Deserialize)]
pub struct Sentence {
    pub index: i32,
    pub text: String,
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct Translation {
    pub index: i32,
    pub translation: String,
}
#[derive(Serialize)]
pub struct TranslationResult {
    pub translations: Vec<Translation>,
    pub error: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Cached {
    created: u64,
    translations: Vec<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn key(batch: &[Sentence]) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&batch.iter().map(|s| &s.text).collect::<Vec<_>>()).unwrap()
        )
    )
}
fn cached(dir: &Path, batch: &[Sentence]) -> Option<Vec<String>> {
    let data = std::fs::read(dir.join(format!("{}.json", key(batch)))).ok()?;
    let item: Cached = serde_json::from_slice(&data).ok()?;
    (now().saturating_sub(item.created) < CACHE_TTL
        && item.translations.len() == batch.len()
        && item.translations.iter().all(|s| !s.trim().is_empty()))
    .then_some(item.translations)
}
fn save(dir: &Path, batch: &[Sentence], translations: &[String]) {
    let _ = std::fs::create_dir_all(dir);
    let item = Cached {
        created: now(),
        translations: translations.to_vec(),
    };
    if let Ok(data) = serde_json::to_vec(&item) {
        let _ = std::fs::write(dir.join(format!("{}.json", key(batch))), data);
    }
}
fn prune(dir: &Path) {
    let mut files = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            (meta.is_file() && entry.path().extension().is_some_and(|ext| ext == "json"))
                .then_some((entry.path(), meta.len(), meta.modified().ok()?))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|(_, _, modified)| *modified);
    let mut size: u64 = files.iter().map(|(_, len, _)| len).sum();
    for (path, len, modified) in files {
        if size > CACHE_LIMIT || modified.elapsed().unwrap_or_default().as_secs() > CACHE_TTL {
            if std::fs::remove_file(path).is_ok() {
                size = size.saturating_sub(len);
            }
        }
    }
}
fn ranges(sentences: &[Sentence]) -> Vec<std::ops::Range<usize>> {
    let mut result = Vec::new();
    let mut start = 0;
    while start < sentences.len() {
        let mut end = start;
        let mut chars = 0;
        while end < sentences.len() && end - start < 8 {
            let len = sentences[end].text.chars().count() + 1;
            if end > start && chars + len > MAX_BATCH_CHARS {
                break;
            }
            chars += len;
            end += 1;
        }
        result.push(start..end);
        start = end;
    }
    result
}
fn align(value: &serde_json::Value, batch: &[Sentence]) -> Option<Vec<String>> {
    let sentences = value["sentences"].as_array()?;
    let original = sentences
        .iter()
        .map(|s| s["orig"].as_str())
        .collect::<Option<Vec<_>>>()?
        .join("");
    let expected = batch
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let compact = |s: &str| s.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    if compact(&original) != compact(&expected) {
        return None;
    }
    let translated = sentences
        .iter()
        .map(|s| s["trans"].as_str())
        .collect::<Option<Vec<_>>>()?
        .join("");
    if batch.len() == 1 {
        return (!translated.trim().is_empty()).then(|| vec![translated.trim().to_owned()]);
    }
    let lines = translated
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    // Also verify source line boundaries, not only a coincidental output count.
    let originals = original
        .lines()
        .map(compact)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    (lines.len() == batch.len()
        && originals == batch.iter().map(|s| compact(&s.text)).collect::<Vec<_>>())
    .then_some(lines)
}
async fn request(
    client: &reqwest::Client,
    endpoint: &str,
    batch: &[Sentence],
) -> Result<Option<Vec<String>>, String> {
    let text = batch
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let response = client
        .get(endpoint)
        .query(&[
            ("client", "gtx"),
            ("sl", "en"),
            ("tl", "zh-CN"),
            ("dt", "t"),
            ("dj", "1"),
            ("q", text.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "translation_network")?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 429 {
            "translation_rate_limited"
        } else {
            "translation_unavailable"
        }
        .into());
    }
    let value = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "translation_unavailable")?;
    Ok(align(&value, batch))
}
async fn wait_cancel(token: &AtomicBool) {
    while !token.load(Ordering::Relaxed) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}
async fn translate_batch(
    client: &reqwest::Client,
    endpoint: &str,
    batch: &[Sentence],
    dir: &Path,
) -> Result<Vec<String>, String> {
    if let Some(result) = cached(dir, batch) {
        return Ok(result);
    }
    let result = if let Some(result) = request(client, endpoint, batch).await? {
        result
    } else {
        let mut singles = Vec::new();
        for sentence in batch {
            let single = std::slice::from_ref(sentence);
            let translated = if let Some(result) = cached(dir, single) {
                result
            } else {
                request(client, endpoint, single)
                    .await?
                    .ok_or("translation_alignment")?
            };
            save(dir, single, &translated);
            singles.extend(translated);
        }
        singles
    };
    save(dir, batch, &result);
    Ok(result)
}

#[tauri::command]
pub async fn translate_import_sentences(
    app: AppHandle,
    job_id: i64,
    sentences: Vec<Sentence>,
) -> Result<TranslationResult, String> {
    let mut seen = HashSet::new();
    if sentences.len() > 100_000
        || sentences.iter().any(|s| {
            s.index < 0
                || !seen.insert(s.index)
                || s.text.trim().is_empty()
                || s.text.chars().count() > MAX_BATCH_CHARS
                || s.text.contains(['\r', '\n'])
        })
    {
        return Err("translation_invalid_input".into());
    }
    let token = jobs()
        .lock()
        .map_err(|_| "translation_unavailable")?
        .entry(job_id)
        .or_default()
        .clone();
    let _guard = Guard(job_id);
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "translation_unavailable")?
        .join("import-translations-v1");
    prune(&dir);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent("LexiCue/0.4.5")
        .build()
        .map_err(|_| "translation_unavailable")?;
    let mut translations = Vec::new();
    let mut error = None;
    for range in ranges(&sentences) {
        if token.load(Ordering::Relaxed) {
            return Err("material_cancelled".into());
        }
        let batch = &sentences[range];
        let result = tokio::select! {
            _ = wait_cancel(&token) => return Err("material_cancelled".into()),
            result = translate_batch(&client, ENDPOINT, batch, &dir) => result,
        };
        match result {
            Ok(result) => {
                translations.extend(
                    batch
                        .iter()
                        .zip(result)
                        .map(|(s, translation)| Translation {
                            index: s.index,
                            translation,
                        }),
                )
            }
            Err(reason) => {
                error = Some(reason);
                break;
            } // No retry storms on blocked/limited services.
        }
        let _ = app.emit("import-translation-progress", serde_json::json!({ "jobId": job_id, "done": translations.len(), "total": sentences.len() }));
    }
    Ok(TranslationResult {
        translations,
        error,
    })
}

#[tauri::command]
pub fn cancel_import_translation(job_id: i64) {
    if let Ok(mut map) = jobs().lock() {
        // Preserve an early cancel arriving before the async command starts.
        if map.len() > 512 {
            map.retain(|_, token| !token.load(Ordering::Relaxed));
        }
        map.entry(job_id)
            .or_default()
            .store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sentence(index: i32, text: &str) -> Sentence {
        Sentence {
            index,
            text: text.into(),
        }
    }
    #[test]
    fn verifies_source_and_translation_alignment() {
        let batch = vec![
            sentence(7, "She bought a book."),
            sentence(9, "She read it."),
        ];
        let value = serde_json::json!({"sentences":[{"orig":"She bought a book.\n", "trans":"她买了一本书。\n"},{"orig":"She read it.","trans":"她读了它。"}]});
        assert_eq!(
            align(&value, &batch),
            Some(vec!["她买了一本书。".into(), "她读了它。".into()])
        );
        assert_eq!(
            align(
                &serde_json::json!({"sentences":[{"orig":"She bought a book. She read it.","trans":"她买了一本书。\n她读了它。"}]}),
                &batch
            ),
            None
        );
        assert_eq!(
            align(
                &serde_json::json!({"sentences":[{"orig":"Wrong source", "trans":"错误"}]}),
                &batch
            ),
            None
        );
    }
    #[test]
    fn bounds_batches_and_caches_with_context_not_ids() {
        let batch = (0..20)
            .map(|i| sentence(i, &"word ".repeat(40)))
            .collect::<Vec<_>>();
        for range in ranges(&batch) {
            assert!(range.len() <= 8);
            assert!(
                batch[range].iter().map(|s| s.text.len() + 1).sum::<usize>() <= MAX_BATCH_CHARS
            );
        }
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &batch[..2], &["甲".into(), "乙".into()]);
        let same = vec![sentence(91, &batch[0].text), sentence(92, &batch[1].text)];
        assert_eq!(
            cached(dir.path(), &same),
            Some(vec!["甲".into(), "乙".into()])
        );
        assert!(cached(dir.path(), &batch[..1]).is_none());
    }
    fn server(
        responses: Vec<(u16, serde_json::Value)>,
    ) -> (String, std::thread::JoinHandle<usize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut count = 0;
            for (status, body) in responses {
                let deadline = std::time::Instant::now() + Duration::from_secs(3);
                let mut socket = loop {
                    if let Ok((socket, _)) = listener.accept() {
                        break socket;
                    }
                    assert!(
                        std::time::Instant::now() < deadline,
                        "missing expected translation request"
                    );
                    std::thread::sleep(Duration::from_millis(5));
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 8192];
                socket.read(&mut bytes).unwrap();
                let body = body.to_string();
                write!(socket, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                count += 1;
            }
            count
        });
        (endpoint, handle)
    }
    #[tokio::test]
    async fn falls_back_when_lines_merge_then_reuses_disk_cache_without_network() {
        let (endpoint, server) = server(vec![
            (
                200,
                serde_json::json!({"sentences":[{"orig":"First.\nSecond.","trans":"合并成了一行。"}]}),
            ),
            (
                200,
                serde_json::json!({"sentences":[{"orig":"First.","trans":"第一句。"}]}),
            ),
            (
                200,
                serde_json::json!({"sentences":[{"orig":"Second.","trans":"第二句。"}]}),
            ),
        ]);
        let batch = vec![sentence(5, "First."), sentence(9, "Second.")];
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let translated = translate_batch(&client, &endpoint, &batch, dir.path())
            .await
            .unwrap();
        assert_eq!(translated, vec!["第一句。", "第二句。"]);
        assert_eq!(server.join().unwrap(), 3);
        assert_eq!(
            translate_batch(&client, &endpoint, &batch, dir.path())
                .await
                .unwrap(),
            translated
        );
    }
    #[tokio::test]
    async fn a_rate_limit_stops_without_splitting_or_retrying() {
        let (endpoint, server) = server(vec![(429, serde_json::json!({}))]);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            translate_batch(
                &client,
                &endpoint,
                &[sentence(0, "First."), sentence(1, "Second.")],
                dir.path()
            )
            .await
            .unwrap_err(),
            "translation_rate_limited"
        );
        assert_eq!(server.join().unwrap(), 1);
    }
    #[tokio::test]
    #[ignore = "uses the public Google Translate web endpoint"]
    async fn real_google_translation_smoke() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap();
        let batch = vec![
            sentence(0, "She bought a book."),
            sentence(1, "She read it yesterday."),
        ];
        let dir = tempfile::tempdir().unwrap();
        let result = translate_batch(&client, ENDPOINT, &batch, dir.path())
            .await
            .unwrap();
        assert_eq!(result.len(), 2);
        println!("{result:?}");
    }
}
