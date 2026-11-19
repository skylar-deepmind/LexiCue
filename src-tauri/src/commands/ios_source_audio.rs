use super::youtube::{mobile_audio, DownloadJob};
use super::MAX_BYTES;
use std::ffi::{c_char, CString};
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tokio::sync::oneshot;

type Times = (i64, i64);
type Probe = (u64, oneshot::Sender<Times>);
static NEXT: AtomicU64 = AtomicU64::new(1);
// The existing source download mutex serializes probes.
static CURRENT: Mutex<Option<Probe>> = Mutex::new(None);

extern "C" {
    fn lexicue_ios_probe_audio(
        id: u64,
        path: *const c_char,
        target: *const c_char,
        callback: extern "C" fn(u64, i64, i64),
    );
}

extern "C" fn completed(id: u64, duration: i64, origin: i64) {
    if let Ok(mut current) = CURRENT.lock() {
        if current.as_ref().is_some_and(|(active, _)| *active == id) {
            if let Some((_, sender)) = current.take() {
                let _ = sender.send((duration, origin));
            }
        }
    }
}

struct Pending(u64);
impl Drop for Pending {
    fn drop(&mut self) {
        completed(self.0, -1, 0);
    }
}

pub(super) async fn normalize(path: &Path, target: &Path) -> Result<Times, String> {
    let path = CString::new(path.to_str().ok_or("media_io")?).map_err(|_| "media_io")?;
    let target = CString::new(target.to_str().ok_or("media_io")?).map_err(|_| "media_io")?;
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (sender, result) = oneshot::channel();
    CURRENT
        .lock()
        .map_err(|_| "media_io")?
        .replace((id, sender));
    let _pending = Pending(id);
    // The bridge copies the path into a file URL synchronously.
    unsafe { lexicue_ios_probe_audio(id, path.as_ptr(), target.as_ptr(), completed) };
    let (duration, origin) = tokio::time::timeout(Duration::from_secs(25), result)
        .await
        .map_err(|_| "media_decode_failed")?
        .map_err(|_| "media_decode_failed")?;
    if duration < 0 {
        return Err("media_decode_failed".into());
    }
    Ok((duration, origin))
}

async fn transfer(format: &serde_json::Value, path: &Path) -> Result<(), String> {
    let url = reqwest::Url::parse(format["url"].as_str().ok_or("media_track_missing")?)
        .map_err(|_| "media_invalid_source")?;
    if !mobile_audio::media_url(&url) {
        return Err("media_invalid_source".into());
    }
    let expected = format["filesize"].as_u64().ok_or("media_track_missing")?;
    if !(1..=MAX_BYTES).contains(&expected) {
        return Err("media_budget".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && mobile_audio::media_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "media_network")?;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|_| "media_io")?;
    let mut written = 0;
    let run = async {
        for attempt in 0..3 {
            match mobile_audio::transfer_once(&client, &url, expected, &mut file, &mut written)
                .await
            {
                Err("media_network") if attempt < 2 => {
                    tokio::time::sleep(Duration::from_secs(attempt + 1)).await;
                }
                result => return result,
            }
        }
        Err("media_network")
    };
    tokio::time::timeout(Duration::from_secs(420), run)
        .await
        .map_err(|_| "media_network")??;
    file.sync_all().await.map_err(|_| "media_io".into())
}

pub(super) async fn download(
    format: &serde_json::Value,
    path: &Path,
    job: &DownloadJob,
) -> Result<(), String> {
    tokio::select! {
        _ = job.cancel_signal() => Err("media_cancelled".into()),
        result = transfer(format, path) => result,
    }
}
