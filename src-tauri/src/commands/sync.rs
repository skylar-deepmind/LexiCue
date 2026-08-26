//! End-to-end encrypted cloud backup/sync transport.
//!
//! The server sees only account metadata and ciphertext. The local database is
//! intentionally never replaced automatically: importing a remote snapshot is
//! a separate, user-confirmed recovery action added with the multi-device merge
//! UI. This keeps an unavailable or malicious server from interrupting study.
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
use std::sync::{Arc, OnceLock};
use tauri::State;
use uuid::Uuid;

use crate::{
    commands::export,
    db::{self, DbState},
};

const CONFIG_KEY: &str = "cloud_sync_config_v1";
const DEVICE_KEY: &str = "cloud_sync_device_id_v1";
const AAD: &[u8] = b"lexicue/cloud-sync/v1";
const CHUNK_SIZE: usize = 512 * 1024;
const TRANSFER_CONCURRENCY: usize = 6;
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);
const VAULT_SERVICE: &str = "com.lexicue.cloud-sync";
const VAULT_ACCOUNT: &str = "stronghold-unlock-key-v1";

/// Returns the random Stronghold unlock key kept by the operating system.
/// macOS uses Keychain; Android uses the native encrypted-keyring backend
/// backed by Android Keystore. It is never stored in SQLite or logged.
#[tauri::command]
pub fn sync_vault_key() -> Result<String, String> {
    let entry = keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(secret) => Ok(URL_SAFE_NO_PAD.encode(secret)),
        Err(keyring::Error::NoEntry) => {
            let mut secret = [0u8; 32];
            OsRng.fill_bytes(&mut secret);
            entry
                .set_secret(&secret)
                .map_err(|e| format!("Could not save the device vault key: {e}"))?;
            Ok(URL_SAFE_NO_PAD.encode(secret))
        }
        Err(error) => Err(format!(
            "Could not access the device security store: {error}"
        )),
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct LocalConfig {
    endpoint: String,
    email: String,
    device_id: String,
    /// Legacy-only fields. They are deliberately omitted on the next config
    /// write after being copied into Stronghold by the frontend migration.
    #[serde(default, skip_serializing)]
    access_token: String,
    #[serde(default, skip_serializing)]
    data_key: String,
    last_synced_at: Option<i64>,
    #[serde(default)]
    last_remote_cursor: i64,
    #[serde(default)]
    v3_initialized: bool,
    #[serde(default = "default_auto_sync")]
    auto_sync_enabled: bool,
}
fn default_auto_sync() -> bool {
    true
}

/// The opaque values held by the Stronghold vault. They intentionally travel
/// only over Tauri IPC and are never serialized into the local SQLite config.
#[derive(Clone, Serialize, Deserialize)]
pub struct SyncSecrets {
    pub access_token: String,
    pub refresh_token: String,
    pub data_key: String,
}

#[derive(Serialize)]
pub struct AuthResult {
    pub recovery_code: Option<String>,
    pub secrets: SyncSecrets,
}

#[derive(Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub email: Option<String>,
    pub endpoint: Option<String>,
    pub device_id: Option<String>,
    pub last_synced_at: Option<i64>,
    pub phase: String,
    pub pending_uploads: u32,
    pub pending_downloads: u32,
    pub conflicts: u32,
    pub last_error: Option<String>,
    pub v3_initialized: bool,
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
#[derive(Clone, Serialize, Deserialize)]
pub struct SyncCheckpoint {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub cursor: i64,
    pub encrypted_len: i64,
    pub created_at: String,
    #[serde(default = "checkpoint_protocol_v2")]
    pub protocol_version: i16,
}
fn checkpoint_protocol_v2() -> i16 {
    2
}
#[derive(Serialize)]
pub struct SyncCheckpointPreview {
    pub checkpoint: SyncCheckpoint,
    pub files: usize,
    pub folders: usize,
    pub words: usize,
    pub phrases: usize,
    pub review_logs: usize,
    pub local_files: usize,
    pub local_has_data: bool,
}
#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    key_package: String,
    device_id: String,
}
#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: String,
}
#[derive(Serialize)]
struct RefreshRequest {
    refresh_token: String,
}
#[derive(Serialize)]
struct RegisterRequest {
    email: String,
    password: String,
    device_id: String,
    device_name: String,
    key_package: String,
    recovery_verifier: String,
}
#[derive(Serialize)]
struct LoginRequest {
    email: String,
    password: String,
    device_id: String,
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
    device_id: String,
    device_name: String,
}
#[derive(Serialize, Deserialize)]
struct CheckpointManifest {
    version: u8,
    compression: String,
    encrypted_len: usize,
    chunks: Vec<String>,
    #[serde(default)]
    summary: Option<CheckpointSummary>,
}
#[derive(Clone, Serialize, Deserialize)]
struct CheckpointSummary {
    files: usize,
    folders: usize,
    words: usize,
    phrases: usize,
    review_logs: usize,
}
#[derive(Serialize)]
struct CheckpointUpload {
    id: String,
    cursor: i64,
    encrypted_len: i64,
    manifest: String,
    chunk_hashes: Vec<String>,
    protocol_version: i16,
}
#[derive(Deserialize)]
struct CheckpointDetail {
    #[serde(flatten)]
    checkpoint: SyncCheckpoint,
    manifest: String,
    chunk_hashes: Vec<String>,
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

/// The first v3 checkpoint carries the existing portable library together
/// with its stable identities. From that point forward remote events can refer
/// to records without depending on SQLite's per-device integer IDs.
#[derive(Serialize, Deserialize)]
struct V3Baseline {
    version: u8,
    backup: export::BackupPayload,
    entity_state: Vec<db::SyncEntityStateExport>,
}
#[derive(Serialize, Deserialize)]
struct EntityEvent {
    version: u8,
    table_name: String,
    sync_id: String,
    operation: String,
    record: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct RemoteEventMeta {
    seq: i64,
    event_id: String,
    #[serde(rename = "device_id")]
    _device_id: String,
    clock: String,
    kind: String,
}
type OutboxRow = (String, String, String, Vec<u8>);

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

/// Returns pre-Stronghold credentials without deleting them. The frontend
/// saves first, then calls `sync_finalize_legacy_credentials` so a crash can
/// never discard a user's only copy of the encrypted data key.
#[tauri::command]
pub fn sync_legacy_credentials(state: State<DbState>) -> Result<Option<SyncSecrets>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(config(&conn)?.and_then(|config| {
        (!config.access_token.is_empty() && !config.data_key.is_empty()).then_some(SyncSecrets {
            access_token: config.access_token,
            refresh_token: String::new(),
            data_key: config.data_key,
        })
    }))
}

#[tauri::command]
pub fn sync_finalize_legacy_credentials(state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if let Some(config) = config(&conn)? {
        // save_config skips the two legacy fields.
        save_config(&conn, &config)?;
    }
    Ok(())
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
    if value.starts_with("https://") || value.starts_with("http://localhost") {
        Ok(value.to_string())
    } else {
        Err("Sync server must use HTTPS (localhost is allowed for development).".into())
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
fn crypt_bytes(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload {
                msg: plaintext,
                aad: AAD,
            },
        )
        .map_err(|e| e.to_string())?;
    let mut result = nonce.to_vec();
    result.extend(encrypted);
    Ok(result)
}
fn decrypt_bytes(key: &[u8; 32], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if ciphertext.len() <= 24 {
        return Err("invalid encrypted sync payload".into());
    }
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&ciphertext[..24]),
            chacha20poly1305::aead::Payload {
                msg: &ciphertext[24..],
                aad: AAD,
            },
        )
        .map_err(|_| "encrypted sync payload could not be authenticated".into())
}
fn compress(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    zstd::stream::encode_all(plaintext, 9).map_err(|e| format!("sync compression failed: {e}"))
}
fn decompress(compressed: &[u8]) -> Result<Vec<u8>, String> {
    zstd::stream::decode_all(compressed).map_err(|e| format!("sync decompression failed: {e}"))
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn chunks(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes.chunks(CHUNK_SIZE)
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

async fn download_chunks(
    client: &reqwest::Client,
    local: &LocalConfig,
    hashes: &[String],
) -> Result<Vec<u8>, String> {
    let semaphore = Arc::new(tokio::sync::Semaphore::new(TRANSFER_CONCURRENCY));
    let mut tasks = Vec::with_capacity(hashes.len());
    for (position, expected_hash) in hashes.iter().cloned().enumerate() {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        let client = client.clone();
        let endpoint = local.endpoint.clone();
        let token = local.access_token.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit;
            let response = client
                .get(format!("{endpoint}/v2/chunks/{expected_hash}"))
                .bearer_auth(token)
                .send()
                .await
                .map_err(|error| format!("Encrypted chunk download failed: {error}"))?;
            if !response.status().is_success() {
                return Err(response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Encrypted chunk download failed".into()));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|error| error.to_string())?
                .to_vec();
            if hash(&bytes) != expected_hash {
                return Err("Encrypted chunk hash verification failed".into());
            }
            Ok::<_, String>((position, bytes))
        }));
    }
    let mut ordered = vec![Vec::new(); hashes.len()];
    for task in tasks {
        let (position, bytes) = task.await.map_err(|e| e.to_string())??;
        ordered[position] = bytes;
    }
    Ok(ordered.into_iter().flatten().collect())
}

async fn fetch_checkpoint_manifest(
    client: &reqwest::Client,
    local: &LocalConfig,
    data_key: &[u8; 32],
    checkpoint_id: &str,
) -> Result<(SyncCheckpoint, CheckpointManifest), String> {
    let response = client
        .get(format!("{}/v2/checkpoints/{checkpoint_id}", local.endpoint))
        .bearer_auth(&local.access_token)
        .send()
        .await
        .map_err(|error| format!("Checkpoint download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Checkpoint download failed".into()));
    }
    let detail: CheckpointDetail = response.json().await.map_err(|error| error.to_string())?;
    let manifest_ciphertext = URL_SAFE_NO_PAD
        .decode(detail.manifest)
        .map_err(|_| "Invalid encrypted checkpoint manifest")?;
    let manifest: CheckpointManifest =
        serde_json::from_slice(&decrypt_bytes(data_key, &manifest_ciphertext)?)
            .map_err(|_| "Invalid encrypted checkpoint manifest")?;
    if (manifest.version != 2 && manifest.version != 3)
        || manifest.compression != "zstd"
        || manifest.version as i16 != detail.checkpoint.protocol_version
        || manifest.chunks != detail.chunk_hashes
    {
        return Err("Checkpoint manifest does not match its encrypted chunk list".into());
    }
    Ok((detail.checkpoint, manifest))
}

async fn fetch_checkpoint_backup(
    client: &reqwest::Client,
    local: &LocalConfig,
    data_key: &[u8; 32],
    checkpoint_id: &str,
) -> Result<
    (
        SyncCheckpoint,
        export::BackupPayload,
        Option<Vec<db::SyncEntityStateExport>>,
    ),
    String,
> {
    let (checkpoint, manifest) =
        fetch_checkpoint_manifest(client, local, data_key, checkpoint_id).await?;
    let encrypted = download_chunks(client, local, &manifest.chunks).await?;
    if encrypted.len() != manifest.encrypted_len
        || encrypted.len() as i64 != checkpoint.encrypted_len
    {
        return Err("Checkpoint encrypted length verification failed".into());
    }
    let compressed = decrypt_bytes(data_key, &encrypted)?;
    let plaintext = decompress(&compressed)?;
    let (backup, state) = if manifest.version == 3 {
        let baseline = serde_json::from_slice::<V3Baseline>(&plaintext)
            .map_err(|_| "Invalid decrypted v3 checkpoint payload")?;
        (baseline.backup, Some(baseline.entity_state))
    } else {
        (
            serde_json::from_slice(&plaintext)
                .map_err(|_| "Invalid decrypted checkpoint payload")?,
            None,
        )
    };
    Ok((checkpoint, backup, state))
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

async fn upload_checkpoint_payload(
    local: &LocalConfig,
    data_key: &[u8; 32],
    payload: &[u8],
    protocol_version: i16,
) -> Result<(), String> {
    let checkpoint = crypt_bytes(data_key, &compress(payload)?)?;
    let client = sync_http_client().clone();
    let chunk_list: Vec<(usize, String, Vec<u8>)> = chunks(&checkpoint)
        .enumerate()
        .map(|(position, chunk)| (position, hash(chunk), chunk.to_vec()))
        .collect();
    let semaphore = Arc::new(tokio::sync::Semaphore::new(TRANSFER_CONCURRENCY));
    let mut tasks = Vec::with_capacity(chunk_list.len());
    for (position, chunk_hash, bytes) in chunk_list {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;
        let client = client.clone();
        let endpoint = local.endpoint.clone();
        let token = local.access_token.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = permit;
            let response = client
                .put(format!("{endpoint}/v2/chunks/{chunk_hash}"))
                .bearer_auth(token)
                .header("content-type", "application/octet-stream")
                .body(bytes)
                .send()
                .await
                .map_err(|e| format!("Sync upload failed: {e}"))?;
            if !response.status().is_success() {
                return Err(response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Sync chunk upload failed".into()));
            }
            Ok::<_, String>((position, chunk_hash))
        }));
    }
    let mut ordered_hashes = vec![String::new(); tasks.len()];
    for task in tasks {
        let (position, chunk_hash) = task.await.map_err(|e| e.to_string())??;
        ordered_hashes[position] = chunk_hash;
    }
    let chunk_hashes = ordered_hashes;
    let summary = if protocol_version == 3 {
        serde_json::from_slice::<V3Baseline>(payload)
            .ok()
            .map(|baseline| CheckpointSummary {
                files: baseline.backup.data.files.len(),
                folders: baseline.backup.data.folders.len(),
                words: baseline.backup.data.words.len(),
                phrases: baseline.backup.data.phrases.len(),
                review_logs: baseline.backup.data.review_logs.len(),
            })
    } else {
        serde_json::from_slice::<export::BackupPayload>(payload)
            .ok()
            .map(|backup| CheckpointSummary {
                files: backup.data.files.len(),
                folders: backup.data.folders.len(),
                words: backup.data.words.len(),
                phrases: backup.data.phrases.len(),
                review_logs: backup.data.review_logs.len(),
            })
    };
    let manifest = crypt_bytes(
        data_key,
        &serde_json::to_vec(&CheckpointManifest {
            version: protocol_version as u8,
            compression: "zstd".into(),
            encrypted_len: checkpoint.len(),
            chunks: chunk_hashes.clone(),
            summary,
        })
        .map_err(|e| e.to_string())?,
    )?;
    let response = client
        .post(format!("{}/v2/checkpoints", local.endpoint))
        .bearer_auth(&local.access_token)
        .header("x-sync-device-id", &local.device_id)
        .json(&CheckpointUpload {
            id: Uuid::new_v4().to_string(),
            cursor: local.last_remote_cursor,
            encrypted_len: checkpoint.len() as i64,
            manifest: URL_SAFE_NO_PAD.encode(manifest),
            chunk_hashes,
            protocol_version,
        })
        .send()
        .await
        .map_err(|e| format!("Checkpoint upload failed: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Checkpoint upload failed".into()));
    }
    Ok(())
}

fn prepare_outbox(
    conn: &rusqlite::Connection,
    local: &LocalConfig,
    data_key: &[u8; 32],
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
        let record = if operation == "upsert" {
            let id = local_id_for(conn, &table, &sync_id)?
                .ok_or("sync record disappeared before it could be sent")?;
            row_record(conn, &table, id)?
        } else {
            None
        };
        let event = EntityEvent {
            version: 3,
            table_name: table.clone(),
            sync_id: sync_id.clone(),
            operation: operation.clone(),
            record,
        };
        let ciphertext = crypt_bytes(
            data_key,
            &serde_json::to_vec(&event).map_err(|e| e.to_string())?,
        )?;
        let clock = clock_now(conn, &local.device_id)?;
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
    let mut statement=conn.prepare("SELECT event_id,clock,kind,ciphertext FROM sync_outbox WHERE uploaded_at IS NULL ORDER BY change_id").map_err(|e|e.to_string())?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Vec<u8>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}
async fn push_outbox(local: &LocalConfig, rows: Vec<OutboxRow>) -> Result<Vec<String>, String> {
    let client = sync_http_client();
    let mut sent = Vec::new();
    let mut start = 0usize;
    while start < rows.len() {
        let mut end = start;
        let mut estimated_size = 0usize;
        while end < rows.len()
            && end - start < 100
            && (end == start || estimated_size + rows[end].3.len() + 512 <= 12 * 1024 * 1024)
        {
            estimated_size += rows[end].3.len() + 512;
            end += 1;
        }
        if end == start {
            end += 1;
        }
        let batch = &rows[start..end];
        let mut body = Vec::new();
        for (event_id, clock, kind, ciphertext) in batch {
            let metadata = serde_json::to_vec(&serde_json::json!({
                "event_id": event_id,
                "device_id": local.device_id,
                "clock": clock,
                "kind": kind,
            }))
            .map_err(|e| e.to_string())?;
            body.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
            body.extend_from_slice(&metadata);
            body.extend_from_slice(&(ciphertext.len() as u32).to_be_bytes());
            body.extend_from_slice(ciphertext);
            sent.push(event_id.clone());
        }
        let response = client
            .post(format!("{}/v3/events/batch", local.endpoint))
            .bearer_auth(&local.access_token)
            .header(
                "content-type",
                "application/vnd.lexicue.sync-events+binary;v=3",
            )
            .body(body)
            .send()
            .await
            .map_err(|e| format!("Event upload failed: {e}"))?;
        if !response.status().is_success() {
            return Err(response
                .text()
                .await
                .unwrap_or_else(|_| "Event upload failed".into()));
        }
        start = end;
    }
    Ok(sent)
}
fn parse_event_frames(bytes: &[u8]) -> Result<Vec<(RemoteEventMeta, Vec<u8>)>, String> {
    let mut at = 0;
    let mut events = Vec::new();
    while at < bytes.len() {
        if at + 4 > bytes.len() {
            return Err("truncated sync event frame".into());
        }
        let meta_len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        at += 4;
        if at + meta_len + 4 > bytes.len() {
            return Err("truncated sync event metadata".into());
        }
        let meta: RemoteEventMeta = serde_json::from_slice(&bytes[at..at + meta_len])
            .map_err(|_| "invalid sync event metadata")?;
        at += meta_len;
        let payload_len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        at += 4;
        if at + payload_len > bytes.len() {
            return Err("truncated sync event payload".into());
        }
        events.push((meta, bytes[at..at + payload_len].to_vec()));
        at += payload_len;
    }
    Ok(events)
}
async fn pull_apply_events(
    state: &DbState,
    local: &mut LocalConfig,
    data_key: &[u8; 32],
) -> Result<u32, String> {
    let client = sync_http_client();
    let mut applied = 0;
    loop {
        let response = client
            .get(format!(
                "{}/v3/events?after={}&limit=100",
                local.endpoint, local.last_remote_cursor
            ))
            .bearer_auth(&local.access_token)
            .send()
            .await
            .map_err(|e| format!("Event download failed: {e}"))?;
        if response.status() == reqwest::StatusCode::GONE {
            return Err("This device is behind the retained event history. Restore the latest v3 cloud version before syncing.".into());
        }
        if !response.status().is_success() {
            return Err(response
                .text()
                .await
                .unwrap_or_else(|_| "Event download failed".into()));
        }
        let frames = parse_event_frames(&response.bytes().await.map_err(|e| e.to_string())?)?;
        if frames.is_empty() {
            break;
        }
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for (meta, ciphertext) in &frames {
                let done: Option<String> = conn
                    .query_row(
                        "SELECT event_id FROM sync_applied_events WHERE event_id=?1",
                        [&meta.event_id],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if done.is_none() {
                    let event: EntityEvent =
                        serde_json::from_slice(&decrypt_bytes(data_key, ciphertext)?)
                            .map_err(|_| "invalid decrypted sync event")?;
                    if event.version != 3 || event.table_name != meta.kind {
                        return Err("sync event metadata did not authenticate".into());
                    }
                    apply_entity_event(&conn, &event, &meta.clock)?;
                    conn.execute("INSERT INTO sync_applied_events(event_id,server_seq,applied_at) VALUES(?1,?2,?3)",rusqlite::params![meta.event_id,meta.seq,now_ms()]).map_err(|e|e.to_string())?;
                    applied += 1;
                }
                local.last_remote_cursor = meta.seq;
            }
            Ok(())
        })();
        match result {
            Ok(()) => {
                conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            }
            Err(error) => {
                let _ = conn.execute("ROLLBACK", []);
                return Err(error);
            }
        }
    }
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
            endpoint: Some(c.endpoint),
            device_id: Some(c.device_id),
            last_synced_at: c.last_synced_at,
            phase: runtime_value("phase").unwrap_or_else(|| "idle".into()),
            pending_uploads,
            pending_downloads: 0,
            conflicts: 0,
            last_error: runtime_value("last_error").filter(|value| !value.is_empty()),
            v3_initialized: c.v3_initialized,
            last_uploaded: runtime_count("last_uploaded"),
            last_downloaded: runtime_count("last_downloaded"),
            auto_sync_enabled: c.auto_sync_enabled,
            next_retry_at: runtime_value("next_retry_at").and_then(|value| value.parse().ok()),
        },
        None => SyncStatus {
            configured: false,
            email: None,
            endpoint: None,
            device_id: None,
            last_synced_at: None,
            phase: "disconnected".into(),
            pending_uploads: 0,
            pending_downloads: 0,
            conflicts: 0,
            last_error: None,
            v3_initialized: false,
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
#[tauri::command]
pub async fn sync_register(
    state: State<'_, DbState>,
    endpoint: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<AuthResult, String> {
    if password.len() < 10 {
        return Err("Password must contain at least 10 characters.".into());
    }
    let endpoint = normalized_endpoint(&endpoint)?;
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
    let device_name = if device_name.trim().is_empty() {
        default_device_name()
    } else {
        device_name
    };
    let client = sync_http_client();
    let response = client
        .post(format!("{endpoint}/v1/auth/register"))
        .json(&RegisterRequest {
            email: email.clone(),
            password,
            device_id: device_id.clone(),
            device_name,
            key_package: serde_json::to_string(&package).map_err(|e| e.to_string())?,
            recovery_verifier: recovery_verifier(&recovery_code),
        })
        .send()
        .await
        .map_err(|e| format!("Could not reach sync server: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Registration failed".into()));
    }
    let auth: AuthResponse = response.json().await.map_err(|e| e.to_string())?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let secrets = SyncSecrets {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        data_key: URL_SAFE_NO_PAD.encode(data_key),
    };
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: secrets.access_token.clone(),
            data_key: secrets.data_key.clone(),
            last_synced_at: None,
            last_remote_cursor: 0,
            v3_initialized: false,
            auto_sync_enabled: true,
        },
    )?;
    Ok(AuthResult {
        recovery_code: Some(recovery_code),
        secrets,
    })
}
#[tauri::command]
pub async fn sync_login(
    state: State<'_, DbState>,
    endpoint: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<AuthResult, String> {
    let endpoint = normalized_endpoint(&endpoint)?;
    let device_id = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        device_id(&conn)?
    };
    let device_name = if device_name.trim().is_empty() {
        default_device_name()
    } else {
        device_name
    };
    let client = sync_http_client();
    let response = client
        .post(format!("{endpoint}/v1/auth/login"))
        .json(&LoginRequest {
            email: email.clone(),
            password: password.clone(),
            device_id: device_id.clone(),
            device_name,
        })
        .send()
        .await
        .map_err(|e| format!("Could not reach sync server: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Login failed".into()));
    }
    let auth: AuthResponse = response.json().await.map_err(|e| e.to_string())?;
    let package: KeyPackage = serde_json::from_str(&auth.key_package)
        .map_err(|_| "Invalid encrypted key package from server")?;
    let data_key = unwrap(&package.password, &password)?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let secrets = SyncSecrets {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        data_key: URL_SAFE_NO_PAD.encode(data_key),
    };
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: secrets.access_token.clone(),
            data_key: secrets.data_key.clone(),
            last_synced_at: None,
            last_remote_cursor: 0,
            v3_initialized: false,
            auto_sync_enabled: true,
        },
    )?;
    Ok(AuthResult {
        recovery_code: None,
        secrets,
    })
}

/// Recovers the encrypted data key with the one-time recovery code and then
/// replaces the password wrapping key. The service verifies a verifier of the
/// code but never receives the code or the decrypted data key.
#[tauri::command]
pub async fn sync_reset_password(
    state: State<'_, DbState>,
    endpoint: String,
    email: String,
    recovery_code: String,
    password: String,
    device_name: String,
) -> Result<AuthResult, String> {
    if password.len() < 10 {
        return Err("Password must contain at least 10 characters.".into());
    }
    let endpoint = normalized_endpoint(&endpoint)?;
    let install_id = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        device_id(&conn)?
    };
    let device_name = if device_name.trim().is_empty() {
        default_device_name()
    } else {
        device_name
    };
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
        .map_err(|error| format!("Could not reach sync server: {error}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Recovery code was not accepted".into()));
    }
    let recovery: AuthResponse = response.json().await.map_err(|error| error.to_string())?;
    let old_package: KeyPackage = serde_json::from_str(&recovery.key_package)
        .map_err(|_| "Invalid encrypted key package from server")?;
    let data_key = unwrap(&old_package.recovery, &recovery_code)?;
    let package = KeyPackage {
        password: wrap(&data_key, &password)?,
        recovery: wrap(&data_key, &recovery_code)?,
    };
    let key_package = serde_json::to_string(&package).map_err(|error| error.to_string())?;
    let response = client
        .post(format!("{endpoint}/v1/auth/reset-password"))
        .json(&PasswordResetRequest {
            email: email.clone(),
            recovery_verifier: verifier,
            password,
            key_package,
            device_id: install_id,
            device_name,
        })
        .send()
        .await
        .map_err(|error| format!("Could not reach sync server: {error}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Password reset failed".into()));
    }
    let auth: AuthResponse = response.json().await.map_err(|error| error.to_string())?;
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    let secrets = SyncSecrets {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        data_key: URL_SAFE_NO_PAD.encode(data_key),
    };
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: secrets.access_token.clone(),
            data_key: secrets.data_key.clone(),
            last_synced_at: None,
            last_remote_cursor: 0,
            v3_initialized: false,
            auto_sync_enabled: true,
        },
    )?;
    Ok(AuthResult {
        recovery_code: None,
        secrets,
    })
}
#[tauri::command]
pub async fn sync_now(state: State<'_, DbState>, secrets: SyncSecrets) -> Result<(), String> {
    let (mut local, data_key) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        );
        if !local.v3_initialized {
            return Err("Select this device as the v3 sync source, or restore a v3 cloud version before syncing.".into());
        }
        let data_key = key(&local)?;
        (local, data_key)
    };
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "downloading")?;
    }
    pull_apply_events(&state, &mut local, &data_key).await?;
    let outbox = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        prepare_outbox(&conn, &local, &data_key)?;
        pending_outbox(&conn)?
    };
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "uploading")?;
    }
    let sent = push_outbox(&local, outbox).await?;
    let uploaded = sent.len() as u32;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        for event_id in &sent {
            conn.execute(
                "UPDATE sync_outbox SET uploaded_at=?1 WHERE event_id=?2",
                rusqlite::params![now_ms(), event_id],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("UPDATE sync_changes SET uploaded_at=?1 WHERE id=(SELECT change_id FROM sync_outbox WHERE event_id=?2)",rusqlite::params![now_ms(),event_id]).map_err(|e|e.to_string())?;
        }
    }
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_runtime_phase(&conn, "downloading")?;
    }
    let downloaded = pull_apply_events(&state, &mut local, &data_key).await?;
    let checkpoint_payload = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let since: u32 = conn
            .query_row(
                "SELECT value FROM sync_runtime WHERE key='events_since_checkpoint'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let next = since.saturating_add(uploaded).saturating_add(downloaded);
        conn.execute("INSERT INTO sync_runtime(key,value) VALUES('events_since_checkpoint',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[next.to_string()]).map_err(|e|e.to_string())?;
        if next >= 200 {
            Some(
                serde_json::to_vec(&V3Baseline {
                    version: 3,
                    backup: export::backup_payload(&conn)?,
                    entity_state: db::export_sync_entity_state(&conn)?,
                })
                .map_err(|e| e.to_string())?,
            )
        } else {
            None
        }
    };
    if let Some(payload) = checkpoint_payload {
        {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            set_runtime_phase(&conn, "uploading")?;
        }
        upload_checkpoint_payload(&local, &data_key, &payload, 3).await?;
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sync_runtime SET value='0' WHERE key='events_since_checkpoint'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    local.last_synced_at = Some(now_ms());
    save_config(&conn, &local)?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_uploaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[uploaded.to_string()]).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_downloaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[downloaded.to_string()]).map_err(|e|e.to_string())?;
    set_runtime_phase(&conn, "idle")?;
    Ok(())
}

/// Exchanges the single-use refresh token and returns a new vault payload.
/// The caller persists it in Stronghold before issuing another sync request.
#[tauri::command]
pub async fn sync_refresh_token(
    state: State<'_, DbState>,
    secrets: SyncSecrets,
) -> Result<SyncSecrets, String> {
    if secrets.refresh_token.is_empty() {
        return Err("此设备缺少刷新令牌，请重新登录。".into());
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
        .map_err(|e| format!("Could not refresh sync session: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "重新认证同步账户后再试。".into()));
    }
    let tokens: RefreshResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(SyncSecrets {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        data_key: secrets.data_key,
    })
}

#[tauri::command]
pub async fn sync_logout(state: State<'_, DbState>, secrets: SyncSecrets) -> Result<(), String> {
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
        .map_err(|e| format!("Could not revoke the device session: {e}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Could not revoke the device session".into()))
    }
}

/// Makes this installation the explicit v3 source of truth. Other legacy
/// devices must restore this encrypted baseline before merging events.
#[tauri::command]
pub async fn sync_initialize_v3(
    state: State<'_, DbState>,
    secrets: SyncSecrets,
) -> Result<(), String> {
    let (mut local, data_key, payload) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        );
        let data_key = key(&local)?;
        let baseline = V3Baseline {
            version: 3,
            backup: export::backup_payload(&conn)?,
            entity_state: db::export_sync_entity_state(&conn)?,
        };
        (
            local,
            data_key,
            serde_json::to_vec(&baseline).map_err(|e| e.to_string())?,
        )
    };
    upload_checkpoint_payload(&local, &data_key, &payload, 3).await?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    local.v3_initialized = true;
    local.last_synced_at = Some(now_ms());
    conn.execute(
        "UPDATE sync_changes SET uploaded_at=?1 WHERE uploaded_at IS NULL",
        [now_ms()],
    )
    .map_err(|e| e.to_string())?;
    save_config(&conn, &local)
}

#[tauri::command]
pub async fn sync_checkpoints(
    state: State<'_, DbState>,
    secrets: SyncSecrets,
) -> Result<Vec<SyncCheckpoint>, String> {
    let local = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    let response = sync_http_client()
        .get(format!("{}/v2/checkpoints", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|error| format!("Could not load cloud versions: {error}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Could not load cloud versions".into()));
    }
    response
        .json()
        .await
        .map_err(|error| format!("Invalid cloud version response: {error}"))
}

#[tauri::command]
pub async fn sync_preview_checkpoint(
    state: State<'_, DbState>,
    checkpoint_id: String,
    secrets: SyncSecrets,
) -> Result<SyncCheckpointPreview, String> {
    let (local, data_key, local_files) = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        );
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())? as usize;
        (local.clone(), key(&local)?, count)
    };
    let (checkpoint, manifest) =
        fetch_checkpoint_manifest(sync_http_client(), &local, &data_key, &checkpoint_id).await?;
    let summary = if let Some(summary) = manifest.summary {
        summary
    } else {
        // Legacy v2 checkpoints did not carry a summary. Keep them usable;
        // only this legacy path needs the old full-payload preview.
        let (_, backup, _) =
            fetch_checkpoint_backup(sync_http_client(), &local, &data_key, &checkpoint_id).await?;
        CheckpointSummary {
            files: backup.data.files.len(),
            folders: backup.data.folders.len(),
            words: backup.data.words.len(),
            phrases: backup.data.phrases.len(),
            review_logs: backup.data.review_logs.len(),
        }
    };
    Ok(SyncCheckpointPreview {
        checkpoint,
        files: summary.files,
        folders: summary.folders,
        words: summary.words,
        phrases: summary.phrases,
        review_logs: summary.review_logs,
        local_files,
        local_has_data: local_files > 0,
    })
}

#[tauri::command]
pub async fn sync_restore_checkpoint(
    state: State<'_, DbState>,
    checkpoint_id: String,
    secrets: SyncSecrets,
) -> Result<String, String> {
    let (local, data_key) = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        );
        (local.clone(), key(&local)?)
    };
    let (checkpoint, backup, entity_state) =
        fetch_checkpoint_backup(sync_http_client(), &local, &data_key, &checkpoint_id).await?;
    let mut local = local;
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    let path = write_safety_backup(&conn)?;
    export::restore_backup(&conn, &backup)?;
    if let Some(entity_state) = entity_state {
        db::import_sync_entity_state(&conn, &entity_state)?;
    } else {
        db::reset_sync_tracking(&conn).map_err(|error| error.to_string())?;
    }
    local.last_remote_cursor = checkpoint.cursor;
    local.v3_initialized = checkpoint.protocol_version == 3;
    local.last_synced_at = Some(now_ms());
    save_config(&conn, &local)?;
    Ok(path)
}
#[tauri::command]
pub fn sync_disconnect(state: State<DbState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sync_metadata WHERE key=?1", [CONFIG_KEY])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn sync_devices(
    state: State<'_, DbState>,
    secrets: SyncSecrets,
) -> Result<Vec<SyncDevice>, String> {
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    let response = sync_http_client()
        .get(format!("{}/v2/devices", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not load devices: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Could not load devices".into()));
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
    secrets: SyncSecrets,
) -> Result<(), String> {
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    if device_id == local.device_id {
        return Err(
            "Use ‘退出本机同步’ for the current device; it cannot revoke itself here.".into(),
        );
    }
    let response = sync_http_client()
        .delete(format!("{}/v2/devices/{device_id}", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|e| format!("Could not revoke device: {e}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Could not revoke device".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_delete_account(
    state: State<'_, DbState>,
    secrets: SyncSecrets,
) -> Result<(), String> {
    let local = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        apply_secrets(
            config(&conn)?.ok_or("Cloud sync is not configured.")?,
            &secrets,
        )
    };
    let response = sync_http_client()
        .delete(format!("{}/v2/account", local.endpoint))
        .bearer_auth(local.access_token)
        .send()
        .await
        .map_err(|error| format!("Could not delete cloud account: {error}"))?;
    if !response.status().is_success() {
        return Err(response
            .text()
            .await
            .unwrap_or_else(|_| "Could not delete cloud account".into()));
    }
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM sync_metadata WHERE key=?1", [CONFIG_KEY])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn ciphertext_is_authenticated() {
        let key = [3; 32];
        let value = crypt_bytes(&key, b"private study data").unwrap();
        assert_ne!(value, b"private study data");
        assert_eq!(decrypt_bytes(&key, &value).unwrap(), b"private study data");
        let mut tampered = value;
        tampered[24] ^= 1;
        assert!(decrypt_bytes(&key, &tampered).is_err());
    }
    #[test]
    fn compression_precedes_encryption_and_chunks_are_bounded() {
        let plaintext = vec![b'x'; CHUNK_SIZE * 3];
        let compressed = compress(&plaintext).unwrap();
        assert_eq!(decompress(&compressed).unwrap(), plaintext);
        let encrypted = crypt_bytes(&[4; 32], &compressed).unwrap();
        assert!(chunks(&encrypted).all(|chunk| chunk.len() <= CHUNK_SIZE));
    }

    #[test]
    fn encrypted_checkpoint_round_trips_a_real_backup_payload() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection
            .execute(
                "INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('lesson.txt','txt','private text','hash',1,'en')",
                [],
            )
            .unwrap();
        let original = export::backup_payload(&connection).unwrap();
        let plaintext = serde_json::to_vec(&original).unwrap();
        let encrypted = crypt_bytes(&[9; 32], &compress(&plaintext).unwrap()).unwrap();
        let restored: export::BackupPayload = serde_json::from_slice(
            &decompress(&decrypt_bytes(&[9; 32], &encrypted).unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(restored.data.files.len(), 1);
        assert_eq!(restored.data.files[0]["content"], "private text");
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
}
