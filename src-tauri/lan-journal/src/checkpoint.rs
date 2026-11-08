//! Proofs at the durable receive and send boundaries. A sequence number by
//! itself cannot distinguish two histories produced after a database rollback.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Point {
    pub seq: i64,
    pub eid: String,
    pub digest: String,
}

pub fn outgoing(db: &Connection, route: &Route, seq: i64) -> Result<Option<Point>> {
    if seq == 0 {
        return Ok(None);
    }
    let mut event = db
        .query_row(
            "SELECT seq,eid,parent,snapshot FROM lan_saved_outbox WHERE seq=?",
            [seq],
            read_event,
        )
        .optional()
        .map_err(err)?
        .ok_or("missing published event; reconcile the replica")?;
    if let Some(mut change) = material::parse(&event.snapshot)? {
        material::transfer::seal(db, &mut event, &mut change)?;
    }
    Ok(Some(Point {
        seq,
        digest: event.checksum(route)?,
        eid: event.id,
    }))
}

pub fn incoming(db: &Connection, seq: i64) -> Result<Option<Point>> {
    if seq == 0 {
        return Ok(None);
    }
    db.query_row(
        "SELECT eid,digest FROM lan_saved_inbox WHERE seq=?",
        [seq],
        |r| {
            Ok(Some(Point {
                seq,
                eid: r.get(0)?,
                digest: r.get(1)?,
            }))
        },
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "missing received event; reconcile the replica".into())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Hello {
    pub progress: Progress,
    acknowledged: Option<Point>,
    received: Option<Point>,
}

impl Hello {
    pub(crate) fn read(db: &Connection, route: &Route) -> Result<Self> {
        let p = progress(db, route)?;
        Ok(Self {
            acknowledged: outgoing(db, route, p.acked)?,
            received: incoming(db, p.received)?,
            progress: p,
        })
    }

    pub(crate) fn verify(&self, db: &Connection, route: &Route, local: &Progress) -> Result<()> {
        let peer = &self.progress;
        if peer.materials != local.materials {
            return Err("incompatible material capability; update or prepare peer".into());
        }
        if peer.received < local.acked
            || peer.received > local.offered
            || local.received < peer.acked
            || local.received > peer.offered
            || peer.acked < 0
            || peer.acked > peer.offered
            || peer.offered > peer.head
            || local.acked < 0
            || local.acked > local.offered
            || local.offered > local.head
            || outgoing(db, route, peer.received)? != self.received
            || incoming(db, peer.acked)? != self.acknowledged
        {
            return Err("saved replica history diverged; reconcile before continuing".into());
        }
        Ok(())
    }
}

/// This SQLite file lives beside the non-backed-up installation marker, outside
/// the replaceable library. Each published boundary reaches durable storage
/// before exposing a batch, receipt, or successful session completion.
pub struct PublicationFence {
    db: Connection,
}

#[derive(Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Boundaries {
    acked: i64,
    offered: Option<Point>,
    received: Option<Point>,
}

impl PublicationFence {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        let db = Connection::open(path).map_err(err)?;
        db.execute_batch("PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS epochs(
              pair TEXT PRIMARY KEY, route TEXT NOT NULL, retired INTEGER NOT NULL, boundaries TEXT NOT NULL
            ) STRICT;").map_err(err)?;
        Ok(Self { db })
    }

    pub fn known(&self, route: &Route) -> Result<bool> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM epochs WHERE pair=?)",
                [route.pair.to_string()],
                |r| r.get(0),
            )
            .map_err(err)
    }

    /// Called only after an explicitly approved, backed-up pairing. A crash
    /// before registration cannot have exposed any data from this epoch.
    pub fn register(&mut self, library: &Connection, route: &Route) -> Result<()> {
        let p = progress(library, route)?;
        if p.offered != 0 || p.acked != 0 || p.received != 0 {
            return Err("unproven installation history; pair again to reconcile".into());
        }
        self.db
            .execute(
                "INSERT INTO epochs(pair,route,retired,boundaries) VALUES(?,?,0,?)",
                params![
                    route.pair.to_string(),
                    serde_json::to_string(route).map_err(err)?,
                    serde_json::to_string(&Boundaries::default()).map_err(err)?
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn retire(&mut self, route: &Route) -> Result<()> {
        self.db
            .execute(
                "INSERT INTO epochs(pair,route,retired,boundaries) VALUES(?,?,1,?)
            ON CONFLICT(pair) DO UPDATE SET retired=1",
                params![
                    route.pair.to_string(),
                    serde_json::to_string(route).map_err(err)?,
                    serde_json::to_string(&Boundaries::default()).map_err(err)?
                ],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn publish(&mut self, library: &Connection, route: &Route) -> Result<()> {
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let (stored_route, raw): (String, String) = tx
            .query_row(
                "SELECT route,boundaries FROM epochs WHERE pair=? AND retired=0",
                [route.pair.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?
            .ok_or("untrusted or retired publication epoch")?;
        if serde_json::from_str::<Route>(&stored_route).map_err(err)? != *route {
            return Err("incorrect publication route".into());
        }
        let previous: Boundaries = serde_json::from_str(&raw).map_err(err)?;
        let snapshot = library.unchecked_transaction().map_err(err)?;
        let exists: bool = snapshot.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='lan_saved_peer')", [], |r| r.get(0)).map_err(err)?;
        if !exists {
            return Err("missing library generation; reconcile the replica".into());
        }
        let p = progress(&snapshot, route)?;
        let offered = previous.offered.as_ref().map_or(0, |v| v.seq);
        let received = previous.received.as_ref().map_or(0, |v| v.seq);
        if p.acked < previous.acked
            || p.offered < offered
            || p.received < received
            || p.acked > p.offered
            || p.offered > p.head
            || outgoing(&snapshot, route, offered)? != previous.offered
            || incoming(&snapshot, received)? != previous.received
        {
            return Err("library rolled back or forked; pair again to reconcile".into());
        }
        let next = Boundaries {
            acked: p.acked,
            offered: outgoing(&snapshot, route, p.offered)?,
            received: incoming(&snapshot, p.received)?,
        };
        snapshot.commit().map_err(err)?;
        if previous != next {
            tx.execute(
                "UPDATE epochs SET boundaries=? WHERE pair=?",
                params![
                    serde_json::to_string(&next).map_err(err)?,
                    route.pair.to_string()
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{self, SavedStore};
    use std::path::Path;

    struct Store;
    impl SavedStore for Store {
        fn validate(&self, _: &str) -> Result<()> {
            Ok(())
        }
        fn write(&self, _: &Connection, _: &str) -> Result<()> {
            Ok(())
        }
    }

    fn setup(route: &Route) -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE saved_records(id INTEGER PRIMARY KEY, record_id TEXT, revision TEXT, snapshot_json TEXT);").unwrap();
        install(&mut db, route).unwrap();
        db
    }

    fn log(db: &Connection) {
        db.execute("INSERT INTO saved_records(revision,snapshot_json)
            VALUES('r1','{\"record_id\":\"one\",\"revision\":\"r1\",\"generation\":0,\"origin\":\"reader\"}')",[]).unwrap();
    }

    #[test]
    fn identical_numbers_cannot_ack_a_fork_after_restart() {
        let route = Route {
            pair: Uuid::new_v4(),
            from: Uuid::new_v4(),
            to: Uuid::new_v4(),
        };
        let mut a = setup(&route);
        let mut b = setup(&route.reverse());
        let mut fence = PublicationFence::open(Path::new(":memory:")).unwrap();
        fence.register(&a, &route).unwrap();
        log(&a);
        session::catch_up(&mut a, &route, &Store, |r| {
            session::respond(&mut b, &route.reverse(), r, &Store)
        })
        .unwrap();
        fence.publish(&a, &route).unwrap();
        // An old library rewrote seq 1 while disconnected, then reached the
        // same head and ACK count. Both the external floor and peer reject it.
        a.execute(
            "UPDATE lan_saved_outbox SET eid=lower(hex(randomblob(16))) WHERE seq=1",
            [],
        )
        .unwrap();
        assert!(fence
            .publish(&a, &route)
            .unwrap_err()
            .contains("rolled back or forked"));
        let failed = session::catch_up(&mut a, &route, &Store, |r| {
            assert!(matches!(r.operation, session::Operation::Hello(_)));
            session::respond(&mut b, &route.reverse(), r, &Store)
        })
        .unwrap_err();
        assert!(failed.contains("diverged"), "{failed}");
        fence.retire(&route).unwrap();
        assert!(fence.publish(&a, &route).is_err());
        assert!(fence.register(&a, &route).is_err());
    }

    #[test]
    fn offered_event_cannot_be_reissued_even_if_peer_never_received_it() {
        let route = Route {
            pair: Uuid::new_v4(),
            from: Uuid::new_v4(),
            to: Uuid::new_v4(),
        };
        let mut a = setup(&route);
        let mut fence = PublicationFence::open(Path::new(":memory:")).unwrap();
        fence.register(&a, &route).unwrap();
        log(&a);
        pending(&mut a, &route, 1, &Store).unwrap();
        fence.publish(&a, &route).unwrap();
        let old = setup(&route);
        assert!(fence.publish(&old, &route).is_err());
        a.execute(
            "UPDATE lan_saved_outbox SET snapshot=replace(snapshot,'one','two') WHERE seq=1",
            [],
        )
        .unwrap();
        assert!(fence.publish(&a, &route).is_err());
    }
}
