use super::youtube_attempt::{Failure, Trace};
use crate::db::DbState;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, StatusCode};
use std::{
    io::Cursor,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::Manager;
use tokio::{sync::Semaphore, time::Instant};

const LIMIT: usize = 512 * 1024;
static DOWNLOADS: Semaphore = Semaphore::const_new(3);

fn valid_jpeg(bytes: &[u8]) -> bool {
    if bytes.len() > LIMIT || !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return false;
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Jpeg);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .is_ok_and(|image| image.width() >= 120 && image.height() >= 90)
}

async fn cached(path: &Path) -> Option<Vec<u8>> {
    let metadata = tokio::fs::symlink_metadata(path).await.ok()?;
    if !metadata.is_file() || metadata.len() > LIMIT as u64 {
        return None;
    }
    let bytes = tokio::fs::read(path).await.ok()?;
    valid_jpeg(&bytes).then_some(bytes)
}

fn request_failure(error: reqwest::Error) -> Failure {
    if error.is_timeout() {
        Failure::Timeout
    } else if error.is_request() || error.is_body() {
        Failure::ConnectionInterrupted
    } else {
        Failure::CoverUnavailable
    }
}

async fn fetch(client: &reqwest::Client, video: &str, quality: &str) -> Result<Vec<u8>, Failure> {
    let mut response = client
        .get(format!("https://i.ytimg.com/vi/{video}/{quality}.jpg"))
        .header(reqwest::header::ACCEPT, "image/jpeg")
        .send()
        .await
        .map_err(request_failure)?;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::TOO_MANY_REQUESTS => return Err(Failure::RateLimited),
        StatusCode::REQUEST_TIMEOUT => return Err(Failure::Timeout),
        StatusCode::NOT_FOUND => return Err(Failure::CoverMissing),
        status if status.is_server_error() => return Err(Failure::ServerError),
        _ => return Err(Failure::CoverUnavailable),
    }
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err(Failure::CoverInvalid);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(request_failure)? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err(Failure::CoverInvalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    valid_jpeg(&bytes)
        .then_some(bytes)
        .ok_or(Failure::CoverInvalid)
}

fn retain_artwork(app: &tauri::AppHandle, video_id: &str, bytes: &[u8]) {
    if let Some(state) = app.try_state::<DbState>() {
        if let Ok(db) = state.conn.lock() {
            if let Err(error) = super::library_attachments::store_cover(&db, video_id, bytes) {
                log::warn!("Could not retain material artwork: {error}");
            }
        }
    }
}

pub(super) async fn import_cover(
    app: &tauri::AppHandle,
    video_id: &str,
    trace: &Trace,
) -> Result<String, Failure> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| Failure::LocalIo)?
        .join("youtube-covers-v1");
    let path = dir.join(format!("{video_id}.jpg"));
    let started = Instant::now();
    let _permit = DOWNLOADS
        .acquire()
        .await
        .map_err(|_| Failure::CoverUnavailable)?;
    if let Some(bytes) = cached(&path).await {
        trace.record("cover_cache", 1, started, None);
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    }
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| Failure::CoverUnavailable)?;
    let fallback = AtomicBool::new(false);
    let bytes = trace
        .step("cover", Duration::from_secs(21), true, || async {
            let quality = if fallback.load(Ordering::Relaxed) {
                "mqdefault"
            } else {
                "hqdefault"
            };
            match fetch(&client, video_id, quality).await {
                Err(Failure::CoverMissing | Failure::CoverInvalid) if quality == "hqdefault" => {
                    // Once HQ is unavailable, any remaining retry uses the lower resolution.
                    fallback.store(true, Ordering::Relaxed);
                    fetch(&client, video_id, "mqdefault").await
                }
                result => result,
            }
        })
        .await?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn youtube_cover(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    if !super::youtube::is_valid_video_id(&video_id) {
        return Err("invalid_url".into());
    }
    let trace = Trace::new(Instant::now() + Duration::from_secs(40));
    let cover = import_cover(&app, &video_id, &trace)
        .await
        .map_err(|error| error.code().to_owned())?;
    if let Some(bytes) = cover_bytes(&cover) {
        retain_artwork(&app, &video_id, &bytes);
    }
    Ok(cover)
}

pub(super) fn cover_bytes(cover: &str) -> Option<Vec<u8>> {
    STANDARD
        .decode(cover.strip_prefix("data:image/jpeg;base64,")?)
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_only_complete_decodable_legacy_jpegs() {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(&vec![42; 120 * 90], 120, 90, image::ExtendedColorType::L8)
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.jpg");
        tokio::fs::write(&path, &jpeg).await.unwrap();
        assert_eq!(cached(&path).await, Some(jpeg.clone()));
        jpeg.truncate(jpeg.len() / 2);
        tokio::fs::write(&path, &jpeg).await.unwrap();
        assert!(cached(&path).await.is_none());
        assert!(!valid_jpeg(&[0xff, 0xd8, 0, 0, 0xff, 0xd9]));
    }
}
