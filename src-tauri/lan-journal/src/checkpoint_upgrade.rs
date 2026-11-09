//! Read-only evidence for early paired libraries which predate a separate
//! publication fence. Neither side may offer events during this handshake.
use crate::{
    checkpoint::{incoming, outgoing, Point, PublicationFence},
    err, material, progress, Event, Result, Route,
};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Stream {
    count: i64,
    digest: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LegacyProof {
    route: Route,
    sent: Stream,
    received: Stream,
}

fn verify_archive(db: &Connection, route: &Route, point: &Point) -> Result<()> {
    let mut event = db
        .query_row(
            "SELECT parent,snapshot FROM lan_history WHERE eid=?",
            [&point.eid],
            |row| {
                Ok(Event {
                    seq: point.seq,
                    id: point.eid.clone(),
                    parent: row.get(0)?,
                    snapshot: row.get(1)?,
                    digest: String::new(),
                })
            },
        )
        .map_err(err)?;
    if let Some(mut change) = material::parse(&event.snapshot)? {
        material::transfer::seal(db, &mut event, &mut change)?;
        if material::transfer::blob_size(&event)?.is_some() {
            let (id, digest): (i64, String) = db
                .query_row(
                    "SELECT id,digest FROM lan_material_blobs WHERE event=?",
                    [&event.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(err)?;
            if material::transfer::digest_blob(db, "lan_material_blobs", id)? != digest {
                return Err("legacy content diverged; reconcile the replica".into());
            }
        }
    }
    if event.checksum(route)? != point.digest {
        return Err("legacy archive diverged; reconcile the replica".into());
    }
    Ok(())
}

fn stream(
    db: &Connection,
    route: &Route,
    count: i64,
    mut point: impl FnMut(i64) -> Result<Option<Point>>,
) -> Result<Stream> {
    let mut hash = Sha256::new();
    hash.update(b"LexiCue legacy publication proof v1");
    hash.update(route.pair.as_bytes());
    hash.update(route.from.as_bytes());
    hash.update(route.to.as_bytes());
    hash.update(count.to_be_bytes());
    for seq in 1..=count {
        let point = point(seq)?.ok_or("incomplete history; reconcile the replica")?;
        if point.seq != seq || point.eid.len() != 32 || point.digest.len() != 64 {
            return Err("invalid history; reconcile the replica".into());
        }
        verify_archive(db, route, &point)?;
        hash.update(seq.to_be_bytes());
        hash.update(point.eid.as_bytes());
        hash.update(point.digest.as_bytes());
    }
    Ok(Stream {
        count,
        digest: format!("{:x}", hash.finalize()),
    })
}

impl LegacyProof {
    pub fn read(db: &Connection, route: &Route) -> Result<Self> {
        let snapshot = db.unchecked_transaction().map_err(err)?;
        let p = progress(&snapshot, route)?;
        if p.offered != p.acked || p.acked < 0 || p.received < 0 || p.head < p.offered {
            return Err("unconfirmed legacy publication; reconcile the replica".into());
        }
        let sent = stream(&snapshot, route, p.acked, |seq| {
            outgoing(&snapshot, route, seq)
        })?;
        let received = stream(&snapshot, &route.reverse(), p.received, |seq| {
            incoming(&snapshot, seq)
        })?;
        snapshot.rollback().map_err(err)?;
        Ok(Self {
            route: route.clone(),
            sent,
            received,
        })
    }

    fn verify(&self, other: &Self) -> Result<()> {
        if self.route.reverse() != other.route
            || self.sent != other.received
            || self.received != other.sent
        {
            return Err("legacy publication history diverged; reconcile the replica".into());
        }
        Ok(())
    }
}

impl PublicationFence {
    pub fn mark_required(library: &Connection, route: &Route) -> Result<()> {
        library
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS lan_required_fences(pair TEXT PRIMARY KEY) STRICT;",
            )
            .map_err(err)?;
        library
            .execute(
                "INSERT OR IGNORE INTO lan_required_fences VALUES(?)",
                [route.pair.to_string()],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn upgrade_mode(&self, library: &Connection, route: &Route) -> Result<&'static str> {
        if self.known(route)? {
            let resumed:bool=self.db.query_row("SELECT EXISTS(SELECT 1 FROM migrated_epochs JOIN epochs USING(pair) WHERE pair=? AND NOT retired)",[route.pair.to_string()],|r|r.get(0)).map_err(err)?;
            return Ok(if resumed { "migrated" } else { "known" });
        }
        let exists = |table: &str| {
            library
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?)",
                    [table],
                    |r| r.get::<_, bool>(0),
                )
                .map_err(err)
        };
        if exists("lan_required_fences")? {
            let required: bool = library
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM lan_required_fences WHERE pair=?)",
                    [route.pair.to_string()],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if required {
                return Err("missing required publication fence; reconcile the replica".into());
            }
        }
        if exists("lan_saved_peer")? {
            let legacy:bool=library.query_row("SELECT EXISTS(SELECT 1 FROM lan_saved_peer WHERE active=1 AND pair=? AND local_replica=? AND peer_replica=? AND (acked!=0 OR offered!=0 OR received!=0))",params![route.pair.to_string(),route.from.to_string(),route.to.to_string()],|r|r.get(0)).map_err(err)?;
            if legacy {
                return Ok("legacy");
            }
        }
        Ok("new")
    }

    pub fn prove(&mut self, db: &Connection, route: &Route) -> Result<LegacyProof> {
        if self.known(route)? {
            self.publish(db, route)?;
        } else if self.upgrade_mode(db, route)? != "legacy" {
            return Err("no legacy publication evidence; reconcile the replica".into());
        }
        LegacyProof::read(db, route)
    }

    pub fn verify_upgrade(
        &mut self,
        db: &Connection,
        route: &Route,
        remote: &LegacyProof,
    ) -> Result<()> {
        self.prove(db, route)?.verify(remote)?;
        if !self.known(route)? {
            let p = progress(db, route)?;
            let boundaries = crate::checkpoint::Boundaries {
                acked: p.acked,
                offered: outgoing(db, route, p.offered)?,
                received: incoming(db, p.received)?,
            };
            let tx = self
                .db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            tx.execute(
                "INSERT INTO epochs(pair,route,retired,boundaries) VALUES(?,?,0,?)",
                params![
                    route.pair.to_string(),
                    serde_json::to_string(route).map_err(err)?,
                    serde_json::to_string(&boundaries).map_err(err)?
                ],
            )
            .map_err(err)?;
            tx.execute(
                "INSERT INTO migrated_epochs VALUES(?)",
                [route.pair.to_string()],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
        }
        Self::mark_required(db, route)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{install, session};
    use uuid::Uuid;

    struct Store;
    impl session::SavedStore for Store {
        fn validate(&self, _: &str) -> Result<()> {
            Ok(())
        }
        fn write(&self, _: &Connection, _: &str) -> Result<()> {
            Ok(())
        }
    }
    fn library(route: &Route, word: &str) -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE saved_records(id INTEGER PRIMARY KEY,record_id TEXT,revision TEXT,snapshot_json TEXT);",
        )
        .unwrap();
        install(&mut db, route).unwrap();
        db.execute("INSERT INTO saved_records(record_id,revision,snapshot_json) VALUES(?1,'r',json_object('record_id',?1,'revision','r','generation',0,'origin','reader'))",[word]).unwrap();
        db
    }
    #[test]
    fn migrates_matching_unfenced_legacy_histories_and_keeps_unsent_changes() {
        let r = Route {
            from: Uuid::new_v4(),
            to: Uuid::new_v4(),
            pair: Uuid::new_v4(),
        };
        let mut a = library(&r, "one");
        let mut b = library(&r.reverse(), "two");
        session::catch_up(&mut a, &r, &Store, |msg| {
            session::respond(&mut b, &r.reverse(), msg, &Store)
        })
        .unwrap();
        a.execute("INSERT INTO saved_records(record_id,revision,snapshot_json) VALUES('new','p',json_object('record_id','new','revision','p','generation',0,'origin','reader'))",[]).unwrap();
        let mut af = PublicationFence::open(":memory:".as_ref()).unwrap();
        let mut bf = PublicationFence::open(":memory:".as_ref()).unwrap();
        let ap = af.prove(&a, &r).unwrap();
        let bp = bf.prove(&b, &r.reverse()).unwrap();
        assert_eq!(af.upgrade_mode(&a, &r).unwrap(), "legacy");
        af.verify_upgrade(&a, &r, &bp).unwrap();
        bf.verify_upgrade(&b, &r.reverse(), &ap).unwrap();
        assert_eq!(af.upgrade_mode(&a, &r).unwrap(), "migrated");
        assert_eq!(progress(&a, &r).unwrap().head, 2);
        assert_eq!(progress(&a, &r).unwrap().acked, 1);
        af.publish(&a, &r).unwrap();
        let lost = PublicationFence::open(":memory:".as_ref()).unwrap();
        assert!(lost.upgrade_mode(&a, &r).is_err());
    }

    #[test]
    fn equal_watermarks_cannot_recover_a_fork_inside_the_prefix() {
        let r = Route {
            from: Uuid::new_v4(),
            to: Uuid::new_v4(),
            pair: Uuid::new_v4(),
        };
        let mut a = library(&r, "one");
        let mut b = library(&r.reverse(), "two");
        a.execute("INSERT INTO saved_records(record_id,revision,snapshot_json) VALUES('three','s',json_object('record_id','three','revision','s','generation',0,'origin','reader'))",[]).unwrap();
        session::catch_up(&mut a, &r, &Store, |msg| {
            session::respond(&mut b, &r.reverse(), msg, &Store)
        })
        .unwrap();
        let mut fence = PublicationFence::open(":memory:".as_ref()).unwrap();
        let peer = LegacyProof::read(&b, &r.reverse()).unwrap();
        // Keep the final event and both watermarks intact. Replace only the
        // first event and its archive as a forked older library might do.
        a.execute_batch("UPDATE lan_history SET snapshot=replace(snapshot,'one','fork') WHERE eid=(SELECT eid FROM lan_saved_outbox WHERE seq=1);
            UPDATE lan_saved_outbox SET snapshot=replace(snapshot,'one','fork') WHERE seq=1;").unwrap();
        assert!(fence.verify_upgrade(&a, &r, &peer).is_err());
        assert!(!fence.known(&r).unwrap());
        b.execute("UPDATE lan_history SET snapshot='{}' WHERE eid=(SELECT eid FROM lan_saved_inbox WHERE seq=1)",[]).unwrap();
        assert!(LegacyProof::read(&b, &r.reverse()).is_err());
    }

    #[test]
    fn mismatched_legacy_prefix_or_unconfirmed_offer_cannot_bootstrap_a_fence() {
        let r = Route {
            from: Uuid::new_v4(),
            to: Uuid::new_v4(),
            pair: Uuid::new_v4(),
        };
        let mut a = library(&r, "one");
        let mut b = library(&r.reverse(), "two");
        session::catch_up(&mut a, &r, &Store, |msg| {
            session::respond(&mut b, &r.reverse(), msg, &Store)
        })
        .unwrap();
        let mut af = PublicationFence::open(":memory:".as_ref()).unwrap();
        let bp = LegacyProof::read(&b, &r.reverse()).unwrap();
        a.execute(
            "UPDATE lan_saved_outbox SET eid=lower(hex(randomblob(16)))",
            [],
        )
        .unwrap();
        assert!(af.verify_upgrade(&a, &r, &bp).is_err());
        assert!(!af.known(&r).unwrap());
        a.execute("UPDATE lan_saved_peer SET offered=acked+1", [])
            .unwrap();
        assert!(af.prove(&a, &r).is_err());
    }
}
