//! Tokio Async Runtime

use crate::error::Result;
use crate::tts::{client::MSEdgeTTSClientAsync, websocket_connect_tokio_async};

/// Create Async TTS [Client](MSEdgeTTSClientAsync)
pub async fn connect_async() -> Result<MSEdgeTTSClientAsync<async_tungstenite::tokio::ConnectStream>>
{
    // Match reqwest's environment proxy convention without a service relay.
    // TLS to the fixed Microsoft endpoint is still verified after CONNECT.
    let proxy = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
        .iter().find_map(|key| std::env::var(key).ok().filter(|v| !v.is_empty()));
    let no_proxy = std::env::var("NO_PROXY").or_else(|_| std::env::var("no_proxy")).unwrap_or_default();
    let bypass = no_proxy.split(',').any(|rule| {
        let rule = rule.trim().trim_start_matches('.');
        rule == "*" || rule == "speech.platform.bing.com" || (!rule.is_empty() && "speech.platform.bing.com".ends_with(&format!(".{rule}")))
    });
    if let Some(proxy) = proxy.filter(|_| !bypass) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use base64::Engine;
        let proxy = reqwest::Url::parse(&proxy).map_err(|_| crate::error::Error::UnexpectedMessage("invalid proxy configuration".into()))?;
        if proxy.scheme() != "http" { return Err(crate::error::Error::UnexpectedMessage("unsupported proxy scheme".into())); }
        let host = proxy.host_str().ok_or_else(|| crate::error::Error::UnexpectedMessage("invalid proxy host".into()))?;
        let mut stream = tokio::net::TcpStream::connect((host, proxy.port_or_known_default().unwrap_or(80))).await.map_err(tungstenite::Error::Io)?;
        let auth = if !proxy.username().is_empty() {
            format!("Proxy-Authorization: Basic {}\r\n", base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", proxy.username(), proxy.password().unwrap_or(""))))
        } else { String::new() };
        let connect = format!("CONNECT speech.platform.bing.com:443 HTTP/1.1\r\nHost: speech.platform.bing.com:443\r\n{auth}\r\n");
        stream.write_all(connect.as_bytes()).await.map_err(tungstenite::Error::Io)?;
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            if head.len() >= 16_384 { return Err(crate::error::Error::UnexpectedMessage("proxy response too large".into())); }
            let mut byte=[0];stream.read_exact(&mut byte).await.map_err(tungstenite::Error::Io)?;head.push(byte[0]);
        }
        let head = std::str::from_utf8(&head).map_err(|_| crate::error::Error::UnexpectedMessage("invalid proxy response".into()))?;
        let status = head.lines().next().unwrap_or("").split_whitespace().nth(1);
        if status != Some("200") { return Err(crate::error::Error::UnexpectedMessage("proxy connection rejected".into())); }
        let (websocket, _) = async_tungstenite::tokio::client_async_tls(crate::tts::build_websocket_request()?, stream).await?;
        return Ok(MSEdgeTTSClientAsync(websocket));
    }
    Ok(MSEdgeTTSClientAsync(websocket_connect_tokio_async().await?))
}

#[cfg(feature = "proxy")]
#[cfg_attr(docsrs, doc(cfg(all(feature = "tokio-runtime", feature = "proxy"))))]
pub use crate::tts::proxy::tokio_runtime::connect_proxy_async;
