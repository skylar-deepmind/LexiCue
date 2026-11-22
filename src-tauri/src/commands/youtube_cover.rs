use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, StatusCode};
use std::{io::Cursor, path::Path, time::Duration};
use tauri::Manager;
use tokio::sync::Semaphore;

const LIMIT: usize = 512 * 1024;
const ENTRIES: usize = 128;
static DOWNLOADS: Semaphore = Semaphore::const_new(3);
static STORAGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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

async fn store(dir: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let _guard = STORAGE.lock().await;
    tokio::fs::create_dir_all(dir).await?;
    let temp = dir.join(format!("{}.part", uuid::Uuid::new_v4()));
    tokio::fs::write(&temp, bytes).await?;
    if let Err(error) = tokio::fs::rename(&temp, path).await {
        let _ = tokio::fs::remove_file(temp).await;
        return Err(error);
    }
    let mut entries = tokio::fs::read_dir(dir).await?;
    let mut jpgs = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        if entry.path().extension().is_some_and(|ext| ext == "jpg") && entry.path() != path {
            jpgs.push((entry.metadata().await?.modified().ok(), entry.path()));
        }
    }
    let remove = (jpgs.len() + 1).saturating_sub(ENTRIES);
    if remove > 0 {
        jpgs.sort_by_key(|(modified, _)| *modified);
        for (_, stale) in jpgs.into_iter().take(remove) {
            let _ = tokio::fs::remove_file(stale).await;
        }
    }
    Ok(())
}

async fn fetch(
    client: &reqwest::Client,
    video: &str,
    quality: &str,
) -> Result<Vec<u8>, &'static str> {
    let mut response = client
        .get(format!("https://i.ytimg.com/vi/{video}/{quality}.jpg"))
        .header(reqwest::header::ACCEPT, "image/jpeg")
        .send()
        .await
        .map_err(|_| "network")?;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::REQUEST_TIMEOUT
        | StatusCode::INTERNAL_SERVER_ERROR
        | StatusCode::BAD_GATEWAY
        | StatusCode::SERVICE_UNAVAILABLE
        | StatusCode::GATEWAY_TIMEOUT => return Err("network"),
        StatusCode::NOT_FOUND => return Err("missing"),
        _ => return Err("unavailable"),
    }
    if response
        .content_length()
        .is_some_and(|size| size > LIMIT as u64)
    {
        return Err("invalid");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network")? {
        if bytes.len() + chunk.len() > LIMIT {
            return Err("invalid");
        }
        bytes.extend_from_slice(&chunk);
    }
    valid_jpeg(&bytes).then_some(bytes).ok_or("invalid")
}

#[tauri::command]
pub async fn youtube_cover(app: tauri::AppHandle, video_id: String) -> Result<String, String> {
    if !super::youtube::is_valid_video_id(&video_id) {
        return Err("invalid_url".into());
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "cover_io")?
        .join("youtube-covers-v1");
    let path = dir.join(format!("{video_id}.jpg"));
    if let Some(bytes) = cached(&path).await {
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    }
    let _permit = DOWNLOADS.acquire().await.map_err(|_| "cover_unavailable")?;
    if let Some(bytes) = cached(&path).await {
        return Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
    }
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "cover_unavailable")?;
    let result = match fetch(&client, &video_id, "hqdefault").await {
        Err("network") => {
            tokio::time::sleep(Duration::from_millis(400)).await;
            fetch(&client, &video_id, "hqdefault").await
        }
        result => result,
    };
    let bytes = match result {
        Err("missing" | "invalid") => fetch(&client, &video_id, "mqdefault").await?,
        result => result?,
    };
    if store(&dir, &path, &bytes).await.is_err() {
        log::warn!("YouTube cover cache write failed");
    }
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn caches_only_complete_decodable_jpegs() {
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode(&vec![42; 120 * 90], 120, 90, image::ExtendedColorType::L8)
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.jpg");
        store(dir.path(), &path, &jpeg).await.unwrap();
        assert_eq!(cached(&path).await, Some(jpeg.clone()));
        jpeg.truncate(jpeg.len() / 2);
        store(dir.path(), &path, &jpeg).await.unwrap();
        assert!(cached(&path).await.is_none());
        assert!(!valid_jpeg(&[0xff, 0xd8, 0, 0, 0xff, 0xd9]));
    }
}
