CREATE TABLE IF NOT EXISTS lan_tag_bindings (
    tag TEXT PRIMARY KEY, local_id INTEGER REFERENCES tags(id) ON DELETE SET NULL
) STRICT;
CREATE INDEX IF NOT EXISTS lan_tag_local ON lan_tag_bindings(local_id);
CREATE TABLE IF NOT EXISTS lan_metadata_versions (
    entity TEXT NOT NULL, field TEXT NOT NULL, revision TEXT PRIMARY KEY,
    value TEXT, parents TEXT NOT NULL, generation INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS lan_meta_field ON lan_metadata_versions(entity,field,generation);
CREATE TABLE IF NOT EXISTS lan_metadata_edges (
    child TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY(parent,child)
) STRICT;
CREATE VIEW IF NOT EXISTS lan_meta_heads AS SELECT v.* FROM lan_metadata_versions v
 WHERE NOT EXISTS(SELECT 1 FROM lan_metadata_edges e WHERE e.parent=v.revision);
CREATE VIEW IF NOT EXISTS lan_meta_input AS
 SELECT entity,field,value FROM lan_metadata_versions WHERE 0;
CREATE TRIGGER IF NOT EXISTS lan_meta_local INSTEAD OF INSERT ON lan_meta_input BEGIN
    INSERT INTO lan_metadata_versions(entity,field,value,revision,generation,parents)
    SELECT NEW.entity,NEW.field,NEW.value,lower(hex(randomblob(16))),coalesce(max(generation),0)+1,
      json_group_array(revision ORDER BY revision) FROM lan_meta_heads
      WHERE entity=NEW.entity AND field=NEW.field;
END;
CREATE TRIGGER IF NOT EXISTS lan_meta_edges AFTER INSERT ON lan_metadata_versions BEGIN
    INSERT INTO lan_metadata_edges(child,parent) SELECT NEW.revision,value FROM json_each(NEW.parents);
    INSERT INTO lan_saved_outbox(eid,snapshot)
    SELECT NEW.revision,json_object('material_op','metadata','file',NEW.entity,'field',NEW.field,
       'value',NEW.value,'parents',json(NEW.parents),'generation',NEW.generation)
       WHERE (SELECT NOT applying FROM lan_saved_peer);
END;
CREATE TRIGGER IF NOT EXISTS lan_tag_create AFTER INSERT ON tags
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_tag_bindings(tag,local_id) VALUES(lower(hex(randomblob(16))),NEW.id);
    INSERT INTO lan_meta_input SELECT tag,'name',NEW.name FROM lan_tag_bindings WHERE local_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS lan_tag_rename AFTER UPDATE OF name ON tags
WHEN OLD.name<>NEW.name AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT tag,'name',NEW.name FROM lan_tag_bindings WHERE local_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS lan_tag_tone AFTER UPDATE OF tone ON tags
WHEN OLD.tone IS NOT NEW.tone AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT tag,'tone',NEW.tone FROM lan_tag_bindings WHERE local_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS lan_tag_remove BEFORE DELETE ON tags
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT tag,'deleted',NULL FROM lan_tag_bindings WHERE local_id=OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS lan_member_add AFTER INSERT ON file_tags
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT f.file,'member:'||t.tag,'1'
    FROM lan_material_files f,lan_tag_bindings t WHERE f.local_id=NEW.file_id AND t.local_id=NEW.tag_id;
END;
CREATE TRIGGER IF NOT EXISTS lan_member_remove BEFORE DELETE ON file_tags
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT f.file,'member:'||t.tag,'0'
    FROM lan_material_files f,lan_tag_bindings t WHERE f.local_id=OLD.file_id AND t.local_id=OLD.tag_id;
END;
-- Membership written before the import receipt enters the stream after the material manifest.
CREATE TRIGGER IF NOT EXISTS lan_import_members AFTER INSERT ON lan_saved_outbox
WHEN json_extract(NEW.snapshot,'$.material_op')='create' AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_meta_input SELECT f.file,'member:'||t.tag,'1'
    FROM lan_material_files f JOIN file_tags ft ON ft.file_id=f.local_id
    JOIN lan_tag_bindings t ON t.local_id=ft.tag_id WHERE f.file=json_extract(NEW.snapshot,'$.file');
END;
CREATE VIEW IF NOT EXISTS lan_position_input AS
 SELECT f.file AS entity,i.stable_id AS sentence,p.content_hash,p.revision,p.parent,p.back
 FROM reader_positions p JOIN lan_material_files f ON f.local_id=p.file_id
 JOIN lan_sentence_ids i ON i.local_id=p.segment_id;
CREATE TRIGGER IF NOT EXISTS lan_position_insert AFTER INSERT ON reader_positions
WHEN (SELECT NOT applying FROM lan_saved_peer) BEGIN
    INSERT INTO lan_metadata_versions(entity,field,value,revision,parents,generation)
    SELECT p.entity,'position',json_object('sentence',sentence,'content',content_hash,'back',back),p.revision,
       CASE WHEN prior.revision IS NULL THEN '[]' ELSE json_array(prior.revision) END,coalesce(prior.generation,0)+1
       FROM (SELECT * FROM lan_position_input WHERE revision=NEW.revision) p
       LEFT JOIN lan_metadata_versions prior ON prior.revision=p.parent AND prior.entity=p.entity AND prior.field='position';
END;

-- A still-open reader can author against an old version after a new remote
-- intent arrives. Project the same winning head on the originating device.
CREATE TRIGGER IF NOT EXISTS lan_project_local_position AFTER INSERT ON lan_metadata_versions
WHEN NEW.field='position' AND (SELECT NOT applying FROM lan_saved_peer) BEGIN
    UPDATE reader_positions SET (segment_id,revision,parent,back)=(
       SELECT s.id,w.revision,NULL,json_extract(w.value,'$.back') FROM (
         SELECT * FROM lan_meta_heads WHERE entity=NEW.entity AND field='position'
           AND revision<>NEW.revision AND revision NOT IN(SELECT value FROM json_each(NEW.parents))
         UNION ALL SELECT * FROM lan_metadata_versions WHERE revision=NEW.revision
         ORDER BY generation DESC LIMIT -1
       ) w JOIN lan_material_files m ON m.file=NEW.entity
       JOIN segments s ON s.file_id=m.local_id JOIN lan_sentence_ids i ON i.local_id=s.id
       WHERE i.stable_id=coalesce((SELECT sentence FROM lan_material_aliases WHERE file=NEW.entity AND alias=json_extract(w.value,'$.sentence')),json_extract(w.value,'$.sentence'))
         AND json_extract(w.value,'$.content')=reader_positions.content_hash
       ORDER BY json_extract(w.value,'$.back') DESC,w.generation DESC,w.revision DESC LIMIT 1)
    WHERE revision=NEW.revision;
END;
