use super::*;
use serde_json::Value;

// Accept only the migration's frozen source and monotonic collection of
// historical notes. Normal user edits and restores have their own rules.
pub(super) fn legacy_note_merge(
    db: &Connection,
    entity: &str,
    parent: &str,
    next: &str,
) -> Result<bool> {
    let previous: String = db
        .query_row(
            "SELECT snapshot FROM lan_saved_versions WHERE entity=? AND rev=?",
            params![entity, parent],
            |r| r.get(0),
        )
        .map_err(err)?;
    let mut previous: Value = serde_json::from_str(&previous).map_err(err)?;
    let mut next: Value = serde_json::from_str(next).map_err(err)?;
    let (Some(old), Some(new)) = (previous.as_object_mut(), next.as_object_mut()) else {
        return Ok(false);
    };
    if old.get("origin").and_then(Value::as_str) != Some("legacy")
        || old.get("legacy").and_then(|v| v.get("kind"))
            != new.get("legacy").and_then(|v| v.get("kind"))
    {
        return Ok(false);
    }
    let (Some(old_notes), Some(new_notes)) = (
        old.get("legacy")
            .and_then(|v| v.get("notes"))
            .and_then(Value::as_array),
        new.get("legacy")
            .and_then(|v| v.get("notes"))
            .and_then(Value::as_array),
    ) else {
        return Ok(false);
    };
    if !old_notes.iter().all(|n| new_notes.contains(n)) {
        return Ok(false);
    }
    if old["explanation_source"] != "personal" && new["explanation_source"] == "personal" {
        old.insert(
            "explanation_source".into(),
            new["explanation_source"].clone(),
        );
        old.insert(
            "explanation".into(),
            new.get("explanation").cloned().unwrap_or(Value::Null),
        );
    }
    for key in ["revision", "generation", "legacy"] {
        old.remove(key);
        new.remove(key);
    }
    Ok(old == new)
}

// An older legacy merge increment is not an explicit recovery from a deletion.
// Count only those increments on this lineage. Ordinary reader saves never
// need a history walk, and v5 wire snapshots retain their exact original bytes.
pub(super) fn winner(db: &Connection, entity: &str) -> Result<String> {
    db.query_row("SELECT h.snapshot FROM lan_saved_heads h WHERE h.entity=?1 ORDER BY
        json_extract(h.snapshot,'$.generation') -
        CASE WHEN json_extract(h.snapshot,'$.origin')='legacy' THEN (
          WITH RECURSIVE lineage(rev,parent) AS (
            SELECT h.rev,h.parent UNION ALL SELECT v.rev,v.parent FROM lineage l
            JOIN lan_saved_versions v ON v.entity=?1 AND v.rev=l.parent)
          SELECT count(*) FROM lineage l JOIN lan_saved_versions c ON c.entity=?1 AND c.rev=l.rev
          JOIN lan_saved_versions p ON p.entity=?1 AND p.rev=l.parent
          WHERE json_extract(c.snapshot,'$.generation')>json_extract(p.snapshot,'$.generation')
            AND json_extract(c.snapshot,'$.deleted_at') IS NULL AND json_extract(p.snapshot,'$.deleted_at') IS NULL
            AND NOT EXISTS (SELECT 1 FROM lan_saved_edges e WHERE e.child=l.rev)
        ) ELSE 0 END DESC,
        (json_extract(h.snapshot,'$.deleted_at') IS NOT NULL) DESC,
        (json_extract(h.snapshot,'$.explanation_source')='personal') DESC,h.depth DESC,h.rev DESC LIMIT 1",
        [entity],|r|r.get(0)).map_err(err)
}
