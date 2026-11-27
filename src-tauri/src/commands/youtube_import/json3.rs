use serde::Deserialize;
use std::fmt::Write;

#[derive(Deserialize)]
struct Track {
    events: Vec<Event>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    t_start_ms: Option<i64>,
    d_duration_ms: Option<i64>,
    #[serde(default)]
    segs: Vec<Segment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    utf8: String,
    #[serde(default)]
    t_offset_ms: i64,
}

struct Cue {
    start_ms: i64,
    end_ms: i64,
    last_word_ms: i64,
    text: String,
}

pub(super) fn to_srt(content: &str, duration_ms: i64) -> Option<String> {
    let track: Track = serde_json::from_str(content.trim_start_matches('\u{feff}')).ok()?;
    let mut cues = Vec::new();
    for event in track.events {
        let text: String = event
            .segs
            .iter()
            .map(|segment| segment.utf8.as_str())
            .collect();
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            // Window and newline events control the display and contain no speech.
            continue;
        }
        let start = event.t_start_ms?;
        let end = start.checked_add(event.d_duration_ms?)?.min(duration_ms);
        if start < 0 || start >= end {
            return None;
        }
        let last_word = start.checked_add(
            event
                .segs
                .iter()
                .filter(|segment| !segment.utf8.trim().is_empty())
                .map(|segment| segment.t_offset_ms)
                .max()
                .unwrap_or(0),
        )?;
        cues.push(Cue {
            start_ms: start,
            end_ms: end,
            last_word_ms: last_word,
            text,
        });
    }
    cues.sort_by_key(|cue| cue.start_ms);
    let mut srt = String::new();
    for (index, cue) in cues.iter().enumerate() {
        // YouTube keeps a line visible while the next one comes in. Use the
        // next cue as the playback boundary when it follows this line's words.
        let end = match cues.get(index + 1) {
            Some(next) if next.start_ms > cue.start_ms && next.start_ms > cue.last_word_ms => {
                cue.end_ms.min(next.start_ms)
            }
            _ => cue.end_ms,
        };
        writeln!(
            srt,
            "{}\n{} --> {}\n{}\n",
            index + 1,
            timestamp(cue.start_ms),
            timestamp(end),
            cue.text,
        )
        .ok()?;
    }
    (!srt.is_empty()).then_some(srt)
}

fn timestamp(ms: i64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
