//! Pinned, verified assets. Downloads and imports never touch learning data.
use super::runtime;
use crate::commands::ollama::{AiConfig, CancellationToken, OllamaModel};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_fs::FsExt;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub label: String,
    pub runtime: String,
    pub format: String,
    pub quantization: String,
    pub repository: String,
    pub revision: String,
    pub filename: String,
    pub bytes: u64,
    pub sha256: String,
    pub min_available_bytes: u64,
    #[serde(default)]
    pub cache_reserve_bytes: u64,
    #[serde(default)]
    pub min_cpu_available_bytes: u64,
    #[serde(default)]
    pub targets: Vec<String>,
}
fn catalog() -> &'static Vec<Asset> {
    static CATALOG: OnceLock<Vec<Asset>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../../native/gemma/models.json"))
            .expect("checked-in Gemma catalog")
    })
}
pub fn supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        // The pinned LiteRT dylib requires macOS 14. Keep cloud-only use on
        // older systems, and reject local installs before downloading weights.
        static OS_SUPPORTED: OnceLock<bool> = OnceLock::new();
        if !*OS_SUPPORTED.get_or_init(|| unsafe {
            let mut info: libc::utsname = std::mem::zeroed();
            libc::uname(&mut info) == 0
                && std::ffi::CStr::from_ptr(info.release.as_ptr())
                    .to_str()
                    .ok()
                    .and_then(|s| s.split('.').next()?.parse::<u32>().ok())
                    .is_some_and(|version| version >= 23)
        }) {
            return false;
        }
    }
    cfg!(all(
        target_os = "macos",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )) || cfg!(all(target_os = "windows", target_arch = "x86_64"))
        || cfg!(all(target_os = "android", target_arch = "aarch64"))
}
pub fn platform_runtime() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "llama"
    } else {
        "litert"
    }
}
pub fn platform_target() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "android", target_arch = "aarch64")) {
        "aarch64-linux-android"
    } else {
        "unsupported"
    }
}
pub fn asset(id: &str) -> Result<Asset, String> {
    if !supported() {
        return Err("ERR_PLATFORM_UNSUPPORTED".into());
    }
    catalog()
        .iter()
        .find(|item| {
            item.id == id
                && item
                    .targets
                    .iter()
                    .any(|target| target == platform_target())
        })
        .cloned()
        .ok_or_else(|| "ERR_MODEL_UNSUPPORTED".into())
}
pub fn installed_path(dir: &Path, item: &Asset) -> PathBuf {
    dir.join(format!("{}.{}", item.id, item.format))
}
pub fn cache_path(dir: &Path, item: &Asset) -> PathBuf {
    // Asset IDs come exclusively from the pinned catalog, never a user path.
    dir.join("cache").join(&item.id)
}
fn cache_remaining(dir: &Path, item: &Asset) -> u64 {
    let mut used = 0u64;
    let mut pending = vec![cache_path(dir, item)];
    while let Some(path) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(path) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                used = used.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
            }
        }
    }
    item.cache_reserve_bytes.saturating_sub(used)
}
pub fn check_cache_space(dir: &Path, item: &Asset) -> Result<(), String> {
    check_space(dir, cache_remaining(dir, item))
}
fn remove_asset_files(dir: &Path, item: &Asset) -> Result<(), String> {
    for path in [
        installed_path(dir, item),
        receipt_path(dir, item),
        partial_path(dir, item),
    ] {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    match std::fs::remove_dir_all(cache_path(dir, item)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn receipt_path(dir: &Path, item: &Asset) -> PathBuf {
    dir.join(format!("{}.json", item.id))
}
fn partial_path(dir: &Path, item: &Asset) -> PathBuf {
    dir.join(format!("{}.part", item.id))
}
fn is_installed(dir: &Path, item: &Asset) -> bool {
    std::fs::metadata(installed_path(dir, item)).is_ok_and(|m| m.is_file() && m.len() == item.bytes)
        && std::fs::read(receipt_path(dir, item))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Asset>(&bytes).ok())
            .is_some_and(|receipt| {
                receipt.sha256 == item.sha256 && receipt.revision == item.revision
            })
}
pub fn verify_file(path: &Path, item: &Asset, token: &CancellationToken) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "ERR_MODEL_NOT_INSTALLED")?;
    if file.metadata().map_err(|e| e.to_string())?.len() != item.bytes {
        return Err("ERR_MODEL_SIZE".into());
    }
    let mut buffer = vec![0; 1024 * 1024];
    let mut hash = Sha256::new();
    loop {
        if token.cancelled() {
            return Err("ERR_CANCELLED".into());
        }
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if format!("{:x}", hash.finalize()) != item.sha256 {
        return Err("ERR_MODEL_CHECKSUM".into());
    }
    Ok(())
}
fn install(dir: &Path, item: &Asset, partial: &Path) -> Result<(), String> {
    let path = installed_path(dir, item);
    // Existing verified installations are immutable; never overwrite a model
    // that might still be mapped by the inference worker.
    if is_installed(dir, item) {
        return Ok(());
    }
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(partial, &path).map_err(|e| e.to_string())?;
    let receipt = receipt_path(dir, item);
    let temp = receipt.with_extension("json.part");
    std::fs::write(&temp, serde_json::to_vec(item).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if receipt.exists() {
        std::fs::remove_file(&receipt).map_err(|e| e.to_string())?;
    }
    std::fs::rename(temp, receipt).map_err(|e| e.to_string())
}
#[derive(Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub generations: usize,
    pub pulling: bool,
    pub deleting: bool,
    pub sequence: u64,
}
static ACTIVITY: OnceLock<Mutex<Activity>> = OnceLock::new();
fn activity() -> &'static Mutex<Activity> {
    ACTIVITY.get_or_init(|| Mutex::new(Activity::default()))
}
#[derive(Clone, Copy)]
enum Operation {
    Generate,
    Download,
    Delete,
}
pub struct ActivityGuard {
    kind: Operation,
    app: AppHandle,
}
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        if let Ok(mut value) = activity().lock() {
            match self.kind {
                Operation::Generate => value.generations = value.generations.saturating_sub(1),
                Operation::Download => value.pulling = false,
                Operation::Delete => value.deleting = false,
            }
            value.sequence += 1;
            let _ = self.app.emit("gemma-local-activity", *value);
        }
    }
}
fn acquire(kind: Operation, app: &AppHandle) -> Result<ActivityGuard, String> {
    let mut value = activity().lock().map_err(|_| "ERR_MODEL_BUSY")?;
    if value.deleting
        || matches!(kind, Operation::Delete) && (value.generations > 0 || value.pulling)
        || matches!(kind, Operation::Download) && value.pulling
    {
        return Err("ERR_MODEL_BUSY".into());
    }
    match kind {
        Operation::Generate => value.generations += 1,
        Operation::Download => value.pulling = true,
        Operation::Delete => value.deleting = true,
    }
    value.sequence += 1;
    let _ = app.emit("gemma-local-activity", *value);
    Ok(ActivityGuard {
        kind,
        app: app.clone(),
    })
}
pub fn generation_guard(
    config: &AiConfig,
    app: &AppHandle,
) -> Result<Option<ActivityGuard>, String> {
    if config.is_gemma() {
        asset(&config.model)?;
        acquire(Operation::Generate, app).map(Some)
    } else if config.is_openai() {
        Ok(None)
    } else {
        Err("ERR_AI_PROVIDER".into())
    }
}
#[tauri::command]
pub fn get_local_gemma_activity() -> Activity {
    activity().lock().map(|a| *a).unwrap_or_default()
}
pub fn installed_models() -> Result<Vec<OllamaModel>, String> {
    if !supported() {
        return Err("ERR_PLATFORM_UNSUPPORTED".into());
    }
    let dir = runtime::models_dir()?;
    Ok(catalog()
        .iter()
        .filter(|item| item.runtime == platform_runtime() && is_installed(dir, item))
        .map(|item| OllamaModel {
            name: item.id.clone(),
            size: Some(item.bytes),
            digest: Some(item.sha256.clone()),
            modified_at: None,
        })
        .collect())
}
#[cfg(unix)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::ffi::CString;
    let path = CString::new(dir.to_string_lossy().as_bytes()).ok()?;
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stats) } == 0 {
        Some((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
    } else {
        None
    }
}
#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            free: *mut u64,
            total: *mut u64,
            available: *mut u64,
        ) -> i32;
    }
    let path: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } != 0
    {
        Some(free)
    } else {
        None
    }
}
#[cfg(not(any(unix, windows)))]
fn free_bytes(_: &Path) -> Option<u64> {
    None
}
fn check_space(dir: &Path, needed: u64) -> Result<(), String> {
    if free_bytes(dir).is_some_and(|free| free < needed.saturating_add(256 * 1024 * 1024)) {
        Err("ERR_MODEL_SPACE".into())
    } else {
        Ok(())
    }
}
fn memory() -> (Option<u64>, Option<u64>) {
    #[cfg(any(target_os = "android", target_os = "linux"))]
    {
        let text = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let read = |name: &str| {
            text.lines().find_map(|line| {
                line.strip_prefix(name)?
                    .split_whitespace()
                    .next()?
                    .parse::<u64>()
                    .ok()
                    .map(|kb| kb * 1024)
            })
        };
        return (read("MemTotal:"), read("MemAvailable:"));
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/usr/sbin/sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok();
        let total = output.and_then(|o| String::from_utf8(o.stdout).ok()?.trim().parse().ok());
        extern "C" {
            fn mach_port_deallocate(
                task: libc::mach_port_t,
                port: libc::mach_port_t,
            ) -> libc::kern_return_t;
        }
        let available = unsafe {
            #[allow(deprecated)]
            let host = libc::mach_host_self();
            let mut stats: libc::vm_statistics64 = std::mem::zeroed();
            let mut count = libc::HOST_VM_INFO64_COUNT;
            let result = libc::host_statistics64(
                host,
                libc::HOST_VM_INFO64,
                &mut stats as *mut _ as *mut libc::integer_t,
                &mut count,
            );
            #[allow(deprecated)]
            {
                mach_port_deallocate(libc::mach_task_self_, host);
            }
            let page_size = libc::sysconf(libc::_SC_PAGESIZE);
            // Free + inactive pages is a conservative reclaimable estimate,
            // not a guarantee that the model or GPU allocation will succeed.
            if result == 0 && page_size > 0 {
                Some(
                    (stats.free_count as u64 + stats.inactive_count as u64)
                        .saturating_mul(page_size as u64),
                )
            } else {
                None
            }
        };
        return (total, available);
    }
    #[cfg(windows)]
    {
        #[repr(C)]
        struct MemoryStatus {
            length: u32,
            load: u32,
            total_phys: u64,
            avail_phys: u64,
            total_page: u64,
            avail_page: u64,
            total_virtual: u64,
            avail_virtual: u64,
            avail_extended: u64,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GlobalMemoryStatusEx(value: *mut MemoryStatus) -> i32;
        }
        let mut value: MemoryStatus = unsafe { std::mem::zeroed() };
        value.length = std::mem::size_of::<MemoryStatus>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut value) } != 0 {
            return (Some(value.total_phys), Some(value.avail_phys));
        }
    }
    #[allow(unreachable_code)]
    (None, None)
}
pub fn check_memory(item: &Asset) -> Result<(), String> {
    if memory()
        .1
        .is_some_and(|bytes| bytes < item.min_available_bytes)
    {
        Err("ERR_MODEL_MEMORY".into())
    } else {
        Ok(())
    }
}
pub fn check_cpu_memory(item: &Asset) -> Result<(), String> {
    if memory()
        .1
        .is_some_and(|bytes| bytes < item.min_cpu_available_bytes)
    {
        Err("ERR_MODEL_MEMORY: CPU fallback needs more available memory".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub fn get_local_gemma_environment() -> Result<Value, String> {
    if !supported() {
        return Err("ERR_PLATFORM_UNSUPPORTED".into());
    }
    let dir = runtime::models_dir()?;
    let (memory, available) = memory();
    let free = free_bytes(dir);
    Ok(
        json!({ "os": std::env::consts::OS, "architecture": std::env::consts::ARCH, "cpu": null,
        "memoryBytes": memory, "availableMemoryBytes": available, "freeStorageBytes": free,
        "unifiedMemory": cfg!(all(target_os="macos",target_arch="aarch64")), "runtime": platform_runtime(), "runtimeStatus": runtime::status(),
        "models": catalog().iter().filter(|a| a.runtime == platform_runtime()).map(|item| {
            let remaining = if is_installed(dir,item) { 0 } else { item.bytes.saturating_sub(std::fs::metadata(partial_path(dir,item)).map(|m|m.len()).unwrap_or(0)) };
            json!({ "model": item.id, "label": item.label, "format": item.format, "quantization": item.quantization,
                "estimatedBytes": item.bytes, "recommended": item.label == "E2B", "preferred": item.label == "E2B", "resumable": partial_path(dir,item).exists(),
                "compatible": !available.is_some_and(|b| b < item.min_available_bytes) && !free.is_some_and(|b| b < remaining.saturating_add(cache_remaining(dir,item)).saturating_add(256*1024*1024)) })
        }).collect::<Vec<_>>() }),
    )
}
static DOWNLOADS: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
fn downloads() -> &'static Mutex<HashMap<String, CancellationToken>> {
    DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}
struct DownloadGuard(String, CancellationToken);
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        self.1.cancel();
        if let Ok(mut jobs) = downloads().lock() {
            jobs.remove(&self.0);
        }
    }
}
fn begin(id: &str) -> Result<(CancellationToken, DownloadGuard), String> {
    if id.is_empty() || id.len() > 100 {
        return Err("ERR_DOWNLOAD_ID".into());
    }
    let mut jobs = downloads().lock().map_err(|_| "ERR_MODEL_BUSY")?;
    if jobs.contains_key(id) {
        return Err("ERR_MODEL_BUSY".into());
    }
    let token = CancellationToken::default();
    jobs.insert(id.into(), token.clone());
    Ok((token.clone(), DownloadGuard(id.into(), token)))
}
struct Progress {
    app: AppHandle,
    id: String,
    model: String,
    sequence: u64,
    started: Instant,
    initial: u64,
}
impl Progress {
    fn emit(&mut self, phase: &str, item: &Asset, completed: u64) {
        self.sequence += 1;
        let _ = self.app.emit("gemma-model-download-progress", json!({ "downloadId": self.id, "model": self.model, "sequence": self.sequence, "phase": phase,
            "digest": item.sha256, "total": item.bytes, "completed": completed, "bytesPerSecond": completed.saturating_sub(self.initial) as f64 / self.started.elapsed().as_secs_f64().max(0.001) }));
    }
}
fn resume_offset(
    status: u16,
    range: Option<&str>,
    initial: u64,
    expected: u64,
) -> Result<u64, String> {
    if status == 200 {
        return Ok(0);
    }
    if status != 206 {
        return Err(format!("ERR_DOWNLOAD_CONNECTION: HTTP {status}"));
    }
    let value = range
        .and_then(|s| s.strip_prefix("bytes "))
        .ok_or("ERR_DOWNLOAD_RANGE")?;
    let (span, total) = value.split_once('/').ok_or("ERR_DOWNLOAD_RANGE")?;
    let (start, end) = span.split_once('-').ok_or("ERR_DOWNLOAD_RANGE")?;
    if start.parse::<u64>().ok() != Some(initial)
        || total.parse::<u64>().ok() != Some(expected)
        || end.parse::<u64>().ok() != expected.checked_sub(1)
    {
        return Err("ERR_DOWNLOAD_RANGE".into());
    }
    Ok(initial)
}
#[tauri::command]
pub async fn download_gemma_model(
    app: AppHandle,
    model: String,
    download_id: String,
) -> Result<(), String> {
    let _operation = acquire(Operation::Download, &app)?;
    let (token, _job) = begin(&download_id)?;
    let item = asset(&model)?;
    let dir = runtime::models_dir()?.to_owned();
    if is_installed(&dir, &item) {
        return Ok(());
    }
    let partial = partial_path(&dir, &item);
    let initial = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
    let mut progress = Progress {
        app,
        id: download_id,
        model,
        sequence: 0,
        started: Instant::now(),
        initial,
    };
    progress.emit("manifest", &item, initial);
    if initial > item.bytes {
        std::fs::remove_file(&partial).map_err(|e| e.to_string())?;
    }
    let initial = if initial > item.bytes { 0 } else { initial };
    if initial < item.bytes {
        check_space(
            &dir,
            (item.bytes - initial).saturating_add(cache_remaining(&dir, &item)),
        )?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            item.repository, item.revision, item.filename
        );
        let request = client
            .get(url)
            .header(reqwest::header::RANGE, format!("bytes={initial}-"));
        let mut response = tokio::select! { result = request.send() => result.map_err(|e| format!("ERR_DOWNLOAD_CONNECTION: {e}"))?, _ = token.cancelled_future() => return Err("ERR_CANCELLED".into()) };
        let offset = resume_offset(
            response.status().as_u16(),
            response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok()),
            initial,
            item.bytes,
        )?;
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(offset == 0)
            .append(offset > 0)
            .open(&partial)
            .await
            .map_err(|e| e.to_string())?;
        let mut completed = offset;
        progress.initial = offset;
        let mut last = Instant::now();
        loop {
            let chunk = tokio::select! { result=tokio::time::timeout(Duration::from_secs(60),response.chunk()) => result.map_err(|_|"ERR_DOWNLOAD_IDLE_TIMEOUT")?.map_err(|e|format!("ERR_DOWNLOAD_INTERRUPTED: {e}"))?, _=token.cancelled_future()=>return Err("ERR_CANCELLED".into()) };
            let Some(chunk) = chunk else {
                break;
            };
            if completed.saturating_add(chunk.len() as u64) > item.bytes {
                return Err("ERR_MODEL_SIZE".into());
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("ERR_MODEL_SPACE: {e}"))?;
            completed += chunk.len() as u64;
            if last.elapsed() > Duration::from_millis(250) {
                progress.emit("downloading", &item, completed);
                last = Instant::now();
            }
        }
        file.sync_all().await.map_err(|e| e.to_string())?;
        drop(file);
        if completed != item.bytes {
            return Err("ERR_DOWNLOAD_INTERRUPTED".into());
        }
    }
    progress.emit("verifying", &item, item.bytes);
    let verify_item = item.clone();
    let verify_path = partial.clone();
    let verify_token = token.clone();
    let verified = tauri::async_runtime::spawn_blocking(move || {
        verify_file(&verify_path, &verify_item, &verify_token)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = verified {
        if error == "ERR_MODEL_CHECKSUM" {
            let _ = std::fs::remove_file(&partial);
        }
        return Err(error);
    }
    if token.cancelled() {
        return Err("ERR_CANCELLED".into());
    }
    progress.emit("installing", &item, item.bytes);
    install(&dir, &item, &partial)?;
    progress.emit("completed", &item, item.bytes);
    Ok(())
}
#[tauri::command]
pub fn cancel_gemma_model_download(download_id: String) -> Result<(), String> {
    if let Some(token) = downloads()
        .lock()
        .map_err(|_| "ERR_MODEL_BUSY")?
        .get(&download_id)
    {
        token.cancel();
    }
    Ok(())
}
#[tauri::command]
pub async fn import_gemma_model(
    app: AppHandle,
    model: String,
    path: String,
    download_id: String,
) -> Result<(), String> {
    let _operation = acquire(Operation::Download, &app)?;
    let (token, _job) = begin(&download_id)?;
    let item = asset(&model)?;
    let dir = runtime::models_dir()?.to_owned();
    if is_installed(&dir, &item) {
        return Ok(());
    }
    check_space(
        &dir,
        item.bytes.saturating_add(cache_remaining(&dir, &item)),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = _operation;
        let _job = _job;
        let file_path = if path.starts_with("content://") {
            tauri_plugin_fs::FilePath::Url(reqwest::Url::parse(&path).map_err(|e| e.to_string())?)
        } else {
            tauri_plugin_fs::FilePath::Path(PathBuf::from(path))
        };
        let mut source = app
            .fs()
            .open(
                file_path,
                tauri_plugin_fs::OpenOptions::new().read(true).clone(),
            )
            .map_err(|e| e.to_string())?;
        let partial = partial_path(&dir, &item);
        let mut dest = File::create(&partial).map_err(|e| e.to_string())?;
        let mut progress = Progress {
            app,
            id: download_id,
            model,
            sequence: 0,
            started: Instant::now(),
            initial: 0,
        };
        let mut buffer = vec![0; 1024 * 1024];
        let mut completed = 0;
        let mut last = Instant::now();
        loop {
            if token.cancelled() {
                return Err("ERR_CANCELLED".into());
            }
            let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            completed += n as u64;
            if completed > item.bytes {
                return Err("ERR_MODEL_SIZE".into());
            }
            dest.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            if last.elapsed() > Duration::from_millis(250) {
                progress.emit("downloading", &item, completed);
                last = Instant::now();
            }
        }
        dest.sync_all().map_err(|e| e.to_string())?;
        drop(dest);
        progress.emit("verifying", &item, completed);
        if let Err(error) = verify_file(&partial, &item, &token) {
            if error == "ERR_MODEL_CHECKSUM" || error == "ERR_MODEL_SIZE" {
                let _ = std::fs::remove_file(&partial);
            }
            return Err(error);
        };
        if token.cancelled() {
            return Err("ERR_CANCELLED".into());
        }
        progress.emit("installing", &item, completed);
        install(&dir, &item, &partial)?;
        progress.emit("completed", &item, completed);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_gemma_model(app: AppHandle, model: String) -> Result<Value, String> {
    let _operation = acquire(Operation::Delete, &app)?;
    let item = asset(&model)?;
    let dir = runtime::models_dir()?;
    runtime::unload().await?;
    let path = installed_path(dir, &item);
    let already_absent = !path.exists();
    remove_asset_files(dir, &item)?;
    Ok(json!({"alreadyAbsent":already_absent}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_is_pinned_and_only_two_platform_models_are_visible() {
        assert_eq!(catalog().len(), 4);
        assert_eq!(
            catalog()
                .iter()
                .filter(|a| a.runtime == platform_runtime())
                .count(),
            2
        );
        for a in catalog() {
            assert_eq!(a.sha256.len(), 64);
            assert_eq!(a.revision.len(), 40);
            assert!(a.bytes > 1_000_000_000);
            assert!(!a.filename.contains('/'));
        }
        assert!(asset("../../outside").is_err());
        assert!(asset("gemma4:12b").is_err());
    }
    #[test]
    fn model_cache_reserve_and_deletion_are_scoped_to_the_asset() {
        let dir = tempfile::tempdir().unwrap();
        let mut item = catalog()[0].clone();
        item.cache_reserve_bytes = 10;
        let other = &catalog()[1];
        assert_eq!(cache_remaining(dir.path(), &item), 10);
        std::fs::create_dir_all(cache_path(dir.path(), &item).join("nested")).unwrap();
        std::fs::write(
            cache_path(dir.path(), &item).join("nested/weights"),
            b"cache",
        )
        .unwrap();
        assert_eq!(cache_remaining(dir.path(), &item), 5);
        std::fs::create_dir_all(cache_path(dir.path(), other)).unwrap();
        std::fs::write(cache_path(dir.path(), other).join("weights"), b"keep").unwrap();
        let learning = dir.path().join("lexicue.db");
        std::fs::write(&learning, b"learning").unwrap();
        std::fs::write(installed_path(dir.path(), &item), b"model").unwrap();
        remove_asset_files(dir.path(), &item).unwrap();
        remove_asset_files(dir.path(), &item).unwrap();
        assert!(!cache_path(dir.path(), &item).exists());
        assert!(!installed_path(dir.path(), &item).exists());
        assert_eq!(
            std::fs::read(cache_path(dir.path(), other).join("weights")).unwrap(),
            b"keep"
        );
        assert_eq!(std::fs::read(learning).unwrap(), b"learning");
    }
    #[test]
    fn resumes_only_verified_ranges_and_restarts_when_server_ignores_range() {
        assert_eq!(resume_offset(200, None, 20, 100).unwrap(), 0);
        assert_eq!(
            resume_offset(206, Some("bytes 20-99/100"), 20, 100).unwrap(),
            20
        );
        assert!(resume_offset(206, Some("bytes 0-99/100"), 20, 100).is_err());
        assert!(resume_offset(206, Some("bytes 20-99/101"), 20, 100).is_err());
        assert!(resume_offset(416, None, 20, 100).is_err());
    }
    #[test]
    fn corrupt_or_incomplete_weights_cannot_be_installed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture");
        let mut item = catalog()[0].clone();
        item.bytes = 3;
        item.sha256 = format!("{:x}", Sha256::digest(b"abc"));
        std::fs::write(&path, b"ab").unwrap();
        assert_eq!(
            verify_file(&path, &item, &CancellationToken::default()).unwrap_err(),
            "ERR_MODEL_SIZE"
        );
        std::fs::write(&path, b"bad").unwrap();
        assert_eq!(
            verify_file(&path, &item, &CancellationToken::default()).unwrap_err(),
            "ERR_MODEL_CHECKSUM"
        );
        std::fs::write(&path, b"abc").unwrap();
        verify_file(&path, &item, &CancellationToken::default()).unwrap();
        install(dir.path(), &item, &path).unwrap();
        assert!(is_installed(dir.path(), &item));
    }
}
