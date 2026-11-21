//! Offline compatibility for original YouTube material snapshots.

pub(super) fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub(super) fn parse_ts(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let comma = raw.find(['.', ','])?;
    let (hms, ms) = (&raw[..comma], &raw[comma + 1..]);
    let ms: i64 = ms.parse().ok()?;
    let mut parts = hms.split(':');
    let h: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    let s: i64 = parts.next()?.parse().ok()?;
    if parts.next().is_some()
        || h < 0
        || !(0..60).contains(&m)
        || !(0..60).contains(&s)
        || !(0..1000).contains(&ms)
    {
        return None;
    }
    h.checked_mul(3_600_000)?
        .checked_add(m * 60_000 + s * 1000 + ms)
}

fn parse_ts_line(line: &str) -> Option<(i64, i64)> {
    let arrow = line.find("-->")?;
    let start = parse_ts(&line[..arrow])?;
    let end = parse_ts(line[arrow + 3..].split_whitespace().next()?)?;
    Some((start, end))
}

pub(super) struct SrtCue {
    pub(super) start_ms: i64,
    pub(super) end_ms: i64,
    pub(super) text: String,
}

pub(super) fn parse_srt(content: &str) -> Vec<SrtCue> {
    let normalized = content.replace("\r\n", "\n").replace('\u{feff}', "");
    let mut cues = Vec::new();
    let mut lines = normalized.lines().peekable();
    while let Some(line) = lines.next() {
        if line.trim().parse::<u32>().is_ok() {
            if let Some((start_ms, end_ms)) = lines.peek().and_then(|ts| parse_ts_line(ts)) {
                lines.next();
                let mut text = Vec::new();
                while let Some(l) = lines.peek() {
                    if l.trim().is_empty() {
                        break;
                    }
                    text.push(l.to_string());
                    lines.next();
                }
                cues.push(SrtCue {
                    start_ms,
                    end_ms,
                    text: text.join("\n"),
                });
            }
        }
    }
    cues
}

#[cfg(test)]
pub mod downloads {
    #[allow(dead_code)]
    #[derive(Debug, Copy, Clone, PartialEq, Eq, serde::Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum SubtitleSource {
        Manual,
        Original,
        Translated,
        Unknown,
    }
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Clone)]
pub struct SubtitleTrack {
    pub lang: String,
    pub is_auto: bool,
    pub language: String,
    pub source: downloads::SubtitleSource,
    pub source_language: Option<String>,
}
