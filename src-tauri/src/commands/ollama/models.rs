//! Local model discovery and cancellable pulls. No learning data is written here.
use super::{CancellationToken, CANCELLED_MESSAGE};
use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalActivity {
    generations: usize,
    pulling: bool,
    deleting: bool,
    sequence: u64,
}
static ACTIVITY: OnceLock<Mutex<LocalActivity>> = OnceLock::new();
fn activity() -> &'static Mutex<LocalActivity> {
    ACTIVITY.get_or_init(|| Mutex::new(LocalActivity::default()))
}
#[tauri::command]
pub fn get_local_ollama_activity() -> LocalActivity {
    activity().lock().map(|value| *value).unwrap_or_default()
}
#[derive(Clone, Copy)]
enum Operation { Generate, Pull, Delete }
pub(super) struct ActivityGuard { kind: Operation, app: AppHandle }
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        if let Ok(mut value) = activity().lock() {
            match self.kind {
                Operation::Generate => value.generations = value.generations.saturating_sub(1),
                Operation::Pull => value.pulling = false,
                Operation::Delete => value.deleting = false,
            }
            value.sequence += 1;
            let _ = self.app.emit("ollama-local-activity", *value);
        }
    }
}
fn enter_operation(kind: Operation, app: &AppHandle) -> Result<ActivityGuard, String> {
    let mut value = activity().lock().map_err(|_| "ERR_MODEL_BUSY")?;
    acquire_activity(&mut value, kind)?;
    let _ = app.emit("ollama-local-activity", *value);
    Ok(ActivityGuard { kind, app: app.clone() })
}
fn acquire_activity(value: &mut LocalActivity, kind: Operation) -> Result<(), String> {
    if value.deleting || matches!(kind, Operation::Delete) && (value.generations > 0 || value.pulling)
        || matches!(kind, Operation::Pull) && value.pulling {
        return Err("ERR_MODEL_BUSY".into());
    }
    match kind {
        Operation::Generate => value.generations += 1,
        Operation::Pull => value.pulling = true,
        Operation::Delete => value.deleting = true,
    }
    value.sequence += 1;
    Ok(())
}
pub(super) fn is_loopback_service(base_url: &str) -> bool {
    Url::parse(base_url).is_ok_and(|url| matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}
pub(super) fn generation_guard(config: &super::AiConfig, app: &AppHandle) -> Result<Option<ActivityGuard>, String> {
    if is_loopback_service(&config.base_url) {
        enter_operation(Operation::Generate, app).map(Some)
    } else { Ok(None) }
}

async fn delete_model(client: &Client, base_url: &str, model: &str) -> Result<Value, String> {
    if model.trim().is_empty() || model.len() > 512 || model.chars().any(char::is_control) {
        return Err("ERR_MODEL_NAME".into());
    }
    let response = client.delete(local_model_url(base_url, "delete")?)
        .json(&json!({"model": model})).send().await.map_err(|e| format!("ERR_MODEL_DELETE_CONNECTION: {e}"))?;
    let absent = response.status() == reqwest::StatusCode::NOT_FOUND;
    if !response.status().is_success() && !absent {
        let status = response.status();
        return Err(format!("ERR_MODEL_DELETE: {status}: {}", response.text().await.unwrap_or_default()));
    }
    // A successful delete response must agree with the authoritative model list.
    let list: Value = client.get(local_model_url(base_url, "tags")?).send().await
        .map_err(|e| format!("ERR_MODEL_DELETE_VERIFY: {e}"))?.error_for_status()
        .map_err(|e| format!("ERR_MODEL_DELETE_VERIFY: {e}"))?.json().await
        .map_err(|e| format!("ERR_MODEL_DELETE_VERIFY: {e}"))?;
    let models = list.get("models").and_then(Value::as_array).ok_or("ERR_MODEL_DELETE_VERIFY")?;
    if models.iter().any(|item| item.get("name").and_then(Value::as_str) == Some(model)) {
        return Err("ERR_MODEL_DELETE_VERIFY".into());
    }
    Ok(json!({"model": model, "alreadyAbsent": absent}))
}
#[tauri::command]
pub async fn delete_ollama_model(app: AppHandle, base_url: String, model: String) -> Result<Value, String> {
    local_model_url(&base_url, "delete")?;
    let _guard = enter_operation(Operation::Delete, &app)?;
    let client = Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(60))
        .build().map_err(|e| e.to_string())?;
    delete_model(&client, &base_url, &model).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRecommendation {
    model: &'static str,
    label: &'static str,
    quantization: &'static str,
    estimated_bytes: u64,
    recommended: bool,
    preferred: bool,
}
const CATALOG: [(&str, &str, &str, u64); 5] = [
    ("gemma4:e2b-it-qat", "E2B", "QAT Q4_0", 4_300_000_000),
    ("gemma4:e4b-it-qat", "E4B", "QAT Q4_0", 6_100_000_000),
    ("gemma4:12b-it-q4_K_M", "12B", "Q4_K_M", 8_000_000_000),
    (
        "gemma4:26b-a4b-it-q4_K_M",
        "26B A4B",
        "Q4_K_M",
        18_000_000_000,
    ),
    ("gemma4:31b-it-q4_K_M", "31B", "Q4_K_M", 20_000_000_000),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiEnvironment {
    os: &'static str,
    architecture: &'static str,
    cpu: Option<String>,
    memory_bytes: Option<u64>,
    unified_memory: bool,
    models: Vec<ModelRecommendation>,
}
fn recommendations(memory: Option<u64>, unified: bool) -> Vec<ModelRecommendation> {
    let gib = memory.unwrap_or(0) / (1024 * 1024 * 1024);
    let preferred = if gib < 8 {
        None
    } else if gib < 16 {
        Some(0)
    } else if unified && gib >= 24 {
        Some(2)
    } else {
        Some(1)
    };
    let eligible = |index| {
        preferred.is_some()
            && match index {
                0 => true,
                1 => gib >= 16,
                2 => gib >= if unified { 24 } else { 32 },
                3 => unified && gib >= 48,
                4 => unified && gib >= 64,
                _ => false,
            }
    };
    let mut models: Vec<_> = CATALOG
        .iter()
        .enumerate()
        .map(
            |(i, &(model, label, quantization, estimated_bytes))| ModelRecommendation {
                model,
                label,
                quantization,
                estimated_bytes,
                recommended: eligible(i),
                preferred: preferred == Some(i),
            },
        )
        .collect();
    models.sort_by_key(|m| {
        (
            if m.preferred {
                0
            } else if m.recommended {
                1
            } else {
                2
            },
            if m.recommended {
                -(m.estimated_bytes as i64)
            } else {
                m.estimated_bytes as i64
            },
        )
    });
    models
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
async fn system_query(program: &str, args: &[&str]) -> Option<String> {
    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|s| s.trim().to_owned())
}

#[tauri::command]
pub async fn get_local_ai_environment() -> LocalAiEnvironment {
    #[cfg(not(target_os = "macos"))]
    #[allow(unused_mut)]
    let mut cpu: Option<String> = None;
    #[cfg(not(target_os = "macos"))]
    #[allow(unused_mut)]
    let mut memory_bytes: Option<u64> = None;
    #[cfg(target_os = "macos")]
    let (cpu, memory_bytes) = (
        system_query("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"]).await,
        system_query("/usr/sbin/sysctl", &["-n", "hw.memsize"])
            .await
            .and_then(|s| s.parse().ok()),
    );
    #[cfg(target_os = "windows")]
    {
        if let Some(data) = system_query("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); @{cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name; memory=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory} | ConvertTo-Json -Compress"]).await {
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                cpu = value.get("cpu").and_then(Value::as_str).map(str::to_owned);
                memory_bytes = value.get("memory").and_then(Value::as_u64);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(data) = std::fs::read_to_string("/proc/meminfo") {
            memory_bytes = data.lines().find_map(|line| {
                line.strip_prefix("MemTotal:")
                    .and_then(|s| s.split_whitespace().next()?.parse::<u64>().ok())
                    .map(|kib| kib * 1024)
            });
        }
        if let Ok(data) = std::fs::read_to_string("/proc/cpuinfo") {
            cpu = data.lines().find_map(|line| {
                line.strip_prefix("model name")
                    .or_else(|| line.strip_prefix("Hardware"))
                    .and_then(|s| s.split_once(':'))
                    .map(|(_, s)| s.trim().to_owned())
            });
        }
    }
    let unified_memory = cfg!(all(target_os = "macos", target_arch = "aarch64"))
        && cpu.as_deref().is_some_and(|s| s.starts_with("Apple M"));
    LocalAiEnvironment {
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        cpu,
        memory_bytes,
        unified_memory,
        models: recommendations(memory_bytes, unified_memory),
    }
}

pub(super) fn local_model_url(base_url: &str, path: &str) -> Result<Url, String> {
    let mut url = Url::parse(base_url.trim()).map_err(|_| "ERR_LOCAL_OLLAMA_URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
    {
        return Err("ERR_LOCAL_OLLAMA_URL".into());
    }
    let base = url.path().trim_end_matches('/').trim_end_matches("/api");
    let route = format!("{base}/api/{path}");
    url.set_path(&route);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

struct ActivePull {
    id: String,
    cancel: CancellationToken,
}
static ACTIVE: OnceLock<Mutex<Option<ActivePull>>> = OnceLock::new();
fn active() -> &'static Mutex<Option<ActivePull>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}
struct PullGuard(String);
impl Drop for PullGuard {
    fn drop(&mut self) {
        if let Ok(mut value) = active().lock() {
            if value.as_ref().is_some_and(|p| p.id == self.0) {
                *value = None;
            }
        }
    }
}
#[tauri::command]
pub fn cancel_ollama_model_download(download_id: String) {
    if let Ok(value) = active().lock() {
        if let Some(pull) = value.as_ref().filter(|p| p.id == download_id) {
            pull.cancel.cancel();
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    download_id: String,
    model: String,
    sequence: u64,
    phase: String,
    digest: Option<String>,
    total: Option<u64>,
    completed: Option<u64>,
    bytes_per_second: Option<f64>,
}
struct Progress {
    event: ModelDownloadProgress,
    sample: Option<(String, u64, Instant)>,
}
impl Progress {
    fn new(id: &str, model: &str) -> Self {
        Self {
            event: ModelDownloadProgress {
                download_id: id.into(),
                model: model.into(),
                sequence: 0,
                phase: "manifest".into(),
                digest: None,
                total: None,
                completed: None,
                bytes_per_second: None,
            },
            sample: None,
        }
    }
    fn packet(&mut self, packet: Value) -> Result<bool, String> {
        if let Some(error) = packet.get("error") {
            return Err(format!("ERR_DOWNLOAD_SERVER: {error}"));
        }
        let status = packet
            .get("status")
            .and_then(Value::as_str)
            .ok_or("ERR_DOWNLOAD_INVALID_RESPONSE")?;
        let success = status == "success";
        self.event.phase = if status.contains("verifying") {
            "verifying"
        } else if status.contains("writing") || status.contains("removing") || success {
            "installing"
        } else if packet.get("digest").is_some() {
            "downloading"
        } else {
            "manifest"
        }
        .into();
        self.event.digest = packet
            .get("digest")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.event.total = packet.get("total").and_then(Value::as_u64);
        self.event.completed = packet.get("completed").and_then(Value::as_u64);
        self.event.bytes_per_second = None;
        if let (Some(digest), Some(completed)) = (&self.event.digest, self.event.completed) {
            if let Some((previous, bytes, at)) = &self.sample {
                let elapsed = at.elapsed().as_secs_f64();
                if previous == digest && completed >= *bytes && elapsed > 0.05 {
                    self.event.bytes_per_second = Some((completed - bytes) as f64 / elapsed);
                }
            }
            self.sample = Some((digest.clone(), completed, Instant::now()));
        }
        self.event.sequence += 1;
        Ok(success)
    }
}

async fn read_pull(
    mut response: reqwest::Response,
    cancel: &CancellationToken,
    idle: Duration,
    progress: &mut Progress,
    emit: &impl Fn(ModelDownloadProgress),
) -> Result<(), String> {
    let mut buffer = Vec::new();
    loop {
        let chunk = tokio::select! {
            _ = cancel.cancelled_future() => return Err(CANCELLED_MESSAGE.into()),
            result = tokio::time::timeout(idle, response.chunk()) => result.map_err(|_| "ERR_DOWNLOAD_IDLE_TIMEOUT")?.map_err(|e| format!("ERR_DOWNLOAD_CONNECTION: {e}"))?,
        };
        let eof = chunk.is_none();
        if let Some(chunk) = chunk {
            buffer.extend_from_slice(&chunk);
        }
        while let Some(end) = buffer.iter().position(|b| *b == b'\n').or_else(|| {
            if eof && !buffer.is_empty() {
                Some(buffer.len())
            } else {
                None
            }
        }) {
            let line: Vec<_> = buffer.drain(..end).collect();
            if buffer.first() == Some(&b'\n') {
                buffer.remove(0);
            }
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            let packet =
                serde_json::from_slice(&line).map_err(|_| "ERR_DOWNLOAD_INVALID_RESPONSE")?;
            let success = progress.packet(packet)?;
            emit(progress.event.clone());
            if cancel.cancelled() {
                return Err(CANCELLED_MESSAGE.into());
            }
            if success {
                return Ok(());
            }
        }
        if buffer.len() > 1024 * 1024 {
            return Err("ERR_DOWNLOAD_INVALID_RESPONSE".into());
        }
        if eof {
            return Err("ERR_DOWNLOAD_INTERRUPTED".into());
        }
    }
}
async fn pull_model(
    base_url: &str,
    model: &str,
    id: &str,
    cancel: &CancellationToken,
    idle: Duration,
    emit: impl Fn(ModelDownloadProgress),
) -> Result<Value, String> {
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = tokio::select! {
        _ = cancel.cancelled_future() => return Err(CANCELLED_MESSAGE.into()),
        result = tokio::time::timeout(idle, client.post(local_model_url(base_url, "pull")?).json(&json!({"model":model,"stream":true})).send()) => result.map_err(|_| "ERR_DOWNLOAD_IDLE_TIMEOUT")?.map_err(|e| format!("ERR_DOWNLOAD_CONNECTION: {e}"))?,
    };
    if !response.status().is_success() {
        let status = response.status();
        let detail = tokio::select! {
            _ = cancel.cancelled_future() => return Err(CANCELLED_MESSAGE.into()),
            result = tokio::time::timeout(idle, response.text()) => result.ok().and_then(Result::ok).unwrap_or_default(),
        };
        return Err(format!(
            "ERR_DOWNLOAD_SERVER: HTTP {status}: {}",
            detail.chars().take(1000).collect::<String>()
        ));
    }
    let mut progress = Progress::new(id, model);
    read_pull(response, cancel, idle, &mut progress, &emit).await?;
    let verify = async {
        let tags: Value = client
            .get(local_model_url(base_url, "tags")?)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let installed = tags
            .get("models")
            .and_then(Value::as_array)
            .and_then(|list| {
                list.iter()
                    .find(|item| item.get("name").and_then(Value::as_str) == Some(model))
            })
            .ok_or("ERR_DOWNLOAD_NOT_INSTALLED")?;
        let _info: Value = client
            .post(local_model_url(base_url, "show")?)
            .timeout(Duration::from_secs(60))
            .json(&json!({"model":model}))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        Ok::<_, String>(json!({"model": model, "digest": installed.get("digest")}))
    };
    let result = tokio::select! { _ = cancel.cancelled_future() => return Err(CANCELLED_MESSAGE.into()), result = verify => result? };
    progress.event.sequence += 1;
    progress.event.phase = "completed".into();
    emit(progress.event);
    Ok(result)
}
#[tauri::command]
pub async fn pull_ollama_model(
    app: AppHandle,
    base_url: String,
    model: String,
    download_id: String,
) -> Result<Value, String> {
    let _activity_guard = enter_operation(Operation::Pull, &app)?;
    local_model_url(&base_url, "pull")?;
    if !CATALOG.iter().any(|entry| entry.0 == model) {
        return Err("ERR_DOWNLOAD_MODEL_NOT_SUPPORTED".into());
    }
    if download_id.is_empty() || download_id.len() > 128 {
        return Err("ERR_DOWNLOAD_INVALID_ID".into());
    }
    let cancel = CancellationToken::default();
    {
        let mut value = active().lock().map_err(|_| "ERR_DOWNLOAD_BUSY")?;
        if value.is_some() {
            return Err("ERR_DOWNLOAD_BUSY".into());
        }
        *value = Some(ActivePull {
            id: download_id.clone(),
            cancel: cancel.clone(),
        });
    }
    let _guard = PullGuard(download_id.clone());
    pull_model(
        &base_url,
        &model,
        &download_id,
        &cancel,
        Duration::from_secs(180),
        |event| {
            let _ = app.emit("ollama-model-download-progress", event);
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recommendation_boundaries_and_unknown_hardware() {
        let preferred = |gib: u64, unified| {
            recommendations(Some(gib * 1024 * 1024 * 1024), unified)
                .into_iter()
                .find(|m| m.preferred)
                .map(|m| m.label)
        };
        for (gib, expected) in [
            (7, None),
            (8, Some("E2B")),
            (15, Some("E2B")),
            (16, Some("E4B")),
            (23, Some("E4B")),
            (24, Some("12B")),
            (32, Some("12B")),
            (64, Some("12B")),
        ] {
            assert_eq!(preferred(gib, true), expected);
        }
        assert_eq!(preferred(32, false), Some("E4B"));
        assert!(recommendations(None, false).iter().all(|m| !m.recommended));
        assert!(
            !recommendations(Some(47 << 30), true)
                .iter()
                .find(|m| m.label == "26B A4B")
                .unwrap()
                .recommended
        );
        assert!(
            recommendations(Some(48 << 30), true)
                .iter()
                .find(|m| m.label == "26B A4B")
                .unwrap()
                .recommended
        );
        assert!(
            !recommendations(Some(63 << 30), true)
                .iter()
                .find(|m| m.label == "31B")
                .unwrap()
                .recommended
        );
        assert!(
            recommendations(Some(64 << 30), true)
                .iter()
                .find(|m| m.label == "31B")
                .unwrap()
                .recommended
        );
        assert!(
            !recommendations(Some(128 << 30), false)
                .iter()
                .find(|m| m.label == "31B")
                .unwrap()
                .recommended
        );
    }
    #[test]
    fn deletion_and_local_tasks_are_mutually_exclusive() {
        let mut state = LocalActivity::default();
        acquire_activity(&mut state, Operation::Generate).unwrap();
        acquire_activity(&mut state, Operation::Generate).unwrap();
        assert_eq!(state.generations, 2);
        assert!(acquire_activity(&mut state, Operation::Delete).is_err());
        state.generations = 0;
        acquire_activity(&mut state, Operation::Pull).unwrap();
        assert!(acquire_activity(&mut state, Operation::Delete).is_err());
        state.pulling = false;
        acquire_activity(&mut state, Operation::Delete).unwrap();
        assert!(acquire_activity(&mut state, Operation::Generate).is_err());
        assert!(acquire_activity(&mut state, Operation::Pull).is_err());
        assert!(acquire_activity(&mut state, Operation::Delete).is_err());
    }
    #[tokio::test]
    async fn deletes_named_models_and_checks_authoritative_list() {
        use std::io::{Read, Write};
        for (status, list, expected) in [
            ("200 OK", r#"{"models":[]}"#, "deleted"),
            ("404 Not Found", r#"{"models":[]}"#, "absent"),
            ("200 OK", r#"{"models":[{"name":"other-vendor:test"}]}"#, "verify"),
            ("500 Internal Server Error", "", "failed"),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let worker = std::thread::spawn(move || {
                for turn in 0..if list.is_empty() { 1 } else { 2 } {
                    let (mut socket, _) = listener.accept().unwrap();
                    let mut headers = Vec::new();
                    let mut byte = [0];
                    while socket.read_exact(&mut byte).is_ok() {
                        headers.push(byte[0]);
                        if headers.ends_with(b"\r\n\r\n") { break; }
                    }
                    let headers = String::from_utf8(headers).unwrap();
                    assert!(!headers.to_ascii_lowercase().contains("authorization:"));
                    if turn == 0 {
                        assert!(headers.starts_with("DELETE /api/delete "));
                        let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap();
                        let mut body = vec![0; length]; socket.read_exact(&mut body).unwrap();
                        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), json!({"model":"other-vendor:test"}));
                    } else { assert!(headers.starts_with("GET /api/tags ")); }
                    let body = if turn == 0 { "{}" } else { list };
                    let status = if turn == 0 { status } else { "200 OK" };
                    write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
            });
            let result = delete_model(&Client::builder().no_proxy().build().unwrap(), &url, "other-vendor:test").await;
            worker.join().unwrap();
            match expected {
                "deleted" => assert_eq!(result.unwrap()["alreadyAbsent"], false),
                "absent" => assert_eq!(result.unwrap()["alreadyAbsent"], true),
                "verify" => assert!(result.unwrap_err().contains("VERIFY")),
                _ => assert!(result.unwrap_err().contains("500")),
            }
        }
    }
    #[tokio::test]
    #[ignore = "Deletes only the explicitly enabled disposable validation alias on local Ollama"]
    async fn disposable_model_delete_smoke() {
        let model = "lexicue-delete-validation:20261002";
        assert_eq!(std::env::var("LEXICUE_DELETE_TEST_MODEL").unwrap(), model);
        let base = "http://127.0.0.1:11434";
        let client = Client::builder().no_proxy().timeout(Duration::from_secs(15)).build().unwrap();
        let before: Value = client.get(format!("{base}/api/tags")).send().await.unwrap().json().await.unwrap();
        assert!(before["models"].as_array().unwrap().iter().any(|m| m["name"] == model));
        assert_eq!(delete_model(&client, base, model).await.unwrap()["alreadyAbsent"], false);
        let after: Value = client.get(format!("{base}/api/tags")).send().await.unwrap().json().await.unwrap();
        for previous in before["models"].as_array().unwrap().iter().filter(|m| m["name"] != model) {
            assert!(after["models"].as_array().unwrap().iter().any(|m| m["name"] == previous["name"] && m["digest"] == previous["digest"]));
        }
        println!("Disposable alias deleted; all {} original model tags and digests preserved", after["models"].as_array().unwrap().len());
    }
    #[test]
    fn downloads_only_target_exact_local_addresses() {
        for host in [
            "http://localhost:11434",
            "http://127.0.0.1:1234/api/",
            "http://[::1]:11434",
        ] {
            assert!(local_model_url(host, "pull").is_ok());
        }
        for host in [
            "https://localhost.evil.test",
            "http://127.0.0.1.evil.test",
            "http://192.168.1.5:11434",
            "http://user@localhost",
            "file://localhost/test",
        ] {
            assert!(local_model_url(host, "pull").is_err());
        }
        assert_eq!(
            local_model_url("http://localhost:11434/api/", "pull")
                .unwrap()
                .as_str(),
            "http://localhost:11434/api/pull"
        );
    }
    #[test]
    fn layers_reset_byte_progress_and_errors_are_not_success() {
        let mut state = Progress::new("id", "model");
        assert!(!state.packet(json!({"status":"pulling manifest"})).unwrap());
        state
            .packet(json!({"status":"pulling layer", "digest":"one", "total":100,"completed":50}))
            .unwrap();
        assert_eq!(state.event.completed, Some(50));
        state
            .packet(json!({"status":"pulling layer", "digest":"two", "total":10,"completed":1}))
            .unwrap();
        assert_eq!(state.event.completed, Some(1));
        assert_eq!(state.event.bytes_per_second, None);
        assert!(state
            .packet(json!({"error":"no space left on device"}))
            .unwrap_err()
            .contains("no space"));
        assert!(state.packet(json!({"status":"success"})).unwrap());
        assert_eq!(state.event.phase, "installing");
    }
    // A controlled real HTTP stream exercises network framing and early progress without a model download.
    fn mock_pull(
        parts: Vec<Vec<u8>>,
        pause: Duration,
        verify: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for turn in 0..if verify { 3 } else { 1 } {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while socket.read_exact(&mut byte).is_ok() {
                    request.push(byte[0]);
                    if request.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let headers = String::from_utf8_lossy(&request);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|s| s.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                socket.read_exact(&mut body).unwrap();
                if turn == 0 {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").unwrap();
                    for part in &parts {
                        if write!(socket, "{:x}\r\n", part.len())
                            .and_then(|_| socket.write_all(part))
                            .and_then(|_| socket.write_all(b"\r\n"))
                            .and_then(|_| socket.flush())
                            .is_err()
                        {
                            return;
                        }
                        std::thread::sleep(pause);
                    }
                    let _ = socket.write_all(b"0\r\n\r\n");
                } else {
                    let body = if turn == 1 {
                        r#"{"models":[{"name":"gemma4:12b-it-q4_K_M","digest":"sha256:test"}]}"#
                    } else {
                        r#"{"capabilities":["completion"]}"#
                    };
                    write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                }
            }
        });
        (address, worker)
    }
    #[tokio::test]
    async fn split_utf8_stream_emits_before_completion_and_verifies_install() {
        let first =
            "{\"status\":\"pulling 字节\",\"digest\":\"one\",\"total\":100,\"completed\":10}\r\n"
                .as_bytes();
        let split = first.iter().position(|byte| *byte >= 128).unwrap() + 1;
        let (url, worker) = mock_pull(
            vec![
                first[..split].to_vec(),
                first[split..].to_vec(),
                b"{\"status\":\"success\"}".to_vec(),
            ],
            Duration::from_millis(25),
            true,
        );
        let events = Mutex::new(Vec::new());
        let result = pull_model(
            &url,
            CATALOG[2].0,
            "test",
            &CancellationToken::default(),
            Duration::from_secs(2),
            |event| {
                events.lock().unwrap().push(event);
            },
        )
        .await
        .unwrap();
        worker.join().unwrap();
        assert_eq!(result["digest"], "sha256:test");
        let events = events.lock().unwrap();
        assert_eq!(events[0].completed, Some(10));
        assert_eq!(events.last().unwrap().phase, "completed");
        assert!(events
            .windows(2)
            .all(|items| items[0].sequence < items[1].sequence));
    }
    #[tokio::test]
    async fn incomplete_and_cancelled_pulls_do_not_verify_or_succeed() {
        for cancel_now in [false, true] {
            let (url, worker) = mock_pull(
                vec![
                    b"{\"status\":\"pulling layer\",\"digest\":\"one\",\"completed\":1}\n".to_vec(),
                ],
                Duration::ZERO,
                false,
            );
            let cancel = CancellationToken::default();
            let result = pull_model(
                &url,
                CATALOG[2].0,
                "test",
                &cancel,
                Duration::from_secs(2),
                |_| {
                    if cancel_now {
                        cancel.cancel();
                    }
                },
            )
            .await;
            worker.join().unwrap();
            assert_eq!(
                result.unwrap_err(),
                if cancel_now {
                    CANCELLED_MESSAGE
                } else {
                    "ERR_DOWNLOAD_INTERRUPTED"
                }
            );
        }
    }
    #[tokio::test]
    async fn idle_timeout_stops_without_resending() {
        let (url, worker) = mock_pull(
            vec![
                b"{\"status\":\"pulling manifest\"}\n".to_vec(),
                b"{\"status\":\"success\"}\n".to_vec(),
            ],
            Duration::from_millis(80),
            false,
        );
        assert_eq!(
            pull_model(
                &url,
                CATALOG[2].0,
                "test",
                &CancellationToken::default(),
                Duration::from_millis(30),
                |_| {}
            )
            .await
            .unwrap_err(),
            "ERR_DOWNLOAD_IDLE_TIMEOUT"
        );
        worker.join().unwrap();
    }
}
