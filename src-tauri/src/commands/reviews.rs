use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct DueCard {
    pub word_id: i64,
    pub lemma: String,
    pub definition: Option<String>,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i32,
    pub scheduled_days: i32,
    pub reps: i32,
    pub lapses: i32,
    pub state: i32,
    pub occurrences: Vec<CardOccurrence>,
    pub language: String,
    pub reading: Option<String>,
    pub part_of_speech: Option<String>,
}

#[derive(Serialize)]
pub struct DuePhraseCard {
    pub phrase_id: i64,
    pub text: String,
    pub definition: Option<String>,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i32,
    pub scheduled_days: i32,
    pub reps: i32,
    pub lapses: i32,
    pub state: i32,
    pub occurrences: Vec<CardOccurrence>,
    pub language: String,
}

#[derive(Serialize)]
pub struct CardOccurrence {
    pub id: i64,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub file_name: String,
    pub original_form: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct RatingPayload {
    pub word_id: i64,
    pub rating: i32,
    pub card_state: i32,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i32,
    pub scheduled_days: i32,
    pub reps: i32,
    pub lapses: i32,
    pub new_state: i32,
    pub new_stability: f64,
    pub new_difficulty: f64,
    pub new_elapsed_days: i32,
    pub new_scheduled_days: i32,
    pub new_due_at: i64,
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct PhraseRatingPayload {
    pub phrase_id: i64,
    pub rating: i32,
    pub card_state: i32,
    pub stability: f64,
    pub difficulty: f64,
    pub elapsed_days: i32,
    pub scheduled_days: i32,
    pub reps: i32,
    pub lapses: i32,
    pub new_state: i32,
    pub new_stability: f64,
    pub new_difficulty: f64,
    pub new_elapsed_days: i32,
    pub new_scheduled_days: i32,
    pub new_due_at: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[tauri::command]
pub fn get_due_cards(
    state: State<DbState>,
    language: Option<String>,
) -> Result<Vec<DueCard>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = now_ms();

    let cards = {
        let mut stmt = conn
            .prepare(
                "SELECT r.word_id, w.lemma, w.definition,
                        r.stability, r.difficulty, r.elapsed_days,
                        r.scheduled_days, r.reps, r.lapses, r.state,
                        w.language, w.reading, w.part_of_speech
                 FROM reviews r
                 JOIN words w ON w.id = r.word_id
                 WHERE w.status = 'learning' AND r.due_at <= ?1
                   AND (?2 IS NULL OR w.language = ?2)
                 ORDER BY r.due_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![now, language], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, i32>(5)?,
                    row.get::<_, i32>(6)?,
                    row.get::<_, i32>(7)?,
                    row.get::<_, i32>(8)?,
                    row.get::<_, i32>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                    row.get::<_, Option<String>>(12)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            let (
                word_id,
                lemma,
                definition,
                stability,
                difficulty,
                elapsed_days,
                scheduled_days,
                reps,
                lapses,
                state,
                language,
                reading,
                part_of_speech,
            ) = row.map_err(|e| e.to_string())?;

            let occurrences = {
                let mut ostmt = conn
                    .prepare(
                        "SELECT o.id, s.en_text, s.zh_text, s.start_time, s.end_time, f.name, o.original_form
                         FROM occurrences o
                         JOIN segments s ON s.id = o.segment_id
                         JOIN files f ON f.id = s.file_id
                         WHERE o.word_id = ?1
                         ORDER BY f.name, s.index_num
                         LIMIT 20",
                    )
                    .map_err(|e| e.to_string())?;

                let orows = ostmt
                    .query_map(params![word_id], |row| {
                        Ok(CardOccurrence {
                            id: row.get(0)?,
                            en_text: row.get(1)?,
                            zh_text: row.get(2)?,
                            start_time: row.get(3)?,
                            end_time: row.get(4)?,
                            file_name: row.get(5)?,
                            original_form: row.get(6)?,
                        })
                    })
                    .map_err(|e| e.to_string())?;

                let mut oresult = Vec::new();
                for orow in orows {
                    oresult.push(orow.map_err(|e| e.to_string())?);
                }
                oresult
            };

            result.push(DueCard {
                word_id,
                lemma,
                definition,
                stability,
                difficulty,
                elapsed_days,
                scheduled_days,
                reps,
                lapses,
                state,
                occurrences,
                language,
                reading,
                part_of_speech,
            });
        }
        result
    };

    Ok(cards)
}

#[tauri::command]
pub fn submit_rating(state: State<DbState>, payload: RatingPayload) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        let now = now_ms();
        let new_reps = payload.reps + 1;
        let new_lapses = payload.lapses + if payload.rating == 1 { 1 } else { 0 };

        conn.execute(
            "UPDATE reviews SET due_at=?1, stability=?2, difficulty=?3,
             elapsed_days=?4, scheduled_days=?5, reps=?6, lapses=?7,
             state=?8, last_review_at=?9 WHERE word_id=?10",
            params![
                payload.new_due_at,
                payload.new_stability,
                payload.new_difficulty,
                payload.new_elapsed_days,
                payload.new_scheduled_days,
                new_reps,
                new_lapses,
                payload.new_state,
                now,
                payload.word_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO review_logs
             (word_id, rating, reviewed_at,
              stability_before, stability_after,
              difficulty_before, difficulty_after,
              elapsed_days, scheduled_days,
              state_before, state_after)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                payload.word_id,
                payload.rating,
                now,
                payload.stability,
                payload.new_stability,
                payload.difficulty,
                payload.new_difficulty,
                payload.new_elapsed_days,
                payload.new_scheduled_days,
                payload.card_state,
                payload.new_state,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn create_review_card(state: State<DbState>, word_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let existing: bool = {
        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM reviews WHERE word_id = ?1")
            .map_err(|e| e.to_string())?;
        let count: i64 = stmt
            .query_row(params![word_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        count > 0
    };

    if existing {
        return Ok(());
    }

    let now = now_ms();
    conn.execute(
        "INSERT INTO reviews (word_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review_at)
         VALUES (?1, ?2, 0, 0, 0, 0, 0, 0, 0, NULL)",
        params![word_id, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_due_phrase_cards(
    state: State<DbState>,
    language: Option<String>,
) -> Result<Vec<DuePhraseCard>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let now = now_ms();

    let cards = {
        let mut stmt = conn
            .prepare(
                "SELECT r.phrase_id, p.text, p.definition,
                        r.stability, r.difficulty, r.elapsed_days,
                        r.scheduled_days, r.reps, r.lapses, r.state, p.language
                 FROM phrase_reviews r
                 JOIN phrases p ON p.id = r.phrase_id
                 WHERE p.status = 'learning' AND r.due_at <= ?1
                   AND (?2 IS NULL OR p.language = ?2)
                 ORDER BY r.due_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![now, language], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, i32>(5)?,
                    row.get::<_, i32>(6)?,
                    row.get::<_, i32>(7)?,
                    row.get::<_, i32>(8)?,
                    row.get::<_, i32>(9)?,
                    row.get::<_, String>(10)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            let (
                phrase_id,
                text,
                definition,
                stability,
                difficulty,
                elapsed_days,
                scheduled_days,
                reps,
                lapses,
                state,
                language,
            ) = row.map_err(|e| e.to_string())?;

            let occurrences = {
                let mut ostmt = conn
                    .prepare(
                        "SELECT po.id, s.en_text, s.zh_text, s.start_time, s.end_time, f.name
                         FROM phrase_occurrences po
                         JOIN segments s ON s.id = po.segment_id
                         JOIN files f ON f.id = s.file_id
                         WHERE po.phrase_id = ?1
                         ORDER BY f.name, s.index_num
                         LIMIT 20",
                    )
                    .map_err(|e| e.to_string())?;

                let orows = ostmt
                    .query_map(params![phrase_id], |row| {
                        Ok(CardOccurrence {
                            id: row.get(0)?,
                            en_text: row.get(1)?,
                            zh_text: row.get(2)?,
                            start_time: row.get(3)?,
                            end_time: row.get(4)?,
                            file_name: row.get(5)?,
                            original_form: None,
                        })
                    })
                    .map_err(|e| e.to_string())?;

                let mut oresult = Vec::new();
                for orow in orows {
                    oresult.push(orow.map_err(|e| e.to_string())?);
                }
                oresult
            };

            result.push(DuePhraseCard {
                phrase_id,
                text,
                definition,
                stability,
                difficulty,
                elapsed_days,
                scheduled_days,
                reps,
                lapses,
                state,
                occurrences,
                language,
            });
        }
        result
    };

    Ok(cards)
}

#[tauri::command]
pub fn submit_phrase_rating(
    state: State<DbState>,
    payload: PhraseRatingPayload,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        let now = now_ms();
        let new_reps = payload.reps + 1;
        let new_lapses = payload.lapses + if payload.rating == 1 { 1 } else { 0 };

        conn.execute(
            "UPDATE phrase_reviews SET due_at=?1, stability=?2, difficulty=?3,
             elapsed_days=?4, scheduled_days=?5, reps=?6, lapses=?7,
             state=?8, last_review_at=?9 WHERE phrase_id=?10",
            params![
                payload.new_due_at,
                payload.new_stability,
                payload.new_difficulty,
                payload.new_elapsed_days,
                payload.new_scheduled_days,
                new_reps,
                new_lapses,
                payload.new_state,
                now,
                payload.phrase_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO phrase_review_logs
             (phrase_id, rating, reviewed_at,
              stability_before, stability_after,
              difficulty_before, difficulty_after,
              elapsed_days, scheduled_days,
              state_before, state_after)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                payload.phrase_id,
                payload.rating,
                now,
                payload.stability,
                payload.new_stability,
                payload.difficulty,
                payload.new_difficulty,
                payload.new_elapsed_days,
                payload.new_scheduled_days,
                payload.card_state,
                payload.new_state,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

#[tauri::command]
pub fn create_phrase_review_card(state: State<DbState>, phrase_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let existing: bool = {
        let mut stmt = conn
            .prepare("SELECT COUNT(*) FROM phrase_reviews WHERE phrase_id = ?1")
            .map_err(|e| e.to_string())?;
        let count: i64 = stmt
            .query_row(params![phrase_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        count > 0
    };

    if existing {
        return Ok(());
    }

    let now = now_ms();
    conn.execute(
        "INSERT INTO phrase_reviews (phrase_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review_at)
         VALUES (?1, ?2, 0, 0, 0, 0, 0, 0, 0, NULL)",
        params![phrase_id, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
