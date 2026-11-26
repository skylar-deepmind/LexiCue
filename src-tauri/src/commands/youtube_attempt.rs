//! Diagnostics contain only application-defined categories, timings and tool versions.
use std::{future::Future, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader},
    process::Command,
    time::{sleep, timeout_at, Instant},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Failure {
    Timeout,
    ConnectionInterrupted,
    ServerError,
    RateLimited,
    NoSubtitles,
    ToolMissing,
    ToolIncompatible,
    ToolFailed,
    InvalidMetadata,
    MetadataTooLarge,
    InvalidSubtitles,
    NoAudioTrack,
    AudioInvalid,
    CoverMissing,
    CoverInvalid,
    CoverUnavailable,
    TooLarge,
    LocalIo,
}

impl Failure {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Timeout => "material_youtube_timeout",
            Self::RateLimited => "material_youtube_rate_limited",
            Self::NoSubtitles => "material_youtube_no_subtitles",
            Self::ToolMissing | Self::ToolIncompatible => "material_youtube_tool_missing",
            Self::TooLarge => "material_too_large",
            _ => "material_download_failed",
        }
    }

    fn retryable(self) -> bool {
        matches!(
            self,
            Self::Timeout | Self::ConnectionInterrupted | Self::ServerError
        )
    }
}

pub(super) struct Trace {
    id: uuid::Uuid,
    deadline: Instant,
}

impl Trace {
    pub(super) fn new(deadline: Instant) -> Self {
        Self {
            id: uuid::Uuid::new_v4(),
            deadline,
        }
    }

    pub(super) async fn step<T, F: Future<Output = Result<T, Failure>>>(
        &self,
        stage: &'static str,
        limit: Duration,
        retries: bool,
        mut run: impl FnMut() -> F,
    ) -> Result<T, Failure> {
        let delays = [Duration::from_millis(400), Duration::from_millis(800)];
        for (index, delay) in delays.into_iter().map(Some).chain([None]).enumerate() {
            let attempt = index + 1;
            let started = Instant::now();
            let mut diagnostic = Attempt {
                trace: self,
                stage,
                attempt,
                started,
                finished: false,
            };
            let deadline = self.deadline.min(started + limit);
            let result = if deadline <= started {
                Err(Failure::Timeout)
            } else {
                timeout_at(deadline, run())
                    .await
                    .unwrap_or(Err(Failure::Timeout))
            };
            diagnostic.finished = true;
            self.record(stage, attempt, started, result.as_ref().err().copied());
            match result {
                Err(failure) if retries && failure.retryable() => {
                    let Some(delay) = delay else {
                        return Err(failure);
                    };
                    if Instant::now() + delay >= self.deadline {
                        return Err(failure);
                    }
                    sleep(delay).await;
                }
                result => return result,
            }
        }
        unreachable!("the last attempt returns its result")
    }

    pub(super) fn record(
        &self,
        stage: &'static str,
        attempt: usize,
        started: Instant,
        failure: Option<Failure>,
    ) {
        let elapsed = started.elapsed().as_millis();
        if let Some(failure) = failure {
            log::warn!("YouTube import {} stage={stage} attempt={attempt} elapsed_ms={elapsed} result={failure:?}", self.id);
        } else {
            log::info!(
                "YouTube import {} stage={stage} attempt={attempt} elapsed_ms={elapsed} result=ok",
                self.id
            );
        }
    }

    pub(super) fn tool(&self, name: &'static str, version: &str) {
        log::info!("YouTube import {} tool={name} version={version}", self.id);
    }

    pub(super) fn finish(&self, started: Instant, reason: Option<&str>) {
        let reason = reason.unwrap_or("ok");
        // Callers pass only internal error codes, never external diagnostics.
        log::info!(
            "YouTube import {} elapsed_ms={} result={reason}",
            self.id,
            started.elapsed().as_millis()
        );
    }
}

struct Attempt<'a> {
    trace: &'a Trace,
    stage: &'static str,
    attempt: usize,
    started: Instant,
    finished: bool,
}

impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        if !self.finished {
            log::info!(
                "YouTube import {} stage={} attempt={} elapsed_ms={} result=aborted",
                self.trace.id,
                self.stage,
                self.attempt,
                self.started.elapsed().as_millis()
            );
        }
    }
}

// yt-dlp can start a JS runtime or ffmpeg. End the entire process group when
// the deadline, an early 429, or import cancellation drops the attempt.
struct ProcessGroup(Option<i32>);

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            // The child was created as a group leader, so -pid targets only its group.
            unsafe { libc::kill(-pid, libc::SIGKILL) };
        }
    }
}

pub(super) struct ToolOutput {
    pub(super) stdout: Vec<u8>,
    pub(super) issue: Option<Failure>,
}

pub(super) async fn run_tool(
    mut command: Command,
    stdout_limit: usize,
    progress: impl Fn(&str),
) -> Result<ToolOutput, Failure> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0)
        .spawn()
        .map_err(|_| Failure::ToolMissing)?;
    let mut group = ProcessGroup(child.id().map(|pid| pid as i32));
    let stdout = child.stdout.take().ok_or(Failure::ToolFailed)?;
    let stderr = child.stderr.take().ok_or(Failure::ToolFailed)?;
    let read_stdout = async {
        if stdout_limit == 0 {
            scan_lines(stdout, |line| {
                progress(line);
                Ok(())
            })
            .await?;
            return Ok(Vec::new());
        }
        let mut output = Vec::new();
        stdout
            .take(stdout_limit as u64 + 1)
            .read_to_end(&mut output)
            .await
            .map_err(|_| Failure::ToolFailed)?;
        if output.len() > stdout_limit {
            return Err(Failure::TooLarge);
        }
        Ok(output)
    };
    let read_stderr = async {
        let mut issue = None;
        scan_lines(stderr, |line| {
            let classified = classify_stderr(line);
            if classified == Some(Failure::RateLimited) {
                return Err(Failure::RateLimited);
            }
            issue = classified.or(issue);
            Ok(())
        })
        .await?;
        Ok(issue)
    };
    let (issue, stdout) = tokio::try_join!(read_stderr, read_stdout)?;
    let status = child.wait().await.map_err(|_| Failure::ToolFailed)?;
    group.0 = None;
    if !status.success() {
        return Err(issue.unwrap_or(Failure::ToolFailed));
    }
    Ok(ToolOutput { stdout, issue })
}

async fn scan_lines(
    pipe: impl AsyncRead + Unpin,
    mut inspect: impl FnMut(&str) -> Result<(), Failure>,
) -> Result<(), Failure> {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    // Bound temporary stderr storage even when a tool prints a huge URL or a
    // line without a newline. Inspect chunks as well as normal log lines.
    loop {
        let buffer = reader.fill_buf().await.map_err(|_| Failure::ToolFailed)?;
        if buffer.is_empty() {
            break;
        }
        let count = buffer
            .iter()
            .position(|&byte| matches!(byte, b'\n' | b'\r'))
            .map_or(buffer.len(), |end| end + 1)
            .min(8192 - line.len());
        line.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if line.len() == 8192 || line.ends_with(b"\n") || line.ends_with(b"\r") {
            inspect(&String::from_utf8_lossy(&line))?;
            line.clear();
        }
    }
    if !line.is_empty() {
        inspect(&String::from_utf8_lossy(&line))?;
    }
    Ok(())
}

fn classify_stderr(line: &str) -> Option<Failure> {
    let line = line.trim_start().to_ascii_lowercase();
    // Inspect only tool diagnostics. Never store or emit the underlying strings.
    if !["error:", "warning:", "[download]", "[youtube]"]
        .iter()
        .any(|prefix| line.starts_with(prefix))
    {
        return None;
    }
    let status = ["http error ", "http status ", "http status code "]
        .into_iter()
        .find_map(|prefix| line.split_once(prefix)?.1.get(..3)?.parse::<u16>().ok());
    match status {
        Some(429) => Some(Failure::RateLimited),
        Some(408) => Some(Failure::Timeout),
        Some(500..=599) => Some(Failure::ServerError),
        _ if line.contains("too many requests") => Some(Failure::RateLimited),
        _ if ["timed out", "timeout", "etimedout"]
            .iter()
            .any(|text| line.contains(text)) =>
        {
            Some(Failure::Timeout)
        }
        _ if [
            "connection reset",
            "connection refused",
            "connection aborted",
            "remote end closed",
            "remote disconnected",
            "server disconnected",
            "broken pipe",
            "incomplete read",
            "incompleteread",
            "contenttooshort",
            "unexpected eof",
            "network is unreachable",
            "temporary failure in name resolution",
        ]
        .iter()
        .any(|text| line.contains(text)) =>
        {
            Some(Failure::ConnectionInterrupted)
        }
        _ if [
            "no such option",
            "no supported javascript runtime",
            "challenge solving failed",
            "no javascript runtime",
            "ffmpeg not found",
            "ffprobe not found",
        ]
        .iter()
        .any(|text| line.contains(text)) =>
        {
            Some(Failure::ToolIncompatible)
        }
        _ => None,
    }
}

// Accept only the numeric version token. Even a broken local wrapper cannot
// place paths, URLs, credentials, or arbitrary stderr in the diagnostics.
pub(super) fn version_number(output: &[u8]) -> Option<&str> {
    std::str::from_utf8(output)
        .ok()?
        .lines()
        .next()?
        .split_ascii_whitespace()
        .map(|word| word.trim_start_matches('v'))
        .filter_map(|word| {
            let end = word
                .find(|character: char| !character.is_ascii_digit() && character != '.')
                .unwrap_or(word.len());
            let number = &word[..end];
            (number.len() <= 32
                && number.contains('.')
                && number
                    .split('.')
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())))
            .then_some(number)
        })
        .next()
}
