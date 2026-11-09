//! Real-device acceptance fixture. The engine owns all transport, staging,
//! identity binding and writes to files/segments; the probe supplies inputs.
use super::*;
const LINES: usize = 2048;
const EDIT: usize = 117;
const TITLE: &str = "Long subtitle fixture.srt";
const REVISED: &str = "手机修改的单句译文。";
fn line(i: usize) -> (String, Option<String>, String, String) {
    (
        format!("Sentence {i} keeps its own context across the network."),
        (!i.is_multiple_of(5)).then(|| format!("这是第 {i} 句已有的译文。")),
        format!("00:{:02}:{:02}.000", i / 60, i % 60),
        format!("00:{:02}:{:02}.900", i / 60, i % 60),
    )
}
fn body() -> String {
    (0..LINES)
        .map(|i| {
            let (en, _, start, end) = line(i);
            format!(
                "{}\r\n{} --> {}\r\n{en}\r\n\r\n",
                i + 1,
                start.replace('.', ","),
                end.replace('.', ",")
            )
        })
        .collect()
}
pub fn seed(db: &mut Connection, local: &Route, mac: bool) -> Result<()> {
    db.execute_batch("PRAGMA journal_mode=WAL;
    CREATE TABLE files(id INTEGER PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,imported_at INTEGER NOT NULL,language TEXT NOT NULL,media_source TEXT,media_identity TEXT,document_source TEXT,document_identity TEXT);
    CREATE TABLE segments(id INTEGER PRIMARY KEY,file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,index_num INTEGER,en_text TEXT,zh_text TEXT,start_time TEXT,end_time TEXT);
    CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT,name_key TEXT UNIQUE,tone TEXT,created_at INTEGER);
    CREATE TABLE file_tags(id INTEGER PRIMARY KEY,file_id INTEGER,tag_id INTEGER,UNIQUE(file_id,tag_id));
    CREATE TABLE reader_positions(file_id INTEGER PRIMARY KEY,segment_id INTEGER,content_hash TEXT,revision TEXT,parent TEXT,back INTEGER);
    CREATE TABLE sync_entity_state(table_name TEXT,local_id INTEGER,sync_id TEXT,updated_at INTEGER,deleted_at INTEGER,PRIMARY KEY(table_name,local_id),UNIQUE(table_name,sync_id));
    CREATE TABLE restored_material_ids(file_id INTEGER PRIMARY KEY,stable TEXT NOT NULL UNIQUE);
    CREATE VIEW reader_material_ids AS SELECT f.id AS file_id,coalesce(b.stable,s.sync_id) AS stable FROM files f JOIN sync_entity_state s ON s.table_name='files' AND s.local_id=f.id LEFT JOIN restored_material_ids b ON b.file_id=f.id;
    CREATE TABLE sync_runtime(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE sync_delete_jobs(file_id INTEGER,phase TEXT);
    CREATE TABLE material_import_actions(file_id INTEGER);
    CREATE TABLE saved_records(id INTEGER PRIMARY KEY,record_id TEXT UNIQUE, revision TEXT NOT NULL,snapshot_json TEXT NOT NULL);").map_err(|e|e.to_string())?;
    journal::install_library(db, local)?;
    if mac {
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO files(id,name,type,content,content_hash,imported_at,language) VALUES(1,?,'srt',?,'local',1,'en')",
            params![TITLE, body()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sync_entity_state VALUES('files',1,?,1,NULL)",
            [Uuid::new_v4().simple().to_string()],
        )
        .map_err(|e| e.to_string())?;
        for i in 0..LINES {
            let (en, zh, start, end) = line(i);
            tx.execute("INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(1,?,?,?,?,?)",params![i,en,zh,start,end]).map_err(|e|e.to_string())?;
        }
        tx.execute("INSERT INTO material_import_actions VALUES(1)", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn dropped(db: &Connection, r: &Route, mac: bool) -> Result<String> {
    let p = journal::progress(db, r)?;
    if p.acked != 0 || p.received != 0 {
        return Err("partial material falsely acknowledged".into());
    }
    if mac {
        return Ok("sender applied ACK=0".into());
    }
    let(valid,files):(bool,usize)=db.query_row("SELECT filled=32768 AND filled<bytes,(SELECT count(*) FROM files) FROM lan_material_stage",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
    if !valid || files != 0 {
        return Err("incorrect partial material state".into());
    }
    Ok("staged 32768 bytes, 0 visible files, applied ACK=0".into())
}
pub fn edit(db: &Connection) -> Result<()> {
    if db
        .execute(
            "UPDATE segments SET zh_text=? WHERE index_num=?",
            params![REVISED, EDIT],
        )
        .map_err(|e| e.to_string())?
        != 1
    {
        return Err("target sentence missing".into());
    }
    Ok(())
}
pub fn verify(db: &Connection, r: &Route, mac: bool, edited: bool) -> Result<String> {
    let (name, content): (String, String) = db
        .query_row("SELECT name,content FROM files", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|e| e.to_string())?;
    if name != TITLE || content != body() {
        return Err("title or body mismatch".into());
    }
    let p = journal::progress(db, r)?;
    let (head, received) = if mac {
        (1, i64::from(edited))
    } else {
        (i64::from(edited), 1)
    };
    if (p.head, p.acked, p.received) != (head, head, received) {
        return Err(format!("invalid progress: {p:?}"));
    }
    let mut stmt = db
        .prepare(
            "SELECT index_num,en_text,zh_text,start_time,end_time FROM segments ORDER BY index_num",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    for i in 0..LINES {
        let row = rows
            .next()
            .map_err(|e| e.to_string())?
            .ok_or("missing sentence")?;
        let mut want = line(i);
        if edited && i == EDIT {
            want.1 = Some(REVISED.to_string())
        }
        let got = (row.get(1), row.get(2), row.get(3), row.get(4));
        if row.get::<_, usize>(0).ok() != Some(i)
            || !(got.0 == Ok(want.0)
                && got.1 == Ok(want.1)
                && got.2 == Ok(want.2)
                && got.3 == Ok(want.3))
        {
            return Err(format!("incorrect sentence {i}"));
        }
    }
    if rows.next().map_err(|e| e.to_string())?.is_some() {
        return Err("duplicate sentences".into());
    }
    Ok(format!(
        "title + exact body + {LINES} sentences/times/translations verified, edited={edited}"
    ))
}
pub fn check_patch(reply: &Reply, events: &mut usize) -> Result<()> {
    if let Reply::Pending(Some(batch)) = reply {
        for event in &batch.events {
            let field: Value = serde_json::from_str(&event.snapshot).map_err(|e| e.to_string())?;
            if field["material_op"] != "field"
                || field["value"] != REVISED
                || event.snapshot.len() > 512
                || event.snapshot.contains("Sentence")
            {
                return Err("unexpected content in one-sentence patch".into());
            }
            *events += 1;
        }
    }
    Ok(())
}
