use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, State};

use crate::db::DbState;

#[derive(Serialize)]
pub struct DailyReviewStat {
    pub day_start: i64,
    pub count: i64,
}

#[derive(Serialize)]
pub struct FileProgress {
    pub id: i64,
    pub name: String,
    pub total_words: i64,
    pub unprocessed: i64,
    pub learning: i64,
    pub known: i64,
    pub ignored: i64,
    pub language: String,
}

#[derive(Serialize)]
pub struct LearningStats {
    pub total_words: i64,
    pub unprocessed: i64,
    pub learning: i64,
    pub known: i64,
    pub ignored: i64,
    pub due_cards: i64,
    pub total_reviews: i64,
    pub total_phrases: i64,
    pub phrases_unprocessed: i64,
    pub phrases_learning: i64,
    pub phrases_known: i64,
    pub phrases_ignored: i64,
    pub due_phrase_cards: i64,
    pub total_phrase_reviews: i64,
    pub daily_reviews: Vec<DailyReviewStat>,
    pub files: Vec<FileProgress>,
}

#[derive(Serialize)]
pub struct StorageComponent {
    pub key: &'static str,
    pub bytes: u64,
}

#[derive(Serialize)]
pub struct DatabaseBreakdown {
    pub user_data: u64,
    pub builtin_dictionaries: u64,
    pub dictionary_entries: u64,
}

#[derive(Serialize)]
pub struct StorageUsage {
    pub total: u64,
    pub components: Vec<StorageComponent>,
    pub database_breakdown: DatabaseBreakdown,
}

fn count_query(conn: &rusqlite::Connection, sql: &str) -> Result<i64, String> {
    conn.query_row(sql, [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[tauri::command]
pub fn get_learning_stats(state: State<DbState>) -> Result<LearningStats, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = now_ms();
    let day_ms = 86_400_000_i64;
    let day_start = now / day_ms * day_ms;

    let total_words = count_query(&conn, "SELECT COUNT(*) FROM words")?;
    let unprocessed = count_query(
        &conn,
        "SELECT COUNT(*) FROM words WHERE status = 'unprocessed'",
    )?;
    let learning = count_query(
        &conn,
        "SELECT COUNT(*) FROM words WHERE status = 'learning'",
    )?;
    let known = count_query(&conn, "SELECT COUNT(*) FROM words WHERE status = 'known'")?;
    let ignored = count_query(&conn, "SELECT COUNT(*) FROM words WHERE status = 'ignored'")?;
    let due_cards = conn
        .query_row(
            "SELECT COUNT(*) FROM reviews r JOIN words w ON w.id = r.word_id
             WHERE w.status = 'learning' AND r.due_at <= ?1",
            [now],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total_reviews = count_query(&conn, "SELECT COUNT(*) FROM review_logs")?;

    let total_phrases = count_query(&conn, "SELECT COUNT(*) FROM phrases")?;
    let phrases_unprocessed = count_query(
        &conn,
        "SELECT COUNT(*) FROM phrases WHERE status = 'unprocessed'",
    )?;
    let phrases_learning = count_query(
        &conn,
        "SELECT COUNT(*) FROM phrases WHERE status = 'learning'",
    )?;
    let phrases_known = count_query(&conn, "SELECT COUNT(*) FROM phrases WHERE status = 'known'")?;
    let phrases_ignored = count_query(
        &conn,
        "SELECT COUNT(*) FROM phrases WHERE status = 'ignored'",
    )?;
    let due_phrase_cards = conn
        .query_row(
            "SELECT COUNT(*) FROM phrase_reviews r JOIN phrases p ON p.id = r.phrase_id
             WHERE p.status = 'learning' AND r.due_at <= ?1",
            [now],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total_phrase_reviews = count_query(&conn, "SELECT COUNT(*) FROM phrase_review_logs")?;

    let mut daily_reviews = Vec::new();
    for offset in (0..7).rev() {
        let start = day_start - offset * day_ms;
        let end = start + day_ms;
        let word_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?1 AND reviewed_at < ?2",
                rusqlite::params![start, end],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let phrase_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM phrase_review_logs WHERE reviewed_at >= ?1 AND reviewed_at < ?2",
                rusqlite::params![start, end],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        daily_reviews.push(DailyReviewStat {
            day_start: start,
            count: word_count + phrase_count,
        });
    }

    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.name, f.language,
                    COUNT(DISTINCT o.word_id),
                    COUNT(DISTINCT CASE WHEN w.status = 'unprocessed' THEN o.word_id END),
                    COUNT(DISTINCT CASE WHEN w.status = 'learning' THEN o.word_id END),
                    COUNT(DISTINCT CASE WHEN w.status = 'known' THEN o.word_id END),
                    COUNT(DISTINCT CASE WHEN w.status = 'ignored' THEN o.word_id END)
             FROM files f
             LEFT JOIN segments s ON s.file_id = f.id
             LEFT JOIN occurrences o ON o.segment_id = s.id
             LEFT JOIN words w ON w.id = o.word_id
             GROUP BY f.id
             ORDER BY f.imported_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FileProgress {
                id: row.get(0)?,
                name: row.get(1)?,
                language: row.get(2)?,
                total_words: row.get(3)?,
                unprocessed: row.get(4)?,
                learning: row.get(5)?,
                known: row.get(6)?,
                ignored: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for row in rows {
        files.push(row.map_err(|e| e.to_string())?);
    }

    Ok(LearningStats {
        total_words,
        unprocessed,
        learning,
        known,
        ignored,
        due_cards,
        total_reviews,
        total_phrases,
        phrases_unprocessed,
        phrases_learning,
        phrases_known,
        phrases_ignored,
        due_phrase_cards,
        total_phrase_reviews,
        daily_reviews,
        files,
    })
}

fn dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                total += entry.metadata().map_err(|e| e.to_string())?.len();
            }
        }
    }
    Ok(total)
}

fn estimate_table_bytes(conn: &rusqlite::Connection, table: &str, sum_expr: &str) -> Result<u64, String> {
    let sql = format!("SELECT COUNT(*), COALESCE({sum_expr}, 0) FROM {table}");
    let (rows, bytes): (i64, i64) = conn
        .query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(bytes.max(0) as u64 + rows.max(0) as u64 * 40)
}

fn estimate_group(conn: &rusqlite::Connection, specs: &[(&str, &str)]) -> Result<u64, String> {
    let mut total = 0u64;
    for (table, sum_expr) in specs {
        total += estimate_table_bytes(conn, table, sum_expr)?;
    }
    Ok(total)
}

#[tauri::command]
pub fn get_storage_usage(app: AppHandle, state: State<DbState>) -> Result<StorageUsage, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let mut database = 0u64;
    let mut audio_cache = 0u64;
    let mut backup = 0u64;
    let mut other = 0u64;
    for entry in std::fs::read_dir(&app_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            let size = dir_size(&entry.path())?;
            if name == "dictionary-audio" {
                audio_cache += size;
            } else {
                other += size;
            }
        } else if file_type.is_file() {
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            if name.starts_with("lexicue.db.bak") {
                backup += size;
            } else if name.starts_with("lexicue.db") {
                database += size;
            } else {
                other += size;
            }
        }
    }

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let user_data = estimate_group(
        &conn,
        &[
            ("files", "SUM(LENGTH(name)) + SUM(LENGTH(content)) + SUM(LENGTH(content_hash))"),
            ("segments", "SUM(LENGTH(en_text)) + SUM(LENGTH(zh_text)) + SUM(LENGTH(start_time)) + SUM(LENGTH(end_time))"),
            ("words", "SUM(LENGTH(language)) + SUM(LENGTH(lemma)) + SUM(LENGTH(definition)) + SUM(LENGTH(reading)) + SUM(LENGTH(part_of_speech))"),
            ("occurrences", "SUM(LENGTH(original_form))"),
            ("reviews", "0"),
            ("review_logs", "0"),
            ("phrases", "SUM(LENGTH(language)) + SUM(LENGTH(text)) + SUM(LENGTH(definition))"),
            ("phrase_dictionary_entries", "SUM(LENGTH(language)) + SUM(LENGTH(text)) + SUM(LENGTH(translation)) + SUM(LENGTH(pinyin)) + SUM(LENGTH(usage_zh)) + SUM(LENGTH(category)) + SUM(LENGTH(provider))"),
            ("file_phrase_analysis", "SUM(LENGTH(model))"),
            ("phrase_occurrences", "0"),
            ("phrase_reviews", "0"),
            ("phrase_review_logs", "0"),
        ],
    )?;

    let builtin_dictionaries = estimate_group(
        &conn,
        &[
            ("builtin_dictionary_entries", "SUM(LENGTH(lemma)) + SUM(LENGTH(phonetic)) + SUM(LENGTH(translation)) + SUM(LENGTH(part_of_speech))"),
            ("builtin_japanese_dictionary_entries", "SUM(LENGTH(lemma)) + SUM(LENGTH(reading)) + SUM(LENGTH(translation)) + SUM(LENGTH(part_of_speech))"),
            ("builtin_german_dictionary_entries", "SUM(LENGTH(lemma)) + SUM(LENGTH(phonetic)) + SUM(LENGTH(translation)) + SUM(LENGTH(part_of_speech))"),
            ("builtin_chinese_dictionary_entries", "SUM(LENGTH(lemma)) + SUM(LENGTH(reading)) + SUM(LENGTH(translation)) + SUM(LENGTH(part_of_speech))"),
            ("builtin_phrase_dictionary", "SUM(LENGTH(text)) + SUM(LENGTH(translation)) + SUM(LENGTH(part_of_speech)) + SUM(LENGTH(category))"),
            ("builtin_chinese_phrase_dictionary", "SUM(LENGTH(text)) + SUM(LENGTH(reading)) + SUM(LENGTH(translation)) + SUM(LENGTH(category))"),
            ("builtin_japanese_phrase_dictionary", "SUM(LENGTH(text)) + SUM(LENGTH(reading)) + SUM(LENGTH(translation)) + SUM(LENGTH(category))"),
        ],
    )?;

    let dictionary_entries = estimate_group(
        &conn,
        &[
            ("dictionary_entries", "SUM(LENGTH(language)) + SUM(LENGTH(lemma)) + SUM(LENGTH(provider)) + SUM(LENGTH(phonetic)) + SUM(LENGTH(audio_url)) + SUM(LENGTH(local_audio_path)) + SUM(LENGTH(definitions_json))"),
            ("dictionary_sources", "SUM(LENGTH(language)) + SUM(LENGTH(provider)) + SUM(LENGTH(version)) + SUM(LENGTH(source_url)) + SUM(LENGTH(license))"),
        ],
    )?;
    drop(conn);

    let components = vec![
        StorageComponent { key: "database", bytes: database },
        StorageComponent { key: "audioCache", bytes: audio_cache },
        StorageComponent { key: "backup", bytes: backup },
        StorageComponent { key: "other", bytes: other },
    ];
    let total = components.iter().map(|c| c.bytes).sum();

    Ok(StorageUsage {
        total,
        components,
        database_breakdown: DatabaseBreakdown {
            user_data,
            builtin_dictionaries,
            dictionary_entries,
        },
    })
}
