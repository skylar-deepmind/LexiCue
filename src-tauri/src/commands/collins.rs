//! Reader for the owner's private COBUILD index. No dictionary text is bundled.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const PROVIDER: &str = "Collins COBUILD V3";
const FILENAME: &str = "collins-cobuild-v3.sqlite";

#[derive(Clone, Serialize, Deserialize)]
pub struct Sense {
    pub id: i64,
    pub phrase: String,
    pub headword: String,
    pub grammar: String,
    pub definition: String,
    pub example: Option<String>,
}

pub fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(FILENAME))
}

fn open(path: &Path) -> Result<Option<Connection>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Collins index: {e}"))?;
    let source: String = conn.query_row("SELECT value FROM metadata WHERE key='provider'", [], |row| row.get(0))
        .map_err(|e| format!("Invalid Collins index: {e}"))?;
    if source != PROVIDER {
        return Err("Unrecognized Collins index".into());
    }
    Ok(Some(conn))
}

pub fn lookup_word(path: &Path, lemma: &str) -> Result<Vec<Sense>, String> {
    let Some(conn) = open(path)? else { return Ok(Vec::new()) };
    let mut stmt = conn.prepare(
        "SELECT id,headword,grammar,definition,example FROM word_senses WHERE lookup_key=?1 ORDER BY id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([normalize(lemma)], |row| Ok(Sense {
        id: row.get(0)?, phrase: String::new(), headword: row.get(1)?,
        grammar: row.get(2)?, definition: row.get(3)?, example: row.get(4)?,
    })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

pub fn lookup_phrase(path: &Path, phrase: &str) -> Result<Vec<Sense>, String> {
    let Some(conn) = open(path)? else { return Ok(Vec::new()) };
    let mut stmt = conn.prepare(
        "SELECT id,phrase,headword,grammar,definition,example FROM phrase_senses WHERE lookup_key=?1 ORDER BY id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([normalize(phrase)], |row| Ok(Sense {
        id: row.get(0)?, phrase: row.get(1)?, headword: row.get(2)?,
        grammar: row.get(3)?, definition: row.get(4)?, example: row.get(5)?,
    })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_private_index_has_no_entries() {
        assert!(lookup_word(Path::new("/no/such/collins.sqlite"), "friend").unwrap().is_empty());
        assert!(lookup_phrase(Path::new("/no/such/collins.sqlite"), "make friends").unwrap().is_empty());
    }

    #[test]
    fn reads_headwords_and_embedded_phrases_without_confusing_examples() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO metadata VALUES('provider','Collins COBUILD V3');
            CREATE TABLE word_senses(id INTEGER PRIMARY KEY,lookup_key TEXT,headword TEXT,grammar TEXT,definition TEXT,example TEXT);
            CREATE TABLE phrase_senses(id INTEGER PRIMARY KEY,lookup_key TEXT,phrase TEXT,headword TEXT,grammar TEXT,definition TEXT,example TEXT);
            INSERT INTO word_senses(lookup_key,headword,grammar,definition,example) VALUES('friend','friend','N-COUNT','A person you like.','My friend has a family dog.');
            INSERT INTO phrase_senses(lookup_key,phrase,headword,grammar,definition,example) VALUES('make friends','make friends','friend','PHR-RECIP','Begin a friendship.','They made friends.');").unwrap();
        drop(conn);
        let word = lookup_word(&path, " Friend ").unwrap();
        assert_eq!(word.len(), 1);
        assert_eq!(word[0].headword, "friend");
        let phrase = lookup_phrase(&path, "  make   friends ").unwrap();
        assert_eq!(phrase.len(), 1);
        assert_eq!(phrase[0].headword, "friend");
        assert!(lookup_phrase(&path, "family dog").unwrap().is_empty());
    }
}
