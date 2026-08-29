//! End-to-end encrypted record synchronization.
//!
//! The official service stores only opaque current-state envelopes. Clients
//! converge records using stable sync identities and HLC clocks; there is no
//! user-visible server URL, source device, baseline, or checkpoint lifecycle.
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use tauri::State;
use uuid::Uuid;

use crate::{commands::export, db::DbState};

const CONFIG_KEY: &str = "cloud_sync_config_v1";
const DEVICE_KEY: &str = "cloud_sync_device_id_v1";
const AAD: &[u8] = b"lexicue/cloud-sync/v1";
const BLOB_CHUNK_SIZE: usize = 512 * 1024;
const BLOB_MANIFEST_MAGIC: &[u8] = b"LEXICUE-BLOB-V1\n";
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);
const VAULT_SERVICE: &str = "com.lexicue.cloud-sync";
const VAULT_ACCOUNT: &str = "credentials-v1";

static SECRET_STORE_READY: OnceLock<Result<(), String>> = OnceLock::new();

/// Keyring 4 no longer chooses an Android store implicitly. Initializing the
/// store during Tauri setup prevents the raw `No default store has been set`
/// dependency error and gives every platform the same lifecycle.
pub fn init_secret_store() -> Result<(), String> {
    SECRET_STORE_READY
        .get_or_init(|| {
            #[cfg(target_os = "android")]
            {
                use keyring_core::api::CredentialStoreApi;
                let store = android_native_keyring_store::Store::new_with_configuration(
                    &std::collections::HashMap::new(),
                )
                .map_err(|_| "credential_store_unavailable".to_string())?;
                keyring_core::set_default_store(store);
                Ok(())
            }
            #[cfg(not(target_os = "android"))]
            {
                keyring::Entry::store_status()
                    .as_ref()
                    .map(|_| ())
                    .map_err(|_| "credential_store_unavailable".to_string())
            }
        })
        .clone()
}

fn credential_entry() -> Result<keyring_core::Entry, String> {
    init_secret_store()?;
    keyring_core::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT)
        .map_err(|_| "credential_store_unavailable".to_string())
}

trait SecretStore {
    fn save(&self, value: &[u8]) -> Result<(), String>;
    fn load(&self) -> Result<Vec<u8>, String>;
    fn clear(&self) -> Result<(), String>;
}

struct NativeSecretStore;

impl SecretStore for NativeSecretStore {
    fn save(&self, value: &[u8]) -> Result<(), String> {
        credential_entry()?
            .set_secret(value)
            .map_err(|_| "credential_store_write_failed".to_string())
    }

    fn load(&self) -> Result<Vec<u8>, String> {
        credential_entry()?
            .get_secret()
            .map_err(|_| "credential_missing".to_string())
    }

    fn clear(&self) -> Result<(), String> {
        match credential_entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err("credential_store_write_failed".into()),
        }
    }
}

fn save_native_secrets(secrets: &SyncSecrets) -> Result<(), String> {
    NativeSecretStore
        .save(&serde_json::to_vec(secrets).map_err(|_| "credential_store_write_failed")?)
}

fn load_native_secrets() -> Result<SyncSecrets, String> {
    let bytes = NativeSecretStore.load()?;
    serde_json::from_slice(&bytes).map_err(|_| "credential_corrupted".to_string())
}

fn clear_native_secrets() -> Result<(), String> {
    NativeSecretStore.clear()
}

fn official_endpoint() -> Result<String, String> {
    #[cfg(debug_assertions)]
    let endpoint = option_env!("LEXICUE_SYNC_ENDPOINT").unwrap_or("http://localhost:8080");
    #[cfg(not(debug_assertions))]
    let endpoint = option_env!("LEXICUE_SYNC_ENDPOINT").ok_or("sync_service_not_configured")?;
    normalized_endpoint(endpoint)
}

#[derive(Clone, Serialize, Deserialize)]
struct LocalConfig {
    endpoint: String,
    email: String,
    device_id: String,
    /// Runtime-only values populated from the platform credential store.
    #[serde(default, skip_serializing)]
    access_token: String,
    #[serde(default, skip_serializing)]
    data_key: String,
    last_synced_at: Option<i64>,
    #[serde(default)]
    last_remote_cursor: i64,
    #[serde(default = "default_auto_sync")]
    auto_sync_enabled: bool,
}
fn default_auto_sync() -> bool {
    true
}

/// Opaque values held only by the platform credential store and Rust memory.
#[derive(Clone, Serialize, Deserialize)]
pub struct SyncSecrets {
    pub access_token: String,
    pub refresh_token: String,
    pub data_key: String,
    #[serde(default)]
    pub account_id: String,
}

#[derive(Serialize)]
pub struct AuthResult {
    pub recovery_code: Option<String>,
}

#[derive(Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub email: Option<String>,
    pub device_id: Option<String>,
    pub last_synced_at: Option<i64>,
    pub phase: String,
    pub pending_uploads: u32,
    pub pending_downloads: u32,
    pub conflicts: u32,
    pub last_error: Option<String>,
    pub last_uploaded: u32,
    pub last_downloaded: u32,
    pub auto_sync_enabled: bool,
    pub next_retry_at: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct SyncDevice {
    pub id: String,
    pub name: String,
    pub last_seen_at: String,
}
#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    key_package: String,
    device_id: String,
    account_id: String,
}
#[derive(Serialize)]
struct RefreshRequest {
    refresh_token: String,
}
#[derive(Serialize)]
struct RegisterRequest {
    email: String,
    password: String,
    install_id: String,
    device_name: String,
    key_package: String,
    recovery_verifier: String,
}
#[derive(Serialize)]
struct LoginRequest {
    email: String,
    password: String,
    install_id: String,
    device_name: String,
}
#[derive(Serialize)]
struct RecoveryPackageRequest {
    email: String,
    recovery_verifier: String,
}
#[derive(Serialize)]
struct PasswordResetRequest {
    email: String,
    recovery_verifier: String,
    password: String,
    key_package: String,
    install_id: String,
    device_name: String,
}
#[derive(Serialize, Deserialize)]
struct WrappedKey {
    salt: String,
    nonce: String,
    ciphertext: String,
}
#[derive(Serialize, Deserialize)]
struct KeyPackage {
    password: WrappedKey,
    recovery: WrappedKey,
}

#[derive(Serialize, Deserialize)]
struct EntityEvent {
    version: u8,
    table_name: String,
    sync_id: String,
    operation: String,
    record: Option<serde_json::Value>,
}
struct OutboxRow {
    event_id: String,
    entity_type: String,
    entity_id: String,
    ciphertext: Vec<u8>,
    base_etag: Option<String>,
    deleted: bool,
}

#[derive(Serialize)]
struct RecordBatchRequest {
    records: Vec<RecordUpload>,
}

#[derive(Serialize)]
struct RecordUpload {
    entity_type: String,
    entity_id: String,
    base_etag: Option<String>,
    schema_version: i16,
    deleted: bool,
    nonce: String,
    ciphertext: String,
}

#[derive(Clone, Deserialize)]
struct RemoteRecord {
    entity_type: String,
    entity_id: String,
    etag: String,
    seq: i64,
    schema_version: i16,
    deleted: bool,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
struct RecordBatchResponse {
    results: Vec<RecordUploadResult>,
}

#[derive(Deserialize)]
struct RecordUploadResult {
    entity_type: String,
    entity_id: String,
    status: String,
    etag: String,
    seq: i64,
    current: Option<RemoteRecord>,
}

#[derive(Deserialize)]
struct SyncHead {
    cursor: i64,
}

#[derive(Deserialize)]
struct Capabilities {
    protocol_version: i16,
}

struct PushResult {
    sent_event_ids: Vec<String>,
    accepted: Vec<(String, String, String, i64)>,
    conflicts: Vec<RemoteRecord>,
}

#[derive(Serialize, Deserialize)]
struct BlobManifest {
    version: u8,
    encrypted_len: usize,
    chunks: Vec<String>,
}

struct StagedRemoteRecord {
    remote: RemoteRecord,
    event: EntityEvent,
    clock: String,
}

fn config(conn: &rusqlite::Connection) -> Result<Option<LocalConfig>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_metadata WHERE key=?1",
            [CONFIG_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
        .transpose()
}
fn save_config(conn: &rusqlite::Connection, config: &LocalConfig) -> Result<(), String> {
    conn.execute("INSERT INTO sync_metadata(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", rusqlite::params![CONFIG_KEY, serde_json::to_string(config).map_err(|e| e.to_string())?, now_ms()]).map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_secrets(mut config: LocalConfig, secrets: &SyncSecrets) -> LocalConfig {
    config.access_token = secrets.access_token.clone();
    config.data_key = secrets.data_key.clone();
    config
}

fn device_id(conn: &rusqlite::Connection) -> Result<String, String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_metadata WHERE key=?1",
            [DEVICE_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(value) = existing {
        return Ok(value);
    }
    // Preserve the currently connected device when upgrading from the first
    // cloud-sync prototype; otherwise mint exactly one ID per installation.
    let value = config(conn)?
        .map(|item| item.device_id)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO sync_metadata(key,value,updated_at) VALUES(?1,?2,?3)",
        rusqlite::params![DEVICE_KEY, value, now_ms()],
    )
    .map_err(|error| error.to_string())?;
    Ok(value)
}
fn default_device_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "This device".into());
    format!("{} · {}", host, std::env::consts::OS)
}
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn set_runtime_phase(conn: &rusqlite::Connection, phase: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_runtime(key,value) VALUES('phase',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [phase],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn normalized_endpoint(endpoint: &str) -> Result<String, String> {
    let value = endpoint.trim().trim_end_matches('/');
    if value.is_empty() {
        return Err("sync_service_not_configured".into());
    }
    if value.starts_with("https://") || value.starts_with("http://localhost") {
        Ok(value.to_string())
    } else {
        Err("sync_service_not_configured".into())
    }
}
fn derive(secret: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut output = [0u8; 32];
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19 * 1024, 2, 1, Some(32)).map_err(|e| e.to_string())?,
    )
    .hash_password_into(secret.as_bytes(), salt, &mut output)
    .map_err(|e| e.to_string())?;
    Ok(output)
}
fn wrap(key: &[u8; 32], secret: &str) -> Result<WrappedKey, String> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let wrapping = derive(secret, &salt)?;
    let cipher = XChaCha20Poly1305::new((&wrapping).into());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload { msg: key, aad: AAD },
        )
        .map_err(|e| e.to_string())?;
    Ok(WrappedKey {
        salt: URL_SAFE_NO_PAD.encode(salt),
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
    })
}
fn unwrap(wrapped: &WrappedKey, secret: &str) -> Result<[u8; 32], String> {
    let salt = URL_SAFE_NO_PAD
        .decode(&wrapped.salt)
        .map_err(|_| "invalid encryption package")?;
    let nonce = URL_SAFE_NO_PAD
        .decode(&wrapped.nonce)
        .map_err(|_| "invalid encryption package")?;
    let encrypted = URL_SAFE_NO_PAD
        .decode(&wrapped.ciphertext)
        .map_err(|_| "invalid encryption package")?;
    let wrapping = derive(secret, &salt)?;
    let plaintext = XChaCha20Poly1305::new((&wrapping).into())
        .decrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload {
                msg: &encrypted,
                aad: AAD,
            },
        )
        .map_err(|_| "incorrect password or corrupted key package")?;
    plaintext.try_into().map_err(|_| "invalid data key".into())
}
fn recovery_code() -> String {
    let mut raw = [0u8; 16];
    OsRng.fill_bytes(&mut raw);
    raw.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .chunks(4)
        .map(|c| c.concat())
        .collect::<Vec<_>>()
        .join("-")
}
fn recovery_verifier(code: &str) -> String {
    format!("{:x}", Sha256::digest(code.as_bytes()))
}

fn record_aad(
    account_id: &str,
    entity_type: &str,
    entity_id: &str,
    schema_version: i16,
    deleted: bool,
) -> Vec<u8> {
    format!(
        "lexicue/sync-record/v1\0{account_id}\0{entity_type}\0{entity_id}\0{schema_version}\0{}",
        u8::from(deleted)
    )
    .into_bytes()
}

fn encrypt_record(
    master_key: &[u8; 32],
    account_id: &str,
    entity_type: &str,
    entity_id: &str,
    deleted: bool,
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    let key = derived_key(master_key, b"record-encryption");
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = XChaCha20Poly1305::new((&key).into())
        .encrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload {
                msg: plaintext,
                aad: &record_aad(account_id, entity_type, entity_id, 1, deleted),
            },
        )
        .map_err(|_| "record_encryption_failed".to_string())?;
    let mut result = nonce.to_vec();
    result.extend(encrypted);
    Ok(result)
}

fn decrypt_record(
    master_key: &[u8; 32],
    account_id: &str,
    record: &RemoteRecord,
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    if ciphertext.len() <= 24 {
        return Err("invalid_encrypted_record".into());
    }
    let key = derived_key(master_key, b"record-encryption");
    XChaCha20Poly1305::new((&key).into())
        .decrypt(
            XNonce::from_slice(&ciphertext[..24]),
            chacha20poly1305::aead::Payload {
                msg: &ciphertext[24..],
                aad: &record_aad(
                    account_id,
                    &record.entity_type,
                    &record.entity_id,
                    record.schema_version,
                    record.deleted,
                ),
            },
        )
        .map_err(|_| "record_authentication_failed".to_string())
}
fn key(config: &LocalConfig) -> Result<[u8; 32], String> {
    URL_SAFE_NO_PAD
        .decode(&config.data_key)
        .map_err(|_| "invalid local sync key")?
        .try_into()
        .map_err(|_| "invalid local sync key".into())
}

fn sync_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("sync HTTP client configuration is valid")
    })
}

fn write_safety_backup(conn: &rusqlite::Connection) -> Result<String, String> {
    let backup = export::backup_payload(conn)?;
    let database_path = conn
        .path()
        .ok_or("Could not determine local database path")?;
    let directory = std::path::Path::new(database_path)
        .parent()
        .ok_or("Could not determine local backup directory")?;
    let path = directory.join(format!("lexicue-before-cloud-restore-{}.json", now_ms()));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&backup).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not create local safety backup: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

fn sync_id_for(conn: &rusqlite::Connection, table: &str, local_id: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT sync_id FROM sync_entity_state WHERE table_name=?1 AND local_id=?2",
        rusqlite::params![table, local_id],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}
fn local_id_for(
    conn: &rusqlite::Connection,
    table: &str,
    sync_id: &str,
) -> Result<Option<i64>, String> {
    let canonical: String = conn.query_row("SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name=?1 AND alias_sync_id=?2", rusqlite::params![table,sync_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or_else(|| sync_id.to_string());
    conn.query_row("SELECT local_id FROM sync_entity_state WHERE table_name=?1 AND sync_id=?2 AND deleted_at IS NULL", rusqlite::params![table,canonical], |row| row.get(0)).optional().map_err(|e| e.to_string())
}
fn clock_now(conn: &rusqlite::Connection, device_id: &str) -> Result<String, String> {
    let previous: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_runtime WHERE key='hlc'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let previous_wall = previous
        .as_deref()
        .and_then(|value| value.split(':').next())
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0);
    let previous_counter = previous
        .as_deref()
        .and_then(|value| value.split(':').nth(1))
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    let wall = now_ms().max(previous_wall);
    let counter = if wall == previous_wall {
        previous_counter + 1
    } else {
        0
    };
    let clock = format!("{wall:020}:{counter:08}:{device_id}");
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('hlc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[&clock]).map_err(|e|e.to_string())?;
    Ok(clock)
}
fn json_value(value: rusqlite::types::Value) -> serde_json::Value {
    match value {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(v) => serde_json::json!(v),
        rusqlite::types::Value::Real(v) => serde_json::json!(v),
        rusqlite::types::Value::Text(v) => serde_json::json!(v),
        rusqlite::types::Value::Blob(_) => serde_json::Value::Null,
    }
}
fn row_record(
    conn: &rusqlite::Connection,
    table: &str,
    local_id: i64,
) -> Result<Option<serde_json::Value>, String> {
    let key = if matches!(table, "reviews" | "phrase_reviews") {
        if table == "reviews" {
            "word_id"
        } else {
            "phrase_id"
        }
    } else {
        "id"
    };
    let mut statement = conn
        .prepare(&format!("SELECT * FROM {table} WHERE {key}=?1"))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = (0..statement.column_count())
        .map(|i| statement.column_name(i).unwrap_or("").to_string())
        .collect();
    let mut rows = statement.query([local_id]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let mut value = serde_json::Map::new();
    for (index, name) in names.iter().enumerate() {
        if name != "id" {
            value.insert(
                name.clone(),
                json_value(row.get(index).map_err(|e| e.to_string())?),
            );
        }
    }
    // Foreign keys must never cross the network as a local integer.
    let references: &[(&str, &str)] = match table {
        "folders" => &[("parent_id", "folders")],
        "files" => &[("folder_id", "folders")],
        "segments" => &[("file_id", "files")],
        "occurrences" => &[("word_id", "words"), ("segment_id", "segments")],
        "phrase_occurrences" => &[("phrase_id", "phrases"), ("segment_id", "segments")],
        "review_logs" => &[("word_id", "words")],
        "phrase_review_logs" => &[("phrase_id", "phrases")],
        _ => &[],
    };
    for (column, target) in references {
        if let Some(id) = value.remove(*column).and_then(|v| v.as_i64()) {
            value.insert(
                format!("{column}_sync_id"),
                serde_json::json!(sync_id_for(conn, target, id)?),
            );
        }
    }
    Ok(Some(serde_json::Value::Object(value)))
}
fn set_runtime(conn: &rusqlite::Connection, applying: bool) -> Result<(), String> {
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('applying',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [if applying { "1" } else { "0" }]).map(|_|()).map_err(|e| e.to_string())
}
fn mark_state(
    conn: &rusqlite::Connection,
    table: &str,
    local_id: i64,
    sync_id: &str,
    clock: &str,
    deleted: bool,
) -> Result<(), String> {
    let time = clock
        .split(':')
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or_else(now_ms);
    conn.execute("INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at,clock) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(table_name,local_id) DO UPDATE SET sync_id=excluded.sync_id,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,clock=excluded.clock", rusqlite::params![table,local_id,sync_id,time,if deleted {Some(time)} else {None::<i64>},clock]).map_err(|e| e.to_string())?;
    Ok(())
}
fn string(
    record: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<String, String> {
    record
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("missing {key} in sync event"))
}
fn integer(record: &serde_json::Map<String, serde_json::Value>, key: &str) -> Result<i64, String> {
    record
        .get(key)
        .and_then(|v| v.as_i64())
        .ok_or_else(|| format!("missing {key} in sync event"))
}
fn optional_string(
    record: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    record.get(key).and_then(|v| v.as_str()).map(str::to_owned)
}

fn apply_entity_event(
    conn: &rusqlite::Connection,
    event: &EntityEvent,
    clock: &str,
) -> Result<bool, String> {
    let canonical = conn.query_row("SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name=?1 AND alias_sync_id=?2", rusqlite::params![event.table_name,event.sync_id], |r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.unwrap_or_else(||event.sync_id.clone());
    let existing_clock: Option<String> = conn
        .query_row(
            "SELECT clock FROM sync_entity_state WHERE table_name=?1 AND sync_id=?2",
            rusqlite::params![event.table_name, canonical],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if existing_clock.is_some_and(|value| !value.is_empty() && value.as_str() >= clock) {
        return Ok(false);
    }
    if event.operation == "delete" {
        let pending_edit: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_changes WHERE table_name=?1 AND sync_id IN (?2,?3) AND operation='upsert' AND uploaded_at IS NULL)",
                rusqlite::params![event.table_name, event.sync_id, canonical],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if pending_edit {
            // A concurrent local edit carries user data; keep it and let CAS
            // retry turn the tombstone back into an upsert.
            return Ok(false);
        }
        if let Some(local_id) = local_id_for(conn, &event.table_name, &canonical)? {
            set_runtime(conn, true)?;
            let key = if matches!(event.table_name.as_str(), "reviews" | "phrase_reviews") {
                if event.table_name == "reviews" {
                    "word_id"
                } else {
                    "phrase_id"
                }
            } else {
                "id"
            };
            conn.execute(
                &format!("DELETE FROM {} WHERE {}=?1", event.table_name, key),
                [local_id],
            )
            .map_err(|e| e.to_string())?;
            set_runtime(conn, false)?;
            mark_state(conn, &event.table_name, local_id, &canonical, clock, true)?;
        }
        return Ok(true);
    }
    let record = event
        .record
        .as_ref()
        .and_then(|v| v.as_object())
        .ok_or("sync upsert missing record")?;
    set_runtime(conn, true)?;
    let result = apply_record(conn, &event.table_name, &canonical, record);
    set_runtime(conn, false)?;
    let local_id = result?;
    let final_sync: String = conn.query_row("SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name=?1 AND alias_sync_id=?2",rusqlite::params![event.table_name,event.sync_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(canonical);
    mark_state(conn, &event.table_name, local_id, &final_sync, clock, false)?;
    if event.table_name == "review_logs" {
        if let Some(word) = record
            .get("word_id_sync_id")
            .and_then(|value| value.as_str())
            .and_then(|value| local_id_for(conn, "words", value).ok().flatten())
        {
            rebuild_review_cache(conn, "review_logs", "reviews", "word_id", word)?;
        }
    } else if event.table_name == "phrase_review_logs" {
        if let Some(phrase) = record
            .get("phrase_id_sync_id")
            .and_then(|value| value.as_str())
            .and_then(|value| local_id_for(conn, "phrases", value).ok().flatten())
        {
            rebuild_review_cache(
                conn,
                "phrase_review_logs",
                "phrase_reviews",
                "phrase_id",
                phrase,
            )?;
        }
    }
    Ok(true)
}

/// Review logs are immutable. Card rows are a cache rebuilt from the same
/// canonical ordering everywhere, so a late remote log never blindly
/// overwrites a locally scheduled card.
fn rebuild_review_cache(
    conn: &rusqlite::Connection,
    logs: &str,
    cards: &str,
    foreign_key: &str,
    entity_id: i64,
) -> Result<(), String> {
    let sql=format!("SELECT l.stability_after,l.difficulty_after,l.elapsed_days,l.scheduled_days,l.state_after,COALESCE(l.due_at_after,l.reviewed_at),l.reviewed_at,(SELECT clock FROM sync_entity_state s WHERE s.table_name=?1 AND s.local_id=l.id) FROM {logs} l WHERE l.{foreign_key}=?2 ORDER BY l.reviewed_at ASC, COALESCE((SELECT clock FROM sync_entity_state s WHERE s.table_name=?1 AND s.local_id=l.id),'') ASC, l.id ASC");
    let mut statement = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![logs, entity_id], |row| {
            Ok((
                row.get::<_, Option<f64>>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let Some(last) = rows.last() else {
        return Ok(());
    };
    let reps = rows.len() as i64;
    let lapses = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {logs} WHERE {foreign_key}=?1 AND rating=1"),
            [entity_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(&format!("INSERT INTO {cards}({foreign_key},due_at,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT({foreign_key}) DO UPDATE SET due_at=excluded.due_at,stability=excluded.stability,difficulty=excluded.difficulty,elapsed_days=excluded.elapsed_days,scheduled_days=excluded.scheduled_days,reps=excluded.reps,lapses=excluded.lapses,state=excluded.state,last_review_at=excluded.last_review_at"),rusqlite::params![entity_id,last.5,last.0.unwrap_or(0.0),last.1.unwrap_or(0.0),last.2.unwrap_or(0),last.3.unwrap_or(0),reps,lapses,last.4.unwrap_or(0),last.6]).map_err(|e|e.to_string())?;
    Ok(())
}

fn apply_record(
    conn: &rusqlite::Connection,
    table: &str,
    sync_id: &str,
    r: &serde_json::Map<String, serde_json::Value>,
) -> Result<i64, String> {
    if let Some(id) = local_id_for(conn, table, sync_id)? {
        if matches!(table, "words" | "phrases") {
            let local_definition: Option<String> = conn
                .query_row(
                    &format!("SELECT definition FROM {table} WHERE id=?1"),
                    [id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let remote_definition = optional_string(r, "definition");
            if local_definition
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                && remote_definition
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
                && local_definition != remote_definition
            {
                conn.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![table,sync_id,local_definition,remote_definition,now_ms()]).map_err(|e|e.to_string())?;
            }
        }
        match table {
            "folders" => {
                conn.execute(
                    "UPDATE folders SET name=?1,created_at=?2 WHERE id=?3",
                    rusqlite::params![string(r, "name")?, integer(r, "created_at")?, id],
                )
                .map_err(|e| e.to_string())?;
            }
            "files" => {
                let folder = optional_string(r, "folder_id_sync_id")
                    .map(|value| local_id_for(conn, "folders", &value))
                    .transpose()?
                    .flatten();
                conn.execute("UPDATE files SET name=?1,type=?2,content=?3,content_hash=?4,imported_at=?5,language=?6,folder_id=?7 WHERE id=?8",rusqlite::params![string(r,"name")?,string(r,"type")?,string(r,"content")?,string(r,"content_hash")?,integer(r,"imported_at")?,string(r,"language")?,folder,id]).map_err(|e|e.to_string())?;
            }
            "segments" => {
                let file = optional_string(r, "file_id_sync_id")
                    .map(|value| local_id_for(conn, "files", &value))
                    .transpose()?
                    .flatten()
                    .ok_or("sync segment is waiting for its file")?;
                conn.execute("UPDATE segments SET file_id=?1,index_num=?2,en_text=?3,zh_text=?4,start_time=?5,end_time=?6 WHERE id=?7",rusqlite::params![file,integer(r,"index_num")?,string(r,"en_text")?,optional_string(r,"zh_text"),optional_string(r,"start_time"),optional_string(r,"end_time"),id]).map_err(|e|e.to_string())?;
            }
            "words" => {
                conn.execute("UPDATE words SET status=?1,definition=?2,reading=?3,part_of_speech=?4 WHERE id=?5",rusqlite::params![string(r,"status")?,optional_string(r,"definition"),optional_string(r,"reading"),optional_string(r,"part_of_speech"),id]).map_err(|e|e.to_string())?;
            }
            "phrases" => {
                conn.execute(
                    "UPDATE phrases SET status=?1,definition=?2,source=?3 WHERE id=?4",
                    rusqlite::params![
                        string(r, "status")?,
                        optional_string(r, "definition"),
                        string(r, "source")?,
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            "occurrences" => {
                conn.execute(
                    "UPDATE occurrences SET hidden=?1 WHERE id=?2",
                    rusqlite::params![integer(r, "hidden").unwrap_or(0), id],
                )
                .map_err(|e| e.to_string())?;
            }
            "phrase_occurrences" => {
                conn.execute(
                    "UPDATE phrase_occurrences SET hidden=?1 WHERE id=?2",
                    rusqlite::params![integer(r, "hidden").unwrap_or(0), id],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => {}
        }
        return Ok(id);
    }
    // Natural-key convergence is essential when two offline imports discover
    // the same vocabulary or source document independently.
    let natural = match table {
        "words" => conn
            .query_row(
                "SELECT id FROM words WHERE language=?1 AND lemma=?2",
                rusqlite::params![string(r, "language")?, string(r, "lemma")?],
                |x| x.get(0),
            )
            .optional(),
        "phrases" => conn
            .query_row(
                "SELECT id FROM phrases WHERE language=?1 AND text=?2",
                rusqlite::params![string(r, "language")?, string(r, "text")?],
                |x| x.get(0),
            )
            .optional(),
        "files" => conn
            .query_row(
                "SELECT id FROM files WHERE language=?1 AND content_hash=?2",
                rusqlite::params![string(r, "language")?, string(r, "content_hash")?],
                |x| x.get(0),
            )
            .optional(),
        _ => Ok(None),
    }
    .map_err(|e| e.to_string())?;
    if let Some(id) = natural {
        if matches!(table, "words" | "phrases") {
            let local_definition: Option<String> = conn
                .query_row(
                    &format!("SELECT definition FROM {table} WHERE id=?1"),
                    [id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .flatten();
            let remote_definition = optional_string(r, "definition");
            if local_definition
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                && remote_definition
                    .as_deref()
                    .is_some_and(|value| !value.is_empty())
                && local_definition != remote_definition
            {
                conn.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![table,sync_id,local_definition,remote_definition,now_ms()]).map_err(|e|e.to_string())?;
            }
        }
        match table {
            "words" => {
                conn.execute("UPDATE words SET status=?1,definition=?2,reading=?3,part_of_speech=?4 WHERE id=?5",rusqlite::params![string(r,"status")?,optional_string(r,"definition"),optional_string(r,"reading"),optional_string(r,"part_of_speech"),id]).map_err(|e|e.to_string())?;
            }
            "phrases" => {
                conn.execute(
                    "UPDATE phrases SET status=?1,definition=?2,source=?3 WHERE id=?4",
                    rusqlite::params![
                        string(r, "status")?,
                        optional_string(r, "definition"),
                        string(r, "source")?,
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
            "files" => {
                let folder = optional_string(r, "folder_id_sync_id")
                    .map(|value| local_id_for(conn, "folders", &value))
                    .transpose()?
                    .flatten();
                conn.execute(
                    "UPDATE files SET name=?1,folder_id=?2 WHERE id=?3",
                    rusqlite::params![string(r, "name")?, folder, id],
                )
                .map_err(|e| e.to_string())?;
            }
            _ => {}
        }
        let canonical = sync_id_for(conn, table, id)?;
        conn.execute("INSERT INTO sync_identity_aliases(table_name,alias_sync_id,canonical_sync_id) VALUES(?1,?2,?3) ON CONFLICT(table_name,alias_sync_id) DO UPDATE SET canonical_sync_id=excluded.canonical_sync_id",rusqlite::params![table,sync_id,canonical]).map_err(|e|e.to_string())?;
        return Ok(id);
    }
    let fk = |name: &str, target: &str| -> Result<Option<i64>, String> {
        match optional_string(r, &format!("{name}_sync_id")) {
            Some(value) => local_id_for(conn, target, &value),
            None => Ok(None),
        }
    };
    let id = match table {
        "folders" => {
            let parent = fk("parent_id", "folders")?;
            conn.execute(
                "INSERT INTO folders(name,parent_id,created_at) VALUES(?1,?2,?3)",
                rusqlite::params![string(r, "name")?, parent, integer(r, "created_at")?],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
        "files" => {
            let folder = fk("folder_id", "folders")?;
            conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language,folder_id) VALUES(?1,?2,?3,?4,?5,?6,?7)",rusqlite::params![string(r,"name")?,string(r,"type")?,string(r,"content")?,string(r,"content_hash")?,integer(r,"imported_at")?,string(r,"language")?,folder]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "segments" => {
            let file = fk("file_id", "files")?.ok_or("sync segment is waiting for its file")?;
            conn.execute("INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![file,integer(r,"index_num")?,string(r,"en_text")?,optional_string(r,"zh_text"),optional_string(r,"start_time"),optional_string(r,"end_time")]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "words" => {
            conn.execute("INSERT INTO words(language,lemma,status,definition,reading,part_of_speech) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![string(r,"language")?,string(r,"lemma")?,string(r,"status")?,optional_string(r,"definition"),optional_string(r,"reading"),optional_string(r,"part_of_speech")]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "phrases" => {
            conn.execute("INSERT INTO phrases(language,text,status,definition,source) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![string(r,"language")?,string(r,"text")?,string(r,"status")?,optional_string(r,"definition"),string(r,"source")?]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "occurrences" => {
            let word = fk("word_id", "words")?.ok_or("sync occurrence is waiting for its word")?;
            let segment = fk("segment_id", "segments")?
                .ok_or("sync occurrence is waiting for its segment")?;
            conn.execute("INSERT INTO occurrences(word_id,segment_id,original_form,position,hidden) VALUES(?1,?2,?3,?4,?5)",rusqlite::params![word,segment,string(r,"original_form")?,integer(r,"position")?,integer(r,"hidden").unwrap_or(0)]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "phrase_occurrences" => {
            let phrase = fk("phrase_id", "phrases")?
                .ok_or("sync phrase occurrence is waiting for its phrase")?;
            let segment = fk("segment_id", "segments")?
                .ok_or("sync phrase occurrence is waiting for its segment")?;
            conn.execute("INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden) VALUES(?1,?2,?3,?4)",rusqlite::params![phrase,segment,integer(r,"position")?,integer(r,"hidden").unwrap_or(0)]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "review_logs" => {
            let word = fk("word_id", "words")?.ok_or("sync review is waiting for its word")?;
            conn.execute("INSERT INTO review_logs(word_id,rating,reviewed_at,stability_before,stability_after,difficulty_before,difficulty_after,elapsed_days,scheduled_days,state_before,state_after,due_at_after) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",rusqlite::params![word,integer(r,"rating")?,integer(r,"reviewed_at")?,r.get("stability_before").and_then(|v|v.as_f64()),r.get("stability_after").and_then(|v|v.as_f64()),r.get("difficulty_before").and_then(|v|v.as_f64()),r.get("difficulty_after").and_then(|v|v.as_f64()),r.get("elapsed_days").and_then(|v|v.as_i64()),r.get("scheduled_days").and_then(|v|v.as_i64()),r.get("state_before").and_then(|v|v.as_i64()),r.get("state_after").and_then(|v|v.as_i64()),r.get("due_at_after").and_then(|v|v.as_i64())]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        "phrase_review_logs" => {
            let phrase = fk("phrase_id", "phrases")?
                .ok_or("sync phrase review is waiting for its phrase")?;
            conn.execute("INSERT INTO phrase_review_logs(phrase_id,rating,reviewed_at,stability_before,stability_after,difficulty_before,difficulty_after,elapsed_days,scheduled_days,state_before,state_after,due_at_after) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",rusqlite::params![phrase,integer(r,"rating")?,integer(r,"reviewed_at")?,r.get("stability_before").and_then(|v|v.as_f64()),r.get("stability_after").and_then(|v|v.as_f64()),r.get("difficulty_before").and_then(|v|v.as_f64()),r.get("difficulty_after").and_then(|v|v.as_f64()),r.get("elapsed_days").and_then(|v|v.as_i64()),r.get("scheduled_days").and_then(|v|v.as_i64()),r.get("state_before").and_then(|v|v.as_i64()),r.get("state_after").and_then(|v|v.as_i64()),r.get("due_at_after").and_then(|v|v.as_i64())]).map_err(|e|e.to_string())?;
            conn.last_insert_rowid()
        }
        _ => return Err(format!("unsupported sync entity {table}")),
    };
    Ok(id)
}

fn prepare_outbox(
    conn: &rusqlite::Connection,
    local: &LocalConfig,
    data_key: &[u8; 32],
    account_id: &str,
) -> Result<u32, String> {
    let mut statement=conn.prepare("SELECT id,table_name,sync_id,operation FROM sync_changes WHERE uploaded_at IS NULL ORDER BY id").map_err(|e|e.to_string())?;
    let changes = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut made = 0;
    for (change_id, table, sync_id, operation) in changes {
        // Card rows are deterministic caches rebuilt from append-only logs.
        if matches!(table.as_str(), "reviews" | "phrase_reviews") {
            conn.execute(
                "UPDATE sync_changes SET uploaded_at=?1 WHERE id=?2",
                rusqlite::params![now_ms(), change_id],
            )
            .map_err(|e| e.to_string())?;
            continue;
        }
        let exists: Option<String> = conn
            .query_row(
                "SELECT event_id FROM sync_outbox WHERE change_id=?1",
                [change_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_some() {
            continue;
        }
        let mut record = if operation == "upsert" {
            let id = local_id_for(conn, &table, &sync_id)?
                .ok_or("sync record disappeared before it could be sent")?;
            row_record(conn, &table, id)?
        } else {
            None
        };
        let clock = clock_now(conn, &local.device_id)?;
        if let Some(serde_json::Value::Object(value)) = record.as_mut() {
            value.insert("_sync_clock".into(), serde_json::json!(clock));
        }
        let event = EntityEvent {
            version: 3,
            table_name: table.clone(),
            sync_id: sync_id.clone(),
            operation: operation.clone(),
            record,
        };
        let ciphertext = encrypt_record(
            data_key,
            account_id,
            &table,
            &sync_id,
            operation == "delete",
            &serde_json::to_vec(&event).map_err(|e| e.to_string())?,
        )?;
        if let Some(local_id) = local_id_for(conn, &table, &sync_id)? {
            mark_state(
                conn,
                &table,
                local_id,
                &sync_id,
                &clock,
                operation == "delete",
            )?;
        }
        conn.execute("INSERT INTO sync_outbox(event_id,change_id,device_id,clock,kind,ciphertext) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![Uuid::new_v4().to_string(),change_id,local.device_id,clock,table,ciphertext]).map_err(|e|e.to_string())?;
        made += 1;
    }
    Ok(made)
}
fn pending_outbox(conn: &rusqlite::Connection) -> Result<Vec<OutboxRow>, String> {
    let mut statement=conn.prepare("SELECT o.event_id,o.kind,c.sync_id,o.ciphertext,r.etag,c.operation FROM sync_outbox o JOIN sync_changes c ON c.id=o.change_id LEFT JOIN sync_remote_state r ON r.table_name=c.table_name AND r.sync_id=c.sync_id WHERE o.uploaded_at IS NULL ORDER BY o.change_id").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([], |r| {
            Ok(OutboxRow {
                event_id: r.get(0)?,
                entity_type: r.get(1)?,
                entity_id: r.get(2)?,
                ciphertext: r.get(3)?,
                base_etag: r.get(4)?,
                deleted: r.get::<_, String>(5)? == "delete",
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn blob_hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

async fn upload_blob_chunk(local: &LocalConfig, hash: &str, bytes: &[u8]) -> Result<(), String> {
    let client = sync_http_client();
    let url = format!("{}/v1/sync/blobs/{hash}", local.endpoint);
    let head = client
        .head(&url)
        .bearer_auth(&local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if head.status().is_success() {
        return Ok(());
    }
    if head.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(server_error(head).await);
    }
    let response = client
        .put(url)
        .bearer_auth(&local.access_token)
        .header("content-type", "application/octet-stream")
        .body(bytes.to_vec())
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(server_error(response).await)
    }
}

async fn record_upload(local: &LocalConfig, row: &OutboxRow) -> Result<RecordUpload, String> {
    if row.ciphertext.len() <= 24 {
        return Err("invalid_encrypted_record".into());
    }
    let encoded_ciphertext = if row.ciphertext.len() > BLOB_CHUNK_SIZE {
        let mut hashes = Vec::new();
        for chunk in row.ciphertext.chunks(BLOB_CHUNK_SIZE) {
            let hash = blob_hash(chunk);
            upload_blob_chunk(local, &hash, chunk).await?;
            hashes.push(hash);
        }
        let manifest = BlobManifest {
            version: 1,
            encrypted_len: row.ciphertext.len(),
            chunks: hashes,
        };
        let mut bytes = BLOB_MANIFEST_MAGIC.to_vec();
        bytes.extend(serde_json::to_vec(&manifest).map_err(|_| "invalid_blob_manifest")?);
        URL_SAFE_NO_PAD.encode(bytes)
    } else {
        URL_SAFE_NO_PAD.encode(&row.ciphertext[24..])
    };
    Ok(RecordUpload {
        entity_type: row.entity_type.clone(),
        entity_id: row.entity_id.clone(),
        base_etag: row.base_etag.clone(),
        schema_version: 1,
        deleted: row.deleted,
        nonce: URL_SAFE_NO_PAD.encode(&row.ciphertext[..24]),
        ciphertext: encoded_ciphertext,
    })
}

async fn push_outbox(local: &LocalConfig, rows: Vec<OutboxRow>) -> Result<PushResult, String> {
    let client = sync_http_client();
    let mut latest = std::collections::BTreeMap::<(String, String), &OutboxRow>::new();
    for row in &rows {
        latest.insert((row.entity_type.clone(), row.entity_id.clone()), row);
    }
    let selected: Vec<&OutboxRow> = latest.values().copied().collect();
    let mut sent_event_ids = Vec::new();
    let mut accepted = Vec::new();
    let mut conflicts = Vec::new();
    let mut batches = Vec::<Vec<RecordUpload>>::new();
    let mut current = Vec::new();
    let mut current_bytes = 0usize;
    for row in selected {
        let upload = record_upload(local, row).await?;
        let upload_bytes = upload.nonce.len()
            + upload.ciphertext.len()
            + upload.entity_type.len()
            + upload.entity_id.len()
            + 256;
        if !current.is_empty()
            && (current.len() == 100
                || current_bytes.saturating_add(upload_bytes) > 8 * 1024 * 1024)
        {
            batches.push(std::mem::take(&mut current));
            current_bytes = 0;
        }
        current_bytes = current_bytes.saturating_add(upload_bytes);
        current.push(upload);
    }
    if !current.is_empty() {
        batches.push(current);
    }
    for uploads in batches {
        let response = client
            .post(format!("{}/v1/sync/records/batch", local.endpoint))
            .bearer_auth(&local.access_token)
            .json(&RecordBatchRequest { records: uploads })
            .send()
            .await
            .map_err(|_| "network_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err(server_error(response).await);
        }
        let reply: RecordBatchResponse = response
            .json()
            .await
            .map_err(|_| "invalid_server_response".to_string())?;
        for result in reply.results {
            if result.status == "accepted" {
                for row in &rows {
                    if row.entity_type == result.entity_type && row.entity_id == result.entity_id {
                        sent_event_ids.push(row.event_id.clone());
                    }
                }
                accepted.push((
                    result.entity_type,
                    result.entity_id,
                    result.etag,
                    result.seq,
                ));
            } else if let Some(current) = result.current {
                conflicts.push(current);
            }
        }
    }
    Ok(PushResult {
        sent_event_ids,
        accepted,
        conflicts,
    })
}
async fn server_error(response: reqwest::Response) -> String {
    response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|value| {
            value
                .get("code")
                .and_then(|code| code.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "sync_service_error".into())
}

async fn ensure_capabilities(endpoint: &str) -> Result<(), String> {
    let response = sync_http_client()
        .get(format!("{endpoint}/v1/capabilities"))
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let capabilities: Capabilities = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    if capabilities.protocol_version != 1 {
        return Err("unsupported_sync_protocol".into());
    }
    Ok(())
}

fn entity_order(kind: &str) -> usize {
    match kind {
        "folders" => 0,
        "files" => 1,
        "segments" => 2,
        "words" | "phrases" => 3,
        "occurrences" | "phrase_occurrences" => 4,
        "review_logs" | "phrase_review_logs" => 5,
        _ => 6,
    }
}

async fn encrypted_remote_payload(
    local: &LocalConfig,
    record: &RemoteRecord,
) -> Result<Vec<u8>, String> {
    let nonce = URL_SAFE_NO_PAD
        .decode(&record.nonce)
        .map_err(|_| "invalid_encrypted_record")?;
    if nonce.len() != 24 {
        return Err("invalid_encrypted_record".into());
    }
    let body = URL_SAFE_NO_PAD
        .decode(&record.ciphertext)
        .map_err(|_| "invalid_encrypted_record")?;
    if !body.starts_with(BLOB_MANIFEST_MAGIC) {
        let mut encrypted = nonce;
        encrypted.extend(body);
        return Ok(encrypted);
    }
    let manifest: BlobManifest = serde_json::from_slice(&body[BLOB_MANIFEST_MAGIC.len()..])
        .map_err(|_| "invalid_blob_manifest")?;
    if manifest.version != 1 || manifest.encrypted_len <= 24 || manifest.chunks.is_empty() {
        return Err("invalid_blob_manifest".into());
    }
    let mut encrypted = Vec::with_capacity(manifest.encrypted_len);
    for hash in manifest.chunks {
        let response = sync_http_client()
            .get(format!("{}/v1/sync/blobs/{hash}", local.endpoint))
            .bearer_auth(&local.access_token)
            .send()
            .await
            .map_err(|_| "network_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err(server_error(response).await);
        }
        let chunk = response
            .bytes()
            .await
            .map_err(|_| "network_unavailable".to_string())?;
        if chunk.len() > BLOB_CHUNK_SIZE || blob_hash(&chunk) != hash {
            return Err("blob_hash_mismatch".into());
        }
        encrypted.extend_from_slice(&chunk);
    }
    if encrypted.len() != manifest.encrypted_len || encrypted[..24] != nonce {
        return Err("invalid_blob_manifest".into());
    }
    Ok(encrypted)
}

async fn stage_remote_records(
    local: &LocalConfig,
    data_key: &[u8; 32],
    account_id: &str,
    records: Vec<RemoteRecord>,
) -> Result<Vec<StagedRemoteRecord>, String> {
    let mut staged = Vec::with_capacity(records.len());
    for remote in records {
        if remote.schema_version != 1 {
            return Err("unsupported_sync_protocol".into());
        }
        let encrypted = encrypted_remote_payload(local, &remote).await?;
        let event: EntityEvent =
            serde_json::from_slice(&decrypt_record(data_key, account_id, &remote, &encrypted)?)
                .map_err(|_| "invalid_encrypted_record")?;
        if event.version != 3
            || event.table_name != remote.entity_type
            || event.sync_id != remote.entity_id
            || (event.operation == "delete") != remote.deleted
        {
            return Err("record_authentication_failed".into());
        }
        let clock = event
            .record
            .as_ref()
            .and_then(|value| value.get("_sync_clock"))
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("{:020}:00000000:remote", remote.seq));
        staged.push(StagedRemoteRecord {
            remote,
            event,
            clock,
        });
    }
    Ok(staged)
}

fn apply_remote_records(
    conn: &rusqlite::Connection,
    records: &mut [StagedRemoteRecord],
) -> Result<u32, String> {
    records.sort_by_key(|record| {
        if record.remote.deleted {
            usize::MAX - entity_order(&record.remote.entity_type)
        } else {
            entity_order(&record.remote.entity_type)
        }
    });
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;
    let result = (|| -> Result<u32, String> {
        let mut applied = 0;
        for staged_record in records {
            let remote = &staged_record.remote;
            if apply_entity_event(conn, &staged_record.event, &staged_record.clock)? {
                applied += 1;
            }
            conn.execute("INSERT INTO sync_remote_state(table_name,sync_id,etag,server_seq) VALUES(?1,?2,?3,?4) ON CONFLICT(table_name,sync_id) DO UPDATE SET etag=excluded.etag,server_seq=excluded.server_seq", rusqlite::params![remote.entity_type,remote.entity_id,remote.etag,remote.seq]).map_err(|e|e.to_string())?;
        }
        Ok(applied)
    })();
    match result {
        Ok(applied) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(applied)
        }
        Err(value) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(value)
        }
    }
}
async fn pull_apply_events(
    state: &DbState,
    local: &mut LocalConfig,
    data_key: &[u8; 32],
    account_id: &str,
) -> Result<u32, String> {
    let client = sync_http_client();
    let response = client
        .get(format!("{}/v1/sync/head", local.endpoint))
        .bearer_auth(&local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let head: SyncHead = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    let mut after = local.last_remote_cursor;
    let mut records = Vec::new();
    while after < head.cursor {
        let response = client
            .get(format!(
                "{}/v1/sync/records?after={after}&until={}&limit=100",
                local.endpoint, head.cursor
            ))
            .bearer_auth(&local.access_token)
            .send()
            .await
            .map_err(|_| "network_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err(server_error(response).await);
        }
        let page: Vec<RemoteRecord> = response
            .json()
            .await
            .map_err(|_| "invalid_server_response".to_string())?;
        if page.is_empty() {
            break;
        }
        after = page.last().map(|record| record.seq).unwrap_or(after);
        records.extend(page);
    }
    let applied = if records.is_empty() {
        0
    } else {
        let mut staged = stage_remote_records(local, data_key, account_id, records).await?;
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        write_safety_backup(&conn)?;
        apply_remote_records(&conn, &mut staged)?
    };
    local.last_remote_cursor = head.cursor;
    Ok(applied)
}

#[tauri::command]
pub fn sync_status(state: State<DbState>) -> Result<SyncStatus, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let value = config(&conn)?;
    let pending_uploads: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_changes WHERE uploaded_at IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let conflict_count: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_conflicts WHERE resolved_at IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let runtime_count = |key: &str| {
        conn.query_row(
            "SELECT value FROM sync_runtime WHERE key=?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
    };
    let runtime_value = |key: &str| {
        conn.query_row(
            "SELECT value FROM sync_runtime WHERE key=?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
    };
    Ok(match value {
        Some(c) => SyncStatus {
            configured: true,
            email: Some(c.email),
            device_id: Some(c.device_id),
            last_synced_at: c.last_synced_at,
            phase: runtime_value("phase").unwrap_or_else(|| "idle".into()),
            pending_uploads,
            pending_downloads: 0,
            conflicts: conflict_count,
            last_error: runtime_value("last_error").filter(|value| !value.is_empty()),
            last_uploaded: runtime_count("last_uploaded"),
            last_downloaded: runtime_count("last_downloaded"),
            auto_sync_enabled: c.auto_sync_enabled,
            next_retry_at: runtime_value("next_retry_at").and_then(|value| value.parse().ok()),
        },
        None => SyncStatus {
            configured: false,
            email: None,
            device_id: None,
            last_synced_at: None,
            phase: "disconnected".into(),
            pending_uploads: 0,
            pending_downloads: 0,
            conflicts: 0,
            last_error: None,
            last_uploaded: 0,
            last_downloaded: 0,
            auto_sync_enabled: false,
            next_retry_at: None,
        },
    })
}
#[tauri::command]
pub fn sync_set_auto_sync(state: State<DbState>, enabled: bool) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut local = config(&conn)?.ok_or("Cloud sync is not configured.")?;
    local.auto_sync_enabled = enabled;
    save_config(&conn, &local)
}
#[tauri::command]
pub fn sync_set_diagnostic(
    state: State<DbState>,
    phase: String,
    last_error: Option<String>,
    next_retry_at: Option<i64>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    for (key, value) in [
        ("phase", phase),
        ("last_error", last_error.unwrap_or_default()),
        (
            "next_retry_at",
            next_retry_at.map(|v| v.to_string()).unwrap_or_default(),
        ),
    ] {
        conn.execute("INSERT INTO sync_runtime(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", rusqlite::params![key, value]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn queue_all_local_records(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) SELECT s.table_name,s.sync_id,CASE WHEN s.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,?1 FROM sync_entity_state s WHERE NOT EXISTS(SELECT 1 FROM sync_changes c WHERE c.table_name=s.table_name AND c.sync_id=s.sync_id AND c.uploaded_at IS NULL)",
        [now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn hmac_sha256(key: &[u8; 32], value: &[u8]) -> [u8; 32] {
    let mut inner_pad = [0x36u8; 64];
    let mut outer_pad = [0x5cu8; 64];
    for index in 0..key.len() {
        inner_pad[index] ^= key[index];
        outer_pad[index] ^= key[index];
    }
    let inner = Sha256::new()
        .chain_update(inner_pad)
        .chain_update(value)
        .finalize();
    Sha256::new()
        .chain_update(outer_pad)
        .chain_update(inner)
        .finalize()
        .into()
}

fn derived_key(master: &[u8; 32], purpose: &[u8]) -> [u8; 32] {
    // RFC 5869 HKDF-Extract with a protocol salt, followed by one Expand block.
    let salt: [u8; 32] = Sha256::digest(b"lexicue-sync-v1").into();
    let pseudorandom_key = hmac_sha256(&salt, master);
    let mut info = purpose.to_vec();
    info.push(1);
    hmac_sha256(&pseudorandom_key, &info)
}

fn stable_entity_id(key: &[u8; 32], kind: &str, parts: &[&str]) -> String {
    let mut value = kind.as_bytes().to_vec();
    for part in parts {
        value.push(0);
        value.extend_from_slice(part.trim().to_lowercase().as_bytes());
    }
    let id_key = derived_key(key, b"stable-id");
    hmac_sha256(&id_key, &value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Existing local rows were created before an account key existed. On first
/// enrollment, identities with a durable natural key are rewritten to an
/// account-scoped HMAC so independent devices converge without revealing the
/// lemma, phrase text, or content hash to the service.
fn stabilize_sync_ids(conn: &rusqlite::Connection, key: &[u8; 32]) -> Result<(), String> {
    for (table, query, kind) in [
        ("words", "SELECT id,language,lemma FROM words", "word"),
        ("phrases", "SELECT id,language,text FROM phrases", "phrase"),
        (
            "files",
            "SELECT id,language,content_hash FROM files",
            "file",
        ),
    ] {
        let mut statement = conn.prepare(query).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        for (local_id, first, second) in rows {
            let sync_id = stable_entity_id(key, kind, &[&first, &second]);
            conn.execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name=?2 AND local_id=?3",
                rusqlite::params![sync_id, table, local_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn save_account(
    conn: &rusqlite::Connection,
    endpoint: String,
    email: String,
    auth: AuthResponse,
    data_key: [u8; 32],
) -> Result<(), String> {
    stabilize_sync_ids(conn, &data_key)?;
    let secrets = SyncSecrets {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        data_key: URL_SAFE_NO_PAD.encode(data_key),
        account_id: auth.account_id,
    };
    save_native_secrets(&secrets)?;
    save_config(
        conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: String::new(),
            data_key: String::new(),
            last_synced_at: None,
            last_remote_cursor: 0,
            auto_sync_enabled: true,
        },
    )?;
    queue_all_local_records(conn)
}

fn record_setup_sync_error(state: &DbState, value: &str) {
    if let Ok(conn) = state.conn.lock() {
        let _ = conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [value]);
        let _ = set_runtime_phase(
            &conn,
            if value == "network_unavailable" {
                "offline"
            } else {
                "error"
            },
        );
    }
}
#[tauri::command]
pub async fn sync_register(
    state: State<'_, DbState>,
    email: String,
    password: String,
) -> Result<AuthResult, String> {
    if password.len() < 10 {
        return Err("invalid_password".into());
    }
    credential_entry()?;
    let endpoint = official_endpoint()?;
    ensure_capabilities(&endpoint).await?;
    let mut data_key = [0u8; 32];
    OsRng.fill_bytes(&mut data_key);
    let recovery_code = recovery_code();
    let package = KeyPackage {
        password: wrap(&data_key, &password)?,
        recovery: wrap(&data_key, &recovery_code)?,
    };
    let device_id = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        device_id(&conn)?
    };
    let device_name = default_device_name();
    let client = sync_http_client();
    let response = client
        .post(format!("{endpoint}/v1/auth/register"))
        .json(&RegisterRequest {
            email: email.clone(),
            password,
            install_id: device_id,
            device_name,
            key_package: serde_json::to_string(&package).map_err(|e| e.to_string())?,
            recovery_verifier: recovery_verifier(&recovery_code),
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let auth: AuthResponse = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        save_account(&conn, endpoint, email, auth, data_key)?;
    }
    if let Err(value) = sync_now_inner(&state).await {
        record_setup_sync_error(&state, &value);
    }
    Ok(AuthResult {
        recovery_code: Some(recovery_code),
    })
}
#[tauri::command]
pub async fn sync_login(
    state: State<'_, DbState>,
    email: String,
    password: String,
) -> Result<AuthResult, String> {
    credential_entry()?;
    let endpoint = official_endpoint()?;
    ensure_capabilities(&endpoint).await?;
    let device_id = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        device_id(&conn)?
    };
    let device_name = default_device_name();
    let client = sync_http_client();
    let response = client
        .post(format!("{endpoint}/v1/auth/login"))
        .json(&LoginRequest {
            email: email.clone(),
            password: password.clone(),
            install_id: device_id,
            device_name,
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let auth: AuthResponse = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    let package: KeyPackage =
        serde_json::from_str(&auth.key_package).map_err(|_| "invalid_key_package")?;
    let data_key = unwrap(&package.password, &password)?;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local_files: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap_or(0);
        if local_files > 0 {
            let _ = write_safety_backup(&conn)?;
        }
        save_account(&conn, endpoint, email, auth, data_key)?;
    }
    if let Err(value) = sync_now_inner(&state).await {
        record_setup_sync_error(&state, &value);
    }
    Ok(AuthResult {
        recovery_code: None,
    })
}

/// Recovers the encrypted data key with the one-time recovery code and then
/// replaces the password wrapping key. The service verifies a verifier of the
/// code but never receives the code or the decrypted data key.
#[tauri::command]
pub async fn sync_recover(
    state: State<'_, DbState>,
    email: String,
    recovery_code: String,
    password: String,
) -> Result<AuthResult, String> {
    if password.len() < 10 {
        return Err("invalid_password".into());
    }
    credential_entry()?;
    let endpoint = official_endpoint()?;
    ensure_capabilities(&endpoint).await?;
    let install_id = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        device_id(&conn)?
    };
    let device_name = default_device_name();
    let verifier = recovery_verifier(&recovery_code);
    let client = sync_http_client();
    let response = client
        .post(format!("{endpoint}/v1/auth/recovery-package"))
        .json(&RecoveryPackageRequest {
            email: email.clone(),
            recovery_verifier: verifier.clone(),
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let recovery: AuthResponse = response.json().await.map_err(|error| error.to_string())?;
    let old_package: KeyPackage =
        serde_json::from_str(&recovery.key_package).map_err(|_| "invalid_key_package")?;
    let data_key = unwrap(&old_package.recovery, &recovery_code)?;
    let package = KeyPackage {
        password: wrap(&data_key, &password)?,
        recovery: wrap(&data_key, &recovery_code)?,
    };
    let key_package = serde_json::to_string(&package).map_err(|error| error.to_string())?;
    let response = client
        .post(format!("{endpoint}/v1/auth/recover"))
        .json(&PasswordResetRequest {
            email: email.clone(),
            recovery_verifier: verifier,
            password,
            key_package,
            install_id,
            device_name,
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let auth: AuthResponse = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        save_account(&conn, endpoint, email, auth, data_key)?;
    }
    if let Err(value) = sync_now_inner(&state).await {
        record_setup_sync_error(&state, &value);
    }
    Ok(AuthResult {
        recovery_code: None,
    })
}
#[tauri::command]
pub async fn sync_run(state: State<'_, DbState>) -> Result<(), String> {
    match sync_now_inner(&state).await {
        Err(value) if value == "session_expired" || value == "auth_required" => {
            refresh_native_session(&state).await?;
            sync_now_inner(&state).await
        }
        result => result,
    }
}

async fn sync_now_inner(state: &DbState) -> Result<(), String> {
    let secrets = load_native_secrets()?;
    let (mut local, data_key) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        );
        let data_key = key(&local)?;
        (local, data_key)
    };
    ensure_capabilities(&local.endpoint).await?;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "downloading")?;
    }
    pull_apply_events(&state, &mut local, &data_key, &secrets.account_id).await?;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        prepare_outbox(&conn, &local, &data_key, &secrets.account_id)?;
    }
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "uploading")?;
    }
    let mut uploaded = 0u32;
    for attempt in 0..3 {
        let outbox = {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            pending_outbox(&conn)?
        };
        if outbox.is_empty() {
            break;
        }
        let pushed = push_outbox(&local, outbox).await?;
        let had_conflicts = !pushed.conflicts.is_empty();
        let mut staged_conflicts =
            stage_remote_records(&local, &data_key, &secrets.account_id, pushed.conflicts).await?;
        uploaded = uploaded.saturating_add(pushed.sent_event_ids.len() as u32);
        {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            for event_id in &pushed.sent_event_ids {
                conn.execute(
                    "UPDATE sync_outbox SET uploaded_at=?1 WHERE event_id=?2",
                    rusqlite::params![now_ms(), event_id],
                )
                .map_err(|e| e.to_string())?;
                conn.execute("UPDATE sync_changes SET uploaded_at=?1 WHERE id=(SELECT change_id FROM sync_outbox WHERE event_id=?2)",rusqlite::params![now_ms(),event_id]).map_err(|e|e.to_string())?;
            }
            for (table, sync_id, etag, seq) in &pushed.accepted {
                conn.execute("INSERT INTO sync_remote_state(table_name,sync_id,etag,server_seq) VALUES(?1,?2,?3,?4) ON CONFLICT(table_name,sync_id) DO UPDATE SET etag=excluded.etag,server_seq=excluded.server_seq",rusqlite::params![table,sync_id,etag,seq]).map_err(|e|e.to_string())?;
            }
            if had_conflicts {
                write_safety_backup(&conn)?;
                apply_remote_records(&conn, &mut staged_conflicts)?;
            }
        }
        if had_conflicts && attempt == 2 {
            return Err("sync_service_error".into());
        }
    }
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "downloading")?;
    }
    let downloaded = pull_apply_events(&state, &mut local, &data_key, &secrets.account_id).await?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    local.last_synced_at = Some(now_ms());
    save_config(&conn, &local)?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_uploaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[uploaded.to_string()]).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_downloaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[downloaded.to_string()]).map_err(|e|e.to_string())?;
    set_runtime_phase(&conn, "idle")?;
    Ok(())
}

async fn refresh_native_session(state: &DbState) -> Result<(), String> {
    let mut secrets = load_native_secrets()?;
    if secrets.refresh_token.is_empty() {
        return Err("auth_required".into());
    }
    let endpoint = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        config(&conn)?
            .ok_or("Cloud sync is not configured.")?
            .endpoint
    };
    let response = sync_http_client()
        .post(format!("{endpoint}/v1/auth/refresh"))
        .json(&RefreshRequest {
            refresh_token: secrets.refresh_token.clone(),
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let tokens: AuthResponse = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    secrets.access_token = tokens.access_token;
    secrets.refresh_token = tokens.refresh_token;
    if !tokens.account_id.is_empty() {
        secrets.account_id = tokens.account_id;
    }
    save_native_secrets(&secrets)
}

#[tauri::command]
pub async fn sync_logout(state: State<'_, DbState>) -> Result<(), String> {
    let secrets = load_native_secrets()?;
    if secrets.refresh_token.is_empty() {
        return Ok(());
    }
    let endpoint = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        config(&conn)?
            .ok_or("Cloud sync is not configured.")?
            .endpoint
    };
    let response = sync_http_client()
        .post(format!("{endpoint}/v1/auth/logout"))
        .json(&RefreshRequest {
            refresh_token: secrets.refresh_token,
        })
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(server_error(response).await)
    }
}

#[tauri::command]
pub fn sync_disconnect(state: State<DbState>) -> Result<(), String> {
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sync_metadata WHERE key=?1", [CONFIG_KEY])
            .map_err(|e| e.to_string())?;
    }
    clear_native_secrets()?;
    Ok(())
}
#[tauri::command]
pub async fn sync_devices(state: State<'_, DbState>) -> Result<Vec<SyncDevice>, String> {
    let secrets = load_native_secrets()?;
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    let response = sync_http_client()
        .get(format!("{}/v1/devices", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    response
        .json()
        .await
        .map_err(|e| format!("Invalid device response: {e}"))
}
#[tauri::command]
pub async fn sync_revoke_device(
    state: State<'_, DbState>,
    device_id: String,
) -> Result<(), String> {
    let secrets = load_native_secrets()?;
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    if device_id == local.device_id {
        return Err("cannot_revoke_current_device".into());
    }
    let response = sync_http_client()
        .delete(format!("{}/v1/devices/{device_id}", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_delete_account(state: State<'_, DbState>) -> Result<(), String> {
    let secrets = load_native_secrets()?;
    let local = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    let response = sync_http_client()
        .delete(format!("{}/v1/account", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM sync_metadata WHERE key=?1", [CONFIG_KEY])
        .map_err(|error| error.to_string())?;
    drop(conn);
    clear_native_secrets()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct MemorySecretStore(std::sync::Mutex<Option<Vec<u8>>>);

    impl SecretStore for MemorySecretStore {
        fn save(&self, value: &[u8]) -> Result<(), String> {
            *self.0.lock().map_err(|_| "credential_store_write_failed")? = Some(value.to_vec());
            Ok(())
        }
        fn load(&self) -> Result<Vec<u8>, String> {
            self.0
                .lock()
                .map_err(|_| "credential_corrupted")?
                .clone()
                .ok_or_else(|| "credential_missing".into())
        }
        fn clear(&self) -> Result<(), String> {
            *self.0.lock().map_err(|_| "credential_store_write_failed")? = None;
            Ok(())
        }
    }

    #[test]
    fn memory_secret_store_has_the_native_lifecycle_contract() {
        let store = MemorySecretStore::default();
        assert_eq!(store.load().unwrap_err(), "credential_missing");
        store.save(b"secret").unwrap();
        assert_eq!(store.load().unwrap(), b"secret");
        store.clear().unwrap();
        assert_eq!(store.load().unwrap_err(), "credential_missing");
    }
    #[test]
    fn key_package_requires_correct_secret() {
        let key = [7; 32];
        let wrapped = wrap(&key, "correct horse battery staple").unwrap();
        assert_eq!(
            unwrap(&wrapped, "correct horse battery staple").unwrap(),
            key
        );
        assert!(unwrap(&wrapped, "wrong").is_err());
    }
    #[test]
    fn record_aad_rejects_substitution_and_account_copy() {
        let key = [4; 32];
        let encrypted =
            encrypt_record(&key, "account-a", "words", "word-a", false, b"value").unwrap();
        let record = RemoteRecord {
            entity_type: "words".into(),
            entity_id: "word-a".into(),
            etag: "etag".into(),
            seq: 1,
            schema_version: 1,
            deleted: false,
            nonce: String::new(),
            ciphertext: String::new(),
        };
        assert_eq!(
            decrypt_record(&key, "account-a", &record, &encrypted).unwrap(),
            b"value"
        );
        assert!(decrypt_record(&key, "account-b", &record, &encrypted).is_err());
        let substituted = RemoteRecord {
            entity_id: "word-b".into(),
            ..record
        };
        assert!(decrypt_record(&key, "account-a", &substituted, &encrypted).is_err());
    }

    #[test]
    fn stable_ids_are_deterministic_normalized_and_purpose_separated() {
        let key = [8; 32];
        assert_eq!(
            stable_entity_id(&key, "word", &["EN", " Word "]),
            stable_entity_id(&key, "word", &["en", "word"])
        );
        assert_ne!(
            stable_entity_id(&key, "word", &["en", "word"]),
            stable_entity_id(&key, "phrase", &["en", "word"])
        );
        assert_ne!(
            derived_key(&key, b"stable-id"),
            derived_key(&key, b"record-encryption")
        );
    }

    #[test]
    fn recovery_verifier_does_not_contain_the_recovery_code() {
        let code = "A1B2-C3D4-E5F6-0123";
        assert_ne!(recovery_verifier(code), code);
        assert_eq!(recovery_verifier(code), recovery_verifier(code));
        assert_ne!(recovery_verifier(code), recovery_verifier("wrong"));
    }

    #[test]
    fn entity_event_merges_natural_word_key_and_newer_clock_wins() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection
            .execute(
                "INSERT INTO words(language,lemma,status) VALUES('en','merge','known')",
                [],
            )
            .unwrap();
        let local_id: i64 = connection
            .query_row("SELECT id FROM words WHERE lemma='merge'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let local_sync = sync_id_for(&connection, "words", local_id).unwrap();
        let event = EntityEvent {
            version: 3,
            table_name: "words".into(),
            sync_id: "remote-identity".into(),
            operation: "upsert".into(),
            record: Some(
                serde_json::json!({"language":"en","lemma":"merge","status":"learning","definition":null,"reading":null,"part_of_speech":null}),
            ),
        };
        assert!(apply_entity_event(
            &connection,
            &event,
            "00000000000000000010:00000000:device-b"
        )
        .unwrap());
        assert_eq!(
            connection
                .query_row("SELECT status FROM words WHERE id=?1", [local_id], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "learning"
        );
        let alias: String = connection.query_row("SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name='words' AND alias_sync_id='remote-identity'", [], |row| row.get(0)).unwrap();
        assert_eq!(alias, local_sync);
        assert!(!apply_entity_event(
            &connection,
            &event,
            "00000000000000000010:00000000:device-b"
        )
        .unwrap());
        assert!(!apply_entity_event(
            &connection,
            &event,
            "00000000000000000009:00000000:device-z"
        )
        .unwrap());
    }

    #[test]
    fn tombstone_prevents_older_remote_resurrection() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection
            .execute(
                "INSERT INTO words(language,lemma,status) VALUES('en','grave','known')",
                [],
            )
            .unwrap();
        let id: i64 = connection
            .query_row("SELECT id FROM words WHERE lemma='grave'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let sync_id = sync_id_for(&connection, "words", id).unwrap();
        connection
            .execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
        let delete = EntityEvent {
            version: 3,
            table_name: "words".into(),
            sync_id: sync_id.clone(),
            operation: "delete".into(),
            record: None,
        };
        assert!(apply_entity_event(
            &connection,
            &delete,
            "00000000000000000020:00000000:device-a"
        )
        .unwrap());
        let old = EntityEvent {
            version: 3,
            table_name: "words".into(),
            sync_id,
            operation: "upsert".into(),
            record: Some(
                serde_json::json!({"language":"en","lemma":"grave","status":"learning","definition":null,"reading":null,"part_of_speech":null}),
            ),
        };
        assert!(
            !apply_entity_event(&connection, &old, "00000000000000000019:00000000:device-z")
                .unwrap()
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM words WHERE lemma='grave'",
                    [],
                    |row| row.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn concurrent_local_edit_wins_over_remote_delete() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection.execute("INSERT INTO words(language,lemma,status,definition) VALUES('en','keep','learning','local note')", []).unwrap();
        let id: i64 = connection
            .query_row("SELECT id FROM words WHERE lemma='keep'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let sync_id = sync_id_for(&connection, "words", id).unwrap();
        let delete = EntityEvent {
            version: 3,
            table_name: "words".into(),
            sync_id,
            operation: "delete".into(),
            record: None,
        };
        assert!(
            !apply_entity_event(&connection, &delete, "99999999999999999999:00000000:remote")
                .unwrap()
        );
        assert_eq!(
            connection
                .query_row("SELECT definition FROM words WHERE id=?1", [id], |row| {
                    row.get::<_, String>(0)
                })
                .unwrap(),
            "local note"
        );
    }
}
