use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Debug, PartialEq)]
pub struct EnglishToken {
    pub surface: String,
    pub lemma: String,
    pub part_of_speech: Option<String>,
    pub position: i32,
}

struct EnglishWordforms {
    map: HashMap<String, (String, Option<String>)>,
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
        let mut map = HashMap::new();
        for line in contents.lines() {
            let mut fields = line.splitn(3, '\t');
            let surface = fields.next().unwrap_or_default().trim();
            let lemma = fields.next().unwrap_or_default().trim();
            let pos = fields.next().unwrap_or_default().trim();
            if surface.is_empty() || lemma.is_empty() {
                continue;
            }
            map.insert(
                surface.to_string(),
                (
                    lemma.to_string(),
                    (!pos.is_empty()).then(|| pos.to_string()),
                ),
            );
        }
        EnglishWordforms { map }
    })
}

/// Reduce a surface form to its base lemma. Unknown words are returned unchanged.
pub fn lemma_of_surface(surface: &str) -> String {
    let lower = surface.to_lowercase();
    match load_wordforms().map.get(&lower) {
        Some((lemma, _)) => lemma.clone(),
        None => lower,
    }
}

// Mirrors the punctuation set stripped by import.rs so that English tokens and
// their (possibly gapped) positions stay aligned with phrase detection.
fn is_stripped(c: char) -> bool {
    matches!(
        c,
        '.' | ',' | '!' | '?' | ';' | ':' | '(' | ')' | '[' | ']' | '{' | '}' | '"' | '\'' | '`'
            | '«' | '»' | '–' | '—' | '…' | '@' | '#' | '$' | '%' | '^' | '&' | '*' | '+' | '='
            | '<' | '>' | '/' | '\\' | '|' | '~'
    )
}

fn tokenize_english_text(text: &str) -> Vec<(String, i32)> {
    let cleaned: String = text
        .chars()
        .map(|c| if is_stripped(c) { ' ' } else { c })
        .collect::<String>()
        .replace("--", " ");
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    words
        .iter()
        .enumerate()
        .filter_map(|(i, w)| {
            let lower = w.to_ascii_lowercase();
            if lower.is_empty()
                || (lower.len() == 1 && lower != "a" && lower != "i")
                || !lower.chars().all(|c| c.is_ascii_alphabetic())
            {
                return None;
            }
            Some((w.to_string(), i as i32))
        })
        .collect()
}

fn lemmatize_tokens(
    tokens: Vec<(String, i32)>,
    wordforms: &EnglishWordforms,
) -> Vec<EnglishToken> {
    tokens
        .into_iter()
        .map(|(surface, position)| {
            let lower = surface.to_lowercase();
            let (lemma, part_of_speech) = match wordforms.map.get(&lower) {
                Some((lemma, pos)) => (lemma.clone(), pos.clone()),
                None => (lower, None),
            };
            EnglishToken {
                surface,
                lemma,
                part_of_speech,
                position,
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
    Ok(words
        .iter()
        .map(|word| lemma_of_surface(word))
        .collect())
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
        let resolved = lemma_of_surface(&lemma);
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
                conn.execute(
                    "UPDATE words SET
                         definition = COALESCE(definition, (SELECT definition FROM words WHERE id = ?2)),
                         reading = COALESCE(reading, (SELECT reading FROM words WHERE id = ?2)),
                         part_of_speech = COALESCE(part_of_speech, (SELECT part_of_speech FROM words WHERE id = ?2))
                     WHERE id = ?1",
                    rusqlite::params![target_id, id],
                )
                .map_err(|e| e.to_string())?;

                conn.execute(
                    "UPDATE occurrences SET word_id = ?1 WHERE word_id = ?2",
                    rusqlite::params![target_id, id],
                )
                .map_err(|e| e.to_string())?;

                let has_review =
                    |word_id: i64| -> Result<bool, String> {
                        conn.query_row(
                            "SELECT EXISTS(SELECT 1 FROM reviews WHERE word_id = ?1)",
                            [word_id],
                            |row| row.get(0),
                        )
                        .map_err(|e| e.to_string())
                    };
                let (src_review, target_review) = (has_review(id)?, has_review(target_id)?);
                if src_review && !target_review {
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
                    "UPDATE words SET lemma = ?1 WHERE id = ?2",
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
    conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
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
            ("better", "well"),
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
        assert_eq!(surfaces, vec!["Went", "To", "the", "CITY", "and", "saw", "men"]);
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
        assert_eq!(positions, vec![0, 2], "positions mirror import.rs phrase detection");
    }

    #[test]
    fn batch_matches_single_calls() {
        let texts = vec!["I went to the store.".to_string(), "Books are heavy.".to_string()];
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
                 UNIQUE(language, lemma)
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
                 due_at INTEGER NOT NULL
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

        conn.execute("INSERT INTO words (language, lemma, definition) VALUES ('en', 'books', 'definition')", []).unwrap();
        let books_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'books', 0)", params![books_id]).unwrap();

        conn.execute("INSERT INTO words (language, lemma) VALUES ('en', 'book')", []).unwrap();
        let book_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'book', 0)", params![book_id]).unwrap();
        conn.execute("INSERT INTO reviews (word_id, due_at) VALUES (?1, 100)", params![book_id]).unwrap();

        conn.execute("INSERT INTO words (language, lemma) VALUES ('en', 'went')", []).unwrap();
        let went_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, 0, 'went', 0)", params![went_id]).unwrap();
        conn.execute("INSERT INTO review_logs (word_id, rating, reviewed_at) VALUES (?1, 3, 200)", params![went_id]).unwrap();

        conn.execute("INSERT INTO words (language, lemma) VALUES ('en', 'book')", []).unwrap_err();

        let merged = migrate_english_lemmas(&conn).unwrap();
        assert_eq!(merged, 2);

        let books_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM words WHERE lemma = 'books'", [], |row| row.get(0)).unwrap();
        assert_eq!(books_exists, 0);

        let book_occ: i64 = conn.query_row(
            "SELECT COUNT(*) FROM occurrences WHERE word_id = ?1", params![book_id], |row| row.get(0)).unwrap();
        assert_eq!(book_occ, 2, "occurrences from 'books' merge into 'book'");

        let review: i64 = conn.query_row(
            "SELECT COUNT(*) FROM reviews WHERE word_id = ?1", params![book_id], |row| row.get(0)).unwrap();
        assert_eq!(review, 1, "target review preserved");

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
