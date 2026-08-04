use serde::Serialize;
use tauri::State;

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
