use reqwest::Client;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::io::Read;
use tauri::{AppHandle, Manager, State};

use crate::commands::{collins, english};
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
    pub requested_form: String,
    pub matched_headword: String,
    pub match_kind: String,
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
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_dictionary_entries (lemma, phonetic, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(4, '\t');
            let lemma = fields.next().unwrap_or_default().trim();
            let phonetic = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let part_of_speech = fields.next().unwrap_or_default().trim();
            if lemma.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    lemma,
                    (!phonetic.is_empty()).then_some(phonetic),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
    stored_entry(conn, lemma, language, "dictionary_entries")
}

pub(crate) fn lookup_offline_entry(
    conn: &rusqlite::Connection,
    term: &str,
    language: &str,
) -> Result<Option<DictionaryEntry>, String> {
    let mut candidates = vec![term.to_string()];
    if language == "de" && term != term.to_lowercase() {
        candidates.push(term.to_lowercase());
    }
    if language == "en" {
        for (lemma, _) in english::lemma_candidates(term) {
            if !candidates.contains(&lemma) {
                candidates.push(lemma);
            }
        }
    }
    // Preserve user-provided dictionaries ahead of built-in sources.
    for candidate in &candidates {
        if let Ok(Some(mut entry)) = cached_entry(conn, candidate, language) {
            if !entry.definitions.is_empty() {
                // Cached meanings remain offline; remote audio requires an explicit online action.
                entry.audio_url = None;
                return Ok(Some(entry));
            }
        }
    }
    let mut source_error = None;
    for candidate in &candidates {
        let found = (|| -> Result<_, String> {
            Ok(match language {
            "en" => conn.query_row("SELECT phonetic,translation,part_of_speech FROM builtin_dictionary_entries WHERE lemma=?1", [candidate], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?,
            "ja" => builtin_japanese_entry(conn, candidate)?,
            "de" => builtin_german_entry(conn, candidate)?,
            "zh" => builtin_chinese_entry(conn, candidate)?,
            _ => return Err("ERR_DICTIONARY_LANGUAGE".into()),
        })
        })();
        let found = match found {
            Ok(found) => found,
            Err(error) => {
                source_error = Some(error);
                continue;
            }
        };
        if let Some((phonetic, translation, pos)) = found {
            return Ok(Some(DictionaryEntry {
                language: language.into(),
                lemma: candidate.clone(),
                requested_form: term.into(),
                matched_headword: candidate.clone(),
                match_kind: if candidate == term {
                    "exact"
                } else {
                    "inflection"
                }
                .into(),
                provider: match language {
                    "en" => "ECDICT",
                    "ja" => "JMdict",
                    "de" => "GermanDict",
                    _ => "CC-CEDICT",
                }
                .into(),
                phonetic,
                audio_url: None,
                local_audio_path: None,
                definitions: vec![DictionaryDefinition {
                    part_of_speech: pos.unwrap_or_default(),
                    definition: String::new(),
                    translation: Some(translation),
                    example: None,
                }],
                fetched_at: now_ms(),
            }));
        }
    }
    for candidate in &candidates {
        if let Ok(Some(mut entry)) =
            stored_entry(conn, candidate, language, "online_dictionary_entries")
        {
            if !entry.definitions.is_empty() {
                // Cached meanings remain offline; remote audio requires an explicit online action.
                entry.audio_url = None;
                return Ok(Some(entry));
            }
        }
    }
    if let Some(error) = source_error {
        return Err(error);
    }
    Ok(None)
}

fn stored_entry(
    conn: &rusqlite::Connection,
    lemma: &str,
    language: &str,
    table: &str,
) -> Result<Option<DictionaryEntry>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at
             FROM {table} WHERE language = ?1 AND lemma = ?2"
        ))
        .map_err(|e| e.to_string())?;
    let result = stmt.query_row([language, lemma], |row| {
        let definitions_json: String = row.get(5)?;
        let definitions = serde_json::from_str(&definitions_json).unwrap_or_default();
        Ok(DictionaryEntry {
            lemma: row.get(0)?,
            requested_form: row.get(0)?,
            matched_headword: row.get(0)?,
            match_kind: "exact".to_string(),
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

#[tauri::command]
pub fn lookup_local_dictionary(app: AppHandle, lemma: String) -> Result<DictionaryEntry, String> {
    let normalized = lemma.trim().to_lowercase();
    if normalized.is_empty() {
        return Err("word is empty".into());
    }
    let path = collins::index_path(&app)?;
    if !path.is_file() {
        return Err("Collins index is not installed".into());
    }
    let (matched, match_kind, senses) = resolve_collins_word(&path, &normalized)?;
    if senses.is_empty() {
        return Err(format!("Collins entry not found: {normalized}"));
    }
    Ok(DictionaryEntry {
        language: "en".to_string(),
        lemma: normalized.clone(),
        requested_form: normalized,
        matched_headword: matched,
        match_kind,
        provider: collins::PROVIDER.to_string(),
        phonetic: None,
        audio_url: None,
        local_audio_path: None,
        definitions: senses
            .into_iter()
            .map(|sense| DictionaryDefinition {
                part_of_speech: sense.grammar,
                definition: sense.definition,
                translation: None,
                example: sense.example,
            })
            .collect(),
        fetched_at: now_ms(),
    })
}

fn resolve_collins_word(
    path: &std::path::Path,
    normalized: &str,
) -> Result<(String, String, Vec<collins::Sense>), String> {
    let mut matched = normalized.to_string();
    let mut match_kind = "exact".to_string();
    let mut senses = collins::lookup_word(&path, &matched)?;
    if senses.is_empty() {
        let lemma = english::lemma_of_surface(normalized);
        if lemma != normalized {
            let candidate_senses = collins::lookup_word(&path, &lemma)?;
            if !candidate_senses.is_empty() {
                matched = lemma.clone();
                match_kind = "inflection".to_string();
                senses = candidate_senses;
            }
        }
        if senses.is_empty() {
            let mut spelling_candidates = english::spelling_variants(&lemma);
            spelling_candidates.extend(english::spelling_variants(normalized));
            spelling_candidates.sort();
            spelling_candidates.dedup();
            for candidate in spelling_candidates {
                let candidate_senses = collins::lookup_word(&path, &candidate)?;
                if !candidate_senses.is_empty() {
                    matched = candidate;
                    match_kind = "spelling_variant".to_string();
                    senses = candidate_senses;
                    break;
                }
            }
        }
    }
    Ok((matched, match_kind, senses))
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
        .take(16 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 16 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction
            .prepare_cached(
                "INSERT OR IGNORE INTO builtin_phrase_dictionary (text, translation, category)
                 VALUES (?1, ?2, ?3)",
            )
            .map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(3, '\t');
            let text = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let category = fields.next().unwrap_or_default().trim();
            if text.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![text, translation, category])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
        .take(64 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 64 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_japanese_dictionary_entries (lemma, reading, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(4, '\t');
            let lemma = fields.next().unwrap_or_default().trim();
            let reading = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let part_of_speech = fields.next().unwrap_or_default().trim();
            if lemma.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    lemma,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_german_dictionary_entries (lemma, phonetic, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(4, '\t');
            let lemma = fields.next().unwrap_or_default().trim();
            let phonetic = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let part_of_speech = fields.next().unwrap_or_default().trim();
            if lemma.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    lemma,
                    (!phonetic.is_empty()).then_some(phonetic),
                    translation,
                    (!part_of_speech.is_empty()).then_some(part_of_speech),
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_chinese_dictionary_entries (lemma, reading, translation, part_of_speech)
                 VALUES (?1, ?2, ?3, NULL)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(3, '\t');
            let lemma = fields.next().unwrap_or_default().trim();
            let reading = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            if lemma.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    lemma,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_chinese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(4, '\t');
            let text = fields.next().unwrap_or_default().trim();
            let reading = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let category = fields.next().unwrap_or_default().trim();
            if text.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    text,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!category.is_empty()).then_some(category),
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
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
        .take(32 * 1024 * 1024 + 1)
        .read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Dictionary resource exceeds size limit".into());
    }
    let lines: Vec<_> = contents.lines().collect();
    let mut processed = 0u64;
    for chunk in lines.chunks(2_000) {
        let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut statement = transaction.prepare_cached("INSERT OR IGNORE INTO builtin_japanese_phrase_dictionary (text, reading, translation, category)
                 VALUES (?1, ?2, ?3, ?4)").map_err(|e| e.to_string())?;
        for line in chunk {
            let mut fields = line.splitn(4, '\t');
            let text = fields.next().unwrap_or_default().trim();
            let reading = fields.next().unwrap_or_default().trim();
            let translation = fields.next().unwrap_or_default().trim();
            let category = fields.next().unwrap_or_default().trim();
            if text.is_empty() || translation.is_empty() {
                continue;
            }
            statement
                .execute(rusqlite::params![
                    text,
                    (!reading.is_empty()).then_some(reading),
                    translation,
                    (!category.is_empty()).then_some(category),
                ])
                .map_err(|e| e.to_string())?;
        }
        drop(statement);
        transaction.commit().map_err(|e| e.to_string())?;
        processed += chunk.len() as u64;
        super::dictionary_init::report_rows(processed);
        std::thread::yield_now();
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    transaction
        .execute(
            "INSERT OR REPLACE INTO dictionary_sources (language, provider, version, source_url, license, imported_at)
              VALUES ('ja', 'JMdict Idioms', '2026-08', 'https://github.com/scriptin/jmdict-simplified', 'CC BY-SA 4.0', ?1)",
            [now_ms()],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

fn missing_phrase_reason(app: &AppHandle, language: &str) -> String {
    if let Some(status) = app.try_state::<DictionaryStatus>() {
        let snapshot = status.snapshot();
        let sources: Vec<_> = snapshot
            .sources
            .iter()
            .filter(|s| {
                s.language == language && (s.name.contains("Phrase") || s.name.contains("Idioms"))
            })
            .collect();
        if sources.iter().any(|s| s.state == "failed") {
            return "ERR_DICTIONARY_UNAVAILABLE".into();
        }
        if sources.iter().any(|s| s.state != "ready") {
            return "ERR_DICTIONARY_PREPARING".into();
        }
    }
    "ERR_DICTIONARY_NOT_FOUND".into()
}

#[tauri::command]
pub fn lookup_phrase_dictionary(
    state: State<DbState>,
    app: AppHandle,
    text: String,
    language: Option<String>,
) -> Result<PhraseDictionaryEntry, String> {
    let normalized = text.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    let collins_path = collins::index_path(&app)?;
    let mut collins_available = language == "en" && collins_path.is_file();
    let collins_senses = if language == "en" {
        collins::lookup_phrase(&collins_path, &normalized).unwrap_or_else(|error| {
            log::warn!("Collins unavailable: {error}");
            collins_available = false;
            Vec::new()
        })
    } else {
        Vec::new()
    };
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let ollama_result = conn.query_row(
        "SELECT text, translation, pinyin, usage_zh, category, provider, other_senses_json, other_senses_edited,
                meaning_en, usage_en, other_senses_en_json, other_senses_en_edited, expression_meta_json
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
                other_senses: serde_json::from_str(&row.get::<_, String>(6)?).unwrap_or_default(),
                other_senses_edited: row.get::<_, i64>(7)? != 0,
                meaning_en: row.get(8)?,
                usage_en: row.get(9)?,
                other_senses_en: serde_json::from_str(&row.get::<_, String>(10)?).unwrap_or_default(),
                other_senses_en_edited: row.get::<_, i64>(11)? != 0,
                collins_senses: collins_senses.clone(),
                collins_available,
                expression_metadata: row.get::<_, Option<String>>(12)?.and_then(|raw| serde_json::from_str(&raw).ok()),
            })
        },
    );
    match ollama_result {
        Ok(entry) => return Ok(entry),
        Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(error) => return Err(error.to_string()),
    }
    if language == "en" && !collins_senses.is_empty() {
        return Ok(PhraseDictionaryEntry {
            text: normalized,
            translation: String::new(),
            pinyin: None,
            usage_zh: None,
            category: None,
            provider: collins::PROVIDER.into(),
            other_senses: Vec::new(),
            other_senses_edited: false,
            meaning_en: None,
            usage_en: None,
            other_senses_en: Vec::new(),
            other_senses_en_edited: false,
            collins_senses,
            collins_available,
                expression_metadata: None,
        });
    }
    if language == "zh" || language == "ja" {
        let sql = if language == "ja" {
            "SELECT text, reading, translation, category FROM builtin_japanese_phrase_dictionary WHERE text = ?1"
        } else {
            "SELECT text, reading, translation, category FROM builtin_chinese_phrase_dictionary WHERE text = ?1"
        };
        let result = conn.query_row(sql, [&normalized], |row| {
            Ok(PhraseDictionaryEntry {
                text: row.get(0)?,
                translation: row.get(2)?,
                pinyin: row.get(1)?,
                usage_zh: None,
                category: row.get(3)?,
                provider: if language == "ja" {
                    "JMdict Idioms"
                } else {
                    "CC-CEDICT Phrases"
                }
                .to_string(),
                other_senses: Vec::new(),
                other_senses_edited: false,
                meaning_en: None,
                usage_en: None,
                other_senses_en: Vec::new(),
                other_senses_en_edited: false,
                collins_senses: Vec::new(),
                collins_available: false,
                expression_metadata: None,
            })
        });
        return match result {
            Ok(entry) => Ok(entry),
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                Err(missing_phrase_reason(&app, &language))
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
                other_senses: Vec::new(),
                other_senses_edited: false,
                meaning_en: None,
                usage_en: None,
                other_senses_en: Vec::new(),
                other_senses_en_edited: false,
                collins_senses: Vec::new(),
                collins_available: false,
                expression_metadata: None,
            })
        },
    );
    match result {
        Ok(entry) => Ok(entry),
        Err(rusqlite::Error::QueryReturnedNoRows) => Err(missing_phrase_reason(&app, &language)),
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
    #[serde(default)]
    pub expression_metadata: Option<crate::commands::english::ExpressionMetadata>,
    pub provider: String,
    pub other_senses: Vec<PhraseOtherSense>,
    pub other_senses_edited: bool,
    pub meaning_en: Option<String>,
    pub usage_en: Option<String>,
    pub other_senses_en: Vec<PhraseOtherSenseEn>,
    pub other_senses_en_edited: bool,
    pub collins_senses: Vec<collins::Sense>,
    pub collins_available: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PhraseOtherSense {
    pub meaning_zh: String,
    pub example_en: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PhraseOtherSenseEn {
    pub meaning_en: String,
    pub example_en: String,
}

#[tauri::command]
pub fn update_phrase_other_senses_en(
    state: State<DbState>,
    text: String,
    other_senses: Vec<PhraseOtherSenseEn>,
) -> Result<(), String> {
    if other_senses.len() > 2
        || other_senses
            .iter()
            .any(|sense| sense.meaning_en.trim().is_empty() || sense.example_en.trim().is_empty())
    {
        return Err("At most two complete senses are allowed".into());
    }
    let json = serde_json::to_string(&other_senses).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_en_json,other_senses_en_edited)
         VALUES('en',?1,'','manual',?2,?3,1)
         ON CONFLICT(language,text) DO UPDATE SET other_senses_en_json=excluded.other_senses_en_json,other_senses_en_edited=1",
        rusqlite::params![text.trim().to_lowercase(),now_ms(),json],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_phrase_other_senses(
    state: State<DbState>,
    text: String,
    language: String,
    other_senses: Vec<PhraseOtherSense>,
) -> Result<(), String> {
    if other_senses.len() > 2
        || other_senses
            .iter()
            .any(|sense| sense.meaning_zh.trim().is_empty() || sense.example_en.trim().is_empty())
    {
        return Err("扩展义最多两项，且释义和例句不能为空".to_string());
    }
    let json = serde_json::to_string(&other_senses).map_err(|error| error.to_string())?;
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    conn.execute("INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited)
        VALUES(?1,?2,'','manual',?3,?4,1)
        ON CONFLICT(language,text) DO UPDATE SET other_senses_json=excluded.other_senses_json,other_senses_edited=1",
        rusqlite::params![language,text.trim().to_lowercase(),now_ms(),json]).map_err(|error| error.to_string())?;
    Ok(())
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
    list_dictionary_sources_for_conn(&conn)
}

fn list_dictionary_sources_for_conn(
    conn: &rusqlite::Connection,
) -> Result<Vec<DictionarySource>, String> {
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
                        + CASE WHEN s.provider = 'PhraseDict'
                            THEN (SELECT COUNT(*) FROM builtin_phrase_dictionary)
                        ELSE 0 END
                        + CASE WHEN s.provider = 'CC-CEDICT Phrases'
                            THEN (SELECT COUNT(*) FROM builtin_chinese_phrase_dictionary)
                        ELSE 0 END
                        + CASE WHEN s.provider = 'JMdict Idioms'
                            THEN (SELECT COUNT(*) FROM builtin_japanese_phrase_dictionary)
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
    if provider == "ECDICT"
        || provider == "JMdict"
        || provider == "GermanDict"
        || provider == "CC-CEDICT"
    {
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
            let translation_for_def = if index == 0 {
                local_translation.clone()
            } else {
                None
            };
            sense
                .english_definitions
                .iter()
                .map(move |def| DictionaryDefinition {
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
        requested_form: normalized.to_string(),
        matched_headword: normalized.to_string(),
        match_kind: "online_fallback".to_string(),
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
    mode: Option<String>,
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

    match mode.as_deref().unwrap_or("local") {
        "local" => {
            // This branch must never instantiate a network client or download audio.
            if language == "en" {
                if let Ok(entry) = lookup_local_dictionary(app.clone(), normalized.clone()) {
                    return Ok(entry);
                }
            }
            let result = {
                let conn = state.conn.lock().map_err(|e| e.to_string())?;
                lookup_offline_entry(&conn, &normalized, &language)?
            };
            return result.ok_or_else(|| {
                if app
                    .try_state::<DictionaryStatus>()
                    .is_some_and(|s| s.language_failed(&language))
                {
                    "ERR_DICTIONARY_UNAVAILABLE".into()
                } else if app
                    .try_state::<DictionaryStatus>()
                    .is_some_and(|s| !s.language_ready(&language))
                {
                    "ERR_DICTIONARY_PREPARING".into()
                } else {
                    "ERR_DICTIONARY_NOT_FOUND".into()
                }
            });
        }
        "online" => {}
        _ => return Err("ERR_DICTIONARY_MODE".into()),
    }

    if language == "ja" {
        return lookup_japanese(state, app.clone(), normalized, refresh).await;
    }

    if language == "de" {
        return lookup_german(state, app.clone(), normalized, refresh).await;
    }

    if language == "zh" {
        return lookup_chinese(state, app.clone(), normalized, refresh).await;
    }

    // English uses the owner's COBUILD index as the sole local authority.
    // A refresh explicitly asks for online data; otherwise any Collins hit
    // returns immediately, without an HTTP request.
    let collins_entry = if language == "en" {
        match lookup_local_dictionary(app.clone(), normalized.clone()) {
            Ok(entry) => Some(entry),
            Err(error)
                if error == "Collins index is not installed"
                    || error.starts_with("Collins entry not found:") =>
            {
                None
            }
            Err(error) => {
                log::warn!("Private dictionary unavailable: {error}");
                None
            }
        }
    } else {
        None
    };
    if !refresh {
        if let Some(entry) = collins_entry.as_ref() {
            return Ok(entry.clone());
        }
    }

    let online_cached = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        stored_entry(&conn, &normalized, &language, "online_dictionary_entries")?
    };
    if !refresh {
        if let Some(entry) = online_cached.as_ref() {
            return Ok(entry.clone());
        }
    }

    let local_fallback = online_cached.or(collins_entry);

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
    let phonetic = api_entries.iter().find_map(|entry| {
        entry.phonetic.clone().or_else(|| {
            entry
                .phonetics
                .as_ref()?
                .iter()
                .find_map(|item| item.text.clone())
        })
    });
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
        .map(|(meaning, definition)| DictionaryDefinition {
            part_of_speech: meaning.part_of_speech.clone().unwrap_or_default(),
            definition: definition.definition.clone(),
            translation: None,
            example: definition.example.clone(),
        })
        .take(12)
        .collect::<Vec<_>>();
    let entry = DictionaryEntry {
        lemma: normalized.clone(),
        requested_form: normalized.clone(),
        matched_headword: normalized.clone(),
        match_kind: "online_fallback".to_string(),
        language: language.clone(),
        provider: "dictionaryapi.dev".to_string(),
        phonetic,
        audio_url,
        local_audio_path: None,
        definitions,
        fetched_at: now_ms(),
    };

    let definitions_json = serde_json::to_string(&entry.definitions).map_err(|e| e.to_string())?;
    let _ = app;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO online_dictionary_entries
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
        builtin
            .as_ref()
            .map(|(reading, translation, part_of_speech)| DictionaryEntry {
                lemma: normalized.clone(),
                requested_form: normalized.clone(),
                matched_headword: normalized.clone(),
                match_kind: "exact".to_string(),
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
            requested_form: normalized.clone(),
            matched_headword: key.clone(),
            match_kind: "exact".to_string(),
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
            requested_form: normalized.clone(),
            matched_headword: normalized.clone(),
            match_kind: "exact".to_string(),
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
        let entry = if language == "en" {
            stored_entry(&conn, &normalized, &language, "online_dictionary_entries")?
                .or(cached_entry(&conn, &normalized, &language)?)
        } else {
            cached_entry(&conn, &normalized, &language)?
        }
        .ok_or("dictionary entry not cached")?;
        (entry.audio_url.clone(), entry)
    };
    let url = audio_url.unwrap_or_else(|| google_tts_audio_url(&normalized, &language));
    let path = download_audio(&app, &normalized, &language, &url).await?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let table = if language == "en" && entry.provider.starts_with("dictionaryapi.dev") {
        "online_dictionary_entries"
    } else {
        "dictionary_entries"
    };
    conn.execute(
        &format!("UPDATE {table} SET local_audio_path = ?1 WHERE language = ?2 AND lemma = ?3"),
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
    let entry = if language == "en" {
        stored_entry(&conn, &normalized, &language, "online_dictionary_entries")?
            .filter(|entry| entry.local_audio_path.is_some())
            .or(cached_entry(&conn, &normalized, &language)?)
    } else {
        cached_entry(&conn, &normalized, &language)?
    }
    .ok_or("dictionary entry not cached")?;
    let path = entry
        .local_audio_path
        .ok_or("audio is not cached locally")?;
    std::fs::read(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::lookup_offline_entry;
    use super::{
        audio_cache_filename, initialize_builtin_chinese_dictionary,
        initialize_builtin_chinese_phrase_dictionary, initialize_builtin_dictionary,
        initialize_builtin_german_dictionary, initialize_builtin_japanese_dictionary,
        initialize_builtin_japanese_phrase_dictionary, initialize_builtin_phrase_dictionary,
        list_dictionary_sources_for_conn, resolve_collins_word,
    };
    use rusqlite::Connection;

    fn offline_fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE dictionary_entries(language TEXT,lemma TEXT,provider TEXT,phonetic TEXT,audio_url TEXT,local_audio_path TEXT,definitions_json TEXT,fetched_at INTEGER);
        CREATE TABLE online_dictionary_entries AS SELECT * FROM dictionary_entries;
        CREATE TABLE builtin_dictionary_entries(lemma TEXT PRIMARY KEY,phonetic TEXT,translation TEXT,part_of_speech TEXT);
        CREATE TABLE builtin_japanese_dictionary_entries(lemma TEXT PRIMARY KEY,reading TEXT,translation TEXT,part_of_speech TEXT);
        CREATE TABLE builtin_german_dictionary_entries(lemma TEXT PRIMARY KEY,phonetic TEXT,translation TEXT,part_of_speech TEXT);
        CREATE TABLE builtin_chinese_dictionary_entries(lemma TEXT PRIMARY KEY,reading TEXT,translation TEXT,part_of_speech TEXT);
        CREATE TABLE dictionary_sources(language TEXT,provider TEXT,version TEXT,source_url TEXT,license TEXT,imported_at INTEGER,PRIMARY KEY(language,provider));").unwrap();
        conn
    }
    #[test]
    fn offline_lookup_uses_all_languages_inflections_and_cache_without_writes() {
        let conn = offline_fixture();
        conn.execute_batch("INSERT INTO builtin_dictionary_entries VALUES('pick',NULL,'选择','v.');
        INSERT INTO builtin_japanese_dictionary_entries VALUES('猫','ねこ','cat','noun');
        INSERT INTO builtin_german_dictionary_entries VALUES('straße',NULL,'street','noun');
        INSERT INTO builtin_chinese_dictionary_entries VALUES('中文','zhong1 wen2','Chinese','noun');").unwrap();
        let changes = conn
            .query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
            .unwrap();
        for (lang, term, provider) in [
            ("en", "picked", "ECDICT"),
            ("ja", "猫", "JMdict"),
            ("de", "Straße", "GermanDict"),
            ("zh", "中文", "CC-CEDICT"),
        ] {
            assert_eq!(
                lookup_offline_entry(&conn, term, lang)
                    .unwrap()
                    .unwrap()
                    .provider,
                provider
            );
        }
        assert!(lookup_offline_entry(&conn, "not-in-fixture", "en")
            .unwrap()
            .is_none());
        assert_eq!(
            conn.query_row("SELECT total_changes()", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            changes
        );
        conn.execute("INSERT INTO online_dictionary_entries VALUES('en','cached','online',NULL,'https://example.invalid/audio.mp3',NULL,?1,0)",[r#"[{"part_of_speech":"noun","definition":"cached definition","translation":null,"example":null}]"#]).unwrap();
        conn.execute_batch("DROP TABLE builtin_dictionary_entries;")
            .unwrap();
        let cached = lookup_offline_entry(&conn, "cached", "en")
            .unwrap()
            .unwrap();
        assert_eq!(cached.provider, "online");
        assert!(cached.audio_url.is_none());
    }
    #[test]
    fn interrupted_import_keeps_chunks_and_retries_without_duplicates() {
        let conn = offline_fixture();
        conn.execute_batch("CREATE TRIGGER stop_import BEFORE INSERT ON builtin_dictionary_entries WHEN (SELECT COUNT(*) FROM builtin_dictionary_entries)>=2000 BEGIN SELECT RAISE(FAIL,'interrupted'); END;").unwrap();
        assert!(initialize_builtin_dictionary(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM builtin_dictionary_entries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2000
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM dictionary_sources", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER stop_import;").unwrap();
        initialize_builtin_dictionary(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM builtin_dictionary_entries", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(count > 50000);
        initialize_builtin_dictionary(&conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM builtin_dictionary_entries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            count
        );
    }
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
        assert_eq!(audio_cache_filename("Haus"), audio_cache_filename("Haus"));
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

    #[test]
    fn lists_builtin_phrase_dictionary_record_counts() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE dictionary_sources (language TEXT NOT NULL, provider TEXT NOT NULL, version TEXT, source_url TEXT, license TEXT, imported_at INTEGER NOT NULL, PRIMARY KEY(language, provider));
             CREATE TABLE dictionary_entries (lemma TEXT, provider TEXT, language TEXT);
             CREATE TABLE builtin_dictionary_entries (lemma TEXT);
             CREATE TABLE builtin_japanese_dictionary_entries (lemma TEXT);
             CREATE TABLE builtin_german_dictionary_entries (lemma TEXT);
             CREATE TABLE builtin_chinese_dictionary_entries (lemma TEXT);
             CREATE TABLE builtin_phrase_dictionary (text TEXT);
             CREATE TABLE builtin_chinese_phrase_dictionary (text TEXT);
             CREATE TABLE builtin_japanese_phrase_dictionary (text TEXT);",
        ).unwrap();
        conn.execute_batch(
            "INSERT INTO dictionary_sources VALUES ('en', 'PhraseDict', NULL, NULL, NULL, 1);
             INSERT INTO dictionary_sources VALUES ('zh', 'CC-CEDICT Phrases', NULL, NULL, NULL, 2);
             INSERT INTO dictionary_sources VALUES ('ja', 'JMdict Idioms', NULL, NULL, NULL, 3);
             INSERT INTO builtin_phrase_dictionary VALUES ('in spite of');
             INSERT INTO builtin_phrase_dictionary VALUES ('as well as');
             INSERT INTO builtin_chinese_phrase_dictionary VALUES ('你好');
             INSERT INTO builtin_japanese_phrase_dictionary VALUES ('一方で');
             INSERT INTO builtin_japanese_phrase_dictionary VALUES ('にもかかわらず');",
        )
        .unwrap();

        let sources = list_dictionary_sources_for_conn(&conn).unwrap();
        let counts: std::collections::HashMap<_, _> = sources
            .into_iter()
            .map(|source| (source.provider, source.entry_count))
            .collect();
        assert_eq!(counts.get("PhraseDict"), Some(&2));
        assert_eq!(counts.get("CC-CEDICT Phrases"), Some(&1));
        assert_eq!(counts.get("JMdict Idioms"), Some(&2));
    }

    #[test]
    fn collins_resolution_keeps_requested_spelling_and_verifies_the_variant() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let conn = Connection::open(file.path()).unwrap();
        conn.execute_batch(
            "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
             CREATE TABLE word_senses(id INTEGER PRIMARY KEY,lookup_key TEXT,headword TEXT,grammar TEXT,definition TEXT,example TEXT);
             INSERT INTO metadata VALUES('provider','Collins COBUILD V3');
             INSERT INTO word_senses VALUES(1,'enrol','enrol','V-ERG','officially join a course',NULL);",
        ).unwrap();
        drop(conn);
        let (headword, kind, senses) = resolve_collins_word(file.path(), "enroll").unwrap();
        assert_eq!(
            (headword.as_str(), kind.as_str(), senses.len()),
            ("enrol", "spelling_variant", 1)
        );
        let (headword, kind, senses) = resolve_collins_word(file.path(), "enrolled").unwrap();
        assert_eq!(
            (headword.as_str(), kind.as_str(), senses.len()),
            ("enrol", "spelling_variant", 1)
        );
    }
}
