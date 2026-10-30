//! One explicitly submitted public page. No cookies, proxies, scripts or subresources.
use base64::Engine;
use reqwest::{redirect::Policy, Url};
use serde::Serialize;
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;
use tokio::sync::watch;
const MAX_BYTES: usize = 8_000_000;
#[derive(Default)]
pub struct WebpageState(Mutex<HashMap<String, (Instant, watch::Sender<bool>)>>);
#[derive(Serialize)]
pub struct WebpageResponse {
    pub bytes_base64: String,
    pub submitted_url: String,
    pub final_url: String,
    pub content_type: String,
    pub fetched_at: i64,
}
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || a == 169 && b == 254
                || a == 172 && (16..=31).contains(&b)
                || a == 192 && (b == 168 || b == 0 || b == 2 || b == 88 && c == 99)
                || a == 100 && (64..=127).contains(&b)
                || a == 198 && (b == 18 || b == 19 || b == 51)
                || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && !(s[0] == 0x3fff && s[1] <= 0xfff)
        }
    }
}
pub fn public_url(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value).map_err(|_| "material_web_invalid")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err("material_web_invalid".into());
    }
    let host = url
        .host_str()
        .ok_or("material_web_invalid")?
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost"
        || [
            ".localhost",
            ".local",
            ".internal",
            ".test",
            ".invalid",
            ".onion",
        ]
        .iter()
        .any(|s| host.ends_with(s))
        || !host.contains('.') && !host.contains(':')
    {
        return Err("material_web_private".into());
    }
    if host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip)) {
        return Err("material_web_private".into());
    }
    url.set_fragment(None);
    Ok(url)
}
fn validate_response(status: u16, content_type: &str, length: Option<u64>) -> Result<(), String> {
    if status != 200 {
        return Err("material_web_http".into());
    }
    if !matches!(
        content_type
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "text/html" | "application/xhtml+xml"
    ) {
        return Err("material_web_download".into());
    }
    if length.is_some_and(|n| n > MAX_BYTES as u64) {
        return Err("material_web_large".into());
    }
    Ok(())
}
fn append_bounded(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if bytes.len() + chunk.len() > MAX_BYTES {
        return Err("material_web_large".into());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}
async fn bounded_fetch<F: std::future::Future<Output = Result<WebpageResponse, String>>>(
    mut cancel: watch::Receiver<bool>,
    timeout: Duration,
    task: F,
) -> Result<WebpageResponse, String> {
    if *cancel.borrow() {
        return Err("material_cancelled".into());
    }
    tokio::select! {_ = cancel.changed()=>Err("material_cancelled".into()), result=tokio::time::timeout(timeout,task)=>result.unwrap_or(Err("material_web_timeout".into()))}
}
async fn fetch(value: String) -> Result<WebpageResponse, String> {
    let submitted = public_url(&value)?.to_string();
    let mut url = public_url(&value)?;
    for hop in 0..=5 {
        let host = url
            .host_str()
            .ok_or("material_web_invalid")?
            .trim_matches(['[', ']']);
        let port = url.port_or_known_default().unwrap();
        let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| "material_web_network")?
            .collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            return Err("material_web_private".into());
        }
        // Pin the validated DNS answers to the actual connection; never resolve again through a proxy.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| "material_web_network")?;
        let mut response = client
            .get(url.clone())
            .header("Accept", "text/html,application/xhtml+xml")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("User-Agent", "Mozilla/5.0 (compatible; LexiCue/0.4)")
            .send()
            .await
            .map_err(|_| "material_web_network")?;
        if response
            .remote_addr()
            .is_none_or(|a| !public_ip(a.ip()) || !addresses.iter().any(|v| v.ip() == a.ip()))
        {
            return Err("material_web_private".into());
        }
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == 5 {
                return Err("material_web_redirect".into());
            }
            let next = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("material_web_redirect")?;
            url = public_url(url.join(next).map_err(|_| "material_web_invalid")?.as_str())?;
            continue;
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        validate_response(
            response.status().as_u16(),
            &content_type,
            response.content_length(),
        )?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "material_web_network")? {
            append_bounded(&mut bytes, &chunk)?;
        }
        return Ok(WebpageResponse {
            bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            submitted_url: submitted,
            final_url: url.to_string(),
            content_type,
            fetched_at: super::saved::now_ms(),
        });
    }
    Err("material_web_redirect".into())
}
#[tauri::command]
pub async fn fetch_import_webpage(
    state: State<'_, WebpageState>,
    job: String,
    url: String,
) -> Result<WebpageResponse, String> {
    if job.len() > 100 || url.len() > 8192 {
        return Err("material_web_invalid".into());
    }
    let cancel = {
        let mut jobs = state.0.lock().map_err(|_| "material_web_network")?;
        jobs.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        if jobs.len() >= 32 {
            return Err("material_web_network".into());
        }
        jobs.entry(job.clone())
            .or_insert_with(|| (Instant::now(), watch::channel(false).0))
            .1
            .subscribe()
    };
    let result = bounded_fetch(cancel, Duration::from_secs(30), fetch(url)).await;
    state
        .0
        .lock()
        .map_err(|_| "material_web_network")?
        .remove(&job);
    result
}
#[tauri::command]
pub fn cancel_import_webpage(state: State<'_, WebpageState>, job: String) -> Result<(), String> {
    if job.len() > 100 {
        return Ok(());
    }
    let mut jobs = state.0.lock().map_err(|_| "material_web_network")?;
    jobs.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
    if jobs.len() < 32 {
        jobs.entry(job)
            .or_insert_with(|| (Instant::now(), watch::channel(true).0))
            .1
            .send_replace(true);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_and_stream_limits_fail_without_truncation() {
        for status in [206, 401, 403, 404, 500] {
            assert!(validate_response(status, "text/html", None).is_err());
        }
        assert_eq!(
            validate_response(200, "application/pdf", None).unwrap_err(),
            "material_web_download"
        );
        assert!(validate_response(200, "text/html", Some(MAX_BYTES as u64 + 1)).is_err());
        let mut body = vec![0; MAX_BYTES - 1];
        append_bounded(&mut body, &[1]).unwrap();
        assert!(append_bounded(&mut body, &[2]).is_err());
        assert_eq!(body.len(), MAX_BYTES);
        assert_eq!(body[MAX_BYTES - 1], 1);
    }
    #[tokio::test]
    async fn cancellation_and_deadline_drop_pending_fetch() {
        let (sender, receiver) = watch::channel(false);
        let timeout = bounded_fetch(
            receiver.clone(),
            Duration::from_millis(5),
            std::future::pending(),
        )
        .await;
        assert_eq!(timeout.err().as_deref(), Some("material_web_timeout"));
        let task = bounded_fetch(receiver, Duration::from_secs(30), std::future::pending());
        tokio::pin!(task);
        sender.send_replace(true);
        assert_eq!(task.await.err().as_deref(), Some("material_cancelled"));
    }
    #[test]
    fn rejects_nonpublic_and_ambiguous_urls() {
        for u in [
            "http://127.0.0.1",
            "http://2130706433",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://192.168.1.1",
            "http://100.64.0.1",
            "http://localhost",
            "http://a.local",
            "https://user:pass@example.com",
            "file:///etc/passwd",
            "https://example.com:123",
        ] {
            assert!(public_url(u).is_err(), "{u}");
        }
        assert!(public_url("https://example.com/article").is_ok());
    }
    #[test]
    fn special_ipv6_ranges_are_not_public() {
        for ip in [
            "2001:db8::1",
            "2002:7f00:1::",
            "2001::1",
            "fc00::1",
            "fe80::1",
            "3fff::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
}

#[cfg(test)]
mod live_probe {
    use super::*;
    #[tokio::test]
    #[ignore = "Explicit public-network QA; writes only controlled test evidence"]
    async fn clipboard_public_network_probe() {
        let dir = std::env::var("LEXICUE_CLIPBOARD_NETWORK_EVIDENCE")
            .expect("explicit evidence directory");
        std::fs::create_dir_all(&dir).unwrap();
        let mut rows = Vec::new();
        for (id, url) in [
            ("article", "https://www.paulgraham.com/essay.html"),
            ("long", "https://en.wikipedia.org/wiki/Bicycle"),
            (
                "redirect-private",
                "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%2F",
            ),
            ("http-error", "https://httpbin.org/status/404"),
            ("non-html", "https://httpbin.org/bytes/10"),
            ("timeout", "https://httpbin.org/delay/40"),
        ] {
            let start = Instant::now();
            let result = tokio::time::timeout(Duration::from_secs(30), fetch(url.into()))
                .await
                .unwrap_or(Err("material_web_timeout".into()));
            let row = match result {
                Ok(response) => {
                    std::fs::write(
                        std::path::Path::new(&dir).join(format!("{id}.json")),
                        serde_json::to_vec(&response).unwrap(),
                    )
                    .unwrap();
                    serde_json::json!({"id":id,"url":url,"ok":true,"final_url":response.final_url,"encoded_bytes":response.bytes_base64.len(),"elapsed_ms":start.elapsed().as_millis()})
                }
                Err(error) => {
                    serde_json::json!({"id":id,"url":url,"error":error,"elapsed_ms":start.elapsed().as_millis()})
                }
            };
            rows.push(row);
            std::fs::write(
                std::path::Path::new(&dir).join("results.json"),
                serde_json::to_vec_pretty(&rows).unwrap(),
            )
            .unwrap();
        }
    }
}
