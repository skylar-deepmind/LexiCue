use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::Read;
use tauri::{AppHandle, Manager, State};

use crate::commands::english;
use crate::db::{DbState, DictionaryStatus};

#[derive(Clone, Serialize, Deserialize)]
pub struct DictionaryDefinition {
    pub part_of_speech: String,
    pub definition: String,
    pub translation: Option<String>,
    pub example: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DictionaryEntry {
    pub language: String,
    pub lemma: String,
    pub provider: String,
    pub phonetic: Option<String>,
    pub audio_url: Option<String>,
    pub local_audio_path: Option<String>,
    pub definitions: Vec<DictionaryDefinition>,
    pub fetched_at: i64,
}

#[derive(Serialize)]
pub struct DictionarySource {
    pub language: String,
    pub provider: String,
    pub version: Option<String>,
    pub source_url: Option<String>,
    pub license: Option<String>,
    pub imported_at: i64,
    pub entry_count: i64,
}

#[tauri::command]
pub fn dictionary_status(status: State<DictionaryStatus>) -> bool {
    status.is_ready()
}

#[derive(Deserialize)]
struct ApiEntry {
    phonetic: Option<String>,
    phonetics: Option<Vec<ApiPhonetic>>,
    meanings: Vec<ApiMeaning>,
}

#[derive(Deserialize)]
struct ApiPhonetic {
    text: Option<String>,
    audio: Option<String>,
}

#[derive(Deserialize)]
struct ApiMeaning {
    #[serde(rename = "partOfSpeech")]
    part_of_speech: Option<String>,
    definitions: Vec<ApiDefinition>,
}

#[derive(Deserialize)]
struct ApiDefinition {
    definition: String,
    example: Option<String>,
}

#[derive(Deserialize)]
struct DictionaryPack {
    manifest: serde_json::Value,
    entries: Vec<PackEntry>,
}

#[derive(Deserialize)]
struct PackEntry {
    lemma: String,
    provider: Option<String>,
    phonetic: Option<String>,
    definitions: Vec<DictionaryDefinition>,
    audio_base64: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn initialize_builtin_dictionary(conn: &rusqlite::Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'ECDICT')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder =
        flate2::read::GzDecoder::new(include_bytes!("../../resources/ecdict.tsv.gz").as_slice());
    let mut contents = String::new();
    decoder
        .take(32 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(4, '\t');
        let lemma = fields.next().unwrap_or_default().trim();
        let phonetic = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let part_of_speech = fields.next().unwrap_or_default().trim();
        if lemma.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_dictionary_entries (lemma, phonetic, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    lemma,
                    (!phonetic.is_empty()).then_some(phonetic),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('en', 'ECDICT', 'frequency-100k', 'https://github.com/skywind3000/ECDICT', 'MIT', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

type BuiltinEntry = (Option<String>, String, Option<String>);

fn builtin_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
) -> Result<Option<BuiltinEntry>, String> {
    let result = conn.query_row(
        "SELECT phonetic, translation, part_of_speech FROM builtin_dictionary_entries WHERE lemma = ?1",
        [lemma],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn builtin_japanese_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
) -> Result<Option<BuiltinEntry>, String> {
    let result = conn.query_row(
        "SELECT reading, translation, part_of_speech FROM builtin_japanese_dictionary_entries WHERE lemma = ?1",
        [lemma],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn builtin_german_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
) -> Result<Option<BuiltinEntry>, String> {
    let result = conn.query_row(
        "SELECT phonetic, translation, part_of_speech FROM builtin_german_dictionary_entries WHERE lemma = ?1",
        [lemma],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn builtin_chinese_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
) -> Result<Option<BuiltinEntry>, String> {
    let result = conn.query_row(
        "SELECT reading, translation, part_of_speech FROM builtin_chinese_dictionary_entries WHERE lemma = ?1",
        [lemma],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn cached_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
    language: &str,
) -> Result<Option<DictionaryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at
             FROM dictionary_entries WHERE language = ?1 AND lemma = ?2",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt.query_row([language, lemma], |row| {
        let definitions_json: String = row.get(5)?;
        let definitions = serde_json::from_str(&definitions_json).unwrap_or_default();
        Ok(DictionaryEntry {
            lemma: row.get(0)?,
            language: language.to_string(),
            provider: row.get(1)?,
            phonetic: row.get(2)?,
            audio_url: row.get(3)?,
            local_audio_path: row.get(4)?,
            definitions,
            fetched_at: row.get(6)?,
        })
    });
    match result {
        Ok(entry) => Ok(Some(entry)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn initialize_builtin_phrase_dictionary(conn: &rusqlite::Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM dictionary_sources
                WHERE provider = 'PhraseDict' AND version = '2.0'
            )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder = flate2::read::GzDecoder::new(
        include_bytes!("../../resources/phrase_dict.tsv.gz").as_slice(),
    );
    let mut contents = String::new();
    decoder
        .take(16 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(3, '\t');
        let text = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let category = fields.next().unwrap_or_default().trim();
        if text.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_phrase_dictionary (text, translation, category)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![text, translation, category],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('en', 'PhraseDict', '2.0', 'https://kaikki.org/dictionary/English/pos-phrase/', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn initialize_builtin_japanese_dictionary(conn: &rusqlite::Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'JMdict')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder =
        flate2::read::GzDecoder::new(include_bytes!("../../resources/jmdict.tsv.gz").as_slice());
    let mut contents = String::new();
    decoder
        .take(64 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(4, '\t');
        let lemma = fields.next().unwrap_or_default().trim();
        let reading = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let part_of_speech = fields.next().unwrap_or_default().trim();
        if lemma.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_japanese_dictionary_entries (lemma, reading, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    lemma,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('ja', 'JMdict', 'latest', 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn initialize_builtin_german_dictionary(conn: &rusqlite::Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'GermanDict')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder = flate2::read::GzDecoder::new(
        include_bytes!("../../resources/german_dict.tsv.gz").as_slice(),
    );
    let mut contents = String::new();
    decoder
        .take(32 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(4, '\t');
        let lemma = fields.next().unwrap_or_default().trim();
        let phonetic = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let part_of_speech = fields.next().unwrap_or_default().trim();
        if lemma.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_german_dictionary_entries (lemma, phonetic, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    lemma,
                    (!phonetic.is_empty()).then_some(phonetic),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('de', 'GermanDict', 'wiktextract-2026-07', 'https://kaikki.org/dictionary/German/', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn initialize_builtin_chinese_dictionary(conn: &rusqlite::Connection) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'CC-CEDICT')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder =
        flate2::read::GzDecoder::new(include_bytes!("../../resources/cc-cedict.tsv.gz").as_slice());
    let mut contents = String::new();
    decoder
        .take(32 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(3, '\t');
        let lemma = fields.next().unwrap_or_default().trim();
        let reading = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        if lemma.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_chinese_dictionary_entries (lemma, reading, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, NULL)",
                rusqlite::params![
                    lemma,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('zh', 'CC-CEDICT', '2026-08', 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn initialize_builtin_chinese_phrase_dictionary(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'CC-CEDICT Phrases')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder = flate2::read::GzDecoder::new(
        include_bytes!("../../resources/cc-cedict-phrases.tsv.gz").as_slice(),
    );
    let mut contents = String::new();
    decoder
        .take(32 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(4, '\t');
        let text = fields.next().unwrap_or_default().trim();
        let reading = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let category = fields.next().unwrap_or_default().trim();
        if text.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_chinese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    text,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!category.is_empty()).then_some(category),
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('zh', 'CC-CEDICT Phrases', '2026-08', 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn initialize_builtin_japanese_phrase_dictionary(
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM dictionary_sources WHERE provider = 'JMdict Idioms')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Ok(());
    }

    let decoder = flate2::read::GzDecoder::new(
        include_bytes!("../../resources/jmdict-phrases.tsv.gz").as_slice(),
    );
    let mut contents = String::new();
    decoder
        .take(32 * 1024 * 1024)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for line in contents.lines() {
        let mut fields = line.splitn(4, '\t');
        let text = fields.next().unwrap_or_default().trim();
        let reading = fields.next().unwrap_or_default().trim();
        let translation = fields.next().unwrap_or_default().trim();
        let category = fields.next().unwrap_or_default().trim();
        if text.is_empty() || translation.is_empty() {
            continue;
        }
        transaction
            .execute(
                "INSERT OR IGNORE INTO builtin_japanese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    text,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!category.is_empty()).then_some(category),
                ],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('ja', 'JMdict Idioms', '2026-08', 'https://github.com/scriptin/jmdict-simplified', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lookup_phrase_dictionary(
    state: State<DbState>,
    text: String,
    language: Option<String>,
) -> Result<PhraseDictionaryEntry, String> {
    let normalized = text.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let ollama_result = conn.query_row(
        "SELECT text, translation, pinyin, usage_zh, category, provider
         FROM phrase_dictionary_entries WHERE language = ?1 AND text = ?2",
        [&language, &normalized],
        |row| {
            Ok(PhraseDictionaryEntry {
                text: row.get(0)?,
                translation: row.get(1)?,
                pinyin: row.get(2)?,
                usage_zh: row.get(3)?,
                category: row.get(4)?,
                provider: row.get(5)?,
            })
        },
    );
    if let Ok(entry) = ollama_result {
        return Ok(entry);
    }
    if language == "zh" {
        let result = conn.query_row(
            "SELECT text, reading, translation, category FROM builtin_chinese_phrase_dictionary WHERE text = ?1",
            [&normalized],
            |row| {
                Ok(PhraseDictionaryEntry {
                    text: row.get(0)?,
                    translation: row.get(2)?,
                    pinyin: row.get(1)?,
                    usage_zh: None,
                    category: row.get(3)?,
                    provider: "CC-CEDICT Phrases".to_string(),
                })
            },
        );
        return match result {
            Ok(entry) => Ok(entry),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err("phrase not found in dictionary".to_string())
            }
            Err(e) => Err(e.to_string()),
        };
    }
    let result = conn.query_row(
        "SELECT text, translation, category FROM builtin_phrase_dictionary WHERE text = ?1",
        [&normalized],
        |row| {
            Ok(PhraseDictionaryEntry {
                text: row.get(0)?,
                translation: row.get(1)?,
                pinyin: None,
                usage_zh: None,
                category: row.get(2)?,
                provider: "PhraseDict".to_string(),
            })
        },
    );
    match result {
        Ok(entry) => Ok(entry),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err("phrase not found in dictionary".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PhraseDictionaryEntry {
    pub text: String,
    pub translation: String,
    pub pinyin: Option<String>,
    pub usage_zh: Option<String>,
    pub category: Option<String>,
    pub provider: String,
}

#[tauri::command]
pub fn get_cached_dictionary(
    state: State<DbState>,
    lemma: String,
    language: Option<String>,
) -> Result<DictionaryEntry, String> {
    let normalized = lemma.trim().to_lowercase();
    let language = language.as_deref().unwrap_or("en");
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    cached_entry(&conn, &normalized, language)?
        .or_else(|| {
            if language == "en" {
                let resolved = english::lemma_of_surface(&normalized);
                if resolved != normalized {
                    cached_entry(&conn, &resolved, language).ok().flatten()
                } else {
                    None
                }
            } else {
                None
            }
        })
        .ok_or_else(|| "dictionary entry not cached".to_string())
}

#[tauri::command]
pub fn list_dictionary_sources(state: State<DbState>) -> Result<Vec<DictionarySource>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.language, s.provider, s.version, s.source_url, s.license, s.imported_at,
                    COUNT(e.lemma) +
                        CASE WHEN s.provider = 'ECDICT'
                            THEN (SELECT COUNT(*) FROM builtin_dictionary_entries)
                        ELSE 0 END +
                        CASE WHEN s.provider = 'JMdict'
                            THEN (SELECT COUNT(*) FROM builtin_japanese_dictionary_entries)
                        ELSE 0 END +
                        CASE WHEN s.provider = 'GermanDict'
                            THEN (SELECT COUNT(*) FROM builtin_german_dictionary_entries)
                        ELSE 0 END +
                        CASE WHEN s.provider = 'CC-CEDICT'
                            THEN (SELECT COUNT(*) FROM builtin_chinese_dictionary_entries)
                        ELSE 0 END
             FROM dictionary_sources s
             LEFT JOIN dictionary_entries e ON e.provider = s.provider AND e.language = s.language
             GROUP BY s.language, s.provider
             ORDER BY s.imported_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(DictionarySource {
                language: row.get(0)?,
                provider: row.get(1)?,
                version: row.get(2)?,
                source_url: row.get(3)?,
                license: row.get(4)?,
                imported_at: row.get(5)?,
                entry_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn delete_dictionary_source(
    state: State<DbState>,
    provider: String,
    language: Option<String>,
) -> Result<i64, String> {
    if provider == "ECDICT" || provider == "JMdict" || provider == "GermanDict" || provider == "CC-CEDICT" {
        return Err("the built-in dictionary cannot be deleted".to_string());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let language = language.unwrap_or_else(|| "en".to_string());
    conn.execute(
        "DELETE FROM dictionary_entries WHERE language = ?1 AND provider = ?2",
        rusqlite::params![language, provider],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM dictionary_sources WHERE language = ?1 AND provider = ?2",
        rusqlite::params![language, provider],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.changes() as i64)
}

#[derive(Deserialize)]
struct JishoResponse {
    data: Vec<JishoEntry>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct JishoEntry {
    japanese: Vec<JishoJapanese>,
    senses: Vec<JishoSense>,
    jlpt: Vec<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct JishoJapanese {
    word: Option<String>,
    reading: Option<String>,
}

#[derive(Deserialize)]
struct JishoSense {
    english_definitions: Vec<String>,
    parts_of_speech: Vec<String>,
}

async fn fetch_jisho_entry(
    normalized: &str,
    language: &str,
    builtin: &Option<(Option<String>, String, Option<String>)>,
) -> Result<DictionaryEntry, String> {
    let url = format!(
        "https://jisho.org/api/v1/search/words?keyword={}",
        urlencoding(normalized)
    );
    let response = Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("jisho request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("jisho returned status {}", response.status()));
    }

    let jisho: JishoResponse = response
        .json()
        .await
        .map_err(|e| format!("jisho response parse error: {}", e))?;

    let first = jisho.data.first().ok_or("word not found on jisho.org")?;

    let reading = first
        .japanese
        .iter()
        .find_map(|j| j.reading.clone())
        .or_else(|| builtin.as_ref().and_then(|b| b.0.clone()));

    let local_translation = builtin.as_ref().map(|b| b.1.clone());
    let has_local_translation = local_translation.is_some();

    let definitions: Vec<DictionaryDefinition> = first
        .senses
        .iter()
        .enumerate()
        .flat_map(|(index, sense)| {
            let pos = sense.parts_of_speech.join(", ");
            let translation_for_def = if index == 0 { local_translation.clone() } else { None };
            sense.english_definitions.iter().map(move |def| DictionaryDefinition {
                part_of_speech: pos.clone(),
                definition: def.clone(),
                translation: translation_for_def.clone(),
                example: None,
            })
        })
        .take(12)
        .collect();

    let provider = if has_local_translation {
        "jisho.org + JMdict".to_string()
    } else {
        "jisho.org".to_string()
    };

    Ok(DictionaryEntry {
        lemma: normalized.to_string(),
        language: language.to_string(),
        provider,
        phonetic: reading,
        audio_url: None,
        local_audio_path: None,
        definitions,
        fetched_at: now_ms(),
    })
}

fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

fn google_tts_audio_url(text: &str, language: &str) -> String {
    let tl = match language {
        "ja" => "ja",
        "zh" => "zh-CN",
        _ => "de",
    };
    format!(
        "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl={}&q={}",
        tl,
        urlencoding(text)
    )
}

#[tauri::command]
pub async fn lookup_dictionary(
    state: State<'_, DbState>,
    app: AppHandle,
    lemma: String,
    refresh: Option<bool>,
    language: Option<String>,
) -> Result<DictionaryEntry, String> {
    let language = language.unwrap_or_else(|| "en".to_string());
    let normalized = if language == "en" {
        lemma.trim().to_lowercase()
    } else {
        lemma.trim().to_string()
    };
    if normalized.is_empty() {
        return Err("word is empty".to_string());
    }

    let refresh = refresh.unwrap_or(false);

    if language == "ja" {
        return lookup_japanese(state, app.clone(), normalized, refresh).await;
    }

    if language == "de" {
        return lookup_german(state, app.clone(), normalized, refresh).await;
    }

    if language == "zh" {
        return lookup_chinese(state, app.clone(), normalized, refresh).await;
    }

    let (cached, builtin) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let resolved = if language == "en" {
            english::lemma_of_surface(&normalized)
        } else {
            normalized.clone()
        };
        let builtin = if language == "en" {
            builtin_entry(&conn, &normalized)?.or_else(|| {
                if resolved != normalized {
                    builtin_entry(&conn, &resolved).ok().flatten()
                } else {
                    None
                }
            })
        } else {
            None
        };
        (cached_entry(&conn, &normalized, &language)?, builtin)
    };
    if !refresh {
        if let Some(entry) = cached.as_ref().filter(|entry| entry.provider != "ECDICT") {
            return Ok(entry.clone());
        }
    }

    let local_fallback = cached.or_else(|| {
        builtin
            .as_ref()
            .map(|(phonetic, translation, part_of_speech)| DictionaryEntry {
                lemma: normalized.clone(),
                language: language.clone(),
                provider: "ECDICT".to_string(),
                phonetic: phonetic.clone(),
                audio_url: None,
                local_audio_path: None,
                definitions: vec![DictionaryDefinition {
                    part_of_speech: part_of_speech.clone().unwrap_or_default(),
                    definition: String::new(),
                    translation: Some(translation.clone()),
                    example: None,
                }],
                fetched_at: now_ms(),
            })
    });

    let url = format!(
        "https://api.dictionaryapi.dev/api/v2/entries/{}/{}",
        language, normalized
    );
    let response = match Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return local_fallback.ok_or_else(|| format!("dictionary request failed: {}", error))
        }
    };
    if !response.status().is_success() {
        return local_fallback.ok_or_else(|| format!("word not found: {}", normalized));
    }
    let api_entries: Vec<ApiEntry> = match response.json().await {
        Ok(entries) => entries,
        Err(error) => {
            return local_fallback.ok_or_else(|| format!("invalid dictionary response: {}", error))
        }
    };
    let phonetic = api_entries
        .iter()
        .find_map(|entry| {
            entry.phonetic.clone().or_else(|| {
                entry
                    .phonetics
                    .as_ref()?
                    .iter()
                    .find_map(|item| item.text.clone())
            })
        })
        .or_else(|| builtin.as_ref().and_then(|item| item.0.clone()));
    let audio_url = api_entries.iter().find_map(|entry| {
        entry.phonetics.as_ref().and_then(|items| {
            items.iter().find_map(|item| {
                item.audio
                    .as_ref()
                    .filter(|audio| !audio.is_empty())
                    .cloned()
            })
        })
    });
    let local_translation = builtin.as_ref().map(|item| item.1.clone());
    if api_entries.is_empty() {
        return local_fallback.ok_or_else(|| "empty dictionary response".to_string());
    }
    let definitions = api_entries
        .iter()
        .flat_map(|entry| entry.meanings.iter())
        .flat_map(|meaning| {
            meaning
                .definitions
                .iter()
                .map(move |definition| (meaning, definition))
        })
        .enumerate()
        .map(|(index, (meaning, definition))| DictionaryDefinition {
            part_of_speech: meaning.part_of_speech.clone().unwrap_or_default(),
            definition: definition.definition.clone(),
            translation: (index == 0).then(|| local_translation.clone()).flatten(),
            example: definition.example.clone(),
        })
        .take(12)
        .collect::<Vec<_>>();
    let mut entry = DictionaryEntry {
        lemma: normalized.clone(),
        language: language.clone(),
        provider: if local_translation.is_some() {
            "dictionaryapi.dev + ECDICT".to_string()
        } else {
            "dictionaryapi.dev".to_string()
        },
        phonetic,
        audio_url,
        local_audio_path: None,
        definitions,
        fetched_at: now_ms(),
    };

    let definitions_json = serde_json::to_string(&entry.definitions).map_err(|e| e.to_string())?;
    if let Some(audio_url) = entry.audio_url.clone() {
        if let Ok(path) = download_audio(&app, &normalized, &language, &audio_url).await {
            entry.local_audio_path = Some(path);
        }
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO dictionary_entries
         (language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ",
        rusqlite::params![
             entry.language,
             entry.lemma,
            entry.provider,
            entry.phonetic,
            entry.audio_url,
            entry.local_audio_path,
            definitions_json,
             entry.fetched_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(entry)
}

async fn lookup_japanese(
    state: State<'_, DbState>,
    app: AppHandle,
    normalized: String,
    refresh: bool,
) -> Result<DictionaryEntry, String> {
    let (cached, builtin) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        (
            cached_entry(&conn, &normalized, "ja")?,
            builtin_japanese_entry(&conn, &normalized)?,
        )
    };

    if !refresh {
        if let Some(entry) = cached.as_ref().filter(|entry| entry.provider != "JMdict") {
            return Ok(entry.clone());
        }
    }

    let local_fallback = cached.or_else(|| {
        builtin.as_ref().map(|(reading, translation, part_of_speech)| {
            DictionaryEntry {
                lemma: normalized.clone(),
                language: "ja".to_string(),
                provider: "JMdict".to_string(),
                phonetic: reading.clone(),
                audio_url: Some(google_tts_audio_url(&normalized, "ja")),
                local_audio_path: None,
                definitions: vec![DictionaryDefinition {
                    part_of_speech: part_of_speech.clone().unwrap_or_default(),
                    definition: String::new(),
                    translation: Some(translation.clone()),
                    example: None,
                }],
                fetched_at: now_ms(),
            }
        })
    });

    let online_result = fetch_jisho_entry(&normalized, "ja", &builtin).await;
    let entry = match online_result {
        Ok(mut jisho_entry) => {
            jisho_entry.phonetic = jisho_entry
                .phonetic
                .or_else(|| builtin.as_ref().and_then(|b| b.0.clone()));
            jisho_entry.audio_url = Some(google_tts_audio_url(&normalized, "ja"));
            if let Some(audio_url) = jisho_entry.audio_url.clone() {
                if let Ok(path) = download_audio(&app, &normalized, "ja", &audio_url).await {
                    jisho_entry.local_audio_path = Some(path);
                }
            }

            let definitions_json =
                serde_json::to_string(&jisho_entry.definitions).map_err(|e| e.to_string())?;
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT OR REPLACE INTO dictionary_entries
                 (language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    "ja",
                    jisho_entry.lemma,
                    jisho_entry.provider,
                    jisho_entry.phonetic,
                    jisho_entry.audio_url,
                    jisho_entry.local_audio_path,
                    definitions_json,
                    jisho_entry.fetched_at,
                ],
            )
            .map_err(|e| e.to_string())?;
            jisho_entry
        }
        Err(_) => {
            return local_fallback.ok_or_else(|| format!("word not found: {}", normalized));
        }
    };

    Ok(entry)
}

async fn lookup_german(
    state: State<'_, DbState>,
    app: AppHandle,
    normalized: String,
    refresh: bool,
) -> Result<DictionaryEntry, String> {
    let key = normalized.to_lowercase();
    let (cached, builtin) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        (
            cached_entry(&conn, &key, "de")?,
            builtin_german_entry(&conn, &key)?,
        )
    };

    if !refresh {
        if let Some(entry) = cached {
            return Ok(entry);
        }
    }

    let mut entry = builtin
        .map(|(phonetic, translation, part_of_speech)| DictionaryEntry {
            lemma: key.clone(),
            language: "de".to_string(),
            provider: "GermanDict".to_string(),
            phonetic,
            audio_url: Some(google_tts_audio_url(&key, "de")),
            local_audio_path: None,
            definitions: vec![DictionaryDefinition {
                part_of_speech: part_of_speech.unwrap_or_default(),
                definition: translation,
                translation: None,
                example: None,
            }],
            fetched_at: now_ms(),
        })
        .ok_or_else(|| format!("word not found: {}", normalized))?;

    if let Some(audio_url) = entry.audio_url.clone() {
        if let Ok(path) = download_audio(&app, &key, "de", &audio_url).await {
            entry.local_audio_path = Some(path);
        }
    }

    let definitions_json = serde_json::to_string(&entry.definitions).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO dictionary_entries
         (language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            entry.language,
            entry.lemma,
            entry.provider,
            entry.phonetic,
            entry.audio_url,
            entry.local_audio_path,
            definitions_json,
            entry.fetched_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(entry)
}

async fn lookup_chinese(
    state: State<'_, DbState>,
    app: AppHandle,
    normalized: String,
    refresh: bool,
) -> Result<DictionaryEntry, String> {
    let (cached, builtin) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        (
            cached_entry(&conn, &normalized, "zh")?,
            builtin_chinese_entry(&conn, &normalized)?,
        )
    };

    if !refresh {
        if let Some(entry) = cached {
            return Ok(entry);
        }
    }

    let mut entry = builtin
        .map(|(reading, translation, part_of_speech)| DictionaryEntry {
            lemma: normalized.clone(),
            language: "zh".to_string(),
            provider: "CC-CEDICT".to_string(),
            phonetic: reading,
            audio_url: Some(google_tts_audio_url(&normalized, "zh")),
            local_audio_path: None,
            definitions: vec![DictionaryDefinition {
                part_of_speech: part_of_speech.unwrap_or_default(),
                definition: translation,
                translation: None,
                example: None,
            }],
            fetched_at: now_ms(),
        })
        .ok_or_else(|| format!("word not found: {}", normalized))?;

    if let Some(audio_url) = entry.audio_url.clone() {
        if let Ok(path) = download_audio(&app, &normalized, "zh", &audio_url).await {
            entry.local_audio_path = Some(path);
        }
    }

    let definitions_json = serde_json::to_string(&entry.definitions).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO dictionary_entries
         (language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            entry.language,
            entry.lemma,
            entry.provider,
            entry.phonetic,
            entry.audio_url,
            entry.local_audio_path,
            definitions_json,
            entry.fetched_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(entry)
}

#[tauri::command]
pub fn import_dictionary_pack(
    state: State<DbState>,
    app: AppHandle,
    pack_json: String,
) -> Result<usize, String> {
    let pack: DictionaryPack =
        serde_json::from_str(&pack_json).map_err(|e| format!("invalid dictionary pack: {}", e))?;
    let provider = pack
        .manifest
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("local-dictionary-pack")
        .to_string();
    let language = pack
        .manifest
        .get("language")
        .and_then(|value| value.as_str())
        .unwrap_or("en")
        .to_string();
    let version = pack
        .manifest
        .get("version")
        .and_then(|value| value.as_str());
    let source_url = pack.manifest.get("source").and_then(|value| value.as_str());
    let license = pack
        .manifest
        .get("license")
        .and_then(|value| value.as_str());
    let audio_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionary-audio")
        .join(&language);
    std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          ",
        rusqlite::params![language, provider, version, source_url, license, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    let mut imported = 0;
    for item in pack.entries {
        let lemma = item.lemma.trim().to_lowercase();
        if lemma.is_empty() {
            continue;
        }
        let definitions_json =
            serde_json::to_string(&item.definitions).map_err(|e| e.to_string())?;
        let local_audio_path = if let Some(encoded) =
            item.audio_base64.filter(|value| !value.is_empty())
        {
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                .map_err(|e| format!("invalid audio for {}: {}", lemma, e))?;
            let path = audio_dir.join(audio_cache_filename(&lemma));
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
            Some(path.to_string_lossy().to_string())
        } else {
            None
        };
        conn.execute(
            "INSERT OR REPLACE INTO dictionary_entries
             (language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)
              ",
            rusqlite::params![
                language,
                lemma,
                item.provider.unwrap_or_else(|| provider.clone()),
                item.phonetic,
                local_audio_path,
                definitions_json,
                now_ms(),
            ],
        )
        .map_err(|e| e.to_string())?;
        imported += 1;
    }
    Ok(imported)
}

fn audio_cache_filename(lemma: &str) -> String {
    let slug: String = lemma
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in lemma.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{}-{:x}.mp3", slug, hash)
}

async fn download_audio(
    app: &AppHandle,
    lemma: &str,
    language: &str,
    audio_url: &str,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionary-audio")
        .join(language);
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(audio_cache_filename(lemma));
    if !path.exists() {
        let bytes = Client::new()
            .get(audio_url)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cache_dictionary_audio(
    state: State<'_, DbState>,
    app: AppHandle,
    lemma: String,
    language: Option<String>,
) -> Result<DictionaryEntry, String> {
    let normalized = lemma.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    let (audio_url, mut entry) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let entry =
            cached_entry(&conn, &normalized, &language)?.ok_or("dictionary entry not cached")?;
        (entry.audio_url.clone(), entry)
    };
    let url = audio_url.unwrap_or_else(|| google_tts_audio_url(&normalized, &language));
    let path = download_audio(&app, &normalized, &language, &url).await?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE dictionary_entries SET local_audio_path = ?1 WHERE language = ?2 AND lemma = ?3",
        rusqlite::params![path, language, normalized],
    )
    .map_err(|e| e.to_string())?;
    entry.local_audio_path = Some(path);
    Ok(entry)
}

#[tauri::command]
pub fn read_dictionary_audio(
    state: State<DbState>,
    lemma: String,
    language: Option<String>,
) -> Result<Vec<u8>, String> {
    let normalized = lemma.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let entry =
        cached_entry(&conn, &normalized, &language)?.ok_or("dictionary entry not cached")?;
    let path = entry
        .local_audio_path
        .ok_or("audio is not cached locally")?;
    std::fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{audio_cache_filename, initialize_builtin_chinese_dictionary, initialize_builtin_chinese_phrase_dictionary, initialize_builtin_dictionary, initialize_builtin_german_dictionary, initialize_builtin_japanese_dictionary, initialize_builtin_japanese_phrase_dictionary, initialize_builtin_phrase_dictionary};
    use rusqlite::Connection;

    #[test]
    fn loads_builtin_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_dictionary_entries (
                lemma TEXT PRIMARY KEY,
                phonetic TEXT,
                translation TEXT NOT NULL,
                part_of_speech TEXT
            ) STRICT;",
        )
        .unwrap();

        initialize_builtin_dictionary(&conn).unwrap();
        initialize_builtin_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_dictionary_entries",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 50_000);
    }

    #[test]
    fn loads_builtin_phrase_dictionary_with_duplicate_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_phrase_dictionary (
                text TEXT PRIMARY KEY,
                translation TEXT NOT NULL,
                category TEXT
            ) STRICT;",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO dictionary_sources (language, provider, version, imported_at)
             VALUES ('en', 'PhraseDict', '1.0', 0)",
            [],
        )
        .unwrap();
        initialize_builtin_phrase_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_phrase_dictionary",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 4_000);

        let version: String = conn
            .query_row(
                "SELECT version FROM dictionary_sources WHERE provider = 'PhraseDict'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "2.0");
    }

    #[test]
    fn loads_builtin_chinese_phrase_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_chinese_phrase_dictionary (
                text TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                category TEXT
            ) STRICT;",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO dictionary_sources (language, provider, version, imported_at)
             VALUES ('zh', 'CC-CEDICT', '1.0', 0)",
            [],
        )
        .unwrap();
        initialize_builtin_chinese_phrase_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_chinese_phrase_dictionary",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 10_000, "count was {count}");

        let reading: String = conn
            .query_row(
                "SELECT reading FROM builtin_chinese_phrase_dictionary WHERE text = '举足轻重'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!reading.is_empty());

        let version: String = conn
            .query_row(
                "SELECT version FROM dictionary_sources WHERE provider = 'CC-CEDICT Phrases'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "2026-08");
    }

    #[test]
    fn loads_builtin_japanese_phrase_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_japanese_phrase_dictionary (
                text TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                category TEXT
            ) STRICT;",
        )
        .unwrap();

        initialize_builtin_japanese_phrase_dictionary(&conn).unwrap();
        initialize_builtin_japanese_phrase_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_japanese_phrase_dictionary",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 1_000, "count was {count}");

        let (reading, category): (String, String) = conn
            .query_row(
                "SELECT reading, category FROM builtin_japanese_phrase_dictionary WHERE text = '阿吽の呼吸'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(reading, "あうんのこきゅう");
        assert_eq!(category, "慣用句");
    }

    #[test]
    fn loads_builtin_japanese_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_japanese_dictionary_entries (
                lemma TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                part_of_speech TEXT
            ) STRICT;",
        )
        .unwrap();

        initialize_builtin_japanese_dictionary(&conn).unwrap();
        initialize_builtin_japanese_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_japanese_dictionary_entries",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 100_000);
    }

    #[test]
    fn audio_cache_filenames_are_collision_free() {
        assert_ne!(
            audio_cache_filename("食べる"),
            audio_cache_filename("走った")
        );
        assert_ne!(
            audio_cache_filename("Häuser"),
            audio_cache_filename("Hauser")
        );
        assert_eq!(
            audio_cache_filename("Haus"),
            audio_cache_filename("Haus")
        );
        assert!(audio_cache_filename("das").ends_with(".mp3"));
    }

    #[test]
    fn loads_builtin_german_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_german_dictionary_entries (
                lemma TEXT PRIMARY KEY,
                phonetic TEXT,
                translation TEXT NOT NULL,
                part_of_speech TEXT
            ) STRICT;",
        )
        .unwrap();

        initialize_builtin_german_dictionary(&conn).unwrap();
        initialize_builtin_german_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_german_dictionary_entries",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 50_000);

        let language: String = conn
            .query_row(
                "SELECT language FROM dictionary_sources WHERE provider = 'GermanDict'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(language, "de");
    }

    #[test]
    fn loads_builtin_chinese_dictionary_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (
                language TEXT NOT NULL,
                provider TEXT NOT NULL,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                PRIMARY KEY(language, provider)
            ) STRICT;
            CREATE TABLE builtin_chinese_dictionary_entries (
                lemma TEXT PRIMARY KEY,
                reading TEXT,
                translation TEXT NOT NULL,
                part_of_speech TEXT
            ) STRICT;",
        )
        .unwrap();

        initialize_builtin_chinese_dictionary(&conn).unwrap();
        initialize_builtin_chinese_dictionary(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM builtin_chinese_dictionary_entries",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count > 100_000);

        let (reading, translation): (Option<String>, String) = conn
            .query_row(
                "SELECT reading, translation FROM builtin_chinese_dictionary_entries WHERE lemma = '你好'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(reading.unwrap(), "ni3 hao3");
        assert!(translation.to_lowercase().contains("hello"));

        let language: String = conn
            .query_row(
                "SELECT language FROM dictionary_sources WHERE provider = 'CC-CEDICT'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(language, "zh");
    }
}
