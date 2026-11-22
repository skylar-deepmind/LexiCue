use super::{
    materials::MaterialInput,
    source_media::{self, AudioTrack, LocalAttachment, YoutubeSource, MAX_DURATION_MS},
    webpage::{registered_import, ImportDownload, WebpageState},
    youtube::is_valid_video_id,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, State};
use tokio::{
    fs,
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

const ENGLISH_CAPTIONS: [&str; 4] = ["en", "en-US", "en-GB", "en-orig"];
const ORIGINAL_ENGLISH_CAPTIONS: [&str; 6] = [
    "en-orig",
    "en-US-orig",
    "en-GB-orig",
    "en",
    "en-US",
    "en-GB",
];
const MAX_CAPTION_BYTES: u64 = 8_000_000;
const MAX_METADATA_BYTES: usize = 8_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CaptionTrack {
    language: &'static str,
    kind: &'static str,
}

#[derive(Serialize)]
pub struct CaptionImport {
    content: String,
    source: YoutubeSource,
    audio_unavailable: bool,
    cover: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct StagedAudio {
    key: String,
    duration_ms: i64,
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

fn staging_path(root: &Path, operation_id: &str) -> Result<PathBuf, String> {
    let id = uuid::Uuid::parse_str(operation_id).map_err(|_| "material_web_invalid")?;
    Ok(root.join(format!(".part-youtube-{id}")))
}

fn downloader(tool: &str, path: &Path) -> Command {
    let mut command = Command::new(Path::new(tool).join("yt-dlp"));
    command
        .kill_on_drop(true)
        .env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        .current_dir(path)
        .args([
            "--ignore-config",
            "--no-plugin-dirs",
            "--no-cache-dir",
            "--no-playlist",
            "--socket-timeout",
            "12",
            "--retries",
            "0",
        ]);
    command
}

async fn download_audio(
    mut command: Command,
    ffmpeg: &str,
    metadata_file: &Path,
    track: &AudioTrack,
    stage: &Path,
    progress: &Channel<ImportDownload>,
) -> Option<i64> {
    let mut child = command
        .arg("--load-info-json")
        .arg(metadata_file)
        .args([
            "--format",
            &track.format_id,
            "--no-write-subs",
            "--no-write-auto-subs",
            "--max-filesize",
            "96M",
            "--extract-audio",
            "--audio-format",
            "m4a",
            "--ffmpeg-location",
            ffmpeg,
            "--output",
            "original.%(ext)s",
            "--quiet",
            "--no-warnings",
            "--newline",
            "--progress",
            "--progress-delta",
            "0.15",
            "--progress-template",
            "download:lexicue-audio:%(progress.downloaded_bytes)s:%(progress.total_bytes)s",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    while let Some(line) = lines.next_line().await.ok()? {
        if let Some(value) = audio_progress(&line) {
            let _ = progress.send(value);
        }
    }
    if !child.wait().await.ok()?.success() {
        return None;
    }
    let audio = stage.join("original.m4a");
    if !fs::metadata(&audio)
        .await
        .ok()
        .is_some_and(|file| (1..=source_media::MAX_BYTES).contains(&file.len()))
    {
        return None;
    }
    let output = Command::new(Path::new(ffmpeg).join("ffprobe"))
        .kill_on_drop(true)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type:format=duration,start_time",
            "-of",
            "json",
        ])
        .arg(audio)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    if !parsed["streams"].as_array().is_some_and(|streams| {
        streams.len() == 1
            && streams[0]["codec_name"] == "aac"
            && streams[0]["codec_type"] == "audio"
    }) {
        return None;
    }
    let start = parsed["format"]["start_time"]
        .as_str()?
        .parse::<f64>()
        .ok()?;
    let duration = parsed["format"]["duration"].as_str()?.parse::<f64>().ok()?;
    (start.abs() <= 0.25 && duration.is_finite() && duration > 0.)
        .then(|| (duration * 1000.).round() as i64)
}

fn audio_progress(line: &str) -> Option<ImportDownload> {
    let (received, total) = line
        .trim()
        .strip_prefix("lexicue-audio:")?
        .split_once(':')?;
    let received = received.parse().ok()?;
    let total = total
        .parse::<u64>()
        .ok()
        .filter(|&n| n > 0 && n >= received);
    Some(ImportDownload::Audio { received, total })
}

fn caption_tracks(metadata: &serde_json::Value) -> [Option<CaptionTrack>; 2] {
    let manual = ENGLISH_CAPTIONS.into_iter().find(|&language| {
        metadata["subtitles"][language]
            .as_array()
            .is_some_and(|formats| !formats.is_empty())
    });
    let original = ORIGINAL_ENGLISH_CAPTIONS.into_iter().find(|&language| {
        metadata["automatic_captions"][language]
            .as_array()
            .is_some_and(|formats| {
                if language.ends_with("-orig") {
                    return !formats.is_empty();
                }
                // Some older extractors label original automatic captions simply
                // "en". Accept those only when the source track is English.
                formats.iter().any(|format| {
                    let Some(url) = format["url"].as_str().and_then(|url| Url::parse(url).ok())
                    else {
                        return false;
                    };
                    let mut parameters = url.query_pairs();
                    parameters.clone().any(|(key, value)| {
                        key == "lang" && (value == "en" || value.starts_with("en-"))
                    }) && !parameters.any(|(key, _)| key == "tlang")
                })
            })
    });
    [
        manual.map(|language| CaptionTrack {
            language,
            kind: "manual",
        }),
        original.map(|language| CaptionTrack {
            language,
            kind: "original",
        }),
    ]
}

fn extraction_error(stderr: &[u8], step: &'static str) -> &'static str {
    let reason = if String::from_utf8_lossy(stderr).contains("HTTP Error 429") {
        "material_youtube_rate_limited"
    } else {
        "material_download_failed"
    };
    // Downloader diagnostics can contain media URLs with temporary tokens.
    log::warn!("YouTube import: {step} failed ({reason})");
    reason
}

async fn download_caption(
    mut command: Command,
    ffmpeg: &str,
    metadata_file: &Path,
    directory: &Path,
    track: CaptionTrack,
) -> Result<String, &'static str> {
    let output = command
        .arg("--load-info-json")
        .arg(metadata_file)
        .args([
            "--skip-download",
            if track.kind == "manual" {
                "--write-subs"
            } else {
                "--write-auto-subs"
            },
            "--sub-langs",
            track.language,
            "--sub-format",
            "vtt",
            "--ffmpeg-location",
            ffmpeg,
            "--convert-subs",
            "srt",
            "--output",
            "captions.%(ext)s",
        ])
        .output()
        .await
        .map_err(|_| "material_youtube_tool_missing")?;
    if !output.status.success() {
        return Err(extraction_error(&output.stderr, "caption"));
    }
    let path = directory.join(format!("captions.{}.srt", track.language));
    let file = fs::metadata(&path)
        .await
        .map_err(|_| "material_download_failed")?;
    if file.len() > MAX_CAPTION_BYTES {
        return Err("material_too_large");
    }
    let content = fs::read_to_string(path)
        .await
        .map_err(|_| "material_download_failed")?;
    if content.trim().is_empty() {
        return Err("material_download_failed");
    }
    Ok(content)
}

async fn fetch(
    url: &str,
    stage: PathBuf,
    progress: &Channel<ImportDownload>,
) -> Result<CaptionImport, String> {
    let id = video_id(url).ok_or("material_web_invalid")?;
    let ytdlp = tools_directory("yt-dlp").ok_or("material_youtube_tool_missing")?;
    let ffmpeg = tools_directory("ffmpeg").ok_or("material_youtube_tool_missing")?;
    let root = stage.parent().ok_or("material_download_failed")?;
    fs::create_dir_all(root)
        .await
        .map_err(|_| "material_download_failed")?;
    let directory = tempfile::Builder::new()
        .prefix(".part-youtube-")
        .tempdir_in(root)
        .map_err(|_| "material_download_failed")?;
    let canonical = format!("https://www.youtube.com/watch?v={id}");
    let output = downloader(ytdlp, directory.path())
        .args([
            "--skip-download",
            "--extractor-args",
            "youtube:skip=translated_subs",
            "--dump-single-json",
            "--",
            &canonical,
        ])
        .output()
        .await
        .map_err(|_| "material_youtube_tool_missing")?;
    if !output.status.success() {
        return Err(extraction_error(&output.stderr, "video metadata").into());
    }
    if output.stdout.len() > MAX_METADATA_BYTES {
        return Err("material_too_large".into());
    }
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|_| "material_download_failed")?;
    let tracks = caption_tracks(&metadata);
    if tracks.iter().all(Option::is_none) {
        return Err("material_youtube_no_subtitles".into());
    }
    // Reuse this one video lookup for both downloads. It stays inside the
    // private temporary directory and is removed before audio is staged.
    // yt-dlp otherwise repeats the page extraction when a loaded request fails.
    metadata
        .as_object_mut()
        .ok_or("material_download_failed")?
        .remove("webpage_url");
    let metadata_file = directory.path().join("video.info.json");
    let manifest = serde_json::to_vec(&metadata).map_err(|_| "material_download_failed")?;
    fs::write(&metadata_file, manifest)
        .await
        .map_err(|_| "material_download_failed")?;
    let mut selected = None;
    for track in tracks.into_iter().flatten() {
        match download_caption(
            downloader(ytdlp, directory.path()),
            ffmpeg,
            &metadata_file,
            directory.path(),
            track,
        )
        .await
        {
            Ok(content) => {
                selected = Some((track, content));
                break;
            }
            Err("material_download_failed") => continue,
            // A rate limit applies to the request, not just to this track.
            Err(reason) => return Err(reason.into()),
        }
    }
    let (caption, content) = selected.ok_or("material_download_failed")?;
    let _ = progress.send(ImportDownload::Captions);
    let title = metadata["title"]
        .as_str()
        .unwrap_or(&id)
        .trim()
        .chars()
        .take(240)
        .collect();
    let duration_ms = (metadata["duration"]
        .as_f64()
        .ok_or("material_download_failed")?
        * 1000.)
        .round() as i64;
    let track = (1..=MAX_DURATION_MS)
        .contains(&duration_ms)
        .then(|| source_media::english_audio(&metadata))
        .flatten();
    let audio_duration = match &track {
        Some(track) => download_audio(
            downloader(ytdlp, directory.path()),
            ffmpeg,
            &metadata_file,
            track,
            directory.path(),
            progress,
        )
        .await
        .filter(|actual| actual.abs_diff(duration_ms) <= 5_000),
        None => None,
    };
    let source = YoutubeSource::from_imported_captions(
        &id,
        title,
        duration_ms,
        caption.language,
        &content,
        caption.kind,
        track.filter(|_| audio_duration.is_some()),
    )
    .map_err(|_| "material_download_failed")?;
    if let Some(duration_ms) = audio_duration {
        fs::remove_file(&metadata_file)
            .await
            .map_err(|_| "material_download_failed")?;
        let metadata = serde_json::to_vec(&StagedAudio {
            key: source.key.clone(),
            duration_ms,
        })
        .map_err(|_| "material_download_failed")?;
        fs::write(directory.path().join("audio.json"), metadata)
            .await
            .map_err(|_| "material_download_failed")?;
        // This directory belongs to one operation and is replaced only when a
        // new, validated capture of that operation is available.
        if stage.is_dir() {
            fs::remove_dir_all(&stage)
                .await
                .map_err(|_| "material_download_failed")?;
        }
        fs::rename(directory.path(), stage)
            .await
            .map_err(|_| "material_download_failed")?;
    }
    Ok(CaptionImport {
        content,
        source,
        audio_unavailable: audio_duration.is_none(),
        cover: None,
    })
}

#[tauri::command]
pub async fn fetch_import_youtube(
    app: AppHandle,
    state: State<'_, WebpageState>,
    job: String,
    url: String,
    operation_id: String,
    on_progress: Channel<ImportDownload>,
) -> Result<CaptionImport, String> {
    let stage = staging_path(&source_media::root(&app)?, &operation_id)?;
    let id = video_id(&url).ok_or("material_web_invalid")?;
    registered_import(&state, job, &url, Duration::from_secs(240), async {
        let (captions, cover) = tokio::join!(fetch(&url, stage, &on_progress), async {
            let cover = super::youtube_cover::youtube_cover(app, id).await.ok();
            if cover.is_some() {
                let _ = on_progress.send(ImportDownload::Cover);
            }
            cover
        });
        let mut captions = captions?;
        captions.cover = cover;
        Ok(captions)
    })
    .await
}

#[tauri::command]
pub async fn discard_youtube_import_audio(
    app: AppHandle,
    operation_id: String,
) -> Result<(), String> {
    let path = staging_path(&source_media::root(&app)?, &operation_id)?;
    let _ = fs::remove_dir_all(path).await;
    Ok(())
}

pub(super) fn take_attachment(
    app: &AppHandle,
    input: &MaterialInput,
) -> Result<Option<(PathBuf, LocalAttachment)>, String> {
    let Some(source) = input
        .source
        .as_ref()
        .filter(|source| source.provider == "youtube" && source.audio.is_some())
    else {
        return Ok(None);
    };
    // Ordinary receipts and imports from old versions need no staging folder.
    let Ok(stage) = staging_path(&source_media::root(app)?, &input.operation_id) else {
        return Ok(None);
    };
    let metadata = match std::fs::read(stage.join("audio.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("material_download_failed".into()),
    };
    let capture: StagedAudio =
        serde_json::from_slice(&metadata).map_err(|_| "material_download_failed")?;
    if capture.key != source.key
        || source.subtitle_sha256 != source_media::digest(input.content.as_bytes())
    {
        return Err("material_download_failed".into());
    }
    let attachment =
        LocalAttachment::youtube(source, &stage.join("original.m4a"), capture.duration_ms)?;
    Ok(Some((stage, attachment)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_one_human_english_track_then_the_source_track() {
        let metadata = serde_json::json!({
            "subtitles": {"en": [{"ext": "vtt"}], "en-GB": [{"ext": "vtt"}]},
            "automatic_captions": {"en-orig": [{"ext": "vtt"}], "en": [{"ext": "vtt"}]}
        });
        assert_eq!(
            caption_tracks(&metadata),
            [
                Some(CaptionTrack {
                    language: "en",
                    kind: "manual"
                }),
                Some(CaptionTrack {
                    language: "en-orig",
                    kind: "original"
                }),
            ]
        );
    }

    #[test]
    fn legacy_automatic_tracks_must_be_original_english() {
        let translated = serde_json::json!({
            "automatic_captions": {"en": [{"url": "https://www.youtube.com/api/timedtext?lang=es&tlang=en"}]}
        });
        assert_eq!(caption_tracks(&translated), [None, None]);
        let original = serde_json::json!({
            "automatic_captions": {"en": [{"url": "https://www.youtube.com/api/timedtext?lang=en"}]}
        });
        assert_eq!(
            caption_tracks(&original),
            [
                None,
                Some(CaptionTrack {
                    language: "en",
                    kind: "original"
                }),
            ]
        );
    }

    #[test]
    fn distinguishes_rate_limits_from_generic_caption_errors() {
        assert_eq!(
            extraction_error(b"ERROR: HTTP Error 429: Too Many Requests", "caption"),
            "material_youtube_rate_limited"
        );
        assert_eq!(
            extraction_error(b"ERROR: unexpected tool exit", "caption"),
            "material_download_failed"
        );
    }

    #[test]
    fn audio_progress_uses_only_known_byte_totals() {
        assert!(matches!(
            audio_progress("lexicue-audio:200:400"),
            Some(ImportDownload::Audio {
                received: 200,
                total: Some(400)
            })
        ));
        for line in ["lexicue-audio:200:NA", "lexicue-audio:200:100"] {
            assert!(matches!(
                audio_progress(line),
                Some(ImportDownload::Audio {
                    received: 200,
                    total: None
                })
            ));
        }
        assert!(audio_progress("[download] some unrelated message").is_none());
        assert!(audio_progress("lexicue-audio:NA:400").is_none());
    }

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

    #[test]
    fn audio_reimport_keeps_the_existing_caption_material_and_its_translation() {
        use crate::commands::{import::SegmentInput, materials};
        let directory = tempfile::tempdir().unwrap();
        let db = crate::db::init_db(&directory.path().join("test.db")).unwrap();
        let video = "abcdefghijk";
        let title = "Harbor";
        let content = "1\n00:00:00,000 --> 00:00:01,000\nWe saw the harbor.\n";
        let metadata = serde_json::json!({"language":"en","formats":[
            {"ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","language":"en","format_id":"140","abr":90}
        ]});
        let mut input = MaterialInput {
            operation_id: "text-first".into(),
            name: "Harbor.srt".into(),
            content: content.into(),
            segments: vec![SegmentInput {
                index: 0,
                en_text: "We saw the harbor.".into(),
                zh_text: Some("我们看到了港口。".into()),
                start_time: Some("00:00:00.000".into()),
                end_time: Some("00:00:01.000".into()),
            }],
            source: Some(
                YoutubeSource::from_imported_captions(
                    video,
                    title.into(),
                    1500,
                    "en",
                    content,
                    "unknown",
                    None,
                )
                .unwrap(),
            ),
            document: None,
            normalized_kind: None,
            tag_ids: vec![],
            new_tag_names: vec![],
        };
        let existing = materials::import_material(&db, &input).unwrap();
        input.operation_id = "audio-second".into();
        input.segments[0].zh_text = None;
        let source = YoutubeSource::from_imported_captions(
            video,
            title.into(),
            1500,
            "en",
            content,
            "manual",
            source_media::english_audio(&metadata),
        )
        .unwrap();
        input.source = Some(source.clone());
        let stage = directory.path().join(".part-youtube");
        std::fs::create_dir(&stage).unwrap();
        let path = stage.join("original.m4a");
        std::fs::write(&path, include_bytes!("test_data/local-import-aac.mp4")).unwrap();
        assert!(LocalAttachment::youtube(&source, &path, 10_000).is_err());
        let attachment = LocalAttachment::youtube(&source, &path, 1500).unwrap();
        let updated =
            materials::import_material_with_attachment(&db, &input, Some(&attachment)).unwrap();
        assert_eq!(updated.file_id, existing.file_id);
        assert_eq!(updated.outcome, "duplicate");
        let (sentence, zh): (i64, String) = db
            .query_row(
                "SELECT id, zh_text FROM segments WHERE file_id=?1",
                [updated.file_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(zh, "我们看到了港口。");
        let reference = source_media::segment_reference(&db, sentence)
            .unwrap()
            .unwrap();
        let audio = source_media::resolve(&db, directory.path(), &reference).unwrap();
        assert!(Path::new(&audio.path).is_file());
        assert_eq!(audio.end_ms, 1000);
        assert!(path.is_file());
        assert_eq!(
            materials::import_material(&db, &input).unwrap().file_id,
            existing.file_id
        );
    }
}
