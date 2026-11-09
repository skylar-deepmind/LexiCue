//! Chunk staging has its own durable byte offset. Only the enclosing business
//! transaction can advance the journal receipt.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::DatabaseName;

pub const CHUNK_BYTES: usize = 32 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cursor {
    pub seq: i64,
    pub event: String,
    pub offset: usize,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Chunk {
    pub cursor: Cursor,
    pub data: String,
    pub checksum: String,
}

pub(crate) fn digest_blob(db: &Connection, table: &str, row: i64) -> Result<String> {
    let mut blob = db
        .blob_open(DatabaseName::Main, table, "data", row, true)
        .map_err(err)?;
    let mut hash = Sha256::new();
    std::io::copy(&mut blob, &mut hash).map_err(err)?;
    Ok(format!("{:x}", hash.finalize()))
}

/// Hash immutable local bytes once, before their manifest is first offered.
pub(crate) fn seal(db: &Connection, event: &mut Event, change: &mut Change) -> Result<()> {
    let limit = change.blob_limit();
    let (bytes, sha256) = match change {
        Change::Saved { bytes, sha256, .. }
        | Change::Create { bytes, sha256, .. }
        | Change::Large { bytes, sha256, .. } => (*bytes, sha256),
        _ => return change.validate(),
    };
    if !(1..=limit).contains(&bytes) {
        return Err("material exceeds transfer limit".into());
    }
    let (row, cached): (i64, Option<String>) = db
        .query_row(
            "SELECT id,digest FROM lan_material_blobs WHERE event=? AND length(data)=?",
            params![event.id, bytes],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(err)?;
    *sha256 = match cached {
        Some(hash) => hash,
        None => {
            let hash = digest_blob(db, "lan_material_blobs", row)?;
            db.execute(
                "UPDATE lan_material_blobs SET digest=? WHERE id=?",
                params![hash, row],
            )
            .map_err(err)?;
            hash
        }
    };
    change.validate()?;
    event.snapshot = serde_json::to_string(change).map_err(err)?;
    Ok(())
}

pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    db: &Connection,
    eid: &str,
    bytes: usize,
    hash: &str,
) -> Result<T> {
    let row:i64=db.query_row("SELECT id FROM lan_material_stage WHERE event=? AND bytes=? AND filled=bytes AND digest=?",
        params![eid,bytes,hash],|r|r.get(0)).map_err(err)?;
    let blob = db
        .blob_open(DatabaseName::Main, "lan_material_stage", "data", row, true)
        .map_err(err)?;
    serde_json::from_reader(std::io::BufReader::new(blob)).map_err(err)
}

pub(crate) fn blob_size(event: &Event) -> Result<Option<usize>> {
    Ok(parse(&event.snapshot)?.and_then(|change| change.blob().map(|(bytes, _)| bytes)))
}

/// Bind the single staging slot to the next authenticated journal event.
pub(crate) fn need(db: &mut Connection, local: &Route, batch: &Batch) -> Result<Option<Cursor>> {
    if batch.version != VERSION || batch.route != local.reverse() || batch.events.len() != 1 {
        return Err("invalid material offer".into());
    }
    let event = &batch.events[0];
    let change = parse(&event.snapshot)?.ok_or("missing material manifest")?;
    change.validate()?;
    let (bytes, hash) = change.blob().ok_or("expected material manifest")?;
    if !id(&event.id)
        || event.seq <= 0
        || event.parent.is_some() && !matches!(change, Change::Saved { .. })
        || event.checksum(&batch.route)? != event.digest
    {
        return Err("invalid material event digest".into());
    }
    db.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let received = progress(&tx, local)?.received;
    if event.seq <= received {
        return Ok(None);
    }
    if received.checked_add(1) != Some(event.seq) {
        return Err("material sequence gap".into());
    }
    tx.execute("INSERT INTO lan_material_stage(id,event,digest,bytes,filled,data) VALUES(1,?,?,?,0,zeroblob(?)) ON CONFLICT(id) DO NOTHING",params![event.id,hash,bytes,bytes]).map_err(err)?;
    let mut offset: usize = tx
        .query_row(
            "SELECT filled FROM lan_material_stage WHERE event=? AND digest=? AND bytes=?",
            params![event.id, hash, bytes],
            |r| r.get(0),
        )
        .map_err(|_| "material staging fork")?;
    if offset == bytes && digest_blob(&tx, "lan_material_stage", 1)? != hash {
        tx.execute("UPDATE lan_material_stage SET filled=0 WHERE id=1", [])
            .map_err(err)?;
        offset = 0;
    }
    tx.commit().map_err(err)?;
    Ok((offset < bytes).then(|| Cursor {
        seq: event.seq,
        event: event.id.clone(),
        offset,
    }))
}

pub(crate) fn read(db: &Connection, local: &Route, cursor: Cursor) -> Result<Chunk> {
    let p = progress(db, local)?;
    if cursor.seq <= p.acked || cursor.seq > p.offered {
        return Err("unoffered material bytes".into());
    }
    let row=db.query_row("SELECT b.id FROM lan_material_blobs b JOIN lan_saved_outbox o ON o.eid=b.event WHERE o.seq=? AND o.eid=?",params![cursor.seq,cursor.event],|r|r.get(0)).map_err(err)?;
    let blob = db
        .blob_open(DatabaseName::Main, "lan_material_blobs", "data", row, true)
        .map_err(err)?;
    if cursor.offset >= blob.len() || !cursor.offset.is_multiple_of(CHUNK_BYTES) {
        return Err("invalid chunk offset".into());
    }
    let mut bytes = vec![0; CHUNK_BYTES.min(blob.len() - cursor.offset)];
    blob.read_at_exact(&mut bytes, cursor.offset).map_err(err)?;
    Ok(Chunk {
        cursor,
        data: STANDARD.encode(&bytes),
        checksum: format!("{:x}", Sha256::digest(bytes)),
    })
}

pub(crate) fn stage(db: &mut Connection, local: &Route, frame: Chunk) -> Result<usize> {
    if frame.data.len() > CHUNK_BYTES.div_ceil(3) * 4 {
        return Err("oversized material chunk".into());
    }
    let bytes = STANDARD.decode(frame.data).map_err(err)?;
    if format!("{:x}", Sha256::digest(&bytes)) != frame.checksum {
        return Err("material chunk checksum mismatch".into());
    }
    db.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    if progress(&tx, local)?.received.checked_add(1) != Some(frame.cursor.seq) {
        return Err("misdirected material chunk".into());
    }
    let (filled, size, hash): (usize, usize, String) = tx
        .query_row(
            "SELECT filled,bytes,digest FROM lan_material_stage WHERE event=?",
            [frame.cursor.event],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(err)?;
    if frame.cursor.offset != filled
        || filled >= size
        || bytes.len() != CHUNK_BYTES.min(size - filled)
    {
        return Err("incorrect material chunk interval".into());
    }
    {
        let mut blob = tx
            .blob_open(DatabaseName::Main, "lan_material_stage", "data", 1, false)
            .map_err(err)?;
        blob.write_at(&bytes, filled).map_err(err)?;
    }
    let next = filled + bytes.len();
    if next == size && digest_blob(&tx, "lan_material_stage", 1)? != hash {
        tx.execute("DELETE FROM lan_material_stage", [])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        return Err("material payload checksum mismatch".into());
    }
    tx.execute("UPDATE lan_material_stage SET filled=? WHERE id=1", [next])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(next)
}
