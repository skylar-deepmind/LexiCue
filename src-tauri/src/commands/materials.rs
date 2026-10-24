//! The English reading flow writes materials and sentences only. Legacy vocabulary,
//! proficiency and review tables remain untouched and are available as history.
use super::{import::SegmentInput, reader::ReaderToken, tags::TagInfo};
use crate::db::DbState;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

pub fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS material_import_actions (
        operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, file_id INTEGER NOT NULL,
        outcome TEXT NOT NULL, readable INTEGER NOT NULL
    ) STRICT;",
    )
}
#[derive(Serialize, Deserialize)]
pub struct MaterialInput {
    pub operation_id: String,
    pub name: String,
    pub content: String,
    pub segments: Vec<SegmentInput>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub file_id: i64,
    pub outcome: String,
    pub readable: bool,
}

pub fn import_material(conn: &Connection, input: &MaterialInput) -> Result<ImportResult, String> {
    if input.operation_id.is_empty()
        || input.operation_id.len() > 200
        || !input.name.to_lowercase().ends_with(".srt")
        || input.content.len() > 32 * 1024 * 1024
        || !input.content.contains("-->")
        || input.segments.is_empty()
        || input.segments.iter().enumerate().any(|(i, s)| {
            s.index != i as i32
                || !s.en_text.chars().any(|c| c.is_ascii_alphabetic())
                || s.start_time.is_none()
                || s.end_time.is_none()
        })
    {
        return Err("material_invalid_srt".into());
    }
    let request_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(&input.name, &input.content, &input.segments))
                .map_err(|e| e.to_string())?
        )
    );
    let hash = format!("{:x}", Sha256::digest(input.content.as_bytes()))[..16].to_string();
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let receipt:Option<(String,i64,String,bool)>=tx.query_row("SELECT request_hash,file_id,outcome,readable FROM material_import_actions WHERE operation_id=?1",[&input.operation_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
    if let Some((previous, id, outcome, readable)) = receipt {
        if previous != request_hash {
            return Err("material_operation_conflict".into());
        }
        if !tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM files WHERE id=?1 AND content_hash=?2)",
                params![id, hash],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?
        {
            return Err("material_source_removed".into());
        }
        return Ok(ImportResult {
            file_id: id,
            outcome,
            readable,
        });
    }
    let existing: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT id,language,type FROM files WHERE content_hash=?1 ORDER BY id LIMIT 1",
            [&hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let result = if let Some((id, language, kind)) = existing {
        ImportResult {
            file_id: id,
            outcome: "duplicate".into(),
            readable: language == "en" && kind == "srt",
        }
    } else {
        tx.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES(?1,'srt',?2,?3,?4,'en')",params![input.name,input.content,hash,super::saved::now_ms()]).map_err(|e|e.to_string())?;
        let id = tx.last_insert_rowid();
        super::tags::replace_file_tags(&tx, id, &[], &[])?;
        let mut statement=tx.prepare_cached("INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?1,?2,?3,?4,?5,?6)").map_err(|e|e.to_string())?;
        for segment in &input.segments {
            statement
                .execute(params![
                    id,
                    segment.index,
                    segment.en_text,
                    segment.zh_text,
                    segment.start_time,
                    segment.end_time
                ])
                .map_err(|e| e.to_string())?;
        }
        ImportResult {
            file_id: id,
            outcome: "created".into(),
            readable: true,
        }
    };
    tx.execute("INSERT INTO material_import_actions(operation_id,request_hash,file_id,outcome,readable) VALUES(?1,?2,?3,?4,?5)",params![input.operation_id,request_hash,result.file_id,result.outcome,result.readable]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(result)
}
#[tauri::command]
pub async fn import_reading_material(
    state: State<'_, DbState>,
    input: MaterialInput,
) -> Result<ImportResult, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        import_material(&conn, &input)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Material {
    pub id: i64,
    pub name: String,
    pub content_hash: String,
    pub imported_at: i64,
    pub segment_count: i64,
    pub preview: String,
    pub tags: Vec<TagInfo>,
}
pub fn list(conn: &Connection, tag_ids: &[i64], untagged: bool) -> Result<Vec<Material>, String> {
    let ids = serde_json::to_string(tag_ids).unwrap();
    let mut stmt=conn.prepare("SELECT f.id,f.name,f.content_hash,f.imported_at,(SELECT COUNT(*) FROM segments s WHERE s.file_id=f.id),COALESCE((SELECT en_text FROM segments s WHERE s.file_id=f.id ORDER BY index_num LIMIT 1),'') FROM files f
        WHERE f.language='en' AND f.type='srt' AND (?2=0 OR NOT EXISTS(SELECT 1 FROM file_tags ft WHERE ft.file_id=f.id))
        AND NOT EXISTS(SELECT 1 FROM json_each(?1) selected WHERE NOT EXISTS(SELECT 1 FROM file_tags ft WHERE ft.file_id=f.id AND ft.tag_id=selected.value)) ORDER BY imported_at DESC,id DESC").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map(params![ids, untagged], |r| {
            Ok(Material {
                id: r.get(0)?,
                name: r.get(1)?,
                content_hash: r.get(2)?,
                imported_at: r.get(3)?,
                segment_count: r.get(4)?,
                preview: r.get(5)?,
                tags: super::tags::file_tags(conn, r.get(0)?)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn list_materials(
    state: State<DbState>,
    tag_ids: Option<Vec<i64>>,
    untagged: Option<bool>,
) -> Result<Vec<Material>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    list(
        &conn,
        &tag_ids.unwrap_or_default(),
        untagged.unwrap_or(false),
    )
}
#[derive(Serialize)]
pub struct ReadingMaterial {
    pub material: Material,
    pub segments: Vec<super::files::SegmentInfo>,
    pub tokens: Vec<ReaderToken>,
}
pub fn open(conn: &Connection, id: i64) -> Result<ReadingMaterial, String> {
    let material = list(conn, &[], false)?
        .into_iter()
        .find(|m| m.id == id)
        .ok_or("material_legacy_or_missing")?;
    let mut stmt=conn.prepare("SELECT id,index_num,en_text,zh_text,start_time,end_time FROM segments WHERE file_id=?1 ORDER BY index_num").map_err(|e|e.to_string())?;
    let segments = stmt
        .query_map([id], |r| {
            Ok(super::files::SegmentInfo {
                id: r.get(0)?,
                index_num: r.get(1)?,
                en_text: r.get(2)?,
                zh_text: r.get(3)?,
                start_time: r.get(4)?,
                end_time: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let tokens = segments
        .iter()
        .flat_map(|segment| {
            super::reader::latin_spans(&segment.en_text)
                .into_iter()
                .map(|(surface, start, end)| ReaderToken {
                    segment_index: segment.index_num,
                    language: "en".into(),
                    lemma: surface.to_lowercase(),
                    surface,
                    start,
                    end,
                    legacy_position: None,
                    builtin_position: None,
                    word_id: None,
                    status: None,
                })
        })
        .collect();
    Ok(ReadingMaterial {
        material,
        segments,
        tokens,
    })
}
#[tauri::command]
pub async fn open_reading_material(
    state: State<'_, DbState>,
    file_id: i64,
) -> Result<ReadingMaterial, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        open(&conn, file_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct Explanation {
    pub meaning: String,
    pub source: String,
    pub provider: String,
    pub more: Vec<String>,
}
fn explanation_source(provider: &str) -> &'static str {
    let name = provider.to_lowercase();
    if matches!(name.as_str(), "manual" | "personal") {
        "personal"
    } else if ["ecdict", "phrasedict", "collins", "dictionaryapi.dev"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
    {
        "dictionary"
    } else if [
        "ollama", "gemma", "openai", "gpt", "qwen", "deepseek", "claude", "ai:",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        "ai"
    } else {
        "unknown"
    }
}
pub fn lookup(conn: &Connection, expression: &str) -> Result<Explanation, String> {
    let term = super::saved::normalize(expression);
    if term.is_empty() {
        return Err("ERR_DICTIONARY_NOT_FOUND".into());
    }
    if term.split_whitespace().count() == 1 {
        let entry = super::dictionary::lookup_offline_entry(conn, &term, "en")?
            .ok_or("ERR_DICTIONARY_NOT_FOUND")?;
        let meanings = entry
            .definitions
            .iter()
            .map(|d| {
                d.translation
                    .as_deref()
                    .filter(|v| !v.is_empty())
                    .unwrap_or(&d.definition)
                    .to_string()
            })
            .filter(|v| !v.trim().is_empty())
            .collect::<Vec<_>>();
        return Ok(Explanation {
            meaning: meanings
                .first()
                .cloned()
                .ok_or("ERR_DICTIONARY_NOT_FOUND")?,
            source: explanation_source(&entry.provider).into(),
            provider: entry.provider,
            more: meanings.into_iter().skip(1).collect(),
        });
    }
    let builtin: Option<String> = conn
        .query_row(
            "SELECT translation FROM builtin_phrase_dictionary WHERE text=?1",
            [&term],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(meaning) = builtin.filter(|v| !v.trim().is_empty()) {
        return Ok(Explanation {
            meaning,
            source: "dictionary".into(),
            provider: "PhraseDict".into(),
            more: vec![],
        });
    }
    let cached:Option<(String,String)>=conn.query_row("SELECT translation,provider FROM phrase_dictionary_entries WHERE language='en' AND text=?1 AND trim(translation)!=''",[term],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
    cached
        .map(|(meaning, provider)| Explanation {
            meaning,
            source: explanation_source(&provider).into(),
            provider,
            more: vec![],
        })
        .ok_or("ERR_DICTIONARY_NOT_FOUND".into())
}
#[tauri::command]
pub async fn lookup_reading_expression(
    state: State<'_, DbState>,
    expression: String,
) -> Result<Explanation, String> {
    let shared = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = shared.lock().map_err(|e| e.to_string())?;
        lookup(&conn, &expression)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(op: &str, text: &str) -> MaterialInput {
        MaterialInput {
            operation_id: op.into(),
            name: "flight.srt".into(),
            content: format!("1\n00:00:01,000 --> 00:00:03,000\n{text}\n"),
            segments: vec![SegmentInput {
                index: 0,
                en_text: text.into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:03.000".into()),
            }],
        }
    }
    #[test]
    fn material_import_retry_duplicate_and_save_are_independent_of_legacy_learning() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        let first = import_material(&c, &input("a", "We take off at noon.")).unwrap();
        let retry = import_material(&c, &input("a", "We take off at noon.")).unwrap();
        assert_eq!(first.file_id, retry.file_id);
        assert_eq!(
            import_material(&c, &input("b", "We take off at noon."))
                .unwrap()
                .outcome,
            "duplicate"
        );
        let opened = open(&c, first.file_id).unwrap();
        assert!(!opened.tokens.is_empty());
        assert_eq!(opened.segments.len(), 1);
        let saved = super::super::saved::mutate(
            &c,
            "save",
            &super::super::saved::Mutation::Save {
                input: super::super::saved::SaveInput {
                    segment_id: opened.segments[0].id,
                    expression: "take off".into(),
                    start_offset: 3,
                    end_offset: 11,
                    explanation: None,
                    explanation_source: "unknown".into(),
                },
            },
        )
        .unwrap();
        c.execute("DELETE FROM files WHERE id=?1", [first.file_id])
            .unwrap();
        assert!(super::super::saved::get(&c, &saved.record.record_id)
            .unwrap()
            .is_some());
        assert!(import_material(&c, &input("a", "We take off at noon.")).is_err());
        for table in ["words", "phrases", "reviews", "phrase_reviews"] {
            assert_eq!(
                c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    #[test]
    fn failed_file_rolls_back_and_other_successes_stay_and_no_phrase_is_fabricated() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("test.db")).unwrap();
        import_material(&c, &input("good", "A good day.")).unwrap();
        c.execute_batch("CREATE TRIGGER fail_sentence BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT,'write failure'); END;").unwrap();
        assert!(import_material(&c, &input("bad", "Another day.")).is_err());
        assert_eq!(list(&c, &[], false).unwrap().len(), 1);
        c.execute(
            "INSERT INTO builtin_dictionary_entries(lemma,translation) VALUES('take','拿')",
            [],
        )
        .unwrap();
        assert_eq!(lookup(&c, "take").unwrap().meaning, "拿");
        assert!(lookup(&c, "take off").is_err());
        c.execute(
            "INSERT INTO builtin_phrase_dictionary(text,translation) VALUES('take off','起飞')",
            [],
        )
        .unwrap();
        assert_eq!(lookup(&c, "TAKE OFF").unwrap().meaning, "起飞");
    }
}

#[cfg(test)]
mod acceptance {
    use super::*;
    #[test]
    fn fresh_english_dictionaries_cover_the_fixed_useful_meaning_set() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("dictionary.db")).unwrap();
        super::super::dictionary::initialize_builtin_dictionary(&c).unwrap();
        super::super::dictionary::initialize_builtin_phrase_dictionary(&c).unwrap();
        let words = [
            ("apple", "苹"),
            ("book", "书"),
            ("water", "水"),
            ("food", "食"),
            ("house", "房"),
            ("school", "学"),
            ("friend", "友"),
            ("family", "家"),
            ("work", "工"),
            ("time", "时"),
            ("day", "天"),
            ("night", "夜"),
            ("morning", "早"),
            ("people", "人"),
            ("world", "世"),
            ("love", "爱"),
            ("happy", "快"),
            ("sad", "悲"),
            ("good", "好"),
            ("bad", "坏"),
            ("big", "大"),
            ("small", "小"),
            ("new", "新"),
            ("old", "老"),
            ("hot", "热"),
            ("cold", "冷"),
            ("fast", "快"),
            ("slow", "慢"),
            ("come", "来"),
            ("go", "去"),
            ("read", "读"),
            ("write", "写"),
            ("speak", "说"),
            ("listen", "听"),
            ("learn", "学"),
            ("understand", "懂"),
            ("remember", "记"),
            ("forget", "忘"),
            ("start", "始"),
            ("stop", "停"),
            ("open", "开"),
            ("close", "关"),
            ("help", "助"),
            ("need", "需"),
            ("want", "想"),
            ("think", "思"),
            ("know", "知"),
            ("see", "看"),
            ("hear", "听"),
            ("curiosity", "好奇"),
        ];
        let phrases = [
            ("take off", "起飞"),
            ("give up", "放弃"),
            ("turn on", "打开"),
            ("turn off", "关闭"),
            ("put on", "穿"),
            ("put off", "推迟"),
            ("pick up", "捡"),
            ("get up", "起床"),
            ("sit down", "坐"),
            ("come in", "进"),
            ("go out", "出去"),
            ("look for", "寻找"),
            ("look after", "照顾"),
            ("find out", "发现"),
            ("carry on", "继续"),
            ("come back", "回来"),
            ("go on", "继续"),
            ("wake up", "醒"),
            ("make sense", "道理"),
            ("in fact", "事实上"),
        ];
        let check = |set: &[(&str, &str)]| {
            set.iter()
                .filter(|(term, expected)| {
                    lookup(&c, term)
                        .map(|r| r.meaning.contains(expected))
                        .unwrap_or(false)
                })
                .count()
        };
        let word_count = check(&words);
        let phrase_count = check(&phrases);
        println!("Fixed dictionary usefulness: {word_count}/50 words, {phrase_count}/20 phrases (expected Chinese meaning fragments)");
        assert!(word_count >= 45);
        assert!(phrase_count >= 16);
        assert!(lookup(&c, "an invented unheard phrase xyzzy").is_err());
    }
    #[test]
    fn duplicate_transactions_and_restart_preserve_receipts_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("import.db");
        let c = crate::db::init_db(&path).unwrap();
        let make = |op: &str| MaterialInput {
            operation_id: op.into(),
            name: "day.srt".into(),
            content: "1\n00:00:01,000 --> 00:00:03,000\nA good day.\n".into(),
            segments: vec![SegmentInput {
                index: 0,
                en_text: "A good day.".into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:03.000".into()),
            }],
        };
        let a = path.clone();
        let b = path.clone();
        let first = make("a");
        let second = make("b");
        let one = std::thread::spawn(move || {
            let c = crate::db::init_db(&a).unwrap();
            import_material(&c, &first).unwrap()
        });
        let two = std::thread::spawn(move || {
            let c = crate::db::init_db(&b).unwrap();
            import_material(&c, &second).unwrap()
        });
        assert_eq!(one.join().unwrap().file_id, two.join().unwrap().file_id);
        drop(c);
        let c = crate::db::init_db(&path).unwrap();
        assert_eq!(list(&c, &[], false).unwrap().len(), 1);
        assert!(import_material(&c, &make("a")).is_ok());
        let backup = super::super::export::backup_payload(&c).unwrap();
        assert_eq!(backup.data.material_import_actions.len(), 2);
        let target = crate::db::init_db(&dir.path().join("restored.db")).unwrap();
        super::super::export::restore_backup(&target, &backup).unwrap();
        assert!(import_material(&target, &make("a")).is_ok());
    }
}

#[cfg(test)]
mod source_tests {
    #[test]
    fn labels_cached_explanations_without_guessing_unknown_providers_are_ai() {
        for (provider, expected) in [
            ("ECDICT", "dictionary"),
            ("PhraseDict", "dictionary"),
            ("dictionaryapi.dev", "dictionary"),
            ("manual", "personal"),
            ("openai", "ai"),
            ("gemma3:4b", "ai"),
            ("unidentified-import", "unknown"),
        ] {
            assert_eq!(super::explanation_source(provider), expected);
        }
    }
}
