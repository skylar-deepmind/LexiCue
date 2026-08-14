use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct DbState {
    pub conn: Mutex<Connection>,
}

#[derive(Clone, Default)]
pub struct DictionaryStatus(Arc<AtomicBool>);

impl DictionaryStatus {
    pub fn set_ready(&self) {
        self.0.store(true, Ordering::Relaxed);
    }

    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

pub fn init_db(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
    ",
    )?;

    create_tables(&conn)?;
    migrate_legacy_constraints(&conn)?;
    backfill_phrase_provider(&conn)?;
    migrate_file_folder(&conn)?;
    Ok(conn)
}

fn migrate_file_folder(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_folder_id = conn
        .prepare("PRAGMA table_info(files)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|col| col.ok())
        .any(|col| col == "folder_id");
    if !has_folder_id {
        conn.execute_batch("ALTER TABLE files ADD COLUMN folder_id INTEGER")?;
    }
    Ok(())
}

fn table_sql(conn: &Connection, name: &str) -> Result<String, rusqlite::Error> {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get(0),
    )
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(String::new()),
        other => Err(other),
    })
}

fn has_legacy_global_unique(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    let sql = table_sql(conn, name)?;
    if sql.is_empty() {
        return Ok(false);
    }
    Ok(!sql.contains("UNIQUE(language,") && !sql.contains("PRIMARY KEY(language,"))
}

fn rebuild_table(
    conn: &Connection,
    name: &str,
    create_new: &str,
    columns: &str,
) -> Result<(), rusqlite::Error> {
    let new_name = format!("{name}_new");
    let ddl = format!(
        "{create_new}\nINSERT INTO {new_name} ({columns}) SELECT {columns} FROM {name};\nDROP TABLE {name};\nALTER TABLE {new_name} RENAME TO {name};"
    );
    conn.execute_batch(&ddl)
}

const WORDS_NEW_DDL: &str = "CREATE TABLE words_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            language TEXT NOT NULL DEFAULT 'en',
            lemma TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unprocessed'
                CHECK(status IN ('unprocessed','learning','known','ignored')),
            definition TEXT,
            reading TEXT,
            part_of_speech TEXT,
            UNIQUE(language, lemma)
        ) STRICT;";

const PHRASES_NEW_DDL: &str = "CREATE TABLE phrases_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            language TEXT NOT NULL DEFAULT 'en',
            text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unprocessed'
                CHECK(status IN ('unprocessed','learning','known','ignored')),
            definition TEXT,
            source TEXT NOT NULL DEFAULT 'detected'
                CHECK(source IN ('detected','manual')),
            UNIQUE(language, text)
        ) STRICT;";

const DICTIONARY_ENTRIES_NEW_DDL: &str = "CREATE TABLE dictionary_entries_new (
            language TEXT NOT NULL DEFAULT 'en',
            lemma TEXT NOT NULL,
            provider TEXT NOT NULL,
            phonetic TEXT,
            audio_url TEXT,
            local_audio_path TEXT,
            definitions_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY(language, lemma)
        ) STRICT;";

const DICTIONARY_SOURCES_NEW_DDL: &str = "CREATE TABLE dictionary_sources_new (
            language TEXT NOT NULL DEFAULT 'en',
            provider TEXT NOT NULL,
            version TEXT,
            source_url TEXT,
            license TEXT,
            imported_at INTEGER NOT NULL,
            PRIMARY KEY(language, provider)
        ) STRICT;";

const PHRASE_DICTIONARY_ENTRIES_NEW_DDL: &str = "CREATE TABLE phrase_dictionary_entries_new (
            language TEXT NOT NULL DEFAULT 'en',
            text TEXT NOT NULL,
            translation TEXT NOT NULL,
            pinyin TEXT,
            usage_zh TEXT,
            category TEXT,
            provider TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(language, text)
        ) STRICT;";

fn migrate_legacy_constraints(conn: &Connection) -> Result<(), rusqlite::Error> {
    if !has_legacy_global_unique(conn, "words")? {
        return Ok(());
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF")?;
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result = (|| -> Result<(), rusqlite::Error> {
        rebuild_table(
            conn,
            "words",
            WORDS_NEW_DDL,
            "id, language, lemma, status, definition, reading, part_of_speech",
        )?;
        rebuild_table(conn, "phrases", PHRASES_NEW_DDL, "id, language, text, status, definition, source")?;
        rebuild_table(
            conn,
            "dictionary_entries",
            DICTIONARY_ENTRIES_NEW_DDL,
            "language, lemma, provider, phonetic, audio_url, local_audio_path, definitions_json, fetched_at",
        )?;
        rebuild_table(
            conn,
            "dictionary_sources",
            DICTIONARY_SOURCES_NEW_DDL,
            "language, provider, version, source_url, license, imported_at",
        )?;
        rebuild_table(
            conn,
            "phrase_dictionary_entries",
            PHRASE_DICTIONARY_ENTRIES_NEW_DDL,
            "language, text, translation, pinyin, usage_zh, category, provider, updated_at",
        )?;
        Ok(())
    })();

    match result {
        Ok(()) => conn.execute_batch("COMMIT")?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
    }

    conn.execute_batch("PRAGMA foreign_keys = ON")?;
    match conn.query_row("PRAGMA foreign_key_check", [], |_| Ok(0)) {
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(()),
        Ok(_) => Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("foreign key violations found during schema migration".to_string()),
        )),
        Err(e) => Err(e),
    }
}

fn backfill_phrase_provider(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE phrase_dictionary_entries AS e
         SET provider = COALESCE((
             SELECT a.model
             FROM phrase_occurrences po
             JOIN segments s ON s.id = po.segment_id
             JOIN files f ON f.id = s.file_id
             JOIN file_phrase_analysis a ON a.file_id = f.id
             JOIN phrases p ON p.id = po.phrase_id
                          AND p.text = e.text AND p.language = e.language
             ORDER BY a.completed_at DESC
             LIMIT 1
         ), e.provider)
         WHERE e.provider = 'Ollama'",
        [],
    )?;
    Ok(())
}

fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('txt','srt')),
             content TEXT NOT NULL,
             content_hash TEXT NOT NULL,
             imported_at INTEGER NOT NULL,
             language TEXT NOT NULL DEFAULT 'en',
             folder_id INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            index_num INTEGER NOT NULL,
            en_text TEXT NOT NULL,
            zh_text TEXT,
            start_time TEXT,
            end_time TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
             language TEXT NOT NULL DEFAULT 'en',
             lemma TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unprocessed'
                CHECK(status IN ('unprocessed','learning','known','ignored')),
             definition TEXT,
             reading TEXT,
             part_of_speech TEXT,
             UNIQUE(language, lemma)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS occurrences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
            original_form TEXT NOT NULL,
            position INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS reviews (
            word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
            due_at INTEGER NOT NULL,
            stability REAL NOT NULL DEFAULT 0,
            difficulty REAL NOT NULL DEFAULT 0,
            elapsed_days INTEGER NOT NULL DEFAULT 0,
            scheduled_days INTEGER NOT NULL DEFAULT 0,
            reps INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            state INTEGER NOT NULL DEFAULT 0,
            last_review_at INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS review_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
            reviewed_at INTEGER NOT NULL,
            stability_before REAL,
            stability_after REAL,
            difficulty_before REAL,
            difficulty_after REAL,
            elapsed_days INTEGER,
            scheduled_days INTEGER,
            state_before INTEGER,
            state_after INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS dictionary_entries (
             language TEXT NOT NULL DEFAULT 'en',
             lemma TEXT NOT NULL,
            provider TEXT NOT NULL,
            phonetic TEXT,
            audio_url TEXT,
            local_audio_path TEXT,
            definitions_json TEXT NOT NULL,
             fetched_at INTEGER NOT NULL,
             PRIMARY KEY(language, lemma)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS dictionary_sources (
             language TEXT NOT NULL DEFAULT 'en',
             provider TEXT NOT NULL,
            version TEXT,
            source_url TEXT,
            license TEXT,
             imported_at INTEGER NOT NULL,
             PRIMARY KEY(language, provider)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            phonetic TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phrases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
             language TEXT NOT NULL DEFAULT 'en',
             text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unprocessed'
                CHECK(status IN ('unprocessed','learning','known','ignored')),
            definition TEXT,
            source TEXT NOT NULL DEFAULT 'detected'
             CHECK(source IN ('detected','manual')),
             UNIQUE(language, text)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phrase_dictionary_entries (
             language TEXT NOT NULL DEFAULT 'en',
             text TEXT NOT NULL,
            translation TEXT NOT NULL,
            pinyin TEXT,
            usage_zh TEXT,
            category TEXT,
            provider TEXT NOT NULL,
             updated_at INTEGER NOT NULL,
             PRIMARY KEY(language, text)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS file_phrase_analysis (
            file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            completed_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phrase_occurrences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
            segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
            position INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phrase_reviews (
            phrase_id INTEGER PRIMARY KEY REFERENCES phrases(id) ON DELETE CASCADE,
            due_at INTEGER NOT NULL,
            stability REAL NOT NULL DEFAULT 0,
            difficulty REAL NOT NULL DEFAULT 0,
            elapsed_days INTEGER NOT NULL DEFAULT 0,
            scheduled_days INTEGER NOT NULL DEFAULT 0,
            reps INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            state INTEGER NOT NULL DEFAULT 0,
            last_review_at INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS phrase_review_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
            reviewed_at INTEGER NOT NULL,
            stability_before REAL,
            stability_after REAL,
            difficulty_before REAL,
            difficulty_after REAL,
            elapsed_days INTEGER,
            scheduled_days INTEGER,
            state_before INTEGER,
            state_after INTEGER
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_phrase_dictionary (
            text TEXT PRIMARY KEY,
            translation TEXT NOT NULL,
            part_of_speech TEXT,
            category TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_japanese_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_german_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            phonetic TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_chinese_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_chinese_phrase_dictionary (
            text TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            category TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS builtin_japanese_phrase_dictionary (
            text TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            category TEXT
        ) STRICT;
    ",
    )?;

    // Add columns introduced after the initial schema without breaking existing databases.
    let _ = conn.execute(
        "ALTER TABLE files ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE words ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute("ALTER TABLE words ADD COLUMN reading TEXT", []);
    let _ = conn.execute("ALTER TABLE words ADD COLUMN part_of_speech TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE dictionary_entries ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE dictionary_sources ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE phrases ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE phrase_dictionary_entries ADD COLUMN language TEXT NOT NULL DEFAULT 'en'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE phrase_dictionary_entries ADD COLUMN pinyin TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE dictionary_entries ADD COLUMN local_audio_path TEXT",
        [],
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn setup_legacy_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('txt','srt')),
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                imported_at INTEGER NOT NULL,
                language TEXT NOT NULL DEFAULT 'en'
            ) STRICT;
            CREATE TABLE segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                index_num INTEGER NOT NULL,
                en_text TEXT NOT NULL,
                zh_text TEXT,
                start_time TEXT,
                end_time TEXT
            ) STRICT;
            CREATE TABLE words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lemma TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'unprocessed'
                    CHECK(status IN ('unprocessed','learning','known','ignored')),
                definition TEXT,
                language TEXT NOT NULL DEFAULT 'en',
                reading TEXT,
                part_of_speech TEXT
            ) STRICT;
            CREATE TABLE occurrences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
                original_form TEXT NOT NULL,
                position INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE reviews (
                word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
                due_at INTEGER NOT NULL,
                stability REAL NOT NULL DEFAULT 0,
                difficulty REAL NOT NULL DEFAULT 0,
                elapsed_days INTEGER NOT NULL DEFAULT 0,
                scheduled_days INTEGER NOT NULL DEFAULT 0,
                reps INTEGER NOT NULL DEFAULT 0,
                lapses INTEGER NOT NULL DEFAULT 0,
                state INTEGER NOT NULL DEFAULT 0,
                last_review_at INTEGER
            ) STRICT;
            CREATE TABLE phrases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'unprocessed'
                    CHECK(status IN ('unprocessed','learning','known','ignored')),
                definition TEXT,
                source TEXT NOT NULL DEFAULT 'detected'
                    CHECK(source IN ('detected','manual')),
                language TEXT NOT NULL DEFAULT 'en'
            ) STRICT;
            CREATE TABLE phrase_occurrences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
                segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
                position INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE dictionary_entries (
                lemma TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                phonetic TEXT,
                audio_url TEXT,
                definitions_json TEXT NOT NULL,
                fetched_at INTEGER NOT NULL,
                local_audio_path TEXT,
                language TEXT NOT NULL DEFAULT 'en'
            ) STRICT;
            CREATE TABLE dictionary_sources (
                provider TEXT PRIMARY KEY,
                version TEXT,
                source_url TEXT,
                license TEXT,
                imported_at INTEGER NOT NULL,
                language TEXT NOT NULL DEFAULT 'en'
            ) STRICT;
            CREATE TABLE phrase_dictionary_entries (
                text TEXT PRIMARY KEY,
                translation TEXT NOT NULL,
                pinyin TEXT,
                usage_zh TEXT,
                category TEXT,
                provider TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                language TEXT NOT NULL DEFAULT 'en'
            ) STRICT;
            ",
        )
        .unwrap();
        conn
    }

    fn words_sql(conn: &Connection) -> String {
        table_sql(conn, "words").unwrap()
    }

    #[test]
    fn migrates_legacy_words_schema_preserving_data_and_foreign_keys() {
        let conn = setup_legacy_db();

        conn.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["test.srt", "srt", "content", "hash1", 0],
        )
        .unwrap();
        let file_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO segments (file_id, index_num, en_text) VALUES (?1, 0, 'Hello in den')",
            params![file_id],
        )
        .unwrap();
        let seg_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO words (lemma, language, status) VALUES ('in', 'en', 'known')",
            [],
        )
        .unwrap();
        let word_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, ?2, 'in', 1)",
            params![word_id, seg_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO reviews (word_id, due_at) VALUES (?1, 0)",
            params![word_id],
        )
        .unwrap();

        migrate_legacy_constraints(&conn).unwrap();

        assert!(words_sql(&conn).contains("UNIQUE(language, lemma)"));

        let row: (i64, String, String, String) = conn
            .query_row(
                "SELECT id, language, lemma, status FROM words WHERE id = ?1",
                params![word_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(row, (word_id, "en".to_string(), "in".to_string(), "known".to_string()));

        conn.execute(
            "INSERT OR IGNORE INTO words (language, lemma) VALUES ('en', 'in')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO words (language, lemma) VALUES ('de', 'in')",
            [],
        )
        .unwrap();
        let de_id: i64 = conn
            .query_row(
                "SELECT id FROM words WHERE language = 'de' AND lemma = 'in'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(de_id, word_id);

        conn.execute(
            "INSERT OR IGNORE INTO phrases (language, text) VALUES ('en', 'in den')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO phrases (language, text) VALUES ('de', 'in den')",
            [],
        )
        .unwrap();
        let de_phrase_id: i64 = conn
            .query_row(
                "SELECT id FROM phrases WHERE language = 'de' AND text = 'in den'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(de_phrase_id > 0);

        let occ_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM occurrences", [], |row| row.get(0))
            .unwrap();
        assert_eq!(occ_count, 1);
        let review_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |row| row.get(0))
            .unwrap();
        assert_eq!(review_count, 1);
    }

    #[test]
    fn migrates_dictionary_tables_to_composite_primary_keys() {
        let conn = setup_legacy_db();

        conn.execute(
            "INSERT INTO dictionary_entries (lemma, provider, definitions_json, fetched_at, language) VALUES ('in', 'test', '[]', 0, 'en')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dictionary_sources (provider, imported_at, language) VALUES ('test', 0, 'en')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO phrase_dictionary_entries (text, translation, provider, updated_at, language) VALUES ('in den', '在其中', 'test', 0, 'en')",
            [],
        )
        .unwrap();

        migrate_legacy_constraints(&conn).unwrap();

        let de_sql = table_sql(&conn, "dictionary_entries").unwrap();
        assert!(de_sql.contains("PRIMARY KEY(language, lemma)"));
        let ds_sql = table_sql(&conn, "dictionary_sources").unwrap();
        assert!(ds_sql.contains("PRIMARY KEY(language, provider)"));
        let pde_sql = table_sql(&conn, "phrase_dictionary_entries").unwrap();
        assert!(pde_sql.contains("PRIMARY KEY(language, text)"));

        conn.execute(
            "INSERT OR REPLACE INTO dictionary_entries (language, lemma, provider, definitions_json, fetched_at) VALUES ('de', 'in', 'test', '[]', 0)",
            [],
        )
        .unwrap();
        let de_row: (i64, String) = conn
            .query_row(
                "SELECT COUNT(*), MIN(language) FROM dictionary_entries WHERE lemma = 'in'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(de_row.0, 2);
    }

    #[test]
    fn skips_migration_for_current_schema() {
        let conn = Connection::open_in_memory().unwrap();
        create_tables(&conn).unwrap();

        let before = words_sql(&conn);
        migrate_legacy_constraints(&conn).unwrap();
        assert_eq!(words_sql(&conn), before);

        conn.execute(
            "INSERT OR IGNORE INTO words (language, lemma) VALUES ('en', 'in')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO words (language, lemma) VALUES ('de', 'in')",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM words WHERE lemma = 'in'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn autoincrement_continues_after_migration() {
        let conn = setup_legacy_db();

        conn.execute(
            "INSERT INTO words (lemma, language) VALUES ('alpha', 'en')",
            [],
        )
        .unwrap();
        let original_max: i64 = conn
            .query_row("SELECT MAX(id) FROM words", [], |row| row.get(0))
            .unwrap();

        migrate_legacy_constraints(&conn).unwrap();

        conn.execute(
            "INSERT INTO words (lemma, language) VALUES ('beta', 'en')",
            [],
        )
        .unwrap();
        let new_id: i64 = conn
            .query_row("SELECT id FROM words WHERE lemma = 'beta'", [], |row| row.get(0))
            .unwrap();
        assert!(new_id > original_max);
    }
}
