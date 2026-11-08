//! One bounded catch-up round on a trusted duplex link. The caller invokes
//! this on connection/reconnection. All restart state lives in SQLite.
use super::*;
use crate::checkpoint::Hello;
use crate::material::transfer::{self, Chunk, Cursor};
pub const SESSION_VERSION: u8 = 5;

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub version: u8,
    pub route: Route,
    pub operation: Operation,
}
#[derive(Debug, Serialize, Deserialize)]
pub enum Operation {
    Hello(Hello),
    Offer(Batch),
    ReadChunk(Cursor),
    PutChunk(Chunk),
    Deliver(Batch),
    Pull { through: i64 },
    Confirm(Ack),
}
#[derive(Debug, Serialize, Deserialize)]
pub enum Reply {
    Hello(Hello),
    Need(Option<Cursor>),
    Chunk(Chunk),
    Staged(usize),
    Applied(Ack),
    Pending(Option<Batch>),
    Confirmed,
}

pub trait SavedStore {
    fn validate_source(
        &self,
        _source: &material::Source,
        _body: &str,
        _kind: &str,
        _segments: usize,
    ) -> Result<()> {
        Err("unsupported material source".into())
    }
    fn validate(&self, snapshot: &str) -> Result<()>;
    fn write(&self, tx: &Connection, snapshot: &str) -> Result<()>;
}

pub fn respond(
    db: &mut Connection,
    local: &Route,
    request: Request,
    store: &impl SavedStore,
) -> Result<Reply> {
    if request.version != SESSION_VERSION || request.route != local.reverse() {
        return Err("incompatible saved session".into());
    }
    match request.operation {
        Operation::Offer(batch) => Ok(Reply::Need(transfer::need(db, local, &batch)?)),
        Operation::ReadChunk(cursor) => Ok(Reply::Chunk(transfer::read(db, local, cursor)?)),
        Operation::PutChunk(chunk) => Ok(Reply::Staged(transfer::stage(db, local, chunk)?)),
        Operation::Hello(peer) => {
            let here = Hello::read(db, local)?;
            peer.verify(db, local, &here.progress)?;
            compact(db, local, peer.progress.acked)?;
            Ok(Reply::Hello(here))
        }
        Operation::Deliver(batch) => Ok(Reply::Applied(receive(db, local, &batch, store)?)),
        Operation::Pull { through } => Ok(Reply::Pending(pending(db, local, through, store)?)),
        Operation::Confirm(ack) => {
            confirm(db, local, &ack)?;
            Ok(Reply::Confirmed)
        }
    }
}

pub fn catch_up(
    db: &mut Connection,
    local: &Route,
    store: &impl SavedStore,
    mut exchange: impl FnMut(Request) -> Result<Reply>,
) -> Result<()> {
    let mut call = |operation| {
        exchange(Request {
            version: SESSION_VERSION,
            route: local.clone(),
            operation,
        })
    };
    let here = Hello::read(db, local)?;
    let p = here.progress.clone();
    let Reply::Hello(proof) = call(Operation::Hello(here))? else {
        return Err("expected saved peer progress".into());
    };
    proof.verify(db, local, &p)?;
    let peer = proof.progress;
    compact(db, local, peer.acked)?;
    let mut pushed = p.acked;
    let mut pulled = peer.acked;
    while pushed < p.head || pulled < peer.head {
        if pushed < p.head {
            let batch = pending(db, local, p.head, store)?.ok_or("missing local saved changes")?;
            let end = batch.events.last().unwrap().seq;
            if let Some(size) = transfer::blob_size(&batch.events[0])? {
                let Reply::Need(need) = call(Operation::Offer(batch.clone()))? else {
                    return Err("expected material cursor".into());
                };
                if let Some(mut cursor) = need {
                    let event = &batch.events[0];
                    if cursor.seq != event.seq || cursor.event != event.id || cursor.offset >= size
                    {
                        return Err("invalid material cursor".into());
                    }
                    while cursor.offset < size {
                        let expected = size.min(cursor.offset + transfer::CHUNK_BYTES);
                        let frame = transfer::read(db, local, cursor.clone())?;
                        let Reply::Staged(next) = call(Operation::PutChunk(frame))? else {
                            return Err("expected staging offset".into());
                        };
                        if next != expected {
                            return Err("incorrect peer staging offset".into());
                        }
                        cursor.offset = next;
                    }
                }
            }
            let Reply::Applied(ack) = call(Operation::Deliver(batch))? else {
                return Err("expected saved ACK".into());
            };
            if ack.seq != end {
                return Err("incomplete saved ACK".into());
            }
            confirm(db, local, &ack)?;
            pushed = end;
        }
        if pulled < peer.head {
            let Reply::Pending(Some(batch)) = call(Operation::Pull { through: peer.head })? else {
                return Err("missing peer saved changes".into());
            };
            if batch.events.first().map(|e| e.seq) != pulled.checked_add(1)
                || batch.events.last().is_none_or(|e| e.seq > peer.head)
            {
                return Err("invalid pull interval".into());
            }
            if let Some(size) = transfer::blob_size(&batch.events[0])? {
                if let Some(mut cursor) = transfer::need(db, local, &batch)? {
                    while cursor.offset < size {
                        let Reply::Chunk(frame) = call(Operation::ReadChunk(cursor.clone()))?
                        else {
                            return Err("expected material bytes".into());
                        };
                        cursor.offset = transfer::stage(db, local, frame)?;
                    }
                }
            }
            let ack = receive(db, local, &batch, store)?;
            pulled = ack.seq;
            if !matches!(call(Operation::Confirm(ack))?, Reply::Confirmed) {
                return Err("peer did not persist ACK".into());
            }
        }
    }
    Ok(())
}
