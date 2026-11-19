use serde_json::{json, Value};
#[cfg(target_os = "ios")]
use std::sync::LazyLock;

#[cfg(target_os = "ios")]
static VISITOR: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#""VISITOR_DATA"\s*:\s*"([A-Za-z0-9_=%-]{16,1024})""#).unwrap()
});

#[cfg(any(target_os = "ios", test))]
pub const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

pub fn media_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| host.ends_with(".googlevideo.com"))
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/videoplayback"
}

#[cfg(any(target_os = "ios", test))]
fn range_end(header: Option<&str>, offset: u64, size: u64) -> Option<u64> {
    let (span, total) = header?.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let end = end.parse::<u64>().ok()?;
    (start.parse::<u64>().ok()? == offset
        && total.parse::<u64>().ok()? == size
        && (offset..size).contains(&end))
    .then(|| end + 1)
}

#[cfg(any(target_os = "ios", test))]
pub(in crate::commands) async fn transfer_once(
    client: &reqwest::Client,
    url: &reqwest::Url,
    expected: u64,
    file: &mut tokio::fs::File,
    written: &mut u64,
) -> Result<(), &'static str> {
    use reqwest::{header, StatusCode};
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};
    let mut request = client
        .get(url.clone())
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::ACCEPT_ENCODING, "identity");
    if *written > 0 {
        request = request.header(header::RANGE, format!("bytes={written}-"));
    }
    let mut response = request.send().await.map_err(|_| "media_network")?;
    let end = match response.status() {
        StatusCode::OK => {
            if *written != 0 {
                // A server can ignore Range and return the complete object.
                file.set_len(0).await.map_err(|_| "media_io")?;
                file.rewind().await.map_err(|_| "media_io")?;
                *written = 0;
            }
            expected
        }
        StatusCode::PARTIAL_CONTENT if *written > 0 => {
            let range = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok());
            range_end(range, *written, expected).ok_or("media_download_failed")?
        }
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::GONE => {
            return Err("media_url_expired")
        }
        StatusCode::REQUEST_TIMEOUT
        | StatusCode::INTERNAL_SERVER_ERROR
        | StatusCode::BAD_GATEWAY
        | StatusCode::SERVICE_UNAVAILABLE
        | StatusCode::GATEWAY_TIMEOUT => return Err("media_network"),
        StatusCode::TOO_MANY_REQUESTS => return Err("media_rate_limited"),
        _ => return Err("media_download_failed"),
    };
    if response
        .content_length()
        .is_some_and(|size| size != end - *written)
    {
        return Err("media_download_failed");
    }
    while let Some(chunk) = response.chunk().await.map_err(|_| "media_network")? {
        if *written + chunk.len() as u64 > end {
            return Err("media_download_failed");
        }
        file.write_all(&chunk).await.map_err(|_| "media_io")?;
        *written += chunk.len() as u64;
    }
    if *written != expected {
        return Err("media_network");
    }
    Ok(())
}

fn original_audio(video_id: &str, duration: u64, player: &Value) -> Option<Value> {
    if player["playabilityStatus"]["status"] != "OK"
        || player["videoDetails"]["videoId"] != video_id
        || player["videoDetails"]["isLiveContent"] == true
        || player["videoDetails"]["lengthSeconds"]
            .as_str()?
            .parse::<u64>()
            .ok()?
            != duration
    {
        return None;
    }
    player["streamingData"]["adaptiveFormats"]
        .as_array()?
        .iter()
        .find_map(|format| {
            let audio = &format["audioTrack"];
            let track = audio["id"].as_str()?;
            let (language, _) = track.split_once('.')?;
            if format["itag"] != 140
                || format["mimeType"] != "audio/mp4; codecs=\"mp4a.40.2\""
                || audio["audioIsDefault"] != true
                || audio["isAutoDubbed"] == true
                || !(language == "en" || language.starts_with("en-"))
                || !track
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
            {
                return None;
            }
            let url = reqwest::Url::parse(format["url"].as_str()?).ok()?;
            if !media_url(&url) {
                return None;
            }
            let bytes = format["contentLength"].as_str()?.parse::<u64>().ok()?;
            if !(1..=crate::commands::source_media::MAX_BYTES).contains(&bytes) {
                return None;
            }
            Some(json!({
                "format_id": format!("ios-140-{}", track.replace('.', "-")),
                "format_note": "original",
                "language": language, "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2",
                "url": url.as_str(), "filesize": bytes
            }))
        })
}

#[cfg(target_os = "ios")]
async fn watch_visitor(client: &reqwest::Client, video_id: &str) -> Option<String> {
    let mut response = client
        .get(format!("https://www.youtube.com/watch?v={video_id}"))
        .header("User-Agent", USER_AGENT)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(VISITOR.captures(std::str::from_utf8(&body).ok()?)?[1].to_owned())
}

#[cfg(target_os = "ios")]
async fn query(
    client: &reqwest::Client,
    video_id: &str,
    duration: u64,
    visitor: Option<&str>,
) -> Result<Value, &'static str> {
    let visitor = match visitor {
        Some(value)
            if (16..=1024).contains(&value.len())
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_=%-".contains(&b)) =>
        {
            value.to_owned()
        }
        _ => watch_visitor(client, video_id)
            .await
            .ok_or("visitor_missing")?,
    };
    let player: Value = client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("User-Agent", USER_AGENT)
        .header("Origin", "https://www.youtube.com")
        .header("X-YouTube-Client-Name", "101")
        .header("X-YouTube-Client-Version", "1.02")
        .header("X-Goog-Visitor-Id", &visitor)
        .json(&json!({
            "videoId": video_id,
            "context": { "client": {
                "clientName": "VISIONOS", "clientVersion": "1.02",
                "deviceMake": "Apple", "deviceModel": "RealityDevice17,1",
                "osName": "visionOS", "osVersion": "26.5.23O471",
                "hl": "en", "gl": "US", "userAgent": USER_AGENT, "visitorData": visitor
            }},
            "playbackContext": {"contentPlaybackContext": {"html5Preference": "HTML5_PREF_WANTS"}},
            "contentCheckOk": true, "racyCheckOk": true
        }))
        .send()
        .await
        .map_err(|_| "player_network")?
        .error_for_status()
        .map_err(|_| "player_http")?
        .json()
        .await
        .map_err(|_| "player_response")?;
    if player["playabilityStatus"]["status"] != "OK" {
        return Err("player_not_playable");
    }
    original_audio(video_id, duration, &player).ok_or("no_matching_original_track")
}

#[cfg(target_os = "ios")]
pub async fn with_original_track(
    client: &reqwest::Client,
    video_id: &str,
    visitor: Option<&str>,
    mut metadata: Value,
) -> Value {
    metadata["id"] = json!(video_id);
    if let Some(duration) = metadata["duration"].as_u64() {
        match tokio::time::timeout(
            std::time::Duration::from_secs(12),
            query(client, video_id, duration, visitor),
        )
        .await
        {
            Ok(Ok(track)) => metadata["formats"] = json!([track]),
            Ok(Err(reason)) => log::info!("iPhone YouTube audio unavailable: {reason}"),
            Err(_) => log::info!("iPhone YouTube audio unavailable: player_timeout"),
        }
    }
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_partial_response_must_match_the_requested_offset_and_asset_size() {
        assert_eq!(range_end(Some("bytes 512-999/1000"), 512, 1000), Some(1000));
        for header in [
            None,
            Some("bytes 0-999/1000"),
            Some("bytes 512-999/2000"),
            Some("bytes 512-1000/1000"),
        ] {
            assert_eq!(range_end(header, 512, 1000), None);
        }
    }

    #[tokio::test]
    async fn resumes_an_interrupted_http_response_at_the_last_written_byte() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url =
            reqwest::Url::parse(&format!("http://{}", listener.local_addr().unwrap())).unwrap();
        let server = std::thread::spawn(move || {
            for attempt in 0..2 {
                let (mut connection, _) = listener.accept().unwrap();
                connection
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(&connection);
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line.to_ascii_lowercase());
                }
                if attempt == 0 {
                    assert!(!headers.contains("range:"));
                    connection.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\naaaa").unwrap();
                } else {
                    assert!(headers.contains("range: bytes=4-"));
                    connection.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 4-7/8\r\nConnection: close\r\n\r\nbbbb").unwrap();
                }
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("partial");
        let mut file = tokio::fs::File::create(&path).await.unwrap();
        let mut written = 0;
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            transfer_once(&client, &url, 8, &mut file, &mut written).await,
            Err("media_network")
        );
        assert_eq!(written, 4);
        assert_eq!(
            transfer_once(&client, &url, 8, &mut file, &mut written).await,
            Ok(())
        );
        file.sync_all().await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"aaaabbbb");
        server.join().unwrap();
    }

    #[test]
    fn only_offered_english_original_aac_is_retained() {
        let offered = json!({
            "itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
            "contentLength": "10000", "url": "https://r2.googlevideo.com/videoplayback?signed",
            "audioTrack": {"id":"en-US.4","audioIsDefault":true}
        });
        let mut player = json!({
            "playabilityStatus":{"status":"OK"},
            "videoDetails":{"videoId":"abcdefghijk","lengthSeconds":"193","isLiveContent":false},
            "streamingData":{"adaptiveFormats":[offered]}
        });
        assert_eq!(
            original_audio("abcdefghijk", 193, &player).unwrap()["format_id"],
            "ios-140-en-US-4"
        );
        player["streamingData"]["adaptiveFormats"][0]["audioTrack"]["isAutoDubbed"] = json!(true);
        assert!(original_audio("abcdefghijk", 193, &player).is_none());
        assert!(!media_url(
            &reqwest::Url::parse("https://r2.googlevideo.com.example/videoplayback").unwrap()
        ));
    }
}
