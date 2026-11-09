use crate::commands::ios_reading::{ReadingProgress, ReadingRequest};
use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
};
use objc2_avf_audio::{
    AVSpeechBoundary, AVSpeechSynthesisVoice, AVSpeechSynthesizer, AVSpeechSynthesizerDelegate,
    AVSpeechUtterance,
};
use objc2_foundation::{NSObject, NSObjectProtocol, NSString};
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering},
};
use tauri::{AppHandle, Emitter};

struct DelegateState {
    app: AppHandle,
    id: String,
    indices: HashMap<usize, usize>,
    last: usize,
    index: AtomicUsize,
    status: AtomicU8,
    active: AtomicBool,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[ivars = DelegateState]
    struct ReadingDelegate;
    unsafe impl NSObjectProtocol for ReadingDelegate {}
    unsafe impl AVSpeechSynthesizerDelegate for ReadingDelegate {
        #[unsafe(method(speechSynthesizer:didStartSpeechUtterance:))]
        unsafe fn started(&self, _synth: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.update(utterance, 1);
        }
        #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
        unsafe fn finished(&self, _synth: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            if self.ivars().indices.get(&(utterance as *const _ as usize))
                == Some(&self.ivars().last)
            {
                self.update(utterance, 3);
            }
        }
        #[unsafe(method(speechSynthesizer:didPauseSpeechUtterance:))]
        unsafe fn paused(&self, _synth: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.update(utterance, 2);
        }
        #[unsafe(method(speechSynthesizer:didContinueSpeechUtterance:))]
        unsafe fn continued(&self, _synth: &AVSpeechSynthesizer, utterance: &AVSpeechUtterance) {
            self.update(utterance, 1);
        }
    }
);
// All delegate state is immutable or atomic; UIKit controls remain on the main thread.
unsafe impl Send for ReadingDelegate {}
unsafe impl Sync for ReadingDelegate {}
impl ReadingDelegate {
    fn update(&self, utterance: &AVSpeechUtterance, status: u8) {
        let state = self.ivars();
        if !state.active.load(Ordering::SeqCst) {
            return;
        }
        if let Some(index) = state.indices.get(&(utterance as *const _ as usize)) {
            state.index.store(*index, Ordering::SeqCst);
            state.status.store(status, Ordering::SeqCst);
            let progress = self.progress();
            // Diagnostic events contain positions only, never material text or keys.
            log::info!(
                "iOS reading {} sentence {}",
                progress.status,
                progress.index + 1
            );
            let _ = state.app.emit("ios-reading-progress", progress);
        }
    }
    fn progress(&self) -> ReadingProgress {
        let state = self.ivars();
        ReadingProgress {
            id: state.id.clone(),
            index: state.index.load(Ordering::SeqCst),
            source: "device".into(),
            status: match state.status.load(Ordering::SeqCst) {
                1 => "playing",
                2 => "paused",
                3 => "ended",
                _ => "loading",
            }
            .into(),
        }
    }
}
struct Player {
    synth: Retained<AVSpeechSynthesizer>,
    delegate: Retained<ReadingDelegate>,
}
thread_local! { static PLAYER: RefCell<Option<Player>> = const { RefCell::new(None) }; }
fn stop() {
    PLAYER.with_borrow_mut(|state| {
        if let Some(player) = state.take() {
            unsafe {
                player
                    .delegate
                    .ivars()
                    .active
                    .store(false, Ordering::SeqCst);
                player.synth.setDelegate(None);
                player
                    .synth
                    .stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            }
        }
    });
}
pub fn start(app: AppHandle, request: ReadingRequest) -> Result<(), String> {
    stop();
    if request.online_enabled {
        return crate::ios_edge_reading::start(app, request);
    }
    crate::ios_edge_reading::stop_current();
    if !request.allow_device_fallback {
        return Err("offline_unavailable".into());
    }
    crate::ios::prepare_audio_session()?;
    unsafe {
        let language = NSString::from_str(if request.accent == "gb" {
            "en-GB"
        } else {
            "en-US"
        });
        let voice =
            AVSpeechSynthesisVoice::voiceWithLanguage(Some(&language)).ok_or("no_device_voice")?;
        let utterances: Vec<_> = request
            .texts
            .iter()
            .skip(request.start_index)
            .map(|text| {
                let utterance =
                    AVSpeechUtterance::speechUtteranceWithString(&NSString::from_str(text));
                utterance.setVoice(Some(&voice));
                utterance.setRate(0.5 * request.rate);
                utterance
            })
            .collect();
        let indices = utterances
            .iter()
            .enumerate()
            .map(|(i, u)| (Retained::as_ptr(u) as usize, request.start_index + i))
            .collect();
        let delegate = ReadingDelegate::alloc().set_ivars(DelegateState {
            app,
            id: request.id,
            indices,
            last: request.texts.len() - 1,
            index: AtomicUsize::new(request.start_index),
            status: AtomicU8::new(0),
            active: AtomicBool::new(true),
        });
        let delegate: Retained<ReadingDelegate> = msg_send![super(delegate), init];
        let synth = AVSpeechSynthesizer::new();
        synth.setUsesApplicationAudioSession(true);
        synth.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        for utterance in &utterances {
            synth.speakUtterance(utterance);
        }
        PLAYER.with_borrow_mut(|state| *state = Some(Player { synth, delegate }));
    }
    Ok(())
}
pub fn control(id: &str, action: &str) -> Option<ReadingProgress> {
    if let Some(progress) = crate::ios_edge_reading::control(id, action) {
        return Some(progress);
    }
    let progress = PLAYER.with_borrow(|state| {
        let player = state.as_ref()?;
        if player.delegate.ivars().id != id {
            return None;
        }
        unsafe {
            match action {
                "pause" => {
                    player
                        .synth
                        .pauseSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                    player.delegate.ivars().status.store(2, Ordering::SeqCst);
                }
                "resume" => {
                    let _ = crate::ios::prepare_audio_session();
                    player.synth.continueSpeaking();
                }
                _ => {}
            }
        }
        Some(player.delegate.progress())
    });
    if action == "stop" && progress.is_some() {
        stop();
    }
    progress
}
