//! Versioned, portable provenance for local documents. Offsets are UTF-16 units,
//! matching JavaScript selections; SQLite/Rust never interpret them as bytes.
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum DocumentSelection {
    All,
    Pages { start: u32, end: u32 },
    Chapters { section_ids: Vec<String> },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentLocation {
    pub section_id: String,
    pub paragraph: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cue_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentSection {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spine_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentBlock {
    pub id: String,
    pub section_id: String,
    pub kind: String,
    pub text: String,
    pub locations: Vec<DocumentLocation>,
    pub start_utf16: usize,
    pub end_utf16: usize,
    pub segment_indices: Vec<i32>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocumentSource {
    pub schema_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ContentOrigin>,
    pub original_format: String,
    pub display_name: String,
    pub source_sha256: String,
    pub extractor_version: String,
    pub normalized_sha256: String,
    pub offset_unit: String,
    pub extraction_status: String,
    pub warnings: Vec<String>,
    pub sections: Vec<DocumentSection>,
    pub blocks: Vec<DocumentBlock>,
    pub selection: DocumentSelection,
    pub identity: String,
}
/// A saved expression needs the location and source identity, not the whole book.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedDocumentSource {
    pub schema_version: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ContentOrigin>,
    pub identity: String,
    pub original_format: String,
    pub source_sha256: String,
    pub extractor_version: String,
    pub selection: DocumentSelection,
    pub locations: Vec<DocumentLocation>,
    pub section_title: String,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn portable(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && !value.chars().any(char::is_control)
        && !value.starts_with('/')
        && !value.starts_with('\\')
        && !value.contains(":\\")
        && !value.contains(":/")
        && !value.to_ascii_lowercase().contains("file:")
        && !value.to_ascii_lowercase().contains("content:")
}
impl DocumentSelection {
    fn validate(&self, format: &str) -> bool {
        match self {
            Self::All => true,
            Self::Pages { start, end } => {
                format == "pdf" && *start > 0 && *end >= *start && *end <= 2000
            }
            Self::Chapters { section_ids } => {
                format == "epub"
                    && !section_ids.is_empty()
                    && section_ids.len() <= 10000
                    && section_ids.iter().all(|s| portable(s, 1024))
                    && section_ids.iter().collect::<HashSet<_>>().len() == section_ids.len()
            }
        }
    }
}
impl DocumentLocation {
    fn validate(&self) -> bool {
        portable(&self.section_id, 1024)
            && self.paragraph > 0
            && self.page.is_none_or(|p| p > 0 && p <= 2000)
            && self.spine_id.as_deref().is_none_or(|s| portable(s, 2048))
            && self
                .cue_id
                .as_deref()
                .is_none_or(|s| !s.chars().any(|c| c == '\0') && s.len() <= 2048)
            && match (self.start_ms, self.end_ms) {
                (None, None) => true,
                (Some(a), Some(b)) => b >= a && b < 31_536_000_000,
                _ => false,
            }
    }
}
impl DocumentSource {
    pub fn validate(&self, content: &str, segment_count: Option<usize>) -> Result<(), String> {
        let invalid = || "material_invalid_document".to_string();
        if !valid_origin(
            self.schema_version,
            &self.original_format,
            self.origin.as_ref(),
        ) || !matches!(
            self.original_format.as_str(),
            "pdf" | "docx" | "epub" | "md" | "txt" | "srt" | "vtt" | "clipboard" | "webpage"
        ) || !valid_title(&self.display_name)
            || (self.origin.is_none()
                && (!portable(&self.display_name, 1024) || self.display_name.contains(['/', '\\'])))
            || self
                .origin
                .as_ref()
                .is_some_and(|o| o.title() != self.display_name)
            || !portable(&self.extractor_version, 256)
            || !hash(&self.source_sha256)
            || !hash(&self.normalized_sha256)
            || !hash(&self.identity)
            || self.normalized_sha256 != digest(content.as_bytes())
            || self.offset_unit != "utf16"
            || !matches!(self.extraction_status.as_str(), "complete" | "partial")
            || !self.selection.validate(&self.original_format)
            || self.sections.is_empty()
            || self.sections.len() > 10000
            || self.blocks.is_empty()
            || self.blocks.len() > 150000
            || self.warnings.len() > 2048
            || self
                .warnings
                .iter()
                .any(|s| s.len() > 4096 || s.contains('\0'))
        {
            return Err(invalid());
        }
        if let Some(origin) = &self.origin {
            let expected = match origin {
                ContentOrigin::Clipboard { .. } => digest(content.as_bytes()),
                ContentOrigin::Webpage {
                    submitted_url,
                    final_url,
                    ..
                } => digest(format!("{submitted_url}\n{final_url}\n{content}").as_bytes()),
            };
            if expected != self.source_sha256 {
                return Err(invalid());
            }
        }
        let identity = digest(
            format!(
                "{}\n{}\n{}",
                self.source_sha256,
                self.original_format,
                serde_json::to_string(&self.selection).map_err(|_| invalid())?
            )
            .as_bytes(),
        );
        if self.identity != identity {
            return Err(invalid());
        }
        let mut section_ids = HashSet::new();
        for s in &self.sections {
            if !portable(&s.id, 1024)
                || !section_ids.insert(s.id.as_str())
                || s.title.len() > 4096
                || s.title.contains('\0')
                || s.page.is_some_and(|p| p == 0 || p > 2000)
                || s.spine_id.as_deref().is_some_and(|s| !portable(s, 2048))
            {
                return Err(invalid());
            }
        }
        let units: Vec<u16> = content.encode_utf16().collect();
        let mut ids = HashSet::new();
        let mut covered = HashSet::new();
        let mut previous = 0;
        for block in &self.blocks {
            if !portable(&block.id, 1024)
                || !ids.insert(block.id.as_str())
                || !section_ids.contains(block.section_id.as_str())
                || !matches!(
                    block.kind.as_str(),
                    "heading" | "paragraph" | "list" | "quote" | "table" | "code"
                )
                || block.start_utf16 < previous
                || block.end_utf16 < block.start_utf16
                || block.end_utf16 > units.len()
                || block.locations.is_empty()
                || block.locations.len() > 32
                || block
                    .locations
                    .iter()
                    .any(|l| !l.validate() || !section_ids.contains(l.section_id.as_str()))
                || units
                    .get(block.start_utf16..block.end_utf16)
                    .and_then(|s| String::from_utf16(s).ok())
                    .as_deref()
                    != Some(&block.text)
                || match &self.selection {
                    DocumentSelection::Pages { start, end } => block
                        .locations
                        .iter()
                        .any(|l| l.page.is_none_or(|p| p < *start || p > *end)),
                    DocumentSelection::Chapters { section_ids } => {
                        !section_ids.contains(&block.section_id)
                    }
                    DocumentSelection::All => false,
                }
                || block.segment_indices.iter().any(|i| {
                    *i < 0 || segment_count.is_some_and(|n| *i as usize >= n) || !covered.insert(*i)
                })
            {
                return Err(invalid());
            }
            previous = block.end_utf16;
        }
        if segment_count.is_some_and(|n| covered.len() != n) {
            return Err(invalid());
        }
        Ok(())
    }
    pub fn saved_location(&self, index: i32) -> Option<SavedDocumentSource> {
        let block = self
            .blocks
            .iter()
            .find(|b| b.segment_indices.contains(&index))?;
        Some(SavedDocumentSource {
            schema_version: self.schema_version,
            origin: self.origin.clone(),
            identity: self.identity.clone(),
            original_format: self.original_format.clone(),
            source_sha256: self.source_sha256.clone(),
            extractor_version: self.extractor_version.clone(),
            selection: self.selection.clone(),
            locations: block.locations.clone(),
            section_title: self
                .sections
                .iter()
                .find(|s| s.id == block.section_id)
                .map(|s| s.title.clone())
                .unwrap_or_default(),
        })
    }
}
impl SavedDocumentSource {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_origin(
            self.schema_version,
            &self.original_format,
            self.origin.as_ref(),
        ) || !hash(&self.identity)
            || !hash(&self.source_sha256)
            || !matches!(
                self.original_format.as_str(),
                "pdf" | "docx" | "epub" | "md" | "txt" | "srt" | "vtt" | "clipboard" | "webpage"
            )
            || !portable(&self.extractor_version, 256)
            || !self.selection.validate(&self.original_format)
            || self.identity
                != digest(
                    format!(
                        "{}\n{}\n{}",
                        self.source_sha256,
                        self.original_format,
                        serde_json::to_string(&self.selection)
                            .map_err(|_| "material_invalid_document")?
                    )
                    .as_bytes(),
                )
            || self.locations.is_empty()
            || self.locations.len() > 32
            || self.locations.iter().any(|l| !l.validate())
            || self.section_title.len() > 4096
            || self.section_title.contains('\0')
        {
            return Err("material_invalid_document".into());
        }
        Ok(())
    }
}
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for col in ["document_source", "document_identity"] {
        let exists = conn
            .prepare("PRAGMA table_info(files)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(Result::ok)
            .any(|s| s == col);
        if !exists {
            conn.execute(&format!("ALTER TABLE files ADD COLUMN {col} TEXT"), [])?;
        }
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS files_document_identity ON files(document_identity)",
    )
}
pub fn segment_source(
    conn: &Connection,
    segment_id: i64,
) -> Result<Option<SavedDocumentSource>, String> {
    let value:Option<(Option<String>,i32)>=conn.query_row("SELECT f.document_source,s.index_num FROM segments s JOIN files f ON f.id=s.file_id WHERE s.id=?1",[segment_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    value
        .and_then(|(raw, index)| raw.map(|raw| (raw, index)))
        .map(|(raw, index)| {
            serde_json::from_str::<DocumentSource>(&raw)
                .map(|s| s.saved_location(index))
                .map_err(|_| "material_invalid_document".into())
        })
        .transpose()
        .map(Option::flatten)
}
pub fn validate_file_source(
    row: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if ["document_source", "document_identity"]
        .iter()
        .any(|k| row.get(*k).is_some_and(|v| !v.is_null() && !v.is_string()))
    {
        return Err("material_invalid_document".into());
    }
    match (
        row.get("document_source").and_then(|v| v.as_str()),
        row.get("document_identity").and_then(|v| v.as_str()),
    ) {
        (None, None) => Ok(()),
        (Some(raw), Some(identity)) => {
            if row.get("media_identity").is_some_and(|v| !v.is_null())
                || row.get("media_source").is_some_and(|v| !v.is_null())
            {
                return Err("material_invalid_document".into());
            }
            let s: DocumentSource =
                serde_json::from_str(raw).map_err(|_| "material_invalid_document")?;
            s.validate(
                row.get("content")
                    .and_then(|v| v.as_str())
                    .ok_or("material_invalid_document")?,
                None,
            )?;
            if s.identity != identity
                || row.get("type").and_then(|v| v.as_str())
                    != Some(if matches!(s.original_format.as_str(), "srt" | "vtt") {
                        "srt"
                    } else {
                        "txt"
                    })
                || row.get("name").and_then(|v| v.as_str()) != Some(&s.display_name)
                || row.get("language").and_then(|v| v.as_str()) != Some("en")
            {
                return Err("material_invalid_document".into());
            }
            Ok(())
        }
        _ => Err("material_invalid_document".into()),
    }
}

/// Detect actual document payloads, including historical undo/conflict JSON
/// strings. Null columns added by a migration do not raise the wire version.
pub fn contains_document(value: &serde_json::Value) -> bool {
    fn visit(value: &serde_json::Value, depth: u8) -> bool {
        if depth > 32 {
            return false;
        }
        match value {
            serde_json::Value::Object(map) => map.iter().any(|(k, v)| {
                if (k == "document_source" && v.is_string()) || (k == "document" && v.is_object()) {
                    return true;
                }
                if matches!(
                    k.as_str(),
                    "snapshot_json" | "before_json" | "local_value" | "remote_value"
                ) {
                    if let Some(raw) = v.as_str().filter(|s| s.contains("document")) {
                        return serde_json::from_str::<serde_json::Value>(raw)
                            .is_ok_and(|v| visit(&v, depth + 1));
                    }
                }
                visit(v, depth + 1)
            }),
            serde_json::Value::Array(items) => items.iter().any(|v| visit(v, depth + 1)),
            _ => false,
        }
    }
    visit(value, 0)
}

pub fn protect_existing(
    conn: &Connection,
    id: i64,
    row: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let (identity, content): (Option<String>, String) = conn
        .query_row(
            "SELECT document_identity,content FROM files WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some(identity) = identity {
        if row.get("document_identity").and_then(|v| v.as_str()) != Some(&identity)
            || row.get("content").and_then(|v| v.as_str()) != Some(&content)
        {
            return Err("material_document_version_conflict".into());
        }
    }
    Ok(())
}
pub fn validate_database_sources(conn: &Connection) -> Result<(), String> {
    let rows = conn
        .prepare("SELECT id,document_source,content FROM files WHERE document_source IS NOT NULL")
        .map_err(|e| e.to_string())?
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    for (id, raw, content) in rows {
        let source: DocumentSource =
            serde_json::from_str(&raw).map_err(|_| "material_invalid_document")?;
        let segments=conn.prepare("SELECT index_num,en_text,zh_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num,id").map_err(|e|e.to_string())?.query_map([id],|r|Ok(super::import::SegmentInput{index:r.get(0)?,en_text:r.get(1)?,zh_text:r.get(2)?,start_time:r.get(3)?,end_time:r.get(4)?})).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        source.validate(&content, Some(segments.len()))?;
        if segments
            .iter()
            .enumerate()
            .any(|(i, s)| s.index != i as i32)
        {
            return Err("material_invalid_document".into());
        }
        source.validate_segment_text(&segments)?;
    }
    Ok(())
}

impl DocumentSource {
    /// Check the segment-to-block association at the native boundary. The
    /// extractor may normalize whitespace and separate standalone Chinese
    /// explanation lines; it may not point unrelated English at a location.
    pub fn validate_segment_text(
        &self,
        segments: &[super::import::SegmentInput],
    ) -> Result<(), String> {
        use std::sync::OnceLock;
        static HAN: OnceLock<regex::Regex> = OnceLock::new();
        static KANA: OnceLock<regex::Regex> = OnceLock::new();
        let han = HAN.get_or_init(|| regex::Regex::new(r"\p{Han}").unwrap());
        let kana = KANA.get_or_init(|| regex::Regex::new(r"[\p{Hiragana}\p{Katakana}]").unwrap());
        fn compact(s: &str) -> String {
            s.chars().filter(|c| !c.is_whitespace()).collect()
        }
        fn time(ms: u64) -> String {
            format!(
                "{:02}:{:02}:{:02}.{:03}",
                ms / 3_600_000,
                (ms / 60_000) % 60,
                (ms / 1000) % 60,
                ms % 1000
            )
        }
        for block in &self.blocks {
            let english = block
                .text
                .lines()
                .filter(|line| {
                    !(han.is_match(line)
                        && !line.chars().any(|c| c.is_ascii_alphabetic())
                        && !kana.is_match(line))
                })
                .collect::<Vec<_>>()
                .join(" ");
            let body = compact(&english);
            let mut cursor = 0;
            for &i in &block.segment_indices {
                let segment = segments
                    .get(i as usize)
                    .ok_or("material_invalid_document")?;
                let text = compact(&segment.en_text);
                let at = body
                    .get(cursor..)
                    .and_then(|s| s.find(&text))
                    .ok_or("material_invalid_document")?;
                cursor += at + text.len();
                if matches!(self.original_format.as_str(), "srt" | "vtt") {
                    let start = block
                        .locations
                        .iter()
                        .filter_map(|l| l.start_ms)
                        .min()
                        .ok_or("material_invalid_document")?;
                    let end = block
                        .locations
                        .iter()
                        .filter_map(|l| l.end_ms)
                        .max()
                        .ok_or("material_invalid_document")?;
                    if segment.start_time.as_deref() != Some(&time(start))
                        || segment.end_time.as_deref() != Some(&time(end))
                    {
                        return Err("material_invalid_document".into());
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ContentOrigin {
    Clipboard {
        title: String,
    },
    Webpage {
        title: String,
        submitted_url: String,
        final_url: String,
        fetched_at: i64,
    },
}
fn valid_title(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 1024 && !value.chars().any(char::is_control)
}
impl ContentOrigin {
    fn title(&self) -> &str {
        match self {
            Self::Clipboard { title } | Self::Webpage { title, .. } => title,
        }
    }
}
fn valid_origin(version: u8, format: &str, origin: Option<&ContentOrigin>) -> bool {
    match origin {
        None => version == 1 && !matches!(format, "clipboard" | "webpage"),
        Some(ContentOrigin::Clipboard { title }) => {
            version == 2 && format == "clipboard" && valid_title(title)
        }
        Some(ContentOrigin::Webpage {
            title,
            submitted_url,
            final_url,
            fetched_at,
        }) => {
            version == 2
                && format == "webpage"
                && valid_title(title)
                && *fetched_at > 0
                && [submitted_url, final_url].iter().all(|u| {
                    u.len() <= 8192
                        && !u.chars().any(char::is_control)
                        && super::webpage::public_url(u).is_ok()
                })
        }
    }
}
/// Include snapshots nested inside undo/conflict JSON in the minimum wire version.
pub fn contains_content_origin(value: &serde_json::Value) -> bool {
    fn visit(v: &serde_json::Value, depth: u8) -> bool {
        if depth > 32 {
            return false;
        }
        match v {
            serde_json::Value::Object(m) => {
                m.get("origin").is_some_and(|o| o.is_object())
                    && m.get("schema_version").and_then(|v| v.as_u64()) == Some(2)
                    || m.values().any(|v| visit(v, depth + 1))
            }
            serde_json::Value::Array(a) => a.iter().any(|v| visit(v, depth + 1)),
            serde_json::Value::String(s) if s.contains("origin") => {
                serde_json::from_str::<serde_json::Value>(s).is_ok_and(|v| visit(&v, depth + 1))
            }
            _ => false,
        }
    }
    visit(value, 0)
}
