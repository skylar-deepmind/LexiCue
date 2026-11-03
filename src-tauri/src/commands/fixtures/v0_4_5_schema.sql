-- v0.4.5 fc47ce5a590ca5453c0c73dc7f2b5834cfa3ab7c
-- Table DDL extracted from db.rs/tags.rs, including its column migrations.
-- Synthetic data; no user database. Sync triggers/state intentionally absent.
CREATE TABLE annotation_actions (
            operation_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            undone INTEGER NOT NULL DEFAULT 0
        ) STRICT;

CREATE TABLE builtin_chinese_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

CREATE TABLE builtin_chinese_phrase_dictionary (
            text TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            category TEXT
        ) STRICT;

CREATE TABLE builtin_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            phonetic TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

CREATE TABLE builtin_german_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            phonetic TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

CREATE TABLE builtin_japanese_dictionary_entries (
            lemma TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            part_of_speech TEXT
        ) STRICT;

CREATE TABLE builtin_japanese_phrase_dictionary (
            text TEXT PRIMARY KEY,
            reading TEXT,
            translation TEXT NOT NULL,
            category TEXT
        ) STRICT;

CREATE TABLE builtin_phrase_dictionary (
            text TEXT PRIMARY KEY,
            translation TEXT NOT NULL,
            part_of_speech TEXT,
            category TEXT
        ) STRICT;

CREATE TABLE dictionary_entries (
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

CREATE TABLE dictionary_sources (
             language TEXT NOT NULL DEFAULT 'en',
             provider TEXT NOT NULL,
            version TEXT,
            source_url TEXT,
            license TEXT,
             imported_at INTEGER NOT NULL,
             PRIMARY KEY(language, provider)
        ) STRICT;

CREATE TABLE file_phrase_analysis (
            file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            completed_at INTEGER NOT NULL,
            pipeline_version INTEGER NOT NULL DEFAULT 1,
            collins_evidence_available INTEGER NOT NULL DEFAULT 0,
            skipped_items INTEGER NOT NULL DEFAULT 0
        ) STRICT;

CREATE TABLE file_tag_state (
        file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE
    ) STRICT;

CREATE TABLE file_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        UNIQUE(file_id,tag_id)
    ) STRICT;

CREATE TABLE files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('txt','srt')),
             content TEXT NOT NULL,
             content_hash TEXT NOT NULL,
             imported_at INTEGER NOT NULL,
             language TEXT NOT NULL DEFAULT 'en',
             folder_id INTEGER
        ) STRICT;

CREATE TABLE folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER,
            created_at INTEGER NOT NULL
        ) STRICT;

CREATE TABLE frequency_baseline_daily_checks (
            language TEXT NOT NULL,
            checked_on TEXT NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY(language, checked_on)
        ) STRICT;

CREATE TABLE frequency_baseline_marks (
            word_id INTEGER PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
            language TEXT NOT NULL,
            tier INTEGER NOT NULL,
            pack_id TEXT NOT NULL,
            pack_version TEXT NOT NULL,
            verification TEXT NOT NULL CHECK(verification IN ('pending','confirmed','corrected')),
            marked_at INTEGER NOT NULL,
            last_sampled_day TEXT
        ) STRICT;

CREATE TABLE frequency_baseline_profiles (
            language TEXT PRIMARY KEY,
            tier INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        ) STRICT;

CREATE TABLE legacy_tag_folders (
        folder_id INTEGER PRIMARY KEY,
        tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
    ) STRICT;

CREATE TABLE occurrences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
            original_form TEXT NOT NULL,
            position INTEGER NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            meaning_zh TEXT,
            usage_zh TEXT,
            collins_sense_id INTEGER,
            meaning_edited INTEGER NOT NULL DEFAULT 0,
            analysis_model TEXT,
            analyzed_at INTEGER
        ) STRICT;

CREATE TABLE online_dictionary_entries (
            language TEXT NOT NULL,
            lemma TEXT NOT NULL,
            provider TEXT NOT NULL,
            phonetic TEXT,
            audio_url TEXT,
            local_audio_path TEXT,
            definitions_json TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY(language, lemma)
        ) STRICT;

CREATE TABLE phrase_dictionary_entries (
             language TEXT NOT NULL DEFAULT 'en',
             text TEXT NOT NULL,
            translation TEXT NOT NULL,
            pinyin TEXT,
            usage_zh TEXT,
            category TEXT,
            provider TEXT NOT NULL,
             updated_at INTEGER NOT NULL,
             other_senses_json TEXT NOT NULL DEFAULT '[]',
             other_senses_edited INTEGER NOT NULL DEFAULT 0,
             meaning_en TEXT,
             usage_en TEXT,
             other_senses_en_json TEXT NOT NULL DEFAULT '[]',
             other_senses_en_edited INTEGER NOT NULL DEFAULT 0, expression_meta_json TEXT,
             PRIMARY KEY(language, text)
        ) STRICT;

CREATE TABLE phrase_occurrences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phrase_id INTEGER NOT NULL REFERENCES phrases(id) ON DELETE CASCADE,
            segment_id INTEGER NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            hidden INTEGER NOT NULL DEFAULT 0,
            surface_text TEXT,
            token_positions_json TEXT,
            meaning_zh TEXT,
            usage_zh TEXT,
            meaning_edited INTEGER NOT NULL DEFAULT 0,
            meaning_en TEXT,
            usage_en TEXT,
            meaning_en_edited INTEGER NOT NULL DEFAULT 0,
            collins_sense_id INTEGER
        , expression_meta_json TEXT) STRICT;

CREATE TABLE phrase_review_logs (
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
            state_after INTEGER,
            due_at_after INTEGER
        ) STRICT;

CREATE TABLE phrase_reviews (
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

CREATE TABLE phrases (
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
            state_after INTEGER,
            due_at_after INTEGER
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

CREATE TABLE segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            index_num INTEGER NOT NULL,
            en_text TEXT NOT NULL,
            zh_text TEXT,
            start_time TEXT,
            end_time TEXT
        ) STRICT;

CREATE TABLE sync_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;

CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    ) STRICT;

CREATE TABLE word_aliases (
            word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            alias_kind TEXT NOT NULL DEFAULT 'surface',
            PRIMARY KEY(word_id, alias)
        ) STRICT;

CREATE TABLE words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
             language TEXT NOT NULL DEFAULT 'en',
             lemma TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unprocessed'
                CHECK(status IN ('unprocessed','learning','known','ignored')),
             definition TEXT,
             reading TEXT,
             part_of_speech TEXT,
             word_kind TEXT NOT NULL DEFAULT 'common'
                CHECK(word_kind IN ('common','proper_noun','noise','ambiguous')),
             kind_edited INTEGER NOT NULL DEFAULT 0,
             UNIQUE(language, lemma)
        ) STRICT;
