use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const CANCELLED_MESSAGE: &str = "ERR_CANCELLED";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(300);
const METADATA_TTL: Duration = Duration::from_secs(600);
const YTDLP_VERSION_TIMEOUT: Duration = Duration::from_secs(3);

#[path = "youtube_download.rs"]
pub mod downloads;
pub use downloads::{init_subtitle_cache, youtube_prepare_subtitles};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SubtitleTrack {
    pub lang: String,
    pub is_auto: bool,
    pub language: String,
    pub source: downloads::SubtitleSource,
    pub source_language: Option<String>,
}

#[derive(Serialize)]
pub struct VideoSubInfo {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<i64>,
    pub manual: Vec<SubtitleTrack>,
    pub automatic: Vec<SubtitleTrack>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SubtitleResult {
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct YtDlpStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub javascript: Option<String>,
    pub ejs: String,
    pub ffmpeg: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct TrackSelection {
    pub lang: String,
    #[serde(default)]
    pub is_auto: bool,
}

fn tool_path(name: &str) -> Option<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(&home).join(".local/bin"));
        dirs.push(PathBuf::from(&home).join(".cargo/bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.into_iter()
        .map(|dir| {
            dir.join(if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_string()
            })
        })
        .find(|path| path.is_file())
}

fn ytdlp_path() -> Option<PathBuf> {
    tool_path("yt-dlp")
}

fn ytdlp_version_from_output(success: bool, output: &[u8]) -> Option<String> {
    if !success {
        return None;
    }
    let version = String::from_utf8_lossy(output).trim().to_string();
    (!version.is_empty()).then_some(version)
}

async fn ytdlp_version_with_timeout() -> Option<String> {
    let path = ytdlp_path()?.to_path_buf();
    let mut child = tokio::process::Command::new(path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let status = match tokio::time::timeout(YTDLP_VERSION_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(_)) => return None,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return None;
        }
    };
    let mut output = Vec::new();
    let mut stdout = child.stdout.take()?;
    tokio::io::AsyncReadExt::read_to_end(&mut stdout, &mut output)
        .await
        .ok()?;
    ytdlp_version_from_output(status.success(), &output)
}

fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn extract_video_id(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    for prefix in ["https://youtu.be/", "http://youtu.be/"] {
        if let Some(rest) = url.strip_prefix(prefix) {
            let id = rest.split(['?', '&', '#', '/']).next().unwrap_or("");
            if is_valid_video_id(id) {
                return Some(id.to_string());
            }
        }
    }
    if let Some(q) = url.find('?') {
        for pair in url[q + 1..].split('&') {
            if let Some(v) = pair.strip_prefix("v=") {
                let id = v.split(['&', '#']).next().unwrap_or("");
                if is_valid_video_id(id) {
                    return Some(id.to_string());
                }
            }
        }
    }
    for marker in ["/shorts/", "/embed/", "/live/", "/watch/"] {
        if let Some(pos) = url.find(marker) {
            let rest = &url[pos + marker.len()..];
            let id = rest.split(['?', '&', '#', '/']).next().unwrap_or("");
            if is_valid_video_id(id) {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn youtube_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// Extract the `ytInitialPlayerResponse = {...};` JSON blob from a watch page.
fn extract_initial_player_response(html: &str) -> Option<String> {
    const MARKER: &str = "ytInitialPlayerResponse";
    let pos = html.find(MARKER)?;
    let rest = &html[pos + MARKER.len()..];
    let eq = rest.find('=')?;
    let open_rel = rest[eq..].find('{')?;
    let open = eq + open_rel;
    let chars: Vec<char> = rest[open..].chars().collect();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (i, &c) in chars.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(chars[..=i].iter().collect());
                }
            }
            _ => {}
        }
    }
    None
}

fn sort_tracks(tracks: &mut Vec<SubtitleTrack>) {
    tracks.sort_by(|a, b| a.lang.cmp(&b.lang));
    tracks.dedup_by(|a, b| a.lang == b.lang);
}

fn tracks_from_player_json(json: &serde_json::Value) -> (Vec<SubtitleTrack>, Vec<SubtitleTrack>) {
    let tracks = json["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut manual = Vec::new();
    let mut automatic = Vec::new();
    for track in &tracks {
        let Some(lang) = track["languageCode"].as_str() else {
            continue;
        };
        let is_asr = track["kind"].as_str() == Some("asr");
        if is_asr {
            automatic.push(downloads::player_track(lang, true));
        } else {
            manual.push(downloads::player_track(lang, false));
        }
    }
    sort_tracks(&mut manual);
    sort_tracks(&mut automatic);
    (manual, automatic)
}

fn is_junk_track_lang(lang: &str) -> bool {
    matches!(
        lang,
        "live_chat" | "offline" | "origin" | "reel" | "auto" | "multi_language"
    )
}

struct DownloadJob {
    app: Option<AppHandle>,
    job_id: i64,
    token: Arc<AtomicBool>,
}

impl DownloadJob {
    fn cancelled(&self) -> bool {
        self.token.load(Ordering::Relaxed)
    }

    async fn cancel_signal(&self) {
        while !self.cancelled() {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

static DOWNLOAD_REGISTRY: OnceLock<Mutex<HashMap<i64, Arc<DownloadJob>>>> = OnceLock::new();

fn download_registry() -> &'static Mutex<HashMap<i64, Arc<DownloadJob>>> {
    DOWNLOAD_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_download_job(app: Option<AppHandle>, job_id: i64) -> Arc<DownloadJob> {
    // Register and preserve early cancellation under the same lock.
    let mut registry = download_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let token = registry
        .get(&job_id)
        .map(|job| job.token.clone())
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let job = Arc::new(DownloadJob { app, job_id, token });
    registry.insert(job_id, job.clone());
    job
}

fn create_download_job(app: AppHandle, job_id: i64) -> Arc<DownloadJob> {
    register_download_job(Some(app), job_id)
}

struct JobGuard {
    job_id: i64,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = download_registry().lock() {
            registry.remove(&self.job_id);
        }
    }
}

#[tauri::command]
pub async fn youtube_cancel_job(job_id: i64) -> Result<(), String> {
    if let Ok(mut registry) = download_registry().lock() {
        let job = registry.entry(job_id).or_insert_with(|| {
            Arc::new(DownloadJob {
                app: None,
                job_id,
                token: Arc::new(AtomicBool::new(true)),
            })
        });
        job.token.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn spawn_error(error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "未找到 yt-dlp。请前往「设置 → YouTube 字幕工具」查看安装方法".to_string()
    } else {
        format!("无法运行 yt-dlp：{error}")
    }
}

#[cfg(test)]
fn friendly_ytdlp_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    let pick = |fragments: &[&str], message: &str| -> Option<String> {
        if fragments.iter().any(|f| lower.contains(f)) {
            Some(message.to_string())
        } else {
            None
        }
    };
    pick(
        &[
            "sign in to confirm you're not a bot",
            "not a bot",
            "bot check",
        ],
        "YouTube 触发了机器人验证，请稍后重试或更换网络环境。",
    )
    .or_else(|| {
        pick(
            &["video unavailable", "this video isn't available"],
            "视频不可用（可能已删除、设为私密或受地区限制）。",
        )
    })
    .or_else(|| {
        pick(
            &["video is private", "private video", "is private"],
            "该视频为私密视频，无法获取字幕。",
        )
    })
    .or_else(|| {
        pick(
            &["only available to premium", "this video is only available"],
            "该视频受地区或会员限制。",
        )
    })
    .or_else(|| {
        pick(
            &["http error 429", "too many requests"],
            "YouTube 限制了字幕请求（HTTP 429）。",
        )
    })
    .or_else(|| {
        pick(
            &["http error 403"],
            "访问被拒绝（HTTP 403），YouTube 可能要求登录或验证。",
        )
    })
    .or_else(|| {
        pick(
            &["there are no subtitles", "no subtitles", "has no subtitles"],
            "该视频没有可用字幕。",
        )
    })
    .or_else(|| pick(&["unable to download video subtitles"], "字幕下载失败。"))
    .or_else(|| {
        pick(
            &["invalid url", "not a valid url", "could not find"],
            "视频链接格式不正确，请检查后重试。",
        )
    })
    .unwrap_or_else(|| {
        let cleaned: String = stderr
            .chars()
            .filter(|c| !c.is_control() || *c == '\n')
            .take(300)
            .collect();
        format!("yt-dlp 出错：{}", cleaned.trim())
    })
}

enum RunOutcome {
    Status(std::process::ExitStatus),
    Error(String),
    Timeout,
    Cancelled,
}

/// Spawn yt-dlp, capture stderr, enforce a timeout and honour cancellation.
/// Spawn yt-dlp, capture both stdout and stderr, enforce a timeout and honour
/// cancellation. The spawned child is always killed on timeout/cancel.
async fn run_ytdlp_capture(
    cmd: &mut tokio::process::Command,
    cancel: Option<&DownloadJob>,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, Vec<u8>, String), String> {
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| spawn_error(&e))?;
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let out_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let err_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let out_reader = {
        let buf = out_buf.clone();
        tokio::spawn(async move {
            if let Some(mut handle) = stdout_handle {
                let mut data = Vec::new();
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut handle, &mut data).await;
                if let Ok(mut guard) = buf.lock() {
                    *guard = data;
                }
            }
        })
    };
    let err_reader = {
        let buf = err_buf.clone();
        tokio::spawn(async move {
            if let Some(mut handle) = stderr_handle {
                let mut data = Vec::new();
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut handle, &mut data).await;
                if let Ok(mut guard) = buf.lock() {
                    *guard = data;
                }
            }
        })
    };

    let outcome = match cancel {
        Some(job) => {
            tokio::select! {
                _ = job.cancel_signal() => RunOutcome::Cancelled,
                result = tokio::time::timeout(timeout, child.wait()) => match result {
                    Ok(Ok(status)) => RunOutcome::Status(status),
                    Ok(Err(error)) => RunOutcome::Error(format!("yt-dlp 运行失败：{error}")),
                    Err(_) => RunOutcome::Timeout,
                },
            }
        }
        None => match tokio::time::timeout(timeout, child.wait()).await {
            Ok(Ok(status)) => RunOutcome::Status(status),
            Ok(Err(error)) => RunOutcome::Error(format!("yt-dlp 运行失败：{error}")),
            Err(_) => RunOutcome::Timeout,
        },
    };

    match outcome {
        RunOutcome::Cancelled => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            out_reader.abort();
            err_reader.abort();
            Err(CANCELLED_MESSAGE.to_string())
        }
        RunOutcome::Timeout => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            out_reader.abort();
            err_reader.abort();
            Err("yt-dlp 执行超时，已终止。请检查网络后重试。".to_string())
        }
        RunOutcome::Error(message) => {
            out_reader.abort();
            err_reader.abort();
            Err(message)
        }
        RunOutcome::Status(status) => {
            let _ = out_reader.await;
            let _ = err_reader.await;
            let stdout = out_buf.lock().unwrap().clone();
            let stderr = String::from_utf8_lossy(&err_buf.lock().unwrap()).to_string();
            Ok((status, stdout, stderr))
        }
    }
}

#[cfg(test)]
async fn run_ytdlp(
    cmd: &mut tokio::process::Command,
    job: &DownloadJob,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, String), String> {
    let (status, _stdout, stderr) = run_ytdlp_capture(cmd, Some(job), timeout).await?;
    Ok((status, stderr))
}

struct MetadataCacheEntry {
    fetched_at: std::time::Instant,
    json: serde_json::Value,
}

static METADATA_CACHE: OnceLock<Mutex<HashMap<String, MetadataCacheEntry>>> = OnceLock::new();

fn get_cached_metadata(video_id: &str) -> Option<serde_json::Value> {
    let cache = METADATA_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let guard = cache.lock().ok()?;
    let entry = guard.get(video_id)?;
    if entry.fetched_at.elapsed() > METADATA_TTL {
        return None;
    }
    Some(entry.json.clone())
}

fn cache_metadata(video_id: &str, json: &serde_json::Value) {
    if let Ok(mut guard) = METADATA_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
    {
        guard.insert(
            video_id.to_string(),
            MetadataCacheEntry {
                fetched_at: std::time::Instant::now(),
                json: json.clone(),
            },
        );
    }
}

async fn fetch_ytdlp_json(
    cancel: Option<&DownloadJob>,
    url: &str,
    session: &downloads::BrowserSession,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let video_id = extract_video_id(url).unwrap_or_else(|| "video".to_string());
    let cache_key = format!("{video_id}:{}", session.cache_identity());
    if let Some(json) = get_cached_metadata(&cache_key) {
        return Ok(json);
    }
    let mut cmd = tokio::process::Command::new(ytdlp_path().expect("yt-dlp not found"));
    cmd.arg("--skip-download")
        .arg("--no-playlist")
        .arg("--dump-single-json")
        .arg("--retries")
        .arg("0")
        .arg("--extractor-retries")
        .arg("0");
    downloads::configure_session(&mut cmd, session)?;
    cmd.arg(format!("https://www.youtube.com/watch?v={video_id}"));
    let (status, stdout, stderr) = run_ytdlp_capture(&mut cmd, cancel, timeout).await?;
    if !status.success() {
        return Err(downloads::DownloadError::from_message(
            &stderr,
            "primary",
            "",
            downloads::SubtitleSource::Unknown,
        )
        .code);
    }
    let json: serde_json::Value = serde_json::from_slice(&stdout)
        .map_err(|error| format!("解析 yt-dlp 信息失败：{error}"))?;
    cache_metadata(&cache_key, &json);
    Ok(json)
}

async fn list_subs_ytdlp(
    url: &str,
    session: &downloads::BrowserSession,
) -> Result<VideoSubInfo, String> {
    let json = fetch_ytdlp_json(None, url, session, LIST_TIMEOUT).await?;

    let title = json["title"].as_str().unwrap_or("视频").to_string();
    let thumbnail = json["thumbnails"]
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|t| t["url"].as_str())
        .map(String::from)
        .or_else(|| json["thumbnail"].as_str().map(String::from));
    let duration = json["duration"].as_i64();

    let mut manual = Vec::new();
    if let Some(subs) = json["subtitles"].as_object() {
        for (lang, entries) in subs {
            if is_junk_track_lang(lang) {
                continue;
            }
            if entries.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                manual.push(downloads::metadata_track(lang, false, entries));
            }
        }
    }
    let mut automatic = Vec::new();
    if let Some(subs) = json["automatic_captions"].as_object() {
        for (lang, entries) in subs {
            if is_junk_track_lang(lang) {
                continue;
            }
            if entries.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                automatic.push(downloads::metadata_track(lang, true, entries));
            }
        }
    }
    sort_tracks(&mut manual);
    sort_tracks(&mut automatic);

    Ok(VideoSubInfo {
        title,
        thumbnail,
        duration,
        manual,
        automatic,
    })
}

async fn list_subs_http(url: &str) -> Result<VideoSubInfo, String> {
    let video_id = extract_video_id(url).ok_or("无法从 URL 解析视频 ID")?;
    let client = youtube_client()?;
    let resp = client
        .get(format!("https://www.youtube.com/watch?v={video_id}"))
        .header("User-Agent", UA)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("请求 YouTube 失败：{e}"))?;
    let status = resp.status();
    let html = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("YouTube 页面返回 {status}"));
    }
    let json_text = extract_initial_player_response(&html)
        .ok_or("无法解析 YouTube 页面（视频可能不可用或需要登录）")?;
    let json: serde_json::Value =
        serde_json::from_str(&json_text).map_err(|e| format!("解析页面数据失败：{e}"))?;

    let title = json["videoDetails"]["title"]
        .as_str()
        .unwrap_or("视频")
        .to_string();
    let thumbnail = json["videoDetails"]["thumbnail"]["thumbnails"]
        .as_array()
        .and_then(|arr| arr.last())
        .and_then(|t| t["url"].as_str())
        .map(String::from);
    let duration = json["videoDetails"]["lengthSeconds"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok());
    let (manual, automatic) = tracks_from_player_json(&json);
    Ok(VideoSubInfo {
        title,
        thumbnail,
        duration,
        manual,
        automatic,
    })
}

#[tauri::command]
pub async fn youtube_list_subs(
    url: String,
    session: Option<downloads::BrowserSession>,
) -> Result<VideoSubInfo, String> {
    let session = session.unwrap_or_default();
    session.validate()?;
    if extract_video_id(&url).is_none() {
        return Err("invalid_url".into());
    }
    if ytdlp_path().is_some() {
        return list_subs_ytdlp(&url, &session).await;
    }
    if session.enabled {
        return Err("missing_tool".into());
    }
    list_subs_http(&url).await
}

fn create_temp_dir() -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("lexicue-ytdlp-{}-{ts}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建临时目录失败：{e}"))?;
    Ok(dir)
}

fn cleanup_dir(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

fn find_subtitle_file(dir: &Path, video_id: &str, lang: &str) -> Option<PathBuf> {
    let exact_srt = dir.join(format!("{video_id}.{lang}.srt"));
    if exact_srt.is_file() {
        return Some(exact_srt);
    }
    let exact_vtt = dir.join(format!("{video_id}.{lang}.vtt"));
    if exact_vtt.is_file() {
        return Some(exact_vtt);
    }
    // Fall back to a prefix scan in case yt-dlp names the file differently.
    let prefix = format!("{video_id}.{lang}.");
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if fname.starts_with(&prefix) && (fname.ends_with(".srt") || fname.ends_with(".vtt")) {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
fn choose_subtitle_format(
    json: &serde_json::Value,
    lang: &str,
    is_auto: bool,
) -> Option<(String, String)> {
    let group_name = if is_auto {
        "automatic_captions"
    } else {
        "subtitles"
    };
    let formats = json[group_name][lang].as_array()?;
    let preference = ["srt", "vtt", "json3", "srv3", "srv2", "srv1", "ttml"];
    for ext in preference {
        if let Some(format) = formats
            .iter()
            .find(|item| item["ext"].as_str() == Some(ext) && item["url"].as_str().is_some())
        {
            return Some((
                ext.to_string(),
                format["url"].as_str().unwrap_or_default().to_string(),
            ));
        }
    }
    None
}

#[cfg(test)]
async fn download_sub_with_job(
    job: &DownloadJob,
    _base: f64,
    _span: f64,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    downloads::test_download(job, url, lang, is_auto).await
}

#[cfg(test)]
fn is_transient_error(error: &str) -> bool {
    downloads::DownloadError::from_message(error, "primary", "", downloads::SubtitleSource::Unknown)
        .code
        == "network"
}

#[tauri::command]
pub async fn youtube_download_sub(
    app: AppHandle,
    job_id: i64,
    url: String,
    lang: String,
    is_auto: bool,
) -> Result<SubtitleResult, downloads::DownloadError> {
    let result = youtube_prepare_subtitles(
        app,
        job_id,
        url,
        TrackSelection { lang, is_auto },
        None,
        None,
    )
    .await?;
    result.into_complete()
}

#[tauri::command]
pub async fn youtube_merge_subs(
    app: AppHandle,
    job_id: i64,
    url: String,
    primary: TrackSelection,
    secondary: TrackSelection,
) -> Result<SubtitleResult, downloads::DownloadError> {
    let result =
        youtube_prepare_subtitles(app, job_id, url, primary, Some(secondary), None).await?;
    result.into_complete()
}

#[tauri::command]
pub async fn youtube_ytdlp_status() -> YtDlpStatus {
    downloads::tool_status().await
}

fn ms_to_srt_ts(ms: f64) -> String {
    let ms = ms.round() as i64;
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let milli = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, milli)
}

fn json3_to_srt(content: &str) -> Result<String, String> {
    let json: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("解析字幕 JSON 失败：{e}"))?;
    let events = json["events"].as_array().ok_or("字幕数据缺少 events")?;
    let mut out = String::new();
    let mut idx = 1u32;
    for event in events {
        let Some(start) = event["tStartMs"].as_f64() else {
            continue;
        };
        let Some(dur) = event["dDurationMs"].as_f64() else {
            continue;
        };
        let Some(segs) = event["segs"].as_array() else {
            continue;
        };
        let mut text = String::new();
        for seg in segs {
            if let Some(utf8) = seg["utf8"].as_str() {
                text.push_str(utf8);
            }
        }
        let text = text.trim().replace('\n', " ");
        if text.is_empty() {
            continue;
        }
        if dur <= 0.0 {
            continue;
        }
        let end = start + dur;
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            idx,
            ms_to_srt_ts(start),
            ms_to_srt_ts(end),
            text
        ));
        idx += 1;
    }
    Ok(out)
}

fn vtt_ts_to_srt_ts(ts: &str) -> String {
    let (hms, ms) = match ts.rsplit_once('.') {
        Some((h, m)) => (h, m),
        None => (ts, "000"),
    };
    let parts: Vec<&str> = hms.split(':').collect();
    let (h, m, s) = match parts.as_slice() {
        [hh, mm, ss] => (*hh, *mm, *ss),
        [mm, ss] => ("00", *mm, *ss),
        _ => ("00", "00", hms),
    };
    let ms = if ms.len() < 3 {
        format!("{:0<3}", ms)
    } else {
        ms[..3].to_string()
    };
    format!("{h}:{m}:{s},{ms}")
}

fn vtt_to_srt(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\u{feff}', "");
    let normalized = normalized
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    let mut out = String::new();
    let mut index = 1;
    for block in normalized.split("\n\n") {
        let lines: Vec<_> = block.lines().collect();
        if lines.first().is_some_and(|line| {
            line.starts_with("NOTE") || line.starts_with("STYLE") || line.starts_with("REGION")
        }) {
            continue;
        }
        let Some(timing) = lines.iter().position(|line| line.contains("-->")) else {
            continue;
        };
        let (start, end) = lines[timing].split_once("-->").unwrap();
        let start = vtt_ts_to_srt_ts(start.trim());
        let end = vtt_ts_to_srt_ts(end.split_whitespace().next().unwrap_or(""));
        let Some((start_ms, end_ms)) = parse_ts(&start).zip(parse_ts(&end)) else {
            continue;
        };
        if end_ms <= start_ms {
            continue;
        }
        let mut text = String::new();
        for line in &lines[timing + 1..] {
            let mut inside_tag = false;
            for character in line.chars() {
                match character {
                    '<' => inside_tag = true,
                    '>' if inside_tag => inside_tag = false,
                    _ if !inside_tag => text.push(character),
                    _ => {}
                }
            }
            text.push('\n');
        }
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        out.push_str(&format!("{index}\n{start} --> {end}\n{text}\n\n"));
        index += 1;
    }
    out
}

fn parse_ts(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let comma = raw.find(['.', ','])?;
    let (hms, ms) = (&raw[..comma], &raw[comma + 1..]);
    let ms: i64 = ms.parse().ok()?;
    let parts: Vec<&str> = hms.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let s: i64 = parts[2].parse().ok()?;
    Some(h * 3_600_000 + m * 60_000 + s * 1000 + ms)
}

fn parse_ts_line(line: &str) -> Option<(i64, i64)> {
    let arrow = line.find("-->")?;
    let start = parse_ts(&line[..arrow])?;
    let end = parse_ts(line[arrow + 3..].split_whitespace().next()?)?;
    Some((start, end))
}

struct SrtCue {
    start_ms: i64,
    end_ms: i64,
    text: String,
}

fn parse_srt(content: &str) -> Vec<SrtCue> {
    let normalized = content.replace("\r\n", "\n").replace('\u{feff}', "");
    let mut cues = Vec::new();
    let mut lines = normalized.lines().peekable();
    while let Some(line) = lines.next() {
        if line.trim().parse::<u32>().is_ok() {
            if let Some((start_ms, end_ms)) = lines.peek().and_then(|ts| parse_ts_line(ts)) {
                lines.next();
                let mut text = Vec::new();
                while let Some(l) = lines.peek() {
                    if l.trim().is_empty() {
                        break;
                    }
                    text.push(l.to_string());
                    lines.next();
                }
                cues.push(SrtCue {
                    start_ms,
                    end_ms,
                    text: text.join("\n"),
                });
            }
        }
    }
    cues
}

fn merge_srt_cues(primary: &[SrtCue], secondary: &[SrtCue]) -> String {
    let offset = estimate_time_offset(primary, secondary);
    let secondary: Vec<SrtCue> = secondary
        .iter()
        .map(|cue| SrtCue {
            start_ms: cue.start_ms - offset,
            end_ms: cue.end_ms - offset,
            text: cue.text.clone(),
        })
        .collect();

    let primary_signal = has_punctuation_signal(primary);
    let secondary_signal = has_punctuation_signal(&secondary);

    let pairs = if primary_signal != secondary_signal {
        // Interlock: the punctuated track anchors the segmentation for both.
        joint_segment(primary, &secondary)
    } else {
        let primary_sentences = merge_cues_into_sentences(primary);
        let secondary_sentences = merge_cues_into_sentences(&secondary);
        align_sentences(&primary_sentences, &secondary_sentences)
    };
    render_pairs(&pairs)
}

#[derive(Clone)]
struct Sentence {
    start_ms: i64,
    end_ms: i64,
    text: String,
}

const MAX_CUES_PER_SENTENCE: usize = 15;
const MAX_CHARS_PER_SENTENCE: usize = 240;

fn cue_text(cue: &SrtCue) -> String {
    cue.text.trim().replace('\n', " ")
}

fn join_buffer(buffer: &[&SrtCue]) -> String {
    buffer
        .iter()
        .map(|cue| cue_text(cue))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn is_abbreviation(text: &str) -> bool {
    const ABBREVIATIONS: &[&str] = &[
        "MR", "MRS", "MS", "MISS", "DR", "ST", "JR", "SR", "PROF", "CAPT", "LT", "COL", "GEN",
        "SEN", "REP", "GOV", "NO", "VS", "ETC", "EG", "IE", "EST", "APPROX", "DEPT", "FIG", "US",
        "UK", "U.S", "Z.B", "USW", "CA", "NR", "HR", "FR", "BSPW", "GGF", "A.M", "P.M",
    ];
    let token_start = text
        .char_indices()
        .rev()
        .find(|(_, c)| !(c.is_alphanumeric() || matches!(c, '.' | '\'' | '-')))
        .map(|(index, c)| index + c.len_utf8())
        .unwrap_or(0);
    let token = text[token_start..].trim_end_matches('.').to_uppercase();
    if ABBREVIATIONS.contains(&token.as_str()) {
        return true;
    }
    token.contains('.') && token.chars().all(|c| c.is_ascii_digit() || c == '.')
}

fn is_sentence_boundary(text: &str) -> bool {
    let mut stripped = text.trim();
    loop {
        let Some(last) = stripped.chars().last() else {
            return false;
        };
        if !(last.is_whitespace()
            || matches!(
                last,
                '"' | '\''
                    | '“'
                    | '”'
                    | '‘'
                    | '’'
                    | '«'
                    | '»'
                    | '「'
                    | '」'
                    | '『'
                    | '』'
                    | '('
                    | ')'
                    | '（'
                    | '）'
                    | '['
                    | ']'
                    | '【'
                    | '】'
            ))
        {
            break;
        }
        stripped = &stripped[..stripped.len() - last.len_utf8()];
    }
    let Some(last) = stripped.chars().last() else {
        return false;
    };
    if matches!(last, '。' | '！' | '？' | '…' | '～' | '~' | '!' | '?') {
        return true;
    }
    if last == '.' {
        return !is_abbreviation(stripped);
    }
    false
}

fn update_quote_depth(depth: &mut i32, ch: char, prev: char, next: char) {
    if matches!(ch, '「' | '『' | '（' | '【' | '(' | '[' | '“' | '«') {
        *depth += 1;
        return;
    }
    if matches!(ch, '」' | '』' | '）' | '】' | ')' | ']' | '”' | '»') {
        if *depth > 0 {
            *depth -= 1;
        }
        return;
    }
    if ch != '"' && ch != '\'' {
        return;
    }
    if ch == '\'' && prev.is_alphanumeric() && next.is_alphanumeric() {
        return; // contraction, e.g. "I'm"
    }
    let prev_word = prev.is_alphanumeric();
    let next_word = next.is_alphanumeric();
    let prev_punct = matches!(prev, '.' | ',' | '!' | '?' | '…' | '。' | '！' | '？');
    if (prev_word || prev_punct) && !next_word {
        if *depth > 0 {
            *depth -= 1;
        }
    } else if !prev_word && next_word {
        *depth += 1;
    }
}

fn merge_cues_into_sentences(cues: &[SrtCue]) -> Vec<Sentence> {
    let mut sentences = Vec::new();
    let mut buffer: Vec<&SrtCue> = Vec::new();
    let mut quote_depth: i32 = 0;
    for cue in cues {
        buffer.push(cue);
        let text = cue_text(cue);
        let chars: Vec<char> = text.chars().collect();
        for (index, ch) in chars.iter().enumerate() {
            let prev = if index > 0 { chars[index - 1] } else { ' ' };
            let next = if index + 1 < chars.len() {
                chars[index + 1]
            } else {
                ' '
            };
            update_quote_depth(&mut quote_depth, *ch, prev, next);
        }
        let text = join_buffer(&buffer);
        let chars: usize = buffer.iter().map(|c| c.text.chars().count()).sum();
        if (quote_depth == 0 && is_sentence_boundary(&text))
            || chars >= MAX_CHARS_PER_SENTENCE
            || buffer.len() >= MAX_CUES_PER_SENTENCE
        {
            let first = buffer[0];
            let last = buffer[buffer.len() - 1];
            sentences.push(Sentence {
                start_ms: first.start_ms,
                end_ms: last.end_ms,
                text,
            });
            buffer.clear();
            quote_depth = 0;
        }
    }
    if !buffer.is_empty() {
        let first = buffer[0];
        let last = buffer[buffer.len() - 1];
        sentences.push(Sentence {
            start_ms: first.start_ms,
            end_ms: last.end_ms,
            text: join_buffer(&buffer),
        });
    }
    sentences
}

fn has_punctuation_signal(cues: &[SrtCue]) -> bool {
    if cues.is_empty() {
        return false;
    }
    let boundaries = cues
        .iter()
        .filter(|cue| is_sentence_boundary(&cue_text(cue)))
        .count();
    boundaries * 4 >= cues.len()
}

fn estimate_time_offset(primary: &[SrtCue], secondary: &[SrtCue]) -> i64 {
    let mut deltas = Vec::with_capacity(primary.len().min(secondary.len()));
    for i in 0..primary.len().min(secondary.len()) {
        deltas.push(secondary[i].start_ms - primary[i].start_ms);
    }
    if deltas.len() < 5 {
        return 0;
    }
    deltas.sort_unstable();
    let offset = deltas[deltas.len() / 2];
    offset.clamp(-30_000, 30_000)
}

fn emit_pair(buf_a: &[&SrtCue], buf_b: &[&SrtCue]) -> (Sentence, Option<Sentence>) {
    let build = |buf: &[&SrtCue]| Sentence {
        start_ms: buf.first().map_or(0, |c| c.start_ms),
        end_ms: buf.last().map_or(0, |c| c.end_ms),
        text: join_buffer(buf),
    };
    let a = build(buf_a);
    let b = if buf_b.is_empty() {
        None
    } else {
        Some(build(buf_b))
    };
    (a, b)
}

fn joint_segment(primary: &[SrtCue], secondary: &[SrtCue]) -> Vec<(Sentence, Option<Sentence>)> {
    let primary_signal = has_punctuation_signal(primary);
    let secondary_signal = has_punctuation_signal(secondary);

    let mut pairs: Vec<(Sentence, Option<Sentence>)> = Vec::new();
    let mut buf_a: Vec<&SrtCue> = Vec::new();
    let mut buf_b: Vec<&SrtCue> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);

    loop {
        if i >= primary.len() && j >= secondary.len() {
            break;
        }

        let text_a = join_buffer(&buf_a);
        let text_b = join_buffer(&buf_b);
        let a_bound = is_sentence_boundary(&text_a);
        let b_bound = is_sentence_boundary(&text_b);
        let a_cap = buf_a.len() >= MAX_CUES_PER_SENTENCE
            || text_a.chars().count() >= MAX_CHARS_PER_SENTENCE;
        let b_cap = buf_b.len() >= MAX_CUES_PER_SENTENCE
            || text_b.chars().count() >= MAX_CHARS_PER_SENTENCE;

        let flush = if primary_signal && secondary_signal {
            (a_bound && b_bound) || a_cap || b_cap
        } else if primary_signal || secondary_signal {
            let signal_bound = if primary_signal { a_bound } else { b_bound };
            let other_len = if primary_signal {
                buf_b.len()
            } else {
                buf_a.len()
            };
            (signal_bound && (other_len >= 2 || (a_bound && b_bound))) || a_cap || b_cap
        } else {
            a_cap || b_cap
        };

        if flush {
            if !buf_a.is_empty() {
                pairs.push(emit_pair(&buf_a, &buf_b));
            }
            buf_a.clear();
            buf_b.clear();
            continue;
        }

        if buf_a.is_empty() && i < primary.len() {
            buf_a.push(&primary[i]);
            i += 1;
        } else if buf_b.is_empty() && j < secondary.len() {
            buf_b.push(&secondary[j]);
            j += 1;
        } else if i >= primary.len() {
            // Primary exhausted: emit what we have, then drop the rest.
            if !buf_a.is_empty() {
                pairs.push(emit_pair(&buf_a, &buf_b));
            }
            buf_a.clear();
            buf_b.clear();
        } else {
            let a_end = buf_a.last().map_or(0, |c| c.end_ms);
            let b_end = buf_b.last().map_or(0, |c| c.end_ms);
            if a_end <= b_end {
                buf_a.push(&primary[i]);
                i += 1;
            } else {
                buf_b.push(&secondary[j]);
                j += 1;
            }
        }
    }

    if !buf_a.is_empty() {
        pairs.push(emit_pair(&buf_a, &buf_b));
    }
    pairs
}

fn align_sentences(
    primary: &[Sentence],
    secondary: &[Sentence],
) -> Vec<(Sentence, Option<Sentence>)> {
    let mut translations: Vec<Option<&str>> = vec![None; primary.len()];
    let mut j = 0usize;
    for i in 0..primary.len() {
        while j < secondary.len() && secondary[j].end_ms < primary[i].start_ms {
            j += 1;
        }
        if j >= secondary.len() {
            break;
        }
        if secondary[j].start_ms > primary[i].end_ms {
            continue;
        }
        let mut best = i;
        let mut best_overlap = 0i64;
        let mut k = i;
        while k < primary.len() && primary[k].start_ms <= secondary[j].end_ms {
            let overlap = primary[k].end_ms.min(secondary[j].end_ms)
                - primary[k].start_ms.max(secondary[j].start_ms);
            if overlap > best_overlap {
                best_overlap = overlap;
                best = k;
            }
            k += 1;
        }
        if translations[best].is_none() {
            translations[best] = Some(&secondary[j].text);
        }
        j += 1;
    }

    primary
        .iter()
        .enumerate()
        .map(|(index, sentence)| {
            let translation = translations[index].map(|text| Sentence {
                start_ms: 0,
                end_ms: 0,
                text: text.to_string(),
            });
            (sentence.clone(), translation)
        })
        .collect()
}

fn render_pairs(pairs: &[(Sentence, Option<Sentence>)]) -> String {
    let mut out = String::new();
    for (index, (sentence, translation)) in pairs.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}",
            index + 1,
            ms_to_srt_ts(sentence.start_ms as f64),
            ms_to_srt_ts(sentence.end_ms as f64),
            sentence.text
        ));
        if let Some(translation) = translation {
            let translation = translation.text.trim();
            if !translation.is_empty() {
                out.push('\n');
                out.push_str(translation);
            }
        }
        out.push_str("\n\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ytdlp_version_output_only_when_command_succeeds() {
        assert_eq!(
            ytdlp_version_from_output(true, b" 2026.08.19 "),
            Some("2026.08.19".to_string())
        );
        assert_eq!(ytdlp_version_from_output(false, b"2026.08.19"), None);
        assert_eq!(ytdlp_version_from_output(true, b" "), None);
    }

    #[test]
    fn extracts_video_id_from_common_urls() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=30").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(extract_video_id("not a url"), None);
    }

    #[test]
    fn parses_standard_srt() {
        let content = "\u{feff}1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,500 --> 00:00:04,000\nWorld line\nSecond line\n";
        let cues = parse_srt(content);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].start_ms, 1000);
        assert_eq!(cues[0].end_ms, 2000);
        assert_eq!(cues[0].text, "Hello");
        assert_eq!(cues[1].text, "World line\nSecond line");
    }

    #[test]
    fn merges_overlapping_secondary_cues() {
        let primary = vec![
            SrtCue {
                start_ms: 1000,
                end_ms: 3000,
                text: "First.".to_string(),
            },
            SrtCue {
                start_ms: 3000,
                end_ms: 5000,
                text: "Second.".to_string(),
            },
        ];
        let secondary = vec![
            SrtCue {
                start_ms: 1500,
                end_ms: 2500,
                text: "一。".to_string(),
            },
            SrtCue {
                start_ms: 6000,
                end_ms: 7000,
                text: "无匹配".to_string(),
            },
        ];
        let merged = merge_srt_cues(&primary, &secondary);
        assert!(merged.contains("First.\n一。"));
        assert!(merged.contains("Second.\n"));
        assert!(!merged.contains("无匹配"));
    }

    #[test]
    fn joins_cues_into_complete_sentences() {
        let primary = vec![
            SrtCue {
                start_ms: 1000,
                end_ms: 2000,
                text: "I went to the store".to_string(),
            },
            SrtCue {
                start_ms: 2000,
                end_ms: 3000,
                text: "and bought some milk.".to_string(),
            },
            SrtCue {
                start_ms: 3000,
                end_ms: 4000,
                text: "Then I left.".to_string(),
            },
        ];
        let sentences = merge_cues_into_sentences(&primary);
        assert_eq!(sentences.len(), 2);
        assert_eq!(
            sentences[0].text,
            "I went to the store and bought some milk."
        );
        assert_eq!(sentences[0].start_ms, 1000);
        assert_eq!(sentences[0].end_ms, 3000);
        assert_eq!(sentences[1].text, "Then I left.");
    }

    #[test]
    fn detects_sentence_boundaries() {
        assert!(is_sentence_boundary("Hello."));
        assert!(is_sentence_boundary("Really?"));
        assert!(is_sentence_boundary("Wow!"));
        assert!(is_sentence_boundary("他走了。"));
        assert!(is_sentence_boundary("そうですね。"));
        assert!(!is_sentence_boundary("keep going"));
        assert!(!is_sentence_boundary("He saw Dr."));
        assert!(!is_sentence_boundary("U.S."));
        assert!(!is_sentence_boundary("3.5"));
        assert!(is_sentence_boundary("速度是3.5米。"));
        assert!(is_sentence_boundary("That's all."));
    }

    #[test]
    fn attaches_spanning_translation_to_best_overlap() {
        let primary = vec![
            SrtCue {
                start_ms: 1000,
                end_ms: 3000,
                text: "First sentence.".to_string(),
            },
            SrtCue {
                start_ms: 3000,
                end_ms: 5000,
                text: "Second sentence.".to_string(),
            },
        ];
        let secondary = vec![SrtCue {
            start_ms: 2800,
            end_ms: 4800,
            text: "两句合译。".to_string(),
        }];
        let merged = merge_srt_cues(&primary, &secondary);
        let cues = parse_srt(&merged);
        assert_eq!(cues.len(), 2);
        assert!(!cues[0].text.contains("两句合译"));
        assert!(cues[1].text.contains("Second sentence.\n两句合译"));
    }

    #[test]
    fn leaves_translation_empty_when_tracks_drift() {
        let primary = vec![SrtCue {
            start_ms: 1000,
            end_ms: 2000,
            text: "Here.".to_string(),
        }];
        let secondary = vec![SrtCue {
            start_ms: 9000,
            end_ms: 10000,
            text: "差距太大。".to_string(),
        }];
        let merged = merge_srt_cues(&primary, &secondary);
        assert!(merged.contains("Here.\n\n"));
        assert!(!merged.contains("差距太大"));
    }

    #[test]
    fn continues_sentences_across_cue_boundaries_inside_quotes() {
        let primary = vec![
            SrtCue {
                start_ms: 1000,
                end_ms: 2000,
                text: "He said, \"I'm fine.".to_string(),
            },
            SrtCue {
                start_ms: 2000,
                end_ms: 3000,
                text: "She left.\"".to_string(),
            },
        ];
        let sentences = merge_cues_into_sentences(&primary);
        assert_eq!(sentences.len(), 1);
        assert_eq!(sentences[0].text, "He said, \"I'm fine. She left.\"");
    }

    #[test]
    fn anchors_no_punctuation_track_on_translation_boundaries() {
        let primary = vec![
            SrtCue {
                start_ms: 0,
                end_ms: 2000,
                text: "One two".to_string(),
            },
            SrtCue {
                start_ms: 2000,
                end_ms: 4000,
                text: "three four".to_string(),
            },
            SrtCue {
                start_ms: 4000,
                end_ms: 6000,
                text: "five six".to_string(),
            },
            SrtCue {
                start_ms: 6000,
                end_ms: 8000,
                text: "seven eight".to_string(),
            },
        ];
        let secondary = vec![
            SrtCue {
                start_ms: 0,
                end_ms: 4000,
                text: "一二。".to_string(),
            },
            SrtCue {
                start_ms: 4000,
                end_ms: 8000,
                text: "三四。".to_string(),
            },
        ];
        let merged = merge_srt_cues(&primary, &secondary);
        let cues = parse_srt(&merged);
        assert_eq!(cues.len(), 2);
        assert!(cues[0].text.contains("One two three four"));
        assert!(cues[0].text.contains("一二。"));
        assert!(cues[1].text.contains("five six seven eight"));
        assert!(cues[1].text.contains("三四。"));
    }

    #[test]
    fn corrects_global_time_offset_between_tracks() {
        let primary: Vec<SrtCue> = (0..6)
            .map(|i| SrtCue {
                start_ms: 1000 + i * 2000,
                end_ms: 2000 + i * 2000,
                text: format!("Sentence {}.", i + 1),
            })
            .collect();
        let secondary: Vec<SrtCue> = (0..6)
            .map(|i| SrtCue {
                start_ms: 6500 + i * 2000,
                end_ms: 7500 + i * 2000,
                text: format!("第{}句。", i + 1),
            })
            .collect();
        let merged = merge_srt_cues(&primary, &secondary);
        for i in 0..6 {
            assert!(merged.contains(&format!("Sentence {}.\n第{}句。", i + 1, i + 1)));
        }
    }

    #[test]
    fn converts_json3_to_srt() {
        let content = r#"{"events":[{"tStartMs":0,"dDurationMs":2000,"segs":[{"utf8":"Hello world"}]},{"tStartMs":2000,"dDurationMs":1000,"segs":[{"utf8":"Bye"}]}]}"#;
        let srt = json3_to_srt(content).unwrap();
        assert!(srt.contains("00:00:00,000 --> 00:00:02,000"));
        assert!(srt.contains("Hello world"));
        assert!(srt.contains("00:00:02,000 --> 00:00:03,000"));
    }

    #[test]
    fn extracts_player_response_json() {
        let html = "var ytInitialPlayerResponse = {\"a\":{\"b\":\"c}\"}};window.x=1;";
        let json = extract_initial_player_response(html).unwrap();
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn real_download_and_merge() {
        let url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        let job = DownloadJob {
            app: None,
            job_id: 0,
            token: Arc::new(AtomicBool::new(false)),
        };
        let primary = download_sub_with_job(&job, 0.0, 100.0, url, "ja", false)
            .await
            .expect("download ja");
        let secondary = download_sub_with_job(&job, 0.0, 100.0, url, "en", false)
            .await
            .expect("download en");
        assert!(!primary.content.trim().is_empty());
        assert!(!secondary.content.trim().is_empty());
        let cues_a = parse_srt(&primary.content);
        let cues_b = parse_srt(&secondary.content);
        assert!(!cues_a.is_empty());
        assert!(!cues_b.is_empty());
        let merged = merge_srt_cues(&cues_a, &cues_b);
        let merged_cues = parse_srt(&merged);
        assert!(merged_cues.len() <= cues_a.len());
        assert!(merged.contains("-->"));
        assert!(
            merged_cues.iter().any(|cue| cue.text.contains('\n')),
            "expected at least one bilingual cue, got:\n{}",
            merged.lines().take(12).collect::<Vec<_>>().join("\n")
        );
    }

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn real_auto_subtitle_download() {
        let url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        let job = DownloadJob {
            app: None,
            job_id: 3,
            token: Arc::new(AtomicBool::new(false)),
        };
        let auto = download_sub_with_job(&job, 0.0, 100.0, url, "zh-Hans", true)
            .await
            .expect("download zh-Hans auto subtitle");
        assert!(!auto.content.trim().is_empty());
        let cues = parse_srt(&auto.content);
        assert!(!cues.is_empty());
        let has_han = auto
            .content
            .chars()
            .any(|c| matches!(c, '\u{3400}'..='\u{9FFF}'));
        assert!(has_han, "auto zh-Hans subtitle should contain Chinese text");
    }

    #[test]
    fn maps_common_ytdlp_errors_to_friendly_messages() {
        assert!(friendly_ytdlp_error("ERROR: HTTP Error 429: Too Many Requests").contains("429"));
        assert!(friendly_ytdlp_error("Sign in to confirm you're not a bot").contains("机器人"));
        assert!(friendly_ytdlp_error("ERROR: Video unavailable").contains("不可用"));
        assert!(friendly_ytdlp_error("This video is private").contains("私密"));
        assert!(
            friendly_ytdlp_error("There are no subtitles for the requested languages")
                .contains("没有可用字幕")
        );
        assert!(friendly_ytdlp_error("Some other weird error").contains("yt-dlp 出错"));
        assert!(friendly_ytdlp_error("HTTP Error 403: Forbidden").contains("403"));
    }

    #[test]
    fn cancel_token_flips_immediately() {
        let job = DownloadJob {
            app: None,
            job_id: 1,
            token: Arc::new(AtomicBool::new(false)),
        };
        assert!(!job.cancelled());
        job.token.store(true, Ordering::Relaxed);
        assert!(job.cancelled());
    }

    #[test]
    fn classifies_transient_errors() {
        assert!(!is_transient_error("HTTP Error 429: Too Many Requests"));
        assert!(!is_transient_error("YouTube 限制了字幕请求（HTTP 429）。"));
        assert!(!is_transient_error("HTTP Error 403: Forbidden"));
        assert!(is_transient_error("yt-dlp 执行超时，已终止。"));
        assert!(is_transient_error("请求 YouTube 失败：connect timeout"));
        assert!(!is_transient_error("该视频没有可用字幕。"));
        assert!(!is_transient_error(
            "视频不可用（可能已删除、设为私密或受地区限制）。"
        ));
    }

    #[test]
    fn subtitle_file_lookup_prefers_exact_lang_match() {
        let dir = std::env::temp_dir().join(format!("lexicue-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("video.en-orig.srt"), "x").unwrap();
        std::fs::write(dir.join("video.en.srt"), "y").unwrap();

        // Requesting "en" must not match the "en-orig" file.
        let found = find_subtitle_file(&dir, "video", "en").expect("exact match should be found");
        assert_eq!(found.file_name().unwrap().to_str(), Some("video.en.srt"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn chooses_direct_srt_before_other_caption_formats() {
        let json = serde_json::json!({
            "automatic_captions": {
                "zh-Hans": [
                    { "ext": "json3", "url": "json-url" },
                    { "ext": "srt", "url": "srt-url" },
                    { "ext": "vtt", "url": "vtt-url" }
                ]
            }
        });
        assert_eq!(
            choose_subtitle_format(&json, "zh-Hans", true),
            Some(("srt".to_string(), "srt-url".to_string()))
        );
        assert_eq!(choose_subtitle_format(&json, "en", true), None);
    }

    #[tokio::test]
    #[ignore = "hits the network"]
    async fn cancel_kills_ytdlp_subprocess() {
        let job = DownloadJob {
            app: None,
            job_id: 2,
            token: Arc::new(AtomicBool::new(true)),
        };
        let mut cmd = tokio::process::Command::new(ytdlp_path().expect("yt-dlp not found"));
        cmd.arg("--skip-download")
            .arg("--no-playlist")
            .arg("-J")
            .arg("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        let started = std::time::Instant::now();
        let result = run_ytdlp(&mut cmd, &job, DOWNLOAD_TIMEOUT).await;
        assert_eq!(result.expect_err("should cancel"), CANCELLED_MESSAGE);
        assert!(
            started.elapsed().as_secs() < 10,
            "cancellation should be quick, took {:?}",
            started.elapsed()
        );
    }
}
