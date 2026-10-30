//! Context snapshots are independent of files, vocabulary and review schedules.
//! All user mutations and their retry/undo receipts commit in one transaction.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

use crate::db::DbState;

pub const MIGRATION: &str = "saved-context-v1";

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn normalize(expression: &str) -> String {
    expression
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn identity(expression: &str, source_key: &str) -> String {
    let bytes = serde_json::to_vec(&(normalize(expression), source_key)).unwrap();
    format!("saved-{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedSource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<super::document_source::SavedDocumentSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube: Option<super::source_media::SourceIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<super::source_media::MediaRef>,
    pub content_hash: String,
    pub file_name: String,
    pub segment_index: i64,
    pub start_offset: Option<i64>,
    pub end_offset: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

/// A portable copy of only the chosen dictionary sense. It stays independent
/// of the installed package and of the user's editable explanation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshot {
    pub schema_version: u8,
    pub headword: String,
    pub source: DictionarySnapshotSource,
    pub entry_id: String,
    pub group_id: String,
    pub sense_id: String,
    pub part_of_speech: Option<String>,
    pub meaning: DictionarySnapshotMeaning,
    #[serde(default)]
    pub labels: Vec<DictionarySnapshotLabel>,
    #[serde(default)]
    pub examples: Vec<DictionarySnapshotExample>,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ancestors: Option<Vec<DictionarySnapshotAncestor>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshotAncestor {
    pub source_path: String,
    pub meaning: DictionarySnapshotMeaning,
    pub labels: Vec<DictionarySnapshotLabel>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionaryContentLicense {
    pub name: String,
    pub url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshotSource {
    pub provider: String,
    pub dataset: String,
    pub edition: Option<String>,
    pub release: Option<String>,
    pub adapter_version: String,
    pub entry_key: String,
    pub locator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retrieved_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_channel: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<DictionaryContentLicense>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifications: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshotMeaning {
    pub en: Option<String>,
    pub zh: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshotLabel {
    pub kind: String,
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionarySnapshotExample {
    pub id: String,
    pub english: String,
    pub chinese: Option<String>,
}

fn validate_dictionary_snapshot(snapshot: &DictionarySnapshot) -> Result<(), String> {
    let text = |s: &str| !s.trim().is_empty();
    let optional_text = |s: &Option<String>| s.as_deref().is_none_or(text);
    let source = &snapshot.source;
    // New public metadata is an explicit contract. Old snapshots omit these
    // fields, retaining their exact serialized request and idempotency signature.
    const PUBLIC_SNAPSHOT_ADAPTERS: [&str; 2] =
        ["cambridge-public-v1.0.0", "cambridge-public-v1.1.0"];
    let public_namespace = format!("cambridge:public:{}:", source.adapter_version);
    let public_metadata = source.provider != "wiktionary"
        && (source.access_channel.is_some()
            || source.service_url.is_some()
            || source.received_at.is_some()
            || PUBLIC_SNAPSHOT_ADAPTERS.contains(&source.adapter_version.as_str()));
    if public_metadata
        && (source.provider != "cambridge"
            || source.access_channel.as_deref() != Some("author_public_api")
            || !PUBLIC_SNAPSHOT_ADAPTERS.contains(&source.adapter_version.as_str())
            || source.dataset != "Cambridge Dictionary (author public API)"
            || source.service_url.as_deref() != Some("https://dictionary-api.eliaschen.dev")
            || !source
                .received_at
                .as_deref()
                .is_some_and(super::cambridge::valid_retrieved_at)
            || source.entry_url.is_some()
            || source.retrieved_at.is_some()
            || source.edition.is_some()
            || source.release.is_some()
            || [&snapshot.entry_id, &snapshot.group_id, &snapshot.sense_id]
                .into_iter()
                .any(|id| !id.starts_with(&public_namespace))
            || snapshot
                .examples
                .iter()
                .any(|example| !example.id.starts_with(&public_namespace)))
    {
        return Err("saved_dictionary_snapshot_invalid".into());
    }
    if source.provider == "wiktionary" {
        validate_wiktionary_snapshot(snapshot)?;
    } else if source.content_hash.is_some()
        || source.license.is_some()
        || source.attribution.is_some()
        || source.modifications.is_some()
        || snapshot.source_path.is_some()
        || snapshot.ancestors.is_some()
        || snapshot.content_kind.is_some()
    {
        return Err("saved_dictionary_snapshot_invalid".into());
    }
    if snapshot.schema_version != 1
        || ![
            snapshot.headword.as_str(),
            snapshot.entry_id.as_str(),
            snapshot.group_id.as_str(),
            snapshot.sense_id.as_str(),
            snapshot.source.dataset.as_str(),
            snapshot.source.adapter_version.as_str(),
            snapshot.source.entry_key.as_str(),
        ]
        .iter()
        .all(|s| text(s))
        || !matches!(
            snapshot.source.provider.as_str(),
            "longman" | "cambridge" | "wiktionary"
        )
        || (snapshot.source.provider == "longman" && snapshot.source.release.is_none())
        || !optional_text(&snapshot.source.edition)
        || !optional_text(&snapshot.source.release)
        || !optional_text(&snapshot.source.locator)
        || snapshot.source.entry_url.as_deref().is_some_and(|u| {
            source.provider != "wiktionary" && !super::cambridge::valid_entry_url(u)
        })
        || snapshot
            .source
            .retrieved_at
            .as_deref()
            .is_some_and(|s| !super::cambridge::valid_retrieved_at(s))
        || !optional_text(&snapshot.part_of_speech)
        || !optional_text(&snapshot.meaning.en)
        || !optional_text(&snapshot.meaning.zh)
        || (snapshot.meaning.en.is_none() && snapshot.meaning.zh.is_none())
        || snapshot.labels.len() > 30
        || snapshot.examples.len() > 2
        || snapshot.patterns.len() > 10
        || snapshot
            .labels
            .iter()
            .any(|label| !text(&label.kind) || !text(&label.text))
        || snapshot.examples.iter().any(|example| {
            !text(&example.id) || !text(&example.english) || !optional_text(&example.chinese)
        })
        || snapshot.patterns.iter().any(|pattern| !text(pattern))
        || serde_json::to_vec(snapshot)
            .map_err(|e| e.to_string())?
            .len()
            > 32_768
    {
        return Err("saved_dictionary_snapshot_invalid".into());
    }
    Ok(())
}

/// New providers carry complete attribution in every offline excerpt. Preserve
/// legacy snapshots byte-for-byte by making each extension optional for them.
fn validate_wiktionary_snapshot(snapshot: &DictionarySnapshot) -> Result<(), String> {
    let invalid = || "saved_dictionary_snapshot_invalid".to_string();
    let mut source = serde_json::to_value(&snapshot.source).map_err(|_| invalid())?;
    source["delivery"] = serde_json::json!("cache");
    if !super::free_dictionary::valid_source(&source)
        || !super::free_dictionary::source_identity(
            snapshot.source.entry_url.as_deref().unwrap_or(""),
            &snapshot.headword,
        )
        || snapshot.source.entry_key != snapshot.entry_id
    {
        return Err(invalid());
    }
    let url = reqwest::Url::parse(snapshot.source.entry_url.as_deref().unwrap_or(""))
        .map_err(|_| invalid())?;
    let word = percent_encoding::percent_decode_str(
        url.path().strip_prefix("/wiki/").ok_or_else(invalid)?,
    )
    .decode_utf8()
    .map_err(|_| invalid())?
    .replace('_', " ");
    let namespace = "wiktionary:freedictionaryapi-v1.0.0:";
    let path = regex::Regex::new(r"^/entries/[0-9]+/senses/[0-9]+(?:/subsenses/[0-9]+)*$").unwrap();
    let Some(sense_path) = snapshot.source_path.as_deref() else {
        return Err(invalid());
    };
    let Some(ancestors) = snapshot.ancestors.as_ref() else {
        return Err(invalid());
    };
    if word != snapshot.headword.replace('_', " ")
        || !path.is_match(sense_path)
        || !matches!(
            snapshot.content_kind.as_deref(),
            Some("definition" | "relation")
        )
        || (snapshot.content_kind.as_deref() == Some("definition")
            && super::free_dictionary::relation_only(
                snapshot.meaning.en.as_deref().unwrap_or(""),
                &[],
            ))
        || snapshot.meaning.zh.is_some()
        || snapshot
            .meaning
            .en
            .as_ref()
            .is_none_or(|v| v.trim().is_empty())
        || [&snapshot.entry_id, &snapshot.group_id, &snapshot.sense_id]
            .iter()
            .any(|id| !id.starts_with(namespace))
        || snapshot
            .examples
            .iter()
            .any(|example| !example.id.starts_with(namespace) || example.chinese.is_some())
        || !sense_path.starts_with(&format!(
            "{}/senses/",
            snapshot.source.locator.as_deref().unwrap_or("")
        ))
        || ancestors.len() > 8
        || ancestors.len() != sense_path.matches("/subsenses/").count()
    {
        return Err(invalid());
    }
    let mut previous: Option<&str> = None;
    for (index, ancestor) in ancestors.iter().enumerate() {
        let expected = sense_path
            .split("/subsenses/")
            .take(index + 1)
            .collect::<Vec<_>>()
            .join("/subsenses/");
        if ancestor.source_path != expected
            || !path.is_match(&ancestor.source_path)
            || !sense_path.starts_with(&format!("{}/subsenses/", ancestor.source_path))
            || previous
                .is_some_and(|p| !ancestor.source_path.starts_with(&format!("{p}/subsenses/")))
            || ancestor.meaning.zh.is_some()
            || ancestor
                .meaning
                .en
                .as_ref()
                .is_none_or(|v| v.trim().is_empty() || v.chars().count() > 2000)
            || ancestor.labels.len() > 30
            || ancestor
                .labels
                .iter()
                .any(|l| l.kind.trim().is_empty() || l.text.trim().is_empty())
        {
            return Err(invalid());
        }
        previous = Some(&ancestor.source_path);
    }
    Ok(())
}

/// A bounded excerpt of meanings displayed before saving, never a chosen
/// meaning for the current sentence. Optional for exact old wire compatibility.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DictionaryReference {
    pub schema_version: u8,
    pub kind: String,
    pub headword: String,
    pub senses: Vec<DictionarySnapshot>,
}

fn validate_dictionary_reference(reference: &DictionaryReference) -> Result<(), String> {
    let invalid = || "saved_dictionary_reference_invalid".to_string();
    if reference.schema_version != 1
        || reference.kind != "dictionary_excerpt"
        || reference.headword.trim().is_empty()
        || reference.headword.chars().count() > 256
        || reference.senses.is_empty()
        || reference.senses.len() > 5
        || serde_json::to_vec(reference).map_err(|_| invalid())?.len() > 16_384
    {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::new();
    for sense in &reference.senses {
        validate_dictionary_snapshot(sense).map_err(|_| invalid())?;
        let namespace = format!("{}:", sense.source.provider);
        if (sense.source.provider == "cambridge"
            && sense.source.access_channel.is_none()
            && (sense.source.entry_url.is_none() || sense.source.retrieved_at.is_none()))
            || sense.headword != reference.headword
            || !ids.insert(&sense.sense_id)
            || [&sense.entry_id, &sense.group_id, &sense.sense_id]
                .iter()
                .any(|id| !id.starts_with(&namespace))
            || [&sense.meaning.en, &sense.meaning.zh]
                .into_iter()
                .flatten()
                .any(|text| text.chars().count() > 2000)
        {
            return Err(invalid());
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedRecord {
    pub record_id: String,
    pub expression: String,
    pub normalized_expression: String,
    pub source_key: String,
    pub sentence: Option<String>,
    pub sentence_translation: Option<String>,
    pub source: Option<SavedSource>,
    pub explanation: Option<String>,
    pub explanation_source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dictionary_snapshot: Option<DictionarySnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dictionary_reference: Option<DictionaryReference>,
    pub origin: String,
    /// Preserves every old personal field, including English edits and notes.
    pub legacy: Option<serde_json::Value>,
    /// Unknown legacy save times stay unknown, rather than becoming migration time.
    pub saved_at: Option<i64>,
    pub updated_at: i64,
    pub revision: String,
    /// Only an explicit restore/undo advances this epoch. Delete wins over edits
    /// within an epoch, even if an offline device uploads its edit later.
    pub generation: i64,
    pub deleted_at: Option<i64>,
}

pub fn create_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS saved_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id TEXT NOT NULL UNIQUE,
            normalized_expression TEXT NOT NULL,
            source_key TEXT NOT NULL,
            snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
            saved_at INTEGER,
            updated_at INTEGER NOT NULL,
            revision TEXT NOT NULL,
            generation INTEGER NOT NULL CHECK(generation>=0),
            deleted_at INTEGER,
            UNIQUE(normalized_expression,source_key)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS saved_active_sort ON saved_records(deleted_at,saved_at DESC,record_id);
        CREATE INDEX IF NOT EXISTS saved_expression ON saved_records(normalized_expression,deleted_at);
        CREATE INDEX IF NOT EXISTS saved_active_recall ON saved_records(normalized_expression,saved_at DESC,record_id) WHERE deleted_at IS NULL;
        CREATE TABLE IF NOT EXISTS saved_actions (
            operation_id TEXT PRIMARY KEY,
            request_json TEXT NOT NULL,
            record_id TEXT NOT NULL,
            before_json TEXT,
            after_revision TEXT NOT NULL,
            changed INTEGER NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE IF NOT EXISTS product_migrations (
            migration_key TEXT PRIMARY KEY,
            completed_at INTEGER NOT NULL,
            report_json TEXT NOT NULL
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS saved_sync_insert AFTER INSERT ON saved_records
        WHEN COALESCE((SELECT value FROM sync_runtime WHERE key='applying'),'0') <> '1' BEGIN
            INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at)
            VALUES('saved_records',NEW.id,NEW.record_id,NEW.updated_at,NEW.deleted_at)
            ON CONFLICT(table_name,sync_id) DO UPDATE SET local_id=excluded.local_id,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
            INSERT INTO sync_changes(table_name,sync_id,operation,changed_at)
            VALUES('saved_records',NEW.record_id,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,NEW.updated_at);
        END;
        CREATE TRIGGER IF NOT EXISTS saved_sync_update AFTER UPDATE ON saved_records
        WHEN COALESCE((SELECT value FROM sync_runtime WHERE key='applying'),'0') <> '1' BEGIN
            UPDATE sync_entity_state SET updated_at=NEW.updated_at,deleted_at=NEW.deleted_at WHERE table_name='saved_records' AND local_id=NEW.id;
            INSERT INTO sync_changes(table_name,sync_id,operation,changed_at)
            VALUES('saved_records',NEW.record_id,CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,NEW.updated_at);
        END;",
    ).map_err(|e| e.to_string())
}

pub fn init(conn: &Connection) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    create_tables(&tx)?;
    migrate_legacy(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<SavedRecord>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT snapshot_json FROM saved_records WHERE record_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .transpose()
}

/// Used by backup and the encrypted record protocol; no local FK crosses devices.
pub fn write_record(conn: &Connection, record: &SavedRecord) -> Result<i64, String> {
    if let Some(snapshot) = &record.dictionary_snapshot {
        validate_dictionary_snapshot(snapshot)?;
    }
    if let Some(reference) = &record.dictionary_reference {
        validate_dictionary_reference(reference)?;
    }
    if let Some(origin) = record.source.as_ref().and_then(|s| s.youtube.as_ref()) {
        origin.validate()?;
    }
    if let Some(m) = record.source.as_ref().and_then(|s| s.media.as_ref()) {
        m.validate()?;
    }
    if let Some(source) = record.source.as_ref().filter(|s| s.document.is_some()) {
        source.document.as_ref().unwrap().validate()?;
        if source.media.is_some() || source.media_identity.is_some() || source.youtube.is_some() {
            return Err("invalid_saved_record".into());
        }
    }
    if record.record_id != identity(&record.expression, &record.source_key)
        || record.normalized_expression != normalize(&record.expression)
        || record.generation < 0
        || !matches!(
            record.explanation_source.as_str(),
            "dictionary" | "ai" | "personal" | "unknown"
        )
    {
        return Err("invalid_saved_record".into());
    }
    conn.execute(
        "INSERT INTO saved_records(record_id,normalized_expression,source_key,snapshot_json,saved_at,updated_at,revision,generation,deleted_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(record_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,saved_at=excluded.saved_at,updated_at=excluded.updated_at,revision=excluded.revision,generation=excluded.generation,deleted_at=excluded.deleted_at",
        params![record.record_id,record.normalized_expression,record.source_key,serde_json::to_string(record).map_err(|e|e.to_string())?,record.saved_at,record.updated_at,record.revision,record.generation,record.deleted_at],
    ).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id FROM saved_records WHERE record_id=?1",
        [&record.record_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct SaveInput {
    pub segment_id: i64,
    pub expression: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub explanation: Option<String>,
    pub explanation_source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dictionary_snapshot: Option<DictionarySnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dictionary_reference: Option<DictionaryReference>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
// Short-lived IPC payload; keep the existing input type and serialization contract.
#[allow(clippy::large_enum_variant)]
pub enum Mutation {
    Save {
        input: SaveInput,
    },
    Edit {
        record_id: String,
        expected_revision: String,
        explanation: String,
    },
    Remove {
        record_id: String,
        expected_revision: String,
    },
}

#[derive(Serialize)]
pub struct MutationResult {
    pub record: SavedRecord,
    pub changed: bool,
    pub operation_id: String,
}

fn from_input(conn: &Connection, input: &SaveInput) -> Result<SavedRecord, String> {
    if let Some(reference) = &input.dictionary_reference {
        validate_dictionary_reference(reference)?;
    }
    if let Some(snapshot) = &input.dictionary_snapshot {
        validate_dictionary_snapshot(snapshot)?;
        if input.explanation_source == "dictionary"
            && input.explanation.as_deref()
                != snapshot
                    .meaning
                    .zh
                    .as_deref()
                    .or(snapshot.meaning.en.as_deref())
        {
            return Err("saved_dictionary_selection_mismatch".into());
        }
    }
    type SourceRow = (
        String,
        Option<String>,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
        String,
    );
    let (sentence,translation,hash,name,index,start_time,end_time,language): SourceRow = conn.query_row(
        "SELECT s.en_text,s.zh_text,f.content_hash,f.name,s.index_num,s.start_time,s.end_time,f.language FROM segments s JOIN files f ON f.id=s.file_id WHERE s.id=?1", [input.segment_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
    ).map_err(|_|"saved_source_missing".to_string())?;
    if language != "en" {
        return Err("saved_english_only".into());
    }
    let units: Vec<u16> = sentence.encode_utf16().collect();
    let selection = units
        .get(input.start_offset..input.end_offset)
        .and_then(|slice| String::from_utf16(slice).ok())
        .ok_or("saved_selection_invalid")?;
    let normalized = normalize(&input.expression);
    if normalized.is_empty()
        || normalized.len() > 1000
        || normalize(&selection) != normalized
        || !normalized.chars().any(|c| c.is_ascii_alphabetic())
        || !matches!(
            input.explanation_source.as_str(),
            "dictionary" | "ai" | "personal" | "unknown"
        )
    {
        return Err("saved_selection_invalid".into());
    }
    let start_offset = input.start_offset
        + selection
            .chars()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf16)
            .sum::<usize>();
    let end_offset = input.end_offset
        - selection
            .chars()
            .rev()
            .take_while(|c| c.is_whitespace())
            .map(char::len_utf16)
            .sum::<usize>();
    let media = super::source_media::segment_reference(conn, input.segment_id)?;
    let document = super::document_source::segment_source(conn, input.segment_id)?;
    let (provenance,origin):(Option<String>,Option<String>)=conn.query_row("SELECT f.media_identity,f.media_source FROM segments s JOIN files f ON f.id=s.file_id WHERE s.id=?1",[input.segment_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
    let youtube = origin
        .as_deref()
        .and_then(|j| serde_json::from_str::<super::source_media::YoutubeSource>(j).ok())
        .map(|s| super::source_media::SourceIdentity::from(&s));
    let source_key = if let Some(doc) = &document {
        serde_json::to_string(&(&hash, index, start_offset, &doc.identity)).unwrap()
    } else if let Some(key) = &provenance {
        serde_json::to_string(&(&hash, index, start_offset, key)).unwrap()
    } else {
        serde_json::to_string(&(&hash, index, start_offset)).unwrap()
    };
    Ok(SavedRecord {
        record_id: identity(&input.expression, &source_key),
        expression: input.expression.trim().into(),
        normalized_expression: normalized,
        source_key,
        sentence: Some(sentence),
        sentence_translation: translation,
        source: Some(SavedSource {
            document,
            media,
            media_identity: provenance,
            youtube,
            content_hash: hash,
            file_name: name,
            segment_index: index,
            start_offset: Some(start_offset as i64),
            end_offset: Some(end_offset as i64),
            start_time,
            end_time,
        }),
        explanation: input.explanation.clone(),
        explanation_source: input.explanation_source.clone(),
        dictionary_snapshot: input.dictionary_snapshot.clone(),
        dictionary_reference: input.dictionary_reference.clone(),
        origin: "reader".into(),
        legacy: None,
        saved_at: Some(now_ms()),
        updated_at: now_ms(),
        revision: Uuid::new_v4().to_string(),
        generation: 0,
        deleted_at: None,
    })
}

pub fn mutate(
    conn: &Connection,
    operation_id: &str,
    mutation: &Mutation,
) -> Result<MutationResult, String> {
    if operation_id.is_empty() || operation_id.len() > 200 {
        return Err("saved_operation_invalid".into());
    }
    let request = serde_json::to_string(mutation).map_err(|e| e.to_string())?;
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let receipt: Option<(String, String, bool, bool)> = tx
        .query_row(
            "SELECT request_json,record_id,changed,undone FROM saved_actions WHERE operation_id=?1",
            [operation_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((previous, id, changed, undone)) = receipt {
        if previous != request || undone {
            return Err("saved_operation_conflict".into());
        }
        return Ok(MutationResult {
            record: get(&tx, &id)?.ok_or("saved_missing")?,
            changed,
            operation_id: operation_id.into(),
        });
    }
    let (before, mut record) = match mutation {
        Mutation::Save { input } => {
            let proposed = from_input(&tx, input)?;
            let before = get(&tx, &proposed.record_id)?;
            let mut record = before.clone().unwrap_or(proposed);
            if record.deleted_at.is_some() {
                // A new save intent may include a note the user just typed.
                // Apply only that explicit personal content when restoring;
                // ordinary retries/default saves keep the previous snapshot.
                // Active duplicates remain no-ops, and dictionary references
                // never replace the frozen content during this restoration.
                if input.explanation_source == "personal" {
                    record.explanation = input.explanation.clone();
                    record.explanation_source = "personal".into();
                }
                record.deleted_at = None;
                record.generation += 1;
                record.revision = Uuid::new_v4().to_string();
                record.updated_at = now_ms();
            }
            (before, record)
        }
        Mutation::Edit {
            record_id,
            expected_revision,
            explanation,
        } => {
            let before = get(&tx, record_id)?.ok_or("saved_missing")?;
            if before.deleted_at.is_some() || before.revision != *expected_revision {
                return Err("saved_conflict".into());
            }
            let mut record = before.clone();
            record.explanation = Some(explanation.clone());
            record.explanation_source = "personal".into();
            (Some(before), record)
        }
        Mutation::Remove {
            record_id,
            expected_revision,
        } => {
            let before = get(&tx, record_id)?.ok_or("saved_missing")?;
            if before.revision != *expected_revision {
                return Err("saved_conflict".into());
            }
            let mut record = before.clone();
            if record.deleted_at.is_none() {
                record.deleted_at = Some(now_ms());
            }
            (Some(before), record)
        }
    };
    let changed = before.as_ref() != Some(&record);
    if changed {
        record.revision = Uuid::new_v4().to_string();
        record.updated_at = now_ms();
        write_record(&tx, &record)?;
    }
    tx.execute("INSERT INTO saved_actions(operation_id,request_json,record_id,before_json,after_revision,changed) VALUES(?1,?2,?3,?4,?5,?6)",
        params![operation_id,request,record.record_id,before.map(|v|serde_json::to_string(&v)).transpose().map_err(|e|e.to_string())?,record.revision,changed]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(MutationResult {
        record,
        changed,
        operation_id: operation_id.into(),
    })
}

pub fn undo(conn: &Connection, operation_id: &str) -> Result<SavedRecord, String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (id,before,revision,changed,undone): (String,Option<String>,String,bool,bool)=tx.query_row(
        "SELECT record_id,before_json,after_revision,changed,undone FROM saved_actions WHERE operation_id=?1",[operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)),
    ).map_err(|_|"saved_operation_missing".to_string())?;
    let current = get(&tx, &id)?.ok_or("saved_missing")?;
    if undone || !changed {
        return Ok(current);
    }
    if current.revision != revision {
        return Err("saved_conflict".into());
    }
    let mut record = before
        .map(|v| serde_json::from_str::<SavedRecord>(&v))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| {
            let mut r = current.clone();
            r.deleted_at = Some(now_ms());
            r
        });
    record.generation =
        current.generation + i64::from(current.deleted_at.is_some() && record.deleted_at.is_none());
    record.revision = Uuid::new_v4().to_string();
    record.updated_at = now_ms();
    write_record(&tx, &record)?;
    tx.execute(
        "UPDATE saved_actions SET undone=1 WHERE operation_id=?1",
        [operation_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(record)
}

#[derive(Default, Serialize, Deserialize)]
pub struct MigrationReport {
    pub eligible_words: usize,
    pub eligible_phrases: usize,
    pub saved_contexts: usize,
    pub missing_sources: usize,
    #[serde(default)]
    pub merged_duplicate_positions: usize,
    pub history_only: Vec<HistoryReason>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryReason {
    pub kind: String,
    pub legacy_id: i64,
    pub reason: String,
}

/// Caller owns the transaction. The marker and every snapshot commit together.
/// A repeat never overwrites a personal edit or resurrects a removed snapshot.
pub fn migrate_legacy(conn: &Connection) -> Result<MigrationReport, String> {
    if let Some(raw) = conn
        .query_row(
            "SELECT report_json FROM product_migrations WHERE migration_key=?1",
            [MIGRATION],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        return serde_json::from_str(&raw).map_err(|e| e.to_string());
    }
    let mut report = MigrationReport::default();
    for (kind, table, term, occ, fk) in [
        ("word", "words", "lemma", "occurrences", "word_id"),
        (
            "phrase",
            "phrases",
            "text",
            "phrase_occurrences",
            "phrase_id",
        ),
    ] {
        let extra = if kind == "phrase" {
            "OR i.source='manual' OR EXISTS(SELECT 1 FROM phrase_dictionary_entries d WHERE d.language='en' AND d.text=i.text AND (d.other_senses_edited=1 OR d.other_senses_en_edited=1))"
        } else {
            ""
        };
        let edited = if kind == "phrase" {
            "o.meaning_edited=1 OR o.meaning_en_edited=1"
        } else {
            "o.meaning_edited=1"
        };
        let sql=format!("SELECT i.id,i.{term},i.language,i.definition,(i.status='learning' OR i.definition IS NOT NULL {extra} OR EXISTS(SELECT 1 FROM {occ} o WHERE o.{fk}=i.id AND ({edited}))) FROM {table} i ORDER BY i.id");
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let entries = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, bool>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for entry in entries {
            let (id, expression, language, definition, eligible) =
                entry.map_err(|e| e.to_string())?;
            if language != "en" || !eligible {
                report.history_only.push(HistoryReason {
                    kind: kind.into(),
                    legacy_id: id,
                    reason: if language != "en" {
                        "non_english"
                    } else {
                        "no_active_intent_evidence"
                    }
                    .into(),
                });
                continue;
            }
            if kind == "word" {
                report.eligible_words += 1;
            } else {
                report.eligible_phrases += 1;
            }
            let dictionary = if kind == "phrase" {
                legacy_row(
                    conn,
                    "phrase_dictionary_entries",
                    "text",
                    &expression,
                    Some("en"),
                )?
            } else {
                None
            };
            let contexts = legacy_contexts(conn, occ, fk, id)?;
            let contexts = if contexts.is_empty() {
                vec![None]
            } else {
                contexts.into_iter().map(Some).collect()
            };
            for context in contexts {
                let mut source = None;
                let mut sentence = None;
                let mut translation = None;
                let mut source_key = format!("legacy:{kind}:{}", normalize(&expression));
                if let Some(ref row) = context {
                    sentence = row
                        .get("en_text")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    translation = row
                        .get("zh_text")
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    if let (Some(text), Some(hash), Some(name), Some(index)) = (
                        sentence.as_deref(),
                        row.get("content_hash").and_then(|v| v.as_str()),
                        row.get("file_name").and_then(|v| v.as_str()),
                        row.get("index_num").and_then(|v| v.as_i64()),
                    ) {
                        let position = row.get("position").and_then(|v| v.as_i64()).unwrap_or(-1);
                        let spans = super::english::tokenize_english_spans(text);
                        let span = spans.iter().find(|s| s.position as i64 == position);
                        let start = span.map(|s| s.start as i64);
                        source_key = if let Some(start) = start {
                            serde_json::to_string(&(hash, index, start)).unwrap()
                        } else {
                            serde_json::to_string(&(
                                hash,
                                index,
                                format!("legacy-position:{position}"),
                            ))
                            .unwrap()
                        };
                        source = Some(SavedSource {
                            document: None,
                            media: None,
                            media_identity: None,
                            youtube: None,
                            content_hash: hash.into(),
                            file_name: name.into(),
                            segment_index: index,
                            start_offset: start,
                            end_offset: if kind == "word" {
                                span.map(|s| s.end as i64)
                            } else {
                                None
                            },
                            start_time: json_text(row, "start_time"),
                            end_time: json_text(row, "end_time"),
                        });
                    }
                }
                let meaning = context.as_ref().and_then(|r| json_text(r, "meaning_zh"));
                let edited = context
                    .as_ref()
                    .is_some_and(|r| r.get("meaning_edited").and_then(|v| v.as_i64()) == Some(1));
                let english_edit = context
                    .as_ref()
                    .filter(|r| r.get("meaning_en_edited").and_then(|v| v.as_i64()) == Some(1))
                    .and_then(|r| json_text(r, "meaning_en"));
                let (explanation, explanation_source) = if edited {
                    (meaning.clone(), "personal")
                } else if definition.is_some() {
                    (definition.clone(), "personal")
                } else if english_edit.is_some() {
                    (english_edit, "personal")
                } else if meaning.is_some() {
                    (meaning, "ai")
                } else {
                    (None, "unknown")
                };
                let record = SavedRecord {
                    record_id: identity(&expression, &source_key),
                    expression: expression.clone(),
                    normalized_expression: normalize(&expression),
                    source_key,
                    sentence,
                    sentence_translation: translation,
                    source,
                    explanation,
                    explanation_source: explanation_source.into(),
                    dictionary_snapshot: None,
                    dictionary_reference: None,
                    origin: "legacy".into(),
                    legacy: Some(
                        serde_json::json!({"kind":kind,"legacy_id":id,"definition":definition,"occurrence":context,"dictionary":dictionary}),
                    ),
                    saved_at: None,
                    updated_at: now_ms(),
                    revision: Uuid::new_v4().to_string(),
                    generation: 0,
                    deleted_at: None,
                };
                if record.source.is_none() {
                    report.missing_sources += 1;
                }
                if let Some(mut existing) = get(conn, &record.record_id)? {
                    // Legacy import/analysis could leave two occurrences at one
                    // position. Keep one saved identity and every old edit, even
                    // when the two personal explanations disagree.
                    if existing.origin == "legacy" {
                        if let Some(serde_json::Value::Object(ref mut metadata)) = existing.legacy {
                            metadata
                                .entry("same_position_records")
                                .or_insert_with(|| serde_json::json!([]))
                                .as_array_mut()
                                .ok_or("invalid_legacy_metadata")?
                                .push(record.legacy.clone().unwrap_or_default());
                        }
                        if existing.explanation_source != "personal"
                            && record.explanation_source == "personal"
                        {
                            existing.explanation = record.explanation;
                            existing.explanation_source = record.explanation_source;
                        }
                        write_record(conn, &existing)?;
                    }
                    report.merged_duplicate_positions += 1;
                } else {
                    write_record(conn, &record)?;
                    report.saved_contexts += 1;
                }
            }
        }
    }
    conn.execute(
        "INSERT INTO product_migrations(migration_key,completed_at,report_json) VALUES(?1,?2,?3)",
        params![
            MIGRATION,
            now_ms(),
            serde_json::to_string(&report).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(report)
}

fn json_text(row: &serde_json::Value, key: &str) -> Option<String> {
    row.get(key).and_then(|v| v.as_str()).map(str::to_string)
}
fn row_json(row: &rusqlite::Row<'_>) -> rusqlite::Result<serde_json::Value> {
    let mut value = serde_json::Map::new();
    for i in 0..row.as_ref().column_count() {
        let v: rusqlite::types::Value = row.get(i)?;
        let v = match v {
            rusqlite::types::Value::Integer(v) => serde_json::json!(v),
            rusqlite::types::Value::Real(v) => serde_json::json!(v),
            rusqlite::types::Value::Text(v) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        };
        value.insert(row.as_ref().column_name(i)?.into(), v);
    }
    Ok(serde_json::Value::Object(value))
}
fn legacy_row(
    conn: &Connection,
    table: &str,
    key: &str,
    value: &str,
    language: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    conn.query_row(
        &format!("SELECT * FROM {table} WHERE {key}=?1 AND (?2 IS NULL OR language=?2)"),
        params![value, language],
        row_json,
    )
    .optional()
    .map_err(|e| e.to_string())
}
fn legacy_contexts(
    conn: &Connection,
    table: &str,
    key: &str,
    id: i64,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt=conn.prepare(&format!("SELECT o.*,s.en_text,s.zh_text,s.index_num,s.start_time,s.end_time,f.name AS file_name,f.content_hash FROM {table} o LEFT JOIN segments s ON s.id=o.segment_id LEFT JOIN files f ON f.id=s.file_id WHERE o.{key}=?1 ORDER BY o.id")).map_err(|e|e.to_string())?;
    let rows = stmt.query_map([id], row_json).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

pub fn list(
    conn: &Connection,
    query: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<SavedRecord>, String> {
    let pattern = format!(
        "%{}%",
        normalize(query)
            .replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_")
    );
    let mut stmt=conn.prepare("SELECT snapshot_json FROM saved_records WHERE deleted_at IS NULL AND (normalized_expression LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.explanation') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.sentence') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.source.file_name') LIKE ?1 ESCAPE '!') ORDER BY saved_at IS NULL,saved_at DESC,record_id LIMIT ?2 OFFSET ?3").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![pattern, limit.clamp(1, 1000), offset.max(0)], |r| {
            r.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string()))
        .collect()
}

/// Lightweight rebuildable archive view. Only identity/search projections are
/// read for the full dataset; long snapshots are fetched for returned pages.
#[derive(Clone)]
pub struct ArchiveGroup {
    pub group_id: String,
    pub expression: String,
    pub record_ids: Vec<String>,
    pub latest_saved_at: Option<i64>,
    pub search_hit: bool,
}
pub struct Archive {
    index: std::sync::OnceLock<Vec<String>>,
    catalog: std::sync::Arc<super::longman::RelationCatalog>,
    pub groups: std::collections::BTreeMap<String, ArchiveGroup>,
    aliases: std::collections::BTreeMap<String, std::collections::BTreeSet<String>>,
}
fn compact(expression: &str) -> String {
    expression.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn case_evidence(expression: &str) -> bool {
    expression.chars().any(char::is_uppercase)
}
fn all_caps(expression: &str) -> bool {
    expression.chars().filter(|c| c.is_alphabetic()).count() > 1
        && expression
            .chars()
            .filter(|c| c.is_alphabetic())
            .all(char::is_uppercase)
}
fn archive_sensitive(catalog: &super::longman::RelationCatalog, expression: &str) -> bool {
    (catalog.literal_only() && case_evidence(expression))
        || all_caps(expression)
        || catalog.case_sensitive_identity(expression)
}
fn literal_key(expression: &str, sensitive: bool) -> String {
    format!(
        "{}:{}",
        if sensitive { "case" } else { "fold" },
        if sensitive {
            compact(expression)
        } else {
            normalize(expression)
        }
    )
}
fn group_identity(key: &str) -> String {
    format!("term-{:x}", Sha256::digest(key.as_bytes()))
}
fn alias_key(expression: &str, canonical: &str, sensitive: bool) -> Option<String> {
    // A corrected uppercase headword is not proof that lowercase us means US.
    // Case-sensitive aliases must remain representable by the string index.
    if sensitive
        && (!case_evidence(expression)
            || (normalize(expression) == normalize(canonical)
                && compact(expression) != compact(canonical)))
    {
        return None;
    }
    Some(literal_key(expression, sensitive))
}
impl Archive {
    pub fn resolve(&self, expression: &str) -> Option<&ArchiveGroup> {
        let exact = literal_key(expression, true);
        let folded = literal_key(expression, false);
        // Literal cards remain reachable even when a catalog safely expands
        // another family. Ambiguous spellings never become another family's
        // aliases, and historical reference excerpts cannot authorize one.
        if let Some(group) = self.groups.get(&group_identity(&exact)) {
            return Some(group);
        }
        if let Some(ids) = self.aliases.get(&exact).filter(|ids| ids.len() == 1) {
            return self.groups.get(ids.first()?);
        }
        // A missing uppercase card cannot borrow the lowercase card's history.
        // The source reserves US/May even when only us/may has been saved.
        if (self.catalog.literal_only() && case_evidence(expression))
            || all_caps(expression)
            || self.catalog.case_sensitive_identity(&compact(expression))
        {
            return None;
        }
        if let Some(group) = self.groups.get(&group_identity(&folded)) {
            return Some(group);
        }
        let ids = self.aliases.get(&folded)?;
        if ids.len() != 1 {
            return None;
        }
        self.groups.get(ids.first()?)
    }
    pub fn expressions(&self) -> Vec<String> {
        self.index
            .get_or_init(|| {
                self.aliases
                    .iter()
                    .filter(|&(key, ids)| {
                        ids.len() == 1 || self.groups.contains_key(&group_identity(key))
                    })
                    .map(|(key, _ids)| key.split_once(':').unwrap().1.to_string())
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect()
            })
            .clone()
    }
    pub fn case_exclusions(&self) -> Vec<String> {
        self.catalog.case_exclusions(&self.expressions())
    }
    pub fn literal_only(&self) -> bool {
        self.catalog.literal_only()
    }
}

#[derive(PartialEq, Eq)]
struct ArchiveStamp {
    changes: i64,
    data_version: i64,
}
struct CachedArchive {
    stamp: ArchiveStamp,
    catalog_fingerprint: String,
    archive: std::sync::Arc<Archive>,
    accessed: u64,
}
#[derive(Default)]
struct ArchiveCache {
    entries: std::collections::BTreeMap<String, CachedArchive>,
    clock: u64,
}
static ARCHIVE_CACHE: std::sync::OnceLock<std::sync::Mutex<ArchiveCache>> =
    std::sync::OnceLock::new();

/// The random token belongs to this SQLite connection's TEMP schema, so closing
/// and reopening a connection can never accidentally reuse an old cache entry.
/// Local writes (including sync/restore) change total_changes; commits made by a
/// different connection change data_version. Nothing is persisted or synced.
fn archive_stamp(conn: &Connection) -> Result<(String, ArchiveStamp), String> {
    conn.execute_batch("CREATE TEMP TABLE IF NOT EXISTS lexicue_archive_cache_token(token TEXT PRIMARY KEY NOT NULL)").map_err(|e|e.to_string())?;
    let token = conn
        .query_row(
            "SELECT token FROM temp.lexicue_archive_cache_token LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let token = match token {
        Some(token) => token,
        None => {
            let token = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO temp.lexicue_archive_cache_token(token) VALUES(?1)",
                [&token],
            )
            .map_err(|e| e.to_string())?;
            token
        }
    };
    let changes = conn
        .query_row("SELECT total_changes()", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let data_version = conn
        .pragma_query_value(None, "data_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok((
        token,
        ArchiveStamp {
            changes,
            data_version,
        },
    ))
}

/// Share one immutable derived view between recall, archived lists and context
/// pages. Transaction-local reads bypass caching: rollback is not represented
/// by total_changes and must never leave uncommitted facts in a shared view.
pub fn archive(conn: &Connection, query: &str) -> Result<std::sync::Arc<Archive>, String> {
    archive_with_catalog(conn, query, super::longman::relation_catalog_configured())
}
fn archive_with_catalog(
    conn: &Connection,
    query: &str,
    catalog: std::sync::Arc<super::longman::RelationCatalog>,
) -> Result<std::sync::Arc<Archive>, String> {
    if !query.trim().is_empty() || !conn.is_autocommit() {
        return build_archive(conn, query, &catalog).map(std::sync::Arc::new);
    }
    let (token, stamp) = archive_stamp(conn)?;
    let shared = ARCHIVE_CACHE.get_or_init(|| std::sync::Mutex::new(ArchiveCache::default()));
    {
        let mut cache = shared.lock().map_err(|e| e.to_string())?;
        cache.clock = cache.clock.wrapping_add(1);
        let accessed = cache.clock;
        if let Some(entry) = cache.entries.get_mut(&token) {
            if entry.stamp == stamp && entry.catalog_fingerprint == catalog.fingerprint() {
                entry.accessed = accessed;
                return Ok(entry.archive.clone());
            }
        }
    }
    let archive = std::sync::Arc::new(build_archive(conn, "", &catalog)?);
    let mut cache = shared.lock().map_err(|e| e.to_string())?;
    cache.clock = cache.clock.wrapping_add(1);
    let accessed = cache.clock;
    cache.entries.insert(
        token,
        CachedArchive {
            stamp,
            catalog_fingerprint: catalog.fingerprint().into(),
            archive: archive.clone(),
            accessed,
        },
    );
    // Closed connections leave only bounded, evictable derived data. Existing
    // callers retain their Arc safely if another connection evicts this entry.
    while cache.entries.len() > 16 {
        let oldest = cache
            .entries
            .iter()
            .min_by_key(|(_, entry)| entry.accessed)
            .map(|(token, _)| token.clone())
            .unwrap();
        cache.entries.remove(&oldest);
    }
    Ok(archive)
}
/// The current offline catalog, rather than a saved default headword, proves
/// identity. This is a rebuildable projection: records and their old reference
/// excerpts remain byte-for-byte facts, including after a dictionary change.
fn build_archive(
    conn: &Connection,
    query: &str,
    catalog: &std::sync::Arc<super::longman::RelationCatalog>,
) -> Result<Archive, String> {
    #[derive(Clone)]
    struct Row {
        id: String,
        expression: String,
        saved_at: Option<i64>,
        hit: bool,
    }
    let pattern = format!(
        "%{}%",
        normalize(query)
            .replace('!', "!!")
            .replace('%', "!%")
            .replace('_', "!_")
    );
    let mut stmt = conn.prepare("SELECT record_id,json_extract(snapshot_json,'$.expression'),saved_at,(normalized_expression LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.explanation') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.sentence') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.source.file_name') LIKE ?1 ESCAPE '!' OR json_extract(snapshot_json,'$.dictionary_reference') LIKE ?1 ESCAPE '!') FROM saved_records WHERE deleted_at IS NULL ORDER BY saved_at IS NULL,saved_at DESC,record_id").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([pattern], |r| {
            Ok(Row {
                id: r.get(0)?,
                expression: r.get(1)?,
                saved_at: r.get(2)?,
                hit: r.get::<_, Option<bool>>(3)?.unwrap_or(false),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let mut identities = std::collections::HashMap::new();
    let mut archive = Archive {
        index: Default::default(),
        catalog: catalog.clone(),
        groups: Default::default(),
        aliases: Default::default(),
    };
    for row in rows {
        let display = identities
            .entry(row.expression.clone())
            .or_insert_with(|| {
                let identity = catalog.identity(&row.expression);
                // Keep the existing sentence-capitalization behavior for unknown
                // literals. Source-confirmed proper heads and abbreviations keep
                // their exact case; an excerpt's headword cannot supply evidence.
                if archive_sensitive(catalog, &identity) {
                    identity
                } else {
                    normalize(&identity)
                }
            })
            .clone();
        let key = literal_key(&display, archive_sensitive(catalog, &display));
        let id = group_identity(&key);
        let sensitive = key.starts_with("case:");
        for alias in [&row.expression, &display] {
            if let Some(alias) = alias_key(alias, &display, sensitive) {
                archive.aliases.entry(alias).or_default().insert(id.clone());
            }
        }
        let hit = row.hit || normalize(&display).contains(&normalize(query));
        let group = archive
            .groups
            .entry(id.clone())
            .or_insert_with(|| ArchiveGroup {
                group_id: id,
                expression: display,
                record_ids: vec![],
                latest_saved_at: row.saved_at,
                search_hit: false,
            });
        group.record_ids.push(row.id);
        group.search_hit |= hit;
        group.latest_saved_at = group.latest_saved_at.max(row.saved_at);
    }
    // Expand once per live family, including safe forms never saved before.
    // Deleted contexts cannot grant identities or keep reminders alive. The
    // catalog is independent of any one saved sentence, so removing a former
    // form's last sentence does not unpredictably change the remaining family.
    let query = normalize(query);
    for group in archive.groups.values_mut() {
        let sensitive = archive_sensitive(catalog, &group.expression);
        for form in catalog.safe_forms(&group.expression) {
            if let Some(alias) = alias_key(&form, &group.expression, sensitive) {
                archive
                    .aliases
                    .entry(alias)
                    .or_default()
                    .insert(group.group_id.clone());
                group.search_hit |= normalize(&form).contains(&query);
            }
        }
    }
    Ok(archive)
}
#[derive(Serialize)]
pub struct SavedGroup {
    pub group_id: String,
    pub expression: String,
    pub context_count: usize,
    pub latest_saved_at: Option<i64>,
    pub preview: SavedRecord,
}
#[derive(Serialize)]
pub struct SavedGroupPage {
    pub groups: Vec<SavedGroup>,
    pub total_groups: usize,
    pub total_records: usize,
}
#[derive(Serialize)]
pub struct SavedContextPage {
    pub records: Vec<SavedRecord>,
    pub total: usize,
}
fn preview_text(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let mut result: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() && limit > 0 {
        result.pop();
        result.push('…');
    }
    result
}
/// This clone is a finite list summary. A caller must fetch group_contexts for
/// the original record before editing/removing or showing full personal data.
/// The stored snapshot and all mutation identities remain untouched.
fn group_preview(mut record: SavedRecord) -> SavedRecord {
    record.expression = preview_text(&record.expression, 256);
    record.normalized_expression = preview_text(&record.normalized_expression, 256);
    record.source_key = preview_text(&record.source_key, 512);
    record.revision = preview_text(&record.revision, 128);
    record.origin = preview_text(&record.origin, 32);
    record.explanation = record.explanation.map(|text| preview_text(&text, 300));
    record.sentence = record.sentence.map(|text| preview_text(&text, 300));
    record.sentence_translation = record
        .sentence_translation
        .map(|text| preview_text(&text, 300));
    record.legacy = None;
    record.dictionary_snapshot = None;
    if let Some(source) = &mut record.source {
        source.content_hash = preview_text(&source.content_hash, 128);
        source.file_name = preview_text(&source.file_name, 256);
        source.start_time = source.start_time.take().map(|text| preview_text(&text, 32));
        source.end_time = source.end_time.take().map(|text| preview_text(&text, 32));
    }
    // New references already have a native 16KiB limit. Unlike a historical
    // selected sense, this source-labelled excerpt is useful on the word card.
    record
}
pub fn groups(
    conn: &Connection,
    query: &str,
    limit: i64,
    offset: i64,
) -> Result<SavedGroupPage, String> {
    let archive = archive(conn, query)?;
    let mut matching: Vec<_> = archive.groups.values().filter(|g| g.search_hit).collect();
    matching.sort_by(|a, b| {
        b.latest_saved_at
            .cmp(&a.latest_saved_at)
            .then_with(|| a.group_id.cmp(&b.group_id))
    });
    let total_groups = matching.len();
    let total_records = matching.iter().map(|g| g.record_ids.len()).sum();
    let groups = matching
        .into_iter()
        .skip(offset.max(0) as usize)
        .take(limit.clamp(1, 200) as usize)
        .map(|g| {
            Ok(SavedGroup {
                group_id: g.group_id.clone(),
                expression: preview_text(&g.expression, 256),
                context_count: g.record_ids.len(),
                latest_saved_at: g.latest_saved_at,
                preview: group_preview(get(conn, &g.record_ids[0])?.ok_or("saved_missing")?),
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(SavedGroupPage {
        groups,
        total_groups,
        total_records,
    })
}
pub fn group_contexts(
    conn: &Connection,
    group_id: &str,
    limit: i64,
    offset: i64,
) -> Result<SavedContextPage, String> {
    let archive = archive(conn, "")?;
    context_page(conn, archive.groups.get(group_id), limit, offset)
}
pub fn context_page(
    conn: &Connection,
    group: Option<&ArchiveGroup>,
    limit: i64,
    offset: i64,
) -> Result<SavedContextPage, String> {
    let Some(group) = group else {
        return Ok(SavedContextPage {
            records: vec![],
            total: 0,
        });
    };
    let records = group
        .record_ids
        .iter()
        .skip(offset.max(0) as usize)
        .take(limit.clamp(1, 50) as usize)
        .map(|id| get(conn, id)?.ok_or("saved_missing".into()))
        .collect::<Result<_, String>>()?;
    Ok(SavedContextPage {
        records,
        total: group.record_ids.len(),
    })
}
#[tauri::command]
pub fn list_saved_groups(
    state: State<DbState>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<SavedGroupPage, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    groups(
        &conn,
        &query.unwrap_or_default(),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
    )
}
#[tauri::command]
pub fn saved_group_contexts(
    state: State<DbState>,
    group_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<SavedContextPage, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    group_contexts(&conn, &group_id, limit.unwrap_or(10), offset.unwrap_or(0))
}

#[tauri::command]
pub fn list_saved_records(
    state: State<DbState>,
    query: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<SavedRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    list(
        &conn,
        &query.unwrap_or_default(),
        limit.unwrap_or(200),
        offset.unwrap_or(0),
    )
}
#[tauri::command]
pub fn mutate_saved_record(
    state: State<DbState>,
    operation_id: String,
    mutation: Mutation,
) -> Result<MutationResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    mutate(&conn, &operation_id, &mutation)
}

pub fn selection(conn: &Connection, input: &SaveInput) -> Result<Option<SavedRecord>, String> {
    let candidate = from_input(conn, input)?;
    Ok(get(conn, &candidate.record_id)?.filter(|record| record.deleted_at.is_none()))
}
#[tauri::command]
pub fn saved_for_selection(
    state: State<DbState>,
    input: SaveInput,
) -> Result<Option<SavedRecord>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    selection(&conn, &input)
}
#[tauri::command]
pub fn undo_saved_mutation(
    state: State<DbState>,
    operation_id: String,
) -> Result<SavedRecord, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    undo(&conn, &operation_id)
}
#[derive(Serialize)]
pub struct SourceLocation {
    pub file_id: i64,
    pub segment_index: i64,
}
pub fn resolve_source(
    conn: &Connection,
    record_id: &str,
) -> Result<Option<SourceLocation>, String> {
    let record = get(conn, record_id)?.ok_or("saved_missing")?;
    let Some(source) = record.source else {
        return Ok(None);
    };
    conn.query_row("SELECT f.id,s.index_num FROM files f JOIN segments s ON s.file_id=f.id WHERE f.language='en' AND f.content_hash=?1 AND s.index_num=?2 AND s.en_text=?3 AND f.media_identity IS ?4 AND f.document_identity IS ?5 ORDER BY f.id LIMIT 1",params![source.content_hash,source.segment_index,record.sentence,source.media_identity.as_ref().or_else(||source.media.as_ref().map(|m|&m.source.key)),source.document.as_ref().map(|d|&d.identity)],|r|Ok(SourceLocation{file_id:r.get(0)?,segment_index:r.get(1)?})).optional().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn saved_record_source(
    state: State<DbState>,
    record_id: String,
) -> Result<Option<SourceLocation>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    resolve_source(&conn, &record_id)
}
#[tauri::command]
pub fn saved_migration_report(state: State<DbState>) -> Result<MigrationReport, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let raw: String = conn
        .query_row(
            "SELECT report_json FROM product_migrations WHERE migration_key=?1",
            [MIGRATION],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SavedConflict {
    pub id: i64,
    pub record_id: String,
    pub local: SavedRecord,
    pub remote: SavedRecord,
}
#[tauri::command]
pub fn saved_record_conflicts(state: State<DbState>) -> Result<Vec<SavedConflict>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT id,sync_id,local_value,remote_value FROM sync_conflicts WHERE table_name='saved_records' AND resolved_at IS NULL ORDER BY created_at DESC,id DESC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (id, record_id, left, right) = row.map_err(|e| e.to_string())?;
        Ok(SavedConflict {
            id,
            record_id,
            local: serde_json::from_str(&left).map_err(|e| e.to_string())?,
            remote: serde_json::from_str(&right).map_err(|e| e.to_string())?,
        })
    })
    .collect()
}

/// Synthetic source data through the production adapter, shared by isolated
/// saved/export/sync tests; never represents a public-service observation.
#[cfg(test)]
pub(crate) fn wiktionary_snapshot_fixture() -> DictionarySnapshot {
    let raw = serde_json::json!({"word":"take off","entries":[{"language":{"code":"en","name":"English"},"partOfSpeech":"verb","pronunciations":[],"senses":[{"definition":"In aviation.","tags":["technical"],"examples":[],"subsenses":[{"definition":"To leave the ground and begin to fly.","tags":[],"examples":["The plane took off."],"subsenses":[]}]}]}],"source":{"url":"https://en.wiktionary.org/wiki/take_off","license":{"name":"CC BY-SA 4.0","url":"https://creativecommons.org/licenses/by-sa/4.0/"}}});
    let result = super::free_dictionary::convert(&raw, "take off", "2026-10-28T12:00:00Z").unwrap();
    let entry = &result["entries"][0];
    let group = &entry["groups"][0];
    let sense = group["senses"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["source_path"].as_str().unwrap().contains("/subsenses/"))
        .unwrap();
    let mut source = entry["source"].clone();
    source.as_object_mut().unwrap().remove("delivery");
    let examples: Vec<serde_json::Value> = sense["examples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| serde_json::json!({"id":e["id"],"english":e["english"],"chinese":e["chinese"]}))
        .collect();
    serde_json::from_value(serde_json::json!({"schema_version":1,"headword":entry["headword"],"source":source,"entry_id":entry["id"],"group_id":group["id"],"sense_id":sense["id"],"part_of_speech":group["part_of_speech"],"meaning":sense["meaning"],"labels":sense["labels"],"examples":examples,"patterns":[],"source_path":sense["source_path"],"content_kind":sense["content_kind"],"ancestors":sense["ancestors"]})).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::export::{backup_payload, restore_backup, BackupPayload};

    fn db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        conn.execute_batch("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'flight.srt','srt','The plane will take off soon.','flight-hash',1);
            INSERT INTO segments(id,file_id,index_num,en_text,zh_text,start_time) VALUES(1,1,0,'The plane will take off soon.','飞机即将起飞。','00:00:01,000');
            INSERT INTO segments(id,file_id,index_num,en_text) VALUES(2,1,1,'We take off at noon.');").unwrap();
        (dir, conn)
    }
    fn input(segment: i64) -> Mutation {
        Mutation::Save {
            input: SaveInput {
                segment_id: segment,
                expression: "take off".into(),
                start_offset: if segment == 1 { 15 } else { 3 },
                end_offset: if segment == 1 { 23 } else { 11 },
                explanation: Some("起飞".into()),
                explanation_source: "dictionary".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            },
        }
    }

    fn selected_dictionary_sense() -> DictionarySnapshot {
        DictionarySnapshot {
            schema_version: 1,
            headword: "take off".into(),
            source: DictionarySnapshotSource {
                provider: "longman".into(),
                dataset: "ldoce6-en-zh".into(),
                edition: Some("6".into()),
                release: Some("longman6-reviewed-v5-quick-local-v1".into()),
                adapter_version: "1.0.0".into(),
                entry_key: "take".into(),
                locator: Some("fixture-selected-expression".into()),
                entry_url: None,
                retrieved_at: None,
                access_channel: None,
                service_url: None,
                received_at: None,
                content_hash: None,
                license: None,
                attribution: None,
                modifications: None,
            },
            entry_id: "longman:fixture:entry-take-off".into(),
            group_id: "longman:fixture:group-take-off".into(),
            sense_id: "longman:fixture:sense-2".into(),
            part_of_speech: Some("verb".into()),
            meaning: DictionarySnapshotMeaning {
                en: Some("to leave the ground and begin to fly".into()),
                zh: Some("起飞".into()),
            },
            labels: vec![DictionarySnapshotLabel {
                kind: "grammar".into(),
                text: "intransitive".into(),
            }],
            examples: vec![DictionarySnapshotExample {
                id: "longman:fixture:example-2".into(),
                english: "The plane took off.".into(),
                chinese: Some("飞机起飞了。".into()),
            }],
            patterns: vec![],
            source_path: None,
            content_kind: None,
            ancestors: None,
        }
    }

    fn dictionary_input(segment: i64) -> Mutation {
        let mut mutation = input(segment);
        if let Mutation::Save { input } = &mut mutation {
            input.dictionary_snapshot = Some(selected_dictionary_sense());
        }
        mutation
    }

    fn reference(headword: &str) -> DictionaryReference {
        let mut sense = selected_dictionary_sense();
        sense.headword = headword.into();
        sense.labels.clear();
        sense.examples.clear();
        sense.patterns.clear();
        DictionaryReference {
            schema_version: 1,
            kind: "dictionary_excerpt".into(),
            headword: headword.into(),
            senses: vec![sense],
        }
    }
    fn save_surface(
        conn: &Connection,
        id: i64,
        expression: &str,
        headword: Option<&str>,
    ) -> MutationResult {
        conn.execute(
            "INSERT INTO segments(id,file_id,index_num,en_text) VALUES(?1,1,?1,?2)",
            params![id, expression],
        )
        .unwrap();
        mutate(
            conn,
            &format!("surface-{id}"),
            &Mutation::Save {
                input: SaveInput {
                    segment_id: id,
                    expression: expression.into(),
                    start_offset: 0,
                    end_offset: expression.encode_utf16().count(),
                    explanation: None,
                    explanation_source: "unknown".into(),
                    dictionary_snapshot: None,
                    dictionary_reference: headword.map(reference),
                },
            },
        )
        .unwrap()
    }

    #[test]
    fn dictionary_excerpt_is_optional_not_selected_and_survives_edit_delete_backup_undo_reopen() {
        let (dir, conn) = db();
        let mut request = input(1);
        if let Mutation::Save { input } = &mut request {
            input.explanation = None;
            input.explanation_source = "unknown".into();
            input.dictionary_reference = Some(reference("take off"));
        }
        let first = mutate(&conn, "excerpt-first", &request).unwrap();
        assert_eq!(first.record.explanation, None);
        assert_eq!(first.record.explanation_source, "unknown");
        assert!(first.record.dictionary_snapshot.is_none());
        assert_eq!(
            first.record.dictionary_reference,
            Some(reference("take off"))
        );
        assert!(!mutate(&conn, "excerpt-repeat", &request).unwrap().changed);
        let edited = edit(&conn, &first.record, "个人理解");
        let removed = remove(&conn, &edited);
        let backup = backup_payload(&conn).unwrap();
        let (_d2, target) = db();
        restore_backup(&target, &backup).unwrap();
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(
            restored.dictionary_reference,
            first.record.dictionary_reference
        );
        assert_eq!(restored.explanation.as_deref(), Some("个人理解"));
        assert_eq!(restored.source, first.record.source);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(
            get(&conn, &first.record.record_id).unwrap().unwrap(),
            removed.record
        );
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_groups, 0);
        undo(&conn, &removed.operation_id).unwrap();
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_groups, 1);
        assert!(serde_json::to_value(input(2)).unwrap()["input"]
            .get("dictionary_reference")
            .is_none());
    }

    #[test]
    fn native_excerpt_rejects_oversize_duplicate_mixed_scope_and_uncontrolled_provenance() {
        let (_d, conn) = db();
        for mode in 0..7 {
            let mut reference = reference("take off");
            match mode {
                0 => reference.senses = vec![reference.senses[0].clone(); 6],
                1 => reference.senses.push(reference.senses[0].clone()),
                2 => reference.senses[0].headword = "look".into(),
                3 => reference.senses[0].meaning.en = Some("x".repeat(2001)),
                4 => reference.senses[0].sense_id = "other:invented".into(),
                5 => {
                    reference.senses[0].source.service_url =
                        Some("https://uncontrolled.invalid".into())
                }
                _ => reference.kind = "current_sentence_meaning".into(),
            }
            let mut request = input(1);
            if let Mutation::Save { input } = &mut request {
                input.dictionary_reference = Some(reference);
                input.explanation = None;
                input.explanation_source = "unknown".into();
            }
            assert_eq!(
                mutate(&conn, &format!("invalid-excerpt-{mode}"), &request)
                    .err()
                    .unwrap(),
                "saved_dictionary_reference_invalid"
            );
        }
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_records, 0);
    }

    #[test]
    fn archive_aggregates_before_pagination_searches_all_contexts_and_keeps_stable_order() {
        let (_d, conn) = db();
        for id in 3..=207 {
            save_surface(&conn, id, "change", Some("change"));
        }
        // One historical sentence beyond the first raw page remains searchable;
        // a matching card still counts all of its independent source contexts.
        let oldest = groups(&conn, "", 1, 0).unwrap().groups.remove(0);
        let contexts = group_contexts(&conn, &oldest.group_id, 50, 200).unwrap();
        assert_eq!(contexts.total, 205);
        assert_eq!(contexts.records.len(), 5);
        let edited = edit(&conn, &contexts.records[4], "only-the-oldest-context");
        let found = groups(&conn, "only-the-oldest-context", 1, 0).unwrap();
        assert_eq!(found.total_groups, 1);
        assert_eq!(found.total_records, 205);
        assert_eq!(found.groups[0].context_count, 205);
        for id in 208..=410 {
            save_surface(&conn, id, &format!("term{id}"), None);
        }
        let first = groups(&conn, "", 200, 0).unwrap();
        let second = groups(&conn, "", 200, 200).unwrap();
        assert_eq!(first.total_groups, 204);
        assert_eq!(first.total_records, 408);
        assert_eq!(first.groups.len(), 200);
        assert_eq!(second.groups.len(), 4);
        let ids = first
            .groups
            .iter()
            .chain(&second.groups)
            .map(|g| g.group_id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(ids.len(), 204);
        assert_eq!(
            first.groups.iter().map(|g| &g.group_id).collect::<Vec<_>>(),
            groups(&conn, "", 200, 0)
                .unwrap()
                .groups
                .iter()
                .map(|g| &g.group_id)
                .collect::<Vec<_>>()
        );
        let removed = remove(&conn, &edited);
        assert_eq!(
            groups(&conn, "only-the-oldest-context", 1, 0)
                .unwrap()
                .total_groups,
            0
        );
        undo(&conn, &removed.operation_id).unwrap();
        assert_eq!(
            groups(&conn, "only-the-oldest-context", 1, 0)
                .unwrap()
                .total_records,
            205
        );
    }

    #[test]
    fn archive_and_recall_keep_ambiguous_excerpts_literal_boundaries_and_case_identity() {
        let (_d, conn) = db();
        save_surface(&conn, 3, "changed", Some("change"));
        save_surface(&conn, 4, "changed", None);
        save_surface(&conn, 5, "change", None);
        for (id, expression, headword) in [
            (6, "US", Some("US")),
            (7, "us", Some("us")),
            (8, "look", None),
            (9, "look up", None),
            (10, "run-in", None),
            (11, "run in", None),
            (12, "take off", Some("take off")),
            (13, "take off", None),
        ] {
            save_surface(&conn, id, expression, headword);
        }
        let page = groups(&conn, "", 50, 0).unwrap();
        assert_eq!(page.total_groups, 9);
        let change = page
            .groups
            .iter()
            .find(|g| g.expression == "change")
            .unwrap();
        assert_eq!(change.context_count, 1);
        for alias in ["changed", "Changed"] {
            let history = super::super::recall::contexts(&conn, alias, 0, 50).unwrap();
            assert_eq!(history.total, 2);
        }
        for alias in ["US", "us", "look", "look up", "run-in", "run in"] {
            assert_eq!(
                super::super::recall::contexts(&conn, alias, 0, 50)
                    .unwrap()
                    .total,
                1
            );
        }
        assert_eq!(
            super::super::recall::contexts(&conn, "take", 0, 50)
                .unwrap()
                .total,
            0
        );
        let index = super::super::recall::index(&conn).unwrap();
        assert!(index.contains(&"US".into()));
        assert!(index.contains(&"us".into()));
        assert!(index.contains(&"changed".into()));
        // Old default headwords cannot split one ambiguous surface into guessed senses.
        save_surface(&conn, 14, "bound", Some("bind"));
        save_surface(&conn, 15, "bound", Some("bound"));
        save_surface(&conn, 16, "bound", None);
        assert_eq!(
            super::super::recall::contexts(&conn, "bound", 0, 50)
                .unwrap()
                .total,
            3
        );
        assert_eq!(
            super::super::recall::contexts(&conn, "bind", 0, 50)
                .unwrap()
                .total,
            0
        );
    }

    #[test]
    fn deleting_an_old_default_excerpt_does_not_change_an_ambiguous_literal_family() {
        let (_d, conn) = db();
        let proven = save_surface(&conn, 3, "changed", Some("change"));
        let literal = save_surface(&conn, 4, "changed", None);
        let canonical = save_surface(&conn, 5, "change", None);
        remove(&conn, &proven.record);
        let page = groups(&conn, "", 50, 0).unwrap();
        assert_eq!(page.total_groups, 2);
        assert_eq!(page.total_records, 2);
        remove(&conn, &literal.record);
        assert_eq!(
            super::super::recall::contexts(&conn, "changed", 0, 10)
                .unwrap()
                .total,
            0
        );
        remove(&conn, &canonical.record);
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
    }

    #[test]
    fn removing_or_undoing_one_context_preserves_other_contexts_and_last_delete_clears_index() {
        let (_d, conn) = db();
        let first = save_surface(&conn, 3, "change", Some("change"));
        let second = save_surface(&conn, 4, "change", Some("change"));
        let third = save_surface(&conn, 5, "change", None);
        undo(&conn, &third.operation_id).unwrap();
        assert_eq!(groups(&conn, "", 50, 0).unwrap().groups[0].context_count, 2);
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        remove(&conn, &first.record);
        let last = remove(&conn, &second.record);
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_groups, 0);
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
        undo(&conn, &last.operation_id).unwrap();
        assert_eq!(groups(&conn, "", 50, 0).unwrap().groups[0].context_count, 1);
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
    }

    #[test]
    fn archive_cache_invalidates_after_save_edit_remove_undo_restore_and_sync_write() {
        let (_d, conn) = db();
        let first = save_surface(&conn, 3, "change", Some("change"));
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        let backup = backup_payload(&conn).unwrap();
        let edited = edit(&conn, &first.record, "a personal revision");
        assert_eq!(
            groups(&conn, "personal revision", 50, 0)
                .unwrap()
                .total_records,
            1
        );
        let removed = remove(&conn, &edited);
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
        let restored = undo(&conn, &removed.operation_id).unwrap();
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        // Sync and restore both commit through the same write_record boundary;
        // changed excerpts invalidate the view but cannot grant form identities.
        let mut synced = restored.clone();
        synced.dictionary_reference = Some(reference("alter"));
        write_record(&conn, &synced).unwrap();
        let index = super::super::recall::index(&conn).unwrap();
        assert!(!index.contains(&"alter".into()));
        assert!(index.contains(&"change".into()));
        synced.deleted_at = Some(now_ms());
        write_record(&conn, &synced).unwrap();
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
        restore_backup(&conn, &backup).unwrap();
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_records, 1);
    }

    #[test]
    fn archive_cache_detects_other_connection_commits_and_uses_a_fresh_reopen_token() {
        let (dir, conn) = db();
        let first = save_surface(&conn, 3, "change", None);
        let writer = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        let (old_token, before) = archive_stamp(&conn).unwrap();
        let mut remote = first.record.clone();
        remote.deleted_at = Some(now_ms());
        write_record(&writer, &remote).unwrap();
        let (_, after) = archive_stamp(&conn).unwrap();
        assert_eq!(before.changes, after.changes);
        assert_ne!(before.data_version, after.data_version);
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
        remote.deleted_at = None;
        remote.generation += 1;
        write_record(&writer, &remote).unwrap();
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        drop(writer);
        drop(conn);
        let reopened = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let (new_token, _) = archive_stamp(&reopened).unwrap();
        assert_ne!(old_token, new_token);
        assert!(super::super::recall::index(&reopened)
            .unwrap()
            .contains(&"change".into()));
    }

    #[test]
    fn independent_databases_never_share_an_archive_cache_identity() {
        let (_first_dir, first) = db();
        let (_second_dir, second) = db();
        save_surface(&first, 3, "change", None);
        save_surface(&second, 3, "bank", None);
        assert!(super::super::recall::index(&first)
            .unwrap()
            .contains(&"change".into()));
        assert!(super::super::recall::index(&second)
            .unwrap()
            .contains(&"bank".into()));
        assert_ne!(
            archive_stamp(&first).unwrap().0,
            archive_stamp(&second).unwrap().0
        );
        assert!(super::super::recall::index(&first)
            .unwrap()
            .contains(&"change".into()));
    }

    #[test]
    fn archive_cache_never_retains_uncommitted_or_rolled_back_tombstones() {
        let (_d, conn) = db();
        let first = save_surface(&conn, 3, "change", None);
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        let tx = conn.unchecked_transaction().unwrap();
        let mut removed = first.record.clone();
        removed.deleted_at = Some(now_ms());
        write_record(&tx, &removed).unwrap();
        assert!(super::super::recall::index(&tx).unwrap().is_empty());
        let (_, before_rollback) = archive_stamp(&tx).unwrap();
        tx.rollback().unwrap();
        let (_, after_rollback) = archive_stamp(&conn).unwrap();
        // total_changes does not detect rollback; explicit transaction bypass
        // prevents its temporary view from being reused after this boundary.
        assert_eq!(before_rollback.changes, after_rollback.changes);
        assert!(super::super::recall::index(&conn)
            .unwrap()
            .contains(&"change".into()));
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_records, 1);
    }

    #[test]
    fn catalog_changes_rebuild_cached_identity_without_rewriting_old_records_or_excerpts() {
        use super::super::longman::RelationCatalog;
        let (_d, conn) = db();
        let went = save_surface(&conn, 3, "went", Some("go"));
        let go = save_surface(&conn, 4, "go", None);
        let saw = save_surface(&conn, 5, "saw", Some("see"));
        let see = save_surface(&conn, 6, "see", None);
        let before = list(&conn, "", 100, 0).unwrap();
        let proven = std::sync::Arc::new(RelationCatalog::test_fixture(
            "fixture-release-a:v1",
            &[("went", "go")],
        ));
        let first = archive_with_catalog(&conn, "", proven.clone()).unwrap();
        assert_eq!(first.resolve("went").unwrap().record_ids.len(), 2);
        assert_eq!(first.resolve("go").unwrap().record_ids.len(), 2);
        assert_eq!(
            first.resolve("saw").unwrap().record_ids,
            vec![saw.record.record_id.clone()]
        );
        assert_eq!(
            first.resolve("see").unwrap().record_ids,
            vec![see.record.record_id.clone()]
        );
        assert!(std::sync::Arc::ptr_eq(
            &first,
            &archive_with_catalog(&conn, "", proven).unwrap()
        ));
        let unavailable =
            std::sync::Arc::new(RelationCatalog::test_fixture("fixture-unavailable:v1", &[]));
        let fallback = archive_with_catalog(&conn, "", unavailable).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&first, &fallback));
        assert_eq!(
            fallback.resolve("went").unwrap().record_ids,
            vec![went.record.record_id.clone()]
        );
        assert_eq!(
            fallback.resolve("go").unwrap().record_ids,
            vec![go.record.record_id.clone()]
        );
        assert_eq!(fallback.groups.len(), 4);
        let revised =
            std::sync::Arc::new(RelationCatalog::test_fixture("fixture-release-b:v2", &[]));
        let revised = archive_with_catalog(&conn, "", revised).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&fallback, &revised));
        assert_eq!(list(&conn, "", 100, 0).unwrap(), before);
        // A late source excerpt, including one arriving from sync, remains a
        // portable reference and cannot silently move an ambiguous sentence.
        let mut late = saw.record.clone();
        late.dictionary_reference = Some(reference("saw"));
        write_record(&conn, &late).unwrap();
        let after = archive_with_catalog(
            &conn,
            "",
            std::sync::Arc::new(RelationCatalog::test_fixture(
                "fixture-release-a:v1",
                &[("went", "go")],
            )),
        )
        .unwrap();
        assert_eq!(
            after.resolve("saw").unwrap().record_ids,
            vec![late.record_id]
        );
        assert_eq!(after.resolve("see").unwrap().record_ids.len(), 1);
    }

    #[test]
    fn unavailable_catalog_keeps_casing_literal_and_source_mode_restores_sentence_capitalization() {
        let (_d, conn) = db();
        save_surface(&conn, 3, "us", None);
        save_surface(&conn, 4, "the", None);
        let unavailable = std::sync::Arc::new(
            super::super::longman::RelationCatalog::test_fixture("unavailable-case-test", &[]),
        );
        let archive = archive_with_catalog(&conn, "", unavailable.clone()).unwrap();
        assert!(archive.resolve("US").is_none());
        assert!(archive.resolve("THE").is_none());
        assert!(archive.resolve("The").is_none());
        let available = std::sync::Arc::new(super::super::longman::RelationCatalog::test_fixture(
            "available-case-test",
            &[("the", "the")],
        ));
        assert_eq!(
            archive_with_catalog(&conn, "", available)
                .unwrap()
                .resolve("The")
                .unwrap()
                .record_ids
                .len(),
            1
        );
        save_surface(&conn, 5, "US", None);
        save_surface(&conn, 6, "I'M", None);
        let archive = archive_with_catalog(&conn, "", unavailable).unwrap();
        assert_eq!(archive.resolve("US").unwrap().record_ids.len(), 1);
        assert_eq!(archive.resolve("us").unwrap().record_ids.len(), 1);
        assert_eq!(archive.resolve("I'M").unwrap().record_ids.len(), 1);
        assert!(archive.resolve("i'm").is_none());
    }

    #[test]
    fn missing_dictionary_mode_preserves_case_cards_across_cache_reopen_and_source_recovery() {
        use super::super::longman::RelationCatalog;
        let (dir, conn) = db();
        let lower = save_surface(&conn, 3, "may", None);
        let unavailable =
            std::sync::Arc::new(RelationCatalog::test_fixture("missing-source-case-v1", &[]));
        let single = archive_with_catalog(&conn, "", unavailable.clone()).unwrap();
        assert!(single.literal_only());
        assert!(single.resolve("May").is_none());
        assert!(single.resolve("MAY").is_none());
        assert_eq!(
            single.resolve("may").unwrap().record_ids,
            vec![lower.record.record_id.clone()]
        );
        let upper = save_surface(&conn, 4, "May", None);
        save_surface(&conn, 5, "go", None);
        save_surface(&conn, 6, "Went", None);
        let facts = list(&conn, "", 100, 0).unwrap();
        let source = std::sync::Arc::new(RelationCatalog::test_fixture(
            "available-source-case-v1",
            &[("may", "may"), ("May", "May"), ("went", "go")],
        ));
        let sourced = archive_with_catalog(&conn, "", source.clone()).unwrap();
        assert!(!sourced.literal_only());
        assert_eq!(sourced.groups.len(), 3);
        assert_eq!(sourced.resolve("Went").unwrap().record_ids.len(), 2);
        let literal = archive_with_catalog(&conn, "", unavailable.clone()).unwrap();
        assert!(literal.literal_only());
        assert_eq!(literal.groups.len(), 4);
        assert_eq!(
            literal.resolve("May").unwrap().record_ids,
            vec![upper.record.record_id]
        );
        assert_eq!(
            literal.resolve("may").unwrap().record_ids,
            vec![lower.record.record_id]
        );
        assert_eq!(literal.resolve("Went").unwrap().record_ids.len(), 1);
        assert!(literal.resolve("went").is_none());
        assert_eq!(list(&conn, "", 100, 0).unwrap(), facts);
        drop(conn);
        let reopened = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let literal = archive_with_catalog(&reopened, "", unavailable).unwrap();
        assert!(literal.literal_only());
        assert_eq!(literal.groups.len(), 4);
        assert_eq!(literal.resolve("May").unwrap().record_ids.len(), 1);
        assert_eq!(literal.resolve("may").unwrap().record_ids.len(), 1);
        let recovered = archive_with_catalog(&reopened, "", source).unwrap();
        assert!(!recovered.literal_only());
        assert_eq!(recovered.groups.len(), 3);
        assert_eq!(recovered.resolve("Went").unwrap().record_ids.len(), 2);
        assert_eq!(list(&reopened, "", 100, 0).unwrap(), facts);
    }

    fn inflection_evidence(name: &str, value: &serde_json::Value) {
        if let Some(root) = std::env::var_os("LEXICUE_INFLECTION_ARCHIVE_EVIDENCE") {
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(
                std::path::Path::new(&root).join(name),
                serde_json::to_vec_pretty(value).unwrap(),
            )
            .unwrap();
        }
    }

    #[test]
    #[ignore = "Requires the genuine local Longman text package; uses only temporary SQLite"]
    fn real_catalog_archive_recall_covers_safe_and_ambiguous_forms_with_durable_source_facts() {
        let catalog = super::super::longman::relation_catalog_configured();
        assert_eq!(super::super::longman::status_configured()["state"], "ready");
        let mut cases = vec![];
        for (surface, lemma) in [
            ("children", "child"),
            ("women", "woman"),
            ("mice", "mouse"),
            ("went", "go"),
            ("bought", "buy"),
            ("studies", "study"),
        ] {
            let (_d, conn) = db();
            assert_eq!(
                catalog.identity(surface),
                lemma,
                "catalog evidence for {surface}"
            );
            let canonical = save_surface(&conn, 3, lemma, None);
            let index = super::super::recall::index(&conn).unwrap();
            assert!(
                index.contains(&surface.into()),
                "unsaved safe form {surface}"
            );
            assert_eq!(
                super::super::recall::contexts(&conn, surface, 0, 10)
                    .unwrap()
                    .records,
                vec![canonical.record.clone()]
            );
            let form = save_surface(&conn, 4, surface, Some(lemma));
            let grouped = groups(&conn, "", 50, 0).unwrap();
            assert_eq!(grouped.total_groups, 1, "one card for {surface}/{lemma}");
            assert_eq!(grouped.groups[0].context_count, 2);
            assert_eq!(
                groups(&conn, surface, 50, 0).unwrap().total_records,
                2,
                "form search includes all family contexts"
            );
            let input = SaveInput {
                segment_id: 4,
                expression: surface.into(),
                start_offset: 0,
                end_offset: surface.encode_utf16().count(),
                explanation: None,
                explanation_source: "unknown".into(),
                dictionary_snapshot: None,
                dictionary_reference: None,
            };
            assert!(
                !mutate(&conn, "duplicate-safe-form", &Mutation::Save { input })
                    .unwrap()
                    .changed
            );
            let removed = remove(&conn, &form.record);
            assert_eq!(
                super::super::recall::contexts(&conn, surface, 0, 10)
                    .unwrap()
                    .total,
                1
            );
            assert_eq!(
                undo(&conn, &removed.operation_id).unwrap().source,
                form.record.source
            );
            let removed = remove(&conn, &canonical.record);
            assert_eq!(
                super::super::recall::contexts(&conn, lemma, 0, 10)
                    .unwrap()
                    .records[0]
                    .expression,
                surface,
                "reverse form lookup remains"
            );
            let restored = undo(&conn, &removed.operation_id).unwrap();
            let edited = edit(&conn, &restored, "my unchanged personal note");
            let backup = backup_payload(&conn).unwrap();
            let (target_dir, target) = db();
            restore_backup(&target, &backup).unwrap();
            assert_eq!(
                super::super::recall::contexts(&target, surface, 0, 10)
                    .unwrap()
                    .total,
                2
            );
            assert_eq!(get(&target, &edited.record_id).unwrap().unwrap(), edited);
            drop(target);
            let target = crate::db::init_db(&target_dir.path().join("test.db")).unwrap();
            target.execute("DELETE FROM files", []).unwrap();
            assert_eq!(
                super::super::recall::contexts(&target, surface, 0, 10)
                    .unwrap()
                    .total,
                2
            );
            assert!(resolve_source(&target, &form.record.record_id)
                .unwrap()
                .is_none());
            assert_eq!(
                get(&target, &form.record.record_id)
                    .unwrap()
                    .unwrap()
                    .dictionary_reference,
                form.record.dictionary_reference
            );
            for record in list(&target, "", 100, 0).unwrap() {
                remove(&target, &record);
            }
            assert!(super::super::recall::index(&target).unwrap().is_empty());
            cases.push(serde_json::json!({"surface":surface,"lemma":lemma,"safe":true,"unsaved_form_recall":true,"same_card_contexts":2,"delete_undo_reverse_backup_reopen_missing_source":true}));
        }
        for (surface, lemma) in [
            ("saw", "see"),
            ("left", "leave"),
            ("found", "find"),
            ("leaves", "leaf"),
            ("leaves", "leave"),
            ("axes", "axe"),
            ("axes", "axis"),
            ("better", "good"),
            ("better", "well"),
            ("running", "run"),
            ("studied", "study"),
            ("changed", "change"),
            ("books", "book"),
            ("gone", "go"),
            ("sawed", "saw"),
            ("sawn", "saw"),
            ("saws", "saw"),
            ("founded", "found"),
            ("bettered", "better"),
        ] {
            let (_d, conn) = db();
            assert_eq!(
                catalog.identity(surface),
                surface,
                "ambiguous form must remain literal: {surface}"
            );
            let canonical = save_surface(&conn, 3, lemma, None);
            assert!(
                !super::super::recall::index(&conn)
                    .unwrap()
                    .contains(&surface.into()),
                "{lemma} cannot grant recall of {surface}"
            );
            assert_eq!(
                super::super::recall::contexts(&conn, surface, 0, 10)
                    .unwrap()
                    .total,
                0
            );
            let literal = save_surface(&conn, 4, surface, Some(lemma));
            assert_eq!(groups(&conn, "", 50, 0).unwrap().total_groups, 2);
            assert_eq!(
                super::super::recall::contexts(&conn, surface, 0, 10)
                    .unwrap()
                    .records,
                vec![literal.record.clone()]
            );
            assert_eq!(
                super::super::recall::contexts(&conn, lemma, 0, 10)
                    .unwrap()
                    .records,
                vec![canonical.record.clone()]
            );
            let mut late = literal.record.clone();
            late.dictionary_reference = Some(reference(surface));
            write_record(&conn, &late).unwrap();
            assert_eq!(
                super::super::recall::contexts(&conn, surface, 0, 10)
                    .unwrap()
                    .records,
                vec![late]
            );
            cases.push(serde_json::json!({"surface":surface,"lemma":lemma,"safe":false,"lemma_alone_recall":false,"literal_saved_recall":true,"same_card":false,"late_excerpt_cannot_move_identity":true}));
        }
        for (literal, unrelated) in [
            ("news", "new"),
            ("business", "bus"),
            ("glass", "gla"),
            ("series", "sery"),
            ("species", "specy"),
            ("US", "us"),
            ("happiness", "happy"),
            ("action", "act"),
            ("takeoff", "take off"),
            ("take off", "take"),
            ("run-in", "run in"),
            ("can't", "cant"),
            ("take%20off", "take off"),
            ("rock &amp; roll", "rock & roll"),
            ("taked", "take"),
            ("buyed", "buy"),
            ("childs", "child"),
            ("gooder", "good"),
            ("look at what is up", "look up"),
            ("look what is up", "look up"),
            ("look up quickly", "look up"),
        ] {
            let (_d, conn) = db();
            save_surface(&conn, 3, literal, Some(unrelated));
            assert_eq!(
                super::super::recall::contexts(&conn, unrelated, 0, 10)
                    .unwrap()
                    .total,
                0,
                "{literal}/{unrelated} boundary"
            );
            assert_eq!(
                super::super::recall::contexts(&conn, literal, 0, 10)
                    .unwrap()
                    .total,
                1
            );
            cases.push(
                serde_json::json!({"literal":literal,"unrelated":unrelated,"cannot_merge":true}),
            );
        }
        let (_d, conn) = db();
        for (i, expression) in ["look it up", "looked the word up"].into_iter().enumerate() {
            assert_eq!(
                catalog.identity(expression),
                "look up",
                "source whole-expression match"
            );
            let saved = save_surface(&conn, i as i64 + 3, expression, Some("look up"));
            assert_eq!(saved.record.expression, expression);
            assert_eq!(
                saved.record.source.as_ref().unwrap().end_offset,
                Some(expression.encode_utf16().count() as i64)
            );
        }
        assert_eq!(groups(&conn, "", 50, 0).unwrap().total_groups, 1);
        assert_eq!(
            super::super::recall::contexts(&conn, "look up", 0, 10)
                .unwrap()
                .total,
            2
        );
        assert_eq!(
            super::super::recall::contexts(&conn, "look", 0, 10)
                .unwrap()
                .total,
            0
        );
        assert_eq!(
            super::super::recall::contexts(&conn, "look up quickly", 0, 10)
                .unwrap()
                .total,
            0
        );
        cases.push(serde_json::json!({"surface":["look it up","looked the word up"],"lemma":"look up","source_whole_expression":true,"same_card_contexts":2,"offsets_preserved":true,"no_arbitrary_phrase_extension":true}));
        inflection_evidence(
            "rust-archive-recall-cases.json",
            &serde_json::json!({"passed":true,"kind":"genuine Rust catalog + disposable SQLite save/archive/recall/backup paths","catalog_fingerprint":catalog.fingerprint(),"cases":cases}),
        );
    }

    #[test]
    #[ignore = "Requires source-confirmed uppercase heads from the genuine Longman package"]
    fn real_catalog_single_sided_case_reservations_never_borrow_lowercase_history() {
        let catalog = super::super::longman::relation_catalog_configured();
        let mut cases = vec![];
        for (lower, reserved) in [("us", "US"), ("may", "May")] {
            assert!(
                catalog.case_sensitive_identity(reserved),
                "source case reservation {reserved}"
            );
            let (_d, conn) = db();
            let lower_saved = save_surface(&conn, 3, lower, None);
            let batch = super::super::recall::catalog(&conn).unwrap();
            assert!(batch.expressions.contains(&lower.into()));
            assert!(batch.case_exclusions.contains(&reserved.into()));
            if reserved == "May" {
                assert!(batch.case_exclusions.contains(&"MAY".into()));
                assert_eq!(
                    super::super::recall::contexts(&conn, "MAY", 0, 10)
                        .unwrap()
                        .total,
                    0,
                    "allcaps month/modal conflict must not borrow may"
                );
            }
            assert_eq!(
                super::super::recall::contexts(&conn, reserved, 0, 10)
                    .unwrap()
                    .total,
                0,
                "single-sided {lower} save must not mark {reserved}"
            );
            let upper_saved = save_surface(&conn, 4, reserved, None);
            assert_eq!(
                super::super::recall::contexts(&conn, reserved, 0, 10)
                    .unwrap()
                    .records,
                vec![upper_saved.record.clone()]
            );
            assert_eq!(
                super::super::recall::contexts(&conn, lower, 0, 10)
                    .unwrap()
                    .records,
                vec![lower_saved.record.clone()]
            );
            let batch = super::super::recall::catalog(&conn).unwrap();
            assert!(batch.expressions.contains(&reserved.into()));
            assert!(batch.case_exclusions.contains(&reserved.into()));
            remove(&conn, &upper_saved.record);
            assert_eq!(
                super::super::recall::contexts(&conn, reserved, 0, 10)
                    .unwrap()
                    .total,
                0
            );
            assert_eq!(
                super::super::recall::contexts(&conn, lower, 0, 10)
                    .unwrap()
                    .total,
                1
            );
            cases.push(serde_json::json!({"lower":lower,"reserved":reserved,"lower_only_cannot_recall_reserved":true,"both_explicit_contexts_separate":true,"removed_upper_cannot_borrow_lower":true,"allcaps_source_conflict_also_excluded":true}));
        }
        let (_d, conn) = db();
        save_surface(&conn, 3, "go", None);
        save_surface(&conn, 4, "the", None);
        let batch = super::super::recall::catalog(&conn).unwrap();
        for sentence_case in ["Went", "The"] {
            assert!(!batch.case_exclusions.contains(&sentence_case.into()));
            assert_eq!(
                super::super::recall::contexts(&conn, sentence_case, 0, 10)
                    .unwrap()
                    .total,
                1
            );
        }
        inflection_evidence(
            "rust-case-reservations.json",
            &serde_json::json!({"passed":true,"kind":"genuine source catalog plus temporary SQLite; one batch metadata; old Vec IPC retained","cases":cases,"ordinary_sentence_case":["Went","The"]}),
        );
    }

    #[test]
    #[ignore = "Opt-in 10k disposable-history performance comparison with genuine local Longman"]
    fn real_catalog_archive_ten_thousand_history_benchmark() {
        use super::super::longman::RelationCatalog;
        use std::io::Read;
        use std::time::Instant;
        let start = Instant::now();
        let catalog = super::super::longman::relation_catalog_configured();
        assert_eq!(super::super::longman::status_configured()["state"], "ready");
        let catalog_ms = start.elapsed().as_secs_f64() * 1000.;
        let (_d, conn) = db();
        let seed = save_surface(&conn, 3, "go", None).record;
        let bytes = include_bytes!("../../resources/ecdict.tsv.gz");
        let mut text = String::new();
        flate2::read::GzDecoder::new(&bytes[..])
            .read_to_string(&mut text)
            .unwrap();
        let words = text
            .lines()
            .filter_map(|line| line.split('\t').next())
            .filter(|word| word.len() > 2 && word.bytes().all(|b| b.is_ascii_lowercase()))
            .take(9000)
            .collect::<Vec<_>>();
        assert_eq!(words.len(), 9000);
        let tx = conn.unchecked_transaction().unwrap();
        for i in 1..10_000 {
            let mut record = seed.clone();
            record.expression = if i < 1000 {
                ["go", "went"][i % 2].into()
            } else {
                words[i - 1000].into()
            };
            record.normalized_expression = normalize(&record.expression);
            record.source_key = format!("benchmark-source-{i}");
            record.record_id = identity(&record.expression, &record.source_key);
            record.source.as_mut().unwrap().segment_index = i as i64;
            record.saved_at = Some(i as i64);
            record.updated_at = i as i64;
            record.sentence = Some(format!(
                "{} was encountered in source sentence {i}.",
                record.expression
            ));
            write_record(&tx, &record).unwrap();
        }
        tx.commit().unwrap();
        let literal =
            std::sync::Arc::new(RelationCatalog::test_fixture("literal-baseline:v1", &[]));
        let start = Instant::now();
        let baseline = archive_with_catalog(&conn, "", literal.clone()).unwrap();
        let baseline_build_ms = start.elapsed().as_secs_f64() * 1000.;
        let start = Instant::now();
        let expanded = archive_with_catalog(&conn, "", catalog.clone()).unwrap();
        let expanded_build_ms = start.elapsed().as_secs_f64() * 1000.;
        let index = expanded.expressions();
        let start = Instant::now();
        for _ in 0..20 {
            assert!(std::sync::Arc::ptr_eq(
                &expanded,
                &archive_with_catalog(&conn, "", catalog.clone()).unwrap()
            ));
        }
        let warm_archive_ms = start.elapsed().as_secs_f64() * 1000. / 20.;
        let start = Instant::now();
        let mut batch = super::super::recall::catalog(&conn).unwrap();
        for _ in 1..20 {
            batch = super::super::recall::catalog(&conn).unwrap();
        }
        let warm_recall_catalog_ms = start.elapsed().as_secs_f64() * 1000. / 20.;
        assert_eq!(
            expanded
                .groups
                .values()
                .map(|g| g.record_ids.len())
                .sum::<usize>(),
            10_000
        );
        assert_eq!(
            expanded.resolve("went").unwrap().record_ids.len(),
            expanded.resolve("go").unwrap().record_ids.len()
        );
        assert_eq!(
            context_page(&conn, expanded.resolve("went"), 50, 900)
                .unwrap()
                .records
                .len(),
            50
        );
        let evidence = serde_json::json!({"passed":true,"kind":"10k synthetic portable records; first 1k go/went, 9k deterministic ECDICT lower-case words; no user data","records":10_000,"catalog_access_ms":catalog_ms,"literal_baseline_build_ms":baseline_build_ms,"expanded_build_ms":expanded_build_ms,"warm_archive_mean_ms":warm_archive_ms,"warm_recall_catalog_mean_ms":warm_recall_catalog_ms,"case_exclusion_forms":batch.case_exclusions.len(),"recall_catalog_json_bytes":serde_json::to_vec(&batch).unwrap().len(),"literal_groups":baseline.groups.len(),"expanded_groups":expanded.groups.len(),"literal_index_expressions":baseline.expressions().len(),"expanded_index_expressions":index.len(),"expanded_index_json_bytes":serde_json::to_vec(&index).unwrap().len(),"catalog_fingerprint":catalog.fingerprint()});
        println!("{evidence}");
        inflection_evidence("rust-archive-10k-performance.json", &evidence);
    }

    #[test]
    fn archive_preview_is_finite_while_contexts_and_storage_keep_the_full_snapshot() {
        let (_d, conn) = db();
        let first = save_surface(&conn, 3, "take off", Some("take off"));
        let mut complete = first.record;
        complete.explanation = Some("个人解释".repeat(5000));
        complete.explanation_source = "personal".into();
        complete.sentence = Some("The original sentence is preserved. ".repeat(1000));
        complete.sentence_translation = Some("完整译文".repeat(5000));
        complete.source.as_mut().unwrap().file_name = "source-title".repeat(500);
        complete.legacy = Some(serde_json::json!({"original_personal_note":"x".repeat(100_000)}));
        complete.dictionary_snapshot = Some(selected_dictionary_sense());
        write_record(&conn, &complete).unwrap();
        let page = groups(&conn, "", 50, 0).unwrap();
        let group = &page.groups[0];
        let preview = &group.preview;
        assert!(preview.legacy.is_none());
        assert!(preview.dictionary_snapshot.is_none());
        for text in [
            &preview.explanation,
            &preview.sentence,
            &preview.sentence_translation,
        ] {
            let text = text.as_deref().unwrap();
            assert_eq!(text.chars().count(), 300);
            assert!(text.ends_with('…'));
        }
        assert_eq!(
            preview.source.as_ref().unwrap().file_name.chars().count(),
            256
        );
        assert_eq!(preview.dictionary_reference, complete.dictionary_reference);
        assert!(serde_json::to_vec(preview).unwrap().len() < 20_000);
        assert_eq!(get(&conn, &complete.record_id).unwrap().unwrap(), complete);
        assert_eq!(
            group_contexts(&conn, &group.group_id, 10, 0)
                .unwrap()
                .records[0],
            complete
        );
    }

    #[test]
    fn restore_unknown_tombstone_applies_explicit_personal_note_retries_and_undoes_atomically() {
        let (_d, conn) = db();
        let mut original = input(1);
        if let Mutation::Save { input } = &mut original {
            input.explanation = None;
            input.explanation_source = "unknown".into();
        }
        let first = mutate(&conn, "unknown-first-save", &original).unwrap();
        let tombstone = undo(&conn, &first.operation_id).unwrap();
        assert!(tombstone.deleted_at.is_some());
        assert!(tombstone.explanation.is_none());
        let mut personal = input(1);
        if let Mutation::Save { input } = &mut personal {
            input.explanation = Some("刚写下的个人解释".into());
            input.explanation_source = "personal".into();
            input.dictionary_reference = Some(reference("take off"));
        }
        let restored = mutate(&conn, "restore-with-personal-note", &personal).unwrap();
        assert!(restored.changed);
        assert_eq!(
            restored.record.explanation.as_deref(),
            Some("刚写下的个人解释")
        );
        assert_eq!(restored.record.explanation_source, "personal");
        assert_eq!(restored.record.record_id, tombstone.record_id);
        assert_eq!(restored.record.source_key, tombstone.source_key);
        assert_eq!(restored.record.source, tombstone.source);
        assert_eq!(restored.record.saved_at, tombstone.saved_at);
        assert_eq!(
            restored.record.dictionary_reference,
            tombstone.dictionary_reference
        );
        assert_eq!(
            restored.record.dictionary_snapshot,
            tombstone.dictionary_snapshot
        );
        assert_eq!(restored.record.generation, tombstone.generation + 1);
        assert_ne!(restored.record.revision, tombstone.revision);
        assert_eq!(
            mutate(&conn, "restore-with-personal-note", &personal)
                .unwrap()
                .record,
            restored.record
        );
        assert_eq!(
            groups(&conn, "刚写下的个人解释", 50, 0)
                .unwrap()
                .total_records,
            1
        );
        let undone = undo(&conn, "restore-with-personal-note").unwrap();
        assert!(undone.deleted_at.is_some());
        assert_eq!(undone.explanation, tombstone.explanation);
        assert_eq!(undone.explanation_source, tombstone.explanation_source);
        assert_eq!(undone.source, tombstone.source);
        assert!(super::super::recall::index(&conn).unwrap().is_empty());
    }

    #[test]
    fn restore_personal_tombstone_can_explicitly_replace_or_clear_note_without_replacing_references(
    ) {
        for new_note in ["新的个人解释", ""] {
            let (_d, conn) = db();
            let mut original = dictionary_input(1);
            if let Mutation::Save { input } = &mut original {
                input.dictionary_reference = Some(reference("take off"));
            }
            let first = mutate(&conn, "personal-original", &original)
                .unwrap()
                .record;
            let old = edit(&conn, &first, "以前的个人解释");
            let removed = remove(&conn, &old);
            let mut personal = input(1);
            if let Mutation::Save { input } = &mut personal {
                input.explanation = Some(new_note.into());
                input.explanation_source = "personal".into();
            }
            let restored = mutate(&conn, "personal-explicit-restore", &personal)
                .unwrap()
                .record;
            assert_eq!(restored.explanation.as_deref(), Some(new_note));
            assert_eq!(restored.explanation_source, "personal");
            assert_eq!(restored.source, old.source);
            assert_eq!(restored.dictionary_snapshot, old.dictionary_snapshot);
            assert_eq!(restored.dictionary_reference, old.dictionary_reference);
            let undone = undo(&conn, "personal-explicit-restore").unwrap();
            assert!(undone.deleted_at.is_some());
            assert_eq!(undone.explanation, old.explanation);
            assert_eq!(undone.explanation_source, old.explanation_source);
            assert_eq!(
                undone.dictionary_snapshot,
                removed.record.dictionary_snapshot
            );
            assert_eq!(
                undone.dictionary_reference,
                removed.record.dictionary_reference
            );
        }
    }

    #[test]
    fn default_restore_preserves_old_personal_content_and_active_duplicates_never_apply_new_notes()
    {
        let (_d, conn) = db();
        let first = mutate(&conn, "saved-original", &dictionary_input(1))
            .unwrap()
            .record;
        let old = edit(&conn, &first, "保留原来的个人解释");
        remove(&conn, &old);
        let mut default = input(1);
        if let Mutation::Save { input } = &mut default {
            input.explanation = None;
            input.explanation_source = "unknown".into();
            input.dictionary_reference = Some(reference("take off"));
        }
        let restored = mutate(&conn, "restore-without-note", &default)
            .unwrap()
            .record;
        assert_eq!(restored.explanation, old.explanation);
        assert_eq!(restored.explanation_source, old.explanation_source);
        assert_eq!(restored.dictionary_snapshot, old.dictionary_snapshot);
        assert_eq!(restored.dictionary_reference, old.dictionary_reference);
        let mut explicit = input(1);
        if let Mutation::Save { input } = &mut explicit {
            input.explanation = Some("不能覆盖仍有效的记录".into());
            input.explanation_source = "personal".into();
        }
        let duplicate = mutate(&conn, "active-duplicate-with-note", &explicit).unwrap();
        assert!(!duplicate.changed);
        assert_eq!(duplicate.record, restored);
    }

    #[test]
    fn selected_later_sense_survives_reopen_personal_edit_restore_and_backup() {
        let (dir, conn) = db();
        let chosen = selected_dictionary_sense();
        let saved = mutate(&conn, "selected-sense", &dictionary_input(1))
            .unwrap()
            .record;
        assert_eq!(saved.dictionary_snapshot.as_ref(), Some(&chosen));
        assert_eq!(saved.explanation.as_deref(), chosen.meaning.zh.as_deref());
        assert_eq!(saved.source.as_ref().unwrap().start_offset, Some(15));
        assert_eq!(
            saved.source.as_ref().unwrap().start_time.as_deref(),
            Some("00:00:01,000")
        );
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(get(&conn, &saved.record_id).unwrap().unwrap(), saved);
        let retry = mutate(&conn, "selected-sense", &dictionary_input(1)).unwrap();
        assert_eq!(retry.record, saved);
        let personal = edit(&conn, &saved, "我的起飞笔记");
        assert_eq!(personal.explanation_source, "personal");
        assert_eq!(personal.dictionary_snapshot.as_ref(), Some(&chosen));
        // A later automatic lookup/save must never overwrite the user's edit.
        assert!(
            !mutate(&conn, "later-lookup-save", &input(1))
                .unwrap()
                .changed
        );
        assert_eq!(get(&conn, &saved.record_id).unwrap().unwrap(), personal);
        let removed = remove(&conn, &personal);
        let backup = backup_payload(&conn).unwrap();
        let (_target_dir, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(
            get(&target, &saved.record_id).unwrap().unwrap(),
            removed.record
        );
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.dictionary_snapshot, Some(chosen));
        assert_eq!(restored.explanation.as_deref(), Some("我的起飞笔记"));
        assert_eq!(restored.source, personal.source);
        assert_eq!(restored.generation, 1);
        // A snapshot remains readable without its material or any dictionary.
        target.execute("DELETE FROM files", []).unwrap();
        assert_eq!(get(&target, &saved.record_id).unwrap().unwrap(), restored);
    }

    #[test]
    fn separable_expression_keeps_surface_context_and_canonical_headword() {
        let (_dir, conn) = db();
        conn.execute("INSERT INTO segments(id,file_id,index_num,en_text) VALUES(3,1,2,'She looked the word up yesterday.')", []).unwrap();
        let mut chosen = selected_dictionary_sense();
        chosen.headword = "look up".into();
        chosen.meaning.zh = Some("查阅".into());
        chosen.meaning.en = Some("to look for information".into());
        chosen.entry_id = "longman:fixture:look-up".into();
        chosen.group_id = "longman:fixture:look-up-group".into();
        chosen.sense_id = "longman:fixture:look-up-2".into();
        chosen.examples.clear();
        let mutation = Mutation::Save {
            input: SaveInput {
                segment_id: 3,
                expression: "looked the word up".into(),
                start_offset: 4,
                end_offset: 22,
                explanation: Some("查阅".into()),
                explanation_source: "dictionary".into(),
                dictionary_snapshot: Some(chosen.clone()),
                dictionary_reference: None,
            },
        };
        let record = mutate(&conn, "separable-expression", &mutation)
            .unwrap()
            .record;
        assert_eq!(record.expression, "looked the word up");
        assert_eq!(record.dictionary_snapshot, Some(chosen));
        assert_eq!(
            record.sentence.as_deref(),
            Some("She looked the word up yesterday.")
        );
        assert_eq!(record.source.unwrap().end_offset, Some(22));
    }

    #[test]
    fn old_snapshot_and_receipt_without_dictionary_field_remain_compatible() {
        let (_dir, conn) = db();
        let old_request = serde_json::to_value(input(1)).unwrap();
        assert!(old_request["input"].get("dictionary_snapshot").is_none());
        let old_mutation: Mutation = serde_json::from_value(old_request.clone()).unwrap();
        let first = mutate(&conn, "old-wire-request", &old_mutation).unwrap();
        let old_json = serde_json::to_value(&first.record).unwrap();
        assert!(old_json.get("dictionary_snapshot").is_none());
        let parsed: SavedRecord = serde_json::from_value(old_json).unwrap();
        assert_eq!(parsed.dictionary_snapshot, None);
        assert_eq!(
            mutate(&conn, "old-wire-request", &input(1)).unwrap().record,
            parsed
        );
        let backup = backup_payload(&conn).unwrap();
        let (_dir2, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(get(&target, &parsed.record_id).unwrap().unwrap(), parsed);
    }

    #[test]
    fn cambridge_source_snapshot_reopens_edits_undoes_and_roundtrips_backup_without_service() {
        let (dir, conn) = db();
        let mut mutation = dictionary_input(1);
        if let Mutation::Save { input } = &mut mutation {
            let snapshot = input.dictionary_snapshot.as_mut().unwrap();
            snapshot.source.provider = "cambridge".into();
            snapshot.source.dataset = "test-en-cn".into();
            snapshot.source.edition = None;
            snapshot.source.release = None;
            snapshot.source.adapter_version = "cambridge-v1.0.0".into();
            snapshot.source.entry_url = Some(
                "https://dictionary.cambridge.org/dictionary/english-chinese-simplified/take-off"
                    .into(),
            );
            snapshot.source.retrieved_at = Some("2026-10-26T01:02:03Z".into());
            snapshot.entry_id = "cambridge:test:entry".into();
            snapshot.group_id = "cambridge:test:group".into();
            snapshot.sense_id = "cambridge:test:later-sense".into();
        }
        let first = mutate(&conn, "cambridge-save", &mutation).unwrap().record;
        let chosen = first.dictionary_snapshot.clone();
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(get(&conn, &first.record_id).unwrap().unwrap(), first);
        assert_eq!(
            mutate(&conn, "cambridge-save", &mutation).unwrap().record,
            first
        );
        let personal = edit(&conn, &first, "我的剑桥解释");
        assert_eq!(personal.dictionary_snapshot, chosen);
        assert!(
            !mutate(&conn, "late-online-save", &mutation)
                .unwrap()
                .changed
        );
        let removed = remove(&conn, &personal);
        let backup = backup_payload(&conn).unwrap();
        let (_d, target) = db();
        restore_backup(&target, &backup).unwrap();
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.dictionary_snapshot, chosen);
        assert_eq!(restored.explanation.as_deref(), Some("我的剑桥解释"));
        assert_eq!(restored.source, personal.source);
        assert_eq!(restored.generation, 1);
    }

    #[test]
    fn wiktionary_reference_preserves_parents_and_attribution_offline_export_import_edit_undo_and_late_save(
    ) {
        let (dir, conn) = db();
        let chosen = wiktionary_snapshot_fixture();
        validate_dictionary_snapshot(&chosen).unwrap();
        let reference = DictionaryReference {
            schema_version: 1,
            kind: "dictionary_excerpt".into(),
            headword: chosen.headword.clone(),
            senses: vec![chosen.clone()],
        };
        let mut mutation = input(1);
        if let Mutation::Save { input } = &mut mutation {
            input.explanation = None;
            input.explanation_source = "unknown".into();
            input.dictionary_reference = Some(reference.clone());
        }
        let first = mutate(&conn, "wiktionary-save", &mutation).unwrap().record;
        assert_eq!(first.explanation, None);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let reopened = get(&conn, &first.record_id).unwrap().unwrap();
        assert_eq!(reopened.dictionary_reference, Some(reference.clone()));
        assert_eq!(
            reopened.dictionary_reference.as_ref().unwrap().senses[0]
                .ancestors
                .as_ref()
                .unwrap()[0]
                .meaning
                .en
                .as_deref(),
            Some("In aviation.")
        );
        let personal = edit(&conn, &reopened, "我的个人解释");
        assert!(
            !mutate(&conn, "wiktionary-late-save", &mutation)
                .unwrap()
                .changed
        );
        assert_eq!(get(&conn, &first.record_id).unwrap().unwrap(), personal);
        let backup = backup_payload(&conn).unwrap();
        let json = serde_json::to_vec(&backup).unwrap();
        let parsed: BackupPayload = serde_json::from_slice(&json).unwrap();
        let (_target_dir, target) = db();
        restore_backup(&target, &parsed).unwrap();
        let offline = get(&target, &first.record_id).unwrap().unwrap();
        assert_eq!(offline.dictionary_reference, Some(reference.clone()));
        assert_eq!(offline.explanation.as_deref(), Some("我的个人解释"));
        let removed = remove(&target, &offline);
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.dictionary_reference, Some(reference));
        assert_eq!(
            restored.dictionary_reference.as_ref().unwrap().senses[0]
                .source
                .attribution
                .as_deref(),
            Some(super::super::free_dictionary::ATTRIBUTION)
        );
    }

    #[test]
    fn wiktionary_snapshot_rejects_fabricated_source_translation_and_parent_scope() {
        let snapshot = wiktionary_snapshot_fixture();
        let mutations = [
            ("license", serde_json::Value::Null),
            ("content_hash", serde_json::json!("invalid")),
            (
                "entry_url",
                serde_json::json!("https://evil.example/wiki/take_off"),
            ),
            ("service_url", serde_json::json!("https://other.example")),
            ("access_channel", serde_json::json!("author_public_api")),
            ("attribution", serde_json::json!("")),
        ];
        for (field, replacement) in mutations {
            let mut wire = serde_json::to_value(&snapshot).unwrap();
            wire["source"][field] = replacement;
            let bad: DictionarySnapshot = serde_json::from_value(wire).unwrap();
            assert!(validate_dictionary_snapshot(&bad).is_err(), "{field}");
        }
        let mut translation = snapshot.clone();
        translation.meaning.zh = Some("译词".into());
        assert!(validate_dictionary_snapshot(&translation).is_err());
        let mut parent = snapshot.clone();
        parent.ancestors.as_mut().unwrap()[0].source_path = "/entries/1/senses/0".into();
        assert!(validate_dictionary_snapshot(&parent).is_err());
        let mut fake_definition = snapshot.clone();
        fake_definition.meaning.en = Some("Plural of aircraft.".into());
        assert!(validate_dictionary_snapshot(&fake_definition).is_err());
        let mut missing = snapshot;
        missing.ancestors = None;
        assert!(validate_dictionary_snapshot(&missing).is_err());
    }

    fn public_dictionary_input_version(version: &str) -> Mutation {
        let mut mutation = dictionary_input(1);
        if let Mutation::Save { input } = &mut mutation {
            let snapshot = input.dictionary_snapshot.as_mut().unwrap();
            snapshot.source.provider = "cambridge".into();
            snapshot.source.dataset = "Cambridge Dictionary (author public API)".into();
            snapshot.source.edition = None;
            snapshot.source.release = None;
            snapshot.source.adapter_version = version.into();
            snapshot.source.access_channel = Some("author_public_api".into());
            snapshot.source.service_url = Some("https://dictionary-api.eliaschen.dev".into());
            snapshot.source.received_at = Some("2026-10-26T01:02:03Z".into());
            snapshot.entry_id = format!("cambridge:public:{version}:entry");
            snapshot.group_id = format!("cambridge:public:{version}:group");
            snapshot.sense_id = format!("cambridge:public:{version}:later-sense");
            for example in &mut snapshot.examples {
                example.id = format!("cambridge:public:{version}:{}", example.id);
            }
        }
        mutation
    }

    fn public_dictionary_input() -> Mutation {
        public_dictionary_input_version("cambridge-public-v1.1.0")
    }

    #[test]
    fn public_source_later_sense_reopens_retries_edits_undoes_and_roundtrips_backup_without_service(
    ) {
        let (dir, conn) = db();
        let mutation = public_dictionary_input();
        let first = mutate(&conn, "public-save", &mutation).unwrap().record;
        let chosen = first.dictionary_snapshot.clone();
        let wire = serde_json::to_value(&chosen).unwrap();
        assert!(wire["source"].get("entry_url").is_none());
        assert!(wire["source"].get("retrieved_at").is_none());
        assert_eq!(wire["source"]["access_channel"], "author_public_api");
        assert_eq!(wire["source"]["received_at"], "2026-10-26T01:02:03Z");
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(get(&conn, &first.record_id).unwrap().unwrap(), first);
        assert_eq!(
            mutate(&conn, "public-save", &mutation).unwrap().record,
            first
        );
        let personal = edit(&conn, &first, "我的公共接口释义笔记");
        assert_eq!(personal.dictionary_snapshot, chosen);
        assert!(
            !mutate(&conn, "public-late-save", &mutation)
                .unwrap()
                .changed
        );
        let removed = remove(&conn, &personal);
        let backup = backup_payload(&conn).unwrap();
        let (_target_dir, target) = db();
        restore_backup(&target, &backup).unwrap();
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.dictionary_snapshot, chosen);
        assert_eq!(
            restored.explanation.as_deref(),
            Some("我的公共接口释义笔记")
        );
        assert_eq!(restored.source, personal.source);
        assert_eq!(restored.generation, 1);
    }

    #[test]
    fn public_source_retired_adapter_snapshot_keeps_wire_identity_reopen_backup_and_idempotent_receipt(
    ) {
        let (dir, conn) = db();
        let mutation = public_dictionary_input_version("cambridge-public-v1.0.0");
        let old_wire = serde_json::to_value(&mutation).unwrap();
        let first = mutate(&conn, "historical-public-save", &mutation)
            .unwrap()
            .record;
        let chosen = first.dictionary_snapshot.clone();
        let source = &chosen.as_ref().unwrap().source;
        assert_eq!(source.adapter_version, "cambridge-public-v1.0.0");
        assert!(chosen
            .as_ref()
            .unwrap()
            .sense_id
            .starts_with("cambridge:public:cambridge-public-v1.0.0:"));
        assert_eq!(source.access_channel.as_deref(), Some("author_public_api"));
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(get(&conn, &first.record_id).unwrap().unwrap(), first);
        let parsed: Mutation = serde_json::from_value(old_wire.clone()).unwrap();
        assert_eq!(serde_json::to_value(&parsed).unwrap(), old_wire);
        assert_eq!(
            mutate(&conn, "historical-public-save", &parsed)
                .unwrap()
                .record,
            first
        );
        let backup = backup_payload(&conn).unwrap();
        let (_target_dir, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(
            get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_snapshot,
            chosen
        );
    }

    #[test]
    fn public_source_snapshot_rejects_fabricated_or_uncontrolled_provenance() {
        let (_dir, conn) = db();
        for (index, field, value) in [
            (0, "access_channel", serde_json::Value::Null),
            (
                1,
                "service_url",
                serde_json::json!("https://unknown.example"),
            ),
            (2, "received_at", serde_json::json!("unknown")),
            (
                3,
                "entry_url",
                serde_json::json!("https://dictionary.cambridge.org/dictionary/english/take-off"),
            ),
            (4, "retrieved_at", serde_json::json!("2026-10-26T01:02:03Z")),
            (5, "edition", serde_json::json!("6")),
            (6, "release", serde_json::json!("made-up-release")),
            (7, "provider", serde_json::json!("longman")),
        ] {
            let mut wire = serde_json::to_value(public_dictionary_input()).unwrap();
            wire["input"]["dictionary_snapshot"]["source"][field] = value;
            let mutation: Mutation = serde_json::from_value(wire).unwrap();
            assert_eq!(
                mutate(&conn, &format!("invalid-public-{index}"), &mutation)
                    .err()
                    .unwrap(),
                "saved_dictionary_snapshot_invalid"
            );
        }
        let unsupported = public_dictionary_input_version("cambridge-public-v2.0.0");
        assert_eq!(
            mutate(&conn, "unsupported-public-version", &unsupported)
                .err()
                .unwrap(),
            "saved_dictionary_snapshot_invalid"
        );
        let mut wrong_version = public_dictionary_input();
        if let Mutation::Save { input } = &mut wrong_version {
            input
                .dictionary_snapshot
                .as_mut()
                .unwrap()
                .source
                .adapter_version = "cambridge-public-v1.0.0".into();
        }
        assert_eq!(
            mutate(&conn, "public-id-version-mismatch", &wrong_version)
                .err()
                .unwrap(),
            "saved_dictionary_snapshot_invalid"
        );
        let mut invalid_identity = public_dictionary_input();
        if let Mutation::Save { input } = &mut invalid_identity {
            input.dictionary_snapshot.as_mut().unwrap().sense_id = "cambridge:legacy:sense".into();
        }
        assert_eq!(
            mutate(&conn, "invalid-public-id", &invalid_identity)
                .err()
                .unwrap(),
            "saved_dictionary_snapshot_invalid"
        );
        assert_eq!(count(&conn, "saved_records"), 0);
    }

    #[test]
    fn optional_online_source_fields_do_not_change_old_snapshot_request_signature() {
        let (_d, conn) = db();
        let mutation = dictionary_input(1);
        let wire = serde_json::to_value(&mutation).unwrap();
        assert!(wire["input"]["dictionary_snapshot"]["source"]
            .get("entry_url")
            .is_none());
        assert!(wire["input"]["dictionary_snapshot"]["source"]
            .get("retrieved_at")
            .is_none());
        for field in ["access_channel", "service_url", "received_at"] {
            assert!(wire["input"]["dictionary_snapshot"]["source"]
                .get(field)
                .is_none());
        }
        let old_wire: Mutation = serde_json::from_value(wire).unwrap();
        let first = mutate(&conn, "old-dictionary-request", &old_wire).unwrap();
        assert_eq!(
            mutate(&conn, "old-dictionary-request", &mutation)
                .unwrap()
                .record,
            first.record
        );
    }

    #[test]
    fn mismatched_selected_meaning_or_oversized_snapshot_cannot_be_saved() {
        let (_dir, conn) = db();
        let mut mutation = dictionary_input(1);
        if let Mutation::Save { input } = &mut mutation {
            input.explanation = Some("另一意思".into());
        }
        assert_eq!(
            mutate(&conn, "mismatch", &mutation).err().unwrap(),
            "saved_dictionary_selection_mismatch"
        );
        if let Mutation::Save { input } = &mut mutation {
            input.explanation = Some("起飞".into());
            input.dictionary_snapshot.as_mut().unwrap().meaning.en = Some("x".repeat(33_000));
        }
        assert_eq!(
            mutate(&conn, "oversized", &mutation).err().unwrap(),
            "saved_dictionary_snapshot_invalid"
        );
        assert_eq!(count(&conn, "saved_records"), 0);
        assert_eq!(count(&conn, "saved_actions"), 0);
    }
    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }
    fn edit(conn: &Connection, record: &SavedRecord, text: &str) -> SavedRecord {
        mutate(
            conn,
            &Uuid::new_v4().to_string(),
            &Mutation::Edit {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
                explanation: text.into(),
            },
        )
        .unwrap()
        .record
    }
    fn remove(conn: &Connection, record: &SavedRecord) -> MutationResult {
        mutate(
            conn,
            &Uuid::new_v4().to_string(),
            &Mutation::Remove {
                record_id: record.record_id.clone(),
                expected_revision: record.revision.clone(),
            },
        )
        .unwrap()
    }

    #[test]
    fn ten_clicks_dedupe_context_but_new_sentence_is_distinct_and_no_review_is_created() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "first", &input(1)).unwrap();
        for n in 0..10 {
            let duplicate = mutate(&conn, &format!("duplicate-{n}"), &input(1)).unwrap();
            assert!(!duplicate.changed);
            undo(&conn, &duplicate.operation_id).unwrap();
        }
        assert_eq!(count(&conn, "saved_records"), 1);
        assert_eq!(list(&conn, "", 200, 0).unwrap().len(), 1);
        let next = mutate(&conn, "next", &input(2)).unwrap();
        assert_ne!(next.record.record_id, first.record.record_id);
        assert_eq!(
            next.record.sentence.as_deref(),
            Some("We take off at noon.")
        );
        for table in ["words", "phrases", "reviews", "phrase_reviews"] {
            assert_eq!(count(&conn, table), 0);
        }
    }

    #[test]
    fn save_retry_is_idempotent_and_undo_is_crash_safe() {
        let (dir, conn) = db();
        let first = mutate(&conn, "save", &input(1)).unwrap();
        let again = mutate(&conn, "save", &input(1)).unwrap();
        assert_eq!(first.record, again.record);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let undone = undo(&conn, "save").unwrap();
        assert!(undone.deleted_at.is_some());
        assert_eq!(undo(&conn, "save").unwrap(), undone);
        assert!(list(&conn, "", 200, 0).unwrap().is_empty());
        assert!(mutate(&conn, "save", &input(1)).is_err());
        let restored = mutate(&conn, "new-intent", &input(1)).unwrap();
        assert_eq!(restored.record.record_id, first.record.record_id);
        assert_eq!(restored.record.generation, 1);
    }

    #[test]
    fn whitespace_around_a_selection_does_not_create_a_second_source_position() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "first", &input(1)).unwrap();
        let mut spaced = input(1);
        if let Mutation::Save { input } = &mut spaced {
            input.expression = "  TAKE   OFF  ".into();
            input.start_offset = 14;
            input.end_offset = 24;
        }
        let duplicate = mutate(&conn, "spaced", &spaced).unwrap();
        assert_eq!(duplicate.record.record_id, first.record.record_id);
        assert!(!duplicate.changed);
        assert_eq!(count(&conn, "saved_records"), 1);
    }

    #[test]
    fn undo_remove_restores_exact_context_metadata_and_stale_actions_fail() {
        let (_dir, conn) = db();
        let first = mutate(&conn, "save", &input(1)).unwrap().record;
        let personal = edit(&conn, &first, "我的个人解释");
        assert_eq!(undo(&conn, "save").unwrap_err(), "saved_conflict");
        let removed = remove(&conn, &personal);
        let restored = undo(&conn, &removed.operation_id).unwrap();
        let mut expected = personal.clone();
        expected.revision = restored.revision.clone();
        expected.updated_at = restored.updated_at;
        expected.generation = 1;
        assert_eq!(restored, expected);
        assert_eq!(count(&conn, "saved_records"), 1);
        assert!(mutate(
            &conn,
            "stale",
            &Mutation::Edit {
                record_id: first.record_id,
                expected_revision: first.revision,
                explanation: "old async answer".into()
            }
        )
        .is_err());
        assert_eq!(
            get(&conn, &restored.record_id)
                .unwrap()
                .unwrap()
                .explanation
                .as_deref(),
            Some("我的个人解释")
        );
    }

    #[test]
    fn receipt_failure_rolls_back_snapshot_and_sync_queue() {
        let (_dir, conn) = db();
        let before = count(&conn, "sync_changes");
        conn.execute_batch("CREATE TRIGGER fail_saved_receipt BEFORE INSERT ON saved_actions BEGIN SELECT RAISE(ABORT,'disk write failure'); END;").unwrap();
        assert!(mutate(&conn, "failed", &input(1)).is_err());
        assert_eq!(count(&conn, "saved_records"), 0);
        assert_eq!(count(&conn, "saved_actions"), 0);
        assert_eq!(count(&conn, "sync_changes"), before);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM sync_entity_state WHERE table_name='saved_records'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn save_without_explanation_preserves_snapshot_after_source_deletion() {
        let (_dir, conn) = db();
        let mut mutation = input(1);
        if let Mutation::Save { input } = &mut mutation {
            input.explanation = None;
            input.explanation_source = "unknown".into();
        }
        let saved = mutate(&conn, "save", &mutation).unwrap().record;
        assert!(resolve_source(&conn, &saved.record_id).unwrap().is_some());
        conn.execute("DELETE FROM files WHERE id=1", []).unwrap();
        assert_eq!(get(&conn, &saved.record_id).unwrap().unwrap(), saved);
        assert!(resolve_source(&conn, &saved.record_id).unwrap().is_none());
        assert_eq!(list(&conn, "flight", 200, 0).unwrap().len(), 1);
        assert!(list(&conn, "%", 200, 0).unwrap().is_empty());
    }

    #[test]
    fn concurrent_connections_enforce_dedupe_in_database() {
        let (dir, conn) = db();
        drop(conn);
        let path = dir.path().join("test.db");
        let threads = (0..10)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let c = Connection::open(path).unwrap();
                    c.busy_timeout(std::time::Duration::from_secs(10)).unwrap();
                    mutate(&c, &format!("thread-{n}"), &input(1))
                        .unwrap()
                        .record
                        .record_id
                })
            })
            .collect::<Vec<_>>();
        let ids = threads
            .into_iter()
            .map(|t| t.join().unwrap())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(ids.len(), 1);
        let conn = Connection::open(path).unwrap();
        assert_eq!(count(&conn, "saved_records"), 1);
    }

    fn old_data(conn: &Connection) {
        conn.execute("DELETE FROM product_migrations", []).unwrap();
        conn.execute_batch("INSERT INTO words(id,lemma,status) VALUES(1,'take','learning'),(2,'plane','known'),(3,'soon','unprocessed');
            INSERT INTO words(id,lemma,status,definition) VALUES(4,'note','known','个人注释');
            INSERT INTO words(id,language,lemma,status,definition) VALUES(5,'ja','飛ぶ','learning','旧日语');
            INSERT INTO occurrences(word_id,segment_id,original_form,position,meaning_zh,analysis_model) VALUES(1,1,'take',3,'拿','ai'),(1,2,'take',1,'拿','ai'),(3,1,'soon',5,'很快','ai');
            INSERT INTO phrases(id,text,source) VALUES(1,'keep going','manual'),(2,'take off','detected'),(3,'make sense','detected');
            INSERT INTO phrase_occurrences(phrase_id,segment_id,position,meaning_zh,meaning_edited,meaning_en,meaning_en_edited,hidden,token_positions_json) VALUES(2,1,3,'我的起飞',1,'my meaning',1,1,'[3,4]');
            INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited) VALUES('en','make sense','','manual',1,'[{\"meaning_zh\":\"人工扩展义\",\"example_en\":\"It makes sense.\"}]',1);
            INSERT INTO reviews(word_id,due_at) VALUES(1,123);
            INSERT INTO review_logs(word_id,rating,reviewed_at) VALUES(1,3,123);").unwrap();
    }

    #[test]
    fn migration_keeps_every_context_edits_and_history_without_inventing_source_or_time() {
        let (_dir, conn) = db();
        old_data(&conn);
        init(&conn).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        assert_eq!(
            (
                report.eligible_words,
                report.eligible_phrases,
                report.saved_contexts,
                report.missing_sources
            ),
            (2, 3, 6, 3)
        );
        assert_eq!(report.history_only.len(), 3);
        let records = list(&conn, "", 200, 0).unwrap();
        assert!(records.iter().all(|r| r.saved_at.is_none()));
        assert_eq!(records.iter().filter(|r| r.expression == "take").count(), 2);
        let edited = records.iter().find(|r| r.expression == "take off").unwrap();
        assert_eq!(edited.explanation.as_deref(), Some("我的起飞"));
        assert_eq!(edited.explanation_source, "personal");
        let raw = edited.legacy.as_ref().unwrap();
        assert_eq!(raw["occurrence"]["meaning_en"], "my meaning");
        assert_eq!(raw["occurrence"]["hidden"], 1);
        let missing = records.iter().find(|r| r.expression == "note").unwrap();
        assert!(missing.sentence.is_none());
        assert!(missing.source.is_none());
        let removed = remove(&conn, edited);
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
        assert!(get(&conn, &removed.record.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some());
        assert_eq!(
            (
                count(&conn, "words"),
                count(&conn, "occurrences"),
                count(&conn, "reviews"),
                count(&conn, "review_logs")
            ),
            (5, 3, 1, 1)
        );
    }

    #[test]
    fn migration_interruption_rolls_back_records_marker_and_queue() {
        let (_dir, conn) = db();
        old_data(&conn);
        let before = count(&conn, "sync_changes");
        conn.execute_batch("CREATE TRIGGER fail_migration BEFORE INSERT ON product_migrations BEGIN SELECT RAISE(ABORT,'interrupted'); END;").unwrap();
        assert!(init(&conn).is_err());
        assert_eq!(count(&conn, "saved_records"), 0);
        assert_eq!(count(&conn, "product_migrations"), 0);
        assert_eq!(count(&conn, "sync_changes"), before);
        conn.execute("DROP TRIGGER fail_migration", []).unwrap();
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
    }

    #[test]
    fn duplicate_legacy_position_keeps_both_personal_versions_under_one_saved_identity() {
        let (_dir, conn) = db();
        old_data(&conn);
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,meaning_zh,meaning_edited) VALUES(2,1,3,'另一次个人解释',1)",[]).unwrap();
        init(&conn).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        assert_eq!(report.saved_contexts, 6);
        assert_eq!(report.merged_duplicate_positions, 1);
        let record = list(&conn, "take off", 200, 0).unwrap().pop().unwrap();
        let raw = serde_json::to_string(&record.legacy).unwrap();
        assert!(raw.contains("我的起飞"));
        assert!(raw.contains("另一次个人解释"));
    }

    #[test]
    fn backup_roundtrip_keeps_tombstones_identity_and_undo_receipts() {
        let (_dir, source) = db();
        source
            .execute("UPDATE files SET category='legacy-category' WHERE id=1", [])
            .unwrap();
        let record = mutate(&source, "save", &input(1)).unwrap().record;
        let personal = edit(&source, &record, "个人修正");
        source.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) VALUES('saved_records',?1,?2,?3,1)",params![record.record_id,serde_json::to_string(&record).unwrap(),serde_json::to_string(&personal).unwrap()]).unwrap();
        let removed = remove(&source, &personal);
        let backup = backup_payload(&source).unwrap();
        assert_eq!(backup.schema_version, 10);
        let (_dir2, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(
            target
                .query_row("SELECT category FROM files WHERE id=1", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "legacy-category"
        );
        assert_eq!(
            get(&target, &record.record_id).unwrap().unwrap(),
            removed.record
        );
        let versions:(String,String)=target.query_row("SELECT local_value,remote_value FROM sync_conflicts WHERE table_name='saved_records'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert!(versions.0.contains("起飞"));
        assert!(versions.1.contains("个人修正"));
        let restored = undo(&target, &removed.operation_id).unwrap();
        assert_eq!(restored.explanation, personal.explanation);
        assert_eq!(restored.source, personal.source);
        assert_eq!(restored.saved_at, personal.saved_at);
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), 1);
    }

    #[test]
    fn old_backup_missing_new_fields_migrates_atomically_and_failed_restore_preserves_current_data()
    {
        let (_dir, source) = db();
        old_data(&source);
        source
            .execute("UPDATE words SET word_kind='proper_noun' WHERE id=4", [])
            .unwrap();
        let mut json = serde_json::to_value(backup_payload(&source).unwrap()).unwrap();
        json["schema_version"] = serde_json::json!(8);
        json["data"]["words"][0]
            .as_object_mut()
            .unwrap()
            .remove("word_kind");
        for name in [
            "saved_records",
            "saved_actions",
            "saved_conflicts",
            "annotation_actions",
            "product_migrations",
        ] {
            json["data"].as_object_mut().unwrap().remove(name);
        }
        let backup: BackupPayload = serde_json::from_value(json).unwrap();
        let (_dir2, target) = db();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), 6);
        assert_eq!(
            target
                .query_row("SELECT word_kind FROM words WHERE id=4", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "proper_noun"
        );
        let before = backup_payload(&target).unwrap();
        let mut invalid = serde_json::to_value(&before).unwrap();
        invalid["data"]["saved_records"][0]["snapshot_json"] = serde_json::json!("{invalid");
        let invalid: BackupPayload = serde_json::from_value(invalid).unwrap();
        assert!(restore_backup(&target, &invalid).is_err());
        assert_eq!(
            serde_json::to_value(&before.data).unwrap(),
            serde_json::to_value(backup_payload(&target).unwrap().data).unwrap()
        );
    }

    #[test]
    fn upgrade_creates_consistent_backup_before_migration_and_backup_failure_stops_upgrade() {
        let (dir, conn) = db();
        old_data(&conn);
        drop(conn);
        let conn = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(count(&conn, "saved_records"), 6);
        let backups = std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        let backup = Connection::open(backups[0].as_ref().unwrap().path()).unwrap();
        assert_eq!(count(&backup, "product_migrations"), 0);
        assert_eq!(count(&backup, "words"), 5);
        drop(conn);
        crate::db::init_db(&dir.path().join("test.db")).unwrap();
        assert_eq!(
            std::fs::read_dir(dir.path().join("backups"))
                .unwrap()
                .count(),
            1
        );
        let (faildir, c) = db();
        old_data(&c);
        drop(c);
        std::fs::write(faildir.path().join("backups"), "blocked").unwrap();
        assert!(crate::db::init_db(&faildir.path().join("test.db")).is_err());
        let c = Connection::open(faildir.path().join("test.db")).unwrap();
        assert_eq!(count(&c, "saved_records"), 0);
    }

    #[test]
    #[ignore = "requires an explicitly supplied temporary database copy"]
    fn audit_temporary_legacy_copy() {
        fn fingerprint(mut rows: Vec<serde_json::Value>, saved_rows: bool) -> String {
            if saved_rows {
                for row in &mut rows {
                    row.as_object_mut().unwrap().remove("id");
                }
            }
            let mut canonical = rows
                .iter()
                .map(|row| serde_json::to_string(row).unwrap())
                .collect::<Vec<_>>();
            canonical.sort();
            format!(
                "{:x}",
                Sha256::digest(serde_json::to_vec(&canonical).unwrap())
            )
        }
        fn table_fingerprint(conn: &Connection, table: &str) -> String {
            let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
            let rows = stmt
                .query_map([], row_json)
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            fingerprint(rows, false)
        }
        let source = std::path::PathBuf::from(
            std::env::var("LEXICUE_V31_TEST_DB").expect("temporary copy path"),
        );
        let canonical = source.canonicalize().unwrap();
        assert!(
            canonical.starts_with("/private/tmp")
                || canonical.starts_with(std::env::temp_dir().canonicalize().unwrap())
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.db");
        std::fs::copy(&source, &path).unwrap();
        let before = Connection::open(&path).unwrap();
        let tables = [
            "files",
            "segments",
            "words",
            "occurrences",
            "phrases",
            "phrase_occurrences",
            "reviews",
            "review_logs",
            "phrase_reviews",
            "phrase_review_logs",
        ];
        let counts = tables.map(|t| count(&before, t));
        let originals = tables.map(|t| table_fingerprint(&before, t));
        drop(before);
        let started = std::time::Instant::now();
        let conn = crate::db::init_db(&path).unwrap();
        let report = migrate_legacy(&conn).unwrap();
        println!("migration audit: words={}, phrases={}, saved={}, missing={}, merged={}, duration_ms={}",report.eligible_words,report.eligible_phrases,report.saved_contexts,report.missing_sources,report.merged_duplicate_positions,started.elapsed().as_millis());
        assert_eq!(tables.map(|t| count(&conn, t)), counts);
        for (table, expected) in tables.iter().zip(originals.iter()) {
            assert_eq!(
                &table_fingerprint(&conn, table),
                expected,
                "legacy data fingerprint changed: {table}"
            );
        }
        let saved = count(&conn, "saved_records");
        init(&conn).unwrap();
        assert_eq!(count(&conn, "saved_records"), saved);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
        let backup = backup_payload(&conn).unwrap();
        let target = crate::db::init_db(&dir.path().join("restore.db")).unwrap();
        let restore_started = std::time::Instant::now();
        restore_backup(&target, &backup).unwrap();
        assert_eq!(count(&target, "saved_records"), saved);
        println!(
            "restore duration_ms={}",
            restore_started.elapsed().as_millis()
        );
        let original = serde_json::to_value(&backup.data).unwrap();
        let restored = serde_json::to_value(backup_payload(&target).unwrap().data).unwrap();
        for (table, rows) in original.as_object().unwrap() {
            // Saved integer row IDs are device-local; record_id is the stable
            // identity. Every user-visible field, receipt and legacy ID is exact.
            let expected = fingerprint(rows.as_array().unwrap().clone(), table == "saved_records");
            let actual = fingerprint(
                restored[table].as_array().unwrap().clone(),
                table == "saved_records",
            );
            assert_eq!(
                expected, actual,
                "restored data fingerprint changed: {table}"
            );
        }
        println!("verified saved={saved}; legacy table counts preserved={counts:?}");
    }
}
