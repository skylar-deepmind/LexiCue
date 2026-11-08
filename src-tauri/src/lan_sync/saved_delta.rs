//! App adapter for the authenticated transport's saved-record messages.
use super::MergeBackup;
use crate::commands::saved::{self, SavedRecord};
use lexicue_lan_journal::session::SavedStore;
pub use lexicue_lan_journal::{session, Route};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use uuid::Uuid;

pub fn prepare(database: &Path, operation: Uuid, route: &Route) -> Result<MergeBackup, String> {
    super::prepare_library(database, operation, route)
}

pub struct ReaderSaves;

// Older records may omit fields that now have defaults. Never forward extra
// fields that the typed reader would silently discard at the destination.
fn only_known_fields(input: &serde_json::Value, typed: &serde_json::Value) -> bool {
    match (input, typed) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => a
            .iter()
            .all(|(k, v)| b.get(k).is_some_and(|t| only_known_fields(v, t))),
        (serde_json::Value::Array(a), serde_json::Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(v, t)| only_known_fields(v, t))
        }
        _ => input == typed,
    }
}

fn portable_name(name: &str) -> bool {
    let s = name.trim().to_ascii_lowercase();
    !s.starts_with(['/', '\\'])
        && !s.starts_with("~/")
        && !s.starts_with("file:")
        && !s.starts_with("content:")
        && !(s.as_bytes().get(1) == Some(&b':')
            && matches!(s.as_bytes().get(2), Some(b'/' | b'\\')))
}

fn portable_origin(origin: &crate::commands::document_source::ContentOrigin) -> bool {
    use crate::commands::document_source::ContentOrigin::*;
    match origin {
        Clipboard { title } => portable_name(title),
        Webpage {
            title,
            submitted_url,
            final_url,
            ..
        } => {
            portable_name(title)
                && [submitted_url, final_url].into_iter().all(|url| {
                    !url.contains(['?', '@', '#'])
                        && crate::commands::webpage::public_url(url).is_ok()
                })
        }
    }
}
fn portable_saved_context(record: &SavedRecord) -> bool {
    let Some(source) = &record.source else {
        return false;
    };
    let keys = serde_json::from_str::<Vec<serde_json::Value>>(&record.source_key);
    let Ok(keys) = keys else {
        return false;
    };
    // The domain components in both the current key and the legacy hash-based
    // tuple are opaque IDs. A URI or filesystem path cannot be a domain.
    let key_ok = keys.iter().all(|part| match part {
        serde_json::Value::Number(n) => n.as_u64().is_some(),
        serde_json::Value::String(id) => {
            !id.is_empty()
                && id.len() <= 160
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        }
        _ => false,
    });
    let document_ok = source.document.as_ref().is_none_or(|doc| {
        portable_name(&doc.section_title) && doc.origin.as_ref().is_none_or(portable_origin)
    });
    key_ok
        && document_ok
        && portable_name(&source.content_hash)
        && source.media_identity.as_deref().is_none_or(portable_name)
}

impl SavedStore for ReaderSaves {
    fn validate_source(
        &self,
        source: &lexicue_lan_journal::material::Source,
        body: &str,
        kind: &str,
        segments: usize,
    ) -> Result<(), String> {
        let row = serde_json::to_value(source)
            .map_err(|e| e.to_string())?
            .as_object()
            .cloned()
            .ok_or("invalid material source")?;
        crate::commands::source_media::validate_file_source(&row)?;
        if source.document_source.is_some() != source.document_identity.is_some() {
            return Err("material_invalid_document".into());
        }
        if let Some(raw) = &source.document_source {
            let doc: crate::commands::document_source::DocumentSource =
                serde_json::from_str(raw).map_err(|e| e.to_string())?;
            doc.validate(body, Some(segments))?;
            let expected_kind = if matches!(doc.original_format.as_str(), "srt" | "vtt") {
                "srt"
            } else {
                "txt"
            };
            if source.document_identity.as_deref() != Some(doc.identity.as_str())
                || source.media_source.is_some()
                || kind != expected_kind
                || !doc.warnings.is_empty()
                || !portable_name(&doc.display_name)
                || doc.origin.as_ref().is_some_and(|o| !portable_origin(o))
                || doc.sections.iter().any(|s| !portable_name(&s.title))
            {
                return Err("non-portable document source".into());
            }
        }
        if let Some(raw) = &source.media_source {
            let media: crate::commands::source_media::YoutubeSource =
                serde_json::from_str(raw).map_err(|e| e.to_string())?;
            if !portable_name(&media.title)
                || !portable_name(&media.subtitle_track)
                || !portable_name(&media.subtitle_language)
            {
                return Err("non-portable media title".into());
            }
        }
        Ok(())
    }
    fn validate(&self, json: &str) -> Result<(), String> {
        let record: SavedRecord = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let legacy = match record.origin.as_str() {
            "legacy" => {
                #[derive(serde::Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Legacy {
                    kind: String,
                    notes: Vec<String>,
                }
                let old: Legacy =
                    serde_json::from_value(record.legacy.clone().ok_or("missing historical note")?)
                        .map_err(|e| e.to_string())?;
                if !matches!(old.kind.as_str(), "word" | "phrase")
                    || old.notes.iter().any(|s| s.is_empty())
                {
                    return Err("invalid historical save".into());
                }
                Some(old.kind)
            }
            "reader" if record.legacy.is_none() => None,
            _ => return Err("invalid LAN reader save".into()),
        };
        if let Some(source) = &record.source {
            if !portable_saved_context(&record)
                || !portable_name(&source.file_name)
                || source
                    .youtube
                    .as_ref()
                    .is_some_and(|m| !portable_name(&m.title))
                || source
                    .media
                    .as_ref()
                    .is_some_and(|m| !portable_name(&m.source.title))
            {
                return Err("non-portable saved source name".into());
            }
        } else if !legacy.is_some_and(|kind| {
            record.source_key == format!("legacy:{kind}:{}", saved::normalize(&record.expression))
        }) {
            return Err("missing reader context".into());
        }
        let input = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let typed = serde_json::to_value(&record).map_err(|e| e.to_string())?;
        if !only_known_fields(&input, &typed) {
            return Err("unsupported saved snapshot fields".into());
        }
        saved::validate_record(&record)
    }

    fn write(&self, tx: &Connection, json: &str) -> Result<(), String> {
        let mut record: SavedRecord = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let existing = saved::get(tx, &record.record_id)?;
        if record.origin == "legacy" {
            if let Some(mut original) = existing
                .as_ref()
                .and_then(|r| r.legacy.clone())
                .filter(|m| m.get("legacy_id").is_some())
            {
                original["lan_notes"] = record
                    .legacy
                    .as_ref()
                    .and_then(|v| v.get("notes"))
                    .cloned()
                    .unwrap_or_default();
                record.legacy = Some(original);
            }
        }
        // Notes and deletions do not change frozen source context. Retain the
        // private local descriptor when the wire deliberately omitted it.
        if let (Some(old), Some(new)) = (
            existing.as_ref().and_then(|r| r.source.as_ref()),
            record.source.as_mut(),
        ) {
            if !portable_name(&old.file_name) && new.file_name == "Imported material" {
                new.file_name = old.file_name.clone();
            }
            if new.document.is_none()
                && old
                    .document
                    .as_ref()
                    .and_then(|d| d.origin.as_ref())
                    .is_some_and(|o| !portable_origin(o))
            {
                new.document = old.document.clone();
            }
        }
        if existing.as_ref() == Some(&record) {
            return Ok(());
        }
        // Preserve local sync identity bookkeeping without emitting a second
        // event into either LAN or the retired cloud queue. The caller owns
        // the entire SQLite transaction, including restoring this guard.
        let old: Option<String> = tx
            .query_row(
                "SELECT value FROM sync_runtime WHERE key='applying'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO sync_runtime(key,value) VALUES('applying','1') ON CONFLICT(key) DO UPDATE SET value='1'",[]).map_err(|e|e.to_string())?;
        let local = saved::write_record(tx, &record)?;
        tx.execute(
            "INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at)
            VALUES('saved_records',?1,?2,?3,?4) ON CONFLICT(table_name,local_id) DO UPDATE SET
            updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
            params![
                local,
                record.record_id,
                record.updated_at,
                record.deleted_at
            ],
        )
        .map_err(|e| e.to_string())?;
        if let Some(value) = old {
            tx.execute(
                "UPDATE sync_runtime SET value=?1 WHERE key='applying'",
                [value],
            )
        } else {
            tx.execute("DELETE FROM sync_runtime WHERE key='applying'", [])
        }
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
