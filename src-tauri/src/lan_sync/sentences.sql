-- NULL local_id retains the retired identity when a sentence disappears.
-- A future explicit restore must handle its generation in the event log.
CREATE TABLE IF NOT EXISTS lan_sentence_ids (
    stable_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    local_id INTEGER UNIQUE REFERENCES segments(id) ON DELETE SET NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS lan_assign_sentence_id
AFTER INSERT ON segments
WHEN EXISTS (SELECT 1 FROM files WHERE id = NEW.file_id AND language = 'en')
BEGIN
    INSERT INTO lan_sentence_ids(local_id) VALUES (NEW.id);
END;

INSERT INTO lan_sentence_ids(local_id)
SELECT s.id FROM segments AS s JOIN files AS f ON f.id = s.file_id
WHERE f.language = 'en'
  AND NOT EXISTS (SELECT 1 FROM lan_sentence_ids AS i WHERE i.local_id = s.id);
