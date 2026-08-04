#[cfg(test)]
mod tests {
    use rusqlite::{params, Connection};

    fn setup_test_db() -> Connection {
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
                imported_at INTEGER NOT NULL
            ) STRICT;
            CREATE TABLE words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lemma TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'unprocessed',
                definition TEXT
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
            CREATE TABLE review_logs (
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
        ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_foreign_key_cascade() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["test.srt", "srt", "content", "hash123", 0],
        ).unwrap();
        let file_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO segments (file_id, index_num, en_text) VALUES (?1, 0, 'Hello')",
            params![file_id],
        )
        .unwrap();
        let seg_id = conn.last_insert_rowid();

        conn.execute("INSERT INTO words (lemma) VALUES ('hello')", [])
            .unwrap();
        let word_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO occurrences (word_id, segment_id, original_form, position) VALUES (?1, ?2, 'Hello', 0)",
            params![word_id, seg_id],
        ).unwrap();

        conn.execute("DELETE FROM files WHERE id = ?1", params![file_id])
            .unwrap();

        let seg_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM segments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(seg_count, 0);

        let occ_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM occurrences", [], |row| row.get(0))
            .unwrap();
        assert_eq!(occ_count, 0);
    }

    #[test]
    fn test_insert_or_ignore_words() {
        let conn = setup_test_db();

        conn.execute("INSERT OR IGNORE INTO words (lemma) VALUES ('go')", [])
            .unwrap();
        conn.execute("INSERT OR IGNORE INTO words (lemma) VALUES ('go')", [])
            .unwrap();
        conn.execute("INSERT OR IGNORE INTO words (lemma) VALUES ('study')", [])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM words", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_rollback_on_error() {
        let conn = setup_test_db();

        conn.execute("BEGIN IMMEDIATE", []).unwrap();

        conn.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["test.txt", "txt", "content", "hash1", 0],
        ).unwrap();

        let result = conn.execute(
            "INSERT INTO files (name, type, content, content_hash, imported_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["bad.pdf", "pdf", "content", "hash2", 0],
        );

        assert!(result.is_err());

        conn.execute("ROLLBACK", []).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0, "All inserts should have been rolled back");
    }

    #[test]
    fn test_restore_foreign_key_check() {
        let conn = setup_test_db();

        conn.execute("BEGIN IMMEDIATE", []).unwrap();

        conn.execute("INSERT INTO words (lemma) VALUES ('test')", [])
            .unwrap();

        let result = conn.execute(
            "INSERT INTO segments (file_id, index_num, en_text) VALUES (?1, 0, 'test')",
            params![999],
        );

        assert!(result.is_err());

        let _ = conn.execute("ROLLBACK", []);

        let word_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM words", [], |row| row.get(0))
            .unwrap();
        assert_eq!(word_count, 0);
    }
}
