use super::*;

#[derive(Serialize)]
pub struct Conflict {
    pub entity: String,
    pub field: String,
    pub label: String,
    pub versions: Vec<Version>,
}
#[derive(Serialize)]
pub struct Version {
    pub revision: String,
    pub text: String,
    pub deleted: bool,
}

pub fn conflicts(db: &Connection) -> Result<Vec<Conflict>> {
    if !db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='lan_saved_heads')",
            [],
            |r| r.get::<_, bool>(0),
        )
        .map_err(err)?
    {
        return Ok(Vec::new());
    }
    let mut query=String::from("SELECT entity,'saved',json_extract(snapshot,'$.expression'),rev,coalesce(json_extract(snapshot,'$.explanation'),''),json_extract(snapshot,'$.deleted_at') IS NOT NULL FROM lan_saved_heads v WHERE (SELECT count(*) FROM lan_saved_heads WHERE entity=v.entity)>1");
    if db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='lan_field_edges')",
            [],
            |r| r.get::<_, bool>(0),
        )
        .map_err(err)?
    {
        query.push_str(" UNION ALL SELECT m.file,'deleted-material:'||m.revision,
            coalesce((SELECT json_extract(cast(b.data AS text),'$.title') FROM lan_material_blobs b JOIN lan_history h ON h.eid=b.event
                WHERE json_extract(h.snapshot,'$.file')=m.file AND json_extract(h.snapshot,'$.material_op')='create' LIMIT 1),''),
            CASE WHEN k.value=0 THEN 'deleted' ELSE m.revision END, CASE WHEN k.value=0 THEN '' ELSE coalesce(v.value,'') END, k.value=0
            FROM lan_recoverable_edits m JOIN lan_material_values v ON v.revision=m.revision, json_each('[0,1]') k WHERE m.done=0");
        query.push_str(" UNION ALL SELECT v.file,v.field,coalesce(f.name,'') || coalesce(' · '||s.en_text,''), v.revision, coalesce(v.value,''),0
           FROM lan_material_values v JOIN lan_material_files m ON m.file=v.file JOIN files f ON f.id=m.local_id
           LEFT JOIN lan_sentence_ids i ON i.stable_id=v.field LEFT JOIN segments s ON s.id=i.local_id
           WHERE v.automatic=0 AND (v.field='title' OR s.id IS NOT NULL)
           AND v.basis=coalesce((SELECT revision FROM lan_material_basis WHERE local_id=s.id),'')
           AND NOT EXISTS(SELECT 1 FROM lan_field_edges WHERE parent=v.revision)
           AND EXISTS(SELECT 1 FROM lan_material_values c WHERE c.file=v.file AND c.field=v.field AND c.basis=v.basis AND c.automatic=0 AND c.revision<>v.revision AND NOT EXISTS(SELECT 1 FROM lan_field_edges e WHERE e.parent=c.revision))");
    }
    if db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='lan_material_files')",
            [],
            |r| r.get::<_, bool>(0),
        )
        .map_err(err)?
    {
        query.push_str(" UNION ALL SELECT cast(q.local_id AS text), 'restored-file', f.name, r.value, '', 0
        FROM lan_quarantine q JOIN files f ON f.id=q.local_id, json_each('[\"local\",\"include\"]') r WHERE q.kind='files' AND f.language='en'
        UNION ALL SELECT cast(q.local_id AS text),'restored-tag',t.name,r.value,'',0
        FROM lan_quarantine q JOIN tags t ON t.id=q.local_id,json_each('[\"local\",\"include\"]') r WHERE q.kind='tags'");
    }
    query.push_str(" ORDER BY 1,2,4");
    let mut stmt = db.prepare(&query).map_err(err)?;
    let mut rows = stmt.query([]).map_err(err)?;
    let mut result = Vec::<Conflict>::new();
    while let Some(row) = rows.next().map_err(err)? {
        let entity: String = row.get(0).map_err(err)?;
        let field: String = row.get(1).map_err(err)?;
        if result
            .last()
            .is_none_or(|c| c.entity != entity || c.field != field)
        {
            result.push(Conflict {
                entity,
                field,
                label: row.get(2).map_err(err)?,
                versions: vec![],
            });
        }
        result.last_mut().unwrap().versions.push(Version {
            revision: row.get(3).map_err(err)?,
            text: row.get(4).map_err(err)?,
            deleted: row.get(5).map_err(err)?,
        });
    }
    Ok(result)
}

pub fn resolve(
    db: &mut Connection,
    entity: &str,
    field: &str,
    mut parents: Vec<String>,
    picked: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    parents.sort();
    let c = conflicts(&tx)?
        .into_iter()
        .find(|c| c.entity == entity && c.field == field)
        .ok_or("conflict changed")?;
    if !parents.iter().eq(c.versions.iter().map(|v| &v.revision))
        || !parents.iter().any(|p| p == picked)
    {
        return Err("conflict changed".into());
    }
    if let Some(revision) = field.strip_prefix("deleted-material:") {
        if picked == revision {
            material::recover_copy(&tx, entity, revision, store)?;
        }
        material::record_recovery(&tx, entity, revision, true)?;
        return tx.commit().map_err(err);
    }
    if matches!(field, "restored-tag" | "restored-file") {
        let kind = if field == "restored-tag" {
            "tags"
        } else {
            "files"
        };
        if picked == "include" {
            tx.execute(
                "DELETE FROM lan_quarantine WHERE kind=? AND local_id=?",
                params![kind, entity],
            )
            .map_err(err)?;
            if kind == "files" {
                tx.execute("INSERT OR REPLACE INTO restored_material_ids(file_id,stable) VALUES(?,lower(hex(randomblob(16))))",[entity]).map_err(err)?;
                material::install(&tx)?;
            } else {
                tx.execute("INSERT INTO lan_tag_bindings(tag,local_id) VALUES(lower(hex(randomblob(16))),?)",[entity]).map_err(err)?;
            }
            metadata::install(&tx)?;
        } else {
            // Keep local suppresses this review item while the no-export fence stays in force.
            tx.execute(
                "UPDATE lan_quarantine SET kind=? WHERE kind=? AND local_id=?",
                params![format!("{kind}-local"), kind, entity],
            )
            .map_err(err)?;
        }
        return tx.commit().map_err(err);
    }
    let eid = Uuid::new_v4().simple().to_string();
    tx.execute("UPDATE lan_saved_peer SET applying=1", [])
        .map_err(err)?;
    apply_choice(&tx, entity, field, &parents, picked, &eid, &|db, json| {
        store.write(db, json)
    })?;
    let change = material::Change::Resolution {
        file: entity.to_string(),
        field: field.to_string(),
        parents,
        picked: picked.to_string(),
    };
    tx.execute(
        "INSERT INTO lan_saved_outbox(eid,snapshot) VALUES(?,?)",
        params![eid, serde_json::to_string(&change).map_err(err)?],
    )
    .map_err(err)?;
    tx.execute("UPDATE lan_saved_peer SET applying=0", [])
        .map_err(err)?;
    tx.commit().map_err(err)
}

pub(crate) fn apply_choice(
    db: &Connection,
    entity: &str,
    field: &str,
    parents: &[String],
    picked: &str,
    eid: &str,
    apply: &impl Fn(&Connection, &str) -> Result<()>,
) -> Result<()> {
    let encoded = serde_json::to_string(parents).map_err(err)?;
    if field == "saved" {
        let (count,depth,generation,deleted):(usize,i64,i64,bool)=db.query_row("SELECT count(*),max(depth),max(json_extract(snapshot,'$.generation')),
             max(json_extract(snapshot,'$.deleted_at') IS NOT NULL) FROM lan_saved_versions WHERE entity=? AND rev IN (SELECT value FROM json_each(?))",params![entity,encoded],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
        if count != parents.len() {
            return Err("missing saved conflict candidate".into());
        }
        let snapshot:String=db.query_row("SELECT json_set(snapshot,'$.revision',?,'$.generation',?+(? AND json_extract(snapshot,'$.deleted_at') IS NULL)) FROM lan_saved_versions WHERE entity=? AND rev=?",params![eid,generation,deleted,entity,picked],|r|r.get(0)).map_err(err)?;
        db.execute(
            "INSERT INTO lan_saved_versions(entity,rev,parent,depth,snapshot) VALUES(?,?,?,?,?)",
            params![
                entity,
                eid,
                picked,
                depth.checked_add(1).ok_or("depth overflow")?,
                snapshot
            ],
        )
        .map_err(err)?;
        db.execute(
            "INSERT INTO lan_saved_edges(parent,child) SELECT value,? FROM json_each(?)",
            params![eid, encoded],
        )
        .map_err(err)?;
        let winner = saved_history::winner(db, entity)?;
        return apply(db, &winner);
    }
    // The same sentence may have a different pre-pair local UUID. Bind the
    // candidate by its authenticated revision to find this replica's spelling.
    let (canonical,value,basis):(String,Option<String>,String)=db.query_row("SELECT field,value,basis FROM lan_material_values WHERE file=? AND revision=? AND automatic=0",params![entity,picked],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
    let (n,depth):(usize,i64)=db.query_row("SELECT count(*),max(generation) FROM lan_material_values WHERE file=? AND field=? AND basis=? AND revision IN (SELECT value FROM json_each(?))",params![entity,canonical,basis,encoded],|r|Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
    if n != parents.len() {
        return Err("missing material conflict candidate".into());
    }
    let change = material::Change::Field {
        file: entity.to_string(),
        field: canonical,
        revision: eid.to_string(),
        generation: depth.checked_add(1).ok_or("depth overflow")?,
        value,
        basis,
        automatic: 0,
        parents: parents.to_vec(),
    };
    material::apply_field(db, &change, eid)
}
