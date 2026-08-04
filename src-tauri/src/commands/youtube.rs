use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const CANCELLED_MESSAGE: &str = "ERR_CANCELLED";
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const LIST_TIMEOUT: Duration = Duration::from_secs(30);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(120);
const METADATA_TTL: Duration = Duration::from_secs(600);

#[derive(Serialize, Clone)]
pub struct SubtitleTrack {
    pub lang: String,
    pub is_auto: bool,
}

#[derive(Serialize)]
pub struct VideoSubInfo {
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<i64>,
    pub manual: Vec<SubtitleTrack>,
    pub automatic: Vec<SubtitleTrack>,
}

#[derive(Serialize)]
pub struct SubtitleResult {
    pub name: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct YtDlpStatus {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Deserialize)]
pub struct TrackSelection {
    pub lang: String,
    #[serde(default)]
    pub is_auto: bool,
}

fn ytdlp_version() -> Option<String> {
    let output = Command::new("yt-dlp").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
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
            automatic.push(SubtitleTrack {
                lang: lang.to_string(),
                is_auto: true,
            });
        } else {
            manual.push(SubtitleTrack {
                lang: lang.to_string(),
                is_auto: false,
            });
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
    fn progress(&self, status: &str, stage: &str, percent: f64, message: &str) {
        if let Some(app) = &self.app {
            let _ = app.emit(
                "youtube-progress",
                serde_json::json!({
                    "jobId": self.job_id,
                    "status": status,
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                }),
            );
        }
    }

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

fn create_download_job(app: AppHandle, job_id: i64) -> Arc<DownloadJob> {
    let job = Arc::new(DownloadJob {
        app: Some(app),
        job_id,
        token: Arc::new(AtomicBool::new(false)),
    });
    if let Ok(mut registry) = download_registry().lock() {
        registry.insert(job_id, job.clone());
    }
    job
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
    if let Ok(registry) = download_registry().lock() {
        if let Some(job) = registry.get(&job_id) {
            job.token.store(true, Ordering::Relaxed);
        }
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
        &["sign in to confirm you're not a bot", "not a bot", "bot check"],
        "YouTube 触发了机器人验证，请稍后重试或更换网络环境。",
    )
    .or_else(|| {
        pick(
            &["video unavailable", "this video isn't available"],
            "视频不可用（可能已删除、设为私密或受地区限制）。",
        )
    })
    .or_else(|| pick(&["video is private", "private video", "is private"], "该视频为私密视频，无法获取字幕。"))
    .or_else(|| {
        pick(
            &["only available to premium", "this video is only available"],
            "该视频受地区或会员限制。",
        )
    })
    .or_else(|| pick(&["http error 429", "too many requests"], "请求过于频繁（HTTP 429），请稍后重试。"))
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
            out_reader.abort();
            err_reader.abort();
            Err(CANCELLED_MESSAGE.to_string())
        }
        RunOutcome::Timeout => {
            let _ = child.kill().await;
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
) -> Result<serde_json::Value, String> {
    let video_id = extract_video_id(url).unwrap_or_else(|| "video".to_string());
    if let Some(json) = get_cached_metadata(&video_id) {
        return Ok(json);
    }
    let mut cmd = tokio::process::Command::new("yt-dlp");
    cmd.arg("--skip-download")
        .arg("--no-playlist")
        .arg("--dump-single-json")
        .arg(url);
    let (status, stdout, stderr) = run_ytdlp_capture(&mut cmd, cancel, LIST_TIMEOUT).await?;
    if !status.success() {
        return Err(friendly_ytdlp_error(&stderr));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&stdout).map_err(|error| format!("解析 yt-dlp 信息失败：{error}"))?;
    cache_metadata(&video_id, &json);
    Ok(json)
}

async fn list_subs_ytdlp(url: &str) -> Result<VideoSubInfo, String> {
    let json = fetch_ytdlp_json(None, url).await?;

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
                manual.push(SubtitleTrack {
                    lang: lang.clone(),
                    is_auto: false,
                });
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
                automatic.push(SubtitleTrack {
                    lang: lang.clone(),
                    is_auto: true,
                });
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
    let json_text =
        extract_initial_player_response(&html).ok_or("无法解析 YouTube 页面（视频可能不可用或需要登录）")?;
    let json: serde_json::Value =
        serde_json::from_str(&json_text).map_err(|e| format!("解析页面数据失败：{e}"))?;

    let title = json["videoDetails"]["title"].as_str().unwrap_or("视频").to_string();
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
pub async fn youtube_list_subs(url: String) -> Result<VideoSubInfo, String> {
    if ytdlp_version().is_some() {
        match list_subs_ytdlp(&url).await {
            Ok(info) => {
                if !info.manual.is_empty() || !info.automatic.is_empty() {
                    return Ok(info);
                }
                log::info!("yt-dlp 未发现字幕，尝试 HTTP 回退确认");
            }
            Err(e) => log::warn!("yt-dlp 列字幕失败，尝试 HTTP 回退：{e}"),
        }
    }
    list_subs_http(&url).await
}

fn create_temp_dir() -> Result<PathBuf, String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "lexicue-ytdlp-{}-{ts}",
        std::process::id()
    ));
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

async fn download_sub_ytdlp(
    job: &DownloadJob,
    base_percent: f64,
    span_percent: f64,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    let video_id = extract_video_id(url).unwrap_or_else(|| "video".to_string());
    let dir = create_temp_dir()?;
    let mut cmd = tokio::process::Command::new("yt-dlp");
    cmd.arg("--skip-download")
        .arg("--no-playlist")
        .arg("--retries")
        .arg("5")
        .arg("--sub-langs")
        .arg(lang)
        .arg("--sub-format")
        .arg("srt/best")
        .arg("--convert-subs")
        .arg("srt")
        .arg("-o")
        .arg(dir.join("%(id)s").to_string_lossy().to_string())
        .arg(url);
    if is_auto {
        cmd.arg("--write-auto-subs");
    } else {
        cmd.arg("--write-subs");
    }

    job.progress(
        "processing",
        "解析视频信息",
        base_percent + span_percent * 0.05,
        &format!("正在解析视频信息，准备下载字幕（{lang}）..."),
    );
    let (status, stderr) = match run_ytdlp(&mut cmd, job, DOWNLOAD_TIMEOUT).await {
        Ok(value) => value,
        Err(error) => {
            cleanup_dir(&dir);
            return Err(error);
        }
    };
    job.progress(
        "processing",
        "下载字幕轨",
        base_percent + span_percent * 0.6,
        &format!("正在下载字幕轨（{lang}）..."),
    );

    // Even if yt-dlp reported a non-zero exit, a subtitle file may still exist.
    let Some(path) = find_subtitle_file(&dir, &video_id, lang) else {
        cleanup_dir(&dir);
        if !status.success() {
            return Err(friendly_ytdlp_error(&stderr));
        }
        return Err(format!("未找到语言“{lang}”的字幕文件"));
    };
    job.progress(
        "processing",
        "处理字幕文件",
        base_percent + span_percent * 0.95,
        "正在整理字幕文件...",
    );
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let is_vtt = path.extension().and_then(|e| e.to_str()) == Some("vtt");
    let content = if is_vtt { vtt_to_srt(&content) } else { content };
    let name = format!("{video_id}.{lang}.srt");
    cleanup_dir(&dir);
    if content.trim().is_empty() {
        return Err(format!("语言“{lang}”的字幕内容为空"));
    }
    Ok(SubtitleResult { name, content })
}

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
        if let Some(format) = formats.iter().find(|item| {
            item["ext"].as_str() == Some(ext) && item["url"].as_str().is_some()
        }) {
            return Some((
                ext.to_string(),
                format["url"].as_str().unwrap_or_default().to_string(),
            ));
        }
    }
    None
}

async fn download_sub_ytdlp_direct(
    job: &DownloadJob,
    base_percent: f64,
    span_percent: f64,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    let video_id = extract_video_id(url).unwrap_or_else(|| "video".to_string());
    job.progress(
        "processing",
        "解析视频信息",
        base_percent + span_percent * 0.05,
        &format!("正在获取字幕地址（{lang}）..."),
    );
    let json = fetch_ytdlp_json(Some(job), url).await?;
    let Some((ext, subtitle_url)) = choose_subtitle_format(&json, lang, is_auto) else {
        return Err(if is_auto {
            format!("yt-dlp 未提供“{lang}”自动字幕的可下载格式")
        } else {
            format!("yt-dlp 未提供“{lang}”字幕的可下载格式")
        });
    };

    if job.cancelled() {
        return Err(CANCELLED_MESSAGE.to_string());
    }
    job.progress(
        "processing",
        "下载字幕轨",
        base_percent + span_percent * 0.6,
        &format!("正在直接下载字幕轨（{lang}）..."),
    );
    let client = youtube_client()?;
    let mut body = None;
    let mut last_status = None;
    for attempt in 0..2 {
        let response = client
            .get(&subtitle_url)
            .header("User-Agent", UA)
            .header("Accept", "text/plain, text/vtt, application/json, */*")
            .send()
            .await
            .map_err(|error| format!("下载字幕失败：{error}"))?;
        let status = response.status();
        last_status = Some(status);
        let text = response.text().await.unwrap_or_default();
        if status.is_success() && !text.trim().is_empty() {
            body = Some(text);
            break;
        }
        if status.as_u16() == 429 && attempt == 0 {
            job.progress(
                "processing",
                "重试",
                base_percent + span_percent * 0.3,
                "字幕地址受到限流，正在等待后重试...",
            );
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }
        if !status.is_success() {
            return Err(format!("字幕接口返回 HTTP {}", status.as_u16()));
        }
        return Err("字幕接口返回空内容".to_string());
    }
    let content = body.ok_or_else(|| {
        format!(
            "字幕下载失败（HTTP {}）",
            last_status.map(|status| status.as_u16()).unwrap_or_default()
        )
    })?;
    job.progress(
        "processing",
        "处理字幕文件",
        base_percent + span_percent * 0.95,
        "正在整理字幕文件...",
    );
    let content = match ext.as_str() {
        "srt" => content,
        "vtt" => vtt_to_srt(&content),
        "json3" | "srv3" | "srv2" | "srv1" => json3_to_srt(&content)?,
        "ttml" => return Err("字幕格式为 TTML，当前无法转换为 SRT".to_string()),
        _ => content,
    };
    if content.trim().is_empty() {
        return Err(format!("语言“{lang}”的字幕内容为空"));
    }
    Ok(SubtitleResult {
        name: format!("{video_id}.{lang}.srt"),
        content,
    })
}

async fn download_sub_ytdlp_preferred(
    job: &DownloadJob,
    base_percent: f64,
    span_percent: f64,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    match download_sub_ytdlp_direct(job, base_percent, span_percent, url, lang, is_auto).await {
        Ok(result) => Ok(result),
        Err(direct_error) => {
            log::warn!("直接下载字幕失败，回退到 yt-dlp 子进程：{direct_error}");
            download_sub_ytdlp(job, base_percent, span_percent, url, lang, is_auto).await
        }
    }
}

async fn download_sub_http(url: &str, lang: &str, is_auto: bool) -> Result<SubtitleResult, String> {
    let video_id = extract_video_id(url).ok_or("无法从 URL 解析视频 ID")?;
    let client = youtube_client()?;
    let html = client
        .get(format!("https://www.youtube.com/watch?v={video_id}"))
        .header("User-Agent", UA)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("请求 YouTube 失败：{e}"))?
        .text()
        .await
        .unwrap_or_default();
    let json_text =
        extract_initial_player_response(&html).ok_or("无法解析 YouTube 页面（视频可能不可用或需要登录）")?;
    let json: serde_json::Value =
        serde_json::from_str(&json_text).map_err(|e| format!("解析页面数据失败：{e}"))?;

    let tracks = json["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let base_url = tracks
        .iter()
        .find(|t| {
            t["languageCode"].as_str() == Some(lang)
                && (t["kind"].as_str() == Some("asr")) == is_auto
        })
        .or_else(|| tracks.iter().find(|t| t["languageCode"].as_str() == Some(lang)))
        .and_then(|t| t["baseUrl"].as_str())
        .map(String::from)
        .ok_or_else(|| {
            if is_auto {
                format!("网页端未列出“{lang}”的自动字幕轨（自动字幕列表可能不完整，建议安装 yt-dlp 后重试）")
            } else {
                format!("未找到语言“{lang}”的字幕轨")
            }
        })?;

    let url = format!("{base_url}&fmt=json3");
    let resp = client
        .get(&url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| format!("下载字幕失败：{e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("字幕接口返回 {status}"));
    }
    if text.trim().is_empty() {
        return Err("YouTube 未返回字幕内容。请安装 yt-dlp 后重试（网址字幕受 YouTube 会话保护，纯 HTTP 方式无法下载）".to_string());
    }
    let srt = json3_to_srt(&text).map_err(|e| e.to_string())?;
    if srt.trim().is_empty() {
        return Err("字幕内容为空".to_string());
    }
    Ok(SubtitleResult {
        name: format!("{video_id}.{lang}.srt"),
        content: srt,
    })
}

/// Transient failures worth one automatic retry before giving up.
fn is_transient_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("429")
        || lower.contains("too many requests")
        || lower.contains("403")
        || lower.contains("超时")
        || lower.contains("timeout")
        || lower.contains("connection")
        || lower.contains("连接")
        || lower.contains("请求 youtube 失败")
}

async fn download_sub_with_job(
    job: &DownloadJob,
    base_percent: f64,
    span_percent: f64,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    let mut ytdlp_error: Option<String> = None;

    if ytdlp_version().is_some() {
        let first = download_sub_ytdlp_preferred(job, base_percent, span_percent, url, lang, is_auto).await;
        match first {
            Ok(result) => return Ok(result),
            Err(error) if error == CANCELLED_MESSAGE => return Err(error),
            Err(error) => {
                log::warn!("yt-dlp 下载字幕失败：{error}");
                if is_transient_error(&error) && !job.cancelled() {
                    job.progress(
                        "processing",
                        "重试",
                        base_percent + span_percent * 0.3,
                        "遇到请求限制，正在自动重试...",
                    );
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    if job.cancelled() {
                        return Err(CANCELLED_MESSAGE.to_string());
                    }
                    match download_sub_ytdlp_preferred(job, base_percent, span_percent, url, lang, is_auto).await {
                        Ok(result) => return Ok(result),
                        Err(retry_error) if retry_error == CANCELLED_MESSAGE => {
                            return Err(retry_error);
                        }
                        Err(retry_error) => {
                            log::warn!("yt-dlp 重试仍失败：{retry_error}");
                            ytdlp_error = Some(retry_error);
                        }
                    }
                } else {
                    ytdlp_error = Some(error);
                }
            }
        }
    }

    if job.cancelled() {
        return Err(CANCELLED_MESSAGE.to_string());
    }

    match download_sub_http(url, lang, is_auto).await {
        Ok(result) => Ok(result),
        // When the HTTP fallback also fails, surface the more informative
        // yt-dlp error instead of the fallback's (often misleading) message.
        Err(http_error) => Err(ytdlp_error.unwrap_or(http_error)),
    }
}

fn finish_progress(job: &DownloadJob, result: &Result<SubtitleResult, String>) {
    match result {
        Ok(_) => job.progress("completed", "完成", 100.0, "字幕下载完成"),
        Err(error) if error == CANCELLED_MESSAGE => {
            job.progress("error", "已取消", 0.0, "操作已取消")
        }
        Err(error) => job.progress("error", "失败", 0.0, error),
    }
}

#[tauri::command]
pub async fn youtube_download_sub(
    app: AppHandle,
    job_id: i64,
    url: String,
    lang: String,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    let job = create_download_job(app, job_id);
    let _guard = JobGuard { job_id };
    let result = match tokio::time::timeout(
        OPERATION_TIMEOUT,
        download_sub_with_job(&job, 0.0, 100.0, &url, &lang, is_auto),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            job.token.store(true, Ordering::Relaxed);
            finish_progress(&job, &Err("操作超时（超过 2 分钟），请稍后重试。".to_string()));
            return Err("操作超时（超过 2 分钟），请稍后重试。".to_string());
        }
    };
    finish_progress(&job, &result);
    result
}

#[tauri::command]
pub async fn youtube_merge_subs(
    app: AppHandle,
    job_id: i64,
    url: String,
    primary: TrackSelection,
    secondary: TrackSelection,
) -> Result<SubtitleResult, String> {
    let job = create_download_job(app, job_id);
    let _guard = JobGuard { job_id };
    let body = async {
        let sub_a = download_sub_with_job(&job, 5.0, 35.0, &url, &primary.lang, primary.is_auto).await?;
        if job.cancelled() {
            return Err(CANCELLED_MESSAGE.to_string());
        }
        let sub_b = download_sub_with_job(&job, 40.0, 35.0, &url, &secondary.lang, secondary.is_auto).await?;
        job.progress(
            "processing",
            "合并字幕",
            95.0,
            "正在按时间轴合并双语字幕...",
        );
        let cues_a = parse_srt(&sub_a.content);
        let cues_b = parse_srt(&sub_b.content);
        if cues_a.is_empty() {
            return Err("主字幕解析为空，无法合并".to_string());
        }
        if cues_b.is_empty() {
            return Err("翻译字幕解析为空，无法合并".to_string());
        }
        let merged = merge_srt_cues(&cues_a, &cues_b);
        let video_id = extract_video_id(&url).unwrap_or_else(|| "video".to_string());
        Ok(SubtitleResult {
            name: format!("{video_id}.{}-{}.srt", primary.lang, secondary.lang),
            content: merged,
        })
    };

    let result = match tokio::time::timeout(OPERATION_TIMEOUT, body).await {
        Ok(result) => result,
        Err(_) => {
            job.token.store(true, Ordering::Relaxed);
            finish_progress(&job, &Err("操作超时（超过 2 分钟），请稍后重试。".to_string()));
            return Err("操作超时（超过 2 分钟），请稍后重试。".to_string());
        }
    };
    finish_progress(&job, &result);
    result
}

#[tauri::command]
pub fn youtube_ytdlp_status() -> YtDlpStatus {
    let version = ytdlp_version();
    YtDlpStatus {
        available: version.is_some(),
        version,
    }
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
    let events = json["events"]
        .as_array()
        .ok_or("字幕数据缺少 events")?;
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
    let mut out = String::new();
    let mut idx = 1u32;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("WEBVTT")
            || trimmed.starts_with("NOTE")
            || trimmed.starts_with("STYLE")
            || trimmed.starts_with("Kind:")
            || trimmed.starts_with("Language:")
            || trimmed.starts_with("X-TIMESTAMP")
        {
            continue;
        }
        if let Some(arrow) = trimmed.find("-->") {
            let start = vtt_ts_to_srt_ts(trimmed[..arrow].trim());
            let after = &trimmed[arrow + 3..];
            let end_raw = after.split_whitespace().next().unwrap_or("");
            let end = vtt_ts_to_srt_ts(end_raw);
            out.push_str(&format!("{idx}\n{start} --> {end}\n"));
            idx += 1;
        } else {
            out.push_str(trimmed);
            out.push('\n');
        }
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
    let mut out = String::new();
    let mut sec = 0usize;
    for (index, cue) in primary.iter().enumerate() {
        while sec < secondary.len() && secondary[sec].end_ms < cue.start_ms {
            sec += 1;
        }
        let mut translation: Option<&str> = None;
        if sec < secondary.len() {
            let candidate = &secondary[sec];
            if candidate.start_ms < cue.end_ms && candidate.end_ms > cue.start_ms {
                translation = Some(candidate.text.trim());
                if candidate.end_ms <= cue.end_ms {
                    sec += 1;
                }
            }
        }
        let src = cue.text.trim().replace('\n', " ");
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n",
            index + 1,
            ms_to_srt_ts(cue.start_ms as f64),
            ms_to_srt_ts(cue.end_ms as f64),
            src
        ));
        if let Some(zh) = translation {
            if !zh.is_empty() {
                out.push_str(zh);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
            SrtCue { start_ms: 1000, end_ms: 3000, text: "First".to_string() },
            SrtCue { start_ms: 3000, end_ms: 5000, text: "Second".to_string() },
        ];
        let secondary = vec![
            SrtCue { start_ms: 1500, end_ms: 2500, text: "一".to_string() },
            SrtCue { start_ms: 6000, end_ms: 7000, text: "无匹配".to_string() },
        ];
        let merged = merge_srt_cues(&primary, &secondary);
        assert!(merged.contains("First\n一"));
        assert!(merged.contains("Second\n"));
        assert!(!merged.contains("无匹配"));
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
        assert_eq!(merged_cues.len(), cues_a.len());
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
        let has_han = auto.content.chars().any(|c| matches!(c, '\u{3400}'..='\u{9FFF}'));
        assert!(has_han, "auto zh-Hans subtitle should contain Chinese text");
    }

    #[test]
    fn maps_common_ytdlp_errors_to_friendly_messages() {
        assert!(friendly_ytdlp_error("ERROR: HTTP Error 429: Too Many Requests").contains("429"));
        assert!(
            friendly_ytdlp_error("Sign in to confirm you're not a bot").contains("机器人")
        );
        assert!(friendly_ytdlp_error("ERROR: Video unavailable").contains("不可用"));
        assert!(friendly_ytdlp_error("This video is private").contains("私密"));
        assert!(friendly_ytdlp_error("There are no subtitles for the requested languages").contains("没有可用字幕"));
        assert!(friendly_ytdlp_error("Some other weird error").contains("yt-dlp 出错"));
        assert!(
            friendly_ytdlp_error("HTTP Error 403: Forbidden").contains("403")
        );
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
        assert!(is_transient_error("HTTP Error 429: Too Many Requests"));
        assert!(is_transient_error("请求过于频繁（HTTP 429），请稍后重试。"));
        assert!(is_transient_error("HTTP Error 403: Forbidden"));
        assert!(is_transient_error("yt-dlp 执行超时，已终止。"));
        assert!(is_transient_error("请求 YouTube 失败：connect timeout"));
        assert!(!is_transient_error("该视频没有可用字幕。"));
        assert!(!is_transient_error("视频不可用（可能已删除、设为私密或受地区限制）。"));
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
        let mut cmd = tokio::process::Command::new("yt-dlp");
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
