//! One owner for subtitle downloads, retries, cancellation and durable partial results.
use super::*;
use sha2::{Digest, Sha256};
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, BufReader};

const CACHE_TTL: u64 = 24 * 60 * 60;
const CACHE_LIMIT: u64 = 100 * 1024 * 1024;
static DOWNLOAD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CACHE_LOCK: Mutex<()> = Mutex::new(());
static COOLDOWNS: OnceLock<Mutex<HashMap<String, tokio::time::Instant>>> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubtitleSource {
    Manual,
    Original,
    Translated,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct BrowserSession {
    pub enabled: bool,
    pub browser: String,
    pub profile: String,
}
impl Default for BrowserSession {
    fn default() -> Self {
        Self {
            enabled: false,
            browser: "chrome".into(),
            profile: String::new(),
        }
    }
}
impl BrowserSession {
    pub fn validate(&self) -> Result<(), String> {
        if self.enabled
            && (!matches!(
                self.browser.as_str(),
                "chrome"
                    | "chromium"
                    | "edge"
                    | "firefox"
                    | "safari"
                    | "brave"
                    | "opera"
                    | "vivaldi"
            ) || self.profile.contains(['\n', '\r', '\0', ':'])
                || self.profile.len() > 1024)
        {
            return Err("browser_session".into());
        }
        Ok(())
    }
    pub fn cache_identity(&self) -> String {
        if !self.enabled {
            return "anonymous".into();
        }
        digest(&format!("{}:{}", self.browser, self.profile.trim()))
    }
}

pub fn configure_session(
    cmd: &mut tokio::process::Command,
    session: &BrowserSession,
) -> Result<(), String> {
    session.validate()?;
    // Preserve proxy/user configuration, but never import/export a cookie file implicitly.
    cmd.arg("--no-cookies").arg("--no-cookies-from-browser");
    if session.enabled {
        let profile = session.profile.trim();
        cmd.arg("--cookies-from-browser")
            .arg(if profile.is_empty() {
                session.browser.clone()
            } else {
                format!("{}:{profile}", session.browser)
            });
    }
    if let Some(deno) = tool_path("deno") {
        cmd.arg("--js-runtimes")
            .arg(format!("deno:{}", deno.display()));
    }
    Ok(())
}

pub fn player_track(lang: &str, automatic: bool) -> SubtitleTrack {
    SubtitleTrack {
        lang: lang.into(),
        language: lang.into(),
        is_auto: automatic,
        source: if automatic {
            SubtitleSource::Original
        } else {
            SubtitleSource::Manual
        },
        source_language: Some(lang.into()),
    }
}

pub fn metadata_track(lang: &str, automatic: bool, entries: &serde_json::Value) -> SubtitleTrack {
    let mut target = None;
    let mut origin = None;
    let mut has_url = false;
    if let Some(entries) = entries.as_array() {
        for entry in entries {
            if let Some(url) = entry["url"]
                .as_str()
                .and_then(|url| reqwest::Url::parse(url).ok())
            {
                has_url = true;
                for (key, value) in url.query_pairs() {
                    if key == "tlang" && !value.is_empty() {
                        target = Some(value.into_owned());
                    } else if key == "lang" && !value.is_empty() {
                        origin = Some(value.into_owned());
                    }
                }
            }
        }
    }
    let source = if !automatic {
        SubtitleSource::Manual
    } else if target.is_some() {
        SubtitleSource::Translated
    } else if lang.ends_with("-orig") || has_url && origin.is_some() {
        SubtitleSource::Original
    } else {
        SubtitleSource::Unknown
    };
    let language = target.unwrap_or_else(|| {
        if source == SubtitleSource::Original {
            origin
                .clone()
                .unwrap_or_else(|| lang.trim_end_matches("-orig").into())
        } else {
            lang.into()
        }
    });
    SubtitleTrack {
        lang: lang.into(),
        is_auto: automatic,
        language,
        source,
        source_language: origin,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadError {
    pub code: String,
    pub stage: String,
    pub role: String,
    pub language: String,
    pub source: SubtitleSource,
    pub retryable: bool,
    pub cooldown_seconds: u64,
}
impl DownloadError {
    pub fn from_message(message: &str, role: &str, language: &str, source: SubtitleSource) -> Self {
        let lower = message.to_lowercase();
        let code = if lower == "cancelled" || lower.contains("err_cancelled") {
            "cancelled"
        } else if lower == "rate_limited"
            || lower.contains("429")
            || lower.contains("too many requests")
        {
            "rate_limited"
        } else if lower.contains("cookie")
            || lower.contains("keychain")
            || lower.contains("decrypt")
            || lower == "browser_session"
        {
            "browser_session"
        } else if lower == "access_denied"
            || lower.contains("403")
            || lower.contains("not a bot")
            || lower.contains("sign in")
        {
            "access_denied"
        } else if lower.contains("未找到 yt-dlp") || lower == "missing_tool" {
            "missing_tool"
        } else if lower.contains("invalid_url") {
            "invalid_url"
        } else if lower.contains("timeout")
            || lower.contains("超时")
            || lower.contains("timed out")
            || lower.contains("connection")
            || lower.contains("连接")
            || lower.contains("network")
            || [
                "http error 500",
                "http error 502",
                "http error 503",
                "http error 504",
            ]
            .iter()
            .any(|message| lower.contains(message))
            || lower.contains("unable to download webpage")
        {
            "network"
        } else if lower.contains("unavailable")
            || lower.contains("private")
            || lower.contains("no subtitles")
            || lower.contains("未找到")
            || lower.contains("为空")
        {
            "unavailable"
        } else {
            "download_failed"
        };
        Self {
            code: code.into(),
            stage: "download".into(),
            role: role.into(),
            language: language.into(),
            source,
            retryable: matches!(code, "network" | "rate_limited" | "download_failed"),
            cooldown_seconds: if code == "rate_limited" { 60 } else { 0 },
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PreparedSubtitles {
    Complete {
        subtitle: SubtitleResult,
    },
    Partial {
        primary: SubtitleResult,
        error: DownloadError,
    },
}
impl PreparedSubtitles {
    pub fn into_complete(self) -> Result<SubtitleResult, DownloadError> {
        match self {
            Self::Complete { subtitle } => Ok(subtitle),
            Self::Partial { error, .. } => Err(error),
        }
    }
}

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_subtitle(content: &str) -> bool {
    let cues = parse_srt(content);
    !cues.is_empty()
        && cues
            .iter()
            .all(|cue| cue.end_ms > cue.start_ms && !cue.text.trim().is_empty())
}
#[derive(Serialize, Deserialize)]
struct CachedSubtitle {
    key: String,
    created: u64,
    used: u64,
    subtitle: SubtitleResult,
}
fn cache_key(video: &str, track: &SubtitleTrack, session: &BrowserSession) -> String {
    digest(&format!(
        "v1:{video}:{}:{:?}:{}",
        track.lang,
        track.source,
        session.cache_identity()
    ))
}
fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("youtube-subtitles"))
        .map_err(|_| "cache_unavailable".into())
}
fn prune_cache(dir: &Path, now: u64, limit: u64) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let cached = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<CachedSubtitle>(&bytes).ok());
        match cached {
            Some(item)
                if now.saturating_sub(item.created) < CACHE_TTL
                    && item.created <= now
                    && valid_subtitle(&item.subtitle.content) =>
            {
                files.push((item.used, entry.metadata()?.len(), path));
            }
            _ => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    files.sort_by_key(|(used, _, _)| *used);
    let mut total: u64 = files.iter().map(|(_, size, _)| size).sum();
    for (_, size, path) in files {
        if total <= limit {
            break;
        }
        std::fs::remove_file(path)?;
        total = total.saturating_sub(size);
    }
    Ok(())
}
fn write_cache_file(dir: &Path, item: &CachedSubtitle) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(item)?;
    let temporary = dir.join(format!("{}.{}.tmp", item.key, uuid::Uuid::new_v4()));
    std::fs::write(&temporary, bytes)?;
    let destination = dir.join(format!("{}.json", item.key));
    #[cfg(windows)]
    if destination.exists() {
        std::fs::remove_file(&destination)?;
    }
    let result = std::fs::rename(&temporary, destination);
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
fn read_cached(dir: &Path, key: &str, now: u64) -> Option<SubtitleResult> {
    let _lock = CACHE_LOCK.lock().ok()?;
    prune_cache(dir, now, CACHE_LIMIT).ok()?;
    let mut cached: CachedSubtitle =
        serde_json::from_slice(&std::fs::read(dir.join(format!("{key}.json"))).ok()?).ok()?;
    if cached.key != key {
        return None;
    }
    cached.used = now;
    let _ = write_cache_file(dir, &cached);
    Some(cached.subtitle)
}
fn save_cached(dir: &Path, key: &str, subtitle: &SubtitleResult) -> std::io::Result<()> {
    let _lock = CACHE_LOCK
        .lock()
        .map_err(|_| std::io::Error::other("cache lock"))?;
    if !valid_subtitle(&subtitle.content) {
        return Err(std::io::Error::other("invalid subtitle"));
    }
    std::fs::create_dir_all(dir)?;
    write_cache_file(
        dir,
        &CachedSubtitle {
            key: key.into(),
            created: timestamp(),
            used: timestamp(),
            subtitle: subtitle.clone(),
        },
    )?;
    prune_cache(dir, timestamp(), CACHE_LIMIT)
}
pub fn init_subtitle_cache(app: &AppHandle) {
    if let Ok(dir) = cache_dir(app) {
        if let Ok(_lock) = CACHE_LOCK.lock() {
            let _ = prune_cache(&dir, timestamp(), CACHE_LIMIT);
        }
    }
}
#[tauri::command]
pub fn youtube_clear_subtitle_cache(app: AppHandle) -> Result<(), String> {
    let _lock = CACHE_LOCK.lock().map_err(|_| "cache_unavailable")?;
    let dir = cache_dir(&app)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|_| "cache_unavailable")?;
    }
    Ok(())
}

fn progress(
    job: &DownloadJob,
    stage: &str,
    role: &str,
    track: &SubtitleTrack,
    remaining: Option<u64>,
) {
    if let Some(app) = &job.app {
        let _ = app.emit(
            "youtube-progress",
            serde_json::json!({
                "jobId": job.job_id, "status": "processing", "stage": stage, "role": role,
                "language": track.language, "source": track.source, "remainingSeconds": remaining,
                "percent": if role == "secondary" { 55 } else { 10 }, "message": ""
            }),
        );
    }
}
fn seconds_left(duration: Duration) -> u64 {
    duration.as_secs() + u64::from(duration.subsec_nanos() > 0)
}
fn subtitle_wait(source: SubtitleSource) -> u64 {
    if matches!(source, SubtitleSource::Translated | SubtitleSource::Unknown) {
        60
    } else {
        0
    }
}

struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        cleanup_dir(&self.0);
    }
}

async fn capture_download(
    cmd: &mut tokio::process::Command,
    job: &DownloadJob,
    role: &str,
    track: &SubtitleTrack,
    timeout: Duration,
) -> Result<(std::process::ExitStatus, String), String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| spawn_error(&error))?;
    let stdout = child.stdout.take().ok_or("download_failed")?;
    let stderr = child.stderr.take().ok_or("download_failed")?;
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx.send(line).await.is_err() {
                break;
            }
        }
    });
    let error_reader = tokio::spawn(async move {
        let mut data = Vec::new();
        let mut stderr = stderr;
        let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut data).await;
        String::from_utf8_lossy(&data).into_owned()
    });
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    let mut waiting_until = None;
    let mut reading = true;
    let result = loop {
        tokio::select! {
            biased;
            _ = job.cancel_signal() => break Err(CANCELLED_MESSAGE.into()),
            _ = &mut deadline => break Err("timeout".into()),
            status = child.wait() => break status.map_err(|_| "download_failed".into()),
            line = rx.recv(), if reading => {
                if let Some(line) = line {
                    if line.contains("[download] Sleeping") {
                        waiting_until = Some(tokio::time::Instant::now() + Duration::from_secs(subtitle_wait(track.source)));
                        progress(job, "waiting", role, track, Some(subtitle_wait(track.source)));
                    } else if line.contains("[download] Destination") {
                        waiting_until = None;
                        progress(job, "downloading", role, track, None);
                    }
                } else { reading = false; }
            }
            _ = ticker.tick(), if waiting_until.is_some() => {
                let left = waiting_until.unwrap().saturating_duration_since(tokio::time::Instant::now());
                let left = seconds_left(left);
                progress(job, if left > 0 { "waiting" } else { "downloading" }, role, track, Some(left));
                if left == 0 { waiting_until = None; }
            }
        }
    };
    drop(rx);
    if result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        reader.abort();
        error_reader.abort();
    }
    let _ = reader.await;
    let stderr = error_reader.await.unwrap_or_default();
    result.map(|status| (status, stderr))
}

async fn native_track_at(
    job: &DownloadJob,
    video: &str,
    track: &SubtitleTrack,
    session: &BrowserSession,
    role: &str,
    timeout: Duration,
    path: &Path,
) -> Result<SubtitleResult, DownloadError> {
    let fail =
        |message: &str| DownloadError::from_message(message, role, &track.language, track.source);
    let dir = TempDir(create_temp_dir().map_err(|_| fail("download_failed"))?);
    let mut cmd = tokio::process::Command::new(path);
    configure_session(&mut cmd, session).map_err(|message| fail(&message))?;
    cmd.args([
        "--skip-download",
        "--no-playlist",
        "--no-simulate",
        "--no-progress",
        "--no-quiet",
        "--newline",
        "--retries",
        "0",
        "--extractor-retries",
        "0",
        "--fragment-retries",
        "0",
        "--file-access-retries",
        "0",
        "--no-write-subs",
        "--no-write-auto-subs",
        "--sub-format",
    ])
    .arg(
        if matches!(
            track.source,
            SubtitleSource::Translated | SubtitleSource::Unknown
        ) {
            "vtt/json3/srt"
        } else {
            "srt/vtt/json3"
        },
    )
    .arg("--sleep-subtitles")
    .arg(subtitle_wait(track.source).to_string())
    .arg("--sub-langs")
    .arg(format!("^{}$", track.lang))
    .arg("--output")
    .arg(dir.0.join("%(id)s"))
    .arg(if track.is_auto {
        "--write-auto-subs"
    } else {
        "--write-subs"
    })
    .arg(format!("https://www.youtube.com/watch?v={video}"));
    progress(job, "extracting", role, track, None);
    let (status, stderr) = capture_download(&mut cmd, job, role, track, timeout)
        .await
        .map_err(|message| fail(&message))?;
    if !status.success() {
        return Err(fail(&stderr));
    }
    let path = find_subtitle_file(&dir.0, video, &track.lang)
        .or_else(|| {
            let path = dir.0.join(format!("{video}.{}.json3", track.lang));
            path.is_file().then_some(path)
        })
        .ok_or_else(|| fail("no subtitles"))?;
    let content = std::fs::read_to_string(&path).map_err(|_| fail("download_failed"))?;
    let content = match path.extension().and_then(|ext| ext.to_str()) {
        Some("vtt") => vtt_to_srt(&content),
        Some("json3") => json3_to_srt(&content).map_err(|_| fail("download_failed"))?,
        _ => content,
    };
    if !valid_subtitle(&content) {
        return Err(fail("no subtitles"));
    }
    Ok(SubtitleResult {
        name: format!("{video}.{}.srt", track.lang),
        content,
    })
}

async fn native_track(
    job: &DownloadJob,
    video: &str,
    track: &SubtitleTrack,
    session: &BrowserSession,
    role: &str,
    timeout: Duration,
) -> Result<SubtitleResult, DownloadError> {
    let path = ytdlp_path().ok_or_else(|| {
        DownloadError::from_message("missing_tool", role, &track.language, track.source)
    })?;
    native_track_at(job, video, track, session, role, timeout, &path).await
}

fn retry_allowed(error: &DownloadError, attempt: usize, remaining: Duration) -> bool {
    attempt == 0 && error.code == "network" && remaining > Duration::from_secs(2)
}

async fn managed_track(
    job: &DownloadJob,
    video: &str,
    track: &SubtitleTrack,
    session: &BrowserSession,
    dir: &Path,
    role: &str,
    deadline: tokio::time::Instant,
) -> Result<SubtitleResult, DownloadError> {
    let key = cache_key(video, track, session);
    if job.cancelled() {
        return Err(DownloadError::from_message(
            CANCELLED_MESSAGE,
            role,
            &track.language,
            track.source,
        ));
    }
    if let Some(subtitle) = read_cached(dir, &key, timestamp()) {
        progress(job, "cached", role, track, None);
        return Ok(subtitle);
    }
    let cooldowns = COOLDOWNS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(until) = cooldowns.lock().ok().and_then(|map| map.get(&key).copied()) {
        let remaining = until.saturating_duration_since(tokio::time::Instant::now());
        if !remaining.is_zero() {
            let mut error = DownloadError::from_message("429", role, &track.language, track.source);
            error.cooldown_seconds = seconds_left(remaining).max(1);
            return Err(error);
        }
    }
    for attempt in 0..2 {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(DownloadError::from_message(
                "timeout",
                role,
                &track.language,
                track.source,
            ));
        }
        match native_track(
            job,
            video,
            track,
            session,
            role,
            remaining.min(DOWNLOAD_TIMEOUT),
        )
        .await
        {
            Ok(subtitle) => {
                if save_cached(dir, &key, &subtitle).is_err() {
                    log::warn!("YouTube subtitle cache write failed");
                }
                return Ok(subtitle);
            }
            Err(error) => {
                if error.code == "rate_limited" {
                    if let Ok(mut map) = cooldowns.lock() {
                        map.insert(
                            key.clone(),
                            tokio::time::Instant::now() + Duration::from_secs(60),
                        );
                    }
                }
                if retry_allowed(
                    &error,
                    attempt,
                    deadline.saturating_duration_since(tokio::time::Instant::now()),
                ) {
                    progress(job, "retrying", role, track, Some(2));
                    tokio::select! { _ = job.cancel_signal() => return Err(DownloadError::from_message(CANCELLED_MESSAGE, role, &track.language, track.source)), _ = tokio::time::sleep(Duration::from_secs(2)) => {} }
                } else {
                    return Err(error);
                }
            }
        }
    }
    unreachable!()
}

async fn resolve_track(
    job: &DownloadJob,
    url: &str,
    selection: &TrackSelection,
    session: &BrowserSession,
    role: &str,
    deadline: tokio::time::Instant,
) -> Result<SubtitleTrack, DownloadError> {
    if selection.lang.is_empty()
        || !selection
            .lang
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(DownloadError::from_message(
            "no subtitles",
            role,
            &selection.lang,
            SubtitleSource::Unknown,
        ));
    }
    // Trust freshly read extractor metadata, never a caller-supplied origin flag.
    let json = fetch_ytdlp_json(
        Some(job),
        url,
        session,
        deadline
            .saturating_duration_since(tokio::time::Instant::now())
            .min(LIST_TIMEOUT),
    )
    .await
    .map_err(|message| {
        let mut error =
            DownloadError::from_message(&message, role, &selection.lang, SubtitleSource::Unknown);
        error.stage = "extracting".into();
        error
    })?;
    let group = if selection.is_auto {
        "automatic_captions"
    } else {
        "subtitles"
    };
    let entries = &json[group][&selection.lang];
    if !entries
        .as_array()
        .is_some_and(|entries| !entries.is_empty())
    {
        return Err(DownloadError::from_message(
            "no subtitles",
            role,
            &selection.lang,
            SubtitleSource::Unknown,
        ));
    }
    Ok(metadata_track(&selection.lang, selection.is_auto, entries))
}

#[tauri::command]
pub async fn youtube_prepare_subtitles(
    app: AppHandle,
    job_id: i64,
    url: String,
    primary: TrackSelection,
    secondary: Option<TrackSelection>,
    session: Option<BrowserSession>,
) -> Result<PreparedSubtitles, DownloadError> {
    let job = create_download_job(app.clone(), job_id);
    let _guard = JobGuard { job_id };
    let session = session.unwrap_or_default();
    let fail = |message: &str| {
        DownloadError::from_message(message, "primary", &primary.lang, SubtitleSource::Unknown)
    };
    session.validate().map_err(|message| fail(&message))?;
    let video = extract_video_id(&url).ok_or_else(|| fail("invalid_url"))?;
    if ytdlp_path().is_none() {
        return Err(fail("missing_tool"));
    }
    let dir = cache_dir(&app).map_err(|_| fail("download_failed"))?;
    let deadline = tokio::time::Instant::now() + OPERATION_TIMEOUT;
    let _serial = tokio::select! {
        _ = job.cancel_signal() => return Err(fail(CANCELLED_MESSAGE)),
        lock = tokio::time::timeout_at(deadline, DOWNLOAD_LOCK.lock()) => lock.map_err(|_| fail("timeout"))?,
    };
    let original = resolve_track(&job, &url, &primary, &session, "primary", deadline).await?;
    let sub_a = managed_track(&job, &video, &original, &session, &dir, "primary", deadline).await?;
    let Some(secondary) = secondary else {
        return Ok(PreparedSubtitles::Complete { subtitle: sub_a });
    };
    let translated =
        match resolve_track(&job, &url, &secondary, &session, "secondary", deadline).await {
            Ok(track) => track,
            Err(error) if error.code == "cancelled" => return Err(error),
            Err(error) => {
                return Ok(PreparedSubtitles::Partial {
                    primary: sub_a,
                    error,
                })
            }
        };
    match managed_track(
        &job,
        &video,
        &translated,
        &session,
        &dir,
        "secondary",
        deadline,
    )
    .await
    {
        Ok(sub_b) => {
            progress(&job, "merging", "secondary", &translated, None);
            Ok(PreparedSubtitles::Complete {
                subtitle: SubtitleResult {
                    name: format!("{video}.{}-{}.srt", primary.lang, secondary.lang),
                    content: merge_srt_cues(&parse_srt(&sub_a.content), &parse_srt(&sub_b.content)),
                },
            })
        }
        Err(error) if error.code == "cancelled" => Err(error),
        Err(error) => Ok(PreparedSubtitles::Partial {
            primary: sub_a,
            error,
        }),
    }
}

pub async fn tool_status() -> YtDlpStatus {
    let version = ytdlp_version_with_timeout().await;
    let path = ytdlp_path();
    let mut javascript = None;
    // The extractor's offline diagnostic reports bundled solver availability without cookies/network.
    let mut ejs = "unknown".to_string();
    if let Some(path) = &path {
        let mut cmd = tokio::process::Command::new(path);
        cmd.args(["--verbose", "--ignore-config"]);
        let _ = configure_session(&mut cmd, &BrowserSession::default());
        if let Ok((_, _, stderr)) = run_ytdlp_capture(&mut cmd, None, YTDLP_VERSION_TIMEOUT).await {
            if let Some(runtimes) = stderr
                .lines()
                .find_map(|line| line.strip_prefix("[debug] JS runtimes: "))
            {
                if runtimes != "none" {
                    javascript = Some(format!(
                        "{}{}",
                        runtimes,
                        tool_path("deno")
                            .map(|path| format!(" · {}", path.display()))
                            .unwrap_or_default()
                    ));
                }
            }
            if stderr.contains("yt_dlp_ejs") || stderr.contains("yt-dlp-ejs") {
                ejs = "available".into();
            } else if stderr.contains("Optional libraries:") {
                ejs = "missing".into();
            }
        }
    }
    YtDlpStatus {
        available: version.is_some(),
        version,
        path: path.map(|path| path.display().to_string()),
        javascript,
        ejs,
        ffmpeg: tool_path("ffmpeg").map(|path| path.display().to_string()),
    }
}

#[cfg(test)]
pub(super) async fn test_download(
    job: &DownloadJob,
    url: &str,
    lang: &str,
    is_auto: bool,
) -> Result<SubtitleResult, String> {
    let session = BrowserSession::default();
    let track = resolve_track(
        job,
        url,
        &TrackSelection {
            lang: lang.into(),
            is_auto,
        },
        &session,
        "primary",
        tokio::time::Instant::now() + OPERATION_TIMEOUT,
    )
    .await
    .map_err(|error| error.code)?;
    native_track(
        job,
        &extract_video_id(url).ok_or("invalid_url")?,
        &track,
        &session,
        "primary",
        DOWNLOAD_TIMEOUT,
    )
    .await
    .map_err(|error| error.code)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SRT: &str = "1\n00:00:00,000 --> 00:00:02,000\nHello.\n\n";
    fn job() -> DownloadJob {
        DownloadJob {
            app: None,
            job_id: -50,
            token: Arc::new(AtomicBool::new(false)),
        }
    }
    fn sample() -> SubtitleResult {
        SubtitleResult {
            name: "test.srt".into(),
            content: SRT.into(),
        }
    }

    #[tokio::test]
    async fn cancellation_before_registration_is_preserved_and_cleaned_up() {
        let id = -991;
        youtube_cancel_job(id).await.unwrap();
        let job = register_download_job(None, id);
        assert!(job.cancelled());
        drop(JobGuard { job_id: id });
        assert!(!download_registry().lock().unwrap().contains_key(&id));
    }

    #[test]
    fn countdown_uses_ceiling_without_waiting_in_tests() {
        assert_eq!(seconds_left(Duration::from_millis(59_999)), 60);
        assert_eq!(seconds_left(Duration::from_secs(59)), 59);
        assert_eq!(seconds_left(Duration::ZERO), 0);
    }

    #[tokio::test]
    #[ignore = "uses installed yt-dlp and public YouTube network resources"]
    async fn real_caption_kinds_smoke() {
        let session = BrowserSession::default();
        let info = list_subs_ytdlp("https://www.youtube.com/watch?v=dQw4w9WgXcQ", &session)
            .await
            .expect("public video metadata");
        for source in [
            SubtitleSource::Manual,
            SubtitleSource::Original,
            SubtitleSource::Translated,
        ] {
            if std::env::var("LEXICUE_SMOKE_TRANSLATION_ONLY").is_ok()
                && source != SubtitleSource::Translated
            {
                continue;
            }
            let target = if source == SubtitleSource::Translated {
                "zh-Hans"
            } else {
                "en"
            };
            let track = info
                .manual
                .iter()
                .chain(info.automatic.iter())
                .find(|track| track.source == source && track.language == target);
            if let Some(track) = track {
                let result = native_track(
                    &job(),
                    "dQw4w9WgXcQ",
                    track,
                    &session,
                    "primary",
                    DOWNLOAD_TIMEOUT,
                )
                .await;
                match &result {
                    Ok(subtitle) => eprintln!(
                        "{source:?} {}: {} cues",
                        track.lang,
                        parse_srt(&subtitle.content).len()
                    ),
                    Err(error) => eprintln!("{source:?} {}: {}", track.lang, error.code),
                }
                assert!(result.is_ok(), "{source:?} caption download failed");
            } else {
                eprintln!("{source:?}: not offered by public fixture");
            }
        }
    }

    #[test]
    fn distinguishes_original_translation_and_unknown_sources() {
        let original = metadata_track(
            "en-orig",
            true,
            &serde_json::json!([{ "url": "https://www.youtube.com/api/timedtext?lang=en", "ext": "vtt" }]),
        );
        assert_eq!(original.language, "en");
        assert_eq!(original.source, SubtitleSource::Original);
        let translated = metadata_track(
            "en-ja",
            true,
            &serde_json::json!([{ "url": "https://www.youtube.com/api/timedtext?lang=ja&tlang=en", "ext": "vtt" }]),
        );
        assert_eq!(translated.language, "en");
        assert_eq!(translated.source_language.as_deref(), Some("ja"));
        assert_eq!(translated.source, SubtitleSource::Translated);
        assert_eq!(
            metadata_track("zh-Hans", true, &serde_json::json!([{}])).source,
            SubtitleSource::Unknown
        );
        assert_eq!(
            metadata_track("zh-Hant", false, &serde_json::json!([{}])).source,
            SubtitleSource::Manual
        );
        assert_eq!(subtitle_wait(original.source), 0);
        assert_eq!(subtitle_wait(translated.source), 60);
        assert_eq!(subtitle_wait(SubtitleSource::Unknown), 60);
    }

    #[test]
    fn converts_vtt_without_collapsing_cues_or_retaining_timestamp_tags() {
        let vtt = "WEBVTT\nKind: captions\nLanguage: en\n\n1\n00:00.000 --> 00:00.000\n\n2\n00:00.000 --> 00:02.000 align:start\nHello <00:00.500><c>world.</c>\n\n3\n00:02.000 --> 00:04.000\nNext line.\nSecond row.\n";
        let converted = vtt_to_srt(vtt);
        let cues = parse_srt(&converted);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text, "Hello world.");
        assert_eq!(cues[1].text, "Next line.\nSecond row.");
        assert!(valid_subtitle(&converted));
    }

    #[test]
    fn access_limits_and_cancel_never_auto_retry() {
        for message in [
            "HTTP Error 429",
            "HTTP Error 403",
            "ERR_CANCELLED",
            "no subtitles",
            "could not decrypt cookies",
        ] {
            let error = DownloadError::from_message(
                message,
                "secondary",
                "zh-Hans",
                SubtitleSource::Translated,
            );
            assert!(!retry_allowed(&error, 0, Duration::from_secs(300)));
        }
        let network = DownloadError::from_message(
            "connection timed out",
            "primary",
            "en",
            SubtitleSource::Original,
        );
        assert!(retry_allowed(&network, 0, Duration::from_secs(3)));
        assert!(!retry_allowed(&network, 1, Duration::from_secs(300)));
        assert!(!retry_allowed(&network, 0, Duration::from_secs(2)));
    }

    #[test]
    fn browser_arguments_disable_implicit_cookies_and_isolate_cache() {
        let anonymous = BrowserSession::default();
        let mut command = tokio::process::Command::new("yt-dlp");
        configure_session(&mut command, &anonymous).unwrap();
        let arguments: Vec<_> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(arguments.contains(&"--no-cookies".into()));
        assert!(arguments.contains(&"--no-cookies-from-browser".into()));
        assert!(!arguments.contains(&"--cookies-from-browser".into()));
        let session = BrowserSession {
            enabled: true,
            browser: "firefox".into(),
            profile: "default".into(),
        };
        let track = player_track("en", true);
        assert_ne!(
            cache_key("video", &track, &anonymous),
            cache_key("video", &track, &session)
        );
        assert_ne!(
            cache_key("video", &track, &session),
            cache_key("another", &track, &session)
        );
        assert!(BrowserSession {
            browser: "unsupported".into(),
            ..session
        }
        .validate()
        .is_err());
    }

    #[test]
    fn cache_survives_reopen_then_expires_and_ignores_corruption() {
        let dir = tempfile::tempdir().unwrap();
        save_cached(dir.path(), "original", &sample()).unwrap();
        assert_eq!(
            read_cached(dir.path(), "original", timestamp())
                .unwrap()
                .content,
            SRT
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(read_cached(dir.path(), "original", timestamp() + CACHE_TTL).is_none());
        std::fs::write(dir.path().join("broken.json"), "not json").unwrap();
        assert!(read_cached(dir.path(), "broken", timestamp()).is_none());
        assert!(save_cached(
            dir.path(),
            "empty",
            &SubtitleResult {
                name: "empty".into(),
                content: "".into()
            }
        )
        .is_err());
    }

    #[test]
    fn capacity_cleanup_removes_least_recently_used_track() {
        let dir = tempfile::tempdir().unwrap();
        let now = timestamp();
        let old = CachedSubtitle {
            key: "old".into(),
            created: now,
            used: now - 10,
            subtitle: sample(),
        };
        let recent = CachedSubtitle {
            key: "recent".into(),
            created: now,
            used: now,
            subtitle: sample(),
        };
        write_cache_file(dir.path(), &old).unwrap();
        write_cache_file(dir.path(), &recent).unwrap();
        let size = std::fs::metadata(dir.path().join("recent.json"))
            .unwrap()
            .len();
        prune_cache(dir.path(), now, size).unwrap();
        assert!(!dir.path().join("old.json").exists());
        assert!(dir.path().join("recent.json").exists());
    }

    #[tokio::test]
    async fn cached_track_bypasses_network_and_cancel_prevents_cached_completion() {
        let dir = tempfile::tempdir().unwrap();
        let track = player_track("en", true);
        let session = BrowserSession::default();
        save_cached(dir.path(), &cache_key("video", &track, &session), &sample()).unwrap();
        let job = job();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(1);
        assert_eq!(
            managed_track(
                &job,
                "video",
                &track,
                &session,
                dir.path(),
                "primary",
                deadline
            )
            .await
            .unwrap()
            .content,
            SRT
        );
        job.token.store(true, Ordering::Relaxed);
        assert_eq!(
            managed_track(
                &job,
                "video",
                &track,
                &session,
                dir.path(),
                "primary",
                deadline
            )
            .await
            .unwrap_err()
            .code,
            "cancelled"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_and_timeout_kill_and_reap_child() {
        for cancel in [true, false] {
            let job = job();
            let token = job.token.clone();
            let mut cmd = tokio::process::Command::new("/bin/sh");
            cmd.args(["-c", "exec sleep 30"]);
            if cancel {
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    token.store(true, Ordering::Relaxed);
                });
            }
            let error = capture_download(
                &mut cmd,
                &job,
                "primary",
                &player_track("en", true),
                Duration::from_millis(150),
            )
            .await
            .unwrap_err();
            assert_eq!(error, if cancel { CANCELLED_MESSAGE } else { "timeout" });
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_download_uses_exact_track_and_wait_after_extraction_without_real_sleep() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("yt-dlp-mock");
        std::fs::write(&executable, r#"#!/bin/sh
output=''; language=''; wait=''; previous=''
for argument in "$@"; do
  case "$previous" in --output) output="$argument" ;; --sub-langs) language="$argument" ;; --sleep-subtitles) wait="$argument" ;; esac
  previous="$argument"
done
[ "$language" = '^zh-Hans$' ] && [ "$wait" = '60' ] || exit 2
echo '[youtube] extracting'
echo '[download] Sleeping 60.00 seconds ...'
directory="${output%/*}"
printf '1\n00:00:00,000 --> 00:00:02,000\nHello.\n\n' > "$directory/dQw4w9WgXcQ.zh-Hans.srt"
"#).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut track = player_track("zh-Hans", true);
        track.source = SubtitleSource::Translated;
        let result = native_track_at(
            &job(),
            "dQw4w9WgXcQ",
            &track,
            &BrowserSession::default(),
            "secondary",
            Duration::from_secs(2),
            &executable,
        )
        .await
        .unwrap();
        assert_eq!(result.content, SRT);
    }
}
