use super::*;
use std::{
    os::unix::fs::PermissionsExt,
    sync::atomic::{AtomicUsize, Ordering},
};

const VIDEO: &str = "abcdefghijk";

struct Fixture {
    workspace: tempfile::TempDir,
    stage: PathBuf,
    tools: Tools,
}

impl Fixture {
    fn new(scenario: &str) -> Self {
        Self::with_audio_endpoint(scenario, "")
    }

    fn with_audio_endpoint(scenario: &str, endpoint: &str) -> Self {
        let workspace = tempfile::tempdir().unwrap();
        let script = workspace.path().join("downloader");
        let stage = workspace.path().join("stage");
        let template = r#"#!/bin/sh
root="$(dirname "$0")"
record() { printf '%s\n' "$1" >> "$root/requests"; }
case " $* " in
  *' --dump-single-json '*)
    record metadata
    tracks='"subtitles":{"en":[{"ext":"vtt"}]},"automatic_captions":{"en-orig":[{"ext":"vtt"}]}'
    [ SCENARIO = no_subtitles ] && tracks='"subtitles":{}'
    if [ SCENARIO = timeout ] && [ "$(grep -c '^metadata$' "$root/requests")" -eq 1 ]; then
      echo 'ERROR: Read operation timed out' >&2
      exit 1
    fi
    printf '{"id":"abcdefghijk","duration":2,"extractor":"generic","extractor_key":"Generic","language":"en","title":"Harbor","webpage_url":"https://example.org/private","formats":[{"ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","language":"en","format_id":"140","url":"AUDIO_ENDPOINT","abr":90}],%s}\n' "$tracks"
    ;;
  *' --write-subs '*|*' --write-auto-subs '*)
    case " $* " in
      *' --write-subs '*) track=en ;;
      *) track=en-orig ;;
    esac
    record "caption-$track"
    if [ SCENARIO = rate_limit ]; then
      # Even a warning printed before exit must stop the whole request.
      echo 'WARNING: https://example.org?Signature=private HTTP Error 429: Too Many Requests' >&2
      sleep 5
      exit 1
    fi
    if [ SCENARIO = fallback ] && [ "$track" = en ]; then
      printf 'invalid SRT\n' > "captions.$track.srt"
      exit 0
    fi
    if [ "$track" = en-orig ]; then
      printf '1\n00:00:00,000 --> 00:00:01,500\n\nWe saw the harbor.\n\n2\n00:00:01,500 --> 00:00:02,000\n\n' > "captions.$track.srt"
    else
      printf '1\n00:00:00,000 --> 00:00:01,500\nWe saw the harbor.\n' > "captions.$track.srt"
    fi
    ;;
  *' --extract-audio '*)
    record audio
    if [ SCENARIO = real_http ]; then
      exec /opt/homebrew/bin/yt-dlp "$@"
    fi
    if [ SCENARIO = cancel ]; then
      touch original.m4a.part
      printf 'lexicue-audio:200:400\n'
      sleep 10
      exit 1
    fi
    printf 'lexicue-audio:200:400\n'
    count="$(grep -c '^audio$' "$root/requests")"
    if [ SCENARIO = audio_fails ] || { [ SCENARIO = audio_recovers ] && [ "$count" -eq 1 ]; }; then
      touch original.m4a.part
      echo 'ERROR: unable to download video data: HTTP Error 503: Service Unavailable' >&2
      exit 1
    fi
    test ! -e original.m4a.part || exit 1
    cp "$root/fixture.m4a" original.m4a
    ;;
  *' -show_entries '*)
    record probe
    duration=2
    [ SCENARIO = audio_invalid ] && duration=20
    printf '{"streams":[{"codec_name":"aac","codec_type":"audio"}],"format":{"start_time":"0.0","duration":"%s"}}\n' "$duration"
    ;;
  *) exit 1 ;;
esac
"#;
        std::fs::write(
            &script,
            template
                .replace("SCENARIO", scenario)
                .replace("AUDIO_ENDPOINT", endpoint),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(
            workspace.path().join("fixture.m4a"),
            include_bytes!("../test_data/local-import-aac.mp4"),
        )
        .unwrap();
        Self {
            workspace,
            stage,
            tools: Tools::fixture(script.clone(), Ok(script)),
        }
    }

    fn requests(&self) -> Vec<String> {
        std::fs::read_to_string(self.workspace.path().join("requests"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn no_temporary_files(&self) {
        assert!(!self.workspace.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".part-youtube-")
        }));
    }

    async fn fetch(
        &self,
        limit: Duration,
        progress: impl Fn(ImportDownload),
        cover: impl std::future::Future<Output = Result<String, Failure>>,
    ) -> Result<CaptionImport, Failure> {
        let trace = Trace::new(Instant::now() + limit);
        fetch(VIDEO, &self.stage, &trace, &self.tools, progress, cover).await
    }
}

#[tokio::test]
async fn retries_audio_503_without_redownloading_captions_or_cover() {
    let fixture = Fixture::new("audio_recovers");
    let covers = AtomicUsize::new(0);
    let updates = AtomicUsize::new(0);
    let phases = std::sync::Mutex::new(Vec::new());
    let result = fixture
        .fetch(
            Duration::from_secs(10),
            |progress| {
                match progress {
                    ImportDownload::CaptionSearch => phases.lock().unwrap().push("captions"),
                    ImportDownload::Captions => phases.lock().unwrap().push("media"),
                    ImportDownload::AudioStarted => phases.lock().unwrap().push("audio"),
                    _ => (),
                }
                if matches!(
                    progress,
                    ImportDownload::Audio {
                        received: 200,
                        total: Some(400)
                    }
                ) {
                    updates.fetch_add(1, Ordering::Relaxed);
                }
            },
            async {
                covers.fetch_add(1, Ordering::Relaxed);
                Ok("cover".to_owned())
            },
        )
        .await
        .unwrap();
    assert_eq!(
        fixture.requests(),
        ["metadata", "caption-en", "audio", "audio", "probe"]
    );
    assert_eq!(covers.load(Ordering::Relaxed), 1);
    assert_eq!(phases.into_inner().unwrap(), ["captions", "media", "audio"]);
    assert_eq!(updates.load(Ordering::Relaxed), 2);
    assert!(result.source.audio.is_some());
    assert_eq!(result.source.subtitle_kind, "manual");
    assert_eq!(result.cover.as_deref(), Some("cover"));
    assert!(!result.audio_unavailable);
    assert!(fixture.stage.join("audio.json").is_file());
    assert!(fixture.stage.join("original.m4a").is_file());
    assert_eq!(fixture.stage.read_dir().unwrap().count(), 2);
    fixture.no_temporary_files();
}

#[tokio::test]
async fn retries_timeout_and_uses_original_english_if_manual_is_invalid() {
    for (scenario, expected, kind) in [
        (
            "timeout",
            vec!["metadata", "metadata", "caption-en", "audio", "probe"],
            "manual",
        ),
        (
            "fallback",
            vec![
                "metadata",
                "caption-en",
                "caption-en-orig",
                "audio",
                "probe",
            ],
            "original",
        ),
    ] {
        let fixture = Fixture::new(scenario);
        let result = fixture
            .fetch(Duration::from_secs(10), |_| {}, async {
                Err(Failure::CoverMissing)
            })
            .await
            .unwrap();
        assert_eq!(fixture.requests(), expected);
        assert_eq!(result.source.subtitle_kind, kind);
        assert_eq!(result.source.cues.len(), 1);
        assert_eq!(result.source.cues[0].text, "We saw the harbor.");
        assert!(!result.content.contains("00:01,500\n\nWe"));
        assert!(result.source.audio.is_some());
        assert!(result.cover.is_none());
        fixture.no_temporary_files();
    }
}

#[tokio::test]
async fn absent_subtitles_and_a_429_do_not_request_optional_media() {
    for (scenario, expected, reason) in [
        ("no_subtitles", vec!["metadata"], Failure::NoSubtitles),
        (
            "rate_limit",
            vec!["metadata", "caption-en"],
            Failure::RateLimited,
        ),
    ] {
        let fixture = Fixture::new(scenario);
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            fixture.fetch(Duration::from_secs(10), |_| {}, async {
                panic!("cover must not be requested");
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.err(), Some(reason));
        assert_eq!(fixture.requests(), expected);
        assert!(!fixture.stage.exists());
        fixture.no_temporary_files();
    }
}

#[tokio::test]
async fn captions_survive_audio_failure_bad_timeline_and_optional_stage_rate_limit() {
    for (scenario, expected, cover) in [
        (
            "audio_fails",
            vec!["metadata", "caption-en", "audio", "audio", "audio"],
            Ok("cover".to_owned()),
        ),
        (
            "audio_invalid",
            vec!["metadata", "caption-en", "audio", "probe"],
            Ok("cover".to_owned()),
        ),
        (
            "audio_recovers",
            vec!["metadata", "caption-en"],
            Err(Failure::RateLimited),
        ),
    ] {
        let fixture = Fixture::new(scenario);
        let result = fixture
            .fetch(Duration::from_secs(10), |_| {}, async { cover })
            .await
            .unwrap();
        assert_eq!(fixture.requests(), expected);
        assert_eq!(result.source.cues.len(), 1);
        assert!(result.source.audio.is_none());
        assert!(result.audio_unavailable);
        assert!(!fixture.stage.exists());
        fixture.no_temporary_files();
    }
}

#[tokio::test]
async fn cancelling_active_audio_removes_partial_files_and_stops_attempts() {
    let fixture = Fixture::new("cancel");
    let state = WebpageState::default();
    let job = "controlled-cancel".to_owned();
    let started = tokio::sync::Notify::new();
    let cancel = async {
        started.notified().await;
        state.request_cancel(job.clone()).unwrap();
    };
    let import = registered_import(
        &state,
        job.clone(),
        "https://youtu.be/abcdefghijk",
        Duration::from_secs(6),
        async {
            fixture
                .fetch(
                    Duration::from_secs(30),
                    |progress| {
                        if matches!(progress, ImportDownload::Audio { .. }) {
                            started.notify_one();
                        }
                    },
                    async { Ok("cover".to_owned()) },
                )
                .await
                .map_err(|failure| failure.code().into())
        },
    );
    let result = tokio::select! {
        (result, ()) = async { tokio::join!(import, cancel) } => result,
        () = tokio::time::sleep(Duration::from_secs(7)) => panic!("audio was never started"),
    };
    assert_eq!(result.err().as_deref(), Some("material_cancelled"));
    assert_eq!(fixture.requests(), ["metadata", "caption-en", "audio"]);
    assert!(!fixture.stage.exists());
    fixture.no_temporary_files();
}

#[tokio::test]
async fn a_stalled_optional_download_uses_the_remaining_budget_and_returns_captions() {
    let fixture = Fixture::new("cancel");
    let result = fixture
        .fetch(Duration::from_secs(4), |_| {}, async { Ok("cover".into()) })
        .await
        .unwrap();
    assert!(result.audio_unavailable);
    assert_eq!(result.source.cues.len(), 1);
    assert_eq!(fixture.requests(), ["metadata", "caption-en", "audio"]);
    assert!(!fixture.stage.exists());
    fixture.no_temporary_files();
}

#[tokio::test]
#[ignore = "requires the installed yt-dlp, Deno and FFmpeg"]
async fn real_downloader_recovers_after_one_http_503_with_exact_audio_bytes() {
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
    };

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/audio.m4a", listener.local_addr().unwrap());
    let mut fixture = Fixture::with_audio_endpoint("real_http", &endpoint);
    let audio = fixture.workspace.path().join("wire.m4a");
    let ffmpeg = "/opt/homebrew/bin/ffmpeg";
    assert!(std::process::Command::new(ffmpeg)
        .args(["-loglevel", "error", "-i"])
        .arg(fixture.workspace.path().join("fixture.m4a"))
        .args(["-vn", "-c:a", "copy"])
        .arg(&audio)
        .status()
        .unwrap()
        .success());
    let expected = std::fs::read(audio).unwrap();
    let wire_audio = expected.clone();
    let wire = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(12);
        let mut paths = Vec::new();
        while std::time::Instant::now() < deadline && paths.len() < 2 {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = String::new();
            BufReader::new(&stream).read_line(&mut request).unwrap();
            paths.push(request.split_whitespace().nth(1).unwrap().to_owned());
            if paths.len() == 1 {
                stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            } else {
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", wire_audio.len()).unwrap();
                stream.write_all(&wire_audio).unwrap();
            }
        }
        paths
    });
    fixture.tools.ffmpeg.path = ffmpeg.into();
    fixture.tools.ffprobe.as_mut().unwrap().path = "/opt/homebrew/bin/ffprobe".into();
    let result = fixture
        .fetch(Duration::from_secs(15), |_| {}, async {
            Ok("cover".into())
        })
        .await
        .unwrap();
    assert_eq!(wire.join().unwrap(), ["/audio.m4a", "/audio.m4a"]);
    assert_eq!(
        fixture.requests(),
        ["metadata", "caption-en", "audio", "audio"]
    );
    assert!(!result.audio_unavailable);
    assert_eq!(
        std::fs::read(fixture.stage.join("original.m4a")).unwrap(),
        expected
    );
    fixture.no_temporary_files();
}

#[test]
fn well_formed_automatic_captions_keep_their_existing_identity() {
    let content =
        "\u{feff}1\r\n00:00:00,200 --> 00:00:02,000\r\nOne line.\r\nAnother line.\r\n\r\n"
            .to_owned();
    assert_eq!(tidy_automatic_captions(content.clone()), content);
}
