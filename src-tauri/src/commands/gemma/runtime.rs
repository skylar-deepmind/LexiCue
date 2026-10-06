//! Native inference lives on one worker. The WebView never loads model weights.
use super::models::{asset, installed_path, verify_file};
use crate::commands::ollama::{CancellationToken, ChatFailure, ChatResult};
use libloading::Library;
use serde::Serialize;
use serde_json::Value;
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub const CONTEXT: i64 = 8192;
pub const INPUT_LIMIT: i64 = CONTEXT - 2048 - 128;
static WORKER: OnceLock<Worker> = OnceLock::new();
static BACKGROUND: AtomicBool = AtomicBool::new(false);
static EPOCH: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub model: Option<String>,
    pub backend: Option<String>,
    pub state: String,
    pub load_ms: Option<u128>,
    pub error: Option<String>,
}
struct Worker {
    sender: mpsc::Sender<Job>,
    status: Arc<Mutex<RuntimeStatus>>,
    pub models_dir: PathBuf,
    pub library_dir: PathBuf,
}
enum Job {
    Count {
        model: String,
        prompt: String,
        token: CancellationToken,
        epoch: u64,
        reply: tokio::sync::oneshot::Sender<Result<i64, String>>,
    },
    Generate {
        model: String,
        prompt: String,
        schema: Value,
        token: CancellationToken,
        epoch: u64,
        events: tokio::sync::mpsc::UnboundedSender<Event>,
    },
    Unload(tokio::sync::oneshot::Sender<()>),
}
enum Event {
    Fragment(String),
    Done(Result<ChatResult, String>),
}

#[repr(C)]
#[derive(Default)]
struct Usage {
    input: i64,
    output: i64,
}
type Create = unsafe extern "C" fn(*const c_char, *const c_char, *const c_char) -> *mut c_void;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Count = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> i64;
type Generate = unsafe extern "C" fn(
    *mut c_void,
    *const c_char,
    *const c_char,
    *const c_char,
    extern "C" fn(*mut c_void, *const c_char),
    extern "C" fn(*mut c_void) -> bool,
    *mut c_void,
    *mut Usage,
) -> i32;
struct Engine {
    handle: *mut c_void,
    destroy: Destroy,
    count: Count,
    generate: Generate,
    _library: Library,
    _dependency: Option<Library>,
    model: String,
}
impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            (self.destroy)(self.handle);
        }
    }
}
fn cstring(text: &str) -> Result<CString, String> {
    CString::new(text).map_err(|_| "ERR_MODEL_INPUT_NUL".into())
}
fn bridge_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "lexicue_gemma.dll"
    } else if cfg!(target_os = "macos") {
        "liblexicue_gemma.dylib"
    } else {
        "liblexicue_gemma.so"
    }
}
fn bridge_path(dir: &Path) -> PathBuf {
    if cfg!(target_os = "android") {
        PathBuf::from(bridge_filename())
    } else {
        dir.join(bridge_filename())
    }
}
fn update(status: &Mutex<RuntimeStatus>, app: Option<&AppHandle>, next: RuntimeStatus) {
    if let Ok(mut value) = status.lock() {
        *value = next.clone();
    }
    if let Some(app) = app {
        let _ = app.emit("gemma-runtime-status", next);
    }
}
fn load(
    dir: &Path,
    models: &Path,
    model: &str,
    status: &Mutex<RuntimeStatus>,
    app: Option<&AppHandle>,
    token: &CancellationToken,
) -> Result<Engine, String> {
    let item = asset(model)?;
    super::models::check_memory(&item)?;
    super::models::check_cache_space(models, &item)?;
    let path = installed_path(models, &item);
    update(
        status,
        app,
        RuntimeStatus {
            model: Some(model.into()),
            state: "loading".into(),
            ..Default::default()
        },
    );
    // Revalidate before loading, not on every Settings render. Corrupted assets
    // cannot enter the native parser even if an old installation receipt exists.
    verify_file(&path, &item, token)?;
    if token.cancelled() || BACKGROUND.load(Ordering::SeqCst) {
        return Err("ERR_CANCELLED".into());
    }
    let started = Instant::now();
    let cache = super::models::cache_path(models, &item);
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    unsafe {
        let dependency = if cfg!(target_os = "windows") {
            Some(
                Library::new(dir.join("litert-lm.dll"))
                    .map_err(|e| format!("ERR_RUNTIME_LIBRARY: {e}"))?,
            )
        } else {
            None
        };
        let library =
            Library::new(bridge_path(dir)).map_err(|e| format!("ERR_RUNTIME_LIBRARY: {e}"))?;
        let abi = library
            .get::<unsafe extern "C" fn() -> i32>(b"lx_abi\0")
            .map_err(|e| e.to_string())?;
        if abi() != 1 {
            return Err("ERR_RUNTIME_ABI".into());
        }
        let create: Create = *library.get(b"lx_create\0").map_err(|e| e.to_string())?;
        let destroy: Destroy = *library.get(b"lx_destroy\0").map_err(|e| e.to_string())?;
        let count: Count = *library.get(b"lx_count\0").map_err(|e| e.to_string())?;
        let generate: Generate = *library.get(b"lx_generate\0").map_err(|e| e.to_string())?;
        let path = cstring(&path.to_string_lossy())?;
        let cache = cstring(&cache.to_string_lossy())?;
        let mut handle = std::ptr::null_mut();
        let mut backend = "cpu";
        for candidate in ["gpu", "cpu"] {
            if candidate == "cpu" {
                super::models::check_cpu_memory(&item)?;
            }
            let name = cstring(candidate)?;
            handle = create(path.as_ptr(), name.as_ptr(), cache.as_ptr());
            if !handle.is_null() {
                backend = candidate;
                break;
            }
        }
        if handle.is_null() {
            return Err("ERR_MODEL_LOAD: GPU and CPU initialization failed".into());
        }
        update(
            status,
            app,
            RuntimeStatus {
                model: Some(model.into()),
                backend: Some(backend.into()),
                state: "ready".into(),
                load_ms: Some(started.elapsed().as_millis()),
                error: None,
            },
        );
        Ok(Engine {
            handle,
            destroy,
            count,
            generate,
            _library: library,
            _dependency: dependency,
            model: model.into(),
        })
    }
}
impl Engine {
    fn count(&self, prompt: &str) -> Result<i64, String> {
        let system = cstring("Return only valid JSON that matches the schema.")?;
        let prompt = cstring(prompt)?;
        let n = unsafe { (self.count)(self.handle, system.as_ptr(), prompt.as_ptr()) };
        if n < 0 {
            Err("ERR_TOKENIZE".into())
        } else {
            Ok(n)
        }
    }
    fn run(&self, prompt: &str, schema: &Value, stream: &mut Stream) -> Result<ChatResult, String> {
        let input = self.count(prompt)?;
        if input > INPUT_LIMIT {
            return Err("ERR_CONTEXT_LIMIT".into());
        }
        if stream.cancelled() {
            return Err("ERR_CANCELLED".into());
        }
        let system = cstring("Return only valid JSON that matches the schema.")?;
        let prompt = cstring(prompt)?;
        let schema = cstring(&schema.to_string())?;
        let mut usage = Usage {
            input: -1,
            output: -1,
        };
        let result = unsafe {
            (self.generate)(
                self.handle,
                system.as_ptr(),
                prompt.as_ptr(),
                schema.as_ptr(),
                fragment,
                cancel,
                stream as *mut Stream as *mut c_void,
                &mut usage,
            )
        };
        if stream.cancelled() || result == 2 {
            return Err("ERR_CANCELLED".into());
        }
        match result {
            0 => {}
            3 => return Err("ERR_CONTEXT_LIMIT".into()),
            4 => return Err("ERR_OUTPUT_TRUNCATED".into()),
            _ => return Err("ERR_MODEL_GENERATION".into()),
        }
        let buffer = stream.buffer.lock().map_err(|_| "ERR_MODEL_STREAM")?;
        if !buffer.pending.is_empty() {
            return Err("ERR_MODEL_UTF8".into());
        }
        serde_json::from_str::<Value>(&buffer.content).map_err(|_| {
            #[cfg(test)]
            eprintln!("INVALID_NATIVE_JSON={:?}", buffer.content);
            "ERR_MODEL_JSON"
        })?;
        Ok(ChatResult {
            content: buffer.content.clone(),
            request_id: None,
            finish_reason: Some("stop".into()),
            prompt_tokens: (usage.input >= 0).then_some(usage.input as u64),
            completion_tokens: (usage.output >= 0).then_some(usage.output as u64),
        })
    }
}
#[derive(Default)]
struct Buffer {
    content: String,
    pending: Vec<u8>,
}
struct Stream {
    token: CancellationToken,
    epoch: u64,
    events: tokio::sync::mpsc::UnboundedSender<Event>,
    buffer: Mutex<Buffer>,
    litert: bool,
}
impl Stream {
    fn cancelled(&self) -> bool {
        self.token.cancelled()
            || BACKGROUND.load(Ordering::SeqCst)
            || self.epoch != EPOCH.load(Ordering::SeqCst)
    }
}
extern "C" fn cancel(data: *mut c_void) -> bool {
    unsafe { (*(data as *mut Stream)).cancelled() }
}
extern "C" fn fragment(data: *mut c_void, text: *const c_char) {
    if text.is_null() {
        return;
    }
    // No panic crosses the C ABI. Callback data lives until native generation
    // has joined its final callback and destroyed the conversation.
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        let stream = &*(data as *mut Stream);
        if stream.cancelled() {
            return;
        }
        let bytes = CStr::from_ptr(text).to_bytes();
        if stream.litert {
            if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
                if let Some(parts) = value.get("content").and_then(Value::as_array) {
                    for part in parts {
                        if part.get("type").and_then(Value::as_str) == Some("text") {
                            if let Some(text) = part.get("text").and_then(Value::as_str) {
                                stream.push(text);
                            }
                        }
                    }
                } else if let Some(text) = value.get("content").and_then(Value::as_str) {
                    stream.push(text);
                } else if let Some(text) = value.pointer("/content/text").and_then(Value::as_str) {
                    stream.push(text);
                }
            }
        } else {
            let mut buffer = stream.buffer.lock().unwrap();
            buffer.pending.extend_from_slice(bytes);
            if let Ok(text) = std::str::from_utf8(&buffer.pending) {
                let text = text.to_owned();
                buffer.pending.clear();
                drop(buffer);
                stream.push(&text);
            }
        }
    }));
}
impl Stream {
    fn push(&self, text: &str) {
        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.content.push_str(text);
        }
        let _ = self.events.send(Event::Fragment(text.into()));
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let models = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("gemma-models");
    let library = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/gemma-runtime")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("resources/gemma-runtime")
    };
    start(models, library, Some(app.clone()), Duration::from_secs(300))
}
fn start(
    models: PathBuf,
    library: PathBuf,
    app: Option<AppHandle>,
    idle: Duration,
) -> Result<(), String> {
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    let (sender, receiver) = mpsc::channel();
    let status = Arc::new(Mutex::new(RuntimeStatus {
        state: "unloaded".into(),
        ..Default::default()
    }));
    WORKER
        .set(Worker {
            sender,
            status: status.clone(),
            models_dir: models.clone(),
            library_dir: library.clone(),
        })
        .map_err(|_| "ERR_RUNTIME_INITIALIZED")?;
    std::thread::Builder::new()
        .name("gemma-inference".into())
        .spawn(move || {
            let mut engine: Option<Engine> = None;
            loop {
                let job = match receiver.recv_timeout(idle) {
                    Ok(job) => job,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        engine = None;
                        update(
                            &status,
                            app.as_ref(),
                            RuntimeStatus {
                                state: "unloaded".into(),
                                ..Default::default()
                            },
                        );
                        continue;
                    }
                    Err(_) => break,
                };
                let job = match job {
                    Job::Unload(reply) => {
                        engine = None;
                        update(
                            &status,
                            app.as_ref(),
                            RuntimeStatus {
                                state: "unloaded".into(),
                                ..Default::default()
                            },
                        );
                        let _ = reply.send(());
                        continue;
                    }
                    other => other,
                };
                let (model, token, epoch) = match &job {
                    Job::Count {
                        model,
                        token,
                        epoch,
                        ..
                    }
                    | Job::Generate {
                        model,
                        token,
                        epoch,
                        ..
                    } => (model.clone(), token.clone(), *epoch),
                    Job::Unload(_) => unreachable!(),
                };
                let stopped = || {
                    token.cancelled()
                        || BACKGROUND.load(Ordering::SeqCst)
                        || epoch != EPOCH.load(Ordering::SeqCst)
                };
                let loaded = if stopped() {
                    Err("ERR_CANCELLED".into())
                } else {
                    if engine.as_ref().is_some_and(|e| e.model != model) {
                        engine = None;
                    }
                    if engine.is_none() {
                        match load(&library, &models, &model, &status, app.as_ref(), &token) {
                            Ok(value) => engine = Some(value),
                            Err(e) => {
                                update(
                                    &status,
                                    app.as_ref(),
                                    RuntimeStatus {
                                        state: "error".into(),
                                        error: Some(e.clone()),
                                        ..Default::default()
                                    },
                                );
                            }
                        }
                    }
                    if engine.is_some() {
                        Ok(())
                    } else {
                        Err(status
                            .lock()
                            .ok()
                            .and_then(|s| s.error.clone())
                            .unwrap_or_else(|| "ERR_MODEL_LOAD".into()))
                    }
                };
                match job {
                    Job::Count { prompt, reply, .. } => {
                        let _ = reply.send(loaded.and_then(|_| {
                            if stopped() {
                                Err("ERR_CANCELLED".into())
                            } else {
                                engine.as_ref().unwrap().count(&prompt)
                            }
                        }));
                    }
                    Job::Generate {
                        prompt,
                        schema,
                        token,
                        epoch,
                        events,
                        ..
                    } => {
                        let mut stream = Stream {
                            token,
                            epoch,
                            events: events.clone(),
                            buffer: Mutex::new(Buffer::default()),
                            litert: asset(&model).is_ok_and(|a| a.runtime == "litert"),
                        };
                        let result = loaded.and_then(|_| {
                            engine.as_ref().unwrap().run(&prompt, &schema, &mut stream)
                        });
                        let _ = events.send(Event::Done(result));
                    }
                    Job::Unload(_) => unreachable!(),
                }
                if BACKGROUND.load(Ordering::SeqCst) || epoch != EPOCH.load(Ordering::SeqCst) {
                    engine = None;
                    update(
                        &status,
                        app.as_ref(),
                        RuntimeStatus {
                            state: "unloaded".into(),
                            ..Default::default()
                        },
                    );
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn worker() -> Result<&'static Worker, String> {
    WORKER
        .get()
        .ok_or_else(|| "ERR_RUNTIME_NOT_INITIALIZED".into())
}
pub fn models_dir() -> Result<&'static Path, String> {
    Ok(&worker()?.models_dir)
}
pub fn status() -> RuntimeStatus {
    WORKER
        .get()
        .and_then(|w| w.status.lock().ok().map(|s| s.clone()))
        .unwrap_or_default()
}
pub fn available() -> Result<(), String> {
    if !super::models::supported() {
        return Err("ERR_PLATFORM_UNSUPPORTED".into());
    }
    let worker = worker()?;
    if !cfg!(target_os = "android") && !bridge_path(&worker.library_dir).is_file() {
        return Err("ERR_RUNTIME_LIBRARY".into());
    }
    Ok(())
}
pub async fn unload() -> Result<(), String> {
    let (reply, result) = tokio::sync::oneshot::channel();
    worker()?
        .sender
        .send(Job::Unload(reply))
        .map_err(|_| "ERR_RUNTIME_STOPPED")?;
    result.await.map_err(|_| "ERR_RUNTIME_STOPPED".into())
}
#[tauri::command]
pub fn set_gemma_background(background: bool) {
    BACKGROUND.store(background, Ordering::SeqCst);
    if background {
        EPOCH.fetch_add(1, Ordering::SeqCst);
        if let Ok(worker) = worker() {
            let (reply, _) = tokio::sync::oneshot::channel();
            let _ = worker.sender.send(Job::Unload(reply));
        }
    }
}
#[tauri::command]
pub fn gemma_runtime_status() -> RuntimeStatus {
    status()
}
pub async fn count(model: &str, prompt: String, token: &CancellationToken) -> Result<i64, String> {
    let epoch = EPOCH.load(Ordering::SeqCst);
    if token.cancelled() || BACKGROUND.load(Ordering::SeqCst) {
        return Err("ERR_CANCELLED".into());
    }
    let (reply, result) = tokio::sync::oneshot::channel();
    worker()?
        .sender
        .send(Job::Count {
            model: model.into(),
            prompt,
            token: token.clone(),
            epoch,
            reply,
        })
        .map_err(|_| "ERR_RUNTIME_STOPPED")?;
    tokio::select! { result = result => result.map_err(|_| "ERR_RUNTIME_STOPPED")?, _ = token.cancelled_future() => Err("ERR_CANCELLED".into()) }
}
pub async fn chat(
    model: &str,
    prompt: String,
    schema: Value,
    token: &CancellationToken,
    fragment: impl Fn(&str),
    activity: impl Fn(),
) -> Result<ChatResult, ChatFailure> {
    let failure = |message: String| ChatFailure {
        kind: if message.contains("ERR_CANCELLED") {
            "CANCELLED"
        } else if message.contains("ERR_CONTEXT_LIMIT") {
            "CONTEXT_LIMIT"
        } else if message.contains("ERR_OUTPUT_TRUNCATED") {
            "OUTPUT_TRUNCATED"
        } else if message.contains("ERR_MODEL_JSON") {
            "INVALID_JSON"
        } else {
            "LOCAL_RUNTIME_ERROR"
        },
        message,
        http_status: None,
        request_id: None,
    };
    let epoch = EPOCH.load(Ordering::SeqCst);
    if token.cancelled() || BACKGROUND.load(Ordering::SeqCst) {
        return Err(failure("ERR_CANCELLED".into()));
    }
    let (events, mut result) = tokio::sync::mpsc::unbounded_channel();
    worker()
        .map_err(failure)?
        .sender
        .send(Job::Generate {
            model: model.into(),
            prompt,
            schema,
            token: token.clone(),
            epoch,
            events,
        })
        .map_err(|_| failure("ERR_RUNTIME_STOPPED".into()))?;
    // Keep receiving until native cancellation completes; queued work never
    // shares or prematurely frees an active engine. Drop callers still cancel.
    struct CancelOnDrop(CancellationToken, bool);
    impl Drop for CancelOnDrop {
        fn drop(&mut self) {
            if !self.1 {
                self.0.cancel();
            }
        }
    }
    let mut guard = CancelOnDrop(token.clone(), false);
    while let Some(event) = result.recv().await {
        match event {
            Event::Fragment(text) => {
                if !token.cancelled() {
                    activity();
                    fragment(&text);
                }
            }
            Event::Done(value) => {
                guard.1 = true;
                return value.map_err(failure);
            }
        }
    }
    Err(failure("ERR_RUNTIME_STOPPED".into()))
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_com_lexicue_app_MainActivity_nativeGemmaBackground(
    _: *mut c_void,
    _: *mut c_void,
    background: u8,
) {
    set_gemma_background(background != 0);
}

#[cfg(test)]
pub(crate) fn start_smoke(models: PathBuf, library: PathBuf) -> Result<(), String> {
    start(models, library, None, Duration::from_secs(1))
}

#[cfg(test)]
mod native_switch_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires both pinned Gemma models and the matching native engine"]
    async fn gemma4_local_model_switch_smoke() {
        let ids = if super::super::models::platform_runtime() == "llama" {
            [
                "gemma4-e2b-gguf-8e30dff3ac4c",
                "gemma4-e4b-gguf-a555b900214b",
            ]
        } else {
            [
                "gemma4-e2b-litert-181938105e0e",
                "gemma4-e4b-litert-0b2a8980ce15",
            ]
        };
        let dir = tempfile::tempdir().unwrap();
        for (id, variable) in ids
            .iter()
            .zip(["LEXICUE_GEMMA_SMOKE_MODEL", "LEXICUE_GEMMA_SMOKE_E4B_MODEL"])
        {
            let item = asset(id).unwrap();
            let source = std::env::var(variable).expect("set both model paths");
            std::fs::hard_link(source, installed_path(dir.path(), &item)).unwrap();
        }
        let library =
            std::env::var("LEXICUE_GEMMA_SMOKE_LIBRARY").expect("set native library directory");
        start(
            dir.path().into(),
            library.into(),
            None,
            Duration::from_secs(300),
        )
        .unwrap();
        let mut observations = Vec::new();
        for (index, id) in [ids[0], ids[1], ids[0]].iter().enumerate() {
            let started = Instant::now();
            let tokens = count(id, "模型切换验证".into(), &CancellationToken::default())
                .await
                .unwrap();
            assert!(tokens > 0);
            let current = status();
            assert_eq!(current.model.as_deref(), Some(*id));
            assert_eq!(current.state, "ready");
            let marker = format!("switch-{index}");
            let response = chat(id, format!("Return the marker {marker} as JSON."),
                serde_json::json!({"type":"object","properties":{"marker":{"type":"string","const":marker}},"required":["marker"],"additionalProperties":false}),
                &CancellationToken::default(), |_| {}, || {}).await.unwrap();
            let value: Value = serde_json::from_str(&response.content).unwrap();
            assert_eq!(value["marker"], marker);
            observations.push(serde_json::json!({"runtime":current,"tokenCount":tokens,"loadAndGenerateMs":started.elapsed().as_millis()}));
        }
        unload().await.unwrap();
        assert_eq!(status().state, "unloaded");
        assert_eq!(status().model, None);
        println!(
            "GEMMA_SWITCH_REPORT={}",
            serde_json::json!({"sequence":observations,"unloaded":true,"writesLearningData":false})
        );
    }
}
