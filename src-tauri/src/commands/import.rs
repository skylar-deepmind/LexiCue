use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::State;

use crate::commands::chinese;
use crate::commands::language;
use crate::db::DbState;

#[derive(Deserialize)]
pub struct ImportPayload {
    pub name: String,
    pub file_type: String,
    pub content: String,
    pub content_hash: String,
    pub segments: Vec<SegmentInput>,
    pub lemmas: Vec<String>,
    pub occurrences: Vec<OccurrenceInput>,
    #[serde(default)]
    #[allow(dead_code)]
    pub phrase_occurrences: Option<Vec<PhraseOccurrenceInput>>,
    pub replace_file_id: Option<i64>,
    #[serde(default)]
    pub folder_id: Option<i64>,
    #[serde(default = "default_language")]
    pub language: String,
}

fn default_language() -> String {
    "en".to_string()
}

#[derive(Deserialize)]
pub struct SegmentInput {
    pub index: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Deserialize)]
pub struct OccurrenceInput {
    pub lemma: String,
    pub segment_index: i32,
    pub original_form: String,
    pub position: i32,
    #[serde(default)]
    pub reading: Option<String>,
    #[serde(default)]
    pub part_of_speech: Option<String>,
}

#[derive(Deserialize)]
pub struct PhraseOccurrenceInput {
    pub text: String,
    pub segment_index: i32,
    pub position: i32,
}

#[derive(Serialize)]
pub struct DuplicateCheck {
    pub file_id: i64,
    pub name: String,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn tokenize_en_text(text: &str) -> Vec<(String, i32)> {
    let cleaned = text
        .replace(
            |c: char| {
                c == '.'
                    || c == ','
                    || c == '!'
                    || c == '?'
                    || c == ';'
                    || c == ':'
                    || c == '('
                    || c == ')'
                    || c == '['
                    || c == ']'
                    || c == '{'
                    || c == '}'
                    || c == '"'
                    || c == '\''
                    || c == '`'
                    || c == '«'
                    || c == '»'
                    || c == '–'
                    || c == '—'
                    || c == '…'
                    || c == '@'
                    || c == '#'
                    || c == '$'
                    || c == '%'
                    || c == '^'
                    || c == '&'
                    || c == '*'
                    || c == '+'
                    || c == '='
                    || c == '<'
                    || c == '>'
                    || c == '/'
                    || c == '\\'
                    || c == '|'
                    || c == '~'
            },
            " ",
        )
        .replace("--", " ")
        .to_lowercase();

    let words: Vec<&str> = cleaned.split_whitespace().collect();
    words
        .iter()
        .enumerate()
        .filter_map(|(i, w)| {
            if w.is_empty() || (w.len() == 1 && *w != "a" && *w != "i") {
                return None;
            }
            if !w.chars().all(|c| c.is_ascii_alphabetic()) {
                return None;
            }
            Some((w.to_string(), i as i32))
        })
        .collect()
}

pub fn detect_phrases_in_segments(
    conn: &rusqlite::Connection,
    segment_texts: &[(i32, String)],
) -> Result<Vec<PhraseOccurrenceInput>, String> {
    let phrase_entries: Vec<(String, i32)> = {
        let mut stmt = conn
            .prepare("SELECT text, LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1 FROM builtin_phrase_dictionary")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut entries: Vec<_> = rows.filter_map(|r| r.ok()).collect();
        entries.sort_by_key(|(_, wc)| -wc);
        entries
    };

    let mut results: Vec<PhraseOccurrenceInput> = Vec::new();

    for (seg_idx, seg_text) in segment_texts {
        let words = tokenize_en_text(seg_text);
        let word_count = words.len();

        let mut occupied: HashSet<i32> = HashSet::new();

        for (phrase_text, phrase_word_count) in &phrase_entries {
            let phrase_len = *phrase_word_count as usize;
            if phrase_len > word_count {
                continue;
            }

            let phrase_parts: Vec<&str> = phrase_text.split_whitespace().collect();

            for start in 0..=word_count.saturating_sub(phrase_len) {
                if occupied.contains(&(start as i32)) {
                    continue;
                }

                let matches = phrase_parts.iter().enumerate().all(|(j, pw)| {
                    let idx = start + j;
                    idx < words.len() && words[idx].0 == *pw
                });

                if matches {
                    let position = words[start].1;
                    results.push(PhraseOccurrenceInput {
                        text: phrase_text.clone(),
                        segment_index: *seg_idx,
                        position,
                    });
                    for j in 0..phrase_len {
                        occupied.insert((start + j) as i32);
                    }
                }
            }
        }
    }

    Ok(results)
}

/// Detect built-in Chinese phrases (idioms/colloquial expressions) inside
/// segments. Chinese has no spaces, so a phrase must equal the concatenation
/// of a contiguous run of jieba tokens. Longest phrases are matched first and
/// overlapping spans are skipped.
pub fn detect_chinese_phrases_in_segments(
    conn: &rusqlite::Connection,
    segment_texts: &[(i32, String)],
) -> Result<Vec<PhraseOccurrenceInput>, String> {
    let mut phrase_entries: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT text FROM builtin_chinese_phrase_dictionary")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    phrase_entries.sort_by_key(|text| -(text.chars().count() as i64));

    let mut by_first: HashMap<char, Vec<&String>> = HashMap::new();
    for entry in &phrase_entries {
        if let Some(first) = entry.chars().next() {
            by_first.entry(first).or_default().push(entry);
        }
    }

    let mut results: Vec<PhraseOccurrenceInput> = Vec::new();

    for (seg_idx, seg_text) in segment_texts {
        let tokens = chinese::tokenize_chinese_with_offsets(seg_text);
        let surfaces: Vec<&str> = tokens.iter().map(|t| t.surface.as_str()).collect();
        let mut occupied: Vec<bool> = vec![false; surfaces.len()];

        for (start, surface) in surfaces.iter().enumerate() {
            if occupied[start] {
                continue;
            }
            let Some(first) = surface.chars().next() else {
                continue;
            };
            let Some(candidates) = by_first.get(&first) else {
                continue;
            };
            for phrase_text in candidates {
                let phrase_text: &String = phrase_text;
                let phrase_chars = phrase_text.chars().count();
                let mut built = String::new();
                let mut built_chars = 0;
                let mut end = start;
                while end < surfaces.len() && built_chars < phrase_chars {
                    if occupied[end] {
                        break;
                    }
                    built.push_str(surfaces[end]);
                    built_chars += surfaces[end].chars().count();
                    if built == *phrase_text {
                        results.push(PhraseOccurrenceInput {
                            text: phrase_text.clone(),
                            segment_index: *seg_idx,
                            position: tokens[start].position,
                        });
                        occupied[start..=end].fill(true);
                        break;
                    }
                    if !phrase_text.starts_with(&built) {
                        break;
                    }
                    end += 1;
                }
            }
        }
    }

    Ok(results)
}

/// Detect built-in Japanese idioms inside segments. Japanese text has no
/// spaces and particles sit between content words, so a phrase is matched as a
/// literal substring and then mapped back to the content-token position used by
/// the reading page. Longest phrases are matched first and overlapping spans
/// are skipped.
pub fn detect_japanese_phrases_in_segments(
    conn: &rusqlite::Connection,
    segment_texts: &[(i32, String)],
) -> Result<Vec<PhraseOccurrenceInput>, String> {
    let mut phrase_entries: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT text FROM builtin_japanese_phrase_dictionary")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    phrase_entries.sort_by_key(|text| -(text.chars().count() as i64));

    let mut results: Vec<PhraseOccurrenceInput> = Vec::new();

    for (seg_idx, seg_text) in segment_texts {
        let tokens = language::tokenize_japanese_with_offsets(seg_text);
        if tokens.is_empty() {
            continue;
        }
        let mut occupied: Vec<bool> = vec![false; tokens.len()];
        let normalized = seg_text.to_lowercase();

        for phrase_text in &phrase_entries {
            let phrase_lower = phrase_text.to_lowercase();
            let phrase_len = language::tokenize_japanese_with_offsets(&phrase_lower).len();
            if phrase_len == 0 {
                continue;
            }
            let mut search_byte = 0usize;
            while let Some(byte_rel) = normalized[search_byte..].find(&phrase_lower) {
                let byte_start = search_byte + byte_rel;
                let char_start = normalized[..byte_start].chars().count();
                search_byte = byte_start + phrase_lower.len();
                let Some(token) = tokens
                    .iter()
                    .find(|t| t.char_start <= char_start && char_start < t.char_end)
                else {
                    continue;
                };
                let start_pos = token.position as usize;
                let end_pos = start_pos + phrase_len;
                if end_pos > tokens.len()
                    || occupied[start_pos..end_pos].iter().any(|&o| o)
                {
                    continue;
                }
                occupied[start_pos..end_pos].fill(true);
                results.push(PhraseOccurrenceInput {
                    text: phrase_text.clone(),
                    segment_index: *seg_idx,
                    position: token.position,
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn import_file(state: State<DbState>, payload: ImportPayload) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<i64, String> {
        let now = now_ms();

        if let Some(file_id) = payload.replace_file_id {
            conn.execute("DELETE FROM files WHERE id = ?1", params![file_id])
                .map_err(|e| e.to_string())?;
        }

        conn.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at, language, folder_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![payload.name, payload.file_type, payload.content, payload.content_hash, now, payload.language, payload.folder_id],
        ).map_err(|e| e.to_string())?;
        let file_id = conn.last_insert_rowid();

        {
            let mut stmt = conn
                .prepare("INSERT OR IGNORE INTO words (language, lemma) VALUES (?1, ?2)")
                .map_err(|e| e.to_string())?;
            for lemma in &payload.lemmas {
                stmt.execute(params![payload.language, lemma])
                    .map_err(|e| e.to_string())?;
            }
        }

        let mut word_id_map: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, lemma FROM words WHERE language = ?1 AND lemma = ?2")
                .map_err(|e| e.to_string())?;
            for lemma in &payload.lemmas {
                if word_id_map.contains_key(lemma) {
                    continue;
                }
                let id: i64 = stmt
                    .query_row(params![payload.language, lemma], |row| row.get(0))
                    .map_err(|e| e.to_string())?;
                word_id_map.insert(lemma.clone(), id);
            }
        }

        let mut seg_id_map: HashMap<i32, i64> = HashMap::new();
        let mut seg_texts: Vec<(i32, String)> = Vec::new();
        {
            let mut stmt = conn
                .prepare("INSERT INTO segments (file_id, index_num, en_text, zh_text, start_time, end_time) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id")
                .map_err(|e| e.to_string())?;
            for seg in &payload.segments {
                let id: i64 = stmt
                    .query_row(
                        params![
                            file_id,
                            seg.index,
                            seg.en_text,
                            seg.zh_text,
                            seg.start_time,
                            seg.end_time
                        ],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                seg_id_map.insert(seg.index, id);
                seg_texts.push((seg.index, seg.en_text.clone()));
            }
        }

        {
            let mut stmt = conn
                .prepare("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, ?2, ?3, ?4)")
                .map_err(|e| e.to_string())?;
            for occ in &payload.occurrences {
                let word_id = *word_id_map
                    .get(&occ.lemma)
                    .ok_or_else(|| format!("lemma not found: {}", occ.lemma))?;
                let seg_id = *seg_id_map
                    .get(&occ.segment_index)
                    .ok_or_else(|| format!("segment index not found: {}", occ.segment_index))?;
                stmt.execute(params![word_id, seg_id, occ.original_form, occ.position])
                    .map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE words SET reading = COALESCE(?1, reading), part_of_speech = COALESCE(?2, part_of_speech) WHERE id = ?3",
                    params![occ.reading, occ.part_of_speech, word_id],
                ).map_err(|e| e.to_string())?;
            }
        }

        let detected_phrases = match payload.language.as_str() {
            "en" => detect_phrases_in_segments(&conn, &seg_texts)?,
            "zh" => detect_chinese_phrases_in_segments(&conn, &seg_texts)?,
            "ja" => detect_japanese_phrases_in_segments(&conn, &seg_texts)?,
            _ => Vec::new(),
        };

        {
            let mut phrase_stmt = conn
                .prepare("INSERT OR IGNORE INTO phrases (language, text, source) VALUES (?1, ?2, 'detected')")
                .map_err(|e| e.to_string())?;
            for ph in &detected_phrases {
                phrase_stmt
                    .execute(params![payload.language, ph.text])
                    .map_err(|e| e.to_string())?;
            }
        }

        let mut phrase_id_map: HashMap<String, i64> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, text FROM phrases WHERE language = ?1 AND text = ?2")
                .map_err(|e| e.to_string())?;
            let unique_texts: HashSet<&str> =
                detected_phrases.iter().map(|p| p.text.as_str()).collect();
            for text in unique_texts {
                if phrase_id_map.contains_key(text) {
                    continue;
                }
                let id: i64 = stmt
                    .query_row(params![payload.language, text], |row| row.get(0))
                    .map_err(|e| e.to_string())?;
                phrase_id_map.insert(text.to_string(), id);
            }
        }

        {
            let mut stmt = conn
                .prepare("INSERT INTO phrase_occurrences (phrase_id, segment_id, position) VALUES (?1, ?2, ?3)")
                .map_err(|e| e.to_string())?;
            for po in &detected_phrases {
                let phrase_id = *phrase_id_map
                    .get(&po.text)
                    .ok_or_else(|| format!("phrase not found: {}", po.text))?;
                let seg_id = *seg_id_map
                    .get(&po.segment_index)
                    .ok_or_else(|| format!("segment index not found: {}", po.segment_index))?;
                stmt.execute(params![phrase_id, seg_id, po.position])
                    .map_err(|e| e.to_string())?;
            }
        }

        Ok(file_id)
    })();

    match result {
        Ok(file_id) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(file_id)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn check_duplicate(
    state: State<DbState>,
    hash: String,
) -> Result<Option<DuplicateCheck>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name FROM files WHERE content_hash = ?1")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(params![hash], |row| {
        Ok(DuplicateCheck {
            file_id: row.get(0)?,
            name: row.get(1)?,
        })
    });

    match result {
        Ok(dup) => Ok(Some(dup)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phrase_db(entries: &[(&str, &str)]) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE builtin_chinese_phrase_dictionary (
                text TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                category TEXT
            ) STRICT;",
        )
        .unwrap();
        for (text, translation) in entries {
            conn.execute(
                "INSERT INTO builtin_chinese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, 'test', ?2, '成语')",
                params![text, translation],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn detects_chinese_phrases_in_segments() {
        let conn = phrase_db(&[("举足轻重", "critical"), ("发挥作用", "to play a role")]);
        let segments = vec![(0, "他的意见举足轻重。".to_string()), (1, "我们要充分发挥每个人的作用。".to_string())];
        let result = detect_chinese_phrases_in_segments(&conn, &segments).unwrap();
        let texts: Vec<&str> = result.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"举足轻重"));
        for phrase in result {
            assert!(phrase.position >= 0);
        }
    }

    #[test]
    fn chinese_phrase_positions_are_jieba_token_indexes() {
        let conn = phrase_db(&[("发挥", "to bring into play")]);
        let segments = vec![(0, "我们要发挥他的特长".to_string())];
        let result = detect_chinese_phrases_in_segments(&conn, &segments).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "发挥");
        // jieba tokens: 我们(0) 要(1) 发挥(2) 他(3) 的(4) 特长(5)
        assert_eq!(result[0].position, 2);
    }

    #[test]
    fn longest_match_wins_and_no_overlap() {
        let conn = phrase_db(&[("发挥", "bring out"), ("发挥重要作用", "play an important role")]);
        let segments = vec![(0, "它能发挥重要作用。".to_string())];
        let result = detect_chinese_phrases_in_segments(&conn, &segments).unwrap();
        let texts: Vec<&str> = result.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"发挥重要作用"));
        assert!(!texts.contains(&"发挥"), "short phrase should be shadowed by the longer one");
    }

    fn ja_phrase_db(entries: &[&str]) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE builtin_japanese_phrase_dictionary (
                text TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                category TEXT
            ) STRICT;",
        )
        .unwrap();
        for text in entries {
            conn.execute(
                "INSERT INTO builtin_japanese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, 'test', 'test', '慣用句')",
                params![text],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn detects_japanese_phrases_in_segments() {
        let conn = ja_phrase_db(&["話が通じない", "肩を並べる"]);
        let segments = vec![(0, "彼は話が通じない人だ。".to_string())];
        let result = detect_japanese_phrases_in_segments(&conn, &segments).unwrap();
        let texts: Vec<&str> = result.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"話が通じない"));
        assert!(!texts.contains(&"肩を並べる"));
        for phrase in result {
            assert!(phrase.position >= 0);
        }
    }

    #[test]
    fn japanese_phrase_positions_are_lindera_token_indexes() {
        let conn = ja_phrase_db(&["話が通じない"]);
        let segments = vec![(0, "彼は話が通じない人だ。".to_string())];
        let result = detect_japanese_phrases_in_segments(&conn, &segments).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "話が通じない");
        // lindera content tokens: 彼(0) 話(1) 通じ(2) 人(3)
        assert_eq!(result[0].position, 1);
    }

    #[test]
    fn japanese_longest_match_wins_and_no_overlap() {
        let conn = ja_phrase_db(&["話が通じる", "話が通じない"]);
        let segments = vec![(0, "彼は話が通じない人だ。".to_string())];
        let result = detect_japanese_phrases_in_segments(&conn, &segments).unwrap();
        let texts: Vec<&str> = result.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"話が通じない"));
        assert!(!texts.contains(&"話が通じる"), "overlapping phrase should be shadowed");
    }
}
