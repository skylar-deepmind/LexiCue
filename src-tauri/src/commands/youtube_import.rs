use super::{
    source_media::YoutubeSource,
    webpage::{registered_import, WebpageState},
    youtube::is_valid_video_id,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use tauri::State;
use tokio::{fs, process::Command};

const CAPTION_LANGUAGES: [&str; 4] = ["en", "en-orig", "en-US", "en-GB"];
const MAX_CAPTION_BYTES: u64 = 8_000_000;

#[derive(Serialize)]
pub struct CaptionImport {
    content: String,
    source: YoutubeSource,
}

#[derive(Deserialize)]
struct VideoMetadata {
    title: String,
    duration: f64,
}

fn video_id(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }
    let path = url.path().trim_end_matches('/');
    let id = match url.host_str()? {
        "youtu.be" | "www.youtu.be" => path.strip_prefix('/')?.to_owned(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" => {
            if path == "/watch" {
                url.query_pairs()
                    .find(|(name, _)| name == "v")?
                    .1
                    .into_owned()
            } else {
                let (kind, id) = path.strip_prefix('/')?.split_once('/')?;
                matches!(kind, "shorts" | "embed" | "live").then(|| id.to_owned())?
            }
        }
        _ => return None,
    };
    is_valid_video_id(&id).then_some(id)
}

fn tools_directory(tool: &str) -> Option<&'static str> {
    ["/opt/homebrew/bin", "/usr/local/bin"]
        .into_iter()
        .find(|dir| Path::new(dir).join(tool).is_file())
}

async fn fetch(url: &str) -> Result<CaptionImport, String> {
    let id = video_id(url).ok_or("material_web_invalid")?;
    let ytdlp = tools_directory("yt-dlp").ok_or("material_youtube_tool_missing")?;
    let ffmpeg = tools_directory("ffmpeg").ok_or("material_youtube_tool_missing")?;
    let directory = tempfile::tempdir().map_err(|_| "material_download_failed")?;
    let canonical = format!("https://www.youtube.com/watch?v={id}");
    let output = Command::new(Path::new(ytdlp).join("yt-dlp"))
        .kill_on_drop(true)
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .current_dir(directory.path())
        .args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-cache-dir",
            "--no-playlist",
            "--skip-download",
            "--no-simulate",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            &CAPTION_LANGUAGES.join(","),
            "--sub-format",
            "vtt",
            "--ffmpeg-location",
            ffmpeg,
            "--convert-subs",
            "srt",
            "--socket-timeout",
            "12",
            "--retries",
            "0",
            "--output",
            "captions.%(ext)s",
            "--print",
            "after_video:%(.{title,duration})j",
            "--",
            &canonical,
        ])
        .output()
        .await
        .map_err(|_| "material_youtube_tool_missing")?;
    if !output.status.success() {
        return Err("material_download_failed".into());
    }
    let mut selected = None;
    for language in CAPTION_LANGUAGES {
        let path = directory.path().join(format!("captions.{language}.srt"));
        if let Ok(metadata) = fs::metadata(&path).await {
            if metadata.len() > MAX_CAPTION_BYTES {
                return Err("material_too_large".into());
            }
            selected = Some((language, path));
            break;
        }
    }
    let (language, path) = selected.ok_or("material_youtube_no_subtitles")?;
    let content = fs::read_to_string(path)
        .await
        .map_err(|_| "material_download_failed")?;
    let metadata: VideoMetadata =
        serde_json::from_slice(&output.stdout).map_err(|_| "material_download_failed")?;
    let title = metadata.title.trim().chars().take(240).collect();
    let source = YoutubeSource::from_imported_captions(
        &id,
        title,
        (metadata.duration * 1000.).round() as i64,
        language,
        &content,
    )
    .map_err(|_| "material_download_failed")?;
    Ok(CaptionImport { content, source })
}

#[tauri::command]
pub async fn fetch_import_youtube(
    state: State<'_, WebpageState>,
    job: String,
    url: String,
) -> Result<CaptionImport, String> {
    registered_import(&state, job, &url, Duration::from_secs(50), fetch(&url)).await
}

#[cfg(test)]
mod tests {
    use super::video_id;

    #[test]
    fn accepts_only_direct_video_ids_from_known_hosts() {
        let id = "dQw4w9WgXcQ";
        for url in [
            format!("https://www.youtube.com/watch?list=example&v={id}"),
            format!("https://youtu.be/{id}?t=20"),
            format!("https://m.youtube.com/shorts/{id}"),
        ] {
            assert_eq!(video_id(&url).as_deref(), Some(id));
        }
        for url in [
            format!("https://youtube.com.example.org/watch?v={id}"),
            format!("https://user@youtube.com/watch?v={id}"),
            format!("https://youtu.be:8080/{id}"),
            format!("https://www.youtube.com/playlist?list={id}"),
            format!("https://youtu.be/{id}/extra"),
        ] {
            assert_eq!(video_id(&url), None);
        }
    }
}
