use crate::lan_sync::{saved_delta::ReaderSaves, MergeBackup};
use base64::{engine::general_purpose::STANDARD, Engine};
use lexicue_lan_journal::{self as journal, checkpoint::PublicationFence, session, Route};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    ffi::{c_char, c_void, CStr, CString},
    fs,
    io::Write,
    os::{fd::AsRawFd, unix::ffi::OsStrExt},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use uuid::Uuid;

type Exchange = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
type EngineFn = unsafe extern "C" fn(
    *const c_char,
    *const c_char,
    *const c_char,
    *mut c_void,
    Option<Exchange>,
) -> *mut c_char;
extern "C" {
    fn lexicue_lan_start(
        replica: *const c_char,
        engine: EngineFn,
        release: unsafe extern "C" fn(*mut c_char),
    );
    fn lexicue_lan_command(json: *const c_char) -> *mut c_char;
    fn lexicue_lan_exclude_backup(path: *const c_char) -> bool;
}
struct Installation {
    app: tauri::AppHandle,
    database: PathBuf,
    private_dir: PathBuf,
    replica: Uuid,
    receive_closed: AtomicBool,
    fence: Mutex<PublicationFence>,
    _owner: fs::File,
}
static INSTALL: OnceLock<Installation> = OnceLock::new();
static OTHER_OWNER: AtomicBool = AtomicBool::new(false);
fn install() -> Result<&'static Installation, String> {
    INSTALL
        .get()
        .ok_or_else(|| "device_sync_unavailable".into())
}

pub fn initialize(app_dir: &Path, app: tauri::AppHandle) -> Result<(), String> {
    let dir = app_dir.join("lan-installation");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cdir = CString::new(dir.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    if !unsafe { lexicue_lan_exclude_backup(cdir.as_ptr()) } {
        return Err("could not exclude installation identity from backup".into());
    }
    let owner = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("owner.lock"))
        .map_err(|e| e.to_string())?;
    // One native restore/trust gate per library, even if a second Mac process
    // opens the same app container. flock is released on crash/process exit.
    if unsafe { libc::flock(owner.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        OTHER_OWNER.store(true, Ordering::Release);
        return Err("device_sync_in_other_window".into());
    }
    let id = dir.join("replica");
    if !id.try_exists().map_err(|e| e.to_string())? {
        let uuid = Uuid::new_v4().to_string();
        let tmp = dir.join(format!("creating-{uuid}"));
        let mut file = fs::File::create_new(&tmp).map_err(|e| e.to_string())?;
        file.write_all(uuid.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        let publish = fs::hard_link(&tmp, &id);
        fs::remove_file(tmp).map_err(|e| e.to_string())?;
        if let Err(e) = publish {
            if e.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(e.to_string());
            }
        }
        fs::File::open(&dir)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    let replica = fs::read_to_string(&id).map_err(|e| e.to_string())?;
    let uuid = Uuid::parse_str(replica.trim()).map_err(|e| e.to_string())?;
    let text = CString::new(uuid.to_string()).unwrap();
    INSTALL
        .set(Installation {
            app,
            database: app_dir.join("lexicue.db"),
            receive_closed: AtomicBool::new(dir.join("receive-closed").is_file()),
            fence: Mutex::new(PublicationFence::open(&dir.join("publication.db"))?),
            _owner: owner,
            private_dir: dir,
            replica: uuid,
        })
        .map_err(|_| "already initialized")?;
    unsafe {
        lexicue_lan_start(text.as_ptr(), engine, release);
    }
    Ok(())
}

pub fn receive_with_window_closed() -> bool {
    INSTALL
        .get()
        .is_some_and(|i| i.receive_closed.load(Ordering::Acquire))
}

fn native(action: &str, confirmation: Option<&str>) -> Result<Value, String> {
    let text =
        CString::new(json!({"action":action,"confirmationId":confirmation}).to_string()).unwrap();
    let ptr = unsafe { lexicue_lan_command(text.as_ptr()) };
    if ptr.is_null() {
        return Err("device_sync_unavailable".into());
    }
    let result = serde_json::from_slice(unsafe { CStr::from_ptr(ptr) }.to_bytes())
        .map_err(|e| e.to_string());
    unsafe {
        libc::free(ptr.cast());
    }
    result
}

pub fn command(action: &str, confirmation: Option<&str>) -> Result<Value, String> {
    let i = install()?;
    match action {
        "receiveClosedOn" | "receiveClosedOff" if cfg!(target_os = "macos") => {
            let enabled = action == "receiveClosedOn";
            let marker = i.private_dir.join("receive-closed");
            if enabled {
                fs::write(marker, []).map_err(|e| e.to_string())?;
            } else if let Err(e) = fs::remove_file(marker) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e.to_string());
                }
            }
            i.receive_closed.store(enabled, Ordering::Release);
        }
        "backups" => return backups(&i.database),
        "offer" | "scan" | "confirm" | "cancel" | "revoke" | "wake" | "status" => (),
        _ => return Err("invalid device sync action".into()),
    }
    let mut status = native(
        if action.starts_with("receiveClosed") {
            "status"
        } else {
            action
        },
        confirmation,
    )?;
    status["receiveClosed"] = json!(receive_with_window_closed());
    Ok(status)
}

fn backups(database: &Path) -> Result<Value, String> {
    let dir = database.with_file_name("backups");
    if !dir.try_exists().map_err(|e| e.to_string())? {
        return Ok(json!([]));
    }
    let mut entries = vec![];
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|s| s.strip_prefix("lexicue-pre-merge-"))
            .and_then(|s| s.strip_suffix(".db"))
            .and_then(|s| Uuid::parse_str(s).ok())
        else {
            continue;
        };
        let m = entry.metadata().map_err(|e| e.to_string())?;
        let created = m
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        entries.push((created, id));
    }
    entries.sort_unstable_by(|a, b| b.cmp(a));
    Ok(Value::Array(
        entries
            .into_iter()
            .map(|(created, id)| json!({"id":id,"created":created}))
            .collect(),
    ))
}
pub(super) fn read_backup(id: Uuid) -> Result<crate::commands::export::BackupPayload, String> {
    let db = MergeBackup::existing(&install()?.database, id).open_verified()?;
    crate::commands::export::backup_payload(&db)
}

fn identity() -> Result<Value, String> {
    let pair =
        rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
    let mut params = rcgen::CertificateParams::default();
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "LexiCue device");
    params.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![
        rcgen::ExtendedKeyUsagePurpose::ClientAuth,
        rcgen::ExtendedKeyUsagePurpose::ServerAuth,
    ];
    let cert = params.self_signed(&pair).map_err(|e| e.to_string())?;
    let password = Uuid::new_v4().to_string();
    let bundle = p12::PFX::new(
        cert.der(),
        &pair.serialize_der(),
        None,
        &password,
        "LexiCue",
    )
    .ok_or("identity export failed")?;
    Ok(json!({"p12":STANDARD.encode(bundle.to_der()),"password":password}))
}

unsafe extern "C" fn release(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(CString::from_raw(ptr));
    }
}

// All pointers are borrowed for this call. The only output freed by Swift
// with release() is the owned Rust CString. exchange() uses Swift strdup().
unsafe extern "C" fn engine(
    action: *const c_char,
    route: *const c_char,
    input: *const c_char,
    ctx: *mut c_void,
    exchange: Option<Exchange>,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| execute_engine(action, route, input, ctx, exchange))
        .unwrap_or_else(|_| Err("engine failure".into()));
    let envelope = match result {
        Ok(v) => json!({"ok":v}),
        Err(e)
            if [
                "reconcil",
                "diverged",
                " fork",
                "different LAN pair",
                "retired publication epoch",
            ]
            .iter()
            .any(|reason| e.contains(reason)) =>
        {
            json!({"kind":"reconcile","error":"reconcile"})
        }
        Err(e) => json!({"error":e}),
    };
    CString::new(envelope.to_string()).unwrap().into_raw()
}

impl Installation {
    fn fence(&self) -> Result<std::sync::MutexGuard<'_, PublicationFence>, String> {
        self.fence
            .lock()
            .map_err(|_| "publication storage unavailable".into())
    }
}

unsafe fn execute_engine(
    action: *const c_char,
    route: *const c_char,
    input: *const c_char,
    ctx: *mut c_void,
    exchange: Option<Exchange>,
) -> Result<Value, String> {
    if action.is_null() {
        return Err("missing action".into());
    }
    let action = CStr::from_ptr(action).to_str().map_err(|e| e.to_string())?;
    if action == "identity" {
        return identity();
    }
    if route.is_null() {
        return Err("missing route".into());
    }
    let route: Route =
        serde_json::from_slice(CStr::from_ptr(route).to_bytes()).map_err(|e| e.to_string())?;
    let i = install()?;
    if route.from != i.replica || route.from == route.to || route.to.is_nil() || route.pair.is_nil()
    {
        return Err("incorrect installation".into());
    }
    // Independent connection: network waits never own the UI mutex.
    let mut db = Connection::open_with_flags(&i.database, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;")
        .map_err(|e| e.to_string())?;
    if action == "upgradeMode" {
        return Ok(json!(i.fence()?.upgrade_mode(&db, &route)?));
    }
    if action == "upgradeProof" {
        return serde_json::to_value(i.fence()?.prove(&db, &route)?).map_err(|e| e.to_string());
    }
    if action == "verifyUpgrade" {
        if input.is_null() {
            return Err("missing peer history".into());
        }
        let proof =
            serde_json::from_slice(CStr::from_ptr(input).to_bytes()).map_err(|e| e.to_string())?;
        i.fence()?.verify_upgrade(&db, &route, &proof)?;
        return Ok(Value::Null);
    }
    if action == "prepare" {
        let mut f = i.fence()?;
        if f.known(&route)? {
            f.publish(&db, &route)?;
            PublicationFence::mark_required(&db, &route)?;
        } else {
            if f.upgrade_mode(&db, &route)? != "new" {
                return Err(
                    "legacy publication needs mutual evidence; reconcile the replica".into(),
                );
            }
            // This route was explicitly confirmed on both devices. A copied
            // database may still name the old installation as active. Preserve
            // its complete checkpoint before rotating the delivery namespace.
            MergeBackup::prepare(&i.database, route.pair)?;
            if let Some(old) = active_route(&db)? {
                if old != route {
                    f.retire(&old)?;
                    deactivate(&db, &old)?;
                }
            }
            journal::install_library(&mut db, &route)?;
            f.register(&db, &route)?;
        }
        return Ok(Value::Null);
    }
    match action {
        "revoke" => {
            i.fence()?.retire(&route)?;
            if active_route(&db)?.as_ref() == Some(&route) {
                deactivate(&db, &route)?;
            }
            Ok(Value::Null)
        }
        "progress" => {
            serde_json::to_value(journal::progress(&db, &route)?).map_err(|e| e.to_string())
        }
        "hello" | "respond" => respond(i, &mut db, &route, input, action == "hello"),
        "run" => catch_up(i, &mut db, &route, ctx, exchange),
        _ => Err("unknown engine operation".into()),
    }
}

fn active_route(db: &Connection) -> Result<Option<Route>, String> {
    use rusqlite::OptionalExtension;
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='lan_saved_peer' AND type='table')", [], |r| r.get(0)).map_err(|e|e.to_string())?;
    if !exists {
        return Ok(None);
    }
    let row: Option<(String, String, String)> = db
        .query_row(
            "SELECT pair,local_replica,peer_replica FROM lan_saved_peer WHERE active=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(pair, from, to)| {
        let parse = |id: String| Uuid::parse_str(&id).map_err(|e| e.to_string());
        Ok(Route {
            pair: parse(pair)?,
            from: parse(from)?,
            to: parse(to)?,
        })
    })
    .transpose()
}

fn deactivate(db: &Connection, route: &Route) -> Result<(), String> {
    db.execute(
        "UPDATE lan_saved_peer SET active=0 WHERE pair=? AND local_replica=? AND peer_replica=?",
        [
            route.pair.to_string(),
            route.from.to_string(),
            route.to.to_string(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

unsafe fn respond(
    i: &Installation,
    db: &mut Connection,
    route: &Route,
    input: *const c_char,
    needs_hello: bool,
) -> Result<Value, String> {
    if input.is_null() {
        return Err("missing request".into());
    }
    #[derive(serde::Deserialize)]
    struct Header {
        version: u8,
    }
    let raw = CStr::from_ptr(input).to_bytes();
    if serde_json::from_slice::<Header>(raw)
        .map_err(|e| e.to_string())?
        .version
        != session::SESSION_VERSION
    {
        return Err("incompatible session protocol version".into());
    }
    let req: session::Request = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    if needs_hello && !matches!(req.operation, session::Operation::Hello(_)) {
        return Err("verify replica history before delivering changes".into());
    }
    let publishes = matches!(
        req.operation,
        session::Operation::Hello(_)
            | session::Operation::Deliver(_)
            | session::Operation::Pull { .. }
            | session::Operation::Confirm(_)
    );
    if publishes {
        i.fence()?.publish(db, route)?;
    }
    let applying = matches!(req.operation, session::Operation::Deliver(_));
    let before = applying.then(|| journal::progress(db, route)).transpose()?;
    let reply = session::respond(db, route, req, &ReaderSaves)?;
    if publishes {
        i.fence()?.publish(db, route)?;
    }
    if let Some(previous) = before {
        notify_if_received(i, db, route, previous.received);
    }
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

unsafe fn catch_up(
    i: &Installation,
    db: &mut Connection,
    route: &Route,
    ctx: *mut c_void,
    exchange: Option<Exchange>,
) -> Result<Value, String> {
    let rpc = exchange.ok_or("missing channel")?;
    i.fence()?.publish(db, route)?;
    // catch_up owns its mutable connection. Observe only committed changes
    // through a separate connection before the transport publishes them.
    let observer = Connection::open_with_flags(&i.database, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    observer
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let previous = journal::progress(db, route)?.received;
    let result = session::catch_up(db, route, &ReaderSaves, |req| {
        if matches!(
            req.operation,
            session::Operation::Offer(_)
                | session::Operation::Deliver(_)
                | session::Operation::Confirm(_)
        ) {
            i.fence()?.publish(&observer, route)?;
        }
        call_peer(rpc, ctx, req)
    });
    notify_if_received(i, db, route, previous);
    result?;
    i.fence()?.publish(db, route)?;
    Ok(Value::Null)
}

unsafe fn call_peer(
    rpc: Exchange,
    ctx: *mut c_void,
    req: session::Request,
) -> Result<session::Reply, String> {
    let bytes = serde_json::to_vec(&req).map_err(|e| e.to_string())?;
    let text = CString::new(bytes).map_err(|e| e.to_string())?;
    let ptr = rpc(ctx, text.as_ptr());
    if ptr.is_null() {
        return Err("disconnected".into());
    }
    let copy = CStr::from_ptr(ptr).to_bytes().to_owned();
    libc::free(ptr.cast());
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Response {
        Error { error: String },
        Reply(session::Reply),
    }
    match serde_json::from_slice(&copy).map_err(|e| e.to_string())? {
        Response::Error { error } => Err(error),
        Response::Reply(reply) => Ok(reply),
    }
}

fn notify_if_received(i: &Installation, db: &Connection, route: &Route, before: i64) {
    use tauri::Emitter;
    if journal::progress(db, route).is_ok_and(|p| p.received > before) {
        let _ = i.app.emit("device-sync-applied", ());
    }
}

/// Only called from explicit local recovery, on a blocking worker. The app
/// database mutex also covers the recovery snapshot and replacement transaction.
pub(crate) fn with_restore_paused<T>(
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if native("status", None)?["state"] == "unsupported" {
        return work();
    }
    if OTHER_OWNER.load(Ordering::Acquire) {
        return Err("restore_in_other_window".into());
    }
    if INSTALL.get().is_none() {
        return work();
    }
    static RESTORE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _exclusive = RESTORE.try_lock().map_err(|_| "restore_in_progress")?;
    struct Pause;
    impl Drop for Pause {
        fn drop(&mut self) {
            let _ = native("endRestore", None);
        }
    }
    let mut state = native("beginRestore", None)?;
    let _pause = Pause;
    let start = std::time::Instant::now();
    while state["restoreReady"] != true {
        if state["state"] == "error" || start.elapsed() >= std::time::Duration::from_secs(35) {
            return Err("could not suspend device sync for local recovery".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
        state = native("status", None)?;
    }
    work()
}
