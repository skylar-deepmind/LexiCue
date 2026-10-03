use super::super::{
    chat_endpoint, request_id, send_retry, AiConfig, CancellationToken, ChatFailure, ChatResult,
    RetryNotifier, CANCELLED_MESSAGE, SYSTEM_PROMPT,
};
use super::diagnostics;
use reqwest::Client;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) struct Session {
    stream: AtomicBool,
    usage: AtomicBool,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            stream: AtomicBool::new(true),
            usage: AtomicBool::new(true),
        }
    }
}

fn failure(message: impl Into<String>, kind: &'static str, id: Option<String>) -> ChatFailure {
    ChatFailure {
        message: message.into(),
        kind,
        http_status: None,
        request_id: id,
    }
}
fn unsupported(body: &str, names: &[&str]) -> bool {
    let text = body.to_lowercase();
    if let Ok(value) = serde_json::from_str::<Value>(&text) {
        let parameter = value.pointer("/error/param").and_then(Value::as_str);
        if parameter.is_some_and(|param| names.contains(&param))
            && [
                "unsupported",
                "unknown",
                "unrecognized",
                "not supported",
                "not allowed",
            ]
            .iter()
            .any(|word| text.contains(word))
        {
            return true;
        }
    }
    text.split([',', ';', '\n']).any(|clause| {
        let words: Vec<_> = clause
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .filter(|s| !s.is_empty())
            .collect();
        words.iter().enumerate().any(|(i, word)| {
            if !names.contains(word) {
                return false;
            }
            let before = words[..i].iter().rev().take(3).copied().collect::<Vec<_>>();
            let after = words[i + 1..].iter().take(4).copied().collect::<Vec<_>>();
            after.starts_with(&["is", "not", "supported"])
                || after.starts_with(&["not", "supported"])
                || after.starts_with(&["is", "unsupported"])
                || after.starts_with(&["is", "not", "allowed"])
                || before
                    .first()
                    .is_some_and(|word| ["unsupported", "unrecognized"].contains(word))
                || (before.first().is_some_and(|word| {
                    ["parameter", "parameters", "argument", "field"].contains(word)
                }) && before
                    .iter()
                    .skip(1)
                    .any(|word| ["unsupported", "unknown", "unrecognized"].contains(word)))
        })
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Protocol {
    Auto,
    Sse,
    Ndjson,
    Json,
}
struct Decoder {
    protocol: Protocol,
    pending: Vec<u8>,
    data: String,
    content: String,
    done: bool,
    reason: Option<String>,
    prompt: Option<u64>,
    completion: Option<u64>,
    id: Option<String>,
}
impl Decoder {
    fn new(content_type: &str, id: Option<String>) -> Self {
        let protocol = if content_type.contains("text/event-stream") {
            Protocol::Sse
        } else if content_type.contains("ndjson") {
            Protocol::Ndjson
        } else {
            Protocol::Auto
        };
        Self {
            protocol,
            pending: Vec::new(),
            data: String::new(),
            content: String::new(),
            done: false,
            reason: None,
            prompt: None,
            completion: None,
            id,
        }
    }
    fn packet(&mut self, value: Value, fragment: &impl Fn(&str)) -> Result<(), String> {
        if let Some(error) = value.get("error").filter(|error| !error.is_null()) {
            return Err(format!("AI 流式响应错误：{error}"));
        }
        if self.id.is_none() {
            self.id = value.get("id").and_then(Value::as_str).map(str::to_owned);
        }
        if let Some(usage) = value.get("usage").filter(|v| v.is_object()) {
            self.prompt = usage.get("prompt_tokens").and_then(Value::as_u64);
            self.completion = usage.get("completion_tokens").and_then(Value::as_u64);
        }
        if value.get("done").and_then(Value::as_bool) == Some(true) {
            self.done = true;
            self.reason = value
                .get("done_reason")
                .and_then(Value::as_str)
                .map(str::to_owned);
            self.prompt = value.get("prompt_eval_count").and_then(Value::as_u64);
            self.completion = value.get("eval_count").and_then(Value::as_u64);
        }
        let choice = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| {
                choices
                    .iter()
                    .find(|v| v.get("index").and_then(Value::as_u64).unwrap_or(0) == 0)
            });
        if let Some(reason) = choice
            .and_then(|c| c.get("finish_reason"))
            .and_then(Value::as_str)
        {
            self.reason = Some(reason.into());
        }
        let content = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .or_else(|| {
                choice
                    .and_then(|c| c.get("delta").or_else(|| c.get("message")))
                    .and_then(|d| d.get("content"))
                    .and_then(Value::as_str)
            });
        if let Some(content) = content {
            self.content.push_str(content);
            if self.content.len() > 2 * 1024 * 1024 {
                return Err("AI 响应超过读取上限".into());
            }
            fragment(content);
        }
        Ok(())
    }
    fn event(&mut self, fragment: &impl Fn(&str)) -> Result<(), String> {
        let data = std::mem::take(&mut self.data);
        if data.trim().is_empty() {
            return Ok(());
        }
        if data.trim() == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        self.packet(
            serde_json::from_str(&data).map_err(|e| format!("无效的流式数据：{e}"))?,
            fragment,
        )
    }
    fn line(&mut self, bytes: &[u8], fragment: &impl Fn(&str)) -> Result<(), String> {
        let line = std::str::from_utf8(bytes)
            .map_err(|e| e.to_string())?
            .trim_end_matches('\r');
        match self.protocol {
            Protocol::Sse => {
                if line.is_empty() {
                    return self.event(fragment);
                }
                if let Some(data) = line.strip_prefix("data:") {
                    if !self.data.is_empty() {
                        self.data.push('\n');
                    }
                    self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                    if self.data.len() > 2 * 1024 * 1024 {
                        return Err("AI 流式帧超过读取上限".into());
                    }
                }
            }
            Protocol::Ndjson if !line.trim().is_empty() => self.packet(
                serde_json::from_str(line).map_err(|e| e.to_string())?,
                fragment,
            )?,
            _ => {}
        }
        Ok(())
    }
    fn push(&mut self, bytes: &[u8], fragment: &impl Fn(&str)) -> Result<(), String> {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > 2 * 1024 * 1024 {
            return Err("AI 流式帧超过读取上限".into());
        }
        if self.protocol == Protocol::Auto {
            let prefix = self
                .pending
                .iter()
                .position(|b| !b.is_ascii_whitespace())
                .unwrap_or(self.pending.len());
            let tail = &self.pending[prefix..];
            if tail.starts_with(b"data:") || tail.starts_with(b":") || tail.starts_with(b"event:") {
                self.protocol = Protocol::Sse;
            } else if let Some(end) = tail.iter().position(|b| *b == b'\n') {
                if let Ok(value) = serde_json::from_slice::<Value>(&tail[..end]) {
                    self.protocol = if value.get("done").and_then(Value::as_bool) == Some(false)
                        || value.pointer("/choices/0/delta").is_some()
                    {
                        Protocol::Ndjson
                    } else {
                        Protocol::Json
                    };
                }
            }
        }
        if self.protocol == Protocol::Sse || self.protocol == Protocol::Ndjson {
            let mut consumed = 0;
            while let Some(offset) = self.pending[consumed..].iter().position(|b| *b == b'\n') {
                let end = consumed + offset;
                let line = self.pending[consumed..end].to_vec();
                self.line(&line, fragment)?;
                consumed = end + 1;
            }
            self.pending.drain(..consumed);
        }
        Ok(())
    }
    fn finish(mut self, fragment: &impl Fn(&str)) -> Result<(ChatResult, bool), String> {
        let batch = self.protocol == Protocol::Auto || self.protocol == Protocol::Json;
        if batch {
            let value: Value = serde_json::from_slice(&self.pending).map_err(|e| e.to_string())?;
            self.packet(value, &|_| {})?;
            // A complete JSON response is consumed once, even if stream was ignored.
            self.done = true;
        } else {
            let tail = std::mem::take(&mut self.pending);
            if !tail.is_empty() {
                self.line(&tail, fragment)?;
            }
            if self.protocol == Protocol::Sse {
                self.event(fragment)?;
            }
            if !self.done && !(self.protocol == Protocol::Sse && self.reason.is_some()) {
                return Err("流式响应在结束标志前中断".into());
            }
        }
        Ok((
            ChatResult {
                content: self.content,
                request_id: self.id,
                finish_reason: self.reason,
                prompt_tokens: self.prompt,
                completion_tokens: self.completion,
            },
            batch,
        ))
    }
}

pub(super) async fn chat(
    client: &Client,
    config: &AiConfig,
    token: &CancellationToken,
    notifier: Option<&RetryNotifier>,
    prompt: String,
    schema: Value,
    file_id: i64,
    session: &Session,
    fragment: impl Fn(&str),
    activity: impl Fn(),
) -> Result<ChatResult, ChatFailure> {
    let url = chat_endpoint(config);
    loop {
        let stream = session.stream.load(Ordering::Relaxed);
        let include_usage = stream && session.usage.load(Ordering::Relaxed);
        let mut body = if config.is_openai() {
            json!({"model":config.model,"temperature":0,"stream":stream,"response_format":{"type":"json_object"},
                "messages":[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}]})
        } else {
            json!({"model":config.model,"stream":stream,"format":schema,"options":{"temperature":0},
                "messages":[{"role":"system","content":SYSTEM_PROMPT},{"role":"user","content":prompt}]})
        };
        if config.is_openai() && include_usage {
            body["stream_options"] = json!({"include_usage":true});
        }
        diagnostics::stream_request(file_id, stream);
        let mut response = send_retry(token, notifier, || {
            let request = client.post(&url).json(&body);
            if config.is_openai() {
                if let Some(key) = config
                    .api_key
                    .as_deref()
                    .map(str::trim)
                    .filter(|key| !key.is_empty())
                {
                    return request.bearer_auth(key);
                }
            }
            request
        })
        .await
        .map_err(|e| {
            failure(
                e.clone(),
                if e == CANCELLED_MESSAGE {
                    "CANCELLED"
                } else {
                    "NETWORK_ERROR"
                },
                None,
            )
        })?;
        let id = request_id(response.headers());
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = tokio::select! { result = response.text() => result.unwrap_or_default(), _ = token.cancelled_future() => return Err(failure(CANCELLED_MESSAGE,"CANCELLED",id)) };
            if [400, 422].contains(&status) && stream {
                if config.is_openai()
                    && include_usage
                    && unsupported(&text, &["stream_options", "include_usage"])
                {
                    session.usage.store(false, Ordering::Relaxed);
                    diagnostics::compatibility_retry(file_id);
                    continue;
                }
                if unsupported(&text, &["stream"])
                    && !text.to_lowercase().contains("stream_options")
                    && !text.to_lowercase().contains("include_usage")
                {
                    session.stream.store(false, Ordering::Relaxed);
                    diagnostics::compatibility_retry(file_id);
                    continue;
                }
            }
            return Err(ChatFailure {
                message: format!("AI 服务返回错误 {status}：{text}"),
                kind: "HTTP_ERROR",
                http_status: Some(status),
                request_id: id,
            });
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let mut decoder = Decoder::new(&content_type, id.clone());
        loop {
            let chunk = tokio::select! { result = response.chunk() => result.map_err(|e| failure(format!("连接中断，尚未保存：{e}"),"STREAM_INTERRUPTED",id.clone()))?,
            _ = token.cancelled_future() => return Err(failure(CANCELLED_MESSAGE,"CANCELLED",id.clone())) };
            let Some(chunk) = chunk else {
                break;
            };
            activity();
            decoder
                .push(&chunk, &fragment)
                .map_err(|e| failure(e, "STREAM_DECODE_FAILED", id.clone()))?;
        }
        let (result, batch) = decoder
            .finish(&fragment)
            .map_err(|e| failure(format!("连接中断，尚未保存：{e}"), "STREAM_INTERRUPTED", id))?;
        if batch && stream {
            session.stream.store(false, Ordering::Relaxed);
            diagnostics::batch_response(file_id);
        }
        return Ok(result);
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{mpsc, Mutex},
        time::{Duration, Instant},
    };
    pub fn sse(content: &str) -> String {
        format!(
            "data: {}\n\n",
            json!({"choices":[{"index":0,"delta":{"content":content},"finish_reason":null}]})
        )
    }
    pub fn ending(reason: &str) -> String {
        format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"index":0,"delta":{},"finish_reason":reason}]}),
            json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}})
        )
    }
    pub struct Reply {
        pub status: u16,
        pub kind: &'static str,
        pub body: String,
        pub pause: Option<(usize, mpsc::Receiver<()>)>,
        pub incomplete: bool,
    }
    impl Reply {
        pub fn stream(body: String) -> Self {
            Self {
                status: 200,
                kind: "text/event-stream",
                body,
                pause: None,
                incomplete: false,
            }
        }
        pub fn error(status: u16, body: &str) -> Self {
            Self {
                status,
                kind: "application/json",
                body: body.into(),
                pause: None,
                incomplete: false,
            }
        }
    }
    pub fn mock(replies: Vec<Reply>) -> (AiConfig, std::thread::JoinHandle<Vec<Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let handle = std::thread::spawn(move || {
            let mut captured = Vec::new();
            for reply in replies {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(e) => panic!("mock request missing: {e}"),
                    }
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = socket.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") else {
                        continue;
                    };
                    let length = String::from_utf8_lossy(&bytes[..end])
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|n| n.trim().parse::<usize>().ok())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        captured.push(
                            serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap(),
                        );
                        break;
                    }
                }
                let length = reply.body.len() + usize::from(reply.incomplete) * 100;
                write!(socket,"HTTP/1.1 {} Mock\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",reply.status,reply.kind,length).unwrap();
                if let Some((position, gate)) = reply.pause {
                    socket
                        .write_all(&reply.body.as_bytes()[..position])
                        .unwrap();
                    socket.flush().unwrap();
                    gate.recv_timeout(Duration::from_secs(3))
                        .expect("first preview was not published during pause");
                    let _ = socket.write_all(&reply.body.as_bytes()[position..]);
                } else {
                    socket.write_all(reply.body.as_bytes()).unwrap();
                }
            }
            captured
        });
        (
            AiConfig {
                provider: "openai".into(),
                base_url: format!("http://{address}"),
                model: "fixture".into(),
                api_key: None,
            },
            handle,
        )
    }
    #[test]
    fn sse_utf8_boundaries_heartbeats_and_usage_are_decoded_once() {
        let bytes = format!(": heartbeat\r\n\r\n{}{}", sse("🎬 \"\\\n"), ending("stop"))
            .replace('\n', "\r\n");
        let fragments = Mutex::new(Vec::new());
        let receive = |s: &str| fragments.lock().unwrap().push(s.to_owned());
        let mut decoder = Decoder::new("text/event-stream", None);
        for byte in bytes.as_bytes() {
            decoder.push(&[*byte], &receive).unwrap();
        }
        let (result, batch) = decoder.finish(&receive).unwrap();
        assert!(!batch);
        assert_eq!(result.content, "🎬 \"\\\n");
        assert_eq!(*fragments.lock().unwrap(), [result.content.clone()]);
        assert_eq!(
            (result.prompt_tokens, result.completion_tokens),
            (Some(10), Some(20))
        );
    }
    #[test]
    fn ndjson_thinking_is_hidden_and_final_usage_required_for_known_totals() {
        let raw = format!(
            "{}\n{}",
            json!({"done":false,"message":{"thinking":"private reasoning","content":"{}"}}),
            json!({"done":true,"message":{"content":""},"prompt_eval_count":8,"eval_count":5})
        );
        let mut decoder = Decoder::new("application/x-ndjson", None);
        for byte in raw.as_bytes() {
            decoder.push(&[*byte], &|_| {}).unwrap();
        }
        let (result, batch) = decoder.finish(&|_| {}).unwrap();
        assert!(!batch);
        assert_eq!(result.content, "{}");
        assert_eq!(result.prompt_tokens, Some(8));
        let mut decoder = Decoder::new("text/event-stream", None);
        decoder.push(sse("{}").as_bytes(), &|_| {}).unwrap();
        assert!(decoder.finish(&|_| {}).is_err());
        let mut decoder = Decoder::new("text/event-stream", None);
        decoder
            .push(format!("{}data: [DONE]\n\n", sse("{}")).as_bytes(), &|_| {})
            .unwrap();
        assert!(decoder.finish(&|_| {}).unwrap().0.prompt_tokens.is_none());
    }
    #[test]
    fn full_json_ignored_stream_is_consumed_without_incremental_fragments() {
        let raw=json!({"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20}}).to_string();
        let mut decoder = Decoder::new("application/json", None);
        for chunk in raw.as_bytes().chunks(3) {
            decoder
                .push(chunk, &|_| panic!("batch JSON must wait for completion"))
                .unwrap();
        }
        let (result, batch) = decoder.finish(&|_| {}).unwrap();
        assert!(batch);
        assert_eq!(result.content, "{}");
        assert_eq!(result.completion_tokens, Some(20));
    }
    #[tokio::test]
    async fn explicit_parameter_rejections_are_bounded_and_remembered() {
        let (config, server) = mock(vec![
            Reply::error(400, "unknown parameter stream_options include_usage"),
            Reply::error(422, "stream is not supported"),
            Reply::error(
                200,
                &json!({"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]})
                    .to_string(),
            ),
            Reply::error(
                200,
                &json!({"choices":[{"message":{"content":"{}"}}]}).to_string(),
            ),
        ]);
        let client =
            super::super::super::ai_client(Duration::from_secs(5), &config.base_url).unwrap();
        let session = Session::default();
        let token = CancellationToken::default();
        diagnostics::start(601, "openai", "fixture");
        diagnostics::begin_request(601, "extraction", "same", false);
        chat(
            &client,
            &config,
            &token,
            None,
            "same".into(),
            json!({}),
            601,
            &session,
            |_| {},
            || {},
        )
        .await
        .map_err(|e| e.message)
        .unwrap();
        diagnostics::begin_request(601, "extraction", "same", false);
        chat(
            &client,
            &config,
            &token,
            None,
            "same".into(),
            json!({}),
            601,
            &session,
            |_| {},
            || {},
        )
        .await
        .map_err(|e| e.message)
        .unwrap();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 4);
        assert_eq!(requests[0]["stream_options"]["include_usage"], true);
        assert!(requests[1].get("stream_options").is_none());
        assert_eq!(requests[1]["stream"], true);
        assert_eq!(requests[2]["stream"], false);
        assert_eq!(requests[3]["stream"], false);
        assert!(requests
            .iter()
            .all(|r| r["messages"] == requests[0]["messages"]));
        let usage = diagnostics::summary(601).unwrap();
        assert_eq!(
            (
                usage.extraction.requests,
                usage.stream_requests,
                usage.stream_fallbacks
            ),
            (4, 2, 2)
        );
    }
    #[tokio::test]
    async fn authentication_and_rate_errors_do_not_trigger_compatibility_fallback() {
        for status in [401, 429, 400] {
            let (config, server) = mock(vec![Reply::error(
                status,
                "model unsupported, stream request rejected",
            )]);
            let client =
                super::super::super::ai_client(Duration::from_secs(5), &config.base_url).unwrap();
            let session = Session::default();
            let result = chat(
                &client,
                &config,
                &CancellationToken::default(),
                None,
                "p".into(),
                json!({}),
                602,
                &session,
                |_| {},
                || {},
            )
            .await;
            // A model error must not be mistaken for stream incompatibility.
            assert!(result.is_err());
            assert!(session.stream.load(Ordering::Relaxed));
            assert!(session.usage.load(Ordering::Relaxed));
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn streaming_and_original_requests_have_identical_generation_inputs_and_reported_usage() {
        let plain=json!({"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20}}).to_string();
        let (config, server) = mock(vec![
            Reply::stream(format!("{}{}", sse("{}"), ending("stop"))),
            Reply::error(200, &plain),
        ]);
        let client =
            super::super::super::ai_client(Duration::from_secs(5), &config.base_url).unwrap();
        let token = CancellationToken::default();
        diagnostics::start(610, "openai", "fixture");
        diagnostics::begin_request(610, "extraction", "same prompt", false);
        let streamed = chat(
            &client,
            &config,
            &token,
            None,
            "same prompt".into(),
            json!({"type":"object"}),
            610,
            &Session::default(),
            |_| {},
            || {},
        )
        .await
        .map_err(|e| e.message)
        .unwrap();
        diagnostics::response_usage(610, "extraction", Some(&streamed));
        let streaming_usage = diagnostics::summary(610).unwrap().extraction;
        diagnostics::start(610, "openai", "fixture");
        diagnostics::begin_request(610, "extraction", "same prompt", false);
        let original = super::super::super::chat_detailed(
            &client,
            &config,
            &token,
            None,
            "same prompt".into(),
            json!({"type":"object"}),
        )
        .await
        .map_err(|e| e.message)
        .unwrap();
        diagnostics::response_usage(610, "extraction", Some(&original));
        let plain_usage = diagnostics::summary(610).unwrap().extraction;
        assert_eq!(streamed.content, original.content);
        assert_eq!(
            (
                streaming_usage.requests,
                streaming_usage.prompt_tokens,
                streaming_usage.completion_tokens
            ),
            (
                plain_usage.requests,
                plain_usage.prompt_tokens,
                plain_usage.completion_tokens
            )
        );
        let mut requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["stream"], true);
        assert!(!requests[1]["stream"].as_bool().unwrap_or(false));
        for request in &mut requests {
            let object = request.as_object_mut().unwrap();
            object.remove("stream");
            object.remove("stream_options");
        }
        assert_eq!(requests[0], requests[1]);
    }
    #[tokio::test]
    async fn native_ollama_keeps_schema_options_and_reads_final_usage() {
        let raw = format!(
            "{}\n{}\n",
            json!({"message":{"content":"{}"},"done":false}),
            json!({"message":{"content":""},"done":true,"prompt_eval_count":10,"eval_count":20,"done_reason":"stop"})
        );
        let mut reply = Reply::stream(raw);
        reply.kind = "application/x-ndjson";
        let (mut config, server) = mock(vec![reply]);
        config.provider = "ollama".into();
        let client =
            super::super::super::ai_client(Duration::from_secs(5), &config.base_url).unwrap();
        let schema = json!({"type":"object","properties":{"phrases":{"type":"array"}}});
        let result = chat(
            &client,
            &config,
            &CancellationToken::default(),
            None,
            "same".into(),
            schema.clone(),
            611,
            &Session::default(),
            |_| {},
            || {},
        )
        .await
        .map_err(|e| e.message)
        .unwrap();
        assert_eq!(result.prompt_tokens, Some(10));
        assert_eq!(result.completion_tokens, Some(20));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["stream"], true);
        assert_eq!(requests[0]["format"], schema);
        assert_eq!(requests[0]["options"], json!({"temperature":0}));
        assert!(requests[0].get("stream_options").is_none());
    }
}
