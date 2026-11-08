//! Incremental exchange for contextual reader saves on an already authenticated pair.
//! A replica UUID identifies one installation/database epoch, not a device name.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub mod material;
pub mod session;
pub type Result<T> = std::result::Result<T, String>;
pub const VERSION: u8 = 1;
const MAX_EVENTS: usize = 64;
const MAX_BYTES: usize = 4 * 1024 * 1024;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Route {
    pub pair: Uuid,
    pub from: Uuid,
    pub to: Uuid,
}
impl Route {
    pub fn reverse(&self) -> Self {
        Self {
            pair: self.pair,
            from: self.to,
            to: self.from,
        }
    }

    fn check(&self, db: &Connection) -> Result<()> {
        let matches: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM lan_saved_peer WHERE active=1 AND pair=?1 AND local_replica=?2 AND peer_replica=?3)",
            params![self.pair.to_string(),self.from.to_string(),self.to.to_string()], |r| r.get(0)).map_err(err)?;
        if matches {
            Ok(())
        } else {
            Err("inactive or different LAN pair/replica epoch".into())
        }
    }
}

/// The caller has already made a verified local safety backup. Begin tracking
/// existing and new saves at one SQLite transaction boundary.
pub fn install(db: &mut Connection, route: &Route) -> Result<()> {
    install_streams(db, route, false)
}

/// Call only after verifying the local pre-merge backup.
pub fn install_library(db: &mut Connection, route: &Route) -> Result<()> {
    install_streams(db, route, true)
}
fn install_streams(db: &mut Connection, route: &Route, materials: bool) -> Result<()> {
    db.pragma_update(None, "foreign_keys", true).map_err(err)?;
    db.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    tx.execute_batch(include_str!("schema.sql")).map_err(err)?;
    let first=tx.execute("INSERT INTO lan_saved_peer(singleton,pair,local_replica,peer_replica) VALUES(1,?1,?2,?3) ON CONFLICT(singleton) DO NOTHING",
        params![route.pair.to_string(),route.from.to_string(),route.to.to_string()]).map_err(err)?;
    route.check(&tx)?;
    if first == 1 {
        tx.execute(
            "INSERT INTO lan_saved_outbox(snapshot) SELECT snapshot_json FROM saved_records
            WHERE json_extract(snapshot_json,'$.origin')='reader' ORDER BY id",
            [],
        )
        .map_err(err)?;
    }
    if materials {
        material::install(&tx)?;
    }
    tx.commit().map_err(err)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Event {
    pub seq: i64,
    pub id: String,
    pub parent: Option<String>,
    pub snapshot: String,
    pub digest: String,
}

impl Event {
    fn checksum(&self, route: &Route) -> Result<String> {
        let bytes = serde_json::to_vec(&(
            VERSION,
            route,
            self.seq,
            &self.id,
            &self.parent,
            &self.snapshot,
        ))
        .map_err(err)?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Batch {
    pub version: u8,
    pub route: Route,
    pub events: Vec<Event>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Ack {
    pub version: u8,
    pub route: Route,
    pub seq: i64,
    pub digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Progress {
    pub materials: bool,
    pub head: i64,
    pub received: i64,
    pub acked: i64,
    pub offered: i64,
}
pub fn progress(db: &Connection, local: &Route) -> Result<Progress> {
    local.check(db)?;
    db.query_row("SELECT COALESCE((SELECT MAX(seq) FROM lan_saved_outbox),0),received,acked,offered,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='lan_material_files' AND type='table') FROM lan_saved_peer",
        [], |r|Ok(Progress{head:r.get(0)?,received:r.get(1)?,acked:r.get(2)?,offered:r.get(3)?,materials:r.get(4)?})).map_err(err)
}

fn read_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<Event> {
    Ok(Event {
        seq: row.get(0)?,
        id: row.get(1)?,
        parent: row.get(2)?,
        snapshot: row.get(3)?,
        digest: String::new(),
    })
}

/// Reconnection starts at the last *persisted ACK*. Reading/offering a batch
/// does not advance that ACK, even when the transport successfully sends it.
fn pending(
    db: &mut Connection,
    local: &Route,
    through: i64,
    validate: impl Fn(&str) -> Result<()>,
) -> Result<Option<Batch>> {
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let p = progress(&tx, local)?;
    if through > p.head || through < 0 {
        return Err("invalid sender head".into());
    }
    if through <= p.acked {
        return Ok(None);
    }
    let mut events = Vec::new();
    let mut bytes = 0usize;
    {
        let mut stmt=tx.prepare("SELECT seq,eid,parent,snapshot FROM lan_saved_outbox WHERE seq>?1 AND seq<=?2 ORDER BY seq LIMIT ?3").map_err(err)?;
        let mut rows = stmt
            .query(params![p.acked, through, MAX_EVENTS as i64])
            .map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            let length = row.get_ref(3).map_err(err)?.as_str().map_err(err)?.len();
            if length > MAX_BYTES {
                return Err("saved event requires chunked transfer".into());
            }
            if bytes + length > MAX_BYTES {
                break;
            }
            let mut event = read_event(row).map_err(err)?;
            if event.seq != p.acked + events.len() as i64 + 1 {
                return Err("sender log gap".into());
            }
            let mut single = false;
            if let Some(mut change) = material::parse(&event.snapshot)? {
                single = change.blob().is_some();
                if single && !events.is_empty() {
                    break;
                }
                material::transfer::seal(&tx, &mut event, &mut change)?;
            } else {
                validate(&event.snapshot)?;
            }
            event.digest = event.checksum(local)?;
            events.push(event);
            bytes += length;
            if single {
                break;
            }
        }
    }
    let end = events.last().ok_or("missing pending event")?.seq;
    tx.execute("UPDATE lan_saved_peer SET offered=max(offered,?1)", [end])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(Some(Batch {
        version: VERSION,
        route: local.clone(),
        events,
    }))
}

#[derive(Deserialize)]
struct Header {
    record_id: String,
    revision: String,
    origin: String,
    generation: i64,
    deleted_at: Option<i64>,
}

/// Called by the authenticated transport. Apply and validate use the app's real
/// record codec. No ACK value escapes the function if COMMIT fails.
pub fn receive(
    db: &mut Connection,
    local: &Route,
    batch: &Batch,
    validate: impl Fn(&str) -> Result<()>,
    apply: impl Fn(&Connection, &str) -> Result<()>,
) -> Result<Ack> {
    if batch.version != VERSION
        || batch.route != local.reverse()
        || batch.events.is_empty()
        || batch.events.len() > MAX_EVENTS
    {
        return Err("incompatible or misdirected saved batch".into());
    }
    db.pragma_update(None, "foreign_keys", true).map_err(err)?;
    db.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut received = progress(&tx, local)?.received;
    tx.execute("UPDATE lan_saved_peer SET applying=1", [])
        .map_err(err)?;
    let mut bytes = 0usize;
    for (index, event) in batch.events.iter().enumerate() {
        bytes = bytes.saturating_add(event.snapshot.len());
        if event.seq < 1
            || bytes > MAX_BYTES
            || event.id.len() != 32
            || !event.id.bytes().all(|b| b.is_ascii_hexdigit())
            || event.parent.as_ref().is_some_and(|p| p.len() > 128)
            || event.digest != event.checksum(&batch.route)?
            || (index > 0 && batch.events[index - 1].seq.checked_add(1) != Some(event.seq))
        {
            return Err("invalid saved event".into());
        }
        if event.seq <= received {
            let known:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM lan_saved_inbox WHERE seq=?1 AND eid=?2 AND digest=?3)",
                params![event.seq,event.id,event.digest],|r|r.get(0)).map_err(err)?;
            if !known {
                return Err("saved sequence fork; reconciliation required".into());
            }
            continue;
        }
        if received.checked_add(1) != Some(event.seq) {
            return Err("saved sequence gap".into());
        }
        if let Some(change) = material::parse(&event.snapshot)? {
            if event.parent.is_some() {
                return Err("unexpected material parent".into());
            }
            material::apply(&tx, event, change)?;
        } else {
            validate(&event.snapshot)?;
            merge(&tx, event, &apply)?;
        }
        tx.execute(
            "INSERT INTO lan_saved_inbox(seq,eid,digest) VALUES(?1,?2,?3)",
            params![event.seq, event.id, event.digest],
        )
        .map_err(err)?;
        received = event.seq;
    }
    tx.execute(
        "UPDATE lan_saved_peer SET applying=0, received=?1",
        [received],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    let last = batch.events.last().unwrap();
    Ok(Ack {
        version: VERSION,
        route: batch.route.clone(),
        seq: last.seq,
        digest: last.digest.clone(),
    })
}

fn merge(
    db: &Connection,
    event: &Event,
    apply: &impl Fn(&Connection, &str) -> Result<()>,
) -> Result<()> {
    let h: Header = serde_json::from_str(&event.snapshot).map_err(err)?;
    if h.origin != "reader"
        || h.record_id.is_empty()
        || h.revision.is_empty()
        || h.revision.len() > 128
        || h.generation < 0
    {
        return Err("invalid reader save".into());
    }
    let known: Option<(String, Option<String>)> = db
        .query_row(
            "SELECT snapshot,parent FROM lan_saved_versions WHERE entity=?1 AND rev=?2",
            params![h.record_id, h.revision],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if let Some((snapshot, parent)) = known {
        if snapshot != event.snapshot || (event.parent.is_some() && parent != event.parent) {
            return Err("saved revision fork".into());
        }
        return Ok(());
    }
    let depth = if let Some(parent) = &event.parent {
        let (depth,generation,was_deleted):(i64,i64,bool)=db.query_row("SELECT depth,json_extract(snapshot,'$.generation'),json_extract(snapshot,'$.deleted_at') IS NOT NULL FROM lan_saved_versions WHERE entity=?1 AND rev=?2",
            params![h.record_id,parent],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_|"missing saved parent version")?;
        if Some(h.generation)
            != generation.checked_add(i64::from(was_deleted && h.deleted_at.is_none()))
        {
            return Err("invalid saved restore generation".into());
        }
        depth.checked_add(1).ok_or("saved version depth overflow")?
    } else {
        0
    };
    db.execute(
        "INSERT INTO lan_saved_versions(entity,rev,parent,depth,snapshot) VALUES(?1,?2,?3,?4,?5)",
        params![h.record_id, h.revision, event.parent, depth, event.snapshot],
    )
    .map_err(err)?;
    // Independent edits remain retrievable as heads. Within a generation,
    // delete wins. Never use either wall clock to discard an edit.
    let winner:String=db.query_row("SELECT v.snapshot FROM lan_saved_versions v WHERE v.entity=?1
        AND NOT EXISTS(SELECT 1 FROM lan_saved_versions child WHERE child.entity=v.entity AND child.parent=v.rev)
        ORDER BY json_extract(v.snapshot,'$.generation') DESC,(json_extract(v.snapshot,'$.deleted_at') IS NOT NULL) DESC,
        (json_extract(v.snapshot,'$.explanation_source')='personal') DESC,v.depth DESC,v.rev DESC LIMIT 1",
        [&h.record_id],|r|r.get(0)).map_err(err)?;
    apply(db, &winner)
}

pub fn confirm(db: &mut Connection, local: &Route, ack: &Ack) -> Result<()> {
    if ack.version != VERSION || ack.route != *local || ack.seq <= 0 {
        return Err("misdirected saved ACK".into());
    }
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let p = progress(&tx, local)?;
    if ack.seq > p.offered {
        return Err("unoffered saved ACK".into());
    }
    let mut event = tx
        .query_row(
            "SELECT seq,eid,parent,snapshot FROM lan_saved_outbox WHERE seq=?1",
            [ack.seq],
            read_event,
        )
        .map_err(err)?;
    if let Some(mut change) = material::parse(&event.snapshot)? {
        material::transfer::seal(&tx, &mut event, &mut change)?;
    }
    if event.checksum(local)? != ack.digest {
        return Err("saved ACK checksum mismatch".into());
    }
    tx.execute("UPDATE lan_saved_peer SET acked=max(acked,?1)", [ack.seq])
        .map_err(err)?;
    tx.commit().map_err(err)
}
