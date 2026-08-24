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

#[derive(Clone, Serialize, Deserialize)]
struct LocalConfig {
    endpoint: String,
    email: String,
    device_id: String,
    access_token: String,
    data_key: String,
    last_synced_at: Option<i64>,
    #[serde(default)]
    last_remote_cursor: i64,
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
}
#[derive(Serialize)]
pub struct RegisterResult {
    pub recovery_code: String,
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
    key_package: String,
    device_id: String,
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
}
#[derive(Serialize)]
struct CheckpointUpload {
    id: String,
    cursor: i64,
    encrypted_len: i64,
    manifest: String,
    chunk_hashes: Vec<String>,
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

async fn fetch_checkpoint_backup(
    client: &reqwest::Client,
    local: &LocalConfig,
    data_key: &[u8; 32],
    checkpoint_id: &str,
) -> Result<(SyncCheckpoint, export::BackupPayload), String> {
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
    if manifest.version != 2
        || manifest.compression != "zstd"
        || manifest.chunks != detail.chunk_hashes
    {
        return Err("Checkpoint manifest does not match its encrypted chunk list".into());
    }
    let mut encrypted = Vec::with_capacity(manifest.encrypted_len);
    for expected_hash in &detail.chunk_hashes {
        let response = client
            .get(format!("{}/v2/chunks/{expected_hash}", local.endpoint))
            .bearer_auth(&local.access_token)
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
        if hash(&bytes) != *expected_hash {
            return Err("Encrypted chunk hash verification failed".into());
        }
        encrypted.extend_from_slice(&bytes);
    }
    if encrypted.len() != manifest.encrypted_len
        || encrypted.len() as i64 != detail.checkpoint.encrypted_len
    {
        return Err("Checkpoint encrypted length verification failed".into());
    }
    let compressed = decrypt_bytes(data_key, &encrypted)?;
    let plaintext = decompress(&compressed)?;
    let backup =
        serde_json::from_slice(&plaintext).map_err(|_| "Invalid decrypted checkpoint payload")?;
    Ok((detail.checkpoint, backup))
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
    Ok(match value {
        Some(c) => SyncStatus {
            configured: true,
            email: Some(c.email),
            endpoint: Some(c.endpoint),
            device_id: Some(c.device_id),
            last_synced_at: c.last_synced_at,
            phase: "idle".into(),
            pending_uploads,
            pending_downloads: 0,
            conflicts: 0,
            last_error: None,
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
        },
    })
}
#[tauri::command]
pub async fn sync_register(
    state: State<'_, DbState>,
    endpoint: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<RegisterResult, String> {
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
    let client = reqwest::Client::new();
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
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: auth.access_token,
            data_key: URL_SAFE_NO_PAD.encode(data_key),
            last_synced_at: None,
            last_remote_cursor: 0,
        },
    )?;
    Ok(RegisterResult { recovery_code })
}
#[tauri::command]
pub async fn sync_login(
    state: State<'_, DbState>,
    endpoint: String,
    email: String,
    password: String,
    device_name: String,
) -> Result<(), String> {
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
    let client = reqwest::Client::new();
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
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: auth.access_token,
            data_key: URL_SAFE_NO_PAD.encode(data_key),
            last_synced_at: None,
            last_remote_cursor: 0,
        },
    )?;
    Ok(())
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
) -> Result<(), String> {
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
    let client = reqwest::Client::new();
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
    save_config(
        &conn,
        &LocalConfig {
            endpoint,
            email,
            device_id: auth.device_id,
            access_token: auth.access_token,
            data_key: URL_SAFE_NO_PAD.encode(data_key),
            last_synced_at: None,
            last_remote_cursor: 0,
        },
    )?;
    Ok(())
}
#[tauri::command]
pub async fn sync_now(state: State<'_, DbState>) -> Result<(), String> {
    // Build a portable checkpoint outside of the HTTP phase. Compression is
    // intentionally before encryption; encrypted bytes are incompressible.
    let (mut local, data_key, checkpoint) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local = config(&conn)?.ok_or("Cloud sync is not configured.")?;
        let backup = export::backup_payload(&conn)?;
        let serialized = serde_json::to_vec(&backup).map_err(|e| e.to_string())?;
        let data_key = key(&local)?;
        (
            local,
            data_key,
            crypt_bytes(&data_key, &compress(&serialized)?)?,
        )
    };
    let client = reqwest::Client::new();
    let mut chunk_hashes = Vec::new();
    for chunk in chunks(&checkpoint) {
        let chunk_hash = hash(chunk);
        let response = client
            .put(format!("{}/v2/chunks/{chunk_hash}", local.endpoint))
            .bearer_auth(&local.access_token)
            .header("content-type", "application/octet-stream")
            .body(chunk.to_vec())
            .send()
            .await
            .map_err(|e| format!("Sync upload failed: {e}"))?;
        if !response.status().is_success() {
            return Err(response
                .text()
                .await
                .unwrap_or_else(|_| "Sync chunk upload failed".into()));
        }
        chunk_hashes.push(chunk_hash);
    }
    let manifest = CheckpointManifest {
        version: 2,
        compression: "zstd".into(),
        encrypted_len: checkpoint.len(),
        chunks: chunk_hashes.clone(),
    };
    let manifest = crypt_bytes(
        &data_key,
        &serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
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
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    local.last_synced_at = Some(now_ms());
    save_config(&conn, &local)?;
    conn.execute(
        "UPDATE sync_changes SET uploaded_at=?1 WHERE uploaded_at IS NULL",
        [now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn sync_checkpoints(state: State<'_, DbState>) -> Result<Vec<SyncCheckpoint>, String> {
    let local = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        config(&conn)?.ok_or("Cloud sync is not configured.")?
    };
    let response = reqwest::Client::new()
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
) -> Result<SyncCheckpointPreview, String> {
    let (local, data_key, local_files) = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let local = config(&conn)?.ok_or("Cloud sync is not configured.")?;
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get::<_, i64>(0))
            .map_err(|error| error.to_string())? as usize;
        (local.clone(), key(&local)?, count)
    };
    let (checkpoint, backup) =
        fetch_checkpoint_backup(&reqwest::Client::new(), &local, &data_key, &checkpoint_id).await?;
    Ok(SyncCheckpointPreview {
        checkpoint,
        files: backup.data.files.len(),
        folders: backup.data.folders.len(),
        words: backup.data.words.len(),
        phrases: backup.data.phrases.len(),
        review_logs: backup.data.review_logs.len(),
        local_files,
        local_has_data: local_files > 0,
    })
}

#[tauri::command]
pub async fn sync_restore_checkpoint(
    state: State<'_, DbState>,
    checkpoint_id: String,
) -> Result<String, String> {
    let (local, data_key) = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        let local = config(&conn)?.ok_or("Cloud sync is not configured.")?;
        (local.clone(), key(&local)?)
    };
    let (checkpoint, backup) =
        fetch_checkpoint_backup(&reqwest::Client::new(), &local, &data_key, &checkpoint_id).await?;
    let mut local = local;
    let conn = state.conn.lock().map_err(|error| error.to_string())?;
    let path = write_safety_backup(&conn)?;
    export::restore_backup(&conn, &backup)?;
    db::reset_sync_tracking(&conn).map_err(|error| error.to_string())?;
    local.last_remote_cursor = checkpoint.cursor;
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
pub async fn sync_devices(state: State<'_, DbState>) -> Result<Vec<SyncDevice>, String> {
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        config(&conn)?.ok_or("Cloud sync is not configured.")?
    };
    let response = reqwest::Client::new()
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
) -> Result<(), String> {
    let local = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        config(&conn)?.ok_or("Cloud sync is not configured.")?
    };
    if device_id == local.device_id {
        return Err(
            "Use ‘退出本机同步’ for the current device; it cannot revoke itself here.".into(),
        );
    }
    let response = reqwest::Client::new()
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
pub async fn sync_delete_account(state: State<'_, DbState>) -> Result<(), String> {
    let local = {
        let conn = state.conn.lock().map_err(|error| error.to_string())?;
        config(&conn)?.ok_or("Cloud sync is not configured.")?
    };
    let response = reqwest::Client::new()
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
}
