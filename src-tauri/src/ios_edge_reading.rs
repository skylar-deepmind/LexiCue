//! Native MP3 queue with Edge synthesis/prefetch outside the suspended WebKit process.
use crate::commands::{
    ios_reading::{ReadingProgress, ReadingRequest},
    tts::{native_reading_audio, TtsAudio, TtsRequest},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
};
use objc2_avf_audio::{AVAudioPlayer, AVAudioPlayerDelegate};
use objc2_foundation::{NSData, NSError, NSObject, NSObjectProtocol};
use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Notify};

struct Session {
    app: AppHandle,
    request: ReadingRequest,
    index: AtomicUsize,
    status: AtomicU8,
    paused: AtomicBool,
    cancelled: AtomicBool,
    source: Mutex<String>,
    changed: Notify,
}
impl Session {
    fn progress(&self) -> ReadingProgress {
        ReadingProgress {
            id: self.request.id.clone(),
            index: self.index.load(Ordering::SeqCst),
            source: self.source.lock().unwrap().clone(),
            status: match self.status.load(Ordering::SeqCst) {
                1 => "playing",
                2 => "paused",
                3 => "ended",
                4 => "error",
                _ => "loading",
            }
            .into(),
        }
    }
    fn emit(&self, status: u8) {
        if self.cancelled.load(Ordering::SeqCst) {
            return;
        }
        self.status.store(status, Ordering::SeqCst);
        let p = self.progress();
        log::info!(
            "iOS Edge reading {} sentence {} source {}",
            p.status,
            p.index + 1,
            p.source
        );
        let _ = self.app.emit("ios-reading-progress", p);
    }
    async fn cancellation(&self) {
        while !self.cancelled.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
static SESSION: Mutex<Option<Arc<Session>>> = Mutex::new(None);
struct DelegateState {
    completed: AtomicBool,
    finished: Mutex<Option<oneshot::Sender<bool>>>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = DelegateState]
    struct AudioDelegate;
    unsafe impl NSObjectProtocol for AudioDelegate {}
    unsafe impl AVAudioPlayerDelegate for AudioDelegate {
        #[unsafe(method(audioPlayerDidFinishPlaying:successfully:))]
        unsafe fn finished(&self, _player: &AVAudioPlayer, success: bool) {
            self.ivars().completed.store(true, Ordering::SeqCst);
            if let Some(tx) = self.ivars().finished.lock().unwrap().take() {
                let _ = tx.send(success);
            }
        }
        #[unsafe(method(audioPlayerDecodeErrorDidOccur:error:))]
        unsafe fn failed(&self, _player: &AVAudioPlayer, _error: Option<&NSError>) {
            self.ivars().completed.store(true, Ordering::SeqCst);
            if let Some(tx) = self.ivars().finished.lock().unwrap().take() {
                let _ = tx.send(false);
            }
        }
    }
);
struct Player {
    player: Retained<AVAudioPlayer>,
    _delegate: Retained<AudioDelegate>,
    id: String,
}
thread_local! { static PLAYER: RefCell<Option<Player>> = const { RefCell::new(None) }; }
pub fn stop_current() {
    if let Some(session) = SESSION.lock().unwrap().take() {
        session.cancelled.store(true, Ordering::SeqCst);
        session.changed.notify_waiters();
    }
    PLAYER.with_borrow_mut(|state| {
        if let Some(player) = state.take() {
            unsafe {
                player.player.setDelegate(None);
                player.player.stop();
            }
        }
    });
}
pub fn start(app: AppHandle, request: ReadingRequest) -> Result<(), String> {
    stop_current();
    crate::ios::prepare_audio_session()?;
    let session = Arc::new(Session {
        app,
        index: AtomicUsize::new(request.start_index),
        request,
        status: AtomicU8::new(0),
        paused: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        source: Mutex::new("edge-network".into()),
        changed: Notify::new(),
    });
    log::info!(
        "iOS Edge reading voice {} rate {}",
        session.request.voice,
        session.request.rate
    );
    *SESSION.lock().unwrap() = Some(session.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(code) = drive(session.clone()).await {
            if !session.cancelled.load(Ordering::SeqCst) {
                log::warn!("iOS Edge reading failed: {}", code);
                session.emit(4);
            }
        }
    });
    Ok(())
}
async fn resolve(session: Arc<Session>, index: usize) -> Result<TtsAudio, String> {
    let req = &session.request;
    let request = TtsRequest {
        request_id: format!("{}-{index}", req.id),
        text: req.texts[index].clone(),
        kind: "sentence".into(),
        accent: req.accent.clone(),
        voice: req.voice.clone(),
        speed: "normal".into(),
        online_enabled: req.online_enabled,
    };
    tokio::select! { _ = session.cancellation() => Err("cancelled".into()), result = native_reading_audio(request) => result.map_err(|e| e.code) }
}
async fn drive(session: Arc<Session>) -> Result<(), String> {
    let mut pending = tokio::spawn(resolve(session.clone(), session.request.start_index));
    for index in session.request.start_index..session.request.texts.len() {
        session.index.store(index, Ordering::SeqCst);
        let audio = pending.await.map_err(|_| "device_failed")??;
        loop {
            let changed = session.changed.notified();
            if session.cancelled.load(Ordering::SeqCst) {
                return Ok(());
            }
            if !session.paused.load(Ordering::SeqCst) {
                break;
            }
            changed.await;
        }
        let bytes = STANDARD
            .decode(&audio.data_base64)
            .map_err(|_| "invalid_audio")?;
        let (finished_tx, finished_rx) = oneshot::channel();
        let (loaded_tx, loaded_rx) = oneshot::channel();
        let current = session.clone();
        session
            .app
            .run_on_main_thread(move || {
                let result = play(current, index, &audio.source, bytes, finished_tx);
                let _ = loaded_tx.send(result);
            })
            .map_err(|_| "device_failed")?;
        loaded_rx.await.map_err(|_| "device_failed")??;
        // A separate native resolver owns prefetch; dictionary pronunciation cannot cancel it.
        let has_next = index + 1 < session.request.texts.len();
        pending = if has_next {
            tokio::spawn(resolve(session.clone(), index + 1))
        } else {
            tokio::spawn(async { Err("ended".into()) })
        };
        let success = tokio::select! { _ = session.cancellation() => { pending.abort(); return Ok(()); }, result = finished_rx => result.unwrap_or(false) };
        if !success {
            pending.abort();
            return Err("invalid_audio".into());
        }
        if !has_next {
            session.emit(3);
            return Ok(());
        }
    }
    Ok(())
}
fn play(
    session: Arc<Session>,
    index: usize,
    source: &str,
    bytes: Vec<u8>,
    finished: oneshot::Sender<bool>,
) -> Result<(), String> {
    if session.cancelled.load(Ordering::SeqCst) {
        return Err("cancelled".into());
    }
    unsafe {
        let player =
            AVAudioPlayer::initWithData_error(AVAudioPlayer::alloc(), &NSData::with_bytes(&bytes))
                .map_err(|_| "invalid_audio")?;
        player.setEnableRate(true);
        player.setRate(session.request.rate);
        let delegate = AudioDelegate::alloc().set_ivars(DelegateState {
            completed: AtomicBool::new(false),
            finished: Mutex::new(Some(finished)),
        });
        let delegate: Retained<AudioDelegate> = msg_send![super(delegate), init];
        player.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        session.index.store(index, Ordering::SeqCst);
        *session.source.lock().unwrap() = source.into();
        let paused = session.paused.load(Ordering::SeqCst);
        if !paused && !player.play() {
            return Err("playback_failed".into());
        }
        PLAYER.with_borrow_mut(|state| {
            *state = Some(Player {
                player,
                _delegate: delegate,
                id: session.request.id.clone(),
            })
        });
        session.emit(if paused { 2 } else { 1 });
    }
    Ok(())
}
pub fn control(id: &str, action: &str) -> Option<ReadingProgress> {
    let session = SESSION
        .lock()
        .unwrap()
        .as_ref()
        .filter(|s| s.request.id == id)?
        .clone();
    match action {
        "pause" => {
            session.paused.store(true, Ordering::SeqCst);
            PLAYER.with_borrow(|p| {
                if let Some(p) = p.as_ref().filter(|p| p.id == id) {
                    unsafe {
                        p.player.pause();
                    }
                }
            });
            session.emit(2);
        }
        "resume" => {
            session.paused.store(false, Ordering::SeqCst);
            let playing = PLAYER.with_borrow(|p| {
                p.as_ref()
                    .filter(|p| p.id == id && !p._delegate.ivars().completed.load(Ordering::SeqCst))
                    .is_some_and(|p| unsafe { p.player.play() })
            });
            session.emit(if playing { 1 } else { 0 });
            session.changed.notify_waiters();
        }
        "stop" => {
            stop_current();
        }
        _ => {}
    }
    Some(session.progress())
}
