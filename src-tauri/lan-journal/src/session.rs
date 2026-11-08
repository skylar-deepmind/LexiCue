//! One bounded catch-up round on a trusted duplex link. The caller invokes
//! this on connection/reconnection. All restart state lives in SQLite.
use super::*;

#[derive(Debug, Serialize, Deserialize)]
pub struct Request {
    pub version: u8,
    pub route: Route,
    pub operation: Operation,
}
#[derive(Debug, Serialize, Deserialize)]
pub enum Operation {
    Hello,
    Deliver(Batch),
    Pull { through: i64 },
    Confirm(Ack),
}
#[derive(Debug, Serialize, Deserialize)]
pub enum Reply {
    Hello(Progress),
    Applied(Ack),
    Pending(Option<Batch>),
    Confirmed,
}

pub trait SavedStore {
    fn validate(&self, snapshot: &str) -> Result<()>;
    fn write(&self, tx: &Connection, snapshot: &str) -> Result<()>;
}

pub fn respond(
    db: &mut Connection,
    local: &Route,
    request: Request,
    store: &impl SavedStore,
) -> Result<Reply> {
    if request.version != VERSION || request.route != local.reverse() {
        return Err("incompatible saved session".into());
    }
    match request.operation {
        Operation::Hello => Ok(Reply::Hello(progress(db, local)?)),
        Operation::Deliver(batch) => Ok(Reply::Applied(receive(
            db,
            local,
            &batch,
            |s| store.validate(s),
            |tx, s| store.write(tx, s),
        )?)),
        Operation::Pull { through } => Ok(Reply::Pending(pending(db, local, through, |s| {
            store.validate(s)
        })?)),
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
            version: VERSION,
            route: local.clone(),
            operation,
        })
    };
    let p = progress(db, local)?;
    let Reply::Hello(peer) = call(Operation::Hello)? else {
        return Err("expected saved peer progress".into());
    };
    if peer.received < p.acked
        || peer.received > p.offered
        || p.received < peer.acked
        || p.received > peer.offered
        || peer.acked < 0
        || peer.acked > peer.offered
        || peer.offered > peer.head
    {
        return Err("saved replica progress diverged; reconcile before continuing".into());
    }
    let mut pushed = p.acked;
    let mut pulled = peer.acked;
    while pushed < p.head || pulled < peer.head {
        if pushed < p.head {
            let batch = pending(db, local, p.head, |s| store.validate(s))?
                .ok_or("missing local saved changes")?;
            let end = batch.events.last().unwrap().seq;
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
            let ack = receive(
                db,
                local,
                &batch,
                |s| store.validate(s),
                |tx, s| store.write(tx, s),
            )?;
            pulled = ack.seq;
            if !matches!(call(Operation::Confirm(ack))?, Reply::Confirmed) {
                return Err("peer did not persist ACK".into());
            }
        }
    }
    Ok(())
}
