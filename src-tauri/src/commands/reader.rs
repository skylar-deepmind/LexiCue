//! Read-only lookup spans. These never create or renumber learning occurrences.
use super::{chinese, english, german, language};

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
pub struct ReaderToken {
    pub segment_index: i32,
    pub language: String,
    pub surface: String,
    pub lemma: String,
    pub start: usize,
    pub end: usize,
    pub legacy_position: Option<i32>,
    pub builtin_position: Option<i32>,
    pub word_id: Option<i64>,
    pub status: Option<String>,
}
fn latin_spans(text: &str) -> Vec<(String, usize, usize)> {
    let mut result = Vec::new();
    let mut start = None;
    let mut utf16 = 0;
    for (offset, c) in text
        .char_indices()
        .chain(std::iter::once((text.len(), ' ')))
    {
        if c.is_alphabetic() || start.is_some() && matches!(c, '\'' | '’' | '-') {
            if start.is_none() {
                start = Some((offset, utf16));
            }
        } else if let Some((begin, first)) = start.take() {
            let word = text[begin..offset].trim_end_matches(['\'', '’', '-']);
            if !word.is_empty() {
                result.push((word.into(), first, first + word.encode_utf16().count()));
            }
        }
        utf16 += c.len_utf16();
    }
    result
}
fn char_utf16_offsets(text: &str) -> Vec<usize> {
    let mut offsets = vec![0];
    let mut offset = 0;
    for c in text.chars() {
        offset += c.len_utf16();
        offsets.push(offset);
    }
    offsets
}
pub(crate) fn spans(text: &str, lang: &str) -> Result<Vec<(String, String, usize, usize)>, String> {
    let offsets = char_utf16_offsets(text);
    let chars_to_utf16 = |index| offsets[index];
    Ok(match lang {
        "en" => latin_spans(text)
            .into_iter()
            .map(|(surface, start, end)| {
                let parsed = english::tokenize_english(surface.replace('’', "'"))?
                    .into_iter()
                    .next();
                let lemma = parsed
                    .map(|t| t.lemma)
                    .unwrap_or_else(|| english::lemma_of_surface(&surface));
                Ok((surface, lemma, start, end))
            })
            .collect::<Result<Vec<_>, String>>()?,
        "de" => {
            let parsed = german::tokenize_german(text.into())?;
            let lemmas: std::collections::HashMap<_, _> =
                parsed.into_iter().map(|t| (t.surface, t.lemma)).collect();
            latin_spans(text)
                .into_iter()
                .map(|(surface, start, end)| {
                    let lemma = lemmas
                        .get(&surface)
                        .cloned()
                        .unwrap_or_else(|| surface.to_lowercase());
                    (surface, lemma, start, end)
                })
                .collect()
        }
        "zh" => chinese::tokenize_chinese_with_offsets(text)
            .into_iter()
            .map(|t| {
                (
                    t.surface.clone(),
                    t.surface,
                    chars_to_utf16(t.char_start),
                    chars_to_utf16(t.char_end),
                )
            })
            .collect(),
        "ja" => language::reader_japanese_spans(text),
        _ => return Err("ERR_DICTIONARY_LANGUAGE".into()),
    })
}
fn legacy_positions(
    text: &str,
    lang: &str,
) -> Result<std::collections::HashMap<usize, i32>, String> {
    let offsets = char_utf16_offsets(text);
    let utf16 = |index| offsets[index];
    let positions = match lang {
        "en" => english::tokenize_english_spans(text)
            .into_iter()
            .map(|t| (t.start, t.position))
            .collect(),
        "ja" => language::tokenize_japanese_with_offsets(text)
            .into_iter()
            .map(|t| (utf16(t.char_start), t.position))
            .collect(),
        "zh" => chinese::tokenize_chinese_with_offsets(text)
            .into_iter()
            .map(|t| (utf16(t.char_start), t.position))
            .collect(),
        "de" => {
            let mut cursor = 0;
            let mut utf16_cursor = 0;
            let mut positions = std::collections::HashMap::new();
            for token in german::tokenize_german(text.into())? {
                if let Some(offset) = text[cursor..].find(&token.surface) {
                    let start = cursor + offset;
                    let first = utf16_cursor + text[cursor..start].encode_utf16().count();
                    utf16_cursor = first + token.surface.encode_utf16().count();
                    cursor = start + token.surface.len();
                    positions.insert(first, token.position);
                }
            }
            positions
        }
        _ => return Err("ERR_DICTIONARY_LANGUAGE".into()),
    };
    Ok(positions)
}
fn tokens_for_file(conn: &Connection, file_id: i64) -> Result<Vec<ReaderToken>, String> {
    let lang: String = conn
        .query_row("SELECT language FROM files WHERE id=?1", [file_id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let mut select = conn
        .prepare("SELECT index_num,en_text FROM segments WHERE file_id=?1 ORDER BY index_num")
        .map_err(|e| e.to_string())?;
    let rows = select
        .query_map([file_id], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut saved = conn
        .prepare_cached("SELECT id,status FROM words WHERE language=?1 AND lemma=?2")
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        let (segment_index, text) = row.map_err(|e| e.to_string())?;
        let positions = legacy_positions(&text, &lang)?;
        let builtin_positions = if lang == "en" {
            super::import::en_phrase_positions(&text)
        } else {
            std::collections::HashMap::new()
        };
        for (surface, lemma, start, end) in spans(&text, &lang)? {
            let word: Option<(i64, String)> = saved
                .query_row([&lang, &lemma], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
                .map_err(|e| e.to_string())?;
            result.push(ReaderToken {
                segment_index,
                language: lang.clone(),
                surface,
                lemma,
                start,
                end,
                legacy_position: positions.get(&start).copied(),
                builtin_position: builtin_positions.get(&start).copied(),
                word_id: word.as_ref().map(|w| w.0),
                status: word.map(|w| w.1),
            });
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn get_file_reader_tokens(
    app: AppHandle,
    file_id: i64,
) -> Result<Vec<ReaderToken>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lexicue.db");
    tauri::async_runtime::spawn_blocking(move || {
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        tokens_for_file(&conn, file_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn english_builtin_and_ai_positions_keep_their_original_rules() {
        let text = "😀 Let's pick it up; pick it up.";
        let tokens = spans(text, "en").unwrap();
        let positions = legacy_positions(text, "en").unwrap();
        let picks: Vec<_> = tokens.iter().filter(|t| t.0 == "pick").collect();
        assert_eq!(positions[&picks[0].2], 2);
        assert_eq!(
            super::super::import::en_phrase_positions(text)[&picks[0].2],
            3
        );
        assert_eq!(positions[&picks[1].2], 5);
        assert_eq!(
            super::super::import::en_phrase_positions(text)[&picks[1].2],
            6
        );
    }
    #[test]
    fn full_reader_tokens_include_unsaved_words_without_mutating_occurrences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE files(id INTEGER,language TEXT); CREATE TABLE segments(file_id INTEGER,index_num INTEGER,en_text TEXT); CREATE TABLE words(id INTEGER,language TEXT,lemma TEXT,status TEXT); CREATE TABLE occurrences(id INTEGER,position INTEGER);
        INSERT INTO files VALUES(1,'en'); INSERT INTO segments VALUES(1,0,'😀 Picked, novelty; novelty.'); INSERT INTO words VALUES(7,'en','pick','known'); INSERT INTO occurrences VALUES(9,88);").unwrap();
        let changes = conn
            .query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap();
        let tokens = tokens_for_file(&conn, 1).unwrap();
        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens[0].word_id, Some(7));
        assert_eq!(tokens[0].legacy_position, Some(1));
        assert!(tokens[1].word_id.is_none());
        assert_ne!(tokens[1].start, tokens[2].start);
        assert_eq!(
            conn.query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            changes
        );
        assert_eq!(
            conn.query_row("SELECT position FROM occurrences WHERE id=9", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            88
        );
    }
    #[test]
    fn read_only_spans_preserve_utf16_and_repeated_terms() {
        for (lang, text) in [
            ("en", "😀 She picked it up; I'm here, here."),
            ("de", "😀 Über die Straße."),
            ("zh", "😀我学习中文。"),
            ("ja", "😀猫の手も借りたい。"),
        ] {
            let encoded: Vec<_> = text.encode_utf16().collect();
            let tokens = spans(text, lang).unwrap();
            assert!(!tokens.is_empty());
            for (surface, _, start, end) in tokens {
                assert_eq!(String::from_utf16(&encoded[start..end]).unwrap(), surface);
            }
        }
        let en = spans("here, here", "en").unwrap();
        assert_eq!(en.len(), 2);
        assert_ne!(en[0].2, en[1].2);
    }
}
