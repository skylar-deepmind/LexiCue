//! The English reading flow writes materials and sentences only. Legacy vocabulary,
//! proficiency and review tables remain untouched and are available as history.
use super::{import::SegmentInput, reader::ReaderToken, tags::TagInfo};
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_import_actions (
        operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, file_id INTEGER NOT NULL,
        outcome TEXT NOT NULL, readable INTEGER NOT NULL
    ) STRICT;",
    )
}
#[derive(Serialize, Deserialize)]
pub struct MaterialInput {
    pub operation_id: String,
    pub name: String,
    pub content: String,
    pub segments: Vec<SegmentInput>,
    #[serde(default)]
    pub source: Option<super::source_media::YoutubeSource>,
    #[serde(default)]
    pub document: Option<super::document_source::DocumentSource>,
    #[serde(default)]
    pub normalized_kind: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub file_id: i64,
    pub outcome: String,
    pub readable: bool,
}

fn readable_english_segment(text: &str) -> bool {
    text.chars().any(|c| c.is_ascii_alphabetic())
        || (text.chars().any(char::is_numeric) && !text.chars().any(char::is_alphabetic))
}

/// An explicit re-import may restore missing provenance only for one byte-exact
/// original subtitle with the same English segments and times. No rows or saved
/// snapshots are replaced, including user translations and personal meanings.
fn attach_exact_source(
    conn: &Connection,
    input: &MaterialInput,
    hash: &str,
) -> Result<Option<i64>, String> {
    let Some(source) = input.source.as_ref().filter(|s| s.audio.is_some()) else {
        return Ok(None);
    };
    if source.subtitle_sha256 != super::source_media::digest(input.content.as_bytes()) {
        return Ok(None);
    }
    let cues: Vec<_> = super::youtube::parse_srt(&input.content)
        .into_iter()
        .enumerate()
        .map(|(id, c)| super::source_media::Cue {
            id: id as u32,
            start_ms: c.start_ms,
            end_ms: c.end_ms,
            text: c.text,
        })
        .collect();
    if cues != source.cues {
        return Ok(None);
    }
    let ids=conn.prepare("SELECT id FROM files WHERE content_hash=?1 AND content=?2 AND language='en' AND type='srt' AND media_source IS NULL AND media_identity IS NULL AND document_identity IS NULL ORDER BY id").map_err(|e|e.to_string())?.query_map(params![hash,input.content],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    if ids.len() != 1 {
        return Ok(None);
    }
    let id = ids[0];
    let rows=conn.prepare("SELECT index_num,en_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num,id").map_err(|e|e.to_string())?.query_map([id],|r|Ok((r.get::<_,i32>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    if rows.len() != input.segments.len()
        || rows.iter().zip(&input.segments).any(|(a, b)| {
            a.0 != b.index || a.1 != b.en_text || a.2 != b.start_time || a.3 != b.end_time
        })
    {
        return Ok(None);
    }
    conn.execute("UPDATE files SET media_source=?2,media_identity=?3 WHERE id=?1 AND media_source IS NULL AND media_identity IS NULL",params![id,serde_json::to_string(source).map_err(|e|e.to_string())?,source.key]).map_err(|e|e.to_string())?;
    Ok(Some(id))
}

/// Keep exact old TXT/SRT imports recognizable without rewriting their content,
/// hash, segment indices or saved identities. Normalized document offsets do
/// not belong to the legacy raw body and are therefore never attached to it.
fn legacy_document_duplicate(
    conn: &Connection,
    input: &MaterialInput,
) -> Result<Option<(i64, String, String)>, String> {
    let Some(document) = input
        .document
        .as_ref()
        .filter(|d| matches!(d.original_format.as_str(), "txt" | "srt"))
    else {
        return Ok(None);
    };
    let candidates=conn.prepare("SELECT id,content FROM files WHERE content_hash=?1 AND type=?2 AND language='en' AND document_identity IS NULL AND media_identity IS NULL ORDER BY id").map_err(|e|e.to_string())?
        .query_map(params![&document.source_sha256[..16],document.original_format],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    for (id, content) in candidates {
        if format!("{:x}", Sha256::digest(content.as_bytes())) != document.source_sha256 {
            continue;
        }
        let rows=conn.prepare("SELECT index_num,en_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num,id").map_err(|e|e.to_string())?.query_map([id],|r|Ok((r.get::<_,i32>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?))).map_err(|e|e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
        if rows.len() == input.segments.len()
            && rows.iter().zip(&input.segments).all(|(a, b)| {
                a.0 == b.index && a.1 == b.en_text && a.2 == b.start_time && a.3 == b.end_time
            })
        {
            return Ok(Some((id, "en".into(), document.original_format.clone())));
        }
    }
    Ok(None)
}

pub fn import_material(conn: &Connection, input: &MaterialInput) -> Result<ImportResult, String> {
    let name = input.name.to_lowercase();
    let kind = if input.document.is_some() {
        input
            .normalized_kind
            .as_deref()
            .filter(|v| matches!(*v, "txt" | "srt"))
            .ok_or("material_invalid_document")?
    } else if name.ends_with(".txt") {
        "txt"
    } else {
        "srt"
    };
    if let Some(document) = &input.document {
        if input.source.is_some()
            || document.display_name != input.name
            || (matches!(document.original_format.as_str(), "srt" | "vtt") != (kind == "srt"))
        {
            return Err("material_invalid_document".into());
        }
        document.validate(&input.content, Some(input.segments.len()))?;
        document.validate_segment_text(&input.segments)?;
    }
    if input.operation_id.is_empty()
        || input.operation_id.len() > 200
        || (input.document.is_none() && !(name.ends_with(".srt") || name.ends_with(".txt")))
        || input.content.trim().is_empty()
        || input.content.len() > 32 * 1024 * 1024
        || (input.document.is_none() && kind == "srt" && !input.content.contains("-->"))
        || input.segments.is_empty()
        || !input
            .segments
            .iter()
            .any(|s| s.en_text.chars().any(|c| c.is_ascii_alphabetic()))
        || input.segments.iter().enumerate().any(|(i, s)| {
            s.index != i as i32
                || !readable_english_segment(&s.en_text)
                || (kind == "srt" && (s.start_time.is_none() || s.end_time.is_none()))
                || (kind == "txt" && (s.start_time.is_some() || s.end_time.is_some()))
        })
    {
        return Err("material_invalid_srt".into());
    }
    if let Some(source) = &input.source {
        source.validate()?;
    }
    let request_hash = format!(
        "{:x}",
        Sha256::digest(
            if input.document.is_some() {
                serde_json::to_vec(&(
                    &input.name,
                    &input.content,
                    &input.segments,
                    &input.document,
                    &input.normalized_kind,
                ))
            } else if input.source.is_none() {
                serde_json::to_vec(&(&input.name, &input.content, &input.segments))
            } else {
                serde_json::to_vec(&(&input.name, &input.content, &input.segments, &input.source))
            }
            .map_err(|e| e.to_string())?
        )
    );
    let hash = format!("{:x}", Sha256::digest(input.content.as_bytes()))[..16].to_string();
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let receipt:Option<(String,i64,String,bool)>=tx.query_row("SELECT request_hash,file_id,outcome,readable FROM material_import_actions WHERE operation_id=?1",[&input.operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    if let Some((previous, id, outcome, readable)) = receipt {
        if previous != request_hash {
            return Err("material_operation_conflict".into());
        }
        let still_present = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE id=?1 AND ((?5 IS NOT NULL AND document_identity=?5) OR (?5 IS NULL AND content_hash=?2 AND (?3 IS NULL OR media_identity IS ?3) AND content=?4 AND document_identity IS NULL)))",
                params![id, hash,input.source.as_ref().map(|s|&s.key),input.content,input.document.as_ref().map(|s|&s.identity)],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?;
        if !still_present && legacy_document_duplicate(&tx, input)?.is_none_or(|v| v.0 != id) {
            return Err("material_source_removed".into());
        }
        return Ok(ImportResult {
            file_id: id,
            outcome,
            readable,
        });
    }
    let existing: Option<(i64, String, String)> = if let Some(document) = &input.document {
        // An extractor update may discover different text. An explicit new
        // import returns the original material, preserving saved offsets.
        tx.query_row(
            "SELECT id,language,type FROM files WHERE document_identity=?1 ORDER BY id LIMIT 1",
            [&document.identity],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .or(legacy_document_duplicate(&tx, input)?)
    } else {
        tx.query_row("SELECT id,language,type FROM files WHERE content_hash=?1 AND media_identity IS ?2 AND content=?3 AND document_identity IS NULL ORDER BY id LIMIT 1",
            params![hash,input.source.as_ref().map(|s|&s.key),input.content],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?
    };
    let existing = match existing {
        None if kind == "srt" && input.document.is_none() => {
            attach_exact_source(&tx, input, &hash)?.map(|id| (id, "en".into(), "srt".into()))
        }
        value => value,
    };
    let result = if let Some((id, language, kind)) = existing {
        ImportResult {
            file_id: id,
            outcome: "duplicate".into(),
            readable: language == "en" && matches!(kind.as_str(), "srt" | "txt"),
        }
    } else {
        tx.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language,media_source,media_identity,document_source,document_identity) VALUES(?1,?2,?3,?4,?5,'en',?6,?7,?8,?9)",params![input.name,kind,input.content,hash,super::saved::now_ms(),input.source.as_ref().map(|s|serde_json::to_string(s).unwrap()),input.source.as_ref().map(|s|&s.key),input.document.as_ref().map(|s|serde_json::to_string(s).unwrap()),input.document.as_ref().map(|s|&s.identity)]).map_err(|e|e.to_string())?;
        let id = tx.last_insert_rowid();
        super::tags::replace_file_tags(&tx, id, &[], &[])?;
        let mut statement=tx.prepare_cached("INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?1,?2,?3,?4,?5,?6)").map_err(|e|e.to_string())?;
        for segment in &input.segments {
            statement
                .execute(params![
                    id,
                    segment.index,
                    segment.en_text,
                    segment.zh_text,
                    segment.start_time,
                    segment.end_time
                ])
                .map_err(|e| e.to_string())?;
        }
        ImportResult {
            file_id: id,
            outcome: "created".into(),
            readable: true,
        }
    };
    tx.execute("INSERT INTO material_import_actions(operation_id,request_hash,file_id,outcome,readable) VALUES(?1,?2,?3,?4,?5)",params![input.operation_id,request_hash,result.file_id,result.outcome,result.readable]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
#[tauri::command]
pub async fn import_reading_material(
    state: State<'_, DbState>,
    input: MaterialInput,
) -> Result<ImportResult, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        import_material(&conn, &input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct ReadingTranslationPatch {
    pub id: i64,
    pub en_text: String,
    pub zh_text: String,
}
#[derive(Serialize)]
pub struct ReadingTranslationUpdate {
    pub id: i64,
    pub zh_text: String,
}
pub fn fill_translations(
    conn: &Connection,
    file_id: i64,
    content_hash: &str,
    segments: &[ReadingTranslationPatch],
) -> Result<Vec<ReadingTranslationUpdate>, String> {
    if segments.len() > 16
        || segments.iter().any(|s| {
            s.en_text.len() > 128 * 1024
                || s.zh_text.len() > 128 * 1024
                || s.zh_text.trim().is_empty()
        })
    {
        return Err("material_invalid_translation".into());
    }
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM files WHERE id=?1 AND content_hash=?2 AND language='en' AND media_source IS NULL)",params![file_id,content_hash],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !current {
        return Err("material_source_removed".into());
    }
    let mut updated = Vec::new();
    for segment in segments {
        let changed=tx.execute("UPDATE segments SET zh_text=?1 WHERE id=?2 AND file_id=?3 AND en_text=?4 AND (zh_text IS NULL OR trim(zh_text)='')",params![segment.zh_text,segment.id,file_id,segment.en_text]).map_err(|e|e.to_string())?;
        if changed == 1 {
            updated.push(ReadingTranslationUpdate {
                id: segment.id,
                zh_text: segment.zh_text.clone(),
            });
        } else {
            // A cancelled/lost response or another reader may already have
            // filled this exact English version. Confirm its current text
            // without changing any row or replacing a personal edit.
            let existing:Option<String>=tx.query_row("SELECT zh_text FROM segments WHERE id=?1 AND file_id=?2 AND en_text=?3 AND zh_text IS NOT NULL AND trim(zh_text)<>''",params![segment.id,file_id,segment.en_text],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
            if let Some(text) = existing {
                updated.push(ReadingTranslationUpdate {
                    id: segment.id,
                    zh_text: text,
                });
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated)
}
#[tauri::command]
pub async fn fill_reading_translations(
    state: State<'_, DbState>,
    file_id: i64,
    content_hash: String,
    segments: Vec<ReadingTranslationPatch>,
) -> Result<Vec<ReadingTranslationUpdate>, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        fill_translations(&conn, file_id, &content_hash, &segments)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Material {
    pub id: i64,
    pub name: String,
    pub content_hash: String,
    pub imported_at: i64,
    pub segment_count: i64,
    pub preview: String,
    pub tags: Vec<TagInfo>,
    pub source: Option<super::source_media::SourceSummary>,
    pub document: Option<super::document_source::DocumentSource>,
}
pub fn list(conn: &Connection, tag_ids: &[i64], untagged: bool) -> Result<Vec<Material>, String> {
    let ids = serde_json::to_string(tag_ids).unwrap();
    let mut stmt=conn.prepare("SELECT f.id,f.name,f.content_hash,f.imported_at,(SELECT COUNT(*) FROM segments s WHERE s.file_id=f.id),COALESCE((SELECT en_text FROM segments s WHERE s.file_id=f.id ORDER BY index_num LIMIT 1),''), f.media_source,f.document_source FROM files f
        WHERE f.language='en' AND f.type IN ('srt','txt') AND (?2=0 OR NOT EXISTS(SELECT 1 FROM file_tags ft WHERE ft.file_id=f.id))
        AND NOT EXISTS(SELECT 1 FROM json_each(?1) selected WHERE NOT EXISTS(SELECT 1 FROM file_tags ft WHERE ft.file_id=f.id AND ft.tag_id=selected.value)) ORDER BY imported_at DESC,id DESC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![ids, untagged], |r| {
            Ok(Material {
                id: r.get(0)?,
                name: r.get(1)?,
                content_hash: r.get(2)?,
                imported_at: r.get(3)?,
                segment_count: r.get(4)?,
                preview: r.get(5)?,
                tags: super::tags::file_tags(conn, r.get(0)?)?,
                source: r
                    .get::<_, Option<String>>(6)?
                    .and_then(|s| {
                        serde_json::from_str::<super::source_media::YoutubeSource>(&s).ok()
                    })
                    .map(Into::into),
                document: r
                    .get::<_, Option<String>>(7)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_materials(
    state: State<DbState>,
    tag_ids: Option<Vec<i64>>,
    untagged: Option<bool>,
) -> Result<Vec<Material>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    list(
        &conn,
        &tag_ids.unwrap_or_default(),
        untagged.unwrap_or(false),
    )
}
#[derive(Serialize)]
pub struct ReadingMaterial {
    pub material: Material,
    pub segments: Vec<super::files::SegmentInfo>,
    pub tokens: Vec<ReaderToken>,
    pub media_refs: std::collections::HashMap<i64, super::source_media::MediaRef>,
}
pub fn open(conn: &Connection, id: i64) -> Result<ReadingMaterial, String> {
    let material = list(conn, &[], false)?
        .into_iter()
        .find(|m| m.id == id)
        .ok_or("material_legacy_or_missing")?;
    let mut stmt=conn.prepare("SELECT id,index_num,en_text,zh_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num").map_err(|e|e.to_string())?;
    let segments = stmt
        .query_map([id], |r| {
            Ok(super::files::SegmentInfo {
                id: r.get(0)?,
                index_num: r.get(1)?,
                en_text: r.get(2)?,
                zh_text: r.get(3)?,
                start_time: r.get(4)?,
                end_time: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let tokens = segments
        .iter()
        .flat_map(|segment| {
            super::reader::latin_spans(&segment.en_text)
                .into_iter()
                .map(|(surface, start, end)| ReaderToken {
                    segment_index: segment.index_num,
                    language: "en".into(),
                    lemma: surface.to_lowercase(),
                    surface,
                    start,
                    end,
                    legacy_position: None,
                    builtin_position: None,
                    word_id: None,
                    status: None,
                })
        })
        .collect();
    let source: Option<String> = conn
        .query_row("SELECT media_source FROM files WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let source = source
        .and_then(|s| serde_json::from_str::<super::source_media::YoutubeSource>(&s).ok())
        .filter(|s| s.validate().is_ok());
    let expected = source
        .as_ref()
        .map(|s| super::source_media::bound_hash(conn, &s.key))
        .transpose()?
        .flatten();
    let media_refs = segments
        .iter()
        .filter_map(|segment| {
            source
                .as_ref()
                .and_then(|s| {
                    super::source_media::reference_for_segment(
                        s,
                        &segment.en_text,
                        segment.start_time.as_deref(),
                        segment.end_time.as_deref(),
                        expected.clone(),
                    )
                })
                .map(|r| (segment.id, r))
        })
        .collect();
    Ok(ReadingMaterial {
        media_refs,
        material,
        segments,
        tokens,
    })
}
#[tauri::command]
pub async fn open_reading_material(
    state: State<'_, DbState>,
    file_id: i64,
) -> Result<ReadingMaterial, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        open(&conn, file_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Explanation {
    pub meaning: String,
    pub source: String,
    pub provider: String,
    pub more: Vec<String>,
}
fn explanation_source(provider: &str) -> &'static str {
    let name = provider.to_lowercase();
    if matches!(name.as_str(), "manual" | "personal") {
        "personal"
    } else if ["ecdict", "phrasedict", "collins", "dictionaryapi.dev"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
    {
        "dictionary"
    } else if [
        "ollama", "gemma", "openai", "gpt", "qwen", "deepseek", "claude", "ai:",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        "ai"
    } else {
        "unknown"
    }
}
pub fn lookup(conn: &Connection, expression: &str) -> Result<Explanation, String> {
    let term = super::saved::normalize(expression);
    if term.is_empty() {
        return Err("ERR_DICTIONARY_NOT_FOUND".into());
    }
    if term.split_whitespace().count() == 1 {
        let entry = super::dictionary::lookup_offline_entry(conn, &term, "en")?
            .ok_or("ERR_DICTIONARY_NOT_FOUND")?;
        let meanings = entry
            .definitions
            .iter()
            .map(|d| {
                d.translation
                    .as_deref()
                    .filter(|v| !v.is_empty())
                    .unwrap_or(&d.definition)
                    .to_string()
            })
            .filter(|v| !v.trim().is_empty())
            .collect::<Vec<_>>();
        return Ok(Explanation {
            meaning: meanings
                .first()
                .cloned()
                .ok_or("ERR_DICTIONARY_NOT_FOUND")?,
            source: explanation_source(&entry.provider).into(),
            provider: entry.provider,
            more: meanings.into_iter().skip(1).collect(),
        });
    }
    let builtin: Option<String> = conn
        .query_row(
            "SELECT translation FROM builtin_phrase_dictionary WHERE text=?1",
            [&term],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(meaning) = builtin.filter(|v| !v.trim().is_empty()) {
        return Ok(Explanation {
            meaning,
            source: "dictionary".into(),
            provider: "PhraseDict".into(),
            more: vec![],
        });
    }
    let cached:Option<(String,String)>=conn.query_row("SELECT translation,provider FROM phrase_dictionary_entries WHERE language='en' AND text=?1 AND trim(translation)!=''",[term],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    cached
        .map(|(meaning, provider)| Explanation {
            meaning,
            source: explanation_source(&provider).into(),
            provider,
            more: vec![],
        })
        .ok_or("ERR_DICTIONARY_NOT_FOUND".into())
}
#[tauri::command]
pub async fn lookup_reading_expression(
    state: State<'_, DbState>,
    expression: String,
) -> Result<Explanation, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        lookup(&conn, &expression)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn english_material_keeps_numeric_utterances_and_their_timestamps() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("counting.db")).unwrap();
        for (operation, extension) in [("count-srt", "srt"), ("count-txt", "txt")] {
            let mut data = input(operation, "There are four colors.");
            data.name = format!("counting.{extension}");
            data.content = if extension == "srt" {
                "1\n00:04:43,280 --> 00:04:50,880\nThere are four colors. 1 2 3 4.\n".into()
            } else {
                "There are four colors. 1 2 3 4.".into()
            };
            if extension == "txt" {
                data.segments[0].start_time = None;
                data.segments[0].end_time = None;
            }
            data.segments.push(SegmentInput {
                index: 1,
                en_text: "1 2 3 4.".into(),
                zh_text: None,
                start_time: (extension == "srt").then(|| "00:04:43.280".into()),
                end_time: (extension == "srt").then(|| "00:04:50.880".into()),
            });
            let result = import_material(&c, &data).unwrap();
            let opened = open(&c, result.file_id).unwrap();
            assert_eq!(opened.segments[1].en_text, "1 2 3 4.");
            assert_eq!(opened.segments[1].start_time, data.segments[1].start_time);
            assert_eq!(opened.segments[1].end_time, data.segments[1].end_time);
            assert_eq!(import_material(&c, &data).unwrap().file_id, result.file_id);
        }
    }
    #[test]
    fn numeric_context_does_not_accept_empty_foreign_or_english_free_material() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("invalid-counting.db")).unwrap();
        assert_eq!(
            import_material(&c, &input("only-counts", "1 2 3 4.")).unwrap_err(),
            "material_invalid_srt"
        );
        for (index, text) in ["", " ", "...", "中文123", "Привет 123", "こんにちは123"]
            .iter()
            .enumerate()
        {
            let mut data = input(
                &format!("invalid-fragment-{index}"),
                "There are four colors.",
            );
            data.segments.push(SegmentInput {
                index: 1,
                en_text: (*text).into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:03.000".into()),
            });
            assert_eq!(
                import_material(&c, &data).unwrap_err(),
                "material_invalid_srt"
            );
        }
        assert_eq!(
            c.query_row("SELECT count(*) FROM files", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn text_material_roundtrips_original_sentences_translations_and_receipt() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("text.db")).unwrap();
        let mut data = input("text", "She bought a book.");
        data.name = "book.txt".into();
        data.content = "She bought a book. She read it.".into();
        data.segments[0].zh_text = Some("她买了一本书。".into());
        data.segments[0].start_time = None;
        data.segments[0].end_time = None;
        data.segments.push(SegmentInput {
            index: 1,
            en_text: "She read it.".into(),
            zh_text: Some("她读了它。".into()),
            start_time: None,
            end_time: None,
        });
        let result = import_material(&c, &data).unwrap();
        assert!(result.readable);
        let opened = open(&c, result.file_id).unwrap();
        assert_eq!(opened.segments.len(), 2);
        assert_eq!(opened.segments[1].zh_text.as_deref(), Some("她读了它。"));
        assert_eq!(import_material(&c, &data).unwrap().file_id, result.file_id);
        let original: String = c
            .query_row(
                "SELECT content FROM files WHERE id=?1",
                [result.file_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(original, data.content);
        data.operation_id = "text-duplicate".into();
        assert_eq!(import_material(&c, &data).unwrap().outcome, "duplicate");
    }
    fn input(op: &str, text: &str) -> MaterialInput {
        MaterialInput {
            document: None,
            normalized_kind: None,
            source: None,
            operation_id: op.into(),
            name: "flight.srt".into(),
            content: format!("1\n00:00:01,000 --> 00:00:03,000\n{text}\n"),
            segments: vec![SegmentInput {
                index: 0,
                en_text: text.into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:03.000".into()),
            }],
        }
    }
    #[test]
    fn material_import_retry_duplicate_and_save_are_independent_of_legacy_learning() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let first = import_material(&c, &input("a", "We take off at noon.")).unwrap();
        let retry = import_material(&c, &input("a", "We take off at noon.")).unwrap();
        assert_eq!(first.file_id, retry.file_id);
        assert_eq!(
            import_material(&c, &input("b", "We take off at noon."))
                .unwrap()
                .outcome,
            "duplicate"
        );
        let opened = open(&c, first.file_id).unwrap();
        assert!(!opened.tokens.is_empty());
        assert_eq!(opened.segments.len(), 1);
        let saved = super::super::saved::mutate(
            &c,
            "save",
            &super::super::saved::Mutation::Save {
                input: super::super::saved::SaveInput {
                    segment_id: opened.segments[0].id,
                    expression: "take off".into(),
                    start_offset: 3,
                    end_offset: 11,
                    explanation: None,
                    explanation_source: "unknown".into(),
                    dictionary_snapshot: None,
                    dictionary_reference: None,
                },
            },
        )
        .unwrap();
        c.execute("DELETE FROM files WHERE id=?1", [first.file_id])
            .unwrap();
        assert!(super::super::saved::get(&c, &saved.record.record_id)
            .unwrap()
            .is_some());
        assert!(import_material(&c, &input("a", "We take off at noon.")).is_err());
        for table in ["words", "phrases", "reviews", "phrase_reviews"] {
            assert_eq!(
                c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    #[test]
    fn failed_file_rolls_back_and_other_successes_stay_and_no_phrase_is_fabricated() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        import_material(&c, &input("good", "A good day.")).unwrap();
        c.execute_batch("CREATE TRIGGER fail_sentence BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT,'write failure'); END;").unwrap();
        assert!(import_material(&c, &input("bad", "Another day.")).is_err());
        assert_eq!(list(&c, &[], false).unwrap().len(), 1);
        c.execute(
            "INSERT INTO builtin_dictionary_entries(lemma,translation) VALUES('take','拿')",
            [],
        )
        .unwrap();
        assert_eq!(lookup(&c, "take").unwrap().meaning, "拿");
        assert!(lookup(&c, "take off").is_err());
        c.execute(
            "INSERT INTO builtin_phrase_dictionary(text,translation) VALUES('take off','起飞')",
            [],
        )
        .unwrap();
        assert_eq!(lookup(&c, "TAKE OFF").unwrap().meaning, "起飞");
    }
}

#[cfg(test)]
mod acceptance {
    use super::*;
    #[test]
    fn fresh_english_dictionaries_cover_the_fixed_useful_meaning_set() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("dictionary.db")).unwrap();
        super::super::dictionary::initialize_builtin_dictionary(&c).unwrap();
        super::super::dictionary::initialize_builtin_phrase_dictionary(&c).unwrap();
        let words = [
            ("apple", "苹"),
            ("book", "书"),
            ("water", "水"),
            ("food", "食"),
            ("house", "房"),
            ("school", "学"),
            ("friend", "友"),
            ("family", "家"),
            ("work", "工"),
            ("time", "时"),
            ("day", "天"),
            ("night", "夜"),
            ("morning", "早"),
            ("people", "人"),
            ("world", "世"),
            ("love", "爱"),
            ("happy", "快"),
            ("sad", "悲"),
            ("good", "好"),
            ("bad", "坏"),
            ("big", "大"),
            ("small", "小"),
            ("new", "新"),
            ("old", "老"),
            ("hot", "热"),
            ("cold", "冷"),
            ("fast", "快"),
            ("slow", "慢"),
            ("come", "来"),
            ("go", "去"),
            ("read", "读"),
            ("write", "写"),
            ("speak", "说"),
            ("listen", "听"),
            ("learn", "学"),
            ("understand", "懂"),
            ("remember", "记"),
            ("forget", "忘"),
            ("start", "始"),
            ("stop", "停"),
            ("open", "开"),
            ("close", "关"),
            ("help", "助"),
            ("need", "需"),
            ("want", "想"),
            ("think", "思"),
            ("know", "知"),
            ("see", "看"),
            ("hear", "听"),
            ("curiosity", "好奇"),
        ];
        let phrases = [
            ("take off", "起飞"),
            ("give up", "放弃"),
            ("turn on", "打开"),
            ("turn off", "关闭"),
            ("put on", "穿"),
            ("put off", "推迟"),
            ("pick up", "捡"),
            ("get up", "起床"),
            ("sit down", "坐"),
            ("come in", "进"),
            ("go out", "出去"),
            ("look for", "寻找"),
            ("look after", "照顾"),
            ("find out", "发现"),
            ("carry on", "继续"),
            ("come back", "回来"),
            ("go on", "继续"),
            ("wake up", "醒"),
            ("make sense", "道理"),
            ("in fact", "事实上"),
        ];
        let check = |set: &[(&str, &str)]| {
            set.iter()
                .filter(|(term, expected)| {
                    lookup(&c, term)
                        .map(|r| r.meaning.contains(expected))
                        .unwrap_or(false)
                })
                .count()
        };
        let word_count = check(&words);
        let phrase_count = check(&phrases);
        println!("Fixed dictionary usefulness: {word_count}/50 words, {phrase_count}/20 phrases (expected Chinese meaning fragments)");
        assert!(word_count >= 45);
        assert!(phrase_count >= 16);
        assert!(lookup(&c, "an invented unheard phrase xyzzy").is_err());
    }
    #[test]
    fn duplicate_transactions_and_restart_preserve_receipts_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("import.db");
        let c = crate::db::init_db(&path).unwrap();
        let make = |op: &str| MaterialInput {
            document: None,
            normalized_kind: None,
            source: None,
            operation_id: op.into(),
            name: "day.srt".into(),
            content: "1\n00:00:01,000 --> 00:00:03,000\nA good day.\n".into(),
            segments: vec![SegmentInput {
                index: 0,
                en_text: "A good day.".into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:03.000".into()),
            }],
        };
        let a = path.clone();
        let b = path.clone();
        let first = make("a");
        let second = make("b");
        let one = std::thread::spawn(move || {
            let c = crate::db::init_db(&a).unwrap();
            import_material(&c, &first).unwrap()
        });
        let two = std::thread::spawn(move || {
            let c = crate::db::init_db(&b).unwrap();
            import_material(&c, &second).unwrap()
        });
        assert_eq!(one.join().unwrap().file_id, two.join().unwrap().file_id);
        drop(c);
        let c = crate::db::init_db(&path).unwrap();
        assert_eq!(list(&c, &[], false).unwrap().len(), 1);
        assert!(import_material(&c, &make("a")).is_ok());
        let backup = super::super::export::backup_payload(&c).unwrap();
        assert_eq!(backup.data.material_import_actions.len(), 2);
        let target = crate::db::init_db(&dir.path().join("restored.db")).unwrap();
        super::super::export::restore_backup(&target, &backup).unwrap();
        assert!(import_material(&target, &make("a")).is_ok());
    }
}

#[cfg(test)]
mod source_tests {
    #[test]
    fn labels_cached_explanations_without_guessing_unknown_providers_are_ai() {
        for (provider, expected) in [
            ("ECDICT", "dictionary"),
            ("PhraseDict", "dictionary"),
            ("dictionaryapi.dev", "dictionary"),
            ("manual", "personal"),
            ("openai", "ai"),
            ("gemma3:4b", "ai"),
            ("unidentified-import", "unknown"),
        ] {
            assert_eq!(super::explanation_source(provider), expected);
        }
    }
}
