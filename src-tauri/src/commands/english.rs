use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::OnceLock;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct EnglishToken {
    pub surface: String,
    pub lemma: String,
    pub part_of_speech: Option<String>,
    pub position: i32,
    pub word_kind: String,
}

struct EnglishWordforms {
    map: HashMap<String, Vec<WordformCandidate>>,
    lemmas: HashSet<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct WordformCandidate {
    lemma: String,
    pos: Option<String>,
    relation: String,
    frequency: u64,
}

fn load_wordforms() -> &'static EnglishWordforms {
    static WORDFORMS: OnceLock<EnglishWordforms> = OnceLock::new();
    WORDFORMS.get_or_init(|| {
        let mut decoder = flate2::read::GzDecoder::new(
            include_bytes!("../../resources/english_wordforms.tsv.gz").as_slice(),
        );
        let mut contents = String::new();
        decoder
            .read_to_string(&mut contents)
            .expect("failed to read english_wordforms.tsv.gz");
        let mut map: HashMap<String, Vec<WordformCandidate>> = HashMap::new();
        let mut lemmas = HashSet::new();
        for line in contents.lines() {
            let mut fields = line.split('\t');
            let surface = fields.next().unwrap_or_default().trim();
            let lemma = fields.next().unwrap_or_default().trim();
            let pos = fields.next().unwrap_or_default().trim();
            let relation = fields.next().unwrap_or(if surface == lemma { "headword" } else { "inflection" }).trim();
            let frequency = fields.next().and_then(|value| value.parse().ok()).unwrap_or(0);
            if surface.is_empty() || lemma.is_empty() {
                continue;
            }
            lemmas.insert(lemma.to_string());
            let candidate = WordformCandidate {
                lemma: lemma.to_string(),
                pos: (!pos.is_empty()).then(|| pos.to_string()),
                relation: relation.to_string(),
                frequency,
            };
            let candidates = map.entry(surface.to_string()).or_default();
            if !candidates.contains(&candidate) { candidates.push(candidate); }
        }
        EnglishWordforms { map, lemmas }
    })
}

fn conservative_wordform_candidates(surface: &str) -> Vec<WordformCandidate> {
    let lower = surface.to_lowercase();
    let wordforms = load_wordforms();
    let mut candidates = wordforms.map.get(&lower).cloned().unwrap_or_default();
    let mut add = |lemma: String, pos: &str| {
        if wordforms.lemmas.contains(&lemma) && !candidates.iter().any(|item| item.lemma == lemma) {
            candidates.push(WordformCandidate {
                lemma,
                pos: Some(pos.to_string()),
                relation: "inferred_plural".into(),
                frequency: 0,
            });
        }
    };
    if lower.ends_with("ies") && lower.len() > 3 {
        add(format!("{}y", &lower[..lower.len() - 3]), "noun");
    }
    if lower.ends_with("es") && !lower.ends_with("ies") && lower.len() > 2 {
        add(lower[..lower.len() - 2].to_string(), "noun");
    }
    if lower.ends_with('s') && !lower.ends_with("ss") && !lower.ends_with("es") && !lower.ends_with("ies") && lower.len() > 1 {
        add(lower[..lower.len() - 1].to_string(), "noun");
    }
    candidates
}

pub fn lemma_candidates(surface: &str) -> Vec<(String, Option<String>)> {
    let lower = surface.trim().to_lowercase();
    let mut candidates: Vec<(String, Option<String>)> = conservative_wordform_candidates(&lower)
        .into_iter()
        .map(|item| (item.lemma, item.pos))
        .collect();
    if candidates.is_empty() { candidates.push((lower, None)); }
    candidates
}

/// Check a proposed lemma against every recorded analysis of the surface.
/// This is suitable when another source already supplied the intended lemma
/// (for example an AI phrase candidate). Automatic word-list merging remains
/// deliberately stricter and uses `lemma_of_surface` instead.
pub fn surface_matches_lemma(surface: &str, expected: &str) -> bool {
    let expected = expected.trim().to_lowercase();
    let surface = surface.trim().to_lowercase();
    surface == expected
        || lemma_candidates(&surface)
            .iter()
            .any(|(lemma, _)| lemma == &expected)
}

fn resolved_form(surface: &str) -> (String, Option<String>, bool) {
    let lower = surface.trim().to_lowercase();
    if matches!(lower.as_str(), "enrolled" | "enrolling") {
        return ("enroll".to_string(), Some("verb".to_string()), false);
    }
    if matches!(lower.as_str(), "better" | "best" | "barking") {
        return (lower, None, true);
    }
    let detailed = conservative_wordform_candidates(&lower);
    let candidates = lemma_candidates(&lower);
    let distinct: HashSet<&str> = candidates.iter().map(|(lemma, _)| lemma.as_str()).collect();
    let mut seen_non_self = HashSet::new();
    let non_self: Vec<&(String, Option<String>)> = candidates
        .iter()
        .filter(|(lemma, _)| lemma != &lower && seen_non_self.insert(lemma.as_str()))
        .collect();
    if (lower.ends_with('s') || lower.ends_with("ies")) && non_self.len() == 1 {
        return (non_self[0].0.clone(), non_self[0].1.clone(), false);
    }

    // Some irregular forms have several historical or dialectal analyses in
    // Kaikki (for example went -> go/wend/gan). Preserve all candidates for
    // inspection, but auto-resolve only when one inflection lemma has a clear
    // corpus-frequency advantage over every other inflection candidate.
    let mut inflections: HashMap<&str, (&WordformCandidate, u64)> = HashMap::new();
    for candidate in detailed.iter().filter(|candidate| {
        candidate.lemma != lower && candidate.relation != "headword"
    }) {
        let entry = inflections
            .entry(candidate.lemma.as_str())
            .or_insert((candidate, candidate.frequency));
        if candidate.frequency > entry.1 {
            *entry = (candidate, candidate.frequency);
        }
    }
    let mut ranked: Vec<(&WordformCandidate, u64)> = inflections.into_values().collect();
    ranked.sort_by(|left, right| right.1.cmp(&left.1));
    let runner_up = ranked.get(1).map(|candidate| candidate.1).unwrap_or(0);
    let self_frequency = detailed
        .iter()
        .filter(|candidate| candidate.lemma == lower)
        .map(|candidate| candidate.frequency)
        .max()
        .unwrap_or(0);
    let regular_suffix = lower.ends_with("ed")
        || lower.ends_with("ing")
        || lower.ends_with("er")
        || lower.ends_with("est");
    let dominant_inflection = ranked.first().is_some_and(|candidate| {
        candidate.1 > 0
            && (runner_up == 0 || candidate.1 >= runner_up.saturating_mul(10))
            && (regular_suffix
                || self_frequency == 0
                || candidate.1 >= self_frequency.saturating_mul(8))
    });
    if dominant_inflection {
        return (
            ranked[0].0.lemma.clone(),
            ranked[0].0.pos.clone(),
            false,
        );
    }
    if distinct.len() != 1 { return (lower, None, true); }
    let (lemma, pos) = candidates[0].clone();
    (lemma, pos, false)
}

/// Reduce only an unambiguous surface form to its base lemma.
pub fn lemma_of_surface(surface: &str) -> String {
    resolved_form(surface).0
}

/// Possible British/American counterparts. Callers must verify that a
/// candidate is an actual dictionary headword before accepting it.
pub fn spelling_variants(word: &str) -> Vec<String> {
    let lower = word.trim().to_lowercase();
    let mut variants = Vec::new();
    match lower.as_str() {
        "enroll" => variants.push("enrol".to_string()),
        "enrollment" => variants.push("enrolment".to_string()),
        "enrolled" => variants.push("enrol".to_string()),
        "enrolling" => variants.push("enrol".to_string()),
        "enrol" => variants.push("enroll".to_string()),
        "enrolment" => variants.push("enrollment".to_string()),
        _ => {}
    }
    if lower.ends_with("ize") { variants.push(format!("{}ise", &lower[..lower.len() - 3])); }
    if lower.ends_with("ise") { variants.push(format!("{}ize", &lower[..lower.len() - 3])); }
    if lower.ends_with("ization") { variants.push(format!("{}isation", &lower[..lower.len() - 7])); }
    if lower.ends_with("isation") { variants.push(format!("{}ization", &lower[..lower.len() - 7])); }
    if lower.ends_with("or") { variants.push(format!("{}our", &lower[..lower.len() - 2])); }
    if lower.ends_with("our") { variants.push(format!("{}or", &lower[..lower.len() - 3])); }
    variants.sort();
    variants.dedup();
    variants
}

// Mirrors the punctuation set stripped by import.rs so that English tokens and
// their (possibly gapped) positions stay aligned with phrase detection.
fn is_stripped(c: char) -> bool {
    matches!(
        c,
        '.' | ','
            | '!'
            | '?'
            | ';'
            | ':'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '"'
            | '\''
            | '`'
            | '«'
            | '»'
            | '–'
            | '—'
            | '…'
            | '@'
            | '#'
            | '$'
            | '%'
            | '^'
            | '&'
            | '*'
            | '+'
            | '='
            | '<'
            | '>'
            | '/'
            | '\\'
            | '|'
            | '~'
    )
}

fn is_web_noise(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("www.")
        || (lower.contains('@') && lower.contains('.'))
        || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".mp3", ".mp4", ".srt", ".txt", ".html"]
            .iter().any(|suffix| lower.trim_matches(|c: char| c.is_ascii_punctuation()).ends_with(suffix))
}

fn contraction_base(raw: &str) -> String {
    let normalized = raw.replace(['’', '‘'], "'");
    let lower = normalized.to_ascii_lowercase();
    let base = match lower.as_str() {
        "won't" => "will".into(), "can't" => "can".into(), "shan't" => "shall".into(),
        "don't" => "do".into(), "doesn't" => "does".into(), "didn't" => "did".into(),
        "isn't" => "is".into(), "aren't" => "are".into(), "wasn't" => "was".into(), "weren't" => "were".into(),
        "hasn't" => "has".into(), "haven't" => "have".into(), "hadn't" => "had".into(),
        _ => ["'re", "'ve", "'ll", "'m", "'d", "'s", "n't"].iter()
            .find_map(|suffix| lower.strip_suffix(suffix).map(str::to_string))
            .filter(|base| !base.is_empty()).unwrap_or(normalized),
    };
    if raw.chars().next().is_some_and(char::is_uppercase) {
        let mut chars = base.chars();
        chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or(base)
    } else {
        base
    }
}

pub(crate) fn tokenize_english_text(text: &str) -> Vec<(String, i32)> {
    text.split_whitespace()
        .enumerate()
        .filter_map(|(i, raw)| {
            if is_web_noise(raw) || raw.contains('-') { return None; }
            let trimmed = raw.trim_matches(|c: char| is_stripped(c) || c.is_ascii_digit());
            let word = contraction_base(trimmed);
            let lower = word.to_ascii_lowercase();
            if lower.is_empty()
                || (lower.len() == 1 && lower != "a" && lower != "i")
                || !lower.chars().all(|c| c.is_ascii_alphabetic())
            {
                return None;
            }
            let surface = if word.eq_ignore_ascii_case(trimmed) { word } else { word };
            Some((surface, i as i32))
        })
        .collect()
}

fn lemmatize_tokens(tokens: Vec<(String, i32)>, wordforms: &EnglishWordforms) -> Vec<EnglishToken> {
    tokens
        .into_iter()
        .map(|(surface, position)| {
            let lower = surface.to_lowercase();
            let (lemma, part_of_speech, ambiguous) = resolved_form(&lower);
            let known = wordforms.map.contains_key(&lower) || wordforms.lemmas.contains(&lower);
            let proper = surface.chars().next().is_some_and(char::is_uppercase) && position > 0 && !known;
            EnglishToken {
                surface,
                lemma,
                part_of_speech,
                position,
                word_kind: if ambiguous { "ambiguous" } else if proper { "proper_noun" } else { "common" }.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn tokenize_english(text: String) -> Result<Vec<EnglishToken>, String> {
    let wordforms = load_wordforms();
    Ok(lemmatize_tokens(tokenize_english_text(&text), wordforms))
}

#[tauri::command]
pub fn tokenize_english_batch(texts: Vec<String>) -> Result<Vec<Vec<EnglishToken>>, String> {
    let wordforms = load_wordforms();
    Ok(texts
        .iter()
        .map(|text| lemmatize_tokens(tokenize_english_text(text), wordforms))
        .collect())
}

#[tauri::command]
pub fn lemmatize_english(words: Vec<String>) -> Result<Vec<String>, String> {
    Ok(words.iter().map(|word| lemma_of_surface(word)).collect())
}

#[tauri::command]
pub fn english_word_candidates(word: String) -> Vec<String> {
    let lower = word.trim().to_lowercase();
    let mut values: Vec<String> = lemma_candidates(&lower).into_iter().map(|value| value.0).collect();
    if lower == "better" { values.extend(["good".into(), "well".into()]); }
    if lower == "barking" { values.push("bark".into()); }
    values.push(lower);
    values.sort(); values.dedup(); values
}

/// Rewrite English word rows so their lemma is the canonical base form, merging
/// surface-form rows (e.g. "books", "went") into the base-form row (e.g.
/// "book", "go"). Occurrences, review history and definitions are preserved.
/// Idempotent: once every English lemma is canonical it becomes a no-op.
pub fn migrate_english_lemmas(conn: &rusqlite::Connection) -> Result<i64, String> {
    let mut stmt = conn
        .prepare("SELECT id, lemma FROM words WHERE language = 'en'")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|row| row.ok())
        .collect();

    let mut merged: i64 = 0;
    for (id, lemma) in rows {
        conn.execute("INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) VALUES(?1,lower(?2),'legacy')", rusqlite::params![id, lemma]).map_err(|e| e.to_string())?;
        let (resolved, _, ambiguous) = resolved_form(&lemma);
        let known = load_wordforms().map.contains_key(&lemma.to_lowercase()) || load_wordforms().lemmas.contains(&lemma.to_lowercase());
        let title_only: bool = conn.query_row(
            "SELECT COUNT(*)>0 AND MIN(CASE WHEN original_form GLOB '[A-Z]*' AND position>0 THEN 1 ELSE 0 END)=1 FROM occurrences WHERE word_id=?1",
            [id], |row| row.get(0),
        ).unwrap_or(false);
        if !known && title_only {
            conn.execute("UPDATE words SET word_kind='proper_noun' WHERE id=?1 AND kind_edited=0", [id]).map_err(|e| e.to_string())?;
        }
        if ambiguous {
            conn.execute("UPDATE words SET word_kind='ambiguous' WHERE id=?1 AND kind_edited=0", [id]).map_err(|e| e.to_string())?;
        }
        if resolved == lemma {
            continue;
        }

        let target: Option<i64> = conn
            .query_row(
                "SELECT id FROM words WHERE language = 'en' AND lemma = ?1",
                [&resolved],
                |row| row.get(0),
            )
            .ok();

        match target {
            Some(target_id) if target_id != id => {
                let status_rank = |status: &str| match status { "learning" => 4, "known" => 3, "unprocessed" => 2, _ => 1 };
                let (target_status, source_status, target_note, source_note): (String,String,Option<String>,Option<String>) = conn.query_row(
                    "SELECT t.status,s.status,t.definition,s.definition FROM words t JOIN words s ON s.id=?2 WHERE t.id=?1",
                    rusqlite::params![target_id,id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
                ).map_err(|e| e.to_string())?;
                let status = if status_rank(&source_status) > status_rank(&target_status) { source_status } else { target_status };
                let definition = match (target_note, source_note) {
                    (Some(a), Some(b)) if a.trim() != b.trim() => Some(format!("[{}] {}\n[{}] {}", resolved, a, lemma, b)),
                    (Some(a), _) => Some(a), (_, Some(b)) => Some(b), _ => None,
                };
                conn.execute(
                    "UPDATE words SET
                         definition = ?3, status=?4,
                         reading = COALESCE(reading, (SELECT reading FROM words WHERE id = ?2)),
                         part_of_speech = COALESCE(part_of_speech, (SELECT part_of_speech FROM words WHERE id = ?2))
                     WHERE id = ?1",
                    rusqlite::params![target_id, id, definition, status],
                )
                .map_err(|e| e.to_string())?;

                conn.execute("INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) SELECT ?1,alias,alias_kind FROM word_aliases WHERE word_id=?2", rusqlite::params![target_id,id]).map_err(|e| e.to_string())?;

                conn.execute(
                    "UPDATE occurrences SET word_id = ?1 WHERE word_id = ?2",
                    rusqlite::params![target_id, id],
                )
                .map_err(|e| e.to_string())?;

                let has_review = |word_id: i64| -> Result<bool, String> {
                    conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM reviews WHERE word_id = ?1)",
                        [word_id],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())
                };
                let (src_review, target_review) = (has_review(id)?, has_review(target_id)?);
                if src_review && target_review {
                    let source_better: bool = conn.query_row(
                        "SELECT (s.reps>t.reps) OR (s.reps=t.reps AND COALESCE(s.last_review_at,0)>COALESCE(t.last_review_at,0)) FROM reviews s JOIN reviews t ON t.word_id=?1 WHERE s.word_id=?2",
                        rusqlite::params![target_id,id], |row| row.get(0),
                    ).map_err(|e| e.to_string())?;
                    if source_better {
                        conn.execute("DELETE FROM reviews WHERE word_id=?1", [target_id]).map_err(|e| e.to_string())?;
                        conn.execute("UPDATE reviews SET word_id=?1 WHERE word_id=?2", rusqlite::params![target_id,id]).map_err(|e| e.to_string())?;
                    } else {
                        conn.execute("DELETE FROM reviews WHERE word_id=?1", [id]).map_err(|e| e.to_string())?;
                    }
                } else if src_review && !target_review {
                    conn.execute(
                        "UPDATE reviews SET word_id = ?1 WHERE word_id = ?2",
                        rusqlite::params![target_id, id],
                    )
                    .map_err(|e| e.to_string())?;
                }

                conn.execute(
                    "UPDATE review_logs SET word_id = ?1 WHERE word_id = ?2",
                    rusqlite::params![target_id, id],
                )
                .map_err(|e| e.to_string())?;

                conn.execute("DELETE FROM words WHERE id = ?1", [id])
                    .map_err(|e| e.to_string())?;
                merged += 1;
            }
            None => {
                conn.execute(
                    "UPDATE words SET lemma = ?1, word_kind='common' WHERE id = ?2",
                    rusqlite::params![resolved, id],
                )
                .map_err(|e| e.to_string())?;
                merged += 1;
            }
            _ => {}
        }
    }
    Ok(merged)
}

#[tauri::command]
pub fn migrate_english_lemmas_cmd(state: State<DbState>) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    run_migrate_english_lemmas(&conn)
}

/// Transactional wrapper around `migrate_english_lemmas`, safe to call from a
/// startup thread as well as from a command.
pub fn run_migrate_english_lemmas(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;
    let result = migrate_english_lemmas(conn);
    match result {
        Ok(n) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(n)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_inflected_forms_to_lemmas() {
        let wordforms = load_wordforms();
        let cases = [
            ("went", "go"),
            ("gone", "go"),
            ("going", "go"),
            ("goes", "go"),
            ("books", "book"),
            ("cities", "city"),
            ("studied", "study"),
            ("walked", "walk"),
            ("cried", "cry"),
            ("children", "child"),
            ("geese", "goose"),
            ("better", "better"),
            ("biggest", "big"),
            ("boiling", "boil"),
        ];
        for (surface, lemma) in cases {
            assert_eq!(
                lemmatize_tokens(vec![(surface.to_string(), 0)], wordforms)[0].lemma,
                lemma,
                "surface {surface}"
            );
        }
    }

    #[test]
    fn keeps_base_forms_and_unknown_words() {
        assert_eq!(lemma_of_surface("go"), "go");
        assert_eq!(lemma_of_surface("book"), "book");
        assert_eq!(lemma_of_surface("javascript"), "javascript");
        assert_eq!(lemma_of_surface("unforgettable"), "unforgettable");
    }

    #[test]
    fn handles_case_and_punctuation() {
        let tokens = tokenize_english_text("Went To the CITY, and saw men.");
        let surfaces: Vec<&str> = tokens.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(
            surfaces,
            vec!["Went", "To", "the", "CITY", "and", "saw", "men"]
        );
        let wordforms = load_wordforms();
        let lemmatized = lemmatize_tokens(tokens, wordforms);
        assert_eq!(lemmatized[0].lemma, "go");
        assert_eq!(lemmatized[3].lemma, "city");
    }

    #[test]
    fn filters_single_letters_and_keeps_a_i() {
        let tokens = tokenize_english_text("a i x y hello");
        let surfaces: Vec<&str> = tokens.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(surfaces, vec!["a", "i", "hello"]);
    }

    #[test]
    fn drops_hyphenated_compounds() {
        let tokens = tokenize_english_text("a well-known writer");
        let surfaces: Vec<&str> = tokens.iter().map(|(s, _)| s.as_str()).collect();
        assert_eq!(surfaces, vec!["a", "writer"]);
        let positions: Vec<i32> = tokens.iter().map(|(_, p)| *p).collect();
        assert_eq!(
            positions,
            vec![0, 2],
            "positions mirror import.rs phrase detection"
        );
    }

    #[test]
    fn contractions_and_web_resources_do_not_create_fragments() {
        let tokens = tokenize_english("I'm sure you're ready; I've checked https://example.com/photo.png and image.jpg".into()).unwrap();
        let surfaces: Vec<&str> = tokens.iter().map(|token| token.surface.as_str()).collect();
        assert_eq!(surfaces, vec!["I", "sure", "you", "ready", "I", "checked", "and"]);
        assert!(!surfaces.iter().any(|value| matches!(*value, "m" | "re" | "ve" | "com" | "png" | "jpg")));
    }

    #[test]
    fn plural_resolution_is_conservative_and_spelling_variants_are_candidates_only() {
        assert_eq!(lemma_of_surface("years"), "year");
        assert_eq!(lemma_of_surface("months"), "month");
        assert_eq!(lemma_of_surface("better"), "better");
        assert_eq!(lemma_of_surface("barking"), "barking");
        assert!(spelling_variants("enrolled").contains(&"enrol".to_string()));
    }

    #[test]
    fn batch_matches_single_calls() {
        let texts = vec![
            "I went to the store.".to_string(),
            "Books are heavy.".to_string(),
        ];
        let batch = tokenize_english_batch(texts.clone()).unwrap();
        assert_eq!(batch.len(), 2);
        for (index, tokens) in batch.iter().enumerate() {
            let single = tokenize_english(texts[index].clone()).unwrap();
            assert_eq!(tokens.len(), single.len());
            assert_eq!(tokens, &single);
        }
    }

    fn migration_conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE words (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 language TEXT NOT NULL DEFAULT 'en',
                 lemma TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'unprocessed',
                 definition TEXT,
                 reading TEXT,
                 part_of_speech TEXT,
                 word_kind TEXT NOT NULL DEFAULT 'common',
                 kind_edited INTEGER NOT NULL DEFAULT 0,
                 UNIQUE(language, lemma)
             ) STRICT;
             CREATE TABLE word_aliases (
                 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                 alias TEXT NOT NULL,
                 alias_kind TEXT NOT NULL DEFAULT 'surface',
                 PRIMARY KEY(word_id,alias)
             ) STRICT;
             CREATE TABLE occurrences (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                 segment_id INTEGER NOT NULL,
                 original_form TEXT NOT NULL,
                 position INTEGER NOT NULL
             ) STRICT;
             CREATE TABLE reviews (
                 word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
                 due_at INTEGER NOT NULL,
                 reps INTEGER NOT NULL DEFAULT 0,
                 last_review_at INTEGER
             ) STRICT;
             CREATE TABLE review_logs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                 rating INTEGER NOT NULL,
                 reviewed_at INTEGER NOT NULL
             ) STRICT;",
        )
        .unwrap();
        conn
    }

    #[test]
    fn migrates_surface_forms_to_base_lemmas() {
        use rusqlite::params;
        let conn = migration_conn();

        conn.execute(
            "INSERT INTO words (language, lemma, definition, status) VALUES ('en', 'books', 'source note', 'learning')",
            [],
        )
        .unwrap();
        let books_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'books', 0)", params![books_id]).unwrap();

        conn.execute(
            "INSERT INTO words (language, lemma, definition, status) VALUES ('en', 'book', 'target note', 'known')",
            [],
        )
        .unwrap();
        let book_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'book', 0)", params![book_id]).unwrap();
        conn.execute(
            "INSERT INTO reviews (word_id, due_at, reps, last_review_at) VALUES (?1, 100, 1, 100)",
            params![book_id],
        )
        .unwrap();
        conn.execute("INSERT INTO reviews (word_id,due_at,reps,last_review_at) VALUES(?1,200,4,300)", params![books_id]).unwrap();

        conn.execute(
            "INSERT INTO words (language, lemma) VALUES ('en', 'went')",
            [],
        )
        .unwrap();
        let went_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'went', 0)", params![went_id]).unwrap();
        conn.execute(
            "INSERT INTO review_logs (word_id, rating, reviewed_at) VALUES (?1, 3, 200)",
            params![went_id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO words (language, lemma) VALUES ('en', 'book')",
            [],
        )
        .unwrap_err();

        let merged = migrate_english_lemmas(&conn).unwrap();
        assert_eq!(merged, 2);

        let books_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM words WHERE lemma = 'books'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(books_exists, 0);

        let book_occ: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM occurrences WHERE word_id = ?1",
                params![book_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(book_occ, 2, "occurrences from 'books' merge into 'book'");

        let review: (i64,i64) = conn
            .query_row(
                "SELECT COUNT(*),MAX(reps) FROM reviews WHERE word_id = ?1",
                params![book_id],
                |row| Ok((row.get(0)?,row.get(1)?)),
            )
            .unwrap();
        assert_eq!(review, (1,4), "review with more repetitions is preserved");
        let (status,note):(String,String) = conn.query_row("SELECT status,definition FROM words WHERE id=?1", [book_id], |row| Ok((row.get(0)?,row.get(1)?))).unwrap();
        assert_eq!(status, "learning");
        assert!(note.contains("source note") && note.contains("target note"));

        let go_occ: i64 = conn.query_row(
            "SELECT COUNT(*) FROM occurrences o JOIN words w ON w.id = o.word_id WHERE w.lemma = 'go'", [], |row| row.get(0)).unwrap();
        assert_eq!(go_occ, 1, "'went' is renamed to 'go'");

        let logs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM review_logs l JOIN words w ON w.id = l.word_id WHERE w.lemma = 'go'", [], |row| row.get(0)).unwrap();
        assert_eq!(logs, 1, "review logs follow the renamed word");

        // Idempotent: a second run is a no-op.
        assert_eq!(migrate_english_lemmas(&conn).unwrap(), 0);
    }
}
