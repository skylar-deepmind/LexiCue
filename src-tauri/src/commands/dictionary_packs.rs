//! One bundled read-only pack and independently installed, hash-pinned supplements.
//! Installation never opens lexicue.db. A staging directory becomes visible only
//! after archive, manifest, member and SQLite validation have all succeeded.
use super::wiktionary_local::{self as local, Pack, R};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::{Emitter, Manager};

const CATALOG: &str = include_str!("../../resources/dictionaries/catalog.json");
fn catalog() -> &'static Value {
    static C: OnceLock<Value> = OnceLock::new();
    C.get_or_init(|| serde_json::from_str(CATALOG).expect("pinned dictionary catalog"))
}
fn item(id: &str) -> R<&'static Value> {
    catalog()["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .ok_or_else(|| "dictionary_pack_unknown".into())
}
fn hash(path: &Path) -> R<String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = f.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buffer[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn verify_file(path: &Path, expected: &Value) -> R<()> {
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || fs::metadata(path).map_err(|e| e.to_string())?.len()
            != expected["bytes"]
                .as_u64()
                .ok_or("dictionary_manifest_invalid")?
        || hash(path)? != local::text(expected, "sha256")
    {
        return Err("dictionary_checksum_invalid".into());
    }
    Ok(())
}
fn open_verified(root: &Path, id: &str) -> R<Pack> {
    let p = item(id)?;
    verify_file(&root.join("dictionary.sqlite3"), &p["database"])?;
    let pack = Pack::open(&root.join("dictionary.sqlite3"), id)?;
    let check: String = pack
        .conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err("dictionary_database_invalid".into());
    }
    Ok(pack)
}

#[derive(Default)]
struct Store {
    bundled: PathBuf,
    installed: PathBuf,
    packs: Vec<Pack>,
    errors: Vec<(String, String)>,
    initialized: bool,
    fingerprint: String,
    relations: Option<Arc<super::longman::RelationCatalog>>,
}
fn store() -> &'static Mutex<Store> {
    static S: OnceLock<Mutex<Store>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Store::default()))
}
fn operation() -> &'static Mutex<Option<Arc<AtomicBool>>> {
    static O: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();
    O.get_or_init(|| Mutex::new(None))
}
fn progress() -> &'static Mutex<Value> {
    static P: OnceLock<Mutex<Value>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(Value::Null))
}
struct Operation(Arc<AtomicBool>, File);
impl Operation {
    fn begin() -> R<Self> {
        let root = store().lock().map_err(|e| e.to_string())?.installed.clone();
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".operation.lock"))
            .map_err(|e| e.to_string())?;
        fs2::FileExt::try_lock_exclusive(&file).map_err(|_| "dictionary_pack_busy")?;
        let mut slot = operation().lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Err("dictionary_pack_busy".into());
        }
        let token = Arc::new(AtomicBool::new(false));
        *slot = Some(token.clone());
        Ok(Self(token, file))
    }
    fn check(&self) -> R<()> {
        if self.0.load(Ordering::Relaxed) {
            Err("dictionary_pack_cancelled".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.1);
        *operation().lock().unwrap_or_else(|e| e.into_inner()) = None;
        *progress().lock().unwrap_or_else(|e| e.into_inner()) = Value::Null;
    }
}
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn emit(app: &tauri::AppHandle, id: &str, phase: &str, completed: u64, total: u64) {
    let value = json!({"id":id,"phase":phase,"completed":completed,"total":total});
    *progress().lock().unwrap_or_else(|e| e.into_inner()) = value.clone();
    let _ = app.emit("dictionary-pack-progress", value);
}

pub fn configure(app: &tauri::AppHandle) {
    let mut s = store().lock().unwrap_or_else(|e| e.into_inner());
    s.bundled = app
        .path()
        .resource_dir()
        .unwrap_or_default()
        .join("resources/dictionaries/daily");
    #[cfg(debug_assertions)]
    if !s.bundled.join("dictionary.sqlite3").is_file() {
        s.bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/dictionaries/daily");
    }
    s.installed = app
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("dictionary-packs")
        .join(local::RELEASE);
    s.initialized = false;
}
/// Android assets have to be materialized before SQLite can open them. Other
/// platforms read the bundled DB in place and do not duplicate it in the library.
#[cfg(target_os = "android")]
fn prepare_android(app: &tauri::AppHandle) -> R<()> {
    use tauri_plugin_fs::FsExt;
    let installed = store().lock().map_err(|e| e.to_string())?.installed.clone();
    let root = installed.join("daily");
    {
        let s = store().lock().map_err(|e| e.to_string())?;
        if s.initialized
            && s.bundled == root
            && s.fingerprint == fingerprint(&s)
            && s.packs.iter().any(|p| p.id == "daily")
        {
            return Ok(());
        }
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if verify_file(
        &root.join("dictionary.sqlite3"),
        &item("daily")?["database"],
    )
    .is_err()
    {
        let path = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("resources/dictionaries/daily/dictionary.sqlite3");
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(true);
        let mut source = app.fs().open(path, options).map_err(|e| e.to_string())?;
        let _op = Operation::begin()?;
        let stage = staging()?;
        let temp = stage.0.join("dictionary.sqlite3");
        let mut dest = File::create(&temp).map_err(|e| e.to_string())?;
        std::io::copy(
            &mut std::io::Read::by_ref(&mut source)
                .take(item("daily")?["database"]["bytes"].as_u64().unwrap() + 1),
            &mut dest,
        )
        .map_err(|e| e.to_string())?;
        dest.sync_all().map_err(|e| e.to_string())?;
        verify_file(&temp, &item("daily")?["database"])?;
        fs::rename(temp, root.join("dictionary.sqlite3")).map_err(|e| e.to_string())?;
    }
    store().lock().map_err(|e| e.to_string())?.bundled = root;
    Ok(())
}
fn fingerprint(s: &Store) -> String {
    [
        s.bundled.join("dictionary.sqlite3"),
        s.installed.join("extended/dictionary.sqlite3"),
        s.installed.join("specialist/dictionary.sqlite3"),
    ]
    .iter()
    .map(|p| {
        format!(
            "{:?}:{:?}",
            p,
            fs::metadata(p).ok().map(|m| (m.len(), m.modified().ok()))
        )
    })
    .collect::<Vec<_>>()
    .join("|")
}
fn initialize(s: &mut Store) {
    let current = fingerprint(s);
    if s.initialized && s.fingerprint == current {
        return;
    }
    s.fingerprint = current;
    s.packs.clear();
    s.relations = None;
    s.errors.clear();
    for id in ["daily", "extended", "specialist"] {
        let root = if id == "daily" {
            s.bundled.clone()
        } else {
            s.installed.join(id)
        };
        if id != "daily" && !root.exists() {
            continue;
        }
        match open_verified(&root, id) {
            Ok(pack) => s.packs.push(pack),
            Err(error) => s.errors.push((id.into(), error)),
        }
    }
    s.initialized = true;
}
fn pack_relations(packs: &[Pack], fingerprint: String) -> R<super::longman::RelationCatalog> {
    let mut heads = HashSet::new();
    let mut spellings = HashSet::new();
    let mut targets: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut grammatical = HashSet::new();
    for pack in packs {
        let mut q = pack.conn.prepare("SELECT word,EXISTS(SELECT 1 FROM entries e WHERE e.surface_id=s.id) FROM surfaces s").map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (word, independent) = row.map_err(|e| e.to_string())?;
            spellings.insert(word.clone());
            if independent {
                heads.insert(word);
            }
        }
        // Only explicit grammatical relations grant history aliases. A second
        // source target prevents folding, even when one is uncommon.
        let mut q = pack.conn.prepare("SELECT s.word,t.word,a.kind IN (1,3) FROM aliases a JOIN surfaces s ON s.id=a.surface_id JOIN entries e ON e.source_line=a.entry_line JOIN surfaces t ON t.id=e.surface_id").map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (surface, target, inflection) = row.map_err(|e| e.to_string())?;
            if inflection {
                grammatical.insert(surface.clone());
            }
            targets.entry(surface).or_default().insert(target);
        }
    }
    targets.retain(|surface, _| grammatical.contains(surface));
    Ok(super::longman::RelationCatalog::from_pack_facts(
        fingerprint,
        heads,
        spellings,
        targets,
    ))
}
pub fn relation_catalog_configured() -> Arc<super::longman::RelationCatalog> {
    #[cfg(test)]
    if let Some(catalog) = super::longman::test_relation_override() {
        return catalog;
    }
    let mut s = store().lock().unwrap_or_else(|e| e.into_inner());
    initialize(&mut s);
    if let Some(catalog) = &s.relations {
        return catalog.clone();
    }
    let catalog = Arc::new(
        pack_relations(
            &s.packs,
            format!("wiktionary-pack-relations-v1:{}", s.fingerprint),
        )
        .unwrap_or_else(|_| {
            super::longman::RelationCatalog::from_pack_facts(
                "wiktionary-unavailable".into(),
                Default::default(),
                Default::default(),
                Default::default(),
            )
        }),
    );
    s.relations = Some(catalog.clone());
    catalog
}
pub fn query_configured(expression: &str, context: Option<&str>) -> Value {
    let mut s = store().lock().unwrap_or_else(|e| e.into_inner());
    initialize(&mut s);
    if s.packs.iter().all(|p| p.id != "daily") {
        return local::empty(expression, context, Some("dictionary_base_unavailable"));
    }
    local::query(&s.packs, expression, context)
        .unwrap_or_else(|e| local::empty(expression, context, Some(&e)))
}
pub fn initialize_runtime(app: &tauri::AppHandle) -> R<()> {
    #[cfg(target_os = "android")]
    prepare_android(app)?;
    #[cfg(not(target_os = "android"))]
    let _ = app;
    // An OS lock ensures a second process cannot purge an active download.
    if let Ok(_op) = Operation::begin() {
        let root = store().lock().map_err(|e| e.to_string())?.installed.clone();
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name
                .strip_prefix(".staging-")
                .is_some_and(|suffix| uuid::Uuid::parse_str(suffix).is_ok())
                && entry
                    .file_type()
                    .is_ok_and(|t| t.is_dir() && !t.is_symlink())
            {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    let mut s = store().lock().map_err(|e| e.to_string())?;
    s.initialized = false;
    initialize(&mut s);
    if s.packs.iter().any(|p| p.id == "daily") {
        Ok(())
    } else {
        Err("dictionary_base_unavailable".into())
    }
}
#[tauri::command]
pub async fn lookup_local_expression(expression: String, context: Option<String>) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || query_configured(&expression, context.as_deref()))
        .await
        .map_err(|e| e.to_string())
}
pub fn status_configured() -> R<Value> {
    let mut s = store().lock().map_err(|e| e.to_string())?;
    initialize(&mut s);
    let mut list = catalog()["packs"].clone();
    for p in list.as_array_mut().unwrap() {
        let id = local::text(p, "id").to_string();
        p["installed"] = json!(s.packs.iter().any(|pack| pack.id == id));
        p["error"] = s
            .errors
            .iter()
            .find(|(key, _)| key == &id)
            .map(|(_, e)| json!(e))
            .unwrap_or(Value::Null);
    }
    Ok(
        json!({"release":local::RELEASE,"packs":list,"operation":progress().lock().map_err(|e|e.to_string())?.clone(),"busy":operation().lock().map_err(|e|e.to_string())?.is_some()}),
    )
}
#[tauri::command]
pub async fn dictionary_pack_status(app: tauri::AppHandle) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        prepare_android(&app)?;
        #[cfg(not(target_os = "android"))]
        let _ = app;
        status_configured()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
pub fn configure_test(installed: PathBuf) {
    let mut s = store().lock().unwrap();
    s.bundled = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/dictionaries/daily");
    s.installed = installed;
    s.initialized = false;
}
#[cfg(test)]
pub fn install_test(id: &str, path: &Path) -> R<()> {
    optional(id)?;
    let op = Operation::begin()?;
    let stage = staging()?;
    let pack = extract(path, &stage.0.join("pack"), id, &op)?;
    drop(pack);
    activate(&stage.0.join("pack"), id, &op)
}

fn extract(archive: &Path, root: &Path, id: &str, op: &Operation) -> R<Pack> {
    let expected = item(id)?;
    verify_file(archive, &expected["archive"])?;
    op.check()?;
    let file = File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "dictionary_archive_invalid")?;
    let manifest: Value = {
        let mut member = zip
            .by_name("manifest.json")
            .map_err(|_| "dictionary_manifest_invalid")?;
        let mut bytes = Vec::new();
        member
            .by_ref()
            .take(65537)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 65536 {
            return Err("dictionary_manifest_invalid".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "dictionary_manifest_invalid")?
    };
    let files = manifest["files"]
        .as_object()
        .ok_or("dictionary_manifest_invalid")?;
    if manifest["pack_id"] != id
        || manifest["release"] != local::RELEASE
        || manifest["adapter_version"] != local::ADAPTER
        || files.get("dictionary.sqlite3") != Some(&expected["database"])
        || zip.len() != files.len() + 1
    {
        return Err("dictionary_manifest_invalid".into());
    }
    let mut seen = HashSet::new();
    fs::create_dir(root).map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        op.check()?;
        let mut member = zip
            .by_index(index)
            .map_err(|_| "dictionary_archive_invalid")?;
        let name = member.name().to_string();
        if !seen.insert(name.clone())
            || name.contains(['/', '\\'])
            || name == ".."
            || member.is_dir()
            || member
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("dictionary_archive_invalid".into());
        }
        let size = if name == "manifest.json" {
            65536
        } else {
            files
                .get(&name)
                .and_then(|v| v["bytes"].as_u64())
                .ok_or("dictionary_manifest_invalid")?
        };
        if member.size() > size || (name != "dictionary.sqlite3" && size > 65536) {
            return Err("dictionary_archive_invalid".into());
        }
        let path = root.join(&name);
        let mut dest = File::create(&path).map_err(|e| e.to_string())?;
        let mut count = 0u64;
        let mut buffer = [0; 65536];
        loop {
            op.check()?;
            let n = member
                .read(&mut buffer)
                .map_err(|_| "dictionary_archive_invalid")?;
            if n == 0 {
                break;
            }
            count += n as u64;
            if count > size {
                return Err("dictionary_archive_invalid".into());
            }
            dest.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        }
        dest.sync_all().map_err(|e| e.to_string())?;
        if name != "manifest.json" {
            verify_file(&path, &files[&name])?;
        }
    }
    open_verified(root, id)
}
fn activate(root: &Path, id: &str, op: &Operation) -> R<()> {
    let mut s = store().lock().map_err(|e| e.to_string())?;
    op.check()?;
    let target = s.installed.join(id);
    if target.exists() {
        return Err("dictionary_pack_already_installed".into());
    }
    fs::rename(root, &target).map_err(|e| e.to_string())?;
    match Pack::open(&target.join("dictionary.sqlite3"), id) {
        Ok(pack) => {
            s.relations = None;
            s.packs.push(pack);
            s.packs.sort_by(|a, b| a.id.cmp(&b.id));
            s.errors.retain(|(key, _)| key != id);
            s.fingerprint = fingerprint(&s);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_dir_all(target);
            Err(error)
        }
    }
}
fn staging() -> R<Staging> {
    let root = store().lock().map_err(|e| e.to_string())?.installed.clone();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let p = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&p).map_err(|e| e.to_string())?;
    Ok(Staging(p))
}
fn optional(id: &str) -> R<()> {
    item(id)?;
    if id == "daily" {
        Err("dictionary_base_required".into())
    } else {
        Ok(())
    }
}
#[tauri::command]
pub async fn install_dictionary_pack(app: tauri::AppHandle, id: String, path: String) -> R<()> {
    optional(&id)?;
    let op = Operation::begin()?;
    let result = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let id = id.clone();
        move || {
            let stage = staging()?;
            emit(&app, &id, "verifying", 0, 0);
            // The native FS plugin resolves Android content URIs and iOS security
            // scoped file URLs. Spool a bounded copy only during installation.
            use tauri_plugin_fs::{FilePath, FsExt};
            let input = match reqwest::Url::parse(&path) {
                Ok(url) if matches!(url.scheme(), "file" | "content") => FilePath::Url(url),
                _ => FilePath::Path(PathBuf::from(&path)),
            };
            let copied = (|| -> R<PathBuf> {
                let mut options = tauri_plugin_fs::OpenOptions::new();
                options.read(true);
                let mut source = app
                    .fs()
                    .open(input.clone(), options)
                    .map_err(|e| e.to_string())?;
                let temp = stage.0.join("input.zip");
                let mut file = File::create(&temp).map_err(|e| e.to_string())?;
                let max = item(&id)?["archive"]["bytes"].as_u64().unwrap();
                let mut bytes = 0;
                let mut buffer = [0u8; 65536];
                loop {
                    op.check()?;
                    let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    bytes += n as u64;
                    if bytes > max {
                        return Err("dictionary_checksum_invalid".into());
                    }
                    file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
                }
                file.sync_all().map_err(|e| e.to_string())?;
                Ok(temp)
            })();
            #[cfg(target_os = "ios")]
            let _ = app.fs().stop_accessing_security_scoped_resource(input);
            let archive = copied?;
            let pack = extract(&archive, &stage.0.join("pack"), &id, &op)?;
            drop(pack);
            activate(&stage.0.join("pack"), &id, &op)
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = app.emit("dictionary-packs-changed", ());
    result
}
async fn cancelled(op: &Operation) {
    loop {
        if op.0.load(Ordering::Relaxed) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
async fn fetch_archive(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    expected: &Value,
    op: &Operation,
    mut report: impl FnMut(u64, u64),
) -> R<()> {
    op.check()?;
    let total = expected["bytes"]
        .as_u64()
        .ok_or("dictionary_manifest_invalid")?;
    report(0, total);
    let response = tokio::select! {r=client.get(url).send()=>r.map_err(|_|"dictionary_download_failed")?,_=cancelled(op)=>return Err("dictionary_pack_cancelled".into())};
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("dictionary_download_unpublished".into());
    }
    let mut response = response
        .error_for_status()
        .map_err(|_| "dictionary_download_failed")?;
    if response.content_length().is_some_and(|n| n != total) {
        return Err("dictionary_checksum_invalid".into());
    }
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    let mut sha = Sha256::new();
    loop {
        let chunk = tokio::select! {r=tokio::time::timeout(std::time::Duration::from_secs(30),response.chunk())=>r.map_err(|_|"dictionary_download_failed")?.map_err(|_|"dictionary_download_failed")?,_=cancelled(op)=>return Err("dictionary_pack_cancelled".into())};
        let Some(chunk) = chunk else {
            break;
        };
        op.check()?;
        count += chunk.len() as u64;
        if count > total {
            return Err("dictionary_checksum_invalid".into());
        }
        sha.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        report(count, total);
    }
    op.check()?;
    if count != total || format!("{:x}", sha.finalize()) != local::text(expected, "sha256") {
        return Err("dictionary_checksum_invalid".into());
    }
    file.sync_all().await.map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn download_dictionary_pack(app: tauri::AppHandle, id: String) -> R<()> {
    optional(&id)?;
    let spec = item(&id)?;
    let url = spec["download_url"]
        .as_str()
        .ok_or("dictionary_download_unpublished")?;
    let parsed = reqwest::Url::parse(url).map_err(|_| "dictionary_download_url_invalid")?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.host_str() != Some("github.com")
        || !parsed
            .path()
            .starts_with("/skylar-deepmind/LexiCue/releases/download/")
    {
        return Err("dictionary_download_url_invalid".into());
    }
    let op = Operation::begin()?;
    let stage = staging()?;
    let archive = stage.0.join("download.zip");
    let total = spec["archive"]["bytes"].as_u64().unwrap();
    let result = async {
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(1800))
            .build()
            .map_err(|e| e.to_string())?;
        fetch_archive(
            &client,
            url,
            &archive,
            &spec["archive"],
            &op,
            |count, total| emit(&app, &id, "downloading", count, total),
        )
        .await?;
        emit(&app, &id, "verifying", total, total);
        let app2 = app.clone();
        let id2 = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let pack = extract(&archive, &stage.0.join("pack"), &id2, &op)?;
            drop(pack);
            emit(&app2, &id2, "installing", total, total);
            activate(&stage.0.join("pack"), &id2, &op)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    .await;
    let _ = app.emit("dictionary-packs-changed", ());
    result
}
#[tauri::command]
pub fn cancel_dictionary_pack() -> R<()> {
    if let Some(token) = operation().lock().map_err(|e| e.to_string())?.as_ref() {
        token.store(true, Ordering::Relaxed);
    }
    Ok(())
}
pub fn remove(id: &str) -> R<()> {
    optional(id)?;
    let _op = Operation::begin()?;
    let mut s = store().lock().map_err(|e| e.to_string())?;
    let target = s.installed.join(id);
    s.packs.retain(|p| p.id != id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| {
            s.initialized = false;
            e.to_string()
        })?;
    }
    s.errors.retain(|(key, _)| key != id);
    Ok(())
}
#[tauri::command]
pub async fn remove_dictionary_pack(app: tauri::AppHandle, id: String) -> R<()> {
    let result = tauri::async_runtime::spawn_blocking(move || remove(&id))
        .await
        .map_err(|e| e.to_string())?;
    let _ = app.emit("dictionary-packs-changed", ());
    result
}

#[cfg(test)]
#[path = "dictionary_packs_tests.rs"]
mod tests;
