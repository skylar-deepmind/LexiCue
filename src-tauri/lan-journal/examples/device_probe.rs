//! Signed device QA host only. It uses a separate app container, synthetic
//! fixtures and the actual SQLite journal/session implementation.
use lexicue_lan_journal::{self as journal, session::*, Result, Route};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};
use uuid::Uuid;

#[path = "device_probe/material.rs"]
mod material;
struct Fixture;
impl SavedStore for Fixture {
    fn validate(&self, text: &str) -> Result<()> {
        let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        if value["expression"] != "take off" {
            return Err("unexpected fixture".into());
        }
        Ok(())
    }
    fn write(&self, db: &Connection, text: &str) -> Result<()> {
        let value: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        db.execute("INSERT INTO saved_records(record_id,revision,snapshot_json) VALUES(?1,?2,?3)
        ON CONFLICT(record_id) DO UPDATE SET revision=excluded.revision,snapshot_json=excluded.snapshot_json",
        params![value["record_id"].as_str(),value["revision"].as_str(),text]).map_err(|e|e.to_string())?;
        Ok(())
    }
}

type Rpc = extern "C" fn(*const c_char) -> *mut c_char;
extern "C" {
    fn free(ptr: *mut c_char);
}

fn run(
    path: &str,
    mac: bool,
    pair: Uuid,
    cmd: &str,
    input: &str,
    rpc: Option<Rpc>,
) -> Result<String> {
    let mut db = Connection::open(path).map_err(|e| e.to_string())?;
    db.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    let mac_id = Uuid::from_u128(1);
    let phone_id = Uuid::from_u128(2);
    let mac_route = Route {
        pair,
        from: mac_id,
        to: phone_id,
    };
    let local = if mac { mac_route } else { mac_route.reverse() };
    match cmd {
        "material-seed" => {
            material::seed(&mut db, &local, mac)?;
            Ok("seeded".into())
        }
        "material-dropped" => material::dropped(&db, &local, mac),
        "material-edit" => {
            material::edit(&db)?;
            Ok("edited".into())
        }
        "material-verify" | "material-verify-edited" => {
            material::verify(&db, &local, mac, cmd.ends_with("edited"))
        }
        "seed" => {
            db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS saved_records(id INTEGER PRIMARY KEY,record_id TEXT UNIQUE, revision TEXT NOT NULL,snapshot_json TEXT NOT NULL);").map_err(|e|e.to_string())?;
            journal::install(&mut db, &local)?;
            let id = if mac { "mac" } else { "phone" };
            let record = json!({"record_id":id,"revision":id,"origin":"reader","generation":0,"deleted_at":null,
                "expression":"take off","explanation_source":"personal","sentence":if mac {"The planes take off."} else {"Please take off your coat."}});
            let count: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM saved_records WHERE record_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count == 0 {
                Fixture.write(&db, &record.to_string())?;
            }
            Ok("seeded".into())
        }
        "respond" => {
            let request = serde_json::from_str(input).map_err(|e| e.to_string())?;
            let reply = respond(&mut db, &local, request, &Fixture)?;
            serde_json::to_string(&reply).map_err(|e| e.to_string())
        }
        "run" | "material-resume" | "material-patch" => {
            let mut sent_offset = None;
            let mut patch_events = 0;
            let mut json_bytes = 0;
            let exchange = rpc.ok_or("missing transport")?;
            catch_up(&mut db, &local, &Fixture, |req| {
                if let Operation::PutChunk(frame) = &req.operation {
                    sent_offset.get_or_insert(frame.cursor.offset);
                }
                if cmd == "material-patch"
                    && !matches!(
                        req.operation,
                        Operation::Hello | Operation::Pull { .. } | Operation::Confirm(_)
                    )
                {
                    return Err("unexpected extra edit transfer".into());
                }
                let req = CString::new(serde_json::to_vec(&req).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
                let ptr = exchange(req.as_ptr());
                if ptr.is_null() {
                    return Err("disconnected".into());
                }
                let response = unsafe { CStr::from_ptr(ptr) }.to_bytes();
                json_bytes += req.as_bytes().len() + response.len();
                let result = serde_json::from_slice(response).map_err(|e| e.to_string());
                unsafe { free(ptr) };
                let reply = result?;
                if cmd == "material-patch" {
                    material::check_patch(&reply, &mut patch_events)?
                }
                Ok(reply)
            })?;
            if cmd == "material-resume" && sent_offset != Some(32768) {
                return Err("incorrect resume offset".into());
            }
            if cmd == "material-patch" && patch_events != 1 {
                return Err(format!(
                    "unexpected number of translation events: {patch_events}"
                ));
            }
            Ok(if cmd == "material-patch" {
                format!("one translation event; {json_bytes} request/reply JSON bytes including handshake and ACK")
            } else {
                "caught up".into()
            })
        }
        "dropped" => {
            let p = journal::progress(&db, &local)?;
            let count: i64 = db
                .query_row("SELECT COUNT(*) FROM saved_records", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if (p.head, p.acked, p.received, count)
                != (1, 0, if mac { 0 } else { 1 }, if mac { 1 } else { 2 })
            {
                return Err(format!(
                    "incorrect state after lost ACK: {p:?} rows={count}"
                ));
            }
            Ok(format!(
                "locally acked=0, received={}, rows={count}",
                p.received
            ))
        }
        "verify" => {
            let p = journal::progress(&db, &local)?;
            let contents:String=db.query_row("SELECT group_concat(sentence,' / ') FROM
                (SELECT json_extract(snapshot_json,'$.sentence') AS sentence FROM saved_records ORDER BY record_id)",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if contents != "The planes take off. / Please take off your coat."
                || (p.head, p.acked, p.received) != (1, 1, 1)
            {
                return Err(format!("unexpected records or progress: {contents}, {p:?}"));
            }
            Ok("2 distinct contexts, 1 local event, sent ACK=1, received=1".into())
        }
        _ => Err("invalid probe command".into()),
    }
}

/// # Safety
/// All input pointers must be valid NUL-terminated strings for the duration
/// of the call. RPC must return a strdup-allocated string or NULL.
#[no_mangle]
pub unsafe extern "C" fn journal_probe(
    path: *const c_char,
    mac: bool,
    pair: *const c_char,
    cmd: *const c_char,
    input: *const c_char,
    rpc: Option<Rpc>,
) -> *mut c_char {
    let result = (|| {
        let text = |p| CStr::from_ptr(p).to_str().map_err(|e| e.to_string());
        run(
            text(path)?,
            mac,
            Uuid::parse_str(text(pair)?).map_err(|e| e.to_string())?,
            text(cmd)?,
            text(input)?,
            rpc,
        )
    })()
    .unwrap_or_else(|e| format!("ERROR {e}"));
    CString::new(result).unwrap().into_raw()
}
/// # Safety
/// Pass a live pointer returned by journal_probe, exactly once.
#[no_mangle]
pub unsafe extern "C" fn journal_probe_free(ptr: *mut c_char) {
    drop(CString::from_raw(ptr))
}
