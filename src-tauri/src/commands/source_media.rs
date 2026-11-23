//! Portable subtitle provenance and device-local, content-addressed audio.
//! No local paths, signed URLs or credentials are accepted from portable data.
use super::youtube;
#[cfg(test)]
use super::youtube::downloads::SubtitleSource;
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

pub const MAX_BYTES: u64 = 256 * 1024 * 1024;
const TOTAL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
pub(super) const MAX_DURATION_MS: i64 = 7_200_000;
const MAX_SOURCE_DURATION_MS: i64 = 604_800_000;
// Auto captions can leave their final rolling cue open after the real EOF.
// Preserve the declaration; only playback ranges are clamped to verified audio.
const MAX_CUE_TAIL_MS: i64 = 5_000;
#[cfg(test)]
#[path = "source_media_import_lookup_test.rs"]
mod import_lookup_tests;
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(super) fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cue {
    pub id: u32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AudioTrack {
    pub format_id: String,
    pub language: String,
    pub language_basis: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct YoutubeSource {
    pub version: u8,
    pub provider: String,
    pub key: String,
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub duration_ms: i64,
    pub subtitle_track: String,
    pub subtitle_language: String,
    pub subtitle_kind: String,
    pub subtitle_sha256: String,
    pub cues: Vec<Cue>,
    pub audio: Option<AudioTrack>,
}
impl YoutubeSource {
    #[cfg(all(target_os = "macos", not(feature = "apple-store")))]
    pub(super) fn from_imported_captions(
        video: &str,
        title: String,
        duration_ms: i64,
        language: &str,
        content: &str,
        subtitle_kind: &str,
        audio: Option<AudioTrack>,
    ) -> Result<Self, String> {
        let mut source = Self {
            version: 1,
            provider: "youtube".into(),
            key: String::new(),
            video_id: video.into(),
            url: format!("https://www.youtube.com/watch?v={video}"),
            title,
            duration_ms,
            subtitle_track: language.into(),
            subtitle_language: language.into(),
            subtitle_kind: subtitle_kind.into(),
            subtitle_sha256: digest(content.as_bytes()),
            cues: youtube::parse_srt(content)
                .into_iter()
                .enumerate()
                .map(|(id, cue)| Cue {
                    id: id as u32,
                    start_ms: cue.start_ms,
                    end_ms: cue.end_ms,
                    text: cue.text,
                })
                .collect(),
            audio,
        };
        source.key = source.identity();
        source.validate()?;
        Ok(source)
    }

    pub(super) fn can_prepare_audio(&self) -> bool {
        self.duration_ms <= MAX_DURATION_MS
            && self.subtitle_language.starts_with("en")
            && matches!(self.subtitle_kind.as_str(), "manual" | "original")
    }

    fn identity(&self) -> String {
        digest(
            &serde_json::to_vec(&(
                &self.video_id,
                &self.subtitle_track,
                &self.subtitle_sha256,
                &self.audio,
                self.duration_ms,
            ))
            .unwrap(),
        )
    }
    pub fn validate(&self) -> Result<(), String> {
        let valid_origin = match self.provider.as_str() {
            "youtube" => {
                self.audio
                    .as_ref()
                    .is_none_or(|track| track.language_basis != "provided_file")
                    && youtube::is_valid_video_id(&self.video_id)
                    && self.url == format!("https://www.youtube.com/watch?v={}", self.video_id)
            }
            "local" => {
                valid_hash(&self.video_id)
                    && self.url.is_empty()
                    && self.subtitle_track == "local"
                    && self.subtitle_kind == "original"
                    && self.audio.as_ref().is_some_and(|track| {
                        track.format_id == "pcm_s16le"
                            && track.language == "und"
                            && track.language_basis == "provided_file"
                    })
            }
            _ => false,
        };
        if self.version != 1
            || !valid_origin
            || self.key != self.identity()
            || !valid_hash(&self.subtitle_sha256)
            || self.title.len() > 1000
            || !(1..=MAX_SOURCE_DURATION_MS).contains(&self.duration_ms)
            || self.cues.len() > 50000
            || self.cues.is_empty()
            || !matches!(
                self.subtitle_kind.as_str(),
                "manual" | "original" | "translated" | "unknown"
            )
            || self.subtitle_track.len() > 100
            || self.subtitle_language.len() > 30
            || self.cues.iter().any(|c| {
                c.start_ms < 0
                    || c.start_ms >= c.end_ms
                    || c.end_ms > self.duration_ms + MAX_CUE_TAIL_MS
                    || c.text.len() > 10000
            })
            || self
                .cues
                .windows(2)
                .any(|w| w[0].start_ms > w[1].start_ms || w[0].id >= w[1].id)
        {
            return Err("media_invalid_source".into());
        }
        if let Some(a) = &self.audio {
            if a.format_id.is_empty()
                || a.format_id.len() > 64
                || !a
                    .format_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                || !matches!(a.language.as_str(), "en" | "und")
                || !matches!(
                    a.language_basis.as_str(),
                    "metadata" | "single_unlabelled_original" | "provided_file"
                )
                || !self.subtitle_language.starts_with("en")
                || !matches!(self.subtitle_kind.as_str(), "manual" | "original")
            {
                return Err("media_unconfirmed_track".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MediaRef {
    pub source: YoutubeSource,
    pub cue_ids: Vec<u32>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub precision: String,
    pub padding_before_ms: u16,
    pub padding_after_ms: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_sha256: Option<String>,
}
impl MediaRef {
    pub fn validate(&self) -> Result<(), String> {
        self.source.validate()?;
        let selected: Vec<_> = self
            .cue_ids
            .iter()
            .filter_map(|i| self.source.cues.iter().find(|c| c.id == *i))
            .collect();
        if !self.source.can_prepare_audio()
            || self.precision != "cue"
            || self.padding_before_ms != 0
            || self.padding_after_ms != 0
            || selected.is_empty()
            || selected.len() != self.cue_ids.len()
            || self.cue_ids.windows(2).any(|w| w[0] >= w[1])
            || self.start_ms != selected.iter().map(|c| c.start_ms).min().unwrap()
            || self.end_ms != selected.iter().map(|c| c.end_ms).max().unwrap()
            || self
                .expected_sha256
                .as_deref()
                .is_some_and(|s| !valid_hash(s))
        {
            return Err("media_invalid_range".into());
        }
        Ok(())
    }
}
#[cfg(any(test, all(target_os = "macos", not(feature = "apple-store"))))]
pub(super) fn english_audio(metadata: &serde_json::Value) -> Option<AudioTrack> {
    let formats = metadata["formats"].as_array()?;
    let audio: Vec<_> = formats
        .iter()
        .filter(|f| {
            f["vcodec"] == "none"
                && f["ext"] == "m4a"
                && f["acodec"].as_str().is_some_and(|s| s.starts_with("mp4a"))
                && !f["format_note"].as_str().unwrap_or("").contains("DRC")
        })
        .collect();
    let languages: std::collections::HashSet<_> = audio
        .iter()
        .filter_map(|f| f["language"].as_str())
        .collect();
    let original_english = metadata["language"]
        .as_str()
        .or_else(|| metadata["original_language"].as_str())
        .is_some_and(|v| v == "en" || v.starts_with("en-"));
    let marked_original = audio.iter().any(|f| {
        f["language"]
            .as_str()
            .is_some_and(|v| v == "en" || v.starts_with("en-"))
            && f["format_note"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains("original")
    });
    let chosen = audio
        .into_iter()
        .filter(|f| {
            let english = f["language"]
                .as_str()
                .is_some_and(|v| v == "en" || v.starts_with("en-"));
            let note = f["format_note"].as_str().unwrap_or("").to_lowercase();
            if languages.is_empty() {
                return true;
            }
            english
                && !note.contains("dubbed")
                && (!marked_original || note.contains("original"))
                && (languages.len() == 1 || original_english || note.contains("original"))
        })
        .max_by_key(|f| (f["abr"].as_f64().unwrap_or(0.) * 1000.) as i64)?;
    Some(AudioTrack {
        format_id: chosen["format_id"].as_str()?.into(),
        language: if languages.is_empty() { "und" } else { "en" }.into(),
        language_basis: if languages.is_empty() {
            "single_unlabelled_original"
        } else {
            "metadata"
        }
        .into(),
    })
}

#[cfg(test)]
fn matches_subtitle_revision(source: &YoutubeSource, content: &str) -> bool {
    if digest(content.as_bytes()) == source.subtitle_sha256 {
        return true;
    }
    // SRT, VTT and JSON3 can serialize the same cue with different whitespace.
    let cues = youtube::parse_srt(content);
    source.cues.iter().all(|saved| {
        cues.get(saved.id as usize).is_some_and(|current| {
            current.start_ms == saved.start_ms
                && current.end_ms == saved.end_ms
                && current
                    .text
                    .split_whitespace()
                    .eq(saved.text.split_whitespace())
        })
    })
}
#[cfg(test)]
pub fn source_from_subtitles(
    video: &str,
    track: &youtube::SubtitleTrack,
    content: &str,
    metadata: &serde_json::Value,
) -> Option<YoutubeSource> {
    checked_source_from_subtitles(video, track, content, metadata).ok()
}
#[cfg(test)]
pub fn checked_source_from_subtitles(
    video: &str,
    track: &youtube::SubtitleTrack,
    content: &str,
    metadata: &serde_json::Value,
) -> Result<YoutubeSource, String> {
    let seconds = metadata["duration"]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or("media_metadata_missing")?;
    let duration_ms = (seconds * 1000.).round() as i64;
    if !(1..=MAX_SOURCE_DURATION_MS).contains(&duration_ms) {
        return Err("media_metadata_missing".into());
    }
    let audio = if track.language.starts_with("en")
        && matches!(
            track.source,
            SubtitleSource::Manual | SubtitleSource::Original
        ) {
        english_audio(metadata)
    } else {
        None
    };
    let cues = youtube::parse_srt(content)
        .into_iter()
        .enumerate()
        .map(|(i, c)| Cue {
            id: i as u32,
            start_ms: c.start_ms,
            end_ms: c.end_ms,
            text: c.text,
        })
        .collect();
    let mut s = YoutubeSource {
        version: 1,
        provider: "youtube".into(),
        key: String::new(),
        video_id: video.into(),
        url: format!("https://www.youtube.com/watch?v={video}"),
        title: metadata["title"]
            .as_str()
            .unwrap_or(video)
            .chars()
            .take(1000)
            .collect(),
        duration_ms,
        subtitle_track: format!("{}:{}", track.lang, track.is_auto),
        subtitle_language: track.language.clone(),
        subtitle_kind: serde_json::to_value(track.source)
            .map_err(|_| "media_invalid_source")?
            .as_str()
            .ok_or("media_invalid_source")?
            .into(),
        subtitle_sha256: digest(content.as_bytes()),
        cues,
        audio,
    };
    s.key = s.identity();
    s.validate()?;
    Ok(s)
}
fn clean(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
pub fn segment_reference(conn: &Connection, segment: i64) -> Result<Option<MediaRef>, String> {
    let row:Option<(String,String,Option<String>,Option<String>)>=conn.query_row("SELECT f.media_source,s.en_text,s.start_time,s.end_time FROM segments s JOIN files f ON f.id=s.file_id WHERE s.id=?1 AND f.media_source IS NOT NULL",[segment],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    let Some((json, text, start, end)) = row else {
        return Ok(None);
    };
    let s: YoutubeSource = serde_json::from_str(&json).map_err(|_| "media_invalid_source")?;
    s.validate()?;
    let expected = bound_hash(conn, &s.key)?;
    Ok(reference_for_segment(
        &s,
        &text,
        start.as_deref(),
        end.as_deref(),
        expected,
    ))
}
pub fn bound_hash(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT asset_id FROM source_media WHERE source_key=?1",
        [key],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(Option::flatten)
}
/// Source cues are sorted. Select by exact source boundaries without scanning or
/// cloning an entire long transcript for every displayed sentence.
pub fn reference_for_segment(
    s: &YoutubeSource,
    text: &str,
    start: Option<&str>,
    end: Option<&str>,
    expected: Option<String>,
) -> Option<MediaRef> {
    if !s.can_prepare_audio() {
        return None;
    }
    let (start, end) = (youtube::parse_ts(start?)?, youtube::parse_ts(end?)?);
    if start >= s.duration_ms {
        return None;
    }
    let first = s.cues.partition_point(|c| c.start_ms < start);
    let last = s.cues.partition_point(|c| c.start_ms < end);
    if first >= last {
        return None;
    }
    let cues: Vec<Cue> = s.cues[first..last]
        .iter()
        .filter(|c| c.end_ms <= end)
        .cloned()
        .collect();
    if cues.is_empty()
        || cues.iter().map(|c| c.start_ms).min() != Some(start)
        || cues.iter().map(|c| c.end_ms).max() != Some(end)
        || !clean(
            &cues
                .iter()
                .map(|c| c.text.as_str())
                .collect::<Vec<_>>()
                .join(" "),
        )
        .contains(&clean(text))
    {
        return None;
    }
    let ids = cues.iter().map(|c| c.id).collect();
    let snapshot = YoutubeSource {
        version: s.version,
        provider: s.provider.clone(),
        key: s.key.clone(),
        video_id: s.video_id.clone(),
        url: s.url.clone(),
        title: s.title.clone(),
        duration_ms: s.duration_ms,
        subtitle_track: s.subtitle_track.clone(),
        subtitle_language: s.subtitle_language.clone(),
        subtitle_kind: s.subtitle_kind.clone(),
        subtitle_sha256: s.subtitle_sha256.clone(),
        cues,
        audio: s.audio.clone(),
    };
    Some(MediaRef {
        source: snapshot,
        cue_ids: ids,
        start_ms: start,
        end_ms: end,
        precision: "cue".into(),
        padding_before_ms: 0,
        padding_after_ms: 0,
        expected_sha256: expected,
    })
}
/// Provenance remains portable even when this subtitle/audio track cannot play.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIdentity {
    pub version: u8,
    pub provider: String,
    pub key: String,
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub duration_ms: i64,
    pub subtitle_track: String,
    pub subtitle_language: String,
    pub subtitle_kind: String,
    pub subtitle_sha256: String,
    pub audio: Option<AudioTrack>,
}
impl From<&YoutubeSource> for SourceIdentity {
    fn from(s: &YoutubeSource) -> Self {
        Self {
            version: s.version,
            provider: s.provider.clone(),
            key: s.key.clone(),
            video_id: s.video_id.clone(),
            url: s.url.clone(),
            title: s.title.clone(),
            duration_ms: s.duration_ms,
            subtitle_track: s.subtitle_track.clone(),
            subtitle_language: s.subtitle_language.clone(),
            subtitle_kind: s.subtitle_kind.clone(),
            subtitle_sha256: s.subtitle_sha256.clone(),
            audio: s.audio.clone(),
        }
    }
}
impl SourceIdentity {
    pub fn validate(&self) -> Result<(), String> {
        let full = YoutubeSource {
            version: self.version,
            provider: self.provider.clone(),
            key: self.key.clone(),
            video_id: self.video_id.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            duration_ms: self.duration_ms,
            subtitle_track: self.subtitle_track.clone(),
            subtitle_language: self.subtitle_language.clone(),
            subtitle_kind: self.subtitle_kind.clone(),
            subtitle_sha256: self.subtitle_sha256.clone(),
            audio: self.audio.clone(),
            cues: vec![Cue {
                id: 0,
                start_ms: 0,
                end_ms: 1,
                text: String::new(),
            }],
        };
        full.validate()
    }
}
#[derive(Serialize)]
pub struct SourceSummary {
    pub key: String,
    pub video_id: String,
    pub provider: String,
    pub title: String,
    pub audio: Option<AudioTrack>,
}
impl From<YoutubeSource> for SourceSummary {
    fn from(s: YoutubeSource) -> Self {
        Self {
            key: s.key,
            provider: s.provider,
            video_id: s.video_id,
            title: s.title,
            audio: s.audio,
        }
    }
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for column in ["media_source", "media_identity"] {
        let exists: bool = conn
            .prepare("PRAGMA table_info(files)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|s| s == column);
        if !exists {
            conn.execute(&format!("ALTER TABLE files ADD COLUMN {column} TEXT"), [])?;
        }
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS files_media_identity ON files(media_identity);
    CREATE TABLE IF NOT EXISTS source_media(source_key TEXT PRIMARY KEY, source_json TEXT NOT NULL, asset_id TEXT, status TEXT NOT NULL DEFAULT 'missing', error TEXT, manifest_json TEXT, updated_at INTEGER NOT NULL) STRICT;")
}
pub(super) fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("source-media"))
        .map_err(|e| e.to_string())
}
fn asset_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_hash(id) {
        return Err("media_invalid_asset".into());
    }
    let legacy = dir.join(format!("{id}.m4a"));
    let path = if legacy.exists() {
        legacy
    } else {
        let local = dir.join(format!("{id}.wav"));
        if local.exists() {
            local
        } else {
            legacy
        }
    };
    if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("media_invalid_asset".into());
    }
    Ok(path)
}
#[derive(Deserialize)]
pub struct MediaTarget {
    pub source_key: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub segment_id: Option<i64>,
    pub record_id: Option<String>,
}
pub fn target_ref(conn: &Connection, t: &MediaTarget) -> Result<MediaRef, String> {
    let r = match (t.segment_id, t.record_id.as_deref()) {
        (Some(id), None) => segment_reference(conn, id)?,
        (None, Some(id)) => super::saved::get(conn, id)?
            .filter(|r| r.deleted_at.is_none())
            .and_then(|r| r.source.and_then(|s| s.media)),
        _ => return Err("media_invalid_target".into()),
    }
    .ok_or("media_unavailable")?;
    r.validate()?;
    if t.source_key
        .as_deref()
        .is_some_and(|key| key != r.source.key)
        || t.start_ms.is_some_and(|start| start != r.start_ms)
        || t.end_ms.is_some_and(|end| end != r.end_ms)
    {
        return Err("media_source_changed".into());
    }
    Ok(r)
}
#[derive(Serialize)]
pub struct MediaStatus {
    pub status: String,
    pub error: Option<String>,
    pub asset_id: Option<String>,
}
pub fn status(conn: &Connection, dir: &Path, r: &MediaRef) -> Result<MediaStatus, String> {
    r.validate()?;
    let row: Option<(String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT status,error,asset_id FROM source_media WHERE source_key=?1",
            [&r.source.key],
            |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (mut status, error, asset_id) = row.unwrap_or(("missing".into(), None, None));
    if status == "ready"
        && !asset_id.as_deref().is_some_and(|id| {
            asset_path(dir, id).is_ok_and(|p| p.is_file())
                && r.expected_sha256.as_deref().is_none_or(|h| h == id)
        })
    {
        status = "missing".into();
    }
    Ok(MediaStatus {
        status,
        error,
        asset_id,
    })
}
#[tauri::command]
pub fn source_media_status(
    app: tauri::AppHandle,
    state: State<DbState>,
    target: MediaTarget,
) -> Result<MediaStatus, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    status(&c, &root(&app)?, &target_ref(&c, &target)?)
}
#[derive(Serialize)]
pub struct Playback {
    pub path: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub duration_ms: i64,
    pub asset_id: String,
}
pub fn resolve(conn: &Connection, dir: &Path, r: &MediaRef) -> Result<Playback, String> {
    let s = status(conn, dir, r)?;
    if s.status != "ready" {
        return Err("media_missing".into());
    }
    let id = s.asset_id.ok_or("media_missing")?;
    let path = asset_path(dir, &id)?;
    // Verify content on each resolve. Hashing streams, never transports the track as base64.
    if file_digest(&path)? != id {
        conn.execute("UPDATE source_media SET status='failed',error='media_checksum_mismatch' WHERE source_key=?1",[&r.source.key]).map_err(|e|e.to_string())?;
        return Err("media_checksum_mismatch".into());
    }
    let manifest: String = conn
        .query_row(
            "SELECT manifest_json FROM source_media WHERE source_key=?1",
            [&r.source.key],
            |x| x.get(0),
        )
        .map_err(|_| "media_missing")?;
    let m: Manifest = serde_json::from_str(&manifest).map_err(|_| "media_invalid_manifest")?;
    let end_ms = r.end_ms.min(m.duration_ms);
    if r.end_ms > m.duration_ms + MAX_CUE_TAIL_MS || r.start_ms < 0 || r.start_ms >= end_ms {
        return Err("media_invalid_range".into());
    }
    Ok(Playback {
        path: path.to_string_lossy().into(),
        start_ms: r.start_ms,
        end_ms,
        duration_ms: m.duration_ms,
        asset_id: id,
    })
}
#[tauri::command]
pub async fn resolve_source_media(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    target: MediaTarget,
) -> Result<Playback, String> {
    let shared = state.conn.clone();
    let dir = root(&app)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let c = shared.lock().map_err(|e| e.to_string())?;
        resolve(&c, &dir, &target_ref(&c, &target)?)
    })
    .await
    .map_err(|e| e.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&result.path)
        .map_err(|_| "media_scope")?;
    Ok(result)
}
pub(super) fn file_digest(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|_| "media_missing")?;
    let mut hash = Sha256::new();
    let mut b = [0u8; 65536];
    loop {
        let n = file.read(&mut b).map_err(|_| "media_io")?;
        if n == 0 {
            break;
        }
        hash.update(&b[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
#[derive(Serialize, Deserialize)]
pub struct Manifest {
    pub video_id: String,
    pub format_id: String,
    pub language: String,
    pub language_basis: String,
    pub codec: String,
    pub bytes: u64,
    pub duration_ms: i64,
    pub start_ms: i64,
    pub offset_ms: i64,
    pub sha256: String,
}
fn size(dir: &Path) -> u64 {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}
fn protected(conn: &Connection, key: &str) -> Result<bool, String> {
    // Keep all tombstones, undo receipts and conflicts. No fragile reference counter.
    conn.query_row("SELECT EXISTS(SELECT 1 FROM saved_records WHERE instr(snapshot_json,?1)>0 UNION ALL SELECT 1 FROM saved_actions WHERE instr(COALESCE(before_json,''),?1)>0 UNION ALL SELECT 1 FROM sync_conflicts WHERE instr(COALESCE(local_value,'')||COALESCE(remote_value,''),?1)>0)",[key],|r|r.get(0)).map_err(|e|e.to_string())
}
pub(super) struct Temp(pub(super) PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
pub(super) struct LocalAttachment {
    pub(super) source: YoutubeSource,
    manifest: Manifest,
    staged: PathBuf,
    destination: PathBuf,
}

impl LocalAttachment {
    #[cfg(all(target_os = "macos", not(feature = "apple-store")))]
    pub(super) fn youtube(
        source: &YoutubeSource,
        path: &Path,
        duration_ms: i64,
    ) -> Result<Self, String> {
        let invalid = "material_download_failed";
        source.validate().map_err(|_| invalid)?;
        let track = source
            .audio
            .as_ref()
            .filter(|_| source.provider == "youtube")
            .ok_or(invalid)?;
        let bytes = path.metadata().map_err(|_| invalid)?.len();
        if !(1..=MAX_BYTES).contains(&bytes)
            || duration_ms <= 0
            || duration_ms.abs_diff(source.duration_ms) > 5_000
        {
            return Err(invalid.into());
        }
        let sha256 = file_digest(path).map_err(|_| invalid)?;
        let dir = path.parent().and_then(Path::parent).ok_or(invalid)?;
        Ok(Self {
            source: source.clone(),
            staged: path.to_owned(),
            destination: dir.join(format!("{sha256}.m4a")),
            manifest: Manifest {
                video_id: source.video_id.clone(),
                format_id: track.format_id.clone(),
                language: track.language.clone(),
                language_basis: track.language_basis.clone(),
                codec: "aac".into(),
                bytes,
                duration_ms,
                start_ms: 0,
                offset_ms: 0,
                sha256,
            },
        })
    }

    pub(super) fn new(
        input: &super::materials::MaterialInput,
        path: &Path,
        duration_ms: i64,
        media_hash: String,
    ) -> Result<Self, String> {
        let invalid = "material_package_audio";
        let track = AudioTrack {
            format_id: "pcm_s16le".into(),
            language: "und".into(),
            language_basis: "provided_file".into(),
        };
        let mut cues: Vec<_> = input
            .segments
            .iter()
            .filter_map(|segment| {
                let start_ms = youtube::parse_ts(segment.start_time.as_deref()?)?;
                let end_ms = youtube::parse_ts(segment.end_time.as_deref()?)?;
                (start_ms >= 0
                    && start_ms < duration_ms
                    && end_ms > start_ms
                    && end_ms <= duration_ms + MAX_CUE_TAIL_MS)
                    .then(|| Cue {
                        id: 0,
                        start_ms,
                        end_ms,
                        text: segment.en_text.clone(),
                    })
            })
            .collect();
        cues.sort_by_key(|cue| cue.start_ms);
        for (index, cue) in cues.iter_mut().enumerate() {
            cue.id = index as u32;
        }
        let mut source = YoutubeSource {
            version: 1,
            provider: "local".into(),
            key: String::new(),
            video_id: media_hash,
            url: String::new(),
            title: input.name.clone(),
            duration_ms,
            subtitle_track: "local".into(),
            subtitle_language: "en".into(),
            subtitle_kind: "original".into(),
            subtitle_sha256: digest(input.content.as_bytes()),
            cues,
            audio: Some(track.clone()),
        };
        source.key = source.identity();
        source.validate().map_err(|_| invalid)?;
        let sha256 = file_digest(path).map_err(|_| invalid)?;
        let dir = path.parent().and_then(Path::parent).ok_or(invalid)?;
        let destination = dir.join(format!("{sha256}.wav"));
        let manifest = Manifest {
            video_id: source.video_id.clone(),
            format_id: track.format_id,
            language: track.language,
            language_basis: track.language_basis,
            codec: "pcm_s16le".into(),
            bytes: path.metadata().map_err(|_| invalid)?.len(),
            duration_ms,
            start_ms: 0,
            offset_ms: 0,
            sha256,
        };
        Ok(Self {
            source,
            manifest,
            staged: path.to_owned(),
            destination,
        })
    }

    pub(super) fn install(&self, tx: &Connection) -> Result<(), String> {
        let invalid = "material_package_audio";
        let dir = self.destination.parent().ok_or(invalid)?;
        if !self.destination.exists() && size(dir) + self.manifest.bytes > TOTAL_BYTES {
            return Err(invalid.into());
        }
        if std::fs::symlink_metadata(&self.destination).is_ok_and(|entry| !entry.is_file()) {
            return Err(invalid.into());
        }
        if !self.destination.is_file()
            || file_digest(&self.destination).as_deref() != Ok(&self.manifest.sha256)
        {
            if self.source.provider == "youtube" {
                // Keep the validated draft available if the database transaction
                // fails after installing the file and the user retries.
                let staged_asset = self.staged.with_file_name("asset.m4a");
                let _ = std::fs::remove_file(&staged_asset);
                std::fs::hard_link(&self.staged, &staged_asset).map_err(|_| invalid)?;
                std::fs::rename(staged_asset, &self.destination).map_err(|_| invalid)?;
            } else {
                std::fs::rename(&self.staged, &self.destination).map_err(|_| invalid)?;
            }
        }
        tx.execute(
            "INSERT INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at)
             VALUES(?1,?2,?3,'ready',?4,?5) ON CONFLICT(source_key) DO UPDATE
             SET asset_id=excluded.asset_id,status='ready',error=NULL,manifest_json=excluded.manifest_json,updated_at=excluded.updated_at",
            params![self.source.key, serde_json::to_string(&self.source).map_err(|_| invalid)?,
                self.manifest.sha256, serde_json::to_string(&self.manifest).map_err(|_| invalid)?,
                super::saved::now_ms()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn recover(conn: &Connection, dir: &Path) -> Result<(), String> {
    // Startup only, before accepting jobs. Partial directories never count as ready.
    std::fs::create_dir_all(dir).map_err(|_| "media_io")?;
    for e in std::fs::read_dir(dir).map_err(|_| "media_io")?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with(".part-") {
            let _ = std::fs::remove_dir_all(e.path());
        } else if let Some(id) = name
            .strip_suffix(".m4a")
            .or_else(|| name.strip_suffix(".wav"))
            .filter(|id| valid_hash(id))
        {
            let bound: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM source_media WHERE asset_id=?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !bound && !protected(conn, id)? {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    conn.execute("UPDATE source_media SET status='missing',error='media_interrupted' WHERE status='preparing'",[]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn initialize(app: &tauri::AppHandle, conn: &Connection) -> Result<(), String> {
    recover(conn, &root(app)?)
}

/// Validate portable file rows at every ingress; no device-local manifest is imported.
/// A local audio attachment can accompany an extracted subtitle document.
pub(crate) fn local_document_media(
    raw: Option<&str>,
    key: Option<&str>,
) -> Result<Option<YoutubeSource>, String> {
    match (raw, key) {
        (None, None) => Ok(None),
        (Some(raw), Some(key)) => {
            let source: YoutubeSource =
                serde_json::from_str(raw).map_err(|_| "material_invalid_document")?;
            source.validate()?;
            if source.provider != "local" || source.key != key {
                return Err("material_invalid_document".into());
            }
            Ok(Some(source))
        }
        _ => Err("material_invalid_document".into()),
    }
}

pub fn validate_file_source(
    row: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    match (
        row.get("media_source").and_then(|v| v.as_str()),
        row.get("media_identity").and_then(|v| v.as_str()),
    ) {
        (None, None) => Ok(()),
        (Some(json), Some(key)) => {
            let source: YoutubeSource =
                serde_json::from_str(json).map_err(|_| "media_invalid_source")?;
            source.validate()?;
            if source.key != key {
                return Err("media_invalid_source".into());
            }
            Ok(())
        }
        _ => Err("media_invalid_source".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::{import::SegmentInput, materials, saved};
    use super::*;
    fn db() -> (tempfile::TempDir, Connection) {
        let d = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&d.path().join("test.db")).unwrap();
        (d, c)
    }
    pub(super) fn source(video: &str) -> YoutubeSource {
        let t = youtube::SubtitleTrack {
            lang: "en".into(),
            is_auto: false,
            language: "en".into(),
            source: SubtitleSource::Manual,
            source_language: Some("en".into()),
        };
        source_from_subtitles(video,&t,"1\n00:00:01,000 --> 00:00:03,000\nHello world. Another sentence.\n\n2\n00:00:04,000 --> 00:00:06,000\nWe take off.\n",&serde_json::json!({"title":"fixture","duration":8,"formats":[{"vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","format_id":"140","language":"en"}]})).unwrap()
    }

    #[test]
    fn subtitle_serialization_can_change_but_recovery_cannot_change_timecodes_or_words() {
        let mut prior = source("abcdefghijk");
        prior.audio = None;
        prior.key = prior.identity();
        let reference = reference_for_segment(
            &prior,
            "Hello world.",
            Some("00:00:01,000"),
            Some("00:00:03,000"),
            None,
        )
        .unwrap();
        assert!(reference.validate().is_ok());
        let regenerated = "1\n00:00:01,000 --> 00:00:03,000\nHello world.\nAnother sentence.\n\n2\n00:00:04,000 --> 00:00:06,000\nWe take off.\n";
        assert!(matches_subtitle_revision(&prior, regenerated));
        assert!(!matches_subtitle_revision(
            &prior,
            &regenerated.replace("04,000", "04,020")
        ));
        assert!(!matches_subtitle_revision(
            &prior,
            &regenerated.replace("We take", "I take")
        ));
    }

    fn input(op: &str, video: &str) -> materials::MaterialInput {
        materials::MaterialInput {
            tag_ids: Vec::new(),
            new_tag_names: Vec::new(),
            document: None,
            normalized_kind: None,
            operation_id: op.into(),
            name: "fixture.srt".into(),
            content: "1\n00:00:01,000 --> 00:00:03,000\nHello world. Another sentence.\n".into(),
            segments: vec![
                SegmentInput {
                    index: 0,
                    en_text: "Hello world.".into(),
                    zh_text: None,
                    start_time: Some("00:00:01.000".into()),
                    end_time: Some("00:00:03.000".into()),
                },
                SegmentInput {
                    index: 1,
                    en_text: "Another sentence.".into(),
                    zh_text: None,
                    start_time: Some("00:00:01.000".into()),
                    end_time: Some("00:00:03.000".into()),
                },
            ],
            source: Some(source(video)),
        }
    }
    fn save(c: &Connection, segment: i64, op: &str) -> saved::SavedRecord {
        saved::mutate(
            c,
            op,
            &saved::Mutation::Save {
                input: saved::SaveInput {
                    segment_id: segment,
                    expression: "Hello".into(),
                    start_offset: 0,
                    end_offset: 5,
                    explanation: Some("personal note".into()),
                    explanation_source: "personal".into(),
                    dictionary_snapshot: None,
                    dictionary_reference: None,
                },
            },
        )
        .unwrap()
        .record
    }
    #[test]
    fn identities_split_cue_pending_save_and_deleted_material_are_independent() {
        let (d, c) = db();
        let a = materials::import_material(&c, &input("a", "abcdefghijk")).unwrap();
        let b = materials::import_material(&c, &input("b", "lmnopqrstuv")).unwrap();
        assert_ne!(a.file_id, b.file_id);
        assert_eq!(
            materials::import_material(&c, &input("repeat", "abcdefghijk"))
                .unwrap()
                .file_id,
            a.file_id
        );
        let opened = materials::open(&c, a.file_id).unwrap();
        let r = segment_reference(&c, opened.segments[0].id)
            .unwrap()
            .unwrap();
        let second = segment_reference(&c, opened.segments[1].id)
            .unwrap()
            .unwrap();
        assert_eq!((r.start_ms, r.end_ms), (1000, 3000));
        assert_eq!(r.cue_ids, second.cue_ids);
        assert_eq!(r.precision, "cue");
        let saved = save(&c, opened.segments[0].id, "save-a");
        let other = save(
            &c,
            materials::open(&c, b.file_id).unwrap().segments[0].id,
            "save-b",
        );
        assert_ne!(saved.record_id, other.record_id);
        assert!(protected(&c, &r.source.key).unwrap());
        c.execute("DELETE FROM files WHERE id=?1", [a.file_id])
            .unwrap();
        assert!(saved::resolve_source(&c, &saved.record_id)
            .unwrap()
            .is_none());
        assert_eq!(
            saved::get(&c, &saved.record_id)
                .unwrap()
                .unwrap()
                .source
                .unwrap()
                .media
                .unwrap(),
            r
        );
        assert_eq!(status(&c, d.path(), &r).unwrap().status, "missing");
        let tomb = saved::mutate(
            &c,
            "remove",
            &saved::Mutation::Remove {
                record_id: saved.record_id.clone(),
                expected_revision: saved.revision.clone(),
            },
        )
        .unwrap()
        .record;
        assert!(tomb.deleted_at.is_some());
        assert!(protected(&c, &r.source.key).unwrap());
        saved::undo(&c, "remove").unwrap();
        assert!(protected(&c, &r.source.key).unwrap());
        assert_eq!(
            saved::get(&c, &saved.record_id)
                .unwrap()
                .unwrap()
                .explanation,
            saved.explanation
        );
    }
    #[test]
    fn backup_portable_source_survives_clean_device_and_old_backup() {
        let (d, c) = db();
        let a = materials::import_material(&c, &input("a", "abcdefghijk")).unwrap();
        let segment = materials::open(&c, a.file_id).unwrap().segments[0].id;
        let saved = save(&c, segment, "save");
        let backup = super::super::export::backup_payload(&c).unwrap();
        assert_eq!(backup.schema_version, 10);
        let json = serde_json::to_string(&backup).unwrap();
        assert!(!json.contains("manifest_json"));
        assert!(!json.contains("source-media/"));
        let target = crate::db::init_db(&d.path().join("target.db")).unwrap();
        super::super::export::restore_backup(&target, &backup).unwrap();
        let r = saved::get(&target, &saved.record_id)
            .unwrap()
            .unwrap()
            .source
            .unwrap()
            .media
            .unwrap();
        assert_eq!(status(&target, d.path(), &r).unwrap().status, "missing");
        assert_eq!(
            materials::open(&target, a.file_id)
                .unwrap()
                .media_refs
                .len(),
            2
        );
        let mut old = serde_json::to_value(&backup).unwrap();
        old["schema_version"] = serde_json::json!(9);
        for row in old["data"]["files"].as_array_mut().unwrap() {
            row.as_object_mut().unwrap().remove("media_source");
            row.as_object_mut().unwrap().remove("media_identity");
        }
        old["data"]["saved_records"] = serde_json::json!([]);
        old["data"]["saved_actions"] = serde_json::json!([]);
        let old = serde_json::from_value(old).unwrap();
        super::super::export::restore_backup(&target, &old).unwrap();
        assert!(materials::open(&target, a.file_id)
            .unwrap()
            .media_refs
            .is_empty());
        migrate(&target).unwrap();
        migrate(&target).unwrap();
    }
    #[test]
    fn invalid_times_mismatch_translation_and_paths_fail_closed() {
        let (_d, c) = db();
        let mut s = source("abcdefghijk");
        s.cues[0].start_ms = -1;
        assert!(s.validate().is_err());
        s = source("abcdefghijk");
        s.cues[0].end_ms = 99999;
        assert!(s.validate().is_err());
        s = source("abcdefghijk");
        s.cues[0].end_ms = 0;
        assert!(s.validate().is_err());
        assert!(asset_path(Path::new("/tmp"), "../../etc/passwd").is_err());
        let mut i = input("mismatch", "abcdefghijk");
        i.segments[0].en_text = "Unrelated phrase.".into();
        let a = materials::import_material(&c, &i).unwrap();
        assert!(
            segment_reference(&c, materials::open(&c, a.file_id).unwrap().segments[0].id)
                .unwrap()
                .is_none()
        );
        let t = youtube::SubtitleTrack {
            lang: "en".into(),
            is_auto: true,
            language: "en".into(),
            source: SubtitleSource::Translated,
            source_language: Some("ja".into()),
        };
        let m = serde_json::json!({"duration":8,"formats":[{"vcodec":"none","ext":"m4a","acodec":"mp4a.40.2","format_id":"140","language":"ja"}]});
        assert!(source_from_subtitles(
            "abcdefghijk",
            &t,
            "1\n00:00:01,000 --> 00:00:02,000\nHello.\n",
            &m
        )
        .unwrap()
        .audio
        .is_none());
    }
    #[test]
    fn crash_partial_cleanup_and_tampered_asset() {
        let (d, c) = db();
        let dir = d.path().join("audio");
        std::fs::create_dir_all(dir.join(".part-test")).unwrap();
        std::fs::write(dir.join(".part-test/data.part"), b"partial").unwrap();
        let r = MediaRef {
            source: source("abcdefghijk"),
            cue_ids: vec![0],
            start_ms: 1000,
            end_ms: 3000,
            precision: "cue".into(),
            padding_before_ms: 0,
            padding_after_ms: 0,
            expected_sha256: None,
        };
        c.execute("INSERT INTO source_media(source_key,source_json,status,updated_at) VALUES(?1,?2,'preparing',0)",params![r.source.key,serde_json::to_string(&r.source).unwrap()]).unwrap();
        recover(&c, &dir).unwrap();
        assert!(!dir.join(".part-test").exists());
        assert_eq!(status(&c, &dir, &r).unwrap().status, "missing");
        let id = digest(b"expected");
        std::fs::write(asset_path(&dir, &id).unwrap(), b"corrupt").unwrap();
        c.execute(
            "UPDATE source_media SET asset_id=?2,status='ready' WHERE source_key=?1",
            params![r.source.key, id],
        )
        .unwrap();
        assert_eq!(
            resolve(&c, &dir, &r).err().unwrap(),
            "media_checksum_mismatch"
        );
    }
}

/// Enrich a portable snapshot at export time without mutating the user's record,
/// revision, text, timing or media version. Pending saves gain the immutable
/// checksum once this device has resolved the source, even after cache eviction.
pub fn portable_saved_value(
    conn: &Connection,
    mut value: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if value.get("kind").and_then(|v| v.as_str()) == Some("remove_group") {
        if let Some(records) = value.get_mut("records").and_then(|v| v.as_array_mut()) {
            for record in records {
                *record = portable_saved_value(conn, record.take())?;
            }
        }
    }
    if let Some(media) = value
        .pointer_mut("/source/media")
        .and_then(|v| v.as_object_mut())
    {
        if media.get("expected_sha256").is_none_or(|v| v.is_null()) {
            if let Some(key) = media
                .get("source")
                .and_then(|s| s.get("key"))
                .and_then(|k| k.as_str())
            {
                let hash: Option<String> = conn
                    .query_row(
                        "SELECT asset_id FROM source_media WHERE source_key=?1",
                        [key],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .flatten();
                if let Some(hash) = hash.filter(|h| valid_hash(h)) {
                    media.insert("expected_sha256".into(), serde_json::json!(hash));
                }
            }
        }
    }
    Ok(value)
}

#[cfg(test)]
mod alignment_and_portability_tests {
    use super::super::{import::SegmentInput, materials, saved};
    use super::*;
    #[test]
    fn overlapping_cues_gaps_rolling_duplicates_and_numeric_text_keep_actual_boundaries() {
        let d = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&d.path().join("a.db")).unwrap();
        let mut source = super::tests::source("abcdefghijk");
        source.cues = vec![
            Cue {
                id: 0,
                start_ms: 1000,
                end_ms: 3000,
                text: "We are".into(),
            },
            Cue {
                id: 1,
                start_ms: 2000,
                end_ms: 4000,
                text: "We are here.".into(),
            },
            Cue {
                id: 2,
                start_ms: 5000,
                end_ms: 6000,
                text: "2026".into(),
            },
        ];
        source.key = source.identity();
        let segments = vec![
            ("We are", "00:00:01.000", "00:00:03.000"),
            ("We are here.", "00:00:02.000", "00:00:04.000"),
            ("We are here.", "00:00:01.000", "00:00:04.000"),
            ("2026", "00:00:05.000", "00:00:06.000"),
            ("We are here.", "00:00:03.000", "00:00:04.500"),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (text, start, end))| SegmentInput {
            index: i as i32,
            en_text: text.into(),
            zh_text: None,
            start_time: Some(start.into()),
            end_time: Some(end.into()),
        })
        .collect();
        let a = materials::import_material(
            &c,
            &materials::MaterialInput {
                tag_ids: Vec::new(),
                new_tag_names: Vec::new(),
                document: None,
                normalized_kind: None,
                operation_id: "overlap".into(),
                name: "a.srt".into(),
                content: "1\n00:00:01,000 --> 00:00:06,000\nWe are here. 2026".into(),
                segments,
                source: Some(source),
            },
        )
        .unwrap();
        let opened = materials::open(&c, a.file_id).unwrap();
        assert_eq!(opened.media_refs.len(), 4);
        let stale:MediaTarget=serde_json::from_value(serde_json::json!({"segment_id":opened.segments[0].id,"source_key":"wrong-source","start_ms":1000,"end_ms":3000})).unwrap();
        assert_eq!(
            target_ref(&c, &stale).err().unwrap(),
            "media_source_changed"
        );
        for (i, ids) in [(0, vec![0]), (1, vec![1]), (2, vec![0, 1]), (3, vec![2])] {
            assert_eq!(opened.media_refs[&opened.segments[i].id].cue_ids, ids);
        }
        assert!(!opened.media_refs.contains_key(&opened.segments[4].id));
    }
    #[test]
    fn late_audio_checksum_is_exported_without_mutating_saved_revision_or_personal_content() {
        let d = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&d.path().join("a.db")).unwrap();
        let source = super::tests::source("abcdefghijk");
        let a = materials::import_material(
            &c,
            &materials::MaterialInput {
                tag_ids: Vec::new(),
                new_tag_names: Vec::new(),
                document: None,
                normalized_kind: None,
                operation_id: "a".into(),
                name: "a.srt".into(),
                content: "1\n00:00:01,000 --> 00:00:03,000\nHello world.".into(),
                segments: vec![SegmentInput {
                    index: 0,
                    en_text: "Hello world.".into(),
                    zh_text: None,
                    start_time: Some("00:00:01.000".into()),
                    end_time: Some("00:00:03.000".into()),
                }],
                source: Some(source.clone()),
            },
        )
        .unwrap();
        let before = saved::mutate(
            &c,
            "save",
            &saved::Mutation::Save {
                input: saved::SaveInput {
                    segment_id: materials::open(&c, a.file_id).unwrap().segments[0].id,
                    expression: "Hello".into(),
                    start_offset: 0,
                    end_offset: 5,
                    explanation: Some("my meaning".into()),
                    explanation_source: "personal".into(),
                    dictionary_snapshot: None,
                    dictionary_reference: None,
                },
            },
        )
        .unwrap()
        .record;
        let hash = digest(b"immutable audio");
        c.execute("INSERT INTO source_media(source_key,source_json,asset_id,status,updated_at) VALUES(?1,?2,?3,'ready',0)",params![source.key,serde_json::to_string(&source).unwrap(),hash]).unwrap();
        let backup = super::super::export::backup_payload(&c).unwrap();
        let json = backup.data.saved_records[0]["snapshot_json"]
            .as_str()
            .unwrap();
        let exported: saved::SavedRecord = serde_json::from_str(json).unwrap();
        assert_eq!(
            exported.source.unwrap().media.unwrap().expected_sha256,
            Some(hash)
        );
        assert_eq!(saved::get(&c, &before.record_id).unwrap().unwrap(), before);
        assert_eq!(exported.revision, before.revision);
        assert_eq!(exported.explanation, before.explanation);
    }
}

/// Full-track access is granted only through a real reading material/segment
/// relationship. Saved contexts continue to resolve their frozen clip ranges.
#[derive(Deserialize)]
pub struct ReadingMediaTarget {
    pub file_id: i64,
    pub segment_id: i64,
    pub source_key: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReadingAnchor {
    pub index: usize,
    pub segment_id: i64,
    pub start_ms: i64,
    pub end_ms: i64,
}
#[derive(Serialize)]
pub struct ReadingPlayback {
    pub path: String,
    pub file_id: i64,
    pub source_key: String,
    pub asset_id: String,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub anchors: Vec<ReadingAnchor>,
}
pub fn resolve_reading(
    conn: &Connection,
    dir: &Path,
    target: &ReadingMediaTarget,
) -> Result<ReadingPlayback, String> {
    let json:String=conn.query_row("SELECT f.media_source FROM files f JOIN segments s ON s.file_id=f.id WHERE f.id=?1 AND s.id=?2 AND f.language='en' AND f.type='srt' AND f.media_identity=?3",params![target.file_id,target.segment_id,target.source_key],|r|r.get(0)).map_err(|_|"media_reading_source_missing")?;
    let source: YoutubeSource = serde_json::from_str(&json).map_err(|_| "media_invalid_source")?;
    source.validate()?;
    if source.key != target.source_key {
        return Err("media_source_changed".into());
    }
    let reference = segment_reference(conn, target.segment_id)?.ok_or("media_no_reading_start")?;
    let playback = resolve(conn, dir, &reference)?; // Exactly one file checksum for this session.
    let mut stmt=conn.prepare("SELECT id,en_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num,id").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([target.file_id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut anchors = Vec::new();
    let mut previous_start = -1;
    for (index, (id, text, start, end)) in rows.into_iter().enumerate() {
        if let Some(r) = reference_for_segment(
            &source,
            &text,
            start.as_deref(),
            end.as_deref(),
            Some(playback.asset_id.clone()),
        ) {
            let end_ms = r.end_ms.min(playback.duration_ms);
            if r.start_ms < previous_start
                || r.start_ms >= end_ms
                || r.end_ms > playback.duration_ms + MAX_CUE_TAIL_MS
            {
                continue;
            }
            previous_start = r.start_ms;
            anchors.push(ReadingAnchor {
                index,
                segment_id: id,
                start_ms: r.start_ms,
                end_ms,
            });
        }
    }
    if !anchors.iter().any(|a| a.segment_id == target.segment_id) {
        return Err("media_no_reading_start".into());
    }
    Ok(ReadingPlayback {
        path: playback.path,
        file_id: target.file_id,
        source_key: source.key,
        asset_id: playback.asset_id,
        start_ms: reference.start_ms,
        duration_ms: playback.duration_ms,
        anchors,
    })
}
#[tauri::command]
pub async fn resolve_reading_media(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    request: ReadingMediaTarget,
) -> Result<ReadingPlayback, String> {
    let shared = state.conn.clone();
    let dir = root(&app)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let c = shared.lock().map_err(|e| e.to_string())?;
        resolve_reading(&c, &dir, &request)
    })
    .await
    .map_err(|e| e.to_string())??;
    app.asset_protocol_scope()
        .allow_file(&result.path)
        .map_err(|_| "media_scope")?;
    Ok(result)
}

#[cfg(test)]
mod continuous_contract_tests {
    use super::*;
    use crate::commands::{import::SegmentInput, materials};
    #[test]
    #[ignore = "real public subtitle fixture, explicit /tmp input"]
    fn real_import_lookup_video_tail_keeps_source() {
        let metadata: serde_json::Value = serde_json::from_slice(
            &std::fs::read("/tmp/lexicue-import-lookup-qa/metadata.raw.json").unwrap(),
        )
        .unwrap();
        let content =
            std::fs::read_to_string("/tmp/lexicue-import-lookup-qa/1jvROYdM9gc.en-orig.srt")
                .unwrap();
        let track = youtube::SubtitleTrack {
            lang: "en-orig".into(),
            language: "en".into(),
            is_auto: true,
            source: SubtitleSource::Original,
            source_language: Some("en".into()),
        };
        let source = source_from_subtitles("1jvROYdM9gc", &track, &content, &metadata);
        println!(
            "real subtitle: sha={}, cues={}, max_end={}, duration={}",
            digest(content.as_bytes()),
            youtube::parse_srt(&content).len(),
            youtube::parse_srt(&content)
                .iter()
                .map(|c| c.end_ms)
                .max()
                .unwrap(),
            metadata["duration"]
        );
        assert!(
            source.is_some(),
            "a real 2.32 second caption tail must not erase the whole source"
        );
    }
    #[test]
    fn whole_track_requires_material_membership_and_preserves_saved_clip_limits() {
        let d = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&d.path().join("db")).unwrap();
        let source = super::tests::source("abcdefghijk");
        let input = materials::MaterialInput {
            tag_ids: Vec::new(),
            new_tag_names: Vec::new(),
            document: None,
            normalized_kind: None,
            operation_id: "reading".into(),
            name: "reading.srt".into(),
            content: "1\n00:00:01,000 --> 00:00:03,000\nHello world.\n".into(),
            source: Some(source.clone()),
            segments: vec![
                SegmentInput {
                    index: 0,
                    en_text: "Hello world.".into(),
                    zh_text: None,
                    start_time: Some("00:00:01.000".into()),
                    end_time: Some("00:00:03.000".into()),
                },
                SegmentInput {
                    index: 1,
                    en_text: "We take off.".into(),
                    zh_text: None,
                    start_time: Some("00:00:04.000".into()),
                    end_time: Some("00:00:06.000".into()),
                },
            ],
        };
        let file = materials::import_material(&c, &input).unwrap().file_id;
        let opened = materials::open(&c, file).unwrap();
        let id = opened.segments[1].id;
        let bytes = b"contract-only asset bytes";
        let hash = digest(bytes);
        std::fs::write(asset_path(d.path(), &hash).unwrap(), bytes).unwrap();
        let manifest = Manifest {
            video_id: source.video_id.clone(),
            format_id: "140".into(),
            language: "en".into(),
            language_basis: "metadata".into(),
            codec: "aac".into(),
            bytes: bytes.len() as u64,
            duration_ms: 8000,
            start_ms: 0,
            offset_ms: 0,
            sha256: hash.clone(),
        };
        c.execute("INSERT INTO source_media(source_key,source_json,asset_id,status,manifest_json,updated_at) VALUES(?1,?2,?3,'ready',?4,0)",params![source.key,serde_json::to_string(&source).unwrap(),hash,serde_json::to_string(&manifest).unwrap()]).unwrap();
        let full = resolve_reading(
            &c,
            d.path(),
            &ReadingMediaTarget {
                file_id: file,
                segment_id: id,
                source_key: source.key.clone(),
            },
        )
        .unwrap();
        assert_eq!(full.start_ms, 4000);
        assert_eq!(full.duration_ms, 8000);
        assert_eq!(full.anchors.len(), 2);
        let clip = resolve(&c, d.path(), &segment_reference(&c, id).unwrap().unwrap()).unwrap();
        assert_eq!(clip.end_ms, 6000);
        assert!(resolve_reading(
            &c,
            d.path(),
            &ReadingMediaTarget {
                file_id: file + 1,
                segment_id: id,
                source_key: source.key.clone()
            }
        )
        .is_err());
        assert!(resolve_reading(
            &c,
            d.path(),
            &ReadingMediaTarget {
                file_id: file,
                segment_id: id,
                source_key: "wrong".into()
            }
        )
        .is_err());
        assert!(serde_json::from_value::<ReadingMediaTarget>(
            serde_json::json!({"record_id":"saved-only","source_key":source.key})
        )
        .is_err());
    }
}
