use serde::Serialize;
use std::path::Path;
use std::time::Duration;
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
    pub total_phrases: i64,
    pub phrases_unprocessed: i64,
    pub phrases_learning: i64,
    pub phrases_known: i64,
    pub phrases_ignored: i64,
    pub phrase_analyzed: bool,
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

fn count_query(
    conn: &rusqlite::Connection,
    sql: &str,
    language: Option<&str>,
) -> Result<i64, String> {
    conn.query_row(sql, [language], |row| row.get(0))
        .map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[tauri::command]
pub fn get_learning_stats(
    state: State<DbState>,
    language: Option<String>,
) -> Result<LearningStats, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    get_learning_stats_for_language(&conn, language.as_deref())
}

fn get_learning_stats_for_language(
    conn: &rusqlite::Connection,
    language: Option<&str>,
) -> Result<LearningStats, String> {
    let now = now_ms();
    let day_ms = 86_400_000_i64;
    let day_start = now / day_ms * day_ms;

    let total_words = count_query(
        conn,
        "SELECT COUNT(*) FROM words WHERE (?1 IS NULL OR language = ?1)",
        language,
    )?;
    let unprocessed = count_query(
        conn,
        "SELECT COUNT(*) FROM words WHERE (?1 IS NULL OR language = ?1) AND status = 'unprocessed'",
        language,
    )?;
    let learning = count_query(
        conn,
        "SELECT COUNT(*) FROM words WHERE (?1 IS NULL OR language = ?1) AND status = 'learning'",
        language,
    )?;
    let known = count_query(
        conn,
        "SELECT COUNT(*) FROM words WHERE (?1 IS NULL OR language = ?1) AND status = 'known'",
        language,
    )?;
    let ignored = count_query(
        conn,
        "SELECT COUNT(*) FROM words WHERE (?1 IS NULL OR language = ?1) AND status = 'ignored'",
        language,
    )?;
    let due_cards = conn
        .query_row(
            "SELECT COUNT(*) FROM reviews r JOIN words w ON w.id = r.word_id
             WHERE (?1 IS NULL OR w.language = ?1) AND w.status = 'learning' AND r.due_at <= ?2",
            rusqlite::params![language, now],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total_reviews = count_query(
        conn,
        "SELECT COUNT(*) FROM review_logs l JOIN words w ON w.id = l.word_id WHERE (?1 IS NULL OR w.language = ?1)",
        language,
    )?;

    let total_phrases = count_query(
        conn,
        "SELECT COUNT(*) FROM phrases WHERE (?1 IS NULL OR language = ?1)",
        language,
    )?;
    let phrases_unprocessed = count_query(
        conn,
        "SELECT COUNT(*) FROM phrases WHERE (?1 IS NULL OR language = ?1) AND status = 'unprocessed'",
        language,
    )?;
    let phrases_learning = count_query(
        conn,
        "SELECT COUNT(*) FROM phrases WHERE (?1 IS NULL OR language = ?1) AND status = 'learning'",
        language,
    )?;
    let phrases_known = count_query(
        conn,
        "SELECT COUNT(*) FROM phrases WHERE (?1 IS NULL OR language = ?1) AND status = 'known'",
        language,
    )?;
    let phrases_ignored = count_query(
        conn,
        "SELECT COUNT(*) FROM phrases WHERE (?1 IS NULL OR language = ?1) AND status = 'ignored'",
        language,
    )?;
    let due_phrase_cards = conn
        .query_row(
            "SELECT COUNT(*) FROM phrase_reviews r JOIN phrases p ON p.id = r.phrase_id
             WHERE (?1 IS NULL OR p.language = ?1) AND p.status = 'learning' AND r.due_at <= ?2",
            rusqlite::params![language, now],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let total_phrase_reviews = count_query(
        conn,
        "SELECT COUNT(*) FROM phrase_review_logs l JOIN phrases p ON p.id = l.phrase_id WHERE (?1 IS NULL OR p.language = ?1)",
        language,
    )?;

    let mut daily_reviews = Vec::new();
    for offset in (0..7).rev() {
        let start = day_start - offset * day_ms;
        let end = start + day_ms;
        let word_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM review_logs l JOIN words w ON w.id = l.word_id
                 WHERE (?1 IS NULL OR w.language = ?1) AND l.reviewed_at >= ?2 AND l.reviewed_at < ?3",
                rusqlite::params![language, start, end],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let phrase_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM phrase_review_logs l JOIN phrases p ON p.id = l.phrase_id
                 WHERE (?1 IS NULL OR p.language = ?1) AND l.reviewed_at >= ?2 AND l.reviewed_at < ?3",
                rusqlite::params![language, start, end],
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
            "WITH selected_files AS (
                 SELECT * FROM files WHERE (?1 IS NULL OR language = ?1)
             ),
             word_stats AS (
                 SELECT s.file_id,
                        COUNT(DISTINCT o.word_id) AS total,
                        COUNT(DISTINCT CASE WHEN w.status = 'unprocessed' THEN o.word_id END) AS unprocessed,
                        COUNT(DISTINCT CASE WHEN w.status = 'learning' THEN o.word_id END) AS learning,
                        COUNT(DISTINCT CASE WHEN w.status = 'known' THEN o.word_id END) AS known,
                        COUNT(DISTINCT CASE WHEN w.status = 'ignored' THEN o.word_id END) AS ignored
                 FROM segments s
                 JOIN selected_files f ON f.id = s.file_id
                 JOIN occurrences o ON o.segment_id = s.id
                 JOIN words w ON w.id = o.word_id
                 GROUP BY s.file_id
             ),
             phrase_stats AS (
                 SELECT s.file_id,
                        COUNT(DISTINCT po.phrase_id) AS total,
                        COUNT(DISTINCT CASE WHEN p.status = 'unprocessed' THEN po.phrase_id END) AS unprocessed,
                        COUNT(DISTINCT CASE WHEN p.status = 'learning' THEN po.phrase_id END) AS learning,
                        COUNT(DISTINCT CASE WHEN p.status = 'known' THEN po.phrase_id END) AS known,
                        COUNT(DISTINCT CASE WHEN p.status = 'ignored' THEN po.phrase_id END) AS ignored
                 FROM segments s
                 JOIN selected_files f ON f.id = s.file_id
                 JOIN phrase_occurrences po ON po.segment_id = s.id
                 JOIN phrases p ON p.id = po.phrase_id
                 GROUP BY s.file_id
             )
             SELECT f.id, f.name, f.language,
                    COALESCE(ws.total, 0), COALESCE(ws.unprocessed, 0), COALESCE(ws.learning, 0), COALESCE(ws.known, 0), COALESCE(ws.ignored, 0),
                    COALESCE(ps.total, 0), COALESCE(ps.unprocessed, 0), COALESCE(ps.learning, 0), COALESCE(ps.known, 0), COALESCE(ps.ignored, 0),
                    a.file_id IS NOT NULL
             FROM selected_files f
             LEFT JOIN word_stats ws ON ws.file_id = f.id
             LEFT JOIN phrase_stats ps ON ps.file_id = f.id
             LEFT JOIN file_phrase_analysis a ON a.file_id = f.id
             ORDER BY f.imported_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([language], |row| {
            Ok(FileProgress {
                id: row.get(0)?,
                name: row.get(1)?,
                language: row.get(2)?,
                total_words: row.get(3)?,
                unprocessed: row.get(4)?,
                learning: row.get(5)?,
                known: row.get(6)?,
                ignored: row.get(7)?,
                total_phrases: row.get(8)?,
                phrases_unprocessed: row.get(9)?,
                phrases_learning: row.get(10)?,
                phrases_known: row.get(11)?,
                phrases_ignored: row.get(12)?,
                phrase_analyzed: row.get::<_, i32>(13)? != 0,
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

fn open_read_only_db(path: &Path) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(1))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA query_only = ON;")
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn estimate_table_bytes(
    conn: &rusqlite::Connection,
    table: &str,
    sum_expr: &str,
) -> Result<u64, String> {
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

fn calculate_storage_usage(app_dir: &Path, db_path: &Path) -> Result<StorageUsage, String> {
    let mut database = 0u64;
    let mut audio_cache = 0u64;
    let mut backup = 0u64;
    let mut other = 0u64;
    for entry in std::fs::read_dir(app_dir).map_err(|e| e.to_string())? {
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

    let conn = open_read_only_db(db_path)?;

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
    let components = vec![
        StorageComponent {
            key: "database",
            bytes: database,
        },
        StorageComponent {
            key: "audioCache",
            bytes: audio_cache,
        },
        StorageComponent {
            key: "backup",
            bytes: backup,
        },
        StorageComponent {
            key: "other",
            bytes: other,
        },
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

#[tauri::command]
pub async fn get_storage_usage(app: AppHandle) -> Result<StorageUsage, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("lexicue.db");
    tauri::async_runtime::spawn_blocking(move || calculate_storage_usage(&app_dir, &db_path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{calculate_storage_usage, get_learning_stats_for_language, now_ms};
    use crate::db::init_db;
    use rusqlite::params;
    use tempfile::tempdir;

    #[test]
    fn learning_stats_are_scoped_to_the_requested_language() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("lexicue.db");
        let conn = init_db(&db_path).unwrap();
        let now = now_ms();

        for (language, word_status, phrase_status) in
            [("en", "known", "known"), ("ja", "learning", "learning")]
        {
            conn.execute(
                "INSERT INTO files (name, type, content, content_hash, imported_at, language)
                 VALUES (?1, 'txt', 'content', ?2, ?3, ?4)",
                params![
                    format!("{language}.txt"),
                    format!("{language}-hash"),
                    now,
                    language
                ],
            )
            .unwrap();
            let file_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO segments (file_id, index_num, en_text) VALUES (?1, 0, 'text')",
                [file_id],
            )
            .unwrap();
            let segment_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO words (language, lemma, status) VALUES (?1, ?2, ?3)",
                params![language, format!("{language}-word"), word_status],
            )
            .unwrap();
            let word_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, ?2, 'word', 0)",
                params![word_id, segment_id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO phrases (language, text, status) VALUES (?1, ?2, ?3)",
                params![language, format!("{language}-phrase"), phrase_status],
            )
            .unwrap();
            let phrase_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO phrase_occurrences (phrase_id, segment_id, position) VALUES (?1, ?2, 0)",
                params![phrase_id, segment_id],
            )
            .unwrap();
            if language == "en" {
                conn.execute(
                    "INSERT INTO file_phrase_analysis (file_id, model, completed_at) VALUES (?1, 'test', ?2)",
                    params![file_id, now],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO reviews (word_id, due_at) VALUES (?1, ?2)",
                params![word_id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO phrase_reviews (phrase_id, due_at) VALUES (?1, ?2)",
                params![phrase_id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO review_logs (word_id, rating, reviewed_at) VALUES (?1, 3, ?2)",
                params![word_id, now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO phrase_review_logs (phrase_id, rating, reviewed_at) VALUES (?1, 3, ?2)",
                params![phrase_id, now],
            )
            .unwrap();
        }

        let english = get_learning_stats_for_language(&conn, Some("en")).unwrap();
        assert_eq!(
            (english.total_words, english.known, english.learning),
            (1, 1, 0)
        );
        assert_eq!(
            (
                english.total_phrases,
                english.phrases_known,
                english.phrases_learning
            ),
            (1, 1, 0)
        );
        assert_eq!(
            (english.total_reviews, english.total_phrase_reviews),
            (1, 1)
        );
        assert_eq!(
            english
                .daily_reviews
                .iter()
                .map(|day| day.count)
                .sum::<i64>(),
            2
        );
        assert_eq!(
            english
                .files
                .iter()
                .map(|file| file.language.as_str())
                .collect::<Vec<_>>(),
            vec!["en"]
        );
        assert_eq!(
            (
                english.files[0].total_phrases,
                english.files[0].phrases_known
            ),
            (1, 1)
        );
        assert!(english.files[0].phrase_analyzed);

        let japanese = get_learning_stats_for_language(&conn, Some("ja")).unwrap();
        assert_eq!(
            (
                japanese.total_words,
                japanese.known,
                japanese.learning,
                japanese.due_cards
            ),
            (1, 0, 1, 1)
        );
        assert_eq!(
            (
                japanese.total_phrases,
                japanese.phrases_known,
                japanese.phrases_learning,
                japanese.due_phrase_cards
            ),
            (1, 0, 1, 1)
        );
        assert_eq!(
            (japanese.total_reviews, japanese.total_phrase_reviews),
            (1, 1)
        );
        assert_eq!(
            japanese
                .daily_reviews
                .iter()
                .map(|day| day.count)
                .sum::<i64>(),
            2
        );
        assert_eq!(
            japanese
                .files
                .iter()
                .map(|file| file.language.as_str())
                .collect::<Vec<_>>(),
            vec!["ja"]
        );
        assert_eq!(
            (
                japanese.files[0].total_phrases,
                japanese.files[0].phrases_learning
            ),
            (1, 1)
        );
        assert!(!japanese.files[0].phrase_analyzed);

        let all_languages = get_learning_stats_for_language(&conn, None).unwrap();
        assert_eq!(
            (all_languages.total_words, all_languages.total_phrases),
            (2, 2)
        );
        assert_eq!(
            (
                all_languages.total_reviews,
                all_languages.total_phrase_reviews
            ),
            (2, 2)
        );
        assert_eq!(
            all_languages
                .daily_reviews
                .iter()
                .map(|day| day.count)
                .sum::<i64>(),
            4
        );
        assert_eq!(all_languages.files.len(), 2);
    }

    #[test]
    fn storage_usage_reads_while_a_writer_holds_a_transaction() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("lexicue.db");
        let mut writer = init_db(&db_path).unwrap();
        writer
            .execute(
                "INSERT INTO files (name, type, content, content_hash, imported_at, language) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["committed.txt", "txt", "content", "hash", 1_i64, "en"],
            )
            .unwrap();
        let tx = writer.transaction().unwrap();
        tx.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at, language) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params!["sample.txt", "txt", "content", "hash", 1_i64, "en"],
        )
        .unwrap();

        let usage = calculate_storage_usage(dir.path(), &db_path).unwrap();

        assert!(usage
            .components
            .iter()
            .any(|component| component.key == "database" && component.bytes > 0));
        assert!(usage.database_breakdown.user_data > 0);
    }
}
