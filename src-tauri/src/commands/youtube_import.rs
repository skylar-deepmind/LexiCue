use super::{
    materials::MaterialInput,
    source_media::{self, AudioTrack, LocalAttachment, YoutubeSource, MAX_DURATION_MS},
    webpage::{registered_import, ImportDownload, WebpageState},
    youtube::is_valid_video_id,
    youtube_attempt::{run_tool, Failure, Trace},
    youtube_import_tools::Tools,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, State};
use tokio::{
    fs,
    process::Command,
    time::{timeout_at, Instant},
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
const IMPORT_LIMIT: Duration = Duration::from_secs(240);
const MAX_CAPTION_BYTES: u64 = 8_000_000;
// yt-dlp can emit a large catalogue of automatic translations even with
// translated_subs skipped. This is a tool-output budget, independent of SRT limits.
const MAX_METADATA_BYTES: usize = 64 * 1024 * 1024;

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

fn staging_path(root: &Path, operation_id: &str) -> Result<PathBuf, String> {
    let id = uuid::Uuid::parse_str(operation_id).map_err(|_| "material_web_invalid")?;
    Ok(root.join(format!(".part-youtube-{id}")))
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

// Fresh attempt directories keep incomplete caption/audio files out of retries
// and are removed on error or when a cancelled future is dropped.
fn work_dir(root: &Path) -> Result<tempfile::TempDir, Failure> {
    tempfile::Builder::new()
        .prefix(".part-youtube-")
        .tempdir_in(root)
        .map_err(|_| Failure::LocalIo)
}

async fn load_metadata(tools: &Tools, path: &Path, id: &str) -> Result<serde_json::Value, Failure> {
    let canonical = format!("https://www.youtube.com/watch?v={id}");
    let mut command = tools.downloader(path);
    command.args([
        "--skip-download",
        "--extractor-args",
        "youtube:skip=translated_subs",
        "--dump-single-json",
        "--",
        &canonical,
    ]);
    let output = run_tool(command, MAX_METADATA_BYTES, |_| {})
        .await
        .map_err(|failure| match failure {
            Failure::TooLarge => Failure::MetadataTooLarge,
            failure => failure,
        })?;
    let mut metadata: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| output.issue.unwrap_or(Failure::InvalidMetadata))?;
    if metadata["id"] != id
        || metadata["duration"]
            .as_f64()
            .is_none_or(|duration| duration <= 0.)
    {
        return Err(output.issue.unwrap_or(Failure::InvalidMetadata));
    }
    let tracks = caption_tracks(&metadata);
    if tracks.iter().all(Option::is_none) {
        return Err(output.issue.unwrap_or(Failure::NoSubtitles));
    }
    for (field, track) in ["subtitles", "automatic_captions"].into_iter().zip(tracks) {
        if let Some(captions) = metadata[field].as_object_mut() {
            captions.retain(|language, _| track.is_some_and(|track| language == track.language));
        }
    }
    Ok(metadata)
}

// YouTube's rolling WebVTT can yield SRT with blank padding inside a cue
// after conversion. Keep its text and time range together for the SRT reader.
fn tidy_automatic_captions(content: String) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<_> = normalized.trim_start_matches('\u{feff}').lines().collect();
    let mut boundaries: Vec<_> = lines
        .windows(2)
        .enumerate()
        .filter_map(|(index, pair)| {
            (pair[0].trim().parse::<u32>().is_ok()
                && super::youtube::parse_ts_line(pair[1]).is_some())
            .then_some(index)
        })
        .collect();
    let Some(&first) = boundaries.first() else {
        return content;
    };
    if lines[..first].iter().any(|line| !line.trim().is_empty()) {
        return content;
    }
    boundaries.push(lines.len());
    let mut repaired = String::new();
    let mut changed = false;
    for cue in boundaries.windows(2) {
        let start = cue[0];
        let mut body = &lines[start + 2..cue[1]];
        while body.last().is_some_and(|line| line.trim().is_empty()) {
            body = &body[..body.len() - 1];
        }
        let text: Vec<_> = body
            .iter()
            .copied()
            .filter(|line| !line.trim().is_empty())
            .collect();
        changed |= text.is_empty() || text.len() != body.len();
        if !text.is_empty() {
            for line in lines[start..start + 2].iter().copied().chain(text) {
                repaired.push_str(line);
                repaired.push('\n');
            }
            repaired.push('\n');
        }
    }
    if changed {
        repaired
    } else {
        content
    }
}

async fn download_caption(
    tools: &Tools,
    metadata_file: &Path,
    directory: &Path,
    track: CaptionTrack,
) -> Result<String, Failure> {
    let attempt = work_dir(directory)?;
    let mut command = tools.downloader(attempt.path());
    command
        .arg("--load-info-json")
        .arg(metadata_file)
        .args([
            "--skip-download",
            "--abort-on-error",
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
        ])
        .arg(&tools.ffmpeg.path)
        .args(["--convert-subs", "srt", "--output", "captions.%(ext)s"]);
    let output = run_tool(command, 0, |_| {}).await?;
    let path = attempt
        .path()
        .join(format!("captions.{}.srt", track.language));
    let file = fs::metadata(&path)
        .await
        .map_err(|_| output.issue.unwrap_or(Failure::InvalidSubtitles))?;
    if file.len() > MAX_CAPTION_BYTES {
        return Err(Failure::TooLarge);
    }
    let content = fs::read_to_string(path)
        .await
        .map_err(|_| Failure::InvalidSubtitles)?;
    Ok(if track.kind == "original" {
        tidy_automatic_captions(content)
    } else {
        content
    })
}

async fn download_audio(
    tools: &Tools,
    metadata_file: &Path,
    track: &AudioTrack,
    directory: &Path,
    progress: &impl Fn(ImportDownload),
) -> Result<tempfile::TempDir, Failure> {
    let attempt = work_dir(directory)?;
    let mut command = tools.downloader(attempt.path());
    command
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
        ])
        .arg(&tools.ffmpeg.path)
        .args([
            "--output",
            "original.%(ext)s",
            "--quiet",
            "--newline",
            "--progress",
            "--progress-delta",
            "0.15",
            "--progress-template",
            "download:lexicue-audio:%(progress.downloaded_bytes)s:%(progress.total_bytes)s",
        ]);
    let output = run_tool(command, 0, |line| {
        if let Some(value) = audio_progress(line) {
            progress(value);
        }
    })
    .await?;
    if !fs::metadata(attempt.path().join("original.m4a"))
        .await
        .is_ok_and(|file| file.is_file() && (1..=source_media::MAX_BYTES).contains(&file.len()))
    {
        return Err(output.issue.unwrap_or(Failure::AudioInvalid));
    }
    Ok(attempt)
}

async fn probe_audio(probe: &Path, audio: &Path, expected_ms: i64) -> Result<i64, Failure> {
    let mut command = Command::new(probe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type:format=duration,start_time",
            "-of",
            "json",
        ])
        .arg(audio);
    let output = run_tool(command, 8192, |_| {}).await?;
    let parsed: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|_| Failure::AudioInvalid)?;
    if !parsed["streams"].as_array().is_some_and(|streams| {
        streams.len() == 1
            && streams[0]["codec_name"] == "aac"
            && streams[0]["codec_type"] == "audio"
    }) {
        return Err(Failure::AudioInvalid);
    }
    let parse_seconds = |field| {
        parsed["format"][field]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .ok_or(Failure::AudioInvalid)
    };
    let start = parse_seconds("start_time")?;
    let duration = parse_seconds("duration")?;
    let duration_ms = (duration * 1000.).round() as i64;
    if !(start.abs() <= 0.25
        && duration.is_finite()
        && duration_ms > 0
        && duration_ms.abs_diff(expected_ms) <= 5_000)
    {
        return Err(Failure::AudioInvalid);
    }
    Ok(duration_ms)
}

async fn stage_audio(
    directory: &Path,
    stage: &Path,
    source: &YoutubeSource,
    duration_ms: i64,
) -> Result<(), Failure> {
    let metadata = serde_json::to_vec(&StagedAudio {
        key: source.key.clone(),
        duration_ms,
    })
    .map_err(|_| Failure::LocalIo)?;
    fs::write(directory.join("audio.json"), metadata)
        .await
        .map_err(|_| Failure::LocalIo)?;
    // Publishing is synchronous so cancellation cannot drop a future whose
    // background rename still publishes the files after the import returns.
    if stage.is_dir() {
        std::fs::remove_dir_all(stage).map_err(|_| Failure::LocalIo)?;
    }
    std::fs::rename(directory, stage).map_err(|_| Failure::LocalIo)
}

async fn fetch(
    id: &str,
    stage: &Path,
    trace: &Trace,
    tools: &Tools,
    progress: impl Fn(ImportDownload),
    cover: impl std::future::Future<Output = Result<String, Failure>>,
) -> Result<CaptionImport, Failure> {
    let root = stage.parent().ok_or(Failure::LocalIo)?;
    fs::create_dir_all(root)
        .await
        .map_err(|_| Failure::LocalIo)?;
    let directory = work_dir(root)?;
    let mut metadata = trace
        .step("metadata", Duration::from_secs(45), true, || {
            load_metadata(tools, directory.path(), id)
        })
        .await?;
    let tracks = caption_tracks(&metadata);
    // The manifest contains signed URLs. It stays in the private work
    // directory. Removing webpage_url prevents yt-dlp re-extracting on failure.
    metadata
        .as_object_mut()
        .ok_or(Failure::InvalidMetadata)?
        .remove("webpage_url");
    let metadata_file = directory.path().join("video.info.json");
    let manifest = serde_json::to_vec(&metadata).map_err(|_| Failure::InvalidMetadata)?;
    fs::write(&metadata_file, manifest)
        .await
        .map_err(|_| Failure::LocalIo)?;
    let title: String = metadata["title"]
        .as_str()
        .unwrap_or(id)
        .trim()
        .chars()
        .take(240)
        .collect();
    let duration_ms = (metadata["duration"]
        .as_f64()
        .ok_or(Failure::InvalidMetadata)?
        * 1000.)
        .round() as i64;
    let mut selected = Err(Failure::NoSubtitles);
    for track in tracks.into_iter().flatten() {
        selected = trace
            .step(
                if track.kind == "manual" {
                    "captions_manual"
                } else {
                    "captions_original"
                },
                Duration::from_secs(30),
                true,
                || async {
                    let content =
                        download_caption(tools, &metadata_file, directory.path(), track).await?;
                    let source = YoutubeSource::from_imported_captions(
                        id,
                        title.clone(),
                        duration_ms,
                        track.language,
                        &content,
                        track.kind,
                        None,
                    )
                    .map_err(|_| Failure::InvalidSubtitles)?;
                    Ok((track, content, source))
                },
            )
            .await;
        if matches!(
            selected,
            Ok(_)
                | Err(Failure::RateLimited
                    | Failure::TooLarge
                    | Failure::ToolMissing
                    | Failure::ToolIncompatible)
        ) {
            break;
        }
    }
    let (caption, content, mut source) = selected?;
    progress(ImportDownload::Captions);

    // The cover uses its own YouTube image endpoint. Request optional pieces
    // in order so observing a 429 precludes any later network step.
    let cover = cover.await;
    if cover.is_ok() {
        progress(ImportDownload::Cover);
    }
    let started = Instant::now();
    let track = (1..=MAX_DURATION_MS)
        .contains(&duration_ms)
        .then(|| source_media::english_audio(&metadata))
        .flatten();
    match (track, &tools.ffprobe, &cover) {
        (_, _, Err(Failure::RateLimited)) => {
            trace.record("audio", 0, started, Some(Failure::RateLimited))
        }
        (None, _, _) => trace.record("audio", 1, started, Some(Failure::NoAudioTrack)),
        (_, Err(reason), _) => trace.record("audio_probe", 1, started, Some(*reason)),
        (Some(track), Ok(probe), _) => {
            let audio = trace
                .step("audio", Duration::from_secs(75), true, || {
                    download_audio(tools, &metadata_file, &track, directory.path(), &progress)
                })
                .await;
            if let Ok(audio) = audio {
                let actual = trace
                    .step("audio_probe", Duration::from_secs(8), false, || async {
                        probe_audio(&probe.path, &audio.path().join("original.m4a"), duration_ms)
                            .await
                    })
                    .await;
                if let Ok(actual) = actual {
                    let result = trace
                        .step("audio_stage", Duration::from_secs(3), false, || async {
                            let with_audio = YoutubeSource::from_imported_captions(
                                id,
                                title.clone(),
                                duration_ms,
                                caption.language,
                                &content,
                                caption.kind,
                                Some(track.clone()),
                            )
                            .map_err(|_| Failure::AudioInvalid)?;
                            stage_audio(audio.path(), stage, &with_audio, actual).await?;
                            Ok(with_audio)
                        })
                        .await;
                    if let Ok(with_audio) = result {
                        source = with_audio;
                    }
                }
            }
        }
    }
    Ok(CaptionImport {
        content,
        audio_unavailable: source.audio.is_none(),
        source,
        cover: cover.ok(),
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
    let started = Instant::now();
    // Leave time to return text at the hard deadline if optional media stalls.
    let deadline = started + IMPORT_LIMIT - Duration::from_secs(2);
    let trace = Trace::new(deadline);
    let result = registered_import(&state, job, &url, IMPORT_LIMIT, async {
        let tools = Tools::find(&trace).await.map_err(Failure::code)?;
        let cover = async {
            timeout_at(
                deadline,
                super::youtube_cover::import_cover(&app, &id, &trace),
            )
            .await
            .unwrap_or(Err(Failure::Timeout))
        };
        fetch(
            &id,
            &stage,
            &trace,
            &tools,
            |value| {
                let _ = on_progress.send(value);
            },
            cover,
        )
        .await
        .map_err(|failure| failure.code().into())
    })
    .await;
    let result = result.map_err(|reason| {
        if reason == "material_web_timeout" {
            Failure::Timeout.code().into()
        } else {
            reason
        }
    });
    trace.finish(started, result.as_ref().err().map(String::as_str));
    result
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
#[path = "youtube_import/tests.rs"]
mod recovery_tests;

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
