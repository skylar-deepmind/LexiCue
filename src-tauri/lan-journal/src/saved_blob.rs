//! Keep ordinary saves inline. Oversized snapshots written by earlier releases
//! have never been offered, so their transport encoding can change atomically
//! while preserving the original event ID, parent, revision and exact UTF-8.
use super::*;
use crate::material::Change;

pub(crate) fn prepare(tx: &Connection, event: &mut Event, offered: i64) -> Result<()> {
    if event.seq <= offered || material::parse(&event.snapshot)?.is_some() {
        return Err("unsupported published event; reconcile using a safety backup".into());
    }
    let change = manifest(&event.snapshot)?;
    let digest = change.blob().expect("saved manifest").1;
    tx.execute(
        "INSERT INTO lan_material_blobs(event,data,digest) VALUES(?,?,?)",
        params![event.id, event.snapshot.as_bytes(), digest],
    )
    .map_err(err)?;
    event.snapshot = serde_json::to_string(&change).map_err(err)?;
    tx.execute(
        "UPDATE lan_saved_outbox SET snapshot=? WHERE eid=?",
        params![event.snapshot, event.id],
    )
    .map_err(err)?;
    tx.execute(
        "UPDATE lan_history SET snapshot=? WHERE eid=?",
        params![event.snapshot, event.id],
    )
    .map_err(err)?;
    Ok(())
}

// A backup taken before the first offer still archives the raw encoding. The
// digest, length, and logical entity prove equivalence across a newly paired epoch.
pub(crate) fn manifest(snapshot: &str) -> Result<Change> {
    let entity = serde_json::from_str::<Header>(snapshot)
        .map_err(err)?
        .record_id;
    let change = Change::Saved {
        entity,
        bytes: snapshot.len(),
        sha256: format!("{:x}", Sha256::digest(snapshot.as_bytes())),
    };
    change.validate()?;
    Ok(change)
}
pub(crate) fn validate(
    db: &Connection,
    eid: &str,
    entity: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    let snapshot: String = db
        .query_row(
            "SELECT CAST(data AS text) FROM lan_material_blobs WHERE event=?",
            [eid],
            |r| r.get(0),
        )
        .map_err(err)?;
    validate_snapshot(&snapshot, entity, store)
}
fn validate_snapshot(snapshot: &str, entity: &str, store: &impl session::SavedStore) -> Result<()> {
    if serde_json::from_str::<Header>(snapshot)
        .map_err(err)?
        .record_id
        != entity
    {
        return Err("misdirected saved snapshot".into());
    }
    store.validate(snapshot)
}

pub(crate) fn apply(
    db: &Connection,
    event: &Event,
    entity: &str,
    bytes: usize,
    digest: &str,
    store: &impl session::SavedStore,
) -> Result<()> {
    // Staging has already verified the full byte digest. Publish the exact
    // original encoding; reserializing it could manufacture a revision fork.
    let snapshot:String=db.query_row("SELECT CAST(data AS text) FROM lan_material_stage WHERE event=? AND digest=? AND bytes=? AND filled=bytes",
        params![event.id,digest,bytes],|r|r.get(0)).map_err(err)?;
    validate_snapshot(&snapshot, entity, store)?;
    let logical = Event {
        snapshot,
        ..event.clone()
    };
    merge(db, &logical, &|tx, json| store.write(tx, json))?;
    db.execute("DELETE FROM lan_material_stage WHERE event=?", [&event.id])
        .map_err(err)?;
    Ok(())
}
