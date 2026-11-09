//! Tag properties and reading intents carry the exact revisions the editor observed.
use super::*;
const TONES: &[&str] = &["blue", "green", "pink", "purple", "amber", "slate"];

pub(crate) fn install(db: &Connection) -> Result<()> {
    db.execute_batch(include_str!("metadata.sql"))
        .map_err(err)?;
    db.execute_batch("INSERT INTO lan_tag_bindings(tag,local_id)
        SELECT s.sync_id,t.id FROM tags t JOIN sync_entity_state s ON s.table_name='tags' AND s.local_id=t.id
        WHERE NOT EXISTS(SELECT 1 FROM lan_tag_bindings WHERE local_id=t.id) AND NOT EXISTS(SELECT 1 FROM lan_quarantine q WHERE q.kind IN('tags','tags-local') AND q.local_id=t.id);
        INSERT INTO lan_meta_input SELECT tag,'name',name FROM lan_tag_bindings b JOIN tags t ON t.id=b.local_id
        WHERE NOT EXISTS(SELECT 1 FROM lan_metadata_versions WHERE entity=b.tag AND field='name');
        INSERT INTO lan_meta_input SELECT tag,'tone',tone FROM lan_tag_bindings b JOIN tags t ON t.id=b.local_id
        WHERE tone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lan_metadata_versions WHERE entity=b.tag AND field='tone');
        INSERT INTO lan_meta_input SELECT f.file,'member:'||b.tag,'1' FROM file_tags ft
        JOIN lan_tag_bindings b ON b.local_id=ft.tag_id JOIN lan_material_files f ON f.local_id=ft.file_id
        WHERE NOT EXISTS(SELECT 1 FROM lan_metadata_versions WHERE entity=f.file AND field='member:'||b.tag);
        INSERT INTO lan_metadata_versions(entity,field,value,revision,parents,generation)
        SELECT entity,'position',json_object('sentence',sentence,'content',content_hash,'back',back),revision,'[]',1
        FROM lan_position_input p WHERE NOT EXISTS(SELECT 1 FROM lan_metadata_versions WHERE revision=p.revision);").map_err(err)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Position {
    sentence: String,
    content: String,
    back: i64,
}

pub(crate) fn validate(
    field: &str,
    value: Option<&str>,
    generation: i64,
    parents: &[String],
) -> Result<()> {
    let valid = match field {
        "name" => value.is_some_and(|s| !s.trim().is_empty() && s.len() <= 16 * 1024),
        "tone" => value.is_none_or(|s| TONES.contains(&s)),
        "deleted" => value.is_none(),
        "position" => value
            .and_then(|s| serde_json::from_str::<Position>(s).ok())
            .is_some_and(|p| {
                material::id(&p.sentence)
                    && !p.content.is_empty()
                    && p.content.len() <= 128
                    && matches!(p.back, 0 | 1)
            }),
        field if field.starts_with("member:") => {
            field.len() <= 167 && !field[7..].is_empty() && matches!(value, Some("0" | "1"))
        }
        _ => false,
    };
    if !valid || generation <= 0 || parents.len() > 64 || parents.iter().any(|r| !material::id(r)) {
        return Err("invalid library metadata".into());
    }
    Ok(())
}

fn bound(db: &Connection, table: &str, key: &str, entity: &str) -> Result<Option<i64>> {
    db.query_row(
        &format!("SELECT local_id FROM {table} WHERE {key}=?"),
        [entity],
        |r| r.get(0),
    )
    .optional()
    .map(Option::flatten)
    .map_err(err)
}

pub(crate) fn apply(
    db: &Connection,
    entity: &str,
    field: &str,
    value: Option<&str>,
    revision: &str,
    parents: &[String],
    generation: i64,
) -> Result<()> {
    validate(field, value, generation, parents)?;
    let encoded = serde_json::to_string(parents).map_err(err)?;
    let known:Option<bool>=db.query_row("SELECT entity=?1 AND field=?2 AND value IS ?3 AND parents=?4 AND generation=?5 FROM lan_metadata_versions WHERE revision=?6",params![entity,field,value,encoded,generation,revision],|r|r.get(0)).optional().map_err(err)?;
    if let Some(matches) = known {
        return if matches {
            Ok(())
        } else {
            Err("metadata revision fork".into())
        };
    }
    let (count,depth):(usize,i64)=db.query_row("SELECT count(*),coalesce(max(generation),0) FROM lan_metadata_versions WHERE entity=? AND field=? AND revision IN (SELECT value FROM json_each(?))",params![entity,field,encoded],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if count != parents.len() || depth.checked_add(1) != Some(generation) {
        return Err("missing metadata parent revision".into());
    }
    db.execute("INSERT INTO lan_metadata_versions(entity,field,value,revision,parents,generation) VALUES(?,?,?,?,?,?)",params![entity,field,value,revision,encoded,generation]).map_err(err)?;
    project(db, entity, field)
}

fn project(db: &Connection, entity: &str, field: &str) -> Result<()> {
    let (value,revision):(Option<String>,String)=db.query_row("SELECT value,revision FROM lan_meta_heads WHERE entity=? AND field=? ORDER BY
        CASE WHEN field LIKE 'member:%' THEN value='1' WHEN field='position' THEN json_extract(value,'$.back') ELSE 0 END DESC,
        generation DESC,revision DESC LIMIT 1",params![entity,field],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    let tag_id = || bound(db, "lan_tag_bindings", "tag", entity);
    match field {
        "name" => {
            let deleted:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM lan_metadata_versions WHERE entity=? AND field='deleted')",[entity],|r|r.get(0)).map_err(err)?;
            if deleted {
                return Ok(());
            }
            let name = value.ok_or("missing tag name")?;
            let key = name.trim().to_lowercase();
            let current = tag_id()?;
            let existing: Option<i64> = db
                .query_row("SELECT id FROM tags WHERE name_key=?", [&key], |r| r.get(0))
                .optional()
                .map_err(err)?;
            match (current, existing) {
                (None, Some(id)) => {
                    db.execute(
                        "INSERT INTO lan_tag_bindings(tag,local_id) VALUES(?,?)",
                        params![entity, id],
                    )
                    .map_err(err)?;
                }
                (None, None) => {
                    db.execute(
                        "INSERT INTO tags(name,name_key,created_at) VALUES(?,?,0)",
                        params![name, key],
                    )
                    .map_err(err)?;
                    let id = db.last_insert_rowid();
                    db.execute(
                        "INSERT INTO lan_tag_bindings(tag,local_id) VALUES(?,?)",
                        params![entity, id],
                    )
                    .map_err(err)?;
                    db.execute("INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at) VALUES('tags',?,?,0)",params![id,entity]).map_err(err)?;
                }
                (Some(id), other) if other.is_none_or(|v| v == id) => {
                    db.execute(
                        "UPDATE tags SET name=?,name_key=? WHERE id=?",
                        params![name, key, id],
                    )
                    .map_err(err)?;
                }
                (Some(id), Some(other)) => {
                    // A rename collision is not evidence that two independently
                    // edited tags are one entity. Keep both sets of relationships.
                    let other_key: String = db
                        .query_row(
                            "SELECT min(tag) FROM lan_tag_bindings WHERE local_id=?",
                            [other],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    let ours: String = db
                        .query_row(
                            "SELECT min(tag) FROM lan_tag_bindings WHERE local_id=?",
                            [id],
                            |r| r.get(0),
                        )
                        .map_err(err)?;
                    let (displaced, suffix) = if ours < other_key {
                        (other, other_key.as_str())
                    } else {
                        (id, ours.as_str())
                    };
                    let display = format!("{name} · {suffix}");
                    db.execute(
                        "UPDATE tags SET name=?,name_key=? WHERE id=?",
                        params![display, display.to_lowercase(), displaced],
                    )
                    .map_err(err)?;
                    if displaced == other {
                        db.execute(
                            "UPDATE tags SET name=?,name_key=? WHERE id=?",
                            params![name, key, id],
                        )
                        .map_err(err)?;
                    }
                }
                _ => unreachable!(),
            }
            if let Some(id) = tag_id()? {
                // Same-name independent creations can have different casing and
                // pre-existing colors. Select properties across all bound aliases.
                let (actual, key): (String, String) = db
                    .query_row("SELECT name,name_key FROM tags WHERE id=?", [id], |r| {
                        Ok((r.get(0)?, r.get(1)?))
                    })
                    .map_err(err)?;
                let canonical:Option<String>=db.query_row("SELECT h.value FROM lan_tag_bindings b JOIN lan_meta_heads h ON h.entity=b.tag AND h.field='name'
                   WHERE b.local_id=? ORDER BY h.generation DESC,h.revision DESC LIMIT 1",[id],|r|r.get(0)).optional().map_err(err)?;
                if let Some(candidate) =
                    canonical.filter(|n| n != &actual && n.trim().to_lowercase() == key)
                {
                    db.execute("UPDATE tags SET name=? WHERE id=?", params![candidate, id])
                        .map_err(err)?;
                }
                project_tone(db, id)?;
            }
        }
        "tone" => {
            if let Some(id) = tag_id()? {
                project_tone(db, id)?;
            }
        }
        "deleted" => {
            if let Some(id) = tag_id()? {
                db.execute(
                    "UPDATE lan_tag_bindings SET local_id=NULL WHERE tag=?",
                    [entity],
                )
                .map_err(err)?;
                db.execute("DELETE FROM tags WHERE id=? AND NOT EXISTS(SELECT 1 FROM lan_tag_bindings WHERE local_id=tags.id)",[id]).map_err(err)?;
            }
        }
        "position" => {
            let pos: Position =
                serde_json::from_str(value.as_deref().ok_or("missing reading position")?)
                    .map_err(err)?;
            db.execute("INSERT OR REPLACE INTO reader_positions(file_id,segment_id,content_hash,revision,parent,back)
               SELECT f.id,s.id,?, ?,NULL,? FROM lan_material_files m JOIN files f ON f.id=m.local_id
               JOIN segments s ON s.file_id=f.id JOIN lan_sentence_ids i ON i.local_id=s.id
               WHERE m.file=? AND f.content_hash=? AND i.stable_id=coalesce((SELECT sentence FROM lan_material_aliases WHERE file=? AND alias=?),?)",
               params![pos.content,revision,pos.back,entity,pos.content,entity,pos.sentence,pos.sentence]).map_err(err)?;
        }
        _ => {
            let tag = &field[7..];
            if let (Some(file), Some(tag_id)) = (
                bound(db, "lan_material_files", "file", entity)?,
                bound(db, "lan_tag_bindings", "tag", tag)?,
            ) {
                if value.as_deref() == Some("1") {
                    db.execute(
                        "INSERT OR IGNORE INTO file_tags(file_id,tag_id) VALUES(?,?)",
                        params![file, tag_id],
                    )
                    .map_err(err)?;
                } else {
                    db.execute("DELETE FROM file_tags WHERE file_id=? AND tag_id=? AND NOT EXISTS(
                       SELECT 1 FROM lan_tag_bindings t JOIN lan_meta_heads h ON h.entity=? AND h.field='member:'||t.tag WHERE t.local_id=? AND h.value='1')",params![file,tag_id,entity,tag_id]).map_err(err)?;
                }
            }
        }
    }
    Ok(())
}

fn project_tone(db: &Connection, id: i64) -> Result<()> {
    db.execute("UPDATE tags SET tone=(SELECT h.value FROM lan_tag_bindings b JOIN lan_meta_heads h ON h.entity=b.tag AND h.field='tone' WHERE b.local_id=?1 ORDER BY h.generation DESC,h.revision DESC LIMIT 1) WHERE id=?1",[id]).map_err(err)?;
    Ok(())
}
