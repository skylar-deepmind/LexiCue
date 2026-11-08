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

CREATE TRIGGER IF NOT EXISTS lan_saved_new_version AFTER INSERT ON lan_saved_outbox BEGIN
    INSERT INTO lan_saved_versions(entity,rev,parent,depth,snapshot)
    VALUES(json_extract(NEW.snapshot,'$.record_id'),json_extract(NEW.snapshot,'$.revision'),NEW.parent,
        CASE WHEN NEW.parent IS NULL THEN 0 ELSE 1 + (SELECT depth FROM lan_saved_versions
            WHERE entity=json_extract(NEW.snapshot,'$.record_id') AND rev=NEW.parent) END, NEW.snapshot);
END;
CREATE TRIGGER IF NOT EXISTS lan_saved_create AFTER INSERT ON saved_records
WHEN (SELECT active AND NOT applying FROM lan_saved_peer)
 AND json_extract(NEW.snapshot_json,'$.origin')='reader' BEGIN
    INSERT INTO lan_saved_outbox(snapshot) VALUES(NEW.snapshot_json);
END;
CREATE TRIGGER IF NOT EXISTS lan_saved_change AFTER UPDATE OF snapshot_json ON saved_records
WHEN (SELECT active AND NOT applying FROM lan_saved_peer)
 AND json_extract(NEW.snapshot_json,'$.origin')='reader' AND NEW.snapshot_json != OLD.snapshot_json BEGIN
    INSERT INTO lan_saved_outbox(parent,snapshot) VALUES(OLD.revision,NEW.snapshot_json);
END;
