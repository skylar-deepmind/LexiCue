use serde_json::{json, Value};
#[cfg(target_os = "ios")]
use std::sync::LazyLock;

#[cfg(target_os = "ios")]
static VISITOR: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#""VISITOR_DATA"\s*:\s*"([A-Za-z0-9_=%-]{16,1024})""#).unwrap()
});

#[cfg(target_os = "ios")]
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
async fn query(client: &reqwest::Client, video_id: &str, duration: u64) -> Option<Value> {
    let visitor = watch_visitor(client, video_id).await?;
    let player = client
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
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    original_audio(video_id, duration, &player)
}

#[cfg(target_os = "ios")]
pub async fn with_original_track(
    client: &reqwest::Client,
    video_id: &str,
    mut metadata: Value,
) -> Value {
    metadata["id"] = json!(video_id);
    if let Some(duration) = metadata["duration"].as_u64() {
        let track = tokio::time::timeout(
            std::time::Duration::from_secs(8),
            query(client, video_id, duration),
        )
        .await
        .ok()
        .flatten();
        if let Some(track) = track {
            metadata["formats"] = json!([track]);
        }
    }
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;

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
