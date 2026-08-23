use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

use crate::db::DbState;

const PACK_ID: &str = "wordfreq";
const PACK_VERSION: &str = "3.1.1";
const TIERS: [i64; 4] = [1000, 3000, 5000, 10000];
const EN_WORDS: &str = include_str!("../../resources/frequency-baseline/en.txt");
const ZH_WORDS: &str = include_str!("../../resources/frequency-baseline/zh.txt");

#[derive(Serialize)]
pub struct BaselineProfile {
    pub language: String,
    pub tier: Option<i64>,
    pub enabled: bool,
    pub marked_count: i64,
    pub pending_count: i64,
    pub pack_id: String,
    pub pack_version: String,
    pub source_url: String,
    pub license: String,
}

#[derive(Serialize)]
pub struct BaselineApplyResult {
    pub marked: i64,
    pub pending_count: i64,
}

#[derive(Serialize)]
pub struct BaselinePreview {
    pub language: String,
    pub tier: i64,
    pub range_start: i64,
    pub range_end: i64,
    pub batch: i64,
    pub words: Vec<String>,
    pub matching_count: i64,
    pub will_skip_count: i64,
    pub retained_count: i64,
}

#[derive(Clone)]
pub struct BaselineReviewWord {
    pub id: i64,
    pub language: String,
}

fn today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // A stable UTC day is sufficient for the local-only daily allowance.
    (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        / 86_400)
        .to_string()
}

fn words_for(language: &str, tier: i64) -> Result<HashSet<&'static str>, String> {
    if !TIERS.contains(&tier) {
        return Err("Unsupported frequency tier".to_string());
    }
    let source = match language {
        "en" => EN_WORDS,
        "zh" => ZH_WORDS,
        _ => {
            return Err("Frequency baseline is only available for English and Chinese".to_string())
        }
    };
    Ok(source.lines().take(tier as usize).collect())
}

fn source_for(language: &str) -> Result<&'static str, String> {
    match language {
        "en" => Ok(EN_WORDS),
        "zh" => Ok(ZH_WORDS),
        _ => Err("Frequency baseline is only available for English and Chinese".to_string()),
    }
}

fn range_for(tier: i64) -> Result<(usize, usize), String> {
    let tier_index = TIERS
        .iter()
        .position(|value| *value == tier)
        .ok_or_else(|| "Unsupported frequency tier".to_string())?;
    Ok((
        if tier_index == 0 {
            0
        } else {
            TIERS[tier_index - 1] as usize
        },
        tier as usize,
    ))
}

fn sample_words(language: &str, tier: i64, batch: i64) -> Result<Vec<String>, String> {
    let source: Vec<&str> = source_for(language)?.lines().collect();
    let (start, end) = range_for(tier)?;
    let range = &source[start..end];
    let count = range.len().min(100);
    if count == 0 {
        return Ok(Vec::new());
    }

    // A package-version-stable permutation: each batch is a distinct, evenly-spread
    // view of the tier's newly-added interval, with no runtime randomness involved.
    let len = range.len();
    let step = if len % 2 == 0 {
        len.saturating_sub(1)
    } else {
        len
    };
    let offset = ((batch.max(0) as usize) * 101) % len;
    Ok((0..count)
        .map(|index| range[(offset + index * step) % len].to_string())
        .collect())
}

fn preview_impact(conn: &Connection, language: &str, tier: i64) -> Result<(i64, i64, i64), String> {
    let allowed = words_for(language, tier)?;
    let mut stmt = conn
        .prepare("SELECT lemma, status FROM words WHERE language=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([language], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut matching = 0;
    let mut will_skip = 0;
    let mut total = 0;
    for row in rows {
        let (lemma, status) = row.map_err(|e| e.to_string())?;
        total += 1;
        if allowed.contains(lemma.as_str()) {
            matching += 1;
            if status == "unprocessed" {
                will_skip += 1;
            }
        }
    }
    Ok((matching, will_skip, total - will_skip))
}

fn profile(conn: &Connection, language: &str) -> Result<BaselineProfile, String> {
    let value: Option<(i64, i64)> = conn
        .query_row(
            "SELECT tier, enabled FROM frequency_baseline_profiles WHERE language=?1",
            [language],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();
    let marked_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM frequency_baseline_marks WHERE language=?1",
            [language],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let pending_count: i64 = conn.query_row("SELECT COUNT(*) FROM frequency_baseline_marks WHERE language=?1 AND verification='pending'", [language], |r| r.get(0)).map_err(|e| e.to_string())?;
    Ok(BaselineProfile {
        language: language.to_string(),
        tier: value.map(|v| v.0),
        enabled: value.map(|v| v.1 != 0).unwrap_or(false),
        marked_count,
        pending_count,
        pack_id: PACK_ID.to_string(),
        pack_version: PACK_VERSION.to_string(),
        source_url: "https://github.com/rspeer/wordfreq".to_string(),
        license: "Apache-2.0 / CC BY-SA 4.0".to_string(),
    })
}

pub fn apply_enabled_baseline(conn: &Connection, language: &str) -> Result<i64, String> {
    let row: Option<i64> = conn
        .query_row(
            "SELECT tier FROM frequency_baseline_profiles WHERE language=?1 AND enabled=1",
            [language],
            |r| r.get(0),
        )
        .ok();
    match row {
        Some(tier) => apply(conn, language, tier),
        None => Ok(0),
    }
}

fn apply(conn: &Connection, language: &str, tier: i64) -> Result<i64, String> {
    let allowed = words_for(language, tier)?;
    let mut stmt = conn.prepare("SELECT w.id, w.lemma, w.status, m.verification FROM words w LEFT JOIN frequency_baseline_marks m ON m.word_id=w.id WHERE w.language=?1 AND (w.status='unprocessed' OR (w.status='known' AND m.verification='pending'))").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([language], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut changed = 0;
    for row in rows {
        let (id, lemma, status, _) = row.map_err(|e| e.to_string())?;
        if allowed.contains(lemma.as_str()) {
            if status == "unprocessed" {
                conn.execute("UPDATE words SET status='known' WHERE id=?1", [id])
                    .map_err(|e| e.to_string())?;
                changed += 1;
            }
            conn.execute("INSERT INTO frequency_baseline_marks (word_id, language, tier, pack_id, pack_version, verification, marked_at) VALUES (?1,?2,?3,?4,?5,'pending',strftime('%s','now')*1000) ON CONFLICT(word_id) DO UPDATE SET tier=excluded.tier, pack_version=excluded.pack_version", params![id, language, tier, PACK_ID, PACK_VERSION]).map_err(|e| e.to_string())?;
        }
    }
    Ok(changed)
}

fn remove_pending_marks_outside_tier(
    conn: &Connection,
    language: &str,
    tier: i64,
) -> Result<(), String> {
    let allowed = words_for(language, tier)?;
    let mut stmt = conn.prepare("SELECT w.id, w.lemma FROM words w JOIN frequency_baseline_marks m ON m.word_id=w.id WHERE m.language=?1 AND m.verification='pending' AND w.status='known'").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([language], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, lemma) = row.map_err(|e| e.to_string())?;
        if !allowed.contains(lemma.as_str()) {
            ids.push(id);
        }
    }
    drop(stmt);
    for id in ids {
        conn.execute(
            "UPDATE words SET status='unprocessed' WHERE id=?1 AND status='known'",
            [id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM frequency_baseline_marks WHERE word_id=?1 AND verification='pending'",
            [id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_frequency_baseline(
    state: State<DbState>,
    language: String,
) -> Result<BaselineProfile, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    profile(&conn, &language)
}

#[tauri::command]
pub fn configure_frequency_baseline(
    state: State<DbState>,
    language: String,
    tier: Option<i64>,
) -> Result<BaselineApplyResult, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let marked = if let Some(tier) = tier {
        words_for(&language, tier)?;
        conn.execute("INSERT INTO frequency_baseline_profiles(language,tier,enabled,updated_at) VALUES(?1,?2,1,strftime('%s','now')*1000) ON CONFLICT(language) DO UPDATE SET tier=excluded.tier, enabled=1, updated_at=excluded.updated_at", params![language, tier]).map_err(|e| e.to_string())?;
        remove_pending_marks_outside_tier(&conn, &language, tier)?;
        apply(&conn, &language, tier)?
    } else {
        conn.execute("INSERT INTO frequency_baseline_profiles(language,tier,enabled,updated_at) VALUES(?1,1000,0,strftime('%s','now')*1000) ON CONFLICT(language) DO UPDATE SET enabled=0,updated_at=excluded.updated_at", [language.as_str()]).map_err(|e| e.to_string())?;
        0
    };
    let pending_count = profile(&conn, &language)?.pending_count;
    Ok(BaselineApplyResult {
        marked,
        pending_count,
    })
}

#[tauri::command]
pub fn get_frequency_baseline_preview(
    state: State<DbState>,
    language: String,
    tier: i64,
    batch: Option<i64>,
) -> Result<BaselinePreview, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let (range_start, range_end) = range_for(tier)?;
    let (matching_count, will_skip_count, retained_count) = preview_impact(&conn, &language, tier)?;
    Ok(BaselinePreview {
        language: language.clone(),
        tier,
        range_start: range_start as i64,
        range_end: range_end as i64,
        batch: batch.unwrap_or(0).max(0),
        words: sample_words(&language, tier, batch.unwrap_or(0))?,
        matching_count,
        will_skip_count,
        retained_count,
    })
}

#[tauri::command]
pub fn revoke_frequency_baseline(state: State<DbState>, language: String) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let changed = conn.execute("UPDATE words SET status='unprocessed' WHERE id IN (SELECT word_id FROM frequency_baseline_marks WHERE language=?1 AND verification='pending') AND status='known'", [language.as_str()]).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM frequency_baseline_marks WHERE language=?1 AND verification='pending'",
        [language.as_str()],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("UPDATE frequency_baseline_profiles SET enabled=0,updated_at=strftime('%s','now')*1000 WHERE language=?1", [language.as_str()]).map_err(|e| e.to_string())?;
    Ok(changed as i64)
}

pub fn take_daily_review_words(
    conn: &mut Connection,
    language: Option<&str>,
) -> Result<Vec<BaselineReviewWord>, String> {
    let languages: Vec<String> = match language {
        Some(value) if value == "en" || value == "zh" => vec![value.to_string()],
        Some(_) => Vec::new(),
        None => {
            let mut stmt = conn.prepare("SELECT language FROM frequency_baseline_profiles WHERE enabled=1 AND language IN ('en','zh')").map_err(|e| e.to_string())?;
            let values = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            values
        }
    };
    let day = today();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut values = Vec::new();
    for language in languages {
        let count: i64 = tx.query_row("SELECT count FROM frequency_baseline_daily_checks WHERE language=?1 AND checked_on=?2", params![language, day], |row| row.get(0)).unwrap_or(0);
        if count >= 10 {
            continue;
        }
        let limit = 10 - count;
        let mut stmt = tx.prepare("SELECT w.id,w.language FROM words w JOIN frequency_baseline_marks m ON m.word_id=w.id WHERE m.language=?1 AND m.verification='pending' AND w.status='known' AND COALESCE(m.last_sampled_day,'')<>?2 ORDER BY RANDOM() LIMIT ?3").map_err(|e| e.to_string())?;
        let selected: Vec<BaselineReviewWord> = stmt
            .query_map(params![language, day, limit], |row| {
                Ok(BaselineReviewWord {
                    id: row.get(0)?,
                    language: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        drop(stmt);
        for value in &selected {
            tx.execute(
                "UPDATE frequency_baseline_marks SET last_sampled_day=?1 WHERE word_id=?2",
                params![day, value.id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute("INSERT INTO frequency_baseline_daily_checks(language,checked_on,count) VALUES(?1,?2,?3) ON CONFLICT(language,checked_on) DO UPDATE SET count=count+excluded.count", params![language, day, selected.len() as i64]).map_err(|e| e.to_string())?;
        values.extend(selected);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(values)
}

#[tauri::command]
pub fn submit_frequency_baseline_review(
    state: State<DbState>,
    word_id: i64,
    rating: i32,
) -> Result<(), String> {
    if !(1..=4).contains(&rating) {
        return Err("Unsupported review rating".to_string());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    apply_baseline_review_answer(&conn, word_id, rating)
}

fn apply_baseline_review_answer(
    conn: &Connection,
    word_id: i64,
    rating: i32,
) -> Result<(), String> {
    let pending: bool = conn.query_row("SELECT COUNT(*) > 0 FROM frequency_baseline_marks WHERE word_id=?1 AND verification='pending'", [word_id], |row| row.get(0)).map_err(|e| e.to_string())?;
    if !pending {
        return Ok(());
    }
    if rating >= 3 {
        conn.execute(
            "UPDATE frequency_baseline_marks SET verification='confirmed' WHERE word_id=?1",
            [word_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE words SET status='learning' WHERE id=?1", [word_id])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE frequency_baseline_marks SET verification='corrected' WHERE word_id=?1",
            [word_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO reviews (word_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review_at) SELECT ?1, strftime('%s','now')*1000, 0, 0, 0, 0, 0, 0, 0, NULL WHERE NOT EXISTS (SELECT 1 FROM reviews WHERE word_id=?1)", [word_id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn record_manual_status(
    conn: &Connection,
    word_id: i64,
    status: &str,
) -> Result<(), rusqlite::Error> {
    match status {
        "known" => {
            conn.execute("UPDATE frequency_baseline_marks SET verification='confirmed' WHERE word_id=?1 AND verification='pending'", [word_id])?;
        }
        "learning" => {
            conn.execute("UPDATE frequency_baseline_marks SET verification='corrected' WHERE word_id=?1 AND verification='pending'", [word_id])?;
        }
        _ => {
            conn.execute(
                "DELETE FROM frequency_baseline_marks WHERE word_id=?1 AND verification='pending'",
                [word_id],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE words(id INTEGER PRIMARY KEY, language TEXT NOT NULL, lemma TEXT NOT NULL, status TEXT NOT NULL);
          CREATE TABLE frequency_baseline_profiles(language TEXT PRIMARY KEY, tier INTEGER NOT NULL, enabled INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE TABLE frequency_baseline_marks(word_id INTEGER PRIMARY KEY, language TEXT NOT NULL, tier INTEGER NOT NULL, pack_id TEXT NOT NULL, pack_version TEXT NOT NULL, verification TEXT NOT NULL, marked_at INTEGER NOT NULL, last_sampled_day TEXT);
          CREATE TABLE frequency_baseline_daily_checks(language TEXT NOT NULL, checked_on TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(language, checked_on));
          CREATE TABLE reviews(word_id INTEGER PRIMARY KEY, due_at INTEGER NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL, elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, state INTEGER NOT NULL, last_review_at INTEGER);").unwrap();
        conn
    }

    #[test]
    fn applies_only_unprocessed_words_and_preserves_manual_statuses() {
        let conn = db();
        conn.execute("INSERT INTO words VALUES (1,'en','the','unprocessed'),(2,'en','the','learning'),(3,'en','the','known'),(4,'en','xylophone','unprocessed')", []).unwrap();
        let changed = apply(&conn, "en", 1000).unwrap();
        assert_eq!(changed, 1);
        let statuses: Vec<String> = conn
            .prepare("SELECT status FROM words ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(statuses, vec!["known", "learning", "known", "unprocessed"]);
        let marks: i64 = conn
            .query_row("SELECT COUNT(*) FROM frequency_baseline_marks", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(marks, 1);
    }

    #[test]
    fn manual_correction_is_not_reverted() {
        let conn = db();
        conn.execute("INSERT INTO words VALUES (1,'en','the','unprocessed')", [])
            .unwrap();
        apply(&conn, "en", 1000).unwrap();
        conn.execute("UPDATE words SET status='learning' WHERE id=1", [])
            .unwrap();
        record_manual_status(&conn, 1, "learning").unwrap();
        let reverted = conn.execute("UPDATE words SET status='unprocessed' WHERE id IN (SELECT word_id FROM frequency_baseline_marks WHERE language='en' AND verification='pending') AND status='known'", []).unwrap();
        assert_eq!(reverted, 0);
        let verification: String = conn
            .query_row(
                "SELECT verification FROM frequency_baseline_marks WHERE word_id=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(verification, "corrected");
    }

    #[test]
    fn lowering_a_tier_restores_only_pending_marks_outside_it() {
        let conn = db();
        let outside = EN_WORDS.lines().nth(1500).unwrap();
        conn.execute(
            "INSERT INTO words VALUES (1,'en','the','known'),(2,'en',?1,'known')",
            [outside],
        )
        .unwrap();
        conn.execute("INSERT INTO frequency_baseline_marks VALUES (1,'en',3000,'wordfreq','3.1.1','pending',0,NULL),(2,'en',3000,'wordfreq','3.1.1','pending',0,NULL)", []).unwrap();
        remove_pending_marks_outside_tier(&conn, "en", 1000).unwrap();
        let statuses: Vec<String> = conn
            .prepare("SELECT status FROM words ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(statuses, vec!["known", "unprocessed"]);
        let marks: i64 = conn
            .query_row("SELECT COUNT(*) FROM frequency_baseline_marks", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(marks, 1);
    }

    #[test]
    fn previews_are_stable_and_stay_inside_the_tier_interval() {
        let first = sample_words("en", 3000, 0).unwrap();
        assert_eq!(first.len(), 100);
        assert_eq!(first, sample_words("en", 3000, 0).unwrap());
        let source: Vec<&str> = EN_WORDS.lines().collect();
        let interval: HashSet<&str> = source[1000..3000].iter().copied().collect();
        assert!(first.iter().all(|word| interval.contains(word.as_str())));
        assert_eq!(sample_words("zh", 1000, 0).unwrap().len(), 100);
    }

    #[test]
    fn daily_review_words_are_limited_and_not_repeated() {
        let mut conn = db();
        conn.execute(
            "INSERT INTO frequency_baseline_profiles VALUES ('en',1000,1,0)",
            [],
        )
        .unwrap();
        for id in 1..=12 {
            conn.execute("INSERT INTO words VALUES (?1,'en','the','known')", [id])
                .unwrap();
            conn.execute("INSERT INTO frequency_baseline_marks VALUES (?1,'en',1000,'wordfreq','3.1.1','pending',0,NULL)", [id]).unwrap();
        }
        let first = take_daily_review_words(&mut conn, Some("en")).unwrap();
        assert_eq!(first.len(), 10);
        assert!(take_daily_review_words(&mut conn, Some("en"))
            .unwrap()
            .is_empty());
        let count: i64 = conn
            .query_row(
                "SELECT count FROM frequency_baseline_daily_checks WHERE language='en'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 10);
    }

    #[test]
    fn review_answer_confirms_or_creates_one_learning_card() {
        let conn = db();
        conn.execute(
            "INSERT INTO words VALUES (1,'en','the','known'),(2,'en','the','known')",
            [],
        )
        .unwrap();
        for id in 1..=2 {
            conn.execute("INSERT INTO frequency_baseline_marks VALUES (?1,'en',1000,'wordfreq','3.1.1','pending',0,NULL)", [id]).unwrap();
        }
        apply_baseline_review_answer(&conn, 1, 3).unwrap();
        let confirmed: String = conn
            .query_row(
                "SELECT verification FROM frequency_baseline_marks WHERE word_id=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(confirmed, "confirmed");
        let cards: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews WHERE word_id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(cards, 0);
        apply_baseline_review_answer(&conn, 2, 1).unwrap();
        apply_baseline_review_answer(&conn, 2, 2).unwrap();
        let corrected: String = conn
            .query_row(
                "SELECT verification FROM frequency_baseline_marks WHERE word_id=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let status: String = conn
            .query_row("SELECT status FROM words WHERE id=2", [], |row| row.get(0))
            .unwrap();
        let cards: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews WHERE word_id=2", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            (corrected, status, cards),
            ("corrected".to_string(), "learning".to_string(), 1)
        );
    }
}
