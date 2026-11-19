use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tokio::sync::oneshot;

type ResultSender = oneshot::Sender<Option<Vec<String>>>;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: std::sync::LazyLock<Mutex<HashMap<u64, ResultSender>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

extern "C" {
    fn lexicue_apple_translate(
        id: u64,
        request: *const c_char,
        callback: extern "C" fn(u64, *const c_char),
    ) -> bool;
    fn lexicue_apple_cancel_translation(id: u64);
}

extern "C" fn complete(id: u64, response: *const c_char) {
    let sender = PENDING.lock().ok().and_then(|mut jobs| jobs.remove(&id));
    if let Some(sender) = sender {
        let value = if response.is_null() {
            None
        } else {
            // Swift keeps the response alive for the callback only.
            serde_json::from_slice(unsafe { CStr::from_ptr(response) }.to_bytes()).ok()
        };
        let _ = sender.send(value);
    }
}

struct Pending(u64);

impl Drop for Pending {
    fn drop(&mut self) {
        let cancelled = PENDING
            .lock()
            .ok()
            .and_then(|mut jobs| jobs.remove(&self.0))
            .is_some();
        if cancelled {
            unsafe { lexicue_apple_cancel_translation(self.0) };
        }
    }
}

pub(super) async fn translate(texts: &[&str]) -> Option<Vec<String>> {
    let _serial = SERIAL.lock().await;
    let request = CString::new(serde_json::to_vec(texts).ok()?).ok()?;
    let (sender, result) = oneshot::channel();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    PENDING.lock().ok()?.insert(id, sender);
    let _pending = Pending(id);
    // The bridge decodes the input before returning.
    if !unsafe { lexicue_apple_translate(id, request.as_ptr(), complete) } {
        return None;
    }
    let output = tokio::time::timeout(Duration::from_secs(240), result)
        .await
        .ok()?
        .ok()??;
    (output.len() == texts.len() && output.iter().all(|item| !item.trim().is_empty()))
        .then_some(output)
}
