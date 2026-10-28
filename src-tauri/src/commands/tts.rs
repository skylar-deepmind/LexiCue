//! English Edge Read Aloud synthesis. Cache and requests are independent of learning data.
use base64::{engine::general_purpose::STANDARD, Engine};
use msedge_tts::tts::{client::tokio_runtime::connect_async, SpeechConfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tokio::sync::{watch, Notify};
use unicode_normalization::UnicodeNormalization;

const FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
const CACHE_VERSION: u32 = 1;
const MAX_CACHE_BYTES: u64 = 100 * 1024 * 1024;
const WAIT_BUDGET: Duration = Duration::from_secs(8);
const MAX_AUDIO_BYTES: usize = 4_000_000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TtsRequest {
    pub request_id: String,
    pub text: String,
    pub kind: String,
    pub accent: String,
    pub voice: String,
    pub speed: String,
    pub online_enabled: bool,
}
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct TtsError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
impl TtsError {
    fn new(code: &str, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            retryable,
        }
    }
    fn cancelled() -> Self {
        Self::new("cancelled", false)
    }
}
#[derive(Clone, Serialize, Debug)]
pub struct TtsAudio {
    pub data_base64: String,
    pub mime: String,
    pub cache_key: String,
    pub source: String,
    pub voice: String,
    pub speed: String,
    pub duration_ms: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CacheEntry {
    version: u32,
    checksum: String,
    duration_ms: u64,
    metadata_end_ms: u64,
    voice: String,
    speed: String,
    last_used: u64,
    completed: bool,
}
struct Job {
    key: String,
    online_enabled: bool,
    cancel: Notify,
    cancelled: std::sync::atomic::AtomicBool,
    result: watch::Sender<Option<Result<TtsAudio, TtsError>>>,
}
impl Job {
    fn stop(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.cancel.notify_waiters();
    }
    fn stopped(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[derive(Default)]
struct Control {
    latest: String,
    active: Option<Arc<Job>>,
    cancelled_ids: VecDeque<String>,
    epoch: u64,
}
pub struct TtsService {
    root: PathBuf,
    control: Mutex<Control>,
    gate: tokio::sync::Mutex<()>,
    files: Mutex<()>,
    #[cfg(test)]
    transport: Mutex<Option<Arc<TestTransport>>>,
}
#[cfg(test)]
struct TestTransport {
    bytes: Vec<u8>,
    metadata_end_ms: u64,
    delay_ms: u64,
    calls: std::sync::atomic::AtomicUsize,
    error: Option<TtsError>,
}
static SERVICE: OnceLock<Arc<TtsService>> = OnceLock::new();
impl TtsService {
    pub fn new(root: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            root,
            control: Mutex::new(Control::default()),
            gate: tokio::sync::Mutex::new(()),
            files: Mutex::new(()),
            #[cfg(test)]
            transport: Mutex::new(None),
        })
    }
    pub async fn resolve(self: &Arc<Self>, mut request: TtsRequest) -> Result<TtsAudio, TtsError> {
        validate(&mut request)?;
        let key = cache_key(&request);
        let (job, epoch, start) = {
            let mut state = self.control.lock().unwrap();
            if state.cancelled_ids.contains(&request.request_id) {
                return Err(TtsError::cancelled());
            }
            state.latest = request.request_id.clone();
            let epoch = state.epoch;
            match state.active.as_ref().filter(|job| {
                job.key == key && job.online_enabled == request.online_enabled && !job.stopped()
            }) {
                Some(job) => (job.clone(), epoch, false),
                None => {
                    if let Some(old) = state.active.take() {
                        old.stop();
                    }
                    let (result, _) = watch::channel(None);
                    let job = Arc::new(Job {
                        key,
                        online_enabled: request.online_enabled,
                        cancel: Notify::new(),
                        cancelled: false.into(),
                        result,
                    });
                    state.active = Some(job.clone());
                    (job, epoch, true)
                }
            }
        };
        let mut receiver = job.result.subscribe();
        if start {
            let service = self.clone();
            let job = job.clone();
            let request = request.clone();
            tokio::spawn(async move {
                let result = tokio::select! {
                    biased;
                    _ = job.cancel.notified() => Err(TtsError::cancelled()),
                    value = service.run(&request, &job, epoch) => value,
                };
                job.result.send_replace(Some(result));
            });
        }
        loop {
            let result = receiver.borrow().clone();
            if let Some(result) = result {
                let mut state = self.control.lock().unwrap();
                if state.latest != request.request_id
                    || state.epoch != epoch
                    || state.cancelled_ids.contains(&request.request_id)
                {
                    return Err(TtsError::cancelled());
                }
                if state
                    .active
                    .as_ref()
                    .is_some_and(|active| Arc::ptr_eq(active, &job))
                {
                    state.active.take();
                }
                return result;
            }
            receiver
                .changed()
                .await
                .map_err(|_| TtsError::cancelled())?;
        }
    }
    async fn run(&self, request: &TtsRequest, job: &Job, epoch: u64) -> Result<TtsAudio, TtsError> {
        let _gate = self.gate.lock().await;
        if job.stopped() {
            return Err(TtsError::cancelled());
        }
        if let Some(hit) = self.read_cache(request, &job.key) {
            return Ok(hit);
        }
        if !request.online_enabled {
            return Err(TtsError::new("online_disabled", false));
        }
        let result = tokio::time::timeout(WAIT_BUDGET, async {
            for attempt in 0..2 {
                match self.generate(request).await {
                    Err(error) if error.retryable && attempt == 0 => {
                        tokio::time::sleep(Duration::from_millis(180)).await;
                    }
                    value => return value,
                }
            }
            unreachable!()
        })
        .await
        .map_err(|_| TtsError::new("timeout", true))??;
        let (bytes, duration, metadata_end) = result;
        let state = self.control.lock().unwrap();
        if state.epoch != epoch || job.stopped() {
            return Err(TtsError::cancelled());
        }
        // Control stays locked through the atomic commit: clear cannot finish before a stale write.
        self.write_cache(request, &job.key, &bytes, duration, metadata_end)?;
        drop(state);
        Ok(audio_response(
            request,
            &job.key,
            &bytes,
            duration,
            "edge-network",
        ))
    }
    async fn generate(&self, request: &TtsRequest) -> Result<(Vec<u8>, u64, u64), TtsError> {
        #[cfg(test)]
        {
            let transport = self.transport.lock().unwrap().clone();
            if let Some(transport) = transport {
                transport
                    .calls
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(transport.delay_ms)).await;
                if let Some(error) = &transport.error {
                    return Err(error.clone());
                }
                let duration = validate_audio(&transport.bytes, transport.metadata_end_ms)?;
                return Ok((transport.bytes.clone(), duration, transport.metadata_end_ms));
            }
        }
        synthesize(request).await
    }
    pub fn cancel(&self, request_id: &str) {
        let mut state = self.control.lock().unwrap();
        state.cancelled_ids.push_back(request_id.into());
        while state.cancelled_ids.len() > 64 {
            state.cancelled_ids.pop_front();
        }
        if state.latest == request_id {
            if let Some(job) = state.active.take() {
                job.stop();
            }
            state.latest.clear();
        }
    }
    pub fn clear(&self) -> Result<(), TtsError> {
        let mut state = self.control.lock().unwrap();
        state.epoch += 1;
        if let Some(job) = state.active.take() {
            job.stop();
        }
        let _files = self.files.lock().unwrap();
        if self.root.exists() {
            std::fs::remove_dir_all(&self.root).map_err(|_| TtsError::new("cache_io", true))?;
        }
        Ok(())
    }
    pub fn invalidate(&self, key: &str) -> Result<(), TtsError> {
        if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(TtsError::new("invalid_input", false));
        }
        let mut state = self.control.lock().unwrap();
        if state.active.as_ref().is_some_and(|j| j.key == key) {
            if let Some(job) = state.active.take() {
                job.stop();
            }
        }
        let _files = self.files.lock().unwrap();
        for extension in ["json", "mp3"] {
            let p = self.root.join(format!("{key}.{extension}"));
            if p.exists() {
                std::fs::remove_file(p).map_err(|_| TtsError::new("cache_io", true))?;
            }
        }
        Ok(())
    }
    fn read_cache(&self, request: &TtsRequest, key: &str) -> Option<TtsAudio> {
        let _files = self.files.lock().unwrap();
        let metadata_path = self.root.join(format!("{key}.json"));
        let audio_path = self.root.join(format!("{key}.mp3"));
        let read = || -> Option<(Vec<u8>, CacheEntry)> {
            let meta_bytes = bounded_read(&metadata_path, 4096)?;
            let entry: CacheEntry = serde_json::from_slice(&meta_bytes).ok()?;
            let bytes = bounded_read(&audio_path, MAX_AUDIO_BYTES)?;
            if entry.version != CACHE_VERSION
                || !entry.completed
                || entry.voice != request.voice
                || entry.speed != request.speed
                || checksum(&bytes) != entry.checksum
            {
                return None;
            }
            let duration = validate_audio(&bytes, entry.metadata_end_ms).ok()?;
            if duration != entry.duration_ms {
                return None;
            }
            Some((bytes, entry))
        };
        if let Some((bytes, mut entry)) = read() {
            entry.last_used = now_ms();
            let _ = atomic_write(&metadata_path, &serde_json::to_vec(&entry).ok()?);
            Some(audio_response(
                request,
                key,
                &bytes,
                entry.duration_ms,
                "edge-cache",
            ))
        } else {
            let _ = std::fs::remove_file(metadata_path);
            let _ = std::fs::remove_file(audio_path);
            None
        }
    }
    fn write_cache(
        &self,
        request: &TtsRequest,
        key: &str,
        bytes: &[u8],
        duration_ms: u64,
        metadata_end_ms: u64,
    ) -> Result<(), TtsError> {
        let _files = self.files.lock().unwrap();
        std::fs::create_dir_all(&self.root).map_err(|_| TtsError::new("cache_io", true))?;
        let entry = CacheEntry {
            version: CACHE_VERSION,
            checksum: checksum(bytes),
            duration_ms,
            metadata_end_ms,
            voice: request.voice.clone(),
            speed: request.speed.clone(),
            last_used: now_ms(),
            completed: true,
        };
        atomic_write(&self.root.join(format!("{key}.mp3")), bytes)?;
        atomic_write(
            &self.root.join(format!("{key}.json")),
            &serde_json::to_vec(&entry).map_err(|_| TtsError::new("cache_io", false))?,
        )?;
        prune(&self.root, key, MAX_CACHE_BYTES);
        Ok(())
    }
}
fn bounded_read(path: &Path, maximum: usize) -> Option<Vec<u8>> {
    let length = std::fs::metadata(path).ok()?.len();
    if length == 0 || length > maximum as u64 {
        return None;
    }
    std::fs::read(path).ok()
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), TtsError> {
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        #[cfg(not(target_os = "windows"))]
        std::fs::rename(&temporary, path)?;
        #[cfg(target_os = "windows")]
        windows_atomic_replace(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_: std::io::Error| TtsError::new("cache_io", true))
}
#[cfg(target_os = "windows")]
fn windows_atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    // Canonicalizing the existing parent produces the extended Windows path
    // prefix, preserving long Unicode cache paths. Replacement never unlinks
    // the old file first; a failed move leaves its valid data in place.
    let source = source.canonicalize()?;
    let destination =
        destination
            .parent()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "cache parent"))?
            .canonicalize()?
            .join(destination.file_name().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "cache name")
            })?);
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH; both buffers live
    // for the call and are null-terminated platform paths.
    let success = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x1 | 0x8) };
    if success == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
fn prune(root: &Path, keep: &str, budget: u64) {
    let Ok(directory) = std::fs::read_dir(root) else {
        return;
    };
    let mut entries = Vec::new();
    let mut total = 0;
    // Called under files lock; no other commit can own a temporary file here.
    for file in directory.flatten() {
        let path = file.path();
        let extension = path.extension().and_then(|e| e.to_str());
        if matches!(extension, Some("tmp" | "backup")) {
            let _ = std::fs::remove_file(path);
            continue;
        }
        let key = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if extension == Some("json") && !root.join(format!("{key}.mp3")).is_file() {
            let _ = std::fs::remove_file(path);
            continue;
        }
        if extension != Some("mp3") {
            continue;
        }
        let metadata_path = root.join(format!("{key}.json"));
        let Some(entry) = bounded_read(&metadata_path, 4096)
            .and_then(|bytes| serde_json::from_slice::<CacheEntry>(&bytes).ok())
        else {
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(metadata_path);
            continue;
        };
        let size = file.metadata().map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(&metadata_path)
                .map(|m| m.len())
                .unwrap_or(0);
        total += size;
        entries.push((entry.last_used, key, size));
    }
    entries.sort();
    for (_, key, size) in entries {
        if total <= budget {
            break;
        }
        if key == keep {
            continue;
        }
        let _ = std::fs::remove_file(root.join(format!("{key}.mp3")));
        let _ = std::fs::remove_file(root.join(format!("{key}.json")));
        total = total.saturating_sub(size);
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn cache_key(r: &TtsRequest) -> String {
    checksum(
        serde_json::to_vec(&(
            CACHE_VERSION,
            "edge-readaloud-v2",
            &r.text,
            &r.accent,
            &r.voice,
            &r.speed,
            FORMAT,
        ))
        .unwrap()
        .as_slice(),
    )
}
fn audio_response(
    r: &TtsRequest,
    key: &str,
    bytes: &[u8],
    duration_ms: u64,
    source: &str,
) -> TtsAudio {
    TtsAudio {
        data_base64: STANDARD.encode(bytes),
        mime: "audio/mpeg".into(),
        cache_key: key.into(),
        source: source.into(),
        voice: r.voice.clone(),
        speed: r.speed.clone(),
        duration_ms,
    }
}
fn validate(r: &mut TtsRequest) -> Result<(), TtsError> {
    if r.request_id.is_empty()
        || r.request_id.len() > 100
        || !r
            .request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b':'))
    {
        return Err(TtsError::new("invalid_input", false));
    }
    if r.text.chars().count() > 1000 {
        return Err(TtsError::new("too_long", false));
    }
    if r.text.chars().any(|c| c.is_control() && !c.is_whitespace()) {
        return Err(TtsError::new("invalid_input", false));
    }
    r.text = r
        .text
        .nfc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if r.text.is_empty()||!r.text.chars().any(|c|c.is_ascii_alphabetic())||r.text.chars().any(|c|matches!(c,'\u{0250}'..='\u{02ff}'|'\u{0300}'..='\u{036f}'|'\u{4e00}'..='\u{9fff}'|'\u{3040}'..='\u{30ff}'|'\u{0400}'..='\u{052f}')){return Err(TtsError::new("invalid_input",false));}
    let allowed = match r.accent.as_str() {
        "us" => {
            ["en-US-JennyNeural", "en-US-AriaNeural", "en-US-GuyNeural"].contains(&r.voice.as_str())
        }
        "gb" => ["en-GB-SoniaNeural", "en-GB-RyanNeural"].contains(&r.voice.as_str()),
        _ => false,
    };
    if !allowed
        || !matches!(r.speed.as_str(), "normal" | "slow")
        || !matches!(r.kind.as_str(), "word" | "phrase" | "sentence" | "preview")
    {
        return Err(TtsError::new("invalid_input", false));
    }
    Ok(())
}
fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
async fn synthesize(request: &TtsRequest) -> Result<(Vec<u8>, u64, u64), TtsError> {
    let mut client = connect_async().await.map_err(classify)?;
    let config = SpeechConfig {
        voice_name: request.voice.clone(),
        audio_format: FORMAT.into(),
        pitch: 0,
        rate: if request.speed == "slow" { -25 } else { 0 },
        volume: 0,
    };
    let output = client
        .synthesize(&escape_xml(&request.text), &config)
        .await
        .map_err(classify)?;
    let tail = output.audio_metadata.iter().rev().find_map(|m| {
        m.text
            .as_deref()
            .filter(|t| t.chars().any(|c| c.is_ascii_alphabetic()))
    });
    if !metadata_reaches_text_end(&request.text, tail) {
        return Err(TtsError::new("invalid_audio", false));
    }
    let metadata_end = output
        .audio_metadata
        .iter()
        .map(|m| (m.offset + m.duration) / 10_000)
        .max()
        .ok_or_else(|| TtsError::new("invalid_audio", false))?;
    let duration = validate_audio(&output.audio_bytes, metadata_end)?;
    Ok((output.audio_bytes, duration, metadata_end))
}
fn metadata_reaches_text_end(text: &str, last: Option<&str>) -> bool {
    let tail = text.split_whitespace().last().unwrap_or("");
    // Numbers/symbols may be expanded by the service; do not guess that mapping.
    if !tail.chars().any(|c| c.is_ascii_alphabetic()) {
        return true;
    }
    let normalize = |s: &str| {
        s.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let expected = normalize(tail);
    let actual = normalize(last.unwrap_or(""));
    !actual.is_empty() && (expected.ends_with(&actual) || actual.ends_with(&expected))
}
fn classify(error: msedge_tts::error::Error) -> TtsError {
    use msedge_tts::{error::Error, tungstenite::Error as WsError};
    // Never return upstream error text: it may contain signed URLs or material text.
    match error {
        Error::TungsteniteError(WsError::Http(response)) => match response.status().as_u16() {
            429 => TtsError::new("rate_limited", false),
            500..=599 => TtsError::new("network", true),
            _ => TtsError::new("service_rejected", false),
        },
        Error::TungsteniteError(
            WsError::Io(_) | WsError::ConnectionClosed | WsError::AlreadyClosed,
        ) => TtsError::new("network", true),
        Error::TungsteniteError(WsError::Tls(_)) | Error::ReqwestError(_) => {
            TtsError::new("network", false)
        }
        _ => TtsError::new("invalid_audio", false),
    }
}
/// Decode every MP3 packet in-process. Frame headers alone do not establish decodability.
fn validate_audio(bytes: &[u8], metadata_end_ms: u64) -> Result<u64, TtsError> {
    use symphonia::core::{
        codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream,
        meta::MetadataOptions, probe::Hint,
    };
    let bad = || TtsError::new("invalid_audio", false);
    if bytes.len() < 700 || bytes.len() > MAX_AUDIO_BYTES || metadata_end_ms == 0 {
        return Err(bad());
    }
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("mp3");
    let mut reader = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| bad())?
        .format;
    let track = reader.default_track().ok_or_else(bad)?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| bad())?;
    let mut samples = 0u64;
    let mut rate = 0;
    let mut packets = 0;
    loop {
        let packet = match reader.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(_) => return Err(bad()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder.decode(&packet).map_err(|_| bad())?;
        samples += decoded.frames() as u64;
        rate = decoded.spec().rate;
        packets += 1;
    }
    if rate != 24_000 || packets < 3 {
        return Err(bad());
    }
    let duration = samples * 1000 / u64::from(rate);
    // End-of-word metadata must fit in audio; allow codec delay and trailing silence.
    if duration < 150 || metadata_end_ms > duration + 120 || duration > metadata_end_ms + 2200 {
        return Err(bad());
    }
    // A lost final MP3 frame can otherwise appear as normal EOF. Fixed format is 48kbit/s CBR.
    if bytes.len() % 144 != 0 {
        return Err(bad());
    }
    Ok(duration)
}
pub fn configure(app: &tauri::AppHandle) {
    if let Ok(root) = app.path().app_cache_dir() {
        let _ = SERVICE.set(TtsService::new(root.join("edge-tts-v1")));
    }
}
fn configured() -> Result<Arc<TtsService>, TtsError> {
    SERVICE
        .get()
        .cloned()
        .ok_or_else(|| TtsError::new("cache_io", true))
}
#[tauri::command]
pub async fn resolve_tts_audio(request: TtsRequest) -> Result<TtsAudio, TtsError> {
    configured()?.resolve(request).await
}
#[tauri::command]
pub fn cancel_tts(request_id: String) -> Result<(), TtsError> {
    configured()?.cancel(&request_id);
    Ok(())
}
#[tauri::command]
pub fn clear_tts_cache() -> Result<(), TtsError> {
    configured()?.clear()
}
#[tauri::command]
pub fn invalidate_tts_cache(cache_key: String) -> Result<(), TtsError> {
    configured()?.invalidate(&cache_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            text: text.into(),
            kind: "sentence".into(),
            accent: "us".into(),
            voice: "en-US-JennyNeural".into(),
            speed: "normal".into(),
            online_enabled: true,
        }
    }
    #[test]
    fn input_boundary_and_cache_identity() {
        let mut r = request("  US\nwent, don't <read> & listen.  ");
        validate(&mut r).unwrap();
        assert_eq!(r.text, "US went, don't <read> & listen.");
        assert_eq!(
            escape_xml(&r.text),
            "US went, don&apos;t &lt;read&gt; &amp; listen."
        );
        let mut keys = std::collections::HashSet::new();
        for text in ["US", "us", "look up", "look-up", "went"] {
            let r = request(text);
            assert!(keys.insert(cache_key(&r)));
        }
        let base = request("Hello");
        let mut slow = base.clone();
        slow.speed = "slow".into();
        assert_ne!(cache_key(&base), cache_key(&slow));
        let mut voice = base.clone();
        voice.voice = "en-US-AriaNeural".into();
        assert_ne!(cache_key(&base), cache_key(&voice));
        voice.accent = "gb".into();
        assert_eq!(validate(&mut voice).unwrap_err().code, "invalid_input");
        for text in ["", "你好", "/rɪˈkɔːd/", "hello\0world"] {
            assert!(validate(&mut request(text)).is_err());
        }
        assert_eq!(
            validate(&mut request(&"a".repeat(1001))).unwrap_err().code,
            "too_long"
        );
    }
    #[test]
    fn rejects_invalid_audio_and_cache_paths() {
        let service = TtsService::new(PathBuf::from("/unused"));
        assert!(service.invalidate("../x").is_err());
        for data in [vec![], vec![0; 1024]] {
            assert_eq!(
                validate_audio(&data, 500).unwrap_err().code,
                "invalid_audio"
            );
        }
    }
    #[tokio::test]
    async fn offline_and_cancel_before_start_are_structured() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        let mut r = request("Hello");
        r.online_enabled = false;
        assert_eq!(
            service.resolve(r).await.unwrap_err().code,
            "online_disabled"
        );
        let r = request("Hello");
        service.cancel(&r.request_id);
        assert_eq!(service.resolve(r).await.unwrap_err().code, "cancelled");
        service.clear().unwrap();
    }
    #[tokio::test]
    #[ignore = "Opt-in real Microsoft Edge upstream; writes explicit local evidence"]
    async fn real_edge_native_probe() {
        let output = std::env::var("LEXICUE_TTS_EVIDENCE").expect("explicit evidence directory");
        let output = PathBuf::from(output);
        std::fs::create_dir_all(&output).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        let catalog = tokio::time::timeout(
            WAIT_BUDGET,
            msedge_tts::voice::tokio_runtime::get_voices_list_async(),
        )
        .await
        .expect("voice list budget")
        .expect("voice directory");
        let candidates = [
            "en-US-JennyNeural",
            "en-US-AriaNeural",
            "en-US-GuyNeural",
            "en-GB-SoniaNeural",
            "en-GB-RyanNeural",
        ];
        let voices:Vec<_>=catalog.iter().filter(|v|candidates.contains(&v.short_name.as_deref().unwrap_or_default())).map(|v|serde_json::json!({"id":v.short_name,"name":v.name,"locale":v.locale,"gender":v.gender,"status":v.status})).collect();
        assert_eq!(voices.len(), 5);
        std::fs::write(
            output.join("native-voices.json"),
            serde_json::to_vec_pretty(&voices).unwrap(),
        )
        .unwrap();
        let mut reports = Vec::new();
        for (index,(text,voice,speed,kind)) in [
            ("curiosity","en-US-JennyNeural","normal","word"),
            ("look up","en-US-AriaNeural","slow","phrase"),
            ("I've read the report, and I'll record the results tomorrow.","en-US-GuyNeural","normal","sentence"),
            ("Would you mind turning the music down a little? I'm trying to finish this chapter, and I keep losing my place.","en-GB-SoniaNeural","normal","preview"),
            ("Please take a moment to read this sentence aloud.","en-GB-RyanNeural","slow","sentence"),
            ("US","en-US-JennyNeural","normal","word"),
            ("us","en-US-JennyNeural","normal","word"),
            ("look up","en-US-JennyNeural","normal","phrase"),
            ("look-up","en-US-JennyNeural","normal","phrase"),
            ("curiosity","en-US-JennyNeural","slow","word"),
            ("curiosity","en-US-AriaNeural","normal","word"),
        ].into_iter().enumerate(){
            let mut r=request(text);r.voice=voice.into();r.accent=if voice.starts_with("en-GB"){"gb"}else{"us"}.into();r.speed=speed.into();r.kind=kind.into();
            let started=std::time::Instant::now();let result=service.resolve(r.clone()).await;let elapsed=started.elapsed().as_millis();
            let audio=match result {Ok(a)=>a,Err(error)=>{std::fs::write(output.join("native-failure.json"),serde_json::to_vec_pretty(&serde_json::json!({"index":index,"voice":voice,"error":error,"elapsed_ms":elapsed})).unwrap()).unwrap();panic!("real Edge generation failed: {:?}",error)}};
            let bytes=STANDARD.decode(&audio.data_base64).unwrap();std::fs::write(output.join(format!("native-sample-{index}.mp3")),&bytes).unwrap();
            // New service represents restart; online disabled demonstrates cache-first offline replay.
            let restarted=TtsService::new(service.root.clone());r.request_id=uuid::Uuid::new_v4().to_string();r.online_enabled=false;let cached=restarted.resolve(r).await.unwrap();assert_eq!(cached.source,"edge-cache");assert_eq!(audio.data_base64,cached.data_base64);
            reports.push(serde_json::json!({"index":index,"voice":voice,"accent":audio.voice.split('-').nth(1),"speed":speed,"kind":kind,"source":audio.source,"duration_ms":audio.duration_ms,"elapsed_ms":elapsed,"bytes":bytes.len(),"sha256":checksum(&bytes),"cache_key":audio.cache_key,"restart_offline_cache":"passed","stream_turn_end":true,"full_mp3_decode":"passed"}));
        }
        let distinct: std::collections::HashSet<_> = reports
            .iter()
            .map(|r| r["cache_key"].as_str().unwrap())
            .collect();
        assert_eq!(
            distinct.len(),
            reports.len(),
            "actual casing, punctuation, voice and speed variants have distinct cache identities"
        );
        std::fs::write(
            output.join("native-real-edge.json"),
            serde_json::to_vec_pretty(&reports).unwrap(),
        )
        .unwrap();
    }
}

#[cfg(test)]
mod fault_tests {
    use super::*;
    const AUDIO: &[u8] = include_bytes!("test_data/edge-curiosity.mp3");
    fn request(text: &str) -> TtsRequest {
        TtsRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            text: text.into(),
            kind: "word".into(),
            accent: "us".into(),
            voice: "en-US-JennyNeural".into(),
            speed: "normal".into(),
            online_enabled: true,
        }
    }
    fn fake(
        service: &Arc<TtsService>,
        delay_ms: u64,
        error: Option<TtsError>,
    ) -> Arc<TestTransport> {
        let transport = Arc::new(TestTransport {
            bytes: AUDIO.to_vec(),
            metadata_end_ms: 1300,
            delay_ms,
            calls: 0.into(),
            error,
        });
        *service.transport.lock().unwrap() = Some(transport.clone());
        transport
    }
    #[test]
    fn complete_decode_rejects_truncation_and_inconsistent_metadata() {
        assert!(validate_audio(AUDIO, 1300).is_ok());
        assert!(validate_audio(&AUDIO[..AUDIO.len() - 1], 1300).is_err());
        assert!(validate_audio(&AUDIO[..AUDIO.len() / 2], 1800).is_err());
        assert!(validate_audio(AUDIO, 5000).is_err());
        assert!(validate_audio(AUDIO, 0).is_err());
        assert!(!metadata_reaches_text_end(
            "I will finish tomorrow.",
            Some("finish")
        ));
        assert!(metadata_reaches_text_end("US", Some("US")));
        assert!(metadata_reaches_text_end("look-up", Some("up")));
    }
    #[tokio::test]
    async fn corrupt_cache_is_invalidated_and_repaired_without_losing_learning_data() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        let transport = fake(&service, 0, None);
        let r = request("curiosity");
        let first = service.resolve(r.clone()).await.unwrap();
        let key = first.cache_key;
        let data = service.root.join(format!("{key}.mp3"));
        std::fs::write(&data, [1u8; 1000]).unwrap();
        std::fs::write(dir.path().join("learning.db"), b"retained learning data").unwrap();
        let mut offline = r.clone();
        offline.request_id = uuid::Uuid::new_v4().to_string();
        offline.online_enabled = false;
        assert_eq!(
            service.resolve(offline).await.unwrap_err().code,
            "online_disabled"
        );
        assert!(!data.exists());
        let mut repair = r;
        repair.request_id = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            service.resolve(repair).await.unwrap().source,
            "edge-network"
        );
        assert_eq!(transport.calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        service.clear().unwrap();
        assert!(dir.path().join("learning.db").exists());
        assert!(!service.root.exists());
    }
    #[tokio::test]
    async fn same_key_requests_coalesce_latest_intent_wins_and_clear_prevents_resurrection() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        let transport = fake(&service, 60, None);
        let a = request("curiosity");
        let b = request("curiosity");
        let s = service.clone();
        let first = tokio::spawn(async move { s.resolve(a).await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        let second = service.resolve(b).await.unwrap();
        assert_eq!(second.source, "edge-network");
        assert_eq!(first.await.unwrap().unwrap_err().code, "cancelled");
        assert_eq!(transport.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        service.clear().unwrap();
        let s = service.clone();
        let pending = tokio::spawn(async move { s.resolve(request("another")).await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        service.clear().unwrap();
        assert_eq!(pending.await.unwrap().unwrap_err().code, "cancelled");
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(!service.root.exists());
    }
    #[tokio::test]
    async fn cancel_new_content_and_online_disable_stop_previous_generation() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        fake(&service, 60, None);
        let r = request("first");
        let id = r.request_id.clone();
        let s = service.clone();
        let pending = tokio::spawn(async move { s.resolve(r).await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        service.cancel(&id);
        assert_eq!(pending.await.unwrap().unwrap_err().code, "cancelled");
        let s = service.clone();
        let pending = tokio::spawn(async move { s.resolve(request("same")).await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        let mut offline = request("same");
        offline.online_enabled = false;
        assert_eq!(
            service.resolve(offline).await.unwrap_err().code,
            "online_disabled"
        );
        assert_eq!(pending.await.unwrap().unwrap_err().code, "cancelled");
        assert!(!service.root.exists());
    }
    #[tokio::test]
    async fn service_rejections_do_not_retry_transient_network_retries_once() {
        for (code, retryable, expected) in [
            ("service_rejected", false, 1),
            ("rate_limited", false, 1),
            ("network", true, 2),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let service = TtsService::new(dir.path().join("tts"));
            let transport = fake(&service, 0, Some(TtsError::new(code, retryable)));
            assert_eq!(
                service.resolve(request("Hello")).await.unwrap_err().code,
                code
            );
            assert_eq!(
                transport.calls.load(std::sync::atomic::Ordering::SeqCst),
                expected
            );
            assert!(!service.root.exists());
        }
    }
    #[test]
    fn lru_evicts_oldest_entry_and_keeps_new_audio() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().into());
        let r = request("first");
        let key = cache_key(&r);
        service.write_cache(&r, &key, AUDIO, 1896, 1300).unwrap();
        let mut entry: CacheEntry =
            serde_json::from_slice(&std::fs::read(dir.path().join(format!("{key}.json"))).unwrap())
                .unwrap();
        entry.last_used = 1;
        std::fs::write(
            dir.path().join(format!("{key}.json")),
            serde_json::to_vec(&entry).unwrap(),
        )
        .unwrap();
        let r = request("new");
        let latest = cache_key(&r);
        service.write_cache(&r, &latest, AUDIO, 1896, 1300).unwrap();
        prune(dir.path(), &latest, AUDIO.len() as u64 + 1);
        assert!(!dir.path().join(format!("{key}.mp3")).exists());
        assert!(dir.path().join(format!("{latest}.mp3")).exists());
    }
}
#[cfg(test)]
mod error_tests {
    use super::*;
    #[test]
    fn http_statuses_are_structured_and_never_expose_body() {
        for (status, code, retryable) in [
            (403, "service_rejected", false),
            (429, "rate_limited", false),
            (503, "network", true),
        ] {
            let response = msedge_tts::tungstenite::http::Response::builder()
                .status(status)
                .body(Some(b"sensitive body or signed URL".to_vec()))
                .unwrap();
            let error = classify(msedge_tts::error::Error::TungsteniteError(
                msedge_tts::tungstenite::Error::Http(Box::new(response)),
            ));
            assert_eq!(error, TtsError::new(code, retryable));
        }
    }
    #[tokio::test]
    async fn total_wait_budget_does_not_cache_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let service = TtsService::new(dir.path().join("tts"));
        *service.transport.lock().unwrap() = Some(Arc::new(TestTransport {
            bytes: vec![],
            metadata_end_ms: 0,
            delay_ms: 9000,
            calls: 0.into(),
            error: None,
        }));
        let started = std::time::Instant::now();
        let request = TtsRequest {
            request_id: "timeout-test".into(),
            text: "Hello".into(),
            kind: "word".into(),
            accent: "us".into(),
            voice: "en-US-JennyNeural".into(),
            speed: "normal".into(),
            online_enabled: true,
        };
        assert_eq!(service.resolve(request).await.unwrap_err().code, "timeout");
        assert!(started.elapsed() < Duration::from_secs(9));
        assert!(!service.root.exists());
    }
}
