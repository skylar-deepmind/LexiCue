CREATE TABLE IF NOT EXISTS lan_saved_peer (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    pair TEXT NOT NULL, local_replica TEXT NOT NULL, peer_replica TEXT NOT NULL,
    acked INTEGER NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0,
    received INTEGER NOT NULL DEFAULT 0, applying INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    CHECK(local_replica != peer_replica), CHECK(acked <= offered)
) STRICT;

-- Capture the value at the business write, never reconstruct an old event from
-- today's record. Sequence allocation rolls back with the surrounding write.
CREATE TABLE IF NOT EXISTS lan_saved_outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    eid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    parent TEXT, snapshot TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_saved_inbox (
    seq INTEGER PRIMARY KEY, eid TEXT NOT NULL UNIQUE, digest TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_saved_versions (
    entity TEXT NOT NULL, rev TEXT NOT NULL, parent TEXT, depth INTEGER NOT NULL,
    snapshot TEXT NOT NULL, PRIMARY KEY(entity,rev)
) STRICT;
CREATE INDEX IF NOT EXISTS lan_saved_children ON lan_saved_versions(entity,parent);

DROP TRIGGER IF EXISTS lan_saved_new_version;
CREATE TRIGGER lan_saved_new_version AFTER INSERT ON lan_saved_outbox
WHEN json_type(NEW.snapshot,'$.material_op') IS NULL AND NOT EXISTS(SELECT 1 FROM lan_saved_versions WHERE entity=json_extract(NEW.snapshot,'$.record_id') AND rev=json_extract(NEW.snapshot,'$.revision')) BEGIN
    INSERT INTO lan_saved_versions(entity,rev,parent,depth,snapshot)
    VALUES(json_extract(NEW.snapshot,'$.record_id'),json_extract(NEW.snapshot,'$.revision'),NEW.parent,
        CASE WHEN NEW.parent IS NULL THEN 0 ELSE 1 + (SELECT depth FROM lan_saved_versions
            WHERE entity=json_extract(NEW.snapshot,'$.record_id') AND rev=NEW.parent) END, NEW.snapshot);
END;
-- The historical English migration kept whole SQL rows for local restore.
-- Transport only the selected context, personal notes and verified dictionary
-- DTOs. Surrogate IDs, old analysis tables and private metadata stay local.
CREATE VIEW IF NOT EXISTS lan_save_notes AS
SELECT id,record_id,revision,CASE WHEN json_extract(snapshot_json,'$.origin')='reader' THEN snapshot_json
 ELSE json_set(snapshot_json,'$.legacy',json_object('kind',json_extract(snapshot_json,'$.legacy.kind'),'notes',json((
   WITH candidates(meta) AS (
      SELECT json_extract(s.snapshot_json,'$.legacy') UNION ALL SELECT value FROM json_each(s.snapshot_json,'$.legacy.same_position_records') WHERE type='object'
   ), senses(items) AS (
      SELECT json_extract(meta,'$.dictionary.other_senses_json') FROM candidates WHERE json_extract(meta,'$.dictionary.other_senses_edited')=1
      UNION ALL SELECT json_extract(meta,'$.dictionary.other_senses_en_json') FROM candidates WHERE json_extract(meta,'$.dictionary.other_senses_en_edited')=1
   ), extra(item) AS (
      SELECT j.value FROM senses,json_each(CASE WHEN json_valid(items) THEN items ELSE '[]' END) j WHERE j.type='object'
   ), notes(note) AS (
      SELECT json_extract(meta,'$.definition') FROM candidates
      UNION ALL SELECT json_extract(meta,'$.original_personal_note') FROM candidates
      UNION ALL SELECT json_extract(meta,'$.occurrence.meaning_zh') FROM candidates WHERE json_extract(meta,'$.occurrence.meaning_edited')=1
      UNION ALL SELECT json_extract(meta,'$.occurrence.usage_zh') FROM candidates WHERE json_extract(meta,'$.occurrence.meaning_edited')=1
      UNION ALL SELECT json_extract(meta,'$.occurrence.meaning_en') FROM candidates WHERE json_extract(meta,'$.occurrence.meaning_en_edited')=1
      UNION ALL SELECT json_extract(meta,'$.occurrence.usage_en') FROM candidates WHERE json_extract(meta,'$.occurrence.meaning_en_edited')=1
      UNION ALL SELECT j.value FROM candidates,json_each(meta,'$.notes') j WHERE j.type='text'
      UNION ALL SELECT j.value FROM candidates,json_each(meta,'$.lan_notes') j WHERE j.type='text'
      UNION ALL SELECT json_extract(item,'$.meaning_zh') FROM extra
      UNION ALL SELECT json_extract(item,'$.meaning_en') FROM extra
      UNION ALL SELECT json_extract(item,'$.example_en') FROM extra
   ) SELECT json_group_array(DISTINCT note ORDER BY note) FROM notes WHERE typeof(note)='text' AND length(note)>0
 )))) END AS snapshot
FROM saved_records s WHERE json_extract(snapshot_json,'$.origin')='reader'
 OR (json_extract(snapshot_json,'$.origin')='legacy' AND json_extract(snapshot_json,'$.legacy.kind') IN ('word','phrase')
 AND coalesce(json_extract(snapshot_json,'$.legacy.language'),'en')='en'
 AND coalesce(json_extract(snapshot_json,'$.legacy.dictionary.language'),'en')='en');
-- Source identity is immutable. Drop the entire provenance descriptor for a
-- webpage whose URL may carry a credential; never rewrite the URL or its hash.
CREATE VIEW IF NOT EXISTS lan_save_contexts AS SELECT id,record_id,revision,
 CASE WHEN json_extract(snapshot,'$.source.document.origin.kind')='webpage' AND (
    json_extract(snapshot,'$.source.document.origin.submitted_url') GLOB '*[?@#]*' OR
    json_extract(snapshot,'$.source.document.origin.final_url') GLOB '*[?@#]*')
 THEN json_remove(snapshot,'$.source.document') ELSE snapshot END AS snapshot FROM lan_save_notes;
CREATE VIEW IF NOT EXISTS lan_portable_saves AS SELECT id,record_id,revision,CASE WHEN
 substr(trim(json_extract(snapshot,'$.source.file_name')),1,1) IN ('/',char(92)) OR
 trim(json_extract(snapshot,'$.source.file_name')) GLOB '[a-zA-Z]:*' OR
 lower(trim(json_extract(snapshot,'$.source.file_name'))) LIKE 'file:%' OR
 lower(trim(json_extract(snapshot,'$.source.file_name'))) LIKE 'content:%' OR
 trim(json_extract(snapshot,'$.source.file_name')) LIKE '~/%'
 THEN json_set(snapshot,'$.source.file_name','Imported material') ELSE snapshot END AS snapshot FROM lan_save_contexts;
DROP TRIGGER IF EXISTS lan_saved_create;
CREATE TRIGGER lan_saved_create AFTER INSERT ON saved_records WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_saved_outbox(snapshot) SELECT snapshot FROM lan_portable_saves WHERE id=NEW.id;
END;
DROP TRIGGER IF EXISTS lan_saved_change;
CREATE TRIGGER lan_saved_change AFTER UPDATE OF snapshot_json ON saved_records
WHEN (SELECT NOT applying FROM lan_saved_peer) AND OLD.revision<>NEW.revision BEGIN
    INSERT INTO lan_saved_outbox(parent,snapshot) SELECT OLD.revision,snapshot FROM lan_portable_saves WHERE id=NEW.id;
END;

-- Portable replay checkpoint, independent of connection epochs and cumulative ACKs.
-- Keep the first observation order so a parent's revision always precedes a child.
CREATE TABLE IF NOT EXISTS lan_history (
    ordinal INTEGER PRIMARY KEY, eid TEXT UNIQUE NOT NULL, parent TEXT, snapshot TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS lan_archive_local AFTER INSERT ON lan_saved_outbox BEGIN
    INSERT INTO lan_history(eid,parent,snapshot) VALUES(NEW.eid,NEW.parent,NEW.snapshot)
    ON CONFLICT(eid) DO NOTHING;
END;
CREATE TABLE IF NOT EXISTS lan_retired_pairs (pair TEXT PRIMARY KEY) STRICT;
CREATE TABLE IF NOT EXISTS lan_quarantine (kind TEXT NOT NULL, local_id INTEGER NOT NULL, PRIMARY KEY(kind,local_id)) STRICT;

CREATE TABLE IF NOT EXISTS lan_saved_edges (parent TEXT NOT NULL,child TEXT NOT NULL,PRIMARY KEY(parent,child)) STRICT;
CREATE VIEW IF NOT EXISTS lan_saved_heads AS SELECT v.* FROM lan_saved_versions v
 WHERE NOT EXISTS(SELECT 1 FROM lan_saved_versions c WHERE c.entity=v.entity AND c.parent=v.rev)
 AND NOT EXISTS(SELECT 1 FROM lan_saved_edges e WHERE e.parent=v.rev);
