use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::commands::chinese;
use crate::commands::language;
use crate::db::DbState;

#[derive(Serialize)]
pub struct PhraseInfo {
    pub id: i64,
    pub text: String,
    pub status: String,
    pub definition: Option<String>,
    pub source: String,
    pub frequency: i64,
    pub language: String,
    pub unverified: bool,
}

#[derive(Serialize)]
pub struct PhraseDetail {
    pub phrase: PhraseInfo,
    pub occurrences: Vec<PhraseOccurrenceDetail>,
}

#[derive(Serialize)]
pub struct PhraseOccurrenceDetail {
    pub id: i64,
    pub file_id: i64,
    pub segment_id: i64,
    pub segment_index: i32,
    pub position: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub file_name: String,
    pub hidden: bool,
    pub surface_text: Option<String>,
    pub token_positions: Option<Vec<i32>>,
    pub meaning_zh: Option<String>,
    pub usage_zh: Option<String>,
    pub meaning_edited: bool,
    pub meaning_en: Option<String>,
    pub usage_en: Option<String>,
    pub meaning_en_edited: bool,
    pub collins_sense_id: Option<i64>,
}

fn query_phrases(
    conn: &rusqlite::Connection,
    status_filter: Option<&str>,
    sort_by: Option<&str>,
    language: Option<&str>,
    include_unverified: bool,
) -> Result<Vec<PhraseInfo>, rusqlite::Error> {
    let order_clause = match sort_by {
        Some("alpha") => "p.text ASC",
        Some("recent") => "p.id DESC",
        _ => "frequency DESC",
    };

    let mut rows: Vec<PhraseInfo> = Vec::new();
    let occurrence_table = if include_unverified { "phrase_occurrences" } else { "study_phrase_occurrences" };

    match status_filter {
        Some(s) => {
            let sql = format!(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language,
                        CASE WHEN p.language='en' AND p.source='detected' AND p.status='unprocessed' AND COUNT(po.id)>0
                          AND NOT EXISTS (SELECT 1 FROM study_phrase_occurrences verified WHERE verified.phrase_id=p.id)
                          THEN 1 ELSE 0 END
                 FROM phrases p
                 LEFT JOIN {occurrence_table} po ON po.phrase_id = p.id AND po.hidden = 0
                 WHERE p.status = ?1 AND (?2 IS NULL OR p.language = ?2)
                 GROUP BY p.id
                 HAVING frequency > 0 OR p.source='manual' OR p.status!='unprocessed' OR p.definition IS NOT NULL
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![s, language], |row| {
                Ok(PhraseInfo {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    source: row.get(4)?,
                    frequency: row.get(5)?,
                    language: row.get(6)?,
                    unverified: row.get::<_, i64>(7)? != 0,
                })
            })?;
            for row in mapped {
                rows.push(row?);
            }
        }
        None => {
            let sql = format!(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language,
                        CASE WHEN p.language='en' AND p.source='detected' AND p.status='unprocessed' AND COUNT(po.id)>0
                          AND NOT EXISTS (SELECT 1 FROM study_phrase_occurrences verified WHERE verified.phrase_id=p.id)
                          THEN 1 ELSE 0 END
                 FROM phrases p
                 LEFT JOIN {occurrence_table} po ON po.phrase_id = p.id AND po.hidden = 0
                 WHERE (?1 IS NULL OR p.language = ?1)
                 GROUP BY p.id
                 HAVING frequency > 0 OR p.source='manual' OR p.status!='unprocessed' OR p.definition IS NOT NULL
                 ORDER BY {}",
                order_clause
            );
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![language], |row| {
                Ok(PhraseInfo {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    status: row.get(2)?,
                    definition: row.get(3)?,
                    source: row.get(4)?,
                    frequency: row.get(5)?,
                    language: row.get(6)?,
                    unverified: row.get::<_, i64>(7)? != 0,
                })
            })?;
            for row in mapped {
                rows.push(row?);
            }
        }
    }

    Ok(rows)
}

#[tauri::command]
pub fn list_phrases(
    state: State<DbState>,
    status_filter: Option<String>,
    sort_by: Option<String>,
    language: Option<String>,
    include_unverified: Option<bool>,
) -> Result<Vec<PhraseInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_phrases(
        &conn,
        status_filter.as_deref(),
        sort_by.as_deref(),
        language.as_deref(),
        include_unverified.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn phrase_detail(state: State<DbState>, phrase_id: i64) -> Result<PhraseDetail, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let phrase = {
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.text, p.status, p.definition, p.source, COUNT(po.id) AS frequency, p.language
                 FROM phrases p
                 LEFT JOIN phrase_occurrences po ON po.phrase_id = p.id AND po.hidden = 0
                 WHERE p.id = ?1
                 GROUP BY p.id",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![phrase_id], |row| {
            Ok(PhraseInfo {
                id: row.get(0)?,
                text: row.get(1)?,
                status: row.get(2)?,
                definition: row.get(3)?,
                source: row.get(4)?,
                frequency: row.get(5)?,
                language: row.get(6)?,
                unverified: false,
            })
        })
        .map_err(|e| e.to_string())?
    };

    let occurrences = {
        let mut stmt = conn
            .prepare(
                "SELECT po.id, f.id, s.id, s.index_num, po.position,
                        s.en_text, s.zh_text, s.start_time, s.end_time,
                        f.name AS file_name, po.hidden, po.surface_text,
                        po.token_positions_json, po.meaning_zh, po.usage_zh, po.meaning_edited,
                        po.meaning_en, po.usage_en, po.meaning_en_edited, po.collins_sense_id
                 FROM phrase_occurrences po
                 JOIN segments s ON s.id = po.segment_id
                 JOIN files f ON f.id = s.file_id
                 WHERE po.phrase_id = ?1
                 ORDER BY f.name, s.index_num",
            )
            .map_err(|e| e.to_string())?;

        let mapped = stmt
            .query_map(params![phrase_id], |row| {
                Ok(PhraseOccurrenceDetail {
                    id: row.get(0)?,
                    file_id: row.get(1)?,
                    segment_id: row.get(2)?,
                    segment_index: row.get(3)?,
                    position: row.get(4)?,
                    en_text: row.get(5)?,
                    zh_text: row.get(6)?,
                    start_time: row.get(7)?,
                    end_time: row.get(8)?,
                    file_name: row.get(9)?,
                    hidden: row.get(10)?,
                    surface_text: row.get(11)?,
                    token_positions: row.get::<_, Option<String>>(12)?.and_then(|value| serde_json::from_str(&value).ok()),
                    meaning_zh: row.get(13)?,
                    usage_zh: row.get(14)?,
                    meaning_edited: row.get::<_, i64>(15)? != 0,
                    meaning_en: row.get(16)?,
                    usage_en: row.get(17)?,
                    meaning_en_edited: row.get::<_, i64>(18)? != 0,
                    collins_sense_id: row.get(19)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in mapped {
            result.push(row.map_err(|e| e.to_string())?);
        }
        result
    };

    Ok(PhraseDetail {
        phrase,
        occurrences,
    })
}

#[tauri::command]
pub fn update_phrase_occurrence_meaning(
    state: State<DbState>,
    occurrence_id: i64,
    meaning_zh: String,
    usage_zh: String,
) -> Result<(), String> {
    let meaning = meaning_zh.trim();
    if meaning.is_empty() { return Err("本句义不能为空".to_string()); }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let changed = conn.execute(
        "UPDATE phrase_occurrences SET meaning_zh=?1,usage_zh=?2,meaning_edited=1 WHERE id=?3",
        params![meaning, usage_zh.trim(), occurrence_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("词组出现位置不存在".to_string()); }
    Ok(())
}

#[tauri::command]
pub fn update_phrase_occurrence_meaning_en(
    state: State<DbState>, occurrence_id: i64, meaning_en: String, usage_en: String,
) -> Result<(), String> {
    if meaning_en.trim().is_empty() { return Err("Context meaning cannot be empty".into()); }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let changed = conn.execute(
        "UPDATE phrase_occurrences SET meaning_en=?1,usage_en=?2,meaning_en_edited=1,collins_sense_id=NULL WHERE id=?3",
        params![meaning_en.trim(), usage_en.trim(), occurrence_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 { return Err("Phrase occurrence not found".into()); }
    Ok(())
}

#[tauri::command]
pub fn set_phrase_occurrence_hidden(
    state: State<DbState>,
    occurrence_id: i64,
    hidden: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE phrase_occurrences SET hidden = ?1 WHERE id = ?2",
        params![hidden as i32, occurrence_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_phrase_status(
    state: State<DbState>,
    phrase_id: i64,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    super::annotations::save_status(&tx, "phrase", phrase_id, &status)?;
    tx.commit().map_err(|e| e.to_string())

}

#[tauri::command]
pub fn update_phrase_definition(
    state: State<DbState>,
    phrase_id: i64,
    definition: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE phrases SET definition = ?1 WHERE id = ?2",
        params![definition, phrase_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn batch_update_phrase_status(
    state: State<DbState>,
    phrase_ids: Vec<i64>,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let valid = matches!(
        status.as_str(),
        "unprocessed" | "learning" | "known" | "ignored"
    );
    if !valid {
        return Err(format!("Invalid status: {}", status));
    }

    for id in &phrase_ids {
        conn.execute(
            "UPDATE phrases SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn create_manual_phrase(
    state: State<DbState>,
    text: String,
    definition: Option<String>,
    language: Option<String>,
) -> Result<i64, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let trimmed = text.trim().to_lowercase();
    let language = language.unwrap_or_else(|| "en".to_string());
    if trimmed.is_empty() {
        return Err("phrase text cannot be empty".to_string());
    }

    conn.execute(
        "INSERT OR IGNORE INTO phrases (language, text, status, definition, source) VALUES (?1, ?2, 'unprocessed', ?3, 'manual')",
        params![language, trimmed, definition],
    )
    .map_err(|e| e.to_string())?;

    let id: i64 = conn
        .query_row(
            "SELECT id FROM phrases WHERE language = ?1 AND text = ?2",
            params![language, trimmed],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(id)
}

#[derive(Serialize)]
pub struct SegmentPhrase {
    pub phrase_id: i64,
    pub text: String,
    pub status: String,
    pub definition: Option<String>,
    pub source: String,
    pub position: i32,
    pub segment_index: i32,
    pub word_count: i32,
    pub token_positions: Option<Vec<i32>>,
}

#[tauri::command]
pub fn get_file_phrases(state: State<DbState>, file_id: i64) -> Result<Vec<SegmentPhrase>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.text, p.status, p.definition, p.source,
                    po.position, s.index_num, p.language,
                    LENGTH(p.text) - LENGTH(REPLACE(p.text, ' ', '')) + 1,
                    po.token_positions_json
             FROM study_phrase_occurrences po
             JOIN phrases p ON p.id = po.phrase_id
             JOIN segments s ON s.id = po.segment_id
             WHERE s.file_id = ?1
             ORDER BY s.index_num, po.position",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, i32>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i32>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (
            id,
            text,
            status,
            definition,
            source,
            position,
            segment_index,
            language,
            spaced_word_count,
            token_positions_json,
        ) = row.map_err(|e| e.to_string())?;
        // Chinese and Japanese have no spaces, so the SQL word count is always
        // 1. Re-tokenize with the same tokenizer used during import so the
        // reading page can highlight the full phrase span.
        let word_count = if language == "zh" {
            chinese::tokenize_chinese_with_offsets(&text).len() as i32
        } else if language == "ja" {
            language::tokenize_japanese_with_offsets(&text).len() as i32
        } else {
            spaced_word_count
        };
        result.push(SegmentPhrase {
            phrase_id: id,
            text,
            status,
            definition,
            source,
            position,
            segment_index,
            word_count,
            token_positions: token_positions_json.and_then(|value| serde_json::from_str(&value).ok()),
        });
    }

    Ok(result)
}

#[cfg(test)]
mod study_list_tests {
    use super::query_phrases;

    #[test]
    fn candidate_toggle_only_exposes_unverified_new_expressions_on_demand() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("phrases.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at) VALUES('one.txt','txt','I picked it up.','h',1)", []).unwrap();
        conn.execute("INSERT INTO segments(file_id,index_num,en_text) VALUES(1,0,'I picked it up.')", []).unwrap();
        conn.execute("INSERT INTO phrases(text) VALUES('pick up')", []).unwrap();
        conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position) VALUES(1,1,1)", []).unwrap();
        conn.execute("INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version,collins_evidence_available) VALUES(1,'test',1,3,1)", []).unwrap();
        assert!(query_phrases(&conn, Some("unprocessed"), None, Some("en"), false).unwrap().is_empty());
        let candidates = query_phrases(&conn, Some("unprocessed"), None, Some("en"), true).unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].unverified);
        conn.execute("UPDATE phrase_occurrences SET collins_sense_id=4 WHERE id=1", []).unwrap();
        let verified = query_phrases(&conn, Some("unprocessed"), None, Some("en"), false).unwrap();
        assert_eq!(verified.len(), 1);
        assert!(!verified[0].unverified);
    }
}
