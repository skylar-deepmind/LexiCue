use lexicue_lan_journal::{self as j, session, Route};
use rusqlite::{params, Connection};
use uuid::Uuid;

struct Store;
impl session::SavedStore for Store {
    fn validate(&self, _: &str) -> j::Result<()> {
        panic!("unexpected save")
    }
    fn write(&self, _: &Connection, _: &str) -> j::Result<()> {
        panic!("unexpected save")
    }
}
fn route() -> Route {
    Route {
        pair: Uuid::new_v4(),
        from: Uuid::new_v4(),
        to: Uuid::new_v4(),
    }
}
fn setup(r: &Route) -> Connection {
    let mut c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE files(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,type TEXT,content TEXT,content_hash TEXT,imported_at INTEGER,language TEXT,media_source TEXT,media_identity TEXT,document_source TEXT,document_identity TEXT);
    CREATE TABLE segments(id INTEGER PRIMARY KEY,file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,index_num INTEGER,en_text TEXT,zh_text TEXT,start_time TEXT,end_time TEXT);
    CREATE TABLE tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,name_key TEXT UNIQUE,tone TEXT,created_at INTEGER);
    CREATE TABLE file_tags(id INTEGER PRIMARY KEY,file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE, UNIQUE(file_id,tag_id));
    CREATE TABLE reader_positions(file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,segment_id INTEGER,content_hash TEXT,revision TEXT,parent TEXT,back INTEGER);
    CREATE TABLE sync_entity_state(table_name TEXT,local_id INTEGER,sync_id TEXT,updated_at INTEGER,deleted_at INTEGER,PRIMARY KEY(table_name,local_id),UNIQUE(table_name,sync_id));
    CREATE TABLE restored_material_ids(file_id INTEGER PRIMARY KEY,stable TEXT NOT NULL UNIQUE);
    CREATE VIEW reader_material_ids AS SELECT f.id AS file_id,coalesce(b.stable,s.sync_id) AS stable FROM files f JOIN sync_entity_state s ON s.table_name='files' AND s.local_id=f.id LEFT JOIN restored_material_ids b ON b.file_id=f.id;
    CREATE TABLE sync_runtime(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE sync_delete_jobs(file_id INTEGER,phase TEXT);
    CREATE TABLE material_import_actions(file_id INTEGER);
    CREATE TABLE saved_records(id INTEGER PRIMARY KEY,record_id TEXT UNIQUE,revision TEXT,snapshot_json TEXT);").unwrap();
    j::install_library(&mut c, r).unwrap();
    c
}
fn round(a: &mut Connection, b: &mut Connection, r: &Route) -> j::Result<()> {
    session::catch_up(a, r, &Store, |s| {
        session::respond(b, &r.reverse(), s, &Store)
    })
}
fn text(c: &Connection, s: &str) -> String {
    c.query_row(s, [], |r| r.get(0)).unwrap()
}
fn count(c: &Connection, s: &str) -> i64 {
    c.query_row(s, [], |r| r.get(0)).unwrap()
}
fn seed(a: &Connection) {
    a.execute_batch("INSERT INTO files(id,name,type,content,content_hash,imported_at,language) VALUES(7,'Title','txt','body','230d8358dc8e8890',0,'en');
        INSERT INTO sync_entity_state VALUES('files',7,'file-7',0,NULL);
        INSERT INTO segments VALUES(1,7,0,'One.',NULL,NULL,NULL),(2,7,1,'Two.',NULL,NULL,NULL);
        INSERT INTO tags(name,name_key,created_at) VALUES('Talk','talk',0);
        UPDATE tags SET tone='green';
        INSERT INTO file_tags(file_id,tag_id) SELECT 7,id FROM tags;
        INSERT INTO material_import_actions VALUES(7);").unwrap();
}
fn position(c: &Connection, index: i64, parent: Option<&str>, back: bool) -> String {
    let rev = Uuid::new_v4().simple().to_string();
    c.execute("INSERT OR REPLACE INTO reader_positions SELECT f.id,s.id,f.content_hash,?,?,? FROM files f JOIN segments s ON s.file_id=f.id WHERE s.index_num=?",params![rev,parent,back,index]).unwrap();
    rev
}
#[test]
fn retag_reread_and_repair_with_the_original_peer() {
    let r = route();
    let mut a = setup(&r);
    let mut b = setup(&r.reverse());
    seed(&a);
    let start = position(&a, 1, None, false);
    round(&mut a, &mut b, &r).unwrap();
    assert_eq!(text(&b, "SELECT tone FROM tags"), "green");
    assert_eq!(count(&b, "SELECT count(*) FROM file_tags"), 1);
    assert_eq!(text(&b, "SELECT revision FROM reader_positions"), start);
    let back = position(&b, 0, Some(&start), true);
    a.execute("UPDATE tags SET tone='pink'", []).unwrap();
    b.execute("UPDATE tags SET name='Lecture',name_key='lecture'", [])
        .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for c in [&a, &b] {
        assert_eq!(text(c, "SELECT name||':'||tone FROM tags"), "Lecture:pink");
        assert_eq!(text(c, "SELECT revision FROM reader_positions"), back);
    }
    b.execute("DELETE FROM files", []).unwrap();
    for c in [&a, &b] {
        c.execute("UPDATE lan_saved_peer SET active=0", []).unwrap();
    }
    a.execute("UPDATE segments SET zh_text='离线译文' WHERE id=1", [])
        .unwrap();
    assert!(round(&mut a, &mut b, &r).is_err());
    let fresh = Route {
        pair: Uuid::new_v4(),
        ..r.clone()
    };
    j::install_library(&mut a, &fresh).unwrap();
    j::install_library(&mut b, &fresh.reverse()).unwrap();
    round(&mut a, &mut b, &fresh).unwrap();
    assert_eq!(count(&a, "SELECT count(*) FROM files"), 0);
    assert_eq!(count(&b, "SELECT count(*) FROM files"), 0);
    assert!(
        count(
            &b,
            "SELECT count(*) FROM lan_material_values WHERE value='离线译文'"
        ) > 0
    );
}

#[test]
fn competing_translations_are_visible_and_resolution_crosses_the_link() {
    let r = route();
    let mut a = setup(&r);
    let mut b = setup(&r.reverse());
    seed(&a);
    round(&mut a, &mut b, &r).unwrap();
    a.execute("UPDATE segments SET zh_text='A' WHERE index_num=1", [])
        .unwrap();
    b.execute("UPDATE segments SET zh_text='B' WHERE index_num=1", [])
        .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    let mut conflicts = j::conflicts(&a).unwrap();
    assert_eq!(conflicts.len(), 1);
    let conflict = conflicts.remove(0);
    assert_eq!(conflict.versions.len(), 2);
    let pick = conflict
        .versions
        .iter()
        .find(|v| v.text == "B")
        .unwrap()
        .revision
        .clone();
    let parents = conflict.versions.into_iter().map(|v| v.revision).collect();
    j::resolve(
        &mut a,
        &conflict.entity,
        &conflict.field,
        parents,
        &pick,
        &Store,
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for c in [&a, &b] {
        assert!(j::conflicts(c).unwrap().is_empty());
        assert_eq!(
            text(c, "SELECT zh_text FROM segments WHERE index_num=1"),
            "B"
        );
    }
}

#[test]
fn restore_a_deleted_material_edit_as_an_independent_copy() {
    let r = route();
    let mut a = setup(&r);
    let mut b = setup(&r.reverse());
    seed(&a);
    round(&mut a, &mut b, &r).unwrap();
    a.execute("DELETE FROM files", []).unwrap();
    b.execute(
        "UPDATE segments SET zh_text='找回的译文' WHERE index_num=1",
        [],
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    round(&mut a, &mut b, &r).unwrap();
    let c = j::conflicts(&a)
        .unwrap()
        .into_iter()
        .find(|c| c.field.starts_with("deleted-material:"))
        .unwrap();
    let picked = c
        .versions
        .iter()
        .find(|v| !v.deleted)
        .unwrap()
        .revision
        .clone();
    j::resolve(
        &mut a,
        &c.entity,
        &c.field,
        c.versions.into_iter().map(|v| v.revision).collect(),
        &picked,
        &Store,
    )
    .unwrap();
    round(&mut a, &mut b, &r).unwrap();
    for db in [&a, &b] {
        assert_eq!(count(db, "SELECT count(*) FROM files"), 1);
        assert_eq!(
            count(
                db,
                "SELECT count(*) FROM segments WHERE zh_text='找回的译文'"
            ),
            1
        );
        assert_eq!(
            count(
                db,
                "SELECT count(*) FROM lan_material_files WHERE file='file-7' AND local_id IS NULL"
            ),
            1
        );
        assert!(j::conflicts(db).unwrap().is_empty());
    }
}
