use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::commands::{english, frequency_baseline};
use crate::db::DbState;

#[derive(Serialize)]
pub struct WordInfo {
    pub id: i64,
    pub lemma: String,
    pub status: String,
    pub definition: Option<String>,
    pub frequency: i64,
    pub language: String,
    pub reading: Option<String>,
    pub part_of_speech: Option<String>,
    pub baseline_pending: bool,
    pub word_kind: String,
    pub search_aliases: Vec<String>,
}

#[derive(Serialize)]
pub struct WordDetail {
    pub word: WordInfo,
    pub occurrences: Vec<OccurrenceDetail>,
}

#[derive(Serialize)]
pub struct FileWordToken {
    pub original_form: String,
    pub lemma: String,
    pub id: i64,
    pub status: String,
}

#[tauri::command]
pub fn list_file_word_tokens(
    state: State<DbState>,
    file_id: i64,
) -> Result<Vec<FileWordToken>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT o.original_form, w.lemma, w.id, w.status
         FROM occurrences o JOIN words w ON w.id = o.word_id
         JOIN segments s ON s.id = o.segment_id
         WHERE s.file_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(FileWordToken {
                original_form: row.get(0)?,
                lemma: row.get(1)?,
                id: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[derive(Serialize)]
pub struct SegmentToken {
    pub segment_index: i32,
    pub surface: String,
    pub lemma: String,
    pub position: i32,
}

#[tauri::command]
pub fn get_file_segment_tokens(
    state: State<DbState>,
    file_id: i64,
) -> Result<Vec<SegmentToken>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.index_num, o.original_form, w.lemma, o.position
             FROM occurrences o
             JOIN words w ON w.id = o.word_id
             JOIN segments s ON s.id = o.segment_id
             WHERE s.file_id = ?1
             ORDER BY s.index_num, o.position",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![file_id], |row| {
            Ok(SegmentToken {
                segment_index: row.get(0)?,
                surface: row.get(1)?,
                lemma: row.get(2)?,
                position: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())).collect()
}

#[derive(Serialize)]
pub struct OccurrenceDetail {
    pub id: i64,
    pub file_id: i64,
    pub segment_id: i64,
    pub segment_index: i32,
    pub original_form: String,
    pub position: i32,
    pub en_text: String,
    pub zh_text: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub file_name: String,
    pub hidden: bool,
    pub meaning_zh: Option<String>,
    pub usage_zh: Option<String>,
    pub collins_sense_id: Option<i64>,
    pub meaning_edited: bool,
    pub analysis_model: Option<String>,
    pub analyzed_at: Option<i64>,
}

fn query_words(
    conn: &rusqlite::Connection,
    status_filter: Option<&str>,
    sort_by: Option<&str>,
    language: Option<&str>,
    include_proper_nouns: bool,
) -> Result<Vec<WordInfo>, rusqlite::Error> {
    let order_clause = match sort_by {
        Some("alpha") => "w.lemma ASC",
        Some("recent") => "w.id DESC",
        _ => "frequency DESC",
    };

    let sql = format!(
        "SELECT w.id,w.lemma,w.status,w.definition,COUNT(o.id) AS frequency,w.language,w.reading,w.part_of_speech,
                EXISTS(SELECT 1 FROM frequency_baseline_marks m WHERE m.word_id=w.id AND m.verification='pending'),
                w.word_kind,COALESCE((SELECT GROUP_CONCAT(alias,char(31)) FROM word_aliases a WHERE a.word_id=w.id),'')
         FROM words w LEFT JOIN occurrences o ON o.word_id=w.id AND o.hidden=0
         WHERE (?1 IS NULL OR w.status=?1) AND (?2 IS NULL OR w.language=?2)
           AND (w.word_kind!='noise' OR w.status IN ('learning','known') OR w.definition IS NOT NULL
                OR EXISTS(SELECT 1 FROM reviews r WHERE r.word_id=w.id)
                OR EXISTS(SELECT 1 FROM review_logs l WHERE l.word_id=w.id))
           AND (?3 OR w.word_kind!='proper_noun' OR w.status IN ('learning','known') OR w.definition IS NOT NULL
                OR EXISTS(SELECT 1 FROM reviews r WHERE r.word_id=w.id)
                OR EXISTS(SELECT 1 FROM review_logs l WHERE l.word_id=w.id))
         GROUP BY w.id ORDER BY {}", order_clause);
    let mut stmt = conn.prepare(&sql)?;
    let mapped = stmt.query_map(params![status_filter, language, include_proper_nouns], |row| {
        Ok(WordInfo {
            id: row.get(0)?, lemma: row.get(1)?, status: row.get(2)?, definition: row.get(3)?,
            frequency: row.get(4)?, language: row.get(5)?, reading: row.get(6)?, part_of_speech: row.get(7)?,
            baseline_pending: row.get(8)?, word_kind: row.get(9)?,
            search_aliases: row.get::<_, String>(10)?.split(char::from(31)).filter(|v| !v.is_empty()).map(str::to_string).collect(),
        })
    })?;
    let mut result: Vec<WordInfo> = mapped.collect::<Result<Vec<_>, _>>()?;
    for word in &mut result {
        if word.language == "en" {
            for alias in english::spelling_variants(&word.lemma) {
                if !word.search_aliases.contains(&alias) { word.search_aliases.push(alias); }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn list_words(
    state: State<DbState>,
    status_filter: Option<String>,
    sort_by: Option<String>,
    language: Option<String>,
    include_proper_nouns: Option<bool>,
) -> Result<Vec<WordInfo>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    query_words(
        &conn,
        status_filter.as_deref(),
        sort_by.as_deref(),
        language.as_deref(),
        include_proper_nouns.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn word_detail(state: State<DbState>, word_id: i64) -> Result<WordDetail, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    let word = {
        let mut stmt = conn
            .prepare(
                "SELECT w.id, w.lemma, w.status, w.definition, COUNT(o.id) AS frequency,
                         w.language, w.reading, w.part_of_speech,
                         EXISTS(SELECT 1 FROM frequency_baseline_marks m WHERE m.word_id=w.id AND m.verification='pending'),
                         w.word_kind,COALESCE((SELECT GROUP_CONCAT(alias,char(31)) FROM word_aliases a WHERE a.word_id=w.id),'')
                 FROM words w
                 LEFT JOIN occurrences o ON o.word_id = w.id AND o.hidden = 0
                 WHERE w.id = ?1
                 GROUP BY w.id",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![word_id], |row| {
            Ok(WordInfo {
                id: row.get(0)?,
                lemma: row.get(1)?,
                status: row.get(2)?,
                definition: row.get(3)?,
                frequency: row.get(4)?,
                language: row.get(5)?,
                reading: row.get(6)?,
                part_of_speech: row.get(7)?,
                baseline_pending: row.get(8)?,
                word_kind: row.get(9)?,
                search_aliases: row.get::<_, String>(10)?.split(char::from(31)).filter(|v| !v.is_empty()).map(str::to_string).collect(),
            })
        })
        .map_err(|e| e.to_string())?
    };

    let occurrences = {
        let mut stmt = conn
            .prepare(
                "SELECT o.id, f.id, s.id, s.index_num, o.original_form, o.position,
                        s.en_text, s.zh_text, s.start_time, s.end_time,
                        f.name AS file_name, o.hidden, o.meaning_zh, o.usage_zh,
                        o.collins_sense_id, o.meaning_edited, o.analysis_model, o.analyzed_at
                 FROM occurrences o
                 JOIN segments s ON s.id = o.segment_id
                 JOIN files f ON f.id = s.file_id
                 WHERE o.word_id = ?1
                 ORDER BY f.name, s.index_num",
            )
            .map_err(|e| e.to_string())?;

        let mapped = stmt
            .query_map(params![word_id], |row| {
                Ok(OccurrenceDetail {
                    id: row.get(0)?,
                    file_id: row.get(1)?,
                    segment_id: row.get(2)?,
                    segment_index: row.get(3)?,
                    original_form: row.get(4)?,
                    position: row.get(5)?,
                    en_text: row.get(6)?,
                    zh_text: row.get(7)?,
                    start_time: row.get(8)?,
                    end_time: row.get(9)?,
                    file_name: row.get(10)?,
                    hidden: row.get(11)?,
                    meaning_zh: row.get(12)?,
                    usage_zh: row.get(13)?,
                    collins_sense_id: row.get(14)?,
                    meaning_edited: row.get::<_, i64>(15)? != 0,
                    analysis_model: row.get(16)?,
                    analyzed_at: row.get(17)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in mapped {
            result.push(row.map_err(|e| e.to_string())?);
        }
        result
    };

    Ok(WordDetail { word, occurrences })
}

#[tauri::command]
pub fn set_occurrence_hidden(
    state: State<DbState>,
    occurrence_id: i64,
    hidden: bool,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE occurrences SET hidden = ?1 WHERE id = ?2",
        params![hidden as i32, occurrence_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn update_word_occurrence_meaning(
    state: State<DbState>, occurrence_id: i64, meaning_zh: String, usage_zh: String,
) -> Result<(), String> {
    let meaning = meaning_zh.trim();
    if meaning.is_empty() { return Err("meaning is empty".into()); }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE occurrences SET meaning_zh=?1,usage_zh=?2,meaning_edited=1,collins_sense_id=NULL,analysis_model='user',analyzed_at=?3 WHERE id=?4",
        params![meaning, usage_zh.trim(), now_ms(), occurrence_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_word_occurrence_meaning(state: State<DbState>, occurrence_id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE occurrences SET meaning_zh=NULL,usage_zh=NULL,collins_sense_id=NULL,meaning_edited=0,analysis_model=NULL,analyzed_at=NULL WHERE id=?1",
        [occurrence_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resolve_word_lemma(state: State<DbState>, word_id: i64, lemma: String) -> Result<i64, String> {
    let lemma = lemma.trim().to_lowercase();
    if lemma.is_empty() || !lemma.chars().all(|value| value.is_ascii_alphabetic()) { return Err("invalid lemma".into()); }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("BEGIN IMMEDIATE", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<i64,String> {
        let (old, language): (String,String) = conn.query_row("SELECT lemma,language FROM words WHERE id=?1", [word_id], |row| Ok((row.get(0)?,row.get(1)?))).map_err(|e| e.to_string())?;
        if old == lemma {
            conn.execute("UPDATE words SET word_kind='common',kind_edited=1 WHERE id=?1", [word_id]).map_err(|e| e.to_string())?;
            return Ok(word_id);
        }
        let target: Option<i64> = conn.query_row("SELECT id FROM words WHERE language=?1 AND lemma=?2", params![language,lemma], |row| row.get(0)).ok();
        if let Some(target_id) = target {
            let rank = |value: &str| match value { "learning"=>4,"known"=>3,"unprocessed"=>2,_=>1 };
            let (source_status,target_status,source_note,target_note):(String,String,Option<String>,Option<String>) = conn.query_row(
                "SELECT s.status,t.status,s.definition,t.definition FROM words s JOIN words t ON t.id=?2 WHERE s.id=?1", params![word_id,target_id],
                |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e| e.to_string())?;
            let status = if rank(&source_status)>rank(&target_status) { source_status } else { target_status };
            let note = match (target_note,source_note) { (Some(a),Some(b)) if a.trim()!=b.trim()=>Some(format!("[{lemma}] {a}\n[{old}] {b}")),(Some(a),_)=>Some(a),(_,Some(b))=>Some(b),_=>None };
            conn.execute("UPDATE words SET status=?1,definition=?2,word_kind='common',kind_edited=1 WHERE id=?3", params![status,note,target_id]).map_err(|e| e.to_string())?;
            conn.execute("INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) SELECT ?1,alias,alias_kind FROM word_aliases WHERE word_id=?2", params![target_id,word_id]).map_err(|e| e.to_string())?;
            conn.execute("INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) VALUES(?1,?2,'resolved_form')", params![target_id,old]).map_err(|e| e.to_string())?;
            conn.execute("UPDATE occurrences SET word_id=?1 WHERE word_id=?2", params![target_id,word_id]).map_err(|e| e.to_string())?;
            let src_review: Option<(i64,i64)> = conn.query_row("SELECT reps,COALESCE(last_review_at,0) FROM reviews WHERE word_id=?1", [word_id], |row| Ok((row.get(0)?,row.get(1)?))).ok();
            let dst_review: Option<(i64,i64)> = conn.query_row("SELECT reps,COALESCE(last_review_at,0) FROM reviews WHERE word_id=?1", [target_id], |row| Ok((row.get(0)?,row.get(1)?))).ok();
            if let Some(source) = src_review {
                if dst_review.is_none() || Some(source) > dst_review {
                    conn.execute("DELETE FROM reviews WHERE word_id=?1", [target_id]).map_err(|e| e.to_string())?;
                    conn.execute("UPDATE reviews SET word_id=?1 WHERE word_id=?2", params![target_id,word_id]).map_err(|e| e.to_string())?;
                } else { conn.execute("DELETE FROM reviews WHERE word_id=?1", [word_id]).map_err(|e| e.to_string())?; }
            }
            conn.execute("UPDATE review_logs SET word_id=?1 WHERE word_id=?2", params![target_id,word_id]).map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM words WHERE id=?1", [word_id]).map_err(|e| e.to_string())?;
            Ok(target_id)
        } else {
            conn.execute("UPDATE words SET lemma=?1,word_kind='common',kind_edited=1 WHERE id=?2", params![lemma,word_id]).map_err(|e| e.to_string())?;
            conn.execute("INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) VALUES(?1,?2,'resolved_form')", params![word_id,old]).map_err(|e| e.to_string())?;
            Ok(word_id)
        }
    })();
    match result { Ok(id)=>{conn.execute("COMMIT",[]).map_err(|e|e.to_string())?;Ok(id)},Err(error)=>{let _=conn.execute("ROLLBACK",[]);Err(error)} }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64
}

#[tauri::command]
pub fn update_word_status(
    state: State<DbState>,
    word_id: i64,
    status: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    super::annotations::save_status(&tx, "word", word_id, &status)?;
    tx.commit().map_err(|e| e.to_string())

}

#[tauri::command]
pub fn update_word_definition(
    state: State<DbState>,
    word_id: i64,
    definition: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE words SET definition = ?1 WHERE id = ?2",
        params![definition, word_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn batch_update_status(
    state: State<DbState>,
    word_ids: Vec<i64>,
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

    for id in &word_ids {
        conn.execute(
            "UPDATE words SET status = ?1 WHERE id = ?2",
            params![status, id],
        )
        .map_err(|e| e.to_string())?;
        frequency_baseline::record_manual_status(&conn, *id, &status).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::query_words;

    #[test]
    fn proper_noun_filter_never_exposes_unprotected_noise() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("words.db")).unwrap();
        conn.execute(
            "INSERT INTO words(language,lemma,word_kind) VALUES
             ('en','ordinary','common'),('en','Skylar','proper_noun'),('en','png','noise')",
            [],
        ).unwrap();

        let hidden = query_words(&conn, None, None, Some("en"), false).unwrap();
        assert_eq!(hidden.iter().map(|word| word.lemma.as_str()).collect::<Vec<_>>(), vec!["ordinary"]);

        let visible = query_words(&conn, None, None, Some("en"), true).unwrap();
        assert!(visible.iter().any(|word| word.lemma == "Skylar"));
        assert!(!visible.iter().any(|word| word.lemma == "png"));

        conn.execute("UPDATE words SET status='learning' WHERE lemma='png'", []).unwrap();
        let protected = query_words(&conn, None, None, Some("en"), false).unwrap();
        assert!(protected.iter().any(|word| word.lemma == "png"));
    }
}
