-- Stable file and sentence identities are different from SQLite row IDs.
CREATE TABLE IF NOT EXISTS lan_material_files (
    file TEXT PRIMARY KEY, local_id INTEGER UNIQUE REFERENCES files(id) ON DELETE SET NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_material_blobs (
    id INTEGER PRIMARY KEY, event TEXT UNIQUE NOT NULL, data BLOB NOT NULL, digest TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS lan_material_stage (
    id INTEGER PRIMARY KEY CHECK(id=1), event TEXT NOT NULL, digest TEXT NOT NULL,
    bytes INTEGER NOT NULL, filled INTEGER NOT NULL, data BLOB NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_material_aliases (
    file TEXT NOT NULL, alias TEXT NOT NULL, sentence TEXT NOT NULL, PRIMARY KEY(file,alias)
) STRICT;
CREATE TABLE IF NOT EXISTS lan_material_basis (
    local_id INTEGER PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE, revision TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS lan_material_values (
    file TEXT NOT NULL, field TEXT NOT NULL, revision TEXT NOT NULL,
    generation INTEGER NOT NULL, value TEXT, basis TEXT NOT NULL DEFAULT '', automatic INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(file,field,revision)
) STRICT;
CREATE INDEX IF NOT EXISTS lan_material_value_order ON lan_material_values(file,field,generation DESC);
CREATE TABLE IF NOT EXISTS lan_material_capture (
    local_id INTEGER PRIMARY KEY, event TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
) STRICT;

-- Names are display strings. A legacy absolute path or local URI must never
-- leave the exporting device, including in a later rename.
CREATE VIEW IF NOT EXISTS lan_material_titles AS SELECT id,
    CASE WHEN substr(trim(name),1,1) IN ('/',char(92)) OR trim(name) GLOB '[a-zA-Z]:*'
        OR lower(trim(name)) LIKE 'file:%' OR lower(trim(name)) LIKE 'content:%'
        OR trim(name) LIKE '~/%' THEN 'Imported material.'||type ELSE name END AS title
    FROM files;
-- A normal reading import writes its receipt after the last sentence. This same
-- trigger is used to backfill already imported materials at the opt-in boundary.
CREATE TRIGGER IF NOT EXISTS lan_material_snapshot AFTER INSERT ON lan_material_capture
WHEN NOT EXISTS(SELECT 1 FROM lan_quarantine WHERE kind IN ('files','files-local') AND local_id=NEW.local_id) BEGIN
    INSERT INTO lan_material_files(file,local_id)
    SELECT stable,NEW.local_id FROM reader_material_ids WHERE file_id=NEW.local_id;
    SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'missing material identity') END;
    INSERT INTO lan_material_blobs(event,data)
    SELECT NEW.event,cast(json_object('title',(SELECT title FROM lan_material_titles WHERE id=f.id),'kind',f.type,'body',f.content,
      'imported_at',f.imported_at,'source',json(CASE WHEN f.media_source IS NOT NULL OR (f.document_source IS NOT NULL AND NOT (
          coalesce(json_extract(f.document_source,'$.origin.kind'),'')='webpage' AND (
            json_extract(f.document_source,'$.origin.submitted_url') GLOB '*[?@#]*' OR
            json_extract(f.document_source,'$.origin.final_url') GLOB '*[?@#]*'))) THEN json_object(
          'media_source',f.media_source,'media_identity',f.media_identity,
          'document_source',CASE WHEN f.document_source IS NOT NULL THEN ''||json_set(f.document_source,'$.warnings',json('[]')) END,
          'document_identity',f.document_identity) END),'sentences',json((SELECT json_group_array(json_array(
          (SELECT stable_id FROM lan_sentence_ids WHERE local_id=s.id),s.index_num,
          s.en_text,s.zh_text,s.start_time,s.end_time) ORDER BY s.index_num,s.id)
        FROM segments s WHERE s.file_id=f.id))) AS blob)
    FROM files f WHERE f.id=NEW.local_id;
    INSERT INTO lan_saved_outbox(eid,snapshot)
    SELECT NEW.event,json_object('material_op','create','file',m.file,'bytes',length(b.data),'sha256','')
    FROM lan_material_files m JOIN lan_material_blobs b ON b.event=NEW.event WHERE m.local_id=NEW.local_id;
END;
CREATE TRIGGER IF NOT EXISTS lan_material_import AFTER INSERT ON material_import_actions
WHEN (SELECT NOT applying FROM lan_saved_peer)
  AND EXISTS(SELECT 1 FROM files WHERE id=NEW.file_id AND language='en')
  AND NOT EXISTS(SELECT 1 FROM lan_material_files WHERE local_id=NEW.file_id)
BEGIN
    INSERT INTO lan_material_capture(local_id) VALUES(NEW.file_id);
END;

-- Keep the previous field versions on both replicas. A deterministic tie break
-- selects a visible concurrent edit; all competing values remain recoverable.
CREATE UNIQUE INDEX IF NOT EXISTS lan_material_revisions ON lan_material_values(revision);
CREATE TABLE IF NOT EXISTS lan_field_edges (parent TEXT NOT NULL, child TEXT NOT NULL,PRIMARY KEY(parent,child)) STRICT;
CREATE TRIGGER IF NOT EXISTS lan_observe_field BEFORE INSERT ON lan_material_values
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_field_edges(parent,child)
    SELECT revision,NEW.revision FROM lan_material_values v
    WHERE file=NEW.file AND field=NEW.field AND basis=NEW.basis
      AND (automatic=NEW.automatic OR NEW.automatic=0)
      AND NOT EXISTS(SELECT 1 FROM lan_field_edges e WHERE e.parent=v.revision);
END;
DROP VIEW IF EXISTS lan_material_field_json;
CREATE VIEW lan_material_field_json AS SELECT revision,json_object(
    'material_op','field','file',file,'field',field,'revision',revision,
    'generation',generation,'value',value,'basis',basis,'automatic',automatic,'parents',json((SELECT json_group_array(parent ORDER BY parent) FROM lan_field_edges e WHERE e.child=v.revision))) AS value_json FROM lan_material_values v;
CREATE TRIGGER IF NOT EXISTS lan_material_publish_field AFTER INSERT ON lan_material_values
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_material_blobs(event,data)
    SELECT NEW.revision,cast(value_json AS blob) FROM lan_material_field_json WHERE revision=NEW.revision AND length(cast(value_json AS blob))>16384;
    INSERT INTO lan_saved_outbox(eid,snapshot)
    SELECT NEW.revision,coalesce((SELECT json_object('material_op','large','file',NEW.file,'bytes',length(data),'sha256','')
       FROM lan_material_blobs WHERE event=NEW.revision),value_json) FROM lan_material_field_json WHERE revision=NEW.revision;
END;
CREATE TRIGGER IF NOT EXISTS lan_material_translation AFTER UPDATE OF zh_text ON segments
WHEN NEW.zh_text IS NOT OLD.zh_text AND (SELECT NOT applying FROM lan_saved_peer)
BEGIN
    INSERT INTO lan_material_values(file,field,revision,generation,value,automatic,basis)
    SELECT m.file,i.stable_id,lower(hex(randomblob(16))),1+coalesce((
        SELECT max(generation) FROM lan_material_values WHERE file=m.file AND field=i.stable_id),0),
        NEW.zh_text,coalesce((SELECT value='1' FROM sync_runtime WHERE key='lan_auto_translation'),0),
        coalesce((SELECT revision FROM lan_material_basis WHERE local_id=NEW.id),'')
    FROM lan_material_files m JOIN lan_sentence_ids i ON i.local_id=NEW.id WHERE m.local_id=NEW.file_id;
END;
CREATE TRIGGER IF NOT EXISTS lan_material_title AFTER UPDATE OF name ON files
WHEN NEW.name<>OLD.name AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_material_values(file,field,revision,generation,value)
    SELECT file,'title',lower(hex(randomblob(16))),1+coalesce((
        SELECT max(generation) FROM lan_material_values WHERE file=m.file AND field='title'),0),(SELECT title FROM lan_material_titles WHERE id=NEW.id)
    FROM lan_material_files m WHERE local_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS lan_material_delete BEFORE DELETE ON files
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_saved_outbox(snapshot)
    SELECT json_object('material_op','delete','file',file,'seen',(SELECT received FROM lan_saved_peer),'epoch',(SELECT pair FROM lan_saved_peer)) FROM lan_material_files WHERE local_id=OLD.id;
    DELETE FROM lan_material_capture WHERE local_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS lan_material_body AFTER UPDATE OF content ON files
WHEN NEW.content<>OLD.content AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_material_values(file,field,revision,generation,value)
    SELECT file,'body',lower(hex(randomblob(16))),1+coalesce((
        SELECT max(generation) FROM lan_material_values WHERE file=m.file AND field='body'),0),NEW.content
    FROM lan_material_files m WHERE local_id=NEW.id;
END;
-- An English revision has its own translation candidates, independent of a timing edit.
CREATE TRIGGER IF NOT EXISTS lan_material_new_basis BEFORE UPDATE OF en_text ON segments
WHEN NEW.en_text<>OLD.en_text AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT OR REPLACE INTO lan_material_basis(local_id,revision) VALUES(NEW.id,lower(hex(randomblob(16))));
END;
CREATE TRIGGER IF NOT EXISTS lan_material_keep_clear BEFORE UPDATE OF zh_text ON segments
WHEN (SELECT NOT applying FROM lan_saved_peer)
 AND (SELECT value FROM sync_runtime WHERE key='lan_auto_translation')='1'
 AND EXISTS(SELECT 1 FROM lan_material_values v JOIN lan_sentence_ids i ON i.stable_id=v.field
     WHERE i.local_id=NEW.id AND v.automatic=0 AND v.generation>0
       AND v.basis=coalesce((SELECT revision FROM lan_material_basis WHERE local_id=NEW.id),''))
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER IF NOT EXISTS lan_material_cue AFTER UPDATE OF en_text,index_num,start_time,end_time ON segments
WHEN (NEW.en_text,NEW.index_num,NEW.start_time,NEW.end_time) IS NOT (OLD.en_text,OLD.index_num,OLD.start_time,OLD.end_time)
 AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_material_values(file,field,revision,generation,value,basis)
    SELECT m.file,'cue:'||i.stable_id,lower(hex(randomblob(16))),1+coalesce((
        SELECT max(generation) FROM lan_material_values WHERE file=m.file AND field='cue:'||i.stable_id),0),
        json_array(NEW.index_num,NEW.en_text,NEW.start_time,NEW.end_time),
        coalesce((SELECT revision FROM lan_material_basis WHERE local_id=NEW.id),'')
    FROM lan_material_files m JOIN lan_sentence_ids i ON i.local_id=NEW.id WHERE m.local_id=NEW.file_id;
    -- Clear the former English revision's translation when an editor changes
    -- only the original. Receivers derive the same result from the cue event.
    UPDATE lan_saved_peer SET applying=1;
    UPDATE segments SET zh_text=NULL WHERE id=NEW.id AND NEW.en_text<>OLD.en_text
        AND NEW.zh_text IS OLD.zh_text AND NEW.zh_text IS NOT NULL;
    UPDATE lan_saved_peer SET applying=0;
END;

CREATE TABLE IF NOT EXISTS lan_recoverable_edits (
    file TEXT NOT NULL, revision TEXT PRIMARY KEY, done INTEGER NOT NULL DEFAULT 0
) STRICT;

-- An already imported SRT may gain a verified YouTube descriptor later.
-- The import transaction captures only that descriptor, never the audio or
-- the complete material. Big caption manifests use the normal chunk channel.
CREATE TRIGGER IF NOT EXISTS lan_capture_media_attachment AFTER UPDATE OF media_source ON files
WHEN NEW.media_source IS NOT NULL AND NEW.media_identity IS NOT NULL AND NEW.document_identity IS NULL
 AND (SELECT NOT applying FROM lan_saved_peer) AND EXISTS (SELECT 1 FROM lan_material_files WHERE local_id=NEW.id)
BEGIN
    INSERT INTO lan_material_blobs(event,data)
    SELECT lower(hex(randomblob(16))),cast(json_object('material_op','attach','file',file,'source',
       json_object('media_source',NEW.media_source,'media_identity',NEW.media_identity)) AS blob)
    FROM lan_material_files WHERE local_id=NEW.id;
    INSERT INTO lan_saved_outbox(eid,snapshot) SELECT event,json_object('material_op','large','file',m.file,'bytes',length(b.data),'sha256','')
    FROM lan_material_blobs b JOIN lan_material_files m ON m.local_id=NEW.id WHERE b.id=last_insert_rowid();
END;
