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
use std::collections::HashSet;
use std::io::Cursor;
use std::sync::OnceLock;
use tauri::State;
use uuid::Uuid;

use crate::{commands::export, db::DbState};

const CONFIG_KEY: &str = "cloud_sync_config_v1";
const DEVICE_KEY: &str = "cloud_sync_device_id_v1";
const AAD: &[u8] = b"lexicue/cloud-sync/v1";
const BLOB_CHUNK_SIZE: usize = 512 * 1024;
const BLOB_MANIFEST_MAGIC: &[u8] = b"LEXICUE-BLOB-V1\n";
const COMPRESSED_EVENT_MAGIC: &[u8] = b"LEXICUE-ZSTD-V1\n";
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);
const SYNC_PAGE_LIMIT: i64 = 50;
const SYNC_SMALL_PAGE_LIMIT: i64 = 25;
const SYNC_PAGE_MAX_BYTES: usize = 16 * 1024 * 1024;
const SYNC_PAGE_REDUCE_BYTES: usize = 8 * 1024 * 1024;
const SYNC_APPLY_BATCH: i64 = 500;
const MAX_LIBRARY_ITEM_BYTES: usize = 100 * 1024 * 1024;
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
    pub progress: Option<SyncProgress>,
    pub diagnostic: Option<SyncDiagnostic>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncDiagnostic {
    pub code: String,
    pub stage: String,
    pub kind: String,
    pub entity_type: Option<String>,
    pub occurred_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncProgress {
    pub phase: String,
    pub completed_items: u64,
    pub total_items: u64,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub bytes_per_second: u64,
    pub eta_seconds: Option<u64>,
    pub retry_at: Option<i64>,
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

/// One portable reading item.  It deliberately groups all file-scoped data
/// that users can see, including AI output, so one imported subtitle does not
/// produce one cloud record per segment or occurrence.
#[derive(Serialize, Deserialize)]
struct LibraryItemRecord {
    version: u8,
    file: serde_json::Value,
    segments: Vec<LibrarySegment>,
    phrase_analysis: Option<LibraryAnalysis>,
    phrase_dictionary_entries: Vec<LibraryPhraseDictionaryEntry>,
}

#[derive(Serialize, Deserialize)]
struct LibrarySegment {
    index_num: i64,
    en_text: String,
    zh_text: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    occurrences: Vec<LibraryOccurrence>,
    phrase_occurrences: Vec<LibraryPhraseOccurrence>,
}

#[derive(Serialize, Deserialize)]
struct LibraryOccurrence {
    word_sync_id: String,
    original_form: String,
    position: i64,
    hidden: i64,
    #[serde(default)]
    meaning_zh: Option<String>,
    #[serde(default)]
    usage_zh: Option<String>,
    #[serde(default)]
    collins_sense_id: Option<i64>,
    #[serde(default)]
    meaning_edited: i64,
    #[serde(default)]
    analysis_model: Option<String>,
    #[serde(default)]
    analyzed_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct LibraryPhraseOccurrence {
    phrase_sync_id: String,
    position: i64,
    hidden: i64,
    #[serde(default)]
    surface_text: Option<String>,
    #[serde(default)]
    token_positions_json: Option<String>,
    #[serde(default)]
    meaning_zh: Option<String>,
    #[serde(default)]
    usage_zh: Option<String>,
    #[serde(default)]
    meaning_edited: i64,
    #[serde(default)]
    meaning_en: Option<String>,
    #[serde(default)]
    usage_en: Option<String>,
    #[serde(default)]
    meaning_en_edited: i64,
    #[serde(default)]
    collins_sense_id: Option<i64>,
    #[serde(default)]
    expression_meta_json: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct LibraryAnalysis {
    model: String,
    completed_at: i64,
    #[serde(default = "default_phrase_pipeline_version")]
    pipeline_version: i64,
    #[serde(default)]
    collins_evidence_available: i64,
    #[serde(default)]
    skipped_items: i64,
}

fn default_phrase_pipeline_version() -> i64 {
    1
}

#[derive(Serialize, Deserialize)]
struct LibraryPhraseDictionaryEntry {
    language: String,
    text: String,
    translation: String,
    pinyin: Option<String>,
    usage_zh: Option<String>,
    category: Option<String>,
    provider: String,
    updated_at: i64,
    #[serde(default = "default_other_senses_json")]
    other_senses_json: String,
    #[serde(default)]
    other_senses_edited: i64,
    #[serde(default)]
    meaning_en: Option<String>,
    #[serde(default)]
    usage_en: Option<String>,
    #[serde(default = "default_other_senses_json")]
    other_senses_en_json: String,
    #[serde(default)]
    other_senses_en_edited: i64,
    #[serde(default)]
    expression_meta_json: Option<String>,
}

fn default_other_senses_json() -> String {
    "[]".to_string()
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
    // New servers provide an exact count for an initial pull.  Older servers
    // only have a cursor, so keep this optional during the rollout.
    #[serde(default)]
    record_count: Option<i64>,
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
        .map_err(|_| "local_sync_storage_error".to_string())?;
    raw.map(|v| serde_json::from_str(&v).map_err(|_| "local_sync_storage_error".to_string()))
        .transpose()
}
fn save_config(conn: &rusqlite::Connection, config: &LocalConfig) -> Result<(), String> {
    conn.execute("INSERT INTO sync_metadata(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", rusqlite::params![CONFIG_KEY, serde_json::to_string(config).map_err(|_| "local_sync_storage_error")?, now_ms()]).map_err(|_| "local_sync_storage_error")?;
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
        .map_err(|_| "local_sync_storage_error".to_string())?;
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
    .map_err(|_| "local_sync_storage_error".to_string())?;
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

struct ProgressUpdate<'a> {
    phase: &'a str,
    completed_items: u64,
    total_items: u64,
    completed_bytes: u64,
    total_bytes: u64,
    started_at: i64,
    retry_at: Option<i64>,
}

fn set_progress(conn: &rusqlite::Connection, update: ProgressUpdate<'_>) -> Result<(), String> {
    let elapsed_ms = now_ms().saturating_sub(update.started_at).max(1) as u64;
    let bytes_per_second = update.completed_bytes.saturating_mul(1000) / elapsed_ms;
    let eta_seconds = if bytes_per_second > 0 && update.total_bytes > update.completed_bytes {
        Some((update.total_bytes - update.completed_bytes).div_ceil(bytes_per_second))
    } else {
        None
    };
    let progress = SyncProgress {
        phase: update.phase.to_string(),
        completed_items: update.completed_items,
        total_items: update.total_items,
        completed_bytes: update.completed_bytes,
        total_bytes: update.total_bytes,
        bytes_per_second,
        eta_seconds,
        retry_at: update.retry_at,
    };
    let value = serde_json::to_string(&progress).map_err(|_| "local_sync_storage_error")?;
    conn.execute(
        "INSERT INTO sync_runtime(key,value) VALUES('progress',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [value],
    )
    .map_err(|_| "local_sync_storage_error".to_string())?;
    Ok(())
}

fn clear_progress(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute("DELETE FROM sync_runtime WHERE key='progress'", [])
        .map_err(|_| "local_sync_storage_error".to_string())?;
    Ok(())
}

fn set_runtime_phase(conn: &rusqlite::Connection, phase: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_runtime(key,value) VALUES('phase',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [phase],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn stable_sync_error(value: String) -> String {
    // Apply context is diagnostic-only. Preserve recognized protocol codes,
    // but never pass arbitrary SQLite/OS text through to the UI.
    let code = value
        .strip_prefix("sync_apply::")
        .and_then(|context| context.split_once("::").map(|(_, code)| code))
        .unwrap_or(&value);
    if matches!(
        code,
        "auth_required"
            | "session_expired"
            | "invalid_credentials"
            | "invalid_email"
            | "invalid_password"
            | "invalid_recovery_code"
            | "email_exists"
            | "invalid_registration"
            | "invalid_device"
            | "network_unavailable"
            | "rate_limited"
            | "server_internal"
            | "credential_store_unavailable"
            | "credential_store_write_failed"
            | "credential_missing"
            | "credential_corrupted"
            | "local_backup_failed"
            | "local_sync_storage_error"
            | "local_identity_conflict"
            | "local_delete_failed"
            | "sync_service_not_configured"
            | "unsupported_sync_protocol"
            | "invalid_server_response"
            | "invalid_key_package"
            | "invalid_local_sync_key"
            | "record_encryption_failed"
            | "record_too_large"
            | "invalid_encrypted_record"
            | "record_authentication_failed"
            | "invalid_record_batch"
            | "invalid_record"
            | "record_precondition_failed"
            | "invalid_blob_manifest"
            | "invalid_blob"
            | "blob_hash_mismatch"
            | "blob_not_found"
            | "cannot_revoke_current_device"
            | "device_not_found"
            | "metrics_disabled"
            | "metrics_unauthorized"
            | "sync_service_error"
    ) {
        return code.to_string();
    }
    let normalized = value.to_ascii_lowercase();
    if normalized.contains("unique constraint") && normalized.contains("sync_entity_state") {
        "local_identity_conflict".into()
    } else if normalized.contains("waiting for its ") || normalized.contains("missing ") {
        "invalid_encrypted_record".into()
    } else {
        "local_sync_storage_error".into()
    }
}

fn diagnostic_kind(value: &str) -> &'static str {
    let value = value.to_ascii_lowercase();
    if value.contains("locked") || value.contains("busy") {
        "sqlite_busy"
    } else if value.contains("unique constraint") {
        "sqlite_constraint"
    } else if value.contains("foreign key") {
        "sqlite_foreign_key"
    } else if value.contains("disk") || value.contains("space") || value.contains("readonly") {
        "storage_write"
    } else if value.contains("waiting for its ") || value.contains("missing ") {
        "missing_reference"
    } else {
        "local_write"
    }
}

fn record_sync_diagnostic(state: &DbState, raw: &str, code: &str) {
    let Ok(conn) = state.conn.lock() else {
        return;
    };
    let stage = conn
        .query_row(
            "SELECT value FROM sync_runtime WHERE key='phase'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .unwrap_or_else(|| "preparing".into());
    let entity_type = raw
        .strip_prefix("sync_apply::")
        .and_then(|value| value.split("::").next())
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let diagnostic = SyncDiagnostic {
        code: code.into(),
        stage,
        kind: diagnostic_kind(raw).into(),
        entity_type,
        occurred_at: now_ms(),
    };
    let Ok(serialized) = serde_json::to_string(&diagnostic) else {
        return;
    };
    let _ = conn.execute("INSERT INTO sync_runtime(key,value) VALUES('diagnostic',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [&serialized]);
    if let Some(path) = conn.path().and_then(|path| {
        std::path::Path::new(path)
            .parent()
            .map(|parent| parent.join("lexicue-sync-diagnostic.txt"))
    }) {
        let report = format!(
            "LexiCue sync diagnostic\nversion={}\nstage={}\ncode={}\nkind={}\nentity_type={}\noccurred_at={}\n",
            env!("CARGO_PKG_VERSION"),
            diagnostic.stage, diagnostic.code, diagnostic.kind,
            diagnostic.entity_type.as_deref().unwrap_or("none"), diagnostic.occurred_at
        );
        let _ = std::fs::write(path, report);
    }
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
        .map_err(|_| "invalid_key_package".to_string())?;
    let nonce = URL_SAFE_NO_PAD
        .decode(&wrapped.nonce)
        .map_err(|_| "invalid_key_package".to_string())?;
    let encrypted = URL_SAFE_NO_PAD
        .decode(&wrapped.ciphertext)
        .map_err(|_| "invalid_key_package".to_string())?;
    if salt.len() != 16 || nonce.len() != 24 || encrypted.is_empty() {
        return Err("invalid_key_package".into());
    }
    let wrapping = derive(secret, &salt)?;
    let plaintext = XChaCha20Poly1305::new((&wrapping).into())
        .decrypt(
            XNonce::from_slice(&nonce),
            chacha20poly1305::aead::Payload {
                msg: &encrypted,
                aad: AAD,
            },
        )
        .map_err(|_| "invalid_key_package".to_string())?;
    plaintext
        .try_into()
        .map_err(|_| "invalid_key_package".to_string())
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
        .map_err(|_| "invalid_local_sync_key".to_string())?
        .try_into()
        .map_err(|_| "invalid_local_sync_key".to_string())
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
    let backup = export::backup_payload(conn).map_err(|_| "local_backup_failed".to_string())?;
    let database_path = conn.path().ok_or("local_backup_failed")?;
    let directory = std::path::Path::new(database_path)
        .parent()
        .ok_or("local_backup_failed")?;
    let path = directory.join(format!("lexicue-before-cloud-restore-{}.json", now_ms()));
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&backup).map_err(|_| "local_backup_failed")?,
    )
    .map_err(|_| "local_backup_failed")?;
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
    if table == "saved_records" {
        let raw: Option<String> = conn
            .query_row(
                "SELECT snapshot_json FROM saved_records WHERE id=?1",
                [local_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        return raw
            .map(|json| {
                let value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
                super::source_media::portable_saved_value(conn, value)
            })
            .transpose();
    }
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
    if table == "files" {
        // New snapshots no longer publish legacy classification.
        value.remove("folder_id");
        value.insert("tag_model".into(), serde_json::json!(1));
    }
    // Foreign keys must never cross the network as a local integer.
    let references: &[(&str, &str)] = match table {
        "folders" => &[("parent_id", "folders")],
        "file_tags" => &[("file_id", "files"), ("tag_id", "tags")],
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

fn library_item_record(
    conn: &rusqlite::Connection,
    file_id: i64,
) -> Result<LibraryItemRecord, String> {
    let file = row_record(conn, "files", file_id)?
        .ok_or("sync record disappeared before it could be sent")?;
    let mut segment_statement = conn
        .prepare(
            "SELECT id,index_num,en_text,zh_text,start_time,end_time
             FROM segments WHERE file_id=?1 ORDER BY index_num,id",
        )
        .map_err(|_| "local_sync_storage_error".to_string())?;
    let segment_rows = segment_statement
        .query_map([file_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|_| "local_sync_storage_error".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "local_sync_storage_error".to_string())?;
    drop(segment_statement);

    let mut segments = Vec::with_capacity(segment_rows.len());
    for (segment_id, index_num, en_text, zh_text, start_time, end_time) in segment_rows {
        let mut occurrence_statement = conn
            .prepare(
                "SELECT state.sync_id,occurrence.original_form,occurrence.position,occurrence.hidden,
                        occurrence.meaning_zh,occurrence.usage_zh,occurrence.collins_sense_id,
                        occurrence.meaning_edited,occurrence.analysis_model,occurrence.analyzed_at
                 FROM occurrences occurrence
                 JOIN sync_entity_state state ON state.table_name='words' AND state.local_id=occurrence.word_id
                 WHERE occurrence.segment_id=?1 ORDER BY occurrence.position,occurrence.id",
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
        let occurrences = occurrence_statement
            .query_map([segment_id], |row| {
                Ok(LibraryOccurrence {
                    word_sync_id: row.get(0)?,
                    original_form: row.get(1)?,
                    position: row.get(2)?,
                    hidden: row.get(3)?,
                    meaning_zh: row.get(4)?,
                    usage_zh: row.get(5)?,
                    collins_sense_id: row.get(6)?,
                    meaning_edited: row.get(7)?,
                    analysis_model: row.get(8)?,
                    analyzed_at: row.get(9)?,
                })
            })
            .map_err(|_| "local_sync_storage_error".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "local_sync_storage_error".to_string())?;
        let mut phrase_occurrence_statement = conn
            .prepare(
                "SELECT state.sync_id,occurrence.position,occurrence.hidden,occurrence.surface_text,occurrence.token_positions_json,occurrence.meaning_zh,occurrence.usage_zh,occurrence.meaning_edited,occurrence.meaning_en,occurrence.usage_en,occurrence.meaning_en_edited,occurrence.collins_sense_id,occurrence.expression_meta_json
                 FROM phrase_occurrences occurrence
                 JOIN sync_entity_state state ON state.table_name='phrases' AND state.local_id=occurrence.phrase_id
                 WHERE occurrence.segment_id=?1 ORDER BY occurrence.position,occurrence.id",
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
        let phrase_occurrences = phrase_occurrence_statement
            .query_map([segment_id], |row| {
                Ok(LibraryPhraseOccurrence {
                    phrase_sync_id: row.get(0)?,
                    position: row.get(1)?,
                    hidden: row.get(2)?,
                    surface_text: row.get(3)?,
                    token_positions_json: row.get(4)?,
                    meaning_zh: row.get(5)?,
                    usage_zh: row.get(6)?,
                    meaning_edited: row.get(7)?,
                    meaning_en: row.get(8)?,
                    usage_en: row.get(9)?,
                    meaning_en_edited: row.get(10)?,
                    collins_sense_id: row.get(11)?,
                    expression_meta_json: row.get(12)?,
                })
            })
            .map_err(|_| "local_sync_storage_error".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "local_sync_storage_error".to_string())?;
        segments.push(LibrarySegment {
            index_num,
            en_text,
            zh_text,
            start_time,
            end_time,
            occurrences,
            phrase_occurrences,
        });
    }
    let phrase_analysis = conn
        .query_row(
            "SELECT model,completed_at,pipeline_version,collins_evidence_available,skipped_items FROM file_phrase_analysis WHERE file_id=?1",
            [file_id],
            |row| {
                Ok(LibraryAnalysis {
                    model: row.get(0)?,
                    completed_at: row.get(1)?,
                    pipeline_version: row.get(2)?,
                    collins_evidence_available: row.get(3)?,
                    skipped_items: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|_| "local_sync_storage_error".to_string())?;
    let mut dictionary_statement = conn
        .prepare(
            "SELECT DISTINCT entry.language,entry.text,entry.translation,entry.pinyin,entry.usage_zh,entry.category,entry.provider,entry.updated_at,entry.other_senses_json,entry.other_senses_edited,entry.meaning_en,entry.usage_en,entry.other_senses_en_json,entry.other_senses_en_edited,entry.expression_meta_json
             FROM phrase_dictionary_entries entry
             JOIN phrases phrase ON phrase.language=entry.language AND phrase.text=entry.text
             JOIN phrase_occurrences occurrence ON occurrence.phrase_id=phrase.id
             JOIN segments segment ON segment.id=occurrence.segment_id
             WHERE segment.file_id=?1 ORDER BY entry.language,entry.text",
        )
        .map_err(|_| "local_sync_storage_error".to_string())?;
    let phrase_dictionary_entries = dictionary_statement
        .query_map([file_id], |row| {
            Ok(LibraryPhraseDictionaryEntry {
                language: row.get(0)?,
                text: row.get(1)?,
                translation: row.get(2)?,
                pinyin: row.get(3)?,
                usage_zh: row.get(4)?,
                category: row.get(5)?,
                provider: row.get(6)?,
                updated_at: row.get(7)?,
                other_senses_json: row.get(8)?,
                other_senses_edited: row.get(9)?,
                meaning_en: row.get(10)?,
                usage_en: row.get(11)?,
                other_senses_en_json: row.get(12)?,
                other_senses_en_edited: row.get(13)?,
                expression_meta_json: row.get(14)?,
            })
        })
        .map_err(|_| "local_sync_storage_error".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "local_sync_storage_error".to_string())?;
    Ok(LibraryItemRecord {
        version: 1,
        file,
        segments,
        phrase_analysis,
        phrase_dictionary_entries,
    })
}

fn encode_event(event: &EntityEvent) -> Result<Vec<u8>, String> {
    let mut portable = serde_json::to_value(event).map_err(|_| "local_sync_storage_error")?;
    if portable.to_string().contains("\"media_source\":\"")
        || portable.to_string().contains("\"media\":{")
        || portable.to_string().contains("\"media_identity\":\"")
    {
        portable["version"] = serde_json::json!(5);
    }
    if super::document_source::contains_content_origin(&portable) {
        portable["version"] = serde_json::json!(7);
    } else if super::document_source::contains_document(&portable) {
        portable["version"] = serde_json::json!(6);
    }
    let serialized =
        serde_json::to_vec(&portable).map_err(|_| "local_sync_storage_error".to_string())?;
    if event.table_name != "library_item" {
        return Ok(serialized);
    }
    let compressed = zstd::stream::encode_all(Cursor::new(serialized), 3)
        .map_err(|_| "local_sync_storage_error".to_string())?;
    let mut encoded = COMPRESSED_EVENT_MAGIC.to_vec();
    encoded.extend(compressed);
    Ok(encoded)
}

fn decode_event(plaintext: &[u8]) -> Result<EntityEvent, String> {
    let decoded = if plaintext.starts_with(COMPRESSED_EVENT_MAGIC) {
        zstd::stream::decode_all(Cursor::new(&plaintext[COMPRESSED_EVENT_MAGIC.len()..]))
            .map_err(|_| "invalid_encrypted_record".to_string())?
    } else {
        plaintext.to_vec()
    };
    serde_json::from_slice(&decoded).map_err(|_| "invalid_encrypted_record".to_string())
}
fn set_runtime(conn: &rusqlite::Connection, applying: bool) -> Result<(), String> {
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('applying',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [if applying { "1" } else { "0" }]).map(|_|()).map_err(|e| e.to_string())
}

fn with_remote_apply_guard<T>(
    conn: &rusqlite::Connection,
    apply: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let already_applying: bool = conn
        .query_row(
            "SELECT COALESCE((SELECT value='1' FROM sync_runtime WHERE key='applying'),0)",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "local_sync_storage_error".to_string())?;
    if !already_applying {
        set_runtime(conn, true)?;
    }
    let result = apply();
    if !already_applying {
        set_runtime(conn, false)?;
    }
    result
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
    conn.execute("INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at,clock) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT DO UPDATE SET local_id=excluded.local_id,sync_id=excluded.sync_id,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,clock=excluded.clock", rusqlite::params![table,local_id,sync_id,time,if deleted {Some(time)} else {None::<i64>},clock]).map_err(|e| e.to_string())?;
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

/// Old file snapshots may still contain occurrences removed later through a
/// vocabulary deletion. Respect that tombstone without rejecting the whole
/// file; an unknown identity is still an incomplete/invalid snapshot.
fn library_reference_id(
    conn: &rusqlite::Connection,
    table: &str,
    sync_id: &str,
) -> Result<Option<i64>, String> {
    if let Some(id) = local_id_for(conn, table, sync_id)? {
        return Ok(Some(id));
    }
    let deleted: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sync_entity_state WHERE table_name=?1 AND deleted_at IS NOT NULL AND sync_id=COALESCE((SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name=?1 AND alias_sync_id=?2),?2))",
        rusqlite::params![table, sync_id], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if deleted {
        Ok(None)
    } else {
        Err("invalid_encrypted_record".into())
    }
}

fn apply_library_item_event(
    conn: &rusqlite::Connection,
    sync_id: &str,
    operation: &str,
    record: Option<&serde_json::Value>,
    clock: &str,
) -> Result<bool, String> {
    let pending_local: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_changes WHERE table_name='library_item' AND sync_id=?1 AND operation='upsert' AND uploaded_at IS NULL)",
            [sync_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if pending_local {
        return Ok(false);
    }
    if operation == "delete" {
        if let Some(file_id) = local_id_for(conn, "files", sync_id)? {
            conn.execute("DELETE FROM files WHERE id=?1", [file_id])
                .map_err(|error| error.to_string())?;
            mark_state(conn, "files", file_id, sync_id, clock, true)?;
        }
        return Ok(true);
    }
    let snapshot: LibraryItemRecord =
        serde_json::from_value(record.cloned().ok_or("invalid_encrypted_record")?)
            .map_err(|_| "invalid_encrypted_record".to_string())?;
    if snapshot.version != 1 {
        return Err("unsupported_sync_protocol".into());
    }
    let file_record = snapshot
        .file
        .as_object()
        .ok_or("invalid_encrypted_record")?;
    if let Some(raw) = file_record.get("document_source").and_then(|v| v.as_str()) {
        let source: super::document_source::DocumentSource =
            serde_json::from_str(raw).map_err(|_| "material_invalid_document")?;
        source.validate(
            file_record
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or("material_invalid_document")?,
            Some(snapshot.segments.len()),
        )?;
        let segments = snapshot
            .segments
            .iter()
            .map(|s| super::import::SegmentInput {
                index: s.index_num as i32,
                en_text: s.en_text.clone(),
                zh_text: s.zh_text.clone(),
                start_time: s.start_time.clone(),
                end_time: s.end_time.clone(),
            })
            .collect::<Vec<_>>();
        source.validate_segment_text(&segments)?;
        if snapshot
            .segments
            .iter()
            .enumerate()
            .any(|(i, s)| s.index_num != i as i64)
        {
            return Err("material_invalid_document".into());
        }
    }
    let file_id = apply_record(conn, "files", sync_id, file_record)?;
    if file_record.get("tag_model").and_then(|v| v.as_i64()) == Some(1) {
        conn.execute(
            "INSERT OR IGNORE INTO file_tag_state(file_id) VALUES(?1)",
            [file_id],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM segments WHERE file_id=?1", [file_id])
        .map_err(|error| error.to_string())?;
    for segment in snapshot.segments {
        conn.execute(
            "INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![file_id, segment.index_num, segment.en_text, segment.zh_text, segment.start_time, segment.end_time],
        )
        .map_err(|error| error.to_string())?;
        let segment_id = conn.last_insert_rowid();
        for occurrence in segment.occurrences {
            let Some(word_id) = library_reference_id(conn, "words", &occurrence.word_sync_id)?
            else {
                continue;
            };
            conn.execute(
                "INSERT INTO occurrences(word_id,segment_id,original_form,position,hidden,meaning_zh,usage_zh,collins_sense_id,meaning_edited,analysis_model,analyzed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                rusqlite::params![word_id, segment_id, occurrence.original_form, occurrence.position, occurrence.hidden, occurrence.meaning_zh, occurrence.usage_zh, occurrence.collins_sense_id, occurrence.meaning_edited, occurrence.analysis_model, occurrence.analyzed_at],
            )
            .map_err(|error| error.to_string())?;
            conn.execute(
                "INSERT OR IGNORE INTO word_aliases(word_id,alias,alias_kind) VALUES(?1,lower(?2),'surface')",
                rusqlite::params![word_id, occurrence.original_form],
            ).map_err(|error| error.to_string())?;
        }
        for occurrence in segment.phrase_occurrences {
            let Some(phrase_id) =
                library_reference_id(conn, "phrases", &occurrence.phrase_sync_id)?
            else {
                continue;
            };
            conn.execute(
                "INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden,surface_text,token_positions_json,meaning_zh,usage_zh,meaning_edited,meaning_en,usage_en,meaning_en_edited,collins_sense_id,expression_meta_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                rusqlite::params![phrase_id, segment_id, occurrence.position, occurrence.hidden, occurrence.surface_text, occurrence.token_positions_json, occurrence.meaning_zh, occurrence.usage_zh, occurrence.meaning_edited, occurrence.meaning_en, occurrence.usage_en, occurrence.meaning_en_edited, occurrence.collins_sense_id, occurrence.expression_meta_json],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    conn.execute(
        "DELETE FROM file_phrase_analysis WHERE file_id=?1",
        [file_id],
    )
    .map_err(|error| error.to_string())?;
    if let Some(analysis) = snapshot.phrase_analysis {
        conn.execute(
            "INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version,collins_evidence_available,skipped_items) VALUES(?1,?2,?3,?4,?5,?6)",
            rusqlite::params![file_id, analysis.model, analysis.completed_at, analysis.pipeline_version, analysis.collins_evidence_available, analysis.skipped_items],
        )
        .map_err(|error| error.to_string())?;
    }
    for entry in snapshot.phrase_dictionary_entries {
        conn.execute(
            "INSERT INTO phrase_dictionary_entries(language,text,translation,pinyin,usage_zh,category,provider,updated_at,other_senses_json,other_senses_edited,meaning_en,usage_en,other_senses_en_json,other_senses_en_edited,expression_meta_json)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(language,text) DO UPDATE SET translation=excluded.translation,pinyin=excluded.pinyin,usage_zh=excluded.usage_zh,category=excluded.category,provider=excluded.provider,updated_at=excluded.updated_at,other_senses_json=excluded.other_senses_json,other_senses_edited=excluded.other_senses_edited,meaning_en=excluded.meaning_en,usage_en=excluded.usage_en,other_senses_en_json=excluded.other_senses_en_json,other_senses_en_edited=excluded.other_senses_en_edited,expression_meta_json=excluded.expression_meta_json",
            rusqlite::params![entry.language, entry.text, entry.translation, entry.pinyin, entry.usage_zh, entry.category, entry.provider, entry.updated_at, entry.other_senses_json, entry.other_senses_edited, entry.meaning_en, entry.usage_en, entry.other_senses_en_json, entry.other_senses_en_edited, entry.expression_meta_json],
        )
        .map_err(|error| error.to_string())?;
    }
    mark_state(conn, "files", file_id, sync_id, clock, false)?;
    Ok(true)
}

fn queue_saved_state(
    conn: &rusqlite::Connection,
    record: &super::saved::SavedRecord,
) -> Result<(), String> {
    // A CAS conflict must generate a fresh envelope/clock, not reuse a frozen
    // pre-conflict edit with the server's newly acknowledged etag.
    conn.execute("DELETE FROM sync_changes WHERE table_name='saved_records' AND sync_id=?1 AND uploaded_at IS NULL",[&record.record_id]).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) VALUES('saved_records',?1,?2,?3)",rusqlite::params![record.record_id,if record.deleted_at.is_some(){"delete"}else{"upsert"},now_ms()]).map_err(|e|e.to_string())?;
    Ok(())
}

fn saved_conflict(
    conn: &rusqlite::Connection,
    local: &super::saved::SavedRecord,
    remote: &super::saved::SavedRecord,
) -> Result<(), String> {
    if local.explanation == remote.explanation
        && local.dictionary_reference == remote.dictionary_reference
    {
        return Ok(());
    }
    let left = serde_json::to_string(local).map_err(|e| e.to_string())?;
    let right = serde_json::to_string(remote).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO sync_conflicts(table_name,sync_id,local_value,remote_value,created_at) SELECT 'saved_records',?1,?2,?3,?4 WHERE NOT EXISTS(SELECT 1 FROM sync_conflicts WHERE table_name='saved_records' AND sync_id=?1 AND local_value=?2 AND remote_value=?3 AND resolved_at IS NULL)",rusqlite::params![local.record_id,left,right,now_ms()]).map_err(|e|e.to_string())?;
    Ok(())
}

/// Saved snapshots have no file FK and never call the legacy review machinery.
/// Epochs distinguish an explicit undo from a delayed update to a deleted item.
fn apply_saved_event(
    conn: &rusqlite::Connection,
    event: &EntityEvent,
    clock: &str,
) -> Result<bool, String> {
    let mut remote: super::saved::SavedRecord =
        serde_json::from_value(event.record.clone().ok_or("invalid_saved_record")?)
            .map_err(|_| "invalid_saved_record")?;
    if remote.record_id != event.sync_id
        || (event.operation == "delete") != remote.deleted_at.is_some()
        || !matches!(event.operation.as_str(), "upsert" | "delete")
    {
        return Err("invalid_saved_record".into());
    }
    // Observe authenticated remote HLCs so a chosen local version can advance
    // past that clock even when the devices' wall clocks differ.
    if clock
        .get(..20)
        .and_then(|v| v.parse::<i64>().ok())
        .is_none()
        || clock
            .get(21..29)
            .and_then(|v| v.parse::<u32>().ok())
            .is_none()
    {
        return Err("invalid_saved_clock".into());
    }
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('hlc',?1) ON CONFLICT(key) DO UPDATE SET value=MAX(value,excluded.value)",[clock]).map_err(|e|e.to_string())?;
    let local = super::saved::get(conn, &event.sync_id)?;
    let local_clock: Option<String> = conn
        .query_row(
            "SELECT clock FROM sync_entity_state WHERE table_name='saved_records' AND sync_id=?1",
            [&event.sync_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let pending:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sync_changes WHERE table_name='saved_records' AND sync_id=?1 AND uploaded_at IS NULL)",[&event.sync_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let mut enriched_reference = false;
    if let Some(ref local) = local {
        if let Some(reference) = &local.dictionary_reference {
            if remote.dictionary_reference.as_ref() != Some(reference) {
                if remote.dictionary_reference.is_some() {
                    saved_conflict(conn, local, &remote)?;
                }
                // Old clients omit optional metadata. Preserve a richer local
                // excerpt instead of interpreting absence as a user deletion.
                if remote
                    .dictionary_reference
                    .as_ref()
                    .is_none_or(|other| other.senses.len() < reference.senses.len())
                {
                    remote.dictionary_reference = Some(reference.clone());
                    enriched_reference = true;
                }
            }
        }
        if remote.generation < local.generation
            || remote.generation == local.generation
                && local.deleted_at.is_some()
                && remote.deleted_at.is_none()
        {
            saved_conflict(conn, local, &remote)?;
            queue_saved_state(conn, local)?;
            return Ok(false);
        }
        let same_epoch = remote.generation == local.generation;
        if same_epoch && remote.deleted_at.is_none() {
            if local_clock
                .as_deref()
                .is_some_and(|value| !value.is_empty() && value >= clock)
            {
                if local.revision != remote.revision {
                    saved_conflict(conn, local, &remote)?;
                    queue_saved_state(conn, local)?;
                }
                return Ok(false);
            }
            if local.explanation != remote.explanation
                && (local.explanation_source == "personal"
                    || remote.explanation_source == "personal")
            {
                saved_conflict(conn, local, &remote)?;
                // Unsynced personal edits, and personal text vs automatic text,
                // remain visible. Both versions are available to the user.
                if local.explanation_source == "personal"
                    && (pending || remote.explanation_source != "personal")
                {
                    queue_saved_state(conn, local)?;
                    return Ok(false);
                }
            }
        } else if local.explanation != remote.explanation {
            saved_conflict(conn, local, &remote)?;
            if remote.deleted_at.is_some() && pending && local.explanation_source == "personal" {
                remote.explanation = local.explanation.clone();
                remote.explanation_source = local.explanation_source.clone();
                remote.dictionary_snapshot = local.dictionary_snapshot.clone();
                remote.dictionary_reference = local.dictionary_reference.clone();
            }
        }
    }
    // A frozen local envelope must not re-send a pre-delete edit on the next CAS.
    conn.execute("DELETE FROM sync_changes WHERE table_name='saved_records' AND sync_id=?1 AND uploaded_at IS NULL",[&event.sync_id]).map_err(|e|e.to_string())?;
    let id = super::saved::write_record(conn, &remote)?;
    mark_state(
        conn,
        "saved_records",
        id,
        &remote.record_id,
        clock,
        remote.deleted_at.is_some(),
    )?;
    if pending || enriched_reference {
        queue_saved_state(conn, &remote)?;
    }
    Ok(true)
}

#[cfg(test)]
mod saved_sync_tests {
    use super::*;
    use crate::commands::saved::{self, Mutation, SaveInput, SavedRecord};
    fn db() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::db::init_db(&dir.path().join("sync.db")).unwrap();
        (dir, c)
    }
    fn record(c: &rusqlite::Connection) -> SavedRecord {
        c.execute_batch("INSERT INTO files(id,name,type,content,content_hash,imported_at) VALUES(1,'flight.srt','srt','We take off at noon.','h',1); INSERT INTO segments(id,file_id,index_num,en_text) VALUES(1,1,0,'We take off at noon.');").unwrap();
        saved::mutate(
            c,
            "save",
            &Mutation::Save {
                input: SaveInput {
                    segment_id: 1,
                    expression: "take off".into(),
                    start_offset: 3,
                    end_offset: 11,
                    explanation: Some("起飞".into()),
                    explanation_source: "dictionary".into(),
                    dictionary_reference: None,
                    dictionary_snapshot: Some(serde_json::from_value(serde_json::json!({
                        "schema_version": 1,
                        "headword": "take off",
                        "source": {
                            "provider": "longman", "dataset": "ldoce6-en-zh", "edition": "6",
                            "release": "longman6-reviewed-v5-quick-local-v1", "adapter_version": "1.0.0",
                            "entry_key": "take", "locator": "fixture-expression"
                        },
                        "entry_id": "longman:fixture:take-off", "group_id": "longman:fixture:take-off-group",
                        "sense_id": "longman:fixture:sense-2", "part_of_speech": "verb",
                        "meaning": { "en": "to leave the ground and begin to fly", "zh": "起飞" },
                        "examples": [{ "id": "longman:fixture:example-2", "english": "The plane took off.", "chinese": "飞机起飞了。" }]
                    })).unwrap()),
                },
            },
        )
        .unwrap()
        .record
    }
    fn event(record: &SavedRecord) -> EntityEvent {
        EntityEvent {
            version: 3,
            table_name: "saved_records".into(),
            sync_id: record.record_id.clone(),
            operation: if record.deleted_at.is_some() {
                "delete"
            } else {
                "upsert"
            }
            .into(),
            record: Some(serde_json::to_value(record).unwrap()),
        }
    }
    fn apply(c: &rusqlite::Connection, r: &SavedRecord, time: u64) -> bool {
        let tx = c.unchecked_transaction().unwrap();
        let result =
            apply_entity_event(&tx, &event(r), &format!("{time:020}:00000000:test")).unwrap();
        tx.commit().unwrap();
        result
    }
    #[test]
    fn wiktionary_reference_simulated_sync_preserves_attribution_parent_context_and_personal_notes()
    {
        let (_d, source) = db();
        let mut first = record(&source);
        first.dictionary_snapshot = None;
        first.dictionary_reference = Some(saved::DictionaryReference {
            schema_version: 1,
            kind: "dictionary_excerpt".into(),
            headword: "take off".into(),
            senses: vec![saved::wiktionary_snapshot_fixture()],
        });
        first.explanation = Some("My own explanation".into());
        first.explanation_source = "personal".into();
        saved::write_record(&source, &first).unwrap();
        // Exercise the actual outbox encryption and decrypted event decoder;
        // the configured loopback endpoint is inert and is never contacted.
        let config = LocalConfig {
            endpoint: "http://127.0.0.1:1".into(),
            email: "test@example.invalid".into(),
            device_id: "wiktionary-sync-test".into(),
            access_token: String::new(),
            data_key: String::new(),
            last_synced_at: None,
            last_remote_cursor: 0,
            auto_sync_enabled: false,
        };
        let key = [12; 32];
        prepare_outbox(&source, &config, &key, "test-account").unwrap();
        let rows = pending_outbox(&source).unwrap();
        let row = rows
            .iter()
            .find(|r| r.entity_type == "saved_records")
            .unwrap();
        let remote = RemoteRecord {
            entity_type: row.entity_type.clone(),
            entity_id: row.entity_id.clone(),
            etag: "etag".into(),
            seq: 1,
            schema_version: 1,
            deleted: false,
            nonce: URL_SAFE_NO_PAD.encode(&row.ciphertext[..24]),
            ciphertext: URL_SAFE_NO_PAD.encode(&row.ciphertext[24..]),
        };
        let decoded =
            decode_event(&decrypt_record(&key, "test-account", &remote, &row.ciphertext).unwrap())
                .unwrap();
        let arrived: SavedRecord = serde_json::from_value(decoded.record.unwrap()).unwrap();
        assert_eq!(arrived.dictionary_reference, first.dictionary_reference);
        let (_target_dir, target) = db();
        assert!(apply(&target, &arrived, 1));
        let offline = saved::get(&target, &first.record_id).unwrap().unwrap();
        assert_eq!(offline.dictionary_reference, first.dictionary_reference);
        assert_eq!(offline.explanation, first.explanation);
        let chosen = &offline.dictionary_reference.as_ref().unwrap().senses[0];
        assert_eq!(chosen.source.provider, "wiktionary");
        assert_eq!(
            chosen.source.attribution.as_deref(),
            Some(super::super::free_dictionary::ATTRIBUTION)
        );
        assert_eq!(
            chosen.ancestors.as_ref().unwrap()[0].meaning.en.as_deref(),
            Some("In aviation.")
        );
        let mut old = first.clone();
        old.dictionary_reference = None;
        old.revision = "old-omitted-reference".into();
        assert!(apply(&target, &old, 2));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_reference,
            first.dictionary_reference
        );
    }

    #[test]
    fn dictionary_reference_sync_roundtrip_and_old_client_omission_preserve_excerpt_and_tombstones()
    {
        let (_d, source) = db();
        let mut first = record(&source);
        let reference = saved::DictionaryReference {
            schema_version: 1,
            kind: "dictionary_excerpt".into(),
            headword: "take off".into(),
            senses: vec![first.dictionary_snapshot.clone().unwrap()],
        };
        first.dictionary_snapshot = None;
        first.explanation = None;
        first.explanation_source = "unknown".into();
        first.dictionary_reference = Some(reference.clone());
        saved::write_record(&source, &first).unwrap();
        let (_d2, target) = db();
        assert!(apply(&target, &first, 1));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_reference,
            Some(reference.clone())
        );
        let mut old = first.clone();
        old.dictionary_reference = None;
        old.revision = "old-client-new-revision".into();
        assert!(apply(&target, &old, 2));
        let arrived = saved::get(&target, &first.record_id).unwrap().unwrap();
        assert_eq!(arrived.dictionary_reference, Some(reference.clone()));
        assert_eq!(arrived.explanation, None);
        let removed = saved::mutate(
            &target,
            "remove-reference",
            &Mutation::Remove {
                record_id: arrived.record_id.clone(),
                expected_revision: arrived.revision.clone(),
            },
        )
        .unwrap();
        let (_d3, third) = db();
        assert!(apply(&third, &removed.record, 3));
        assert!(saved::get(&third, &first.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some());
        let restored = saved::undo(&target, &removed.operation_id).unwrap();
        assert!(apply(&third, &restored, 4));
        assert_eq!(
            saved::get(&third, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_reference,
            Some(reference)
        );
        assert_eq!(saved::groups(&third, "", 50, 0).unwrap().total_groups, 1);
        // A valid but different excerpt retains both complete wire versions.
        let mut alternative = restored.clone();
        alternative.revision = "different-excerpt".into();
        alternative.dictionary_reference.as_mut().unwrap().senses[0]
            .meaning
            .zh = Some("另一个词典参考".into());
        assert!(apply(&third, &alternative, 5));
        let conflicts: i64 = third
            .query_row(
                "SELECT COUNT(*) FROM sync_conflicts WHERE table_name='saved_records'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(conflicts, 1);
    }

    #[test]
    fn snapshot_arrives_before_material_and_deletion_survives_delayed_offline_edit() {
        let (_d, source) = db();
        let first = record(&source);
        let (_d2, target) = db();
        assert!(apply(&target, &first, 1));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .sentence,
            first.sentence
        );
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_snapshot,
            first.dictionary_snapshot
        );
        assert!(saved::resolve_source(&target, &first.record_id)
            .unwrap()
            .is_none());
        let removed = saved::mutate(
            &source,
            "remove",
            &Mutation::Remove {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
            },
        )
        .unwrap()
        .record;
        assert!(apply(&target, &removed, 2));
        let mut late = first.clone();
        late.explanation = Some("离线改动".into());
        late.explanation_source = "personal".into();
        late.revision = "late".into();
        assert!(!apply(&target, &late, 999));
        assert!(saved::get(&target, &first.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some());
        let restored = saved::undo(&source, "remove").unwrap();
        assert_eq!(restored.generation, 1);
        assert_eq!(restored.dictionary_snapshot, first.dictionary_snapshot);
        assert!(apply(&target, &restored, 3));
        assert!(saved::get(&target, &first.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_none());
        assert!(!apply(&target, &removed, 1000));
        assert!(saved::get(&target, &first.record_id)
            .unwrap()
            .unwrap()
            .deleted_at
            .is_none());
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn cambridge_source_url_and_retrieval_time_survive_real_encrypted_local_sync() {
        let (_dir, source) = db();
        let mut first = record(&source);
        let chosen = first.dictionary_snapshot.as_mut().unwrap();
        chosen.source.provider = "cambridge".into();
        chosen.source.dataset = "test-en-cn".into();
        chosen.source.edition = None;
        chosen.source.release = None;
        chosen.source.adapter_version = "cambridge-v1.0.0".into();
        chosen.source.entry_url = Some(
            "https://dictionary.cambridge.org/dictionary/english-chinese-simplified/take-off"
                .into(),
        );
        chosen.source.retrieved_at = Some("2026-10-26T01:02:03Z".into());
        chosen.entry_id = "cambridge:test:entry".into();
        chosen.group_id = "cambridge:test:group".into();
        chosen.sense_id = "cambridge:test:later-sense".into();
        saved::write_record(&source, &first).unwrap();
        let config = LocalConfig {
            endpoint: "http://127.0.0.1:1".into(),
            email: "test@example.invalid".into(),
            device_id: "cambridge-sync-test".into(),
            access_token: String::new(),
            data_key: String::new(),
            last_synced_at: None,
            last_remote_cursor: 0,
            auto_sync_enabled: false,
        };
        let key = [11; 32];
        prepare_outbox(&source, &config, &key, "test-account").unwrap();
        let rows = pending_outbox(&source).unwrap();
        let row = rows
            .iter()
            .find(|r| r.entity_type == "saved_records")
            .unwrap();
        let remote = RemoteRecord {
            entity_type: row.entity_type.clone(),
            entity_id: row.entity_id.clone(),
            etag: "etag".into(),
            seq: 1,
            schema_version: 1,
            deleted: false,
            nonce: URL_SAFE_NO_PAD.encode(&row.ciphertext[..24]),
            ciphertext: URL_SAFE_NO_PAD.encode(&row.ciphertext[24..]),
        };
        let decoded =
            decode_event(&decrypt_record(&key, "test-account", &remote, &row.ciphertext).unwrap())
                .unwrap();
        let arrived: SavedRecord = serde_json::from_value(decoded.record.unwrap()).unwrap();
        assert_eq!(arrived.dictionary_snapshot, first.dictionary_snapshot);
        let (_d, target) = db();
        assert!(apply(&target, &arrived, 1));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .dictionary_snapshot,
            first.dictionary_snapshot
        );
    }
    #[test]
    fn public_source_unknown_originals_and_received_time_survive_encrypted_local_sync() {
        for version in ["cambridge-public-v1.0.0", "cambridge-public-v1.1.0"] {
            let (_dir, source) = db();
            let mut first = record(&source);
            let chosen = first.dictionary_snapshot.as_mut().unwrap();
            chosen.source.provider = "cambridge".into();
            chosen.source.dataset = "Cambridge Dictionary (author public API)".into();
            chosen.source.edition = None;
            chosen.source.release = None;
            chosen.source.adapter_version = version.into();
            chosen.source.access_channel = Some("author_public_api".into());
            chosen.source.service_url = Some("https://dictionary-api.eliaschen.dev".into());
            chosen.source.received_at = Some("2026-10-26T03:04:05Z".into());
            chosen.entry_id = format!("cambridge:public:{version}:entry");
            chosen.group_id = format!("cambridge:public:{version}:group");
            chosen.sense_id = format!("cambridge:public:{version}:later-sense");
            for example in &mut chosen.examples {
                example.id = format!("cambridge:public:{version}:{}", example.id);
            }
            saved::write_record(&source, &first).unwrap();
            let config = LocalConfig {
                endpoint: "http://127.0.0.1:1".into(),
                email: "test@example.invalid".into(),
                device_id: "public-sync-test".into(),
                access_token: String::new(),
                data_key: String::new(),
                last_synced_at: None,
                last_remote_cursor: 0,
                auto_sync_enabled: false,
            };
            let key = [12; 32];
            prepare_outbox(&source, &config, &key, "test-account").unwrap();
            let rows = pending_outbox(&source).unwrap();
            let row = rows
                .iter()
                .find(|r| r.entity_type == "saved_records")
                .unwrap();
            let remote = RemoteRecord {
                entity_type: row.entity_type.clone(),
                entity_id: row.entity_id.clone(),
                etag: "etag".into(),
                seq: 1,
                schema_version: 1,
                deleted: false,
                nonce: URL_SAFE_NO_PAD.encode(&row.ciphertext[..24]),
                ciphertext: URL_SAFE_NO_PAD.encode(&row.ciphertext[24..]),
            };
            let decoded = decode_event(
                &decrypt_record(&key, "test-account", &remote, &row.ciphertext).unwrap(),
            )
            .unwrap();
            let wire = decoded.record.unwrap();
            assert!(wire["dictionary_snapshot"]["source"]
                .get("entry_url")
                .is_none());
            assert!(wire["dictionary_snapshot"]["source"]
                .get("retrieved_at")
                .is_none());
            let arrived: SavedRecord = serde_json::from_value(wire).unwrap();
            assert_eq!(arrived.dictionary_snapshot, first.dictionary_snapshot);
            let (_target_dir, target) = db();
            assert!(apply(&target, &arrived, 1));
            assert_eq!(
                saved::get(&target, &first.record_id)
                    .unwrap()
                    .unwrap()
                    .dictionary_snapshot,
                first.dictionary_snapshot
            );
        }
    }

    #[test]
    fn concurrent_personal_versions_are_preserved_and_automatic_answer_cannot_replace_local_edit() {
        let (_d, source) = db();
        let first = record(&source);
        let (_d2, target) = db();
        apply(&target, &first, 1);
        let local = saved::mutate(
            &target,
            "personal",
            &Mutation::Edit {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
                explanation: "我的修改".into(),
            },
        )
        .unwrap()
        .record;
        let mut remote = first.clone();
        remote.explanation = Some("另一台的修改".into());
        remote.explanation_source = "personal".into();
        remote.revision = "remote".into();
        assert!(!apply(&target, &remote, 99));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .explanation,
            local.explanation
        );
        let (left,right):(String,String)=target.query_row("SELECT local_value,remote_value FROM sync_conflicts WHERE table_name='saved_records'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert!(left.contains("我的修改"));
        assert!(right.contains("另一台的修改"));
        target
            .execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
        remote.explanation_source = "ai".into();
        remote.explanation = Some("新的自动结果".into());
        assert!(!apply(&target, &remote, 100));
        assert_eq!(
            saved::get(&target, &first.record_id)
                .unwrap()
                .unwrap()
                .explanation,
            local.explanation
        );
    }
    #[test]
    fn concurrent_remove_keeps_personal_snapshot_and_tombstones_win_in_both_orders() {
        let (_d, source) = db();
        let first = record(&source);
        let (_d2, target) = db();
        apply(&target, &first, 1);
        let local = saved::mutate(
            &target,
            "edit",
            &Mutation::Edit {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
                explanation: "保留我的编辑".into(),
            },
        )
        .unwrap()
        .record;
        let removed = saved::mutate(
            &source,
            "remove",
            &Mutation::Remove {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
            },
        )
        .unwrap()
        .record;
        assert!(apply(&target, &removed, 2));
        let snapshot = saved::get(&target, &first.record_id).unwrap().unwrap();
        assert!(snapshot.deleted_at.is_some());
        assert_eq!(snapshot.explanation, local.explanation);
        assert!(!apply(&target, &local, 900));
        assert_eq!(saved::list(&target, "", 200, 0).unwrap().len(), 0);
        let (_d3, fresh) = db();
        assert!(apply(&fresh, &removed, 2));
        assert!(!apply(&fresh, &first, 999));
        assert_eq!(saved::list(&fresh, "", 200, 0).unwrap().len(), 0);
    }
    #[test]
    fn encrypted_outbox_carries_deletion_epoch_and_backup_restore_can_requeue_tombstone() {
        let (_d, c) = db();
        let mut first = record(&c);
        first.dictionary_reference = Some(saved::DictionaryReference {
            schema_version: 1,
            kind: "dictionary_excerpt".into(),
            headword: "take off".into(),
            senses: vec![first.dictionary_snapshot.clone().unwrap()],
        });
        saved::write_record(&c, &first).unwrap();
        let removed = saved::mutate(
            &c,
            "remove",
            &Mutation::Remove {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
            },
        )
        .unwrap()
        .record;
        let local = LocalConfig {
            endpoint: "http://127.0.0.1:1".into(),
            email: "test@example.invalid".into(),
            device_id: "test-device".into(),
            access_token: String::new(),
            data_key: String::new(),
            last_synced_at: None,
            last_remote_cursor: 0,
            auto_sync_enabled: false,
        };
        let key = [7; 32];
        prepare_outbox(&c, &local, &key, "test-account").unwrap();
        let rows = pending_outbox(&c).unwrap();
        let row = rows
            .iter()
            .find(|r| r.entity_type == "saved_records")
            .unwrap();
        assert!(row.deleted);
        let remote = RemoteRecord {
            entity_type: row.entity_type.clone(),
            entity_id: row.entity_id.clone(),
            etag: "etag".into(),
            seq: 1,
            schema_version: 1,
            deleted: row.deleted,
            nonce: URL_SAFE_NO_PAD.encode(&row.ciphertext[..24]),
            ciphertext: URL_SAFE_NO_PAD.encode(&row.ciphertext[24..]),
        };
        let decoded =
            decode_event(&decrypt_record(&key, "test-account", &remote, &row.ciphertext).unwrap())
                .unwrap();
        let snapshot: SavedRecord = serde_json::from_value(decoded.record.unwrap()).unwrap();
        assert_eq!(snapshot.generation, removed.generation);
        assert_eq!(snapshot.dictionary_snapshot, first.dictionary_snapshot);
        assert_eq!(snapshot.dictionary_reference, first.dictionary_reference);
        let (_target_dir, target) = db();
        assert!(apply(&target, &snapshot, 1));
        assert_eq!(
            saved::get(&target, &snapshot.record_id)
                .unwrap()
                .unwrap()
                .dictionary_reference,
            first.dictionary_reference
        );
        assert!(snapshot.deleted_at.is_some());
        assert_eq!(snapshot.record_id, first.record_id);
        c.execute(
            "DELETE FROM sync_changes WHERE table_name='saved_records'",
            [],
        )
        .unwrap();
        queue_all_local_records(&c).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT operation FROM sync_changes WHERE table_name='saved_records'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "delete"
        );
    }

    #[test]
    fn personal_conflict_rebuilds_frozen_envelope_with_clock_after_remote() {
        let (_d, source) = db();
        let first = record(&source);
        let (_d2, target) = db();
        apply(&target, &first, 1);
        let personal = saved::mutate(
            &target,
            "edit",
            &Mutation::Edit {
                record_id: first.record_id.clone(),
                expected_revision: first.revision.clone(),
                explanation: "keep mine".into(),
            },
        )
        .unwrap()
        .record;
        let local = LocalConfig {
            endpoint: "http://127.0.0.1:1".into(),
            email: "test@example.invalid".into(),
            device_id: "test-device".into(),
            access_token: String::new(),
            data_key: String::new(),
            last_synced_at: None,
            last_remote_cursor: 0,
            auto_sync_enabled: false,
        };
        prepare_outbox(&target, &local, &[7; 32], "test-account").unwrap();
        assert_eq!(pending_outbox(&target).unwrap().len(), 1);
        let mut remote = first.clone();
        remote.explanation = Some("other device".into());
        remote.explanation_source = "personal".into();
        remote.revision = "remote-edit".into();
        let future = (now_ms() + 86_400_000) as u64;
        assert!(!apply(&target, &remote, future));
        assert!(pending_outbox(&target).unwrap().is_empty());
        prepare_outbox(&target, &local, &[7; 32], "test-account").unwrap();
        let clock: String = target
            .query_row(
                "SELECT clock FROM sync_outbox WHERE kind='saved_records' AND uploaded_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(clock.as_str() > format!("{future:020}:00000000:test").as_str());
        assert_eq!(
            saved::get(&target, &personal.record_id)
                .unwrap()
                .unwrap()
                .explanation,
            personal.explanation
        );
    }
}

fn apply_entity_event(
    conn: &rusqlite::Connection,
    event: &EntityEvent,
    clock: &str,
) -> Result<bool, String> {
    if event.table_name == "saved_records" {
        return with_remote_apply_guard(conn, || apply_saved_event(conn, event, clock));
    }
    // Library snapshots are the canonical representation of files, subtitle
    // segments and their word/phrase occurrences. Older development builds
    // uploaded those tables independently; applying them after a snapshot can
    // recreate stale foreign-key references (and duplicate a library). Keep
    // their remote cursor/etag acknowledgement, but never apply them again.
    if matches!(
        event.table_name.as_str(),
        "files" | "segments" | "occurrences" | "phrase_occurrences"
    ) {
        return Ok(false);
    }
    if event.table_name == "library_item" {
        return with_remote_apply_guard(conn, || {
            apply_library_item_event(
                conn,
                &event.sync_id,
                &event.operation,
                event.record.as_ref(),
                clock,
            )
        });
    }
    if event.table_name == "file_tags" && event.operation != "delete" {
        let record = event
            .record
            .as_ref()
            .and_then(|v| v.as_object())
            .ok_or("invalid_encrypted_record")?;
        for (field, table) in [("file_id_sync_id", "files"), ("tag_id_sync_id", "tags")] {
            let reference = string(record, field)?;
            let deleted: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sync_entity_state WHERE table_name=?1 AND deleted_at IS NOT NULL AND sync_id IN (?2,COALESCE((SELECT canonical_sync_id FROM sync_identity_aliases WHERE table_name=?1 AND alias_sync_id=?2),?2)))", rusqlite::params![table,reference], |r| r.get(0)).map_err(|e| e.to_string())?;
            if deleted {
                return Ok(false);
            }
        }
    }
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
            let associations: Vec<(i64, String)> = if event.table_name == "tags" {
                let mut stmt = conn.prepare("SELECT ft.id,s.sync_id FROM file_tags ft JOIN sync_entity_state s ON s.table_name='file_tags' AND s.local_id=ft.id WHERE ft.tag_id=?1").map_err(|e|e.to_string())?;
                let rows = stmt
                    .query_map([local_id], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map_err(|e| e.to_string())?;
                rows.collect::<rusqlite::Result<_>>()
                    .map_err(|e| e.to_string())?
            } else {
                Vec::new()
            };
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
            // Natural-name convergence can leave a second canonical envelope
            // on the server. Tombstone it as well, once, when its row exists.
            if matches!(event.table_name.as_str(), "tags" | "file_tags")
                && canonical != event.sync_id
            {
                conn.execute("INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) VALUES(?1,?2,'delete',?3)",rusqlite::params![event.table_name,canonical,now_ms()]).map_err(|e|e.to_string())?;
            }
            for (association_id, identity) in associations {
                mark_state(conn, "file_tags", association_id, &identity, clock, true)?;
                conn.execute("INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) VALUES('file_tags',?1,'delete',?2)",rusqlite::params![identity,now_ms()]).map_err(|e|e.to_string())?;
            }
        }
        // A fresh device may see only a tombstone. Remember its clock so an
        // older offline tag/association upload cannot recreate it later.
        if matches!(event.table_name.as_str(), "tags" | "file_tags") {
            let local_id: i64 = conn.query_row("SELECT COALESCE((SELECT local_id FROM sync_entity_state WHERE table_name=?1 AND sync_id=?2),(SELECT MIN(MIN(local_id),0)-1 FROM sync_entity_state WHERE table_name=?1),-1)",rusqlite::params![event.table_name,canonical],|row|row.get(0)).map_err(|e|e.to_string())?;
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
    if table == "files" {
        super::source_media::validate_file_source(r)?;
        super::document_source::validate_file_source(r)?;
    }
    if table == "tags" {
        let name = string(r, "name")?;
        let key = super::tags::name_key(&name)?;
        let current = local_id_for(conn, table, sync_id)?;
        let matching: Option<i64> = conn
            .query_row("SELECT id FROM tags WHERE name_key=?1", [&key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(id) = matching {
            if let Some(old) = current.filter(|old| *old != id) {
                set_runtime(conn, false)?;
                let moved = (|| -> Result<(), String> {
                    conn.execute("INSERT OR IGNORE INTO file_tags(file_id,tag_id) SELECT file_id,?1 FROM file_tags WHERE tag_id=?2", rusqlite::params![id,old]).map_err(|e| e.to_string())?;
                    conn.execute("DELETE FROM file_tags WHERE tag_id=?1", [old])
                        .map_err(|e| e.to_string())?;
                    Ok(())
                })();
                set_runtime(conn, true)?;
                moved?;
                conn.execute(
                    "UPDATE legacy_tag_folders SET tag_id=?1 WHERE tag_id=?2",
                    rusqlite::params![id, old],
                )
                .map_err(|e| e.to_string())?;
                conn.execute("DELETE FROM tags WHERE id=?1", [old])
                    .map_err(|e| e.to_string())?;
                // All identities already referring to the old canonical tag
                // now resolve to the surviving tag, including older aliases.
                let target_sync = sync_id_for(conn, table, id)?;
                conn.execute("UPDATE sync_identity_aliases SET canonical_sync_id=?1 WHERE table_name='tags' AND canonical_sync_id=?2",rusqlite::params![target_sync,sync_id]).map_err(|e|e.to_string())?;
            }
            let canonical = sync_id_for(conn, table, id)?;
            if canonical != sync_id {
                conn.execute("INSERT INTO sync_identity_aliases(table_name,alias_sync_id,canonical_sync_id) VALUES('tags',?1,?2) ON CONFLICT(table_name,alias_sync_id) DO UPDATE SET canonical_sync_id=excluded.canonical_sync_id", rusqlite::params![sync_id,canonical]).map_err(|e| e.to_string())?;
            }
            return Ok(id);
        }
        if let Some(id) = current {
            super::tags::rename(conn, id, &name)?;
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO tags(name,name_key,created_at) VALUES(?1,?2,?3)",
            rusqlite::params![name.trim(), key, integer(r, "created_at")?],
        )
        .map_err(|e| e.to_string())?;
        return Ok(conn.last_insert_rowid());
    }
    if table == "file_tags" {
        let file = local_id_for(conn, "files", &string(r, "file_id_sync_id")?)?
            .ok_or("sync tag association is waiting for its file")?;
        let tag = local_id_for(conn, "tags", &string(r, "tag_id_sync_id")?)?
            .ok_or("sync tag association is waiting for its tag")?;
        conn.execute(
            "INSERT OR IGNORE INTO file_tag_state(file_id) VALUES(?1)",
            [file],
        )
        .map_err(|e| e.to_string())?;
        let matching: Option<i64> = conn
            .query_row(
                "SELECT id FROM file_tags WHERE file_id=?1 AND tag_id=?2",
                rusqlite::params![file, tag],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(id) = matching {
            let canonical = sync_id_for(conn, table, id)?;
            if canonical != sync_id {
                conn.execute("INSERT INTO sync_identity_aliases(table_name,alias_sync_id,canonical_sync_id) VALUES('file_tags',?1,?2) ON CONFLICT(table_name,alias_sync_id) DO UPDATE SET canonical_sync_id=excluded.canonical_sync_id", rusqlite::params![sync_id,canonical]).map_err(|e| e.to_string())?;
            }
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO file_tags(file_id,tag_id) VALUES(?1,?2)",
            rusqlite::params![file, tag],
        )
        .map_err(|e| e.to_string())?;
        return Ok(conn.last_insert_rowid());
    }
    if let Some(id) = local_id_for(conn, table, sync_id)? {
        if table == "files" {
            super::document_source::protect_existing(conn, id, r)?;
        }
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
                    "UPDATE folders SET name=?1,created_at=?2,parent_id=?3 WHERE id=?4",
                    rusqlite::params![
                        string(r, "name")?,
                        integer(r, "created_at")?,
                        optional_string(r, "parent_id_sync_id")
                            .map(|value| local_id_for(conn, "folders", &value))
                            .transpose()?
                            .flatten(),
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
                conn.execute("UPDATE files SET name=?1,type=?2,content=?3,content_hash=?4,imported_at=?5,language=?6,folder_id=?7,media_source=?9,media_identity=?10,document_source=?11,document_identity=?12 WHERE id=?8",rusqlite::params![string(r,"name")?,string(r,"type")?,string(r,"content")?,string(r,"content_hash")?,integer(r,"imported_at")?,string(r,"language")?,folder,id,optional_string(r,"media_source"),optional_string(r,"media_identity"),optional_string(r,"document_source"),optional_string(r,"document_identity")]).map_err(|e|e.to_string())?;
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
                "SELECT id FROM files WHERE language=?1 AND ((?4 IS NOT NULL AND document_identity=?4) OR (?4 IS NULL AND content_hash=?2 AND media_identity IS ?3 AND document_identity IS NULL)) ORDER BY id LIMIT 1",
                rusqlite::params![string(r, "language")?, string(r, "content_hash")?, optional_string(r,"media_identity"),optional_string(r,"document_identity")],
                |x| x.get(0),
            )
            .optional(),
        _ => Ok(None),
    }
    .map_err(|e| e.to_string())?;
    if let Some(id) = natural {
        if table == "files" {
            super::document_source::protect_existing(conn, id, r)?;
        }
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
            conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language,folder_id,media_source,media_identity,document_source,document_identity) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",rusqlite::params![string(r,"name")?,string(r,"type")?,string(r,"content")?,string(r,"content_hash")?,integer(r,"imported_at")?,string(r,"language")?,folder,optional_string(r,"media_source"),optional_string(r,"media_identity"),optional_string(r,"document_source"),optional_string(r,"document_identity")]).map_err(|e|e.to_string())?;
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
    // Fold repeated edits from a large import/analysis run into one current
    // state per entity. Foreign-key cascades remove superseded envelopes too.
    conn.execute(
        "DELETE FROM sync_changes WHERE uploaded_at IS NULL AND id NOT IN (SELECT MAX(id) FROM sync_changes WHERE uploaded_at IS NULL GROUP BY CASE WHEN table_name='files' THEN 'library_item' ELSE table_name END,sync_id)",
        [],
    )
    .map_err(|_| "local_sync_storage_error".to_string())?;
    // A file cascade can enqueue a library snapshot before the parent delete
    // trigger runs. Remove those stale upserts before constructing envelopes;
    // a deleted file is represented by exactly one tombstone.
    conn.execute(
        "DELETE FROM sync_changes WHERE uploaded_at IS NULL AND table_name='library_item' AND operation='upsert' AND NOT EXISTS(SELECT 1 FROM sync_entity_state WHERE table_name='files' AND sync_id=sync_changes.sync_id AND deleted_at IS NULL)",
        [],
    )
    .map_err(|_| "local_sync_storage_error".to_string())?;
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
    for (change_id, mut table, sync_id, operation) in changes {
        // Files are carried by a compact library snapshot.  Rewriting the
        // queued type keeps the existing idempotent outbox machinery and uses
        // the file's stable identity as the library item's stable identity.
        if table == "files" {
            if operation == "delete" {
                conn.execute(
                    "DELETE FROM sync_changes WHERE uploaded_at IS NULL AND table_name='library_item' AND sync_id=?1 AND operation='upsert'",
                    [sync_id.as_str()],
                )
                .map_err(|_| "local_sync_storage_error")?;
            }
            conn.execute(
                "UPDATE sync_changes SET table_name='library_item' WHERE id=?1",
                [change_id],
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
            table = "library_item".to_string();
        }
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
        let mut record = if table == "saved_records" {
            // Deletion envelopes carry the epoch and snapshot too. A fresh
            // device must remember a tombstone before any late offline edit.
            super::saved::get(conn, &sync_id)?
                .map(serde_json::to_value)
                .transpose()
                .map_err(|e| e.to_string())?
        } else if operation == "upsert" {
            if table == "library_item" {
                let id = local_id_for(conn, "files", &sync_id)?
                    .ok_or("sync record disappeared before it could be sent")?;
                Some(
                    serde_json::to_value(library_item_record(conn, id)?)
                        .map_err(|_| "local_sync_storage_error".to_string())?,
                )
            } else {
                let id = local_id_for(conn, &table, &sync_id)?
                    .ok_or("sync record disappeared before it could be sent")?;
                row_record(conn, &table, id)?
            }
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
            &encode_event(&event)?,
        )?;
        if table != "library_item" {
            let local_id = if table == "saved_records" {
                conn.query_row(
                    "SELECT id FROM saved_records WHERE record_id=?1",
                    [&sync_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
            } else {
                local_id_for(conn, &table, &sync_id)?
            };
            if let Some(local_id) = local_id {
                mark_state(
                    conn,
                    &table,
                    local_id,
                    &sync_id,
                    &clock,
                    operation == "delete",
                )?;
            }
        }
        conn.execute("INSERT INTO sync_outbox(event_id,change_id,device_id,clock,kind,ciphertext) VALUES(?1,?2,?3,?4,?5,?6)",rusqlite::params![Uuid::new_v4().to_string(),change_id,local.device_id,clock,table,ciphertext]).map_err(|e|e.to_string())?;
        made += 1;
    }
    Ok(made)
}
fn pending_outbox(conn: &rusqlite::Connection) -> Result<Vec<OutboxRow>, String> {
    let mut statement=conn.prepare("SELECT o.event_id,o.kind,c.sync_id,o.ciphertext,r.etag,c.operation FROM sync_outbox o JOIN sync_changes c ON c.id=o.change_id LEFT JOIN sync_remote_state r ON r.table_name=o.kind AND r.sync_id=c.sync_id WHERE o.uploaded_at IS NULL ORDER BY o.change_id").map_err(|e|e.to_string())?;
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

async fn record_upload(
    state: &DbState,
    local: &LocalConfig,
    row: &OutboxRow,
    started_at: i64,
    total_items: u64,
    total_bytes: u64,
    completed_bytes: &mut u64,
) -> Result<RecordUpload, String> {
    if row.ciphertext.len() <= 24 {
        return Err("invalid_encrypted_record".into());
    }
    if row.entity_type == "library_item" && row.ciphertext.len() > MAX_LIBRARY_ITEM_BYTES {
        return Err("record_too_large".into());
    }
    let encoded_ciphertext = if row.ciphertext.len() > BLOB_CHUNK_SIZE {
        let mut hashes = Vec::new();
        for chunk in row.ciphertext.chunks(BLOB_CHUNK_SIZE) {
            let hash = blob_hash(chunk);
            upload_blob_chunk(local, &hash, chunk).await?;
            hashes.push(hash);
            *completed_bytes = (*completed_bytes).saturating_add(chunk.len() as u64);
            if let Ok(conn) = state.conn.lock() {
                let _ = set_progress(
                    &conn,
                    ProgressUpdate {
                        phase: "uploading",
                        completed_items: 0,
                        total_items,
                        completed_bytes: *completed_bytes,
                        total_bytes,
                        started_at,
                        retry_at: None,
                    },
                );
            }
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
        *completed_bytes = (*completed_bytes).saturating_add(row.ciphertext.len() as u64);
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

async fn push_outbox(
    state: &DbState,
    local: &LocalConfig,
    rows: Vec<OutboxRow>,
    started_at: i64,
    total_items: u64,
    total_bytes: u64,
) -> Result<PushResult, String> {
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
    let mut completed_bytes = 0u64;
    for row in selected {
        let upload = record_upload(
            state,
            local,
            row,
            started_at,
            total_items,
            total_bytes,
            &mut completed_bytes,
        )
        .await?;
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
    let mut completed_items = 0u64;
    for uploads in batches {
        let batch_items = uploads.len() as u64;
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
        completed_items = completed_items.saturating_add(batch_items);
        if let Ok(conn) = state.conn.lock() {
            let _ = set_progress(
                &conn,
                ProgressUpdate {
                    phase: "uploading",
                    completed_items,
                    total_items,
                    completed_bytes,
                    total_bytes,
                    started_at,
                    retry_at: None,
                },
            );
        }
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
        "folders" | "tags" => 0,
        "words" | "phrases" => 1,
        // A library snapshot references the stable identities above and is
        // therefore applied only after they exist locally.
        "library_item" => 2,
        "files" => 3,
        "segments" | "file_tags" => 4,
        "occurrences" | "phrase_occurrences" => 5,
        "review_logs" | "phrase_review_logs" => 6,
        _ => 7,
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
        let event = decode_event(&decrypt_record(data_key, account_id, &remote, &encrypted)?)?;
        if !(event.version == 3
            || event.version == 4
            || event.version == 5
            || event.version == 6
            || event.version == 7)
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
            if apply_entity_event(conn, &staged_record.event, &staged_record.clock).map_err(
                |error| format!("sync_apply::{}::{error}", staged_record.event.table_name),
            )? {
                applied += 1;
            }
            conn.execute("INSERT INTO sync_remote_state(table_name,sync_id,etag,server_seq) VALUES(?1,?2,?3,?4) ON CONFLICT(table_name,sync_id) DO UPDATE SET etag=excluded.etag,server_seq=excluded.server_seq", rusqlite::params![remote.entity_type,remote.entity_id,remote.etag,remote.seq]).map_err(|e|e.to_string())?;
        }
        super::tags::migrate_legacy(conn)?;
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
        .get(format!(
            "{}/v1/sync/head?after={}",
            local.endpoint, local.last_remote_cursor
        ))
        .bearer_auth(&local.access_token)
        .send()
        .await
        .map_err(|_| "network_unavailable".to_string())?;
    if !response.status().is_success() {
        return Err(server_error(response).await);
    }
    let head_body = response
        .bytes()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
    let head: SyncHead =
        serde_json::from_slice(&head_body).map_err(|_| "invalid_server_response".to_string())?;

    let started_at = now_ms();
    let (mut after, mut page_limit, mut records_done, mut bytes_done, target_head, planned_records) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let existing: Option<(i64, i64, i64, i64, String)> = conn
            .query_row(
                "SELECT target_head,after_cursor,page_limit,records_done,phase FROM sync_download_state WHERE account_id=?1",
                [account_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .optional()
            .map_err(|_| "local_sync_storage_error".to_string())?;
        if let Some((target, cursor, limit, done, _phase)) =
            existing.filter(|(_, _, _, _, phase)| phase != "idle")
        {
            if target > head.cursor {
                return Err("invalid_server_response".into());
            }
            let pending_bytes: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(length(ciphertext)+length(nonce)),0) FROM sync_download_staging WHERE account_id=?1",
                    [account_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            (
                cursor,
                limit.clamp(SYNC_SMALL_PAGE_LIMIT, SYNC_PAGE_LIMIT),
                done,
                pending_bytes,
                target,
                // A resumed operation may have been created by an older
                // client. Never let its displayed total fall below the
                // deduplicated staging count.
                conn.query_row(
                    "SELECT COUNT(*) FROM sync_download_staging WHERE account_id=?1",
                    [account_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                .max(done),
            )
        } else {
            let tx = conn
                .unchecked_transaction()
                .map_err(|_| "local_sync_storage_error")?;
            tx.execute(
                "DELETE FROM sync_download_staging WHERE account_id=?1",
                [account_id],
            )
            .map_err(|_| "local_sync_storage_error")?;
            tx.execute(
                "INSERT INTO sync_download_state(account_id,target_head,after_cursor,page_limit,phase,records_done,bytes_done,updated_at,last_error) VALUES(?1,?2,?3,?4,'downloading',0,0,?5,NULL) ON CONFLICT(account_id) DO UPDATE SET target_head=excluded.target_head,after_cursor=excluded.after_cursor,page_limit=excluded.page_limit,phase='downloading',records_done=0,bytes_done=0,updated_at=excluded.updated_at,last_error=NULL",
                rusqlite::params![account_id, head.cursor, local.last_remote_cursor, SYNC_PAGE_LIMIT, now_ms()],
            )
            .map_err(|_| "local_sync_storage_error")?;
            tx.commit().map_err(|_| "local_sync_storage_error")?;
            (
                local.last_remote_cursor,
                SYNC_PAGE_LIMIT,
                0,
                0,
                head.cursor,
                head.record_count
                    .unwrap_or_else(|| (head.cursor - local.last_remote_cursor).max(0))
                    .max(0),
            )
        }
    };
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        set_progress(
            &conn,
            ProgressUpdate {
                phase: "downloading",
                completed_items: records_done as u64,
                total_items: planned_records.max(records_done) as u64,
                completed_bytes: bytes_done as u64,
                total_bytes: 0,
                started_at,
                retry_at: None,
            },
        )?;
    }
    while after < target_head {
        let response = client
            .get(format!(
                "{}/v1/sync/records?after={after}&until={target_head}&limit={page_limit}",
                local.endpoint
            ))
            .bearer_auth(&local.access_token)
            .send()
            .await
            .map_err(|_| "network_unavailable".to_string())?;
        if !response.status().is_success() {
            return Err(server_error(response).await);
        }
        let body = response
            .bytes()
            .await
            .map_err(|_| "invalid_server_response".to_string())?;
        if body.len() > SYNC_PAGE_MAX_BYTES {
            return Err("invalid_server_response".into());
        }
        if body.len() > SYNC_PAGE_REDUCE_BYTES && page_limit > SYNC_SMALL_PAGE_LIMIT {
            page_limit = SYNC_SMALL_PAGE_LIMIT;
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE sync_download_state SET page_limit=?,updated_at=? WHERE account_id=?",
                rusqlite::params![page_limit, now_ms(), account_id],
            )
            .map_err(|_| "local_sync_storage_error")?;
            continue;
        }
        let page: Vec<RemoteRecord> =
            serde_json::from_slice(&body).map_err(|_| "invalid_server_response".to_string())?;
        if page.is_empty() {
            return Err("invalid_server_response".into());
        }
        let next_after = page.last().map(|record| record.seq).unwrap_or(after);
        if next_after <= after
            || next_after > target_head
            || page.iter().any(|record| record.seq <= after)
        {
            return Err("invalid_server_response".into());
        }
        let page_bytes = body.len() as i64;
        // Keep the SQLite guard scoped to this write.  The progress update below
        // obtains the same mutex, so retaining `conn` until the end of the loop
        // would deadlock after the first downloaded page.
        {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            let tx = conn
                .unchecked_transaction()
                .map_err(|_| "local_sync_storage_error")?;
            for record in &page {
                tx.execute(
                    "INSERT OR REPLACE INTO sync_download_staging(account_id,seq,entity_type,entity_id,etag,schema_version,deleted,nonce,ciphertext,received_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    rusqlite::params![account_id, record.seq, record.entity_type, record.entity_id, record.etag, record.schema_version, if record.deleted { 1 } else { 0 }, record.nonce, record.ciphertext, now_ms()],
                )
                .map_err(|_| "local_sync_storage_error")?;
            }
            let staged_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM sync_download_staging WHERE account_id=?1",
                    [account_id],
                    |row| row.get(0),
                )
                .map_err(|_| "local_sync_storage_error")?;
            tx.execute(
                "UPDATE sync_download_state SET after_cursor=?1,records_done=?2,bytes_done=bytes_done+?3,updated_at=?4,last_error=NULL WHERE account_id=?5",
                rusqlite::params![next_after, staged_count, page_bytes, now_ms(), account_id],
            )
            .map_err(|_| "local_sync_storage_error")?;
            tx.commit().map_err(|_| "local_sync_storage_error")?;
        }
        after = next_after;
        // The staging table is keyed by sequence. Its count is the source of
        // truth across retries, process restarts and INSERT OR REPLACE pages;
        // never accumulate a display counter independently of it.
        records_done = {
            let conn = state.conn.lock().map_err(|_| "local_sync_storage_error")?;
            conn.query_row(
                "SELECT COUNT(*) FROM sync_download_staging WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .map_err(|_| "local_sync_storage_error")?
        };
        bytes_done += page_bytes;
        {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            set_progress(
                &conn,
                ProgressUpdate {
                    phase: "downloading",
                    completed_items: records_done as u64,
                    total_items: planned_records.max(records_done) as u64,
                    completed_bytes: bytes_done as u64,
                    total_bytes: 0,
                    started_at,
                    retry_at: None,
                },
            )?;
        }
    }

    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE sync_download_state SET phase='applying',updated_at=?1 WHERE account_id=?2",
            rusqlite::params![now_ms(), account_id],
        )
        .map_err(|_| "local_sync_storage_error")?;
        set_runtime_phase(&conn, "applying")?;
        set_progress(
            &conn,
            ProgressUpdate {
                phase: "applying",
                completed_items: 0,
                total_items: records_done as u64,
                completed_bytes: 0,
                total_bytes: bytes_done as u64,
                started_at,
                retry_at: None,
            },
        )?;
    }

    let mut applied = 0u32;
    let mut backup_written = false;
    loop {
        let rows = {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            let mut statement = conn.prepare(
                "SELECT entity_type,entity_id,etag,seq,schema_version,deleted,nonce,ciphertext FROM sync_download_staging WHERE account_id=?1 ORDER BY deleted ASC, CASE entity_type WHEN 'folders' THEN 0 WHEN 'tags' THEN 0 WHEN 'file_tags' THEN 4 WHEN 'words' THEN 1 WHEN 'phrases' THEN 1 WHEN 'library_item' THEN 2 WHEN 'files' THEN 3 WHEN 'segments' THEN 4 WHEN 'occurrences' THEN 5 WHEN 'phrase_occurrences' THEN 5 WHEN 'review_logs' THEN 6 WHEN 'phrase_review_logs' THEN 6 ELSE 7 END, seq LIMIT ?2",
            ).map_err(|_| "local_sync_storage_error")?;
            let values = statement
                .query_map(rusqlite::params![account_id, SYNC_APPLY_BATCH], |row| {
                    Ok(RemoteRecord {
                        entity_type: row.get(0)?,
                        entity_id: row.get(1)?,
                        etag: row.get(2)?,
                        seq: row.get(3)?,
                        schema_version: row.get(4)?,
                        deleted: row.get::<_, i64>(5)? != 0,
                        nonce: row.get(6)?,
                        ciphertext: row.get(7)?,
                    })
                })
                .map_err(|_| "local_sync_storage_error")?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "local_sync_storage_error")?;
            values
        };
        if rows.is_empty() {
            break;
        }
        let seqs: Vec<i64> = rows.iter().map(|record| record.seq).collect();
        let mut staged = stage_remote_records(local, data_key, account_id, rows).await?;
        // Release the SQLite guard before the remaining-record/progress query
        // below.  This mirrors the download path: keeping it alive here would
        // self-deadlock after the first apply batch.
        {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            if !backup_written {
                write_safety_backup(&conn)?;
                backup_written = true;
            }
            applied = applied.saturating_add(apply_remote_records(&conn, &mut staged)?);
            let tx = conn
                .unchecked_transaction()
                .map_err(|_| "local_sync_storage_error")?;
            for seq in seqs {
                tx.execute(
                    "DELETE FROM sync_download_staging WHERE account_id=?1 AND seq=?2",
                    rusqlite::params![account_id, seq],
                )
                .map_err(|_| "local_sync_storage_error")?;
            }
            tx.execute(
                "UPDATE sync_download_state SET updated_at=?1 WHERE account_id=?2",
                rusqlite::params![now_ms(), account_id],
            )
            .map_err(|_| "local_sync_storage_error")?;
            tx.commit().map_err(|_| "local_sync_storage_error")?;
        }
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_download_staging WHERE account_id=?1",
                [account_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        set_progress(
            &conn,
            ProgressUpdate {
                phase: "applying",
                completed_items: records_done.saturating_sub(remaining) as u64,
                total_items: records_done as u64,
                completed_bytes: bytes_done.max(0) as u64,
                total_bytes: bytes_done.max(0) as u64,
                started_at,
                retry_at: None,
            },
        )?;
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_download_state WHERE account_id=?1",
        [account_id],
    )
    .map_err(|_| "local_sync_storage_error")?;
    local.last_remote_cursor = target_head;
    set_progress(
        &conn,
        ProgressUpdate {
            phase: "applying",
            completed_items: records_done as u64,
            total_items: records_done as u64,
            completed_bytes: bytes_done as u64,
            total_bytes: bytes_done as u64,
            started_at,
            retry_at: None,
        },
    )?;
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
    let pending_downloads: u32 = conn
        .query_row("SELECT COUNT(*) FROM sync_download_staging", [], |row| {
            row.get(0)
        })
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
    let progress = runtime_value("progress")
        .and_then(|value| serde_json::from_str::<SyncProgress>(&value).ok());
    let diagnostic = runtime_value("diagnostic")
        .and_then(|value| serde_json::from_str::<SyncDiagnostic>(&value).ok());
    Ok(match value {
        Some(c) => SyncStatus {
            configured: true,
            email: Some(c.email),
            device_id: Some(c.device_id),
            last_synced_at: c.last_synced_at,
            phase: runtime_value("phase").unwrap_or_else(|| "idle".into()),
            pending_uploads,
            pending_downloads,
            conflicts: conflict_count,
            last_error: runtime_value("last_error").filter(|value| !value.is_empty()),
            last_uploaded: runtime_count("last_uploaded"),
            last_downloaded: runtime_count("last_downloaded"),
            auto_sync_enabled: c.auto_sync_enabled,
            next_retry_at: runtime_value("next_retry_at").and_then(|value| value.parse().ok()),
            progress,
            diagnostic,
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
            progress: None,
            diagnostic: None,
        },
    })
}
#[tauri::command]
pub fn sync_set_auto_sync(state: State<DbState>, enabled: bool) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut local = config(&conn)?.ok_or("sync_service_not_configured")?;
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
        "INSERT INTO sync_changes(table_name,sync_id,operation,changed_at) SELECT s.table_name,s.sync_id,CASE WHEN s.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END,?1 FROM sync_entity_state s WHERE s.table_name IN ('tags','file_tags','files','words','phrases','review_logs','phrase_review_logs','saved_records') AND NOT EXISTS(SELECT 1 FROM sync_changes c WHERE c.table_name=s.table_name AND c.sync_id=s.sync_id AND c.uploaded_at IS NULL)",
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

/// German capitalisation distinguishes valid words (for example, `Ihr` and
/// `ihr`), so word identities for German retain it. Other languages preserve
/// the original case-insensitive matching contract.
fn stable_word_entity_id(key: &[u8; 32], language: &str, lemma: &str) -> String {
    let normalized_language = language.trim().to_ascii_lowercase();
    if normalized_language.split('-').next() != Some("de") {
        return stable_entity_id(key, "word", &[language, lemma]);
    }

    let mut value = b"word".to_vec();
    value.push(0);
    value.extend_from_slice(normalized_language.as_bytes());
    value.push(0);
    value.extend_from_slice(lemma.trim().as_bytes());
    let id_key = derived_key(key, b"stable-id");
    hmac_sha256(&id_key, &value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Debug)]
struct StableIdentityUpdate {
    table: &'static str,
    local_id: i64,
    sync_id: String,
}

fn stable_identity_updates(
    conn: &rusqlite::Connection,
    key: &[u8; 32],
) -> Result<Vec<StableIdentityUpdate>, String> {
    let mut updates = Vec::new();
    for (table, query, kind) in [
        ("words", "SELECT id,language,lemma FROM words", "word"),
        ("phrases", "SELECT id,language,text FROM phrases", "phrase"),
        (
            "files",
            "SELECT id,language,CASE WHEN document_identity IS NOT NULL THEN content_hash||':document:'||document_identity WHEN media_identity IS NULL THEN content_hash ELSE content_hash||':'||media_identity END FROM files",
            "file",
        ),
    ] {
        let mut statement = conn
            .prepare(query)
            .map_err(|_| "local_sync_storage_error".to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| "local_sync_storage_error".to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "local_sync_storage_error".to_string())?;
        let mut ids = HashSet::new();
        for (local_id, first, second) in rows {
            let sync_id = if table == "words" {
                stable_word_entity_id(key, &first, &second)
            } else {
                stable_entity_id(key, kind, &[&first, &second])
            };
            if !ids.insert(sync_id.clone()) {
                return Err("local_identity_conflict".into());
            }
            updates.push(StableIdentityUpdate {
                table,
                local_id,
                sync_id,
            });
        }
    }
    let file_ids: std::collections::HashMap<i64, String> = updates
        .iter()
        .filter(|update| update.table == "files")
        .map(|update| (update.local_id, update.sync_id.clone()))
        .collect();
    let mut statement = conn.prepare("SELECT ft.id,ft.file_id,state.sync_id FROM file_tags ft JOIN sync_entity_state state ON state.table_name='tags' AND state.local_id=ft.tag_id").map_err(|_| "local_sync_storage_error")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| "local_sync_storage_error")?;
    for row in rows {
        let (local_id, file_id, tag_sync_id) = row.map_err(|_| "local_sync_storage_error")?;
        let file_sync_id = file_ids.get(&file_id).ok_or("local_sync_storage_error")?;
        updates.push(StableIdentityUpdate {
            table: "file_tags",
            local_id,
            sync_id: format!("ft-{file_sync_id}-{tag_sync_id}"),
        });
    }
    Ok(updates)
}

/// Existing local rows were created before an account key existed. Derive and
/// validate every identity before a single write, so a retry can always repair
/// an interrupted prior enrollment without leaving a partially rewritten set.
fn stabilize_sync_ids(conn: &rusqlite::Connection, key: &[u8; 32]) -> Result<(), String> {
    let updates = stable_identity_updates(conn, key)?;
    let target_rows: HashSet<(&str, i64)> = updates
        .iter()
        .map(|item| (item.table, item.local_id))
        .collect();

    for update in &updates {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT local_id FROM sync_entity_state WHERE table_name=?1 AND sync_id=?2",
                rusqlite::params![update.table, update.sync_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "local_sync_storage_error".to_string())?;
        if let Some(local_id) = existing {
            if !target_rows.contains(&(update.table, local_id)) {
                return Err("local_identity_conflict".into());
            }
        }
    }

    let transaction = conn
        .unchecked_transaction()
        .map_err(|_| "local_sync_storage_error".to_string())?;
    transaction
        .execute("DELETE FROM sync_changes WHERE uploaded_at IS NULL", [])
        .map_err(|_| "local_sync_storage_error".to_string())?;
    for update in &updates {
        let temporary_id = format!("pending-stable-id:{}", Uuid::new_v4());
        let changed = transaction
            .execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name=?2 AND local_id=?3",
                rusqlite::params![temporary_id, update.table, update.local_id],
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
        if changed != 1 {
            return Err("local_sync_storage_error".into());
        }
    }
    for update in &updates {
        transaction
            .execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name=?2 AND local_id=?3",
                rusqlite::params![update.sync_id, update.table, update.local_id],
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "local_sync_storage_error".to_string())
}

fn save_account(
    conn: &rusqlite::Connection,
    endpoint: String,
    email: String,
    auth: AuthResponse,
    data_key: [u8; 32],
) -> Result<(), String> {
    write_safety_backup(conn)?;
    stabilize_sync_ids(conn, &data_key)?;
    let secrets = SyncSecrets {
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        data_key: URL_SAFE_NO_PAD.encode(data_key),
        account_id: auth.account_id,
    };
    let config = LocalConfig {
        endpoint,
        email,
        device_id: auth.device_id,
        access_token: String::new(),
        data_key: String::new(),
        last_synced_at: None,
        last_remote_cursor: 0,
        auto_sync_enabled: true,
    };
    let transaction = conn
        .unchecked_transaction()
        .map_err(|_| "local_sync_storage_error".to_string())?;
    save_native_secrets(&secrets)?;
    let result = save_config(&transaction, &config)
        .and_then(|_| {
            transaction
                .execute("DELETE FROM sync_remote_state", [])
                .map(|_| ())
                .map_err(|_| "local_sync_storage_error".to_string())
        })
        .and_then(|_| {
            transaction
                .execute("DELETE FROM sync_download_state", [])
                .map(|_| ())
                .map_err(|_| "local_sync_storage_error".to_string())
        })
        .and_then(|_| {
            transaction
                .execute("DELETE FROM sync_download_staging", [])
                .map(|_| ())
                .map_err(|_| "local_sync_storage_error".to_string())
        })
        .and_then(|_| queue_all_local_records(&transaction))
        .and_then(|_| {
            transaction
                .commit()
                .map_err(|_| "local_sync_storage_error".to_string())
        });
    if let Err(error) = result {
        let _ = clear_native_secrets();
        return Err(error);
    }
    Ok(())
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
    let recovery: AuthResponse = response
        .json()
        .await
        .map_err(|_| "invalid_server_response".to_string())?;
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
    let result = match sync_now_inner(&state).await {
        Err(value) if value == "session_expired" || value == "auth_required" => {
            refresh_native_session(&state).await?;
            sync_now_inner(&state).await
        }
        result => result,
    };
    result.map_err(|value| {
        let code = stable_sync_error(value.clone());
        record_sync_diagnostic(&state, &value, &code);
        code
    })
}

async fn sync_now_inner(state: &DbState) -> Result<(), String> {
    let started_at = now_ms();
    let secrets = load_native_secrets()?;
    let (mut local, data_key) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let local = apply_secrets(
            config(&conn)?.ok_or("sync_service_not_configured")?,
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
    pull_apply_events(state, &mut local, &data_key, &secrets.account_id).await?;
    {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        prepare_outbox(&conn, &local, &data_key, &secrets.account_id)?;
        let (total_items, total_bytes): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM((length(ciphertext)*4)/3 + 64 + 256),0) FROM sync_outbox WHERE uploaded_at IS NULL",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "local_sync_storage_error".to_string())?;
        set_progress(
            &conn,
            ProgressUpdate {
                phase: "uploading",
                completed_items: 0,
                total_items: total_items.max(0) as u64,
                completed_bytes: 0,
                total_bytes: total_bytes.max(0) as u64,
                started_at,
                retry_at: None,
            },
        )?;
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
        let (total_items, total_bytes): (i64, i64) = {
            let conn = state.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM((length(ciphertext)*4)/3 + 64 + 256),0) FROM sync_outbox WHERE uploaded_at IS NULL",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| "local_sync_storage_error".to_string())?
        };
        let pushed = push_outbox(
            state,
            &local,
            outbox,
            started_at,
            total_items.max(0) as u64,
            total_bytes.max(0) as u64,
        )
        .await?;
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
    let downloaded = pull_apply_events(state, &mut local, &data_key, &secrets.account_id).await?;
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    local.last_synced_at = Some(now_ms());
    save_config(&conn, &local)?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_uploaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[uploaded.to_string()]).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO sync_runtime(key,value) VALUES('last_downloaded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[downloaded.to_string()]).map_err(|e|e.to_string())?;
    set_runtime_phase(&conn, "idle")?;
    clear_progress(&conn)?;
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
            .ok_or("sync_service_not_configured")?
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
            .ok_or("sync_service_not_configured")?
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
        conn.execute("DELETE FROM sync_download_state", [])
            .map_err(|_| "local_sync_storage_error")?;
        conn.execute("DELETE FROM sync_download_staging", [])
            .map_err(|_| "local_sync_storage_error")?;
        clear_progress(&conn)?;
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
            config(&conn)?.ok_or("sync_service_not_configured")?,
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
        .map_err(|_| "invalid_server_response".to_string())
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
            config(&conn)?.ok_or("sync_service_not_configured")?,
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
            config(&conn)?.ok_or("sync_service_not_configured")?,
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
    fn library_snapshot_preserves_ai_output_and_occurrences_in_one_compressed_event() {
        let source_file = tempfile::NamedTempFile::new().unwrap();
        let source = crate::db::init_db(source_file.path()).unwrap();
        source
            .execute("INSERT INTO words(language,lemma) VALUES('en','hello')", [])
            .unwrap();
        let word_id = source.last_insert_rowid();
        source
            .execute(
                "INSERT INTO phrases(language,text) VALUES('en','hello world')",
                [],
            )
            .unwrap();
        let phrase_id = source.last_insert_rowid();
        source
            .execute(
                "INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('demo.srt','srt','source','hash',1,'en')",
                [],
            )
            .unwrap();
        let file_id = source.last_insert_rowid();
        source
            .execute(
                "INSERT INTO segments(file_id,index_num,en_text,zh_text,start_time,end_time) VALUES(?1,0,'Hello world','你好，世界','00:00','00:01')",
                [file_id],
            )
            .unwrap();
        let segment_id = source.last_insert_rowid();
        source
            .execute(
                "INSERT INTO occurrences(word_id,segment_id,original_form,position,hidden,meaning_zh,usage_zh,collins_sense_id,meaning_edited,analysis_model,analyzed_at) VALUES(?1,?2,'Hello',0,0,'本句你好','用作问候',7,1,'test-model',3)",
                rusqlite::params![word_id, segment_id],
            )
            .unwrap();
        source
            .execute(
                "INSERT INTO phrase_occurrences(phrase_id,segment_id,position,hidden,surface_text,token_positions_json,meaning_zh,usage_zh,meaning_edited,meaning_en,usage_en,meaning_en_edited,collins_sense_id) VALUES(?1,?2,0,1,'Hello world','[0,1]','本句问候','固定问候语',1,'A greeting','Used to greet',1,42)",
                rusqlite::params![phrase_id, segment_id],
            )
            .unwrap();
        source
            .execute(
                "INSERT INTO file_phrase_analysis(file_id,model,completed_at,pipeline_version) VALUES(?1,'local-model',2,2)",
                [file_id],
            )
            .unwrap();
        source
            .execute(
                "INSERT INTO phrase_dictionary_entries(language,text,translation,provider,updated_at,other_senses_json,other_senses_edited,meaning_en,usage_en,other_senses_en_json,other_senses_en_edited) VALUES('en','hello world','你好世界','local-model',2,'[{\"meaning_zh\":\"另一用法\",\"example_en\":\"Hello world!\"}]',1,'A greeting','Used to greet','[{\"meaning_en\":\"A test phrase\",\"example_en\":\"Hello world!\"}]',1)",
                [],
            )
            .unwrap();
        let metadata = r#"{"register_tags":["informal"],"regions":["UK"],"cautions":["offensive"],"evidence_kind":"dictionary"}"#;
        source
            .execute(
                "UPDATE phrase_occurrences SET expression_meta_json=?1 WHERE phrase_id=?2",
                rusqlite::params![metadata, phrase_id],
            )
            .unwrap();
        source.execute("UPDATE phrase_dictionary_entries SET expression_meta_json=?1 WHERE text='hello world'",[metadata]).unwrap();
        let source_word_sync = sync_id_for(&source, "words", word_id).unwrap();
        let source_phrase_sync = sync_id_for(&source, "phrases", phrase_id).unwrap();
        let source_file_sync = sync_id_for(&source, "files", file_id).unwrap();
        let snapshot = library_item_record(&source, file_id).unwrap();
        assert_eq!(snapshot.segments.len(), 1);
        assert_eq!(snapshot.segments[0].occurrences.len(), 1);
        assert_eq!(
            snapshot.segments[0].occurrences[0].meaning_zh.as_deref(),
            Some("本句你好")
        );
        assert_eq!(
            snapshot.segments[0].occurrences[0].collins_sense_id,
            Some(7)
        );
        assert_eq!(snapshot.segments[0].phrase_occurrences[0].hidden, 1);
        assert_eq!(
            snapshot.segments[0].phrase_occurrences[0]
                .meaning_zh
                .as_deref(),
            Some("本句问候")
        );
        assert_eq!(
            snapshot.segments[0].phrase_occurrences[0]
                .meaning_en
                .as_deref(),
            Some("A greeting")
        );
        assert_eq!(
            snapshot.segments[0].phrase_occurrences[0]
                .expression_meta_json
                .as_deref(),
            Some(metadata)
        );
        assert_eq!(
            snapshot.phrase_dictionary_entries[0]
                .expression_meta_json
                .as_deref(),
            Some(metadata)
        );

        let event = EntityEvent {
            version: 3,
            table_name: "library_item".into(),
            sync_id: source_file_sync.clone(),
            operation: "upsert".into(),
            record: Some(serde_json::to_value(&snapshot).unwrap()),
        };
        let encoded = encode_event(&event).unwrap();
        assert!(encoded.starts_with(COMPRESSED_EVENT_MAGIC));
        let decoded = decode_event(&encoded).unwrap();
        assert_eq!(decoded.table_name, "library_item");

        let target_file = tempfile::NamedTempFile::new().unwrap();
        let target = crate::db::init_db(target_file.path()).unwrap();
        target
            .execute("INSERT INTO words(language,lemma) VALUES('en','hello')", [])
            .unwrap();
        let target_word = target.last_insert_rowid();
        target
            .execute(
                "INSERT INTO phrases(language,text) VALUES('en','hello world')",
                [],
            )
            .unwrap();
        let target_phrase = target.last_insert_rowid();
        target
            .execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name='words' AND local_id=?2",
                rusqlite::params![source_word_sync, target_word],
            )
            .unwrap();
        target
            .execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name='phrases' AND local_id=?2",
                rusqlite::params![source_phrase_sync, target_phrase],
            )
            .unwrap();
        target
            .execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
        apply_entity_event(&target, &decoded, "00000000000000000001:00000000:test").unwrap();
        let restored: (String, String, i64, i64) = target
            .query_row(
                "SELECT s.zh_text,p.translation,
                 (SELECT COUNT(*) FROM occurrences),
                 (SELECT COUNT(*) FROM phrase_occurrences)
                 FROM segments s JOIN phrase_dictionary_entries p ON p.text='hello world' LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(restored, ("你好，世界".into(), "你好世界".into(), 1, 1));
        let restored_metadata:(Option<String>,Option<String>)=target.query_row("SELECT po.expression_meta_json,pde.expression_meta_json FROM phrase_occurrences po JOIN phrase_dictionary_entries pde ON pde.text='hello world' LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(
            restored_metadata,
            (Some(metadata.into()), Some(metadata.into()))
        );

        type RestoredWordAi = (
            Option<String>,
            Option<String>,
            Option<i64>,
            i64,
            Option<String>,
            Option<i64>,
        );
        let restored_word_ai: RestoredWordAi = target.query_row(
            "SELECT meaning_zh,usage_zh,collins_sense_id,meaning_edited,analysis_model,analyzed_at FROM occurrences LIMIT 1", [],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
        ).unwrap();
        assert_eq!(
            restored_word_ai,
            (
                Some("本句你好".into()),
                Some("用作问候".into()),
                Some(7),
                1,
                Some("test-model".into()),
                Some(3)
            )
        );
        let restored_ai: (Option<String>, Option<String>, i64, String, i64, i64) = target.query_row(
            "SELECT po.meaning_zh,po.token_positions_json,po.meaning_edited,pde.other_senses_json,pde.other_senses_edited,fpa.pipeline_version FROM phrase_occurrences po JOIN phrase_dictionary_entries pde ON pde.text='hello world' JOIN file_phrase_analysis fpa ON fpa.file_id=(SELECT file_id FROM segments WHERE id=po.segment_id) LIMIT 1",
            [],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
        ).unwrap();
        assert_eq!(restored_ai.0.as_deref(), Some("本句问候"));
        assert_eq!(restored_ai.1.as_deref(), Some("[0,1]"));
        assert_eq!(restored_ai.2, 1);
        assert!(restored_ai.3.contains("另一用法"));
        assert_eq!((restored_ai.4, restored_ai.5), (1, 2));
        type RestoredEnglish = (
            Option<String>,
            Option<String>,
            i64,
            Option<i64>,
            Option<String>,
            String,
            i64,
        );
        let restored_english: RestoredEnglish = target.query_row(
            "SELECT po.meaning_en,po.usage_en,po.meaning_en_edited,po.collins_sense_id,pde.meaning_en,pde.other_senses_en_json,pde.other_senses_en_edited FROM phrase_occurrences po JOIN phrase_dictionary_entries pde ON pde.text='hello world' LIMIT 1",
            [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
        ).unwrap();
        assert_eq!(restored_english.0.as_deref(), Some("A greeting"));
        assert_eq!(restored_english.1.as_deref(), Some("Used to greet"));
        assert_eq!((restored_english.2, restored_english.3), (1, Some(42)));
        assert_eq!(restored_english.4.as_deref(), Some("A greeting"));
        assert!(restored_english.5.contains("A test phrase"));
        assert_eq!(restored_english.6, 1);
        let pending_after_remote_apply: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE uploaded_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(pending_after_remote_apply, 0);

        target
            .execute("UPDATE segments SET zh_text='更新后的本机内容'", [])
            .unwrap();
        let local_library_changes: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE table_name='library_item' AND uploaded_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(local_library_changes, 1);
        target
            .execute(
                "UPDATE sync_changes SET uploaded_at=1 WHERE uploaded_at IS NULL",
                [],
            )
            .unwrap();

        let delete_event = EntityEvent {
            version: 3,
            table_name: "library_item".into(),
            sync_id: source_file_sync,
            operation: "delete".into(),
            record: None,
        };
        apply_entity_event(&target, &delete_event, "00000000000000000002:00000000:test").unwrap();
        let remaining_files: i64 = target
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        let pending_after_remote_delete: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM sync_changes WHERE uploaded_at IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_files, 0);
        assert_eq!(pending_after_remote_delete, 0);
    }
    #[test]
    fn key_package_requires_correct_secret() {
        let key = [7; 32];
        let wrapped = wrap(&key, "correct horse battery staple").unwrap();
        assert_eq!(
            unwrap(&wrapped, "correct horse battery staple").unwrap(),
            key
        );
        assert_eq!(
            unwrap(&wrapped, "wrong").unwrap_err(),
            "invalid_key_package"
        );
        let malformed = WrappedKey {
            salt: "not-base64".into(),
            nonce: wrapped.nonce,
            ciphertext: wrapped.ciphertext,
        };
        assert_eq!(
            unwrap(&malformed, "correct horse battery staple").unwrap_err(),
            "invalid_key_package"
        );
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
    fn german_word_ids_preserve_case_while_other_languages_remain_case_insensitive() {
        let key = [9; 32];
        assert_ne!(
            stable_word_entity_id(&key, "de", "Ihr"),
            stable_word_entity_id(&key, "de", "ihr")
        );
        assert_ne!(
            stable_word_entity_id(&key, "de-DE", "Muss"),
            stable_word_entity_id(&key, "de-DE", "muss")
        );
        assert_eq!(
            stable_word_entity_id(&key, "EN", " Word "),
            stable_word_entity_id(&key, "en", "word")
        );
    }

    #[test]
    fn stabilization_repairs_partially_rewritten_german_case_variants() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection
            .execute(
                "INSERT INTO words(language,lemma,status) VALUES ('de','Ihr','learning'), ('de','ihr','known')",
                [],
            )
            .unwrap();
        let ihr_id: i64 = connection
            .query_row("SELECT id FROM words WHERE lemma='Ihr'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let ihr_sync_id = stable_word_entity_id(&[5; 32], "de", "Ihr");
        connection
            .execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name='words' AND local_id=?2",
                rusqlite::params![ihr_sync_id, ihr_id],
            )
            .unwrap();

        stabilize_sync_ids(&connection, &[5; 32]).unwrap();

        let ids: Vec<String> = connection
            .prepare(
                "SELECT sync_id FROM sync_entity_state WHERE table_name='words' ORDER BY local_id",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
        assert!(ids.iter().all(|id| id.len() == 64));
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM words", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn stabilization_rejects_an_existing_tombstone_identity_without_writing() {
        let directory = tempfile::tempdir().unwrap();
        let connection = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        connection
            .execute(
                "INSERT INTO words(language,lemma,status) VALUES ('en','conflict','learning')",
                [],
            )
            .unwrap();
        let word_id: i64 = connection
            .query_row("SELECT id FROM words WHERE lemma='conflict'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let original = sync_id_for(&connection, "words", word_id).unwrap();
        let conflicting_id = stable_word_entity_id(&[6; 32], "en", "conflict");
        connection
            .execute(
                "INSERT INTO sync_entity_state(table_name,local_id,sync_id,updated_at,deleted_at,clock) VALUES ('words',999,?1,0,0,'')",
                [conflicting_id],
            )
            .unwrap();

        assert_eq!(
            stabilize_sync_ids(&connection, &[6; 32]).unwrap_err(),
            "local_identity_conflict"
        );
        assert_eq!(
            sync_id_for(&connection, "words", word_id).unwrap(),
            original
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

    #[test]
    fn tombstoned_vocabulary_does_not_block_old_library_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('original','txt','text','hash',1,'en')", []).unwrap();
        let file_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO segments(file_id,index_num,en_text) VALUES(?1,0,'keep removed phrase')",
            [file_id],
        )
        .unwrap();
        let segment_id = conn.last_insert_rowid();
        for lemma in ["keep", "removed"] {
            conn.execute("INSERT INTO words(language,lemma) VALUES('en',?1)", [lemma])
                .unwrap();
            let word_id = conn.last_insert_rowid();
            conn.execute(
                "UPDATE sync_entity_state SET sync_id=?1 WHERE table_name='words' AND local_id=?2",
                rusqlite::params![format!("words-{lemma}"), word_id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO occurrences(word_id,segment_id,original_form,position) VALUES(?1,?2,?3,0)",
                rusqlite::params![word_id, segment_id, lemma],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO phrases(language,text,source) VALUES('en',?1,'detected')",
                [lemma],
            )
            .unwrap();
            let phrase_id = conn.last_insert_rowid();
            conn.execute("UPDATE sync_entity_state SET sync_id=?1 WHERE table_name='phrases' AND local_id=?2",rusqlite::params![format!("phrases-{lemma}"),phrase_id]).unwrap();
            conn.execute(
                "INSERT INTO phrase_occurrences(phrase_id,segment_id,position) VALUES(?1,?2,0)",
                rusqlite::params![phrase_id, segment_id],
            )
            .unwrap();
        }
        let sync_id = sync_id_for(&conn, "files", file_id).unwrap();
        // Frozen, synthetic v1 payload intentionally lacks newer AI/tag
        // fields. Do not regenerate it with the current serializer: that
        // would hide backwards-compatibility regressions.
        let mut snapshot: LibraryItemRecord = serde_json::from_str(include_str!(
            "../../tests/fixtures/library-snapshot-v1.json"
        ))
        .unwrap();
        assert_eq!(snapshot.segments[0].occurrences[0].meaning_edited, 0);
        assert_eq!(snapshot.segments[0].phrase_occurrences[0].meaning_en, None);
        let removed_word = &mut snapshot.segments[0].occurrences[1];
        conn.execute("INSERT INTO sync_identity_aliases(table_name,alias_sync_id,canonical_sync_id) VALUES('words','old-word',?1)",[&removed_word.word_sync_id]).unwrap();
        removed_word.word_sync_id = "old-word".into();
        conn.execute("DELETE FROM words WHERE lemma='removed'", [])
            .unwrap();
        conn.execute("DELETE FROM phrases WHERE text='removed'", [])
            .unwrap();
        conn.execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
        let mut event = EntityEvent {
            version: 3,
            table_name: "library_item".into(),
            sync_id,
            operation: "upsert".into(),
            record: Some(serde_json::to_value(snapshot).unwrap()),
        };
        conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert!(apply_entity_event(&conn, &event, "00000000000000000001:00000000:test").unwrap());
        conn.execute_batch("COMMIT").unwrap();
        // The current envelope can replay the same historical payload too.
        event.version = 4;
        assert!(apply_entity_event(&conn, &event, "00000000000000000002:00000000:test").unwrap());
        assert_eq!(
            conn.query_row("SELECT name FROM files WHERE id=?1", [file_id], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "restored"
        );
        assert_eq!(
            conn.query_row(
                "SELECT zh_text FROM segments WHERE file_id=?1",
                [file_id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "restored translation"
        );
        for table in ["occurrences", "phrase_occurrences", "words", "phrases"] {
            assert_eq!(
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                1
            );
        }
        assert_eq!(
            library_reference_id(&conn, "words", "unknown").unwrap_err(),
            "invalid_encrypted_record"
        );
        assert_eq!(
            library_reference_id(&conn, "phrases", "unknown").unwrap_err(),
            "invalid_encrypted_record"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
    }

    #[test]
    fn library_write_failure_preserves_diagnostic_and_rolls_back() {
        let directory = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&directory.path().join("lexicue.db")).unwrap();
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('original','txt','text','hash',1,'en')", []).unwrap();
        let file_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO segments(file_id,index_num,en_text) VALUES(?1,0,'original segment')",
            [file_id],
        )
        .unwrap();
        let sync_id = sync_id_for(&conn, "files", file_id).unwrap();
        let mut snapshot = library_item_record(&conn, file_id).unwrap();
        snapshot.file["name"] = "remote change".into();
        conn.execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
        // Simulate SQLite rejecting the replacement after the old segments
        // have been removed, so this also verifies transaction rollback.
        conn.execute_batch("CREATE TRIGGER reject_restored_segment BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT,'FOREIGN KEY constraint failed'); END;").unwrap();
        let mut records = [StagedRemoteRecord {
            remote: RemoteRecord {
                entity_type: "library_item".into(),
                entity_id: sync_id.clone(),
                etag: "etag".into(),
                seq: 1,
                schema_version: 1,
                deleted: false,
                nonce: String::new(),
                ciphertext: String::new(),
            },
            event: EntityEvent {
                version: 4,
                table_name: "library_item".into(),
                sync_id,
                operation: "upsert".into(),
                record: Some(serde_json::to_value(snapshot).unwrap()),
            },
            clock: "00000000000000000001:00000000:test".into(),
        }];
        let error = apply_remote_records(&conn, &mut records).unwrap_err();
        assert_eq!(diagnostic_kind(&error), "sqlite_foreign_key");
        assert_eq!(stable_sync_error(error), "local_sync_storage_error");
        assert_eq!(
            conn.query_row("SELECT name FROM files WHERE id=?1", [file_id], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert_eq!(
            conn.query_row(
                "SELECT en_text FROM segments WHERE file_id=?1",
                [file_id],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "original segment"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM sync_remote_state", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn native_storage_failures_are_never_exposed_as_unknown_errors() {
        for code in [
            "invalid_encrypted_record",
            "session_expired",
            "network_unavailable",
            "record_authentication_failed",
            "blob_not_found",
        ] {
            assert_eq!(stable_sync_error(code.into()), code);
            assert_eq!(
                stable_sync_error(format!("sync_apply::library_item::{code}")),
                code
            );
        }
        assert_eq!(
            stable_sync_error("private_error_text".into()),
            "local_sync_storage_error"
        );
        assert_eq!(
            stable_sync_error("database is locked".into()),
            "local_sync_storage_error"
        );
        assert_eq!(
            stable_sync_error(
                "UNIQUE constraint failed: sync_entity_state.table_name, sync_entity_state.sync_id"
                    .into()
            ),
            "local_identity_conflict"
        );
        assert_eq!(
            stable_sync_error("sync occurrence is waiting for its word".into()),
            "invalid_encrypted_record"
        );
    }

    #[test]
    fn legacy_library_child_events_are_acknowledged_without_local_writes() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        // The routing rule itself is independent of an existing library and
        // prevents obsolete row-level occurrence payloads from violating FKs.
        let event = EntityEvent {
            version: 3,
            table_name: "occurrences".into(),
            sync_id: "legacy".into(),
            operation: "upsert".into(),
            record: None,
        };
        assert!(!apply_entity_event(&connection, &event, "1:0:test").unwrap());
    }
}

#[cfg(test)]
mod tag_sync_tests {
    use super::*;
    use crate::commands::tags;

    fn db() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::init_db(&dir.path().join("tags.db")).unwrap();
        (dir, conn)
    }
    fn file(conn: &rusqlite::Connection, hash: &str) -> i64 {
        conn.execute("INSERT INTO files(name,type,content,content_hash,imported_at,language) VALUES('test','txt','text',?1,1,'en')",[hash]).unwrap();
        conn.last_insert_rowid()
    }
    fn event(conn: &rusqlite::Connection, table: &str, id: i64, operation: &str) -> EntityEvent {
        EntityEvent {
            version: 1,
            table_name: table.into(),
            sync_id: sync_id_for(conn, table, id).unwrap(),
            operation: operation.into(),
            record: if operation == "delete" {
                None
            } else {
                row_record(conn, table, id).unwrap()
            },
        }
    }
    fn library(conn: &rusqlite::Connection, id: i64) -> EntityEvent {
        EntityEvent {
            version: 1,
            table_name: "library_item".into(),
            sync_id: sync_id_for(conn, "files", id).unwrap(),
            operation: "upsert".into(),
            record: Some(serde_json::to_value(library_item_record(conn, id).unwrap()).unwrap()),
        }
    }
    fn apply(conn: &rusqlite::Connection, event: &EntityEvent, time: u32) {
        assert!(apply_entity_event(conn, event, &format!("{time:020}:00000000:test")).unwrap());
    }
    fn mark_uploaded(conn: &rusqlite::Connection) {
        conn.execute("UPDATE sync_changes SET uploaded_at=1", [])
            .unwrap();
    }

    #[test]
    fn tags_and_associations_sync_portably_and_remove_readd_keeps_identity() {
        let (_dir, source) = db();
        let (_dir2, target) = db();
        let source_file = file(&source, "shared");
        file(&target, "other");
        tags::ensure_tag(&target, "Other").unwrap();
        let tag = tags::ensure_tag(&source, " Podcast ").unwrap();
        tags::replace_file_tags(&source, source_file, &[tag], &[]).unwrap();
        let association: i64 = source
            .query_row("SELECT id FROM file_tags", [], |r| r.get(0))
            .unwrap();
        let association_event = event(&source, "file_tags", association, "upsert");
        let fields = association_event
            .record
            .as_ref()
            .unwrap()
            .as_object()
            .unwrap();
        assert!(fields.contains_key("file_id_sync_id"));
        assert!(!fields.contains_key("file_id"));
        assert!(!fields.contains_key("tag_id"));
        apply(&target, &event(&source, "tags", tag, "upsert"), 1);
        apply(&target, &library(&source, source_file), 2);
        apply(&target, &association_event, 3);
        let target_file = local_id_for(
            &target,
            "files",
            &sync_id_for(&source, "files", source_file).unwrap(),
        )
        .unwrap()
        .unwrap();
        assert_ne!(target_file, source_file);
        assert_eq!(
            tags::file_tags(&target, target_file).unwrap()[0].name,
            "Podcast"
        );
        tags::replace_file_tags(&source, source_file, &[], &[]).unwrap();
        apply(
            &target,
            &event(&source, "file_tags", association, "delete"),
            4,
        );
        assert!(tags::file_tags(&target, target_file).unwrap().is_empty());
        tags::replace_file_tags(&source, source_file, &[tag], &[]).unwrap();
        let new_association: i64 = source
            .query_row("SELECT id FROM file_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            sync_id_for(&source, "file_tags", new_association).unwrap(),
            association_event.sync_id
        );
        apply(
            &target,
            &event(&source, "file_tags", new_association, "upsert"),
            5,
        );
        assert_eq!(tags::file_tags(&target, target_file).unwrap().len(), 1);
        tags::rename(&source, tag, "Audio").unwrap();
        apply(&target, &event(&source, "tags", tag, "upsert"), 6);
        assert_eq!(
            tags::file_tags(&target, target_file).unwrap()[0].name,
            "Audio"
        );
        mark_uploaded(&source);
        mark_uploaded(&target);
        let deletion = event(&source, "tags", tag, "delete");
        source
            .execute("DELETE FROM tags WHERE id=?1", [tag])
            .unwrap();
        apply(&target, &deletion, 7);
        assert!(tags::file_tags(&target, target_file).unwrap().is_empty());
        assert!(!apply_entity_event(
            &target,
            &association_event,
            "00000000000000000008:00000000:test"
        )
        .unwrap());
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM files", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn offline_same_name_tags_and_same_association_converge() {
        let (_dir, source) = db();
        let (_dir2, target) = db();
        let file_id = file(&source, "shared");
        apply(&target, &library(&source, file_id), 1);
        let local_file = local_id_for(
            &target,
            "files",
            &sync_id_for(&source, "files", file_id).unwrap(),
        )
        .unwrap()
        .unwrap();
        let remote_tag = tags::ensure_tag(&source, "podcast").unwrap();
        let local_tag = tags::ensure_tag(&target, "PODCAST").unwrap();
        tags::replace_file_tags(&source, file_id, &[remote_tag], &[]).unwrap();
        tags::replace_file_tags(&target, local_file, &[local_tag], &[]).unwrap();
        apply(&target, &event(&source, "tags", remote_tag, "upsert"), 2);
        let relation = source
            .query_row("SELECT id FROM file_tags", [], |r| r.get(0))
            .unwrap();
        apply(&target, &event(&source, "file_tags", relation, "upsert"), 3);
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            target
                .query_row("SELECT COUNT(*) FROM file_tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            local_id_for(
                &target,
                "tags",
                &sync_id_for(&source, "tags", remote_tag).unwrap()
            )
            .unwrap(),
            Some(local_tag)
        );
        mark_uploaded(&target);
        apply(&target, &event(&source, "tags", remote_tag, "delete"), 4);
        assert!(tags::file_tags(&target, local_file).unwrap().is_empty());
        let canonical = sync_id_for(&target, "tags", local_tag).unwrap();
        assert_eq!(target.query_row("SELECT COUNT(*) FROM sync_changes WHERE table_name='tags' AND sync_id=?1 AND operation='delete' AND uploaded_at IS NULL",[canonical],|r|r.get::<_,i64>(0)).unwrap(),1);
    }

    #[test]
    fn unknown_tag_tombstones_are_remembered_and_newer_recreation_is_allowed() {
        let (_dir, conn) = db();
        for id in ["gone-one", "gone-two"] {
            let event = EntityEvent {
                version: 1,
                table_name: "tags".into(),
                sync_id: id.into(),
                operation: "delete".into(),
                record: None,
            };
            apply(&conn, &event, 5);
        }
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM sync_entity_state WHERE table_name='tags' AND deleted_at IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        let event = EntityEvent {
            version: 1,
            table_name: "tags".into(),
            sync_id: "gone-one".into(),
            operation: "upsert".into(),
            record: Some(serde_json::json!({"name":"Restored","created_at":1})),
        };
        assert!(!apply_entity_event(&conn, &event, "00000000000000000004:00000000:test").unwrap());
        apply(&conn, &event, 6);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn enrollment_preserves_portable_association_identity_on_readd() {
        let (_dir, conn) = db();
        let file_id = file(&conn, "shared");
        let tag = tags::ensure_tag(&conn, "Study").unwrap();
        tags::replace_file_tags(&conn, file_id, &[tag], &[]).unwrap();
        stabilize_sync_ids(&conn, &[3; 32]).unwrap();
        let id: i64 = conn
            .query_row("SELECT id FROM file_tags", [], |r| r.get(0))
            .unwrap();
        let identity = sync_id_for(&conn, "file_tags", id).unwrap();
        assert!(identity.len() <= 128);
        tags::replace_file_tags(&conn, file_id, &[], &[]).unwrap();
        tags::replace_file_tags(&conn, file_id, &[tag], &[]).unwrap();
        let next: i64 = conn
            .query_row("SELECT id FROM file_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sync_id_for(&conn, "file_tags", next).unwrap(), identity);
    }

    #[test]
    fn concurrent_rename_collision_preserves_and_tracks_all_associations() {
        let (_dir, source) = db();
        let (_dir2, target) = db();
        let source_file = file(&source, "remote");
        apply(&target, &library(&source, source_file), 1);
        let original = tags::ensure_tag(&source, "Original").unwrap();
        apply(&target, &event(&source, "tags", original, "upsert"), 2);
        let original_local = local_id_for(
            &target,
            "tags",
            &sync_id_for(&source, "tags", original).unwrap(),
        )
        .unwrap()
        .unwrap();
        let first = file(&target, "one");
        let second = file(&target, "two");
        tags::replace_file_tags(&target, first, &[original_local], &[]).unwrap();
        let existing = tags::ensure_tag(&target, "Same").unwrap();
        tags::replace_file_tags(&target, second, &[existing], &[]).unwrap();
        tags::rename(&source, original, "Same").unwrap();
        apply(&target, &event(&source, "tags", original, "upsert"), 3);
        assert_eq!(tags::file_tags(&target, first).unwrap()[0].id, existing);
        assert_eq!(tags::file_tags(&target, second).unwrap()[0].id, existing);
        assert_eq!(target.query_row("SELECT COUNT(*) FROM file_tags ft JOIN sync_entity_state s ON s.table_name='file_tags' AND s.local_id=ft.id AND s.deleted_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(
            local_id_for(
                &target,
                "tags",
                &sync_id_for(&source, "tags", original).unwrap()
            )
            .unwrap(),
            Some(existing)
        );
    }

    #[test]
    fn legacy_cloud_paths_convert_but_do_not_overwrite_later_tag_edits() {
        let (_dir, source) = db();
        let (_dir2, target) = db();
        source.execute_batch("INSERT INTO folders(id,name,parent_id,created_at) VALUES(1,'Language',NULL,1),(2,'Podcast',1,2);").unwrap();
        // Legacy folder identities are retained for reading old encrypted records.
        for id in [1, 2] {
            mark_state(&source, "folders", id, &format!("folder-{id}"), "1", false).unwrap();
        }
        let source_file = file(&source, "legacy");
        source
            .execute("UPDATE files SET folder_id=2 WHERE id=?1", [source_file])
            .unwrap();
        apply(&target, &event(&source, "folders", 1, "upsert"), 1);
        apply(&target, &event(&source, "folders", 2, "upsert"), 2);
        let mut snapshot = library(&source, source_file);
        let legacy_file = snapshot
            .record
            .as_mut()
            .unwrap()
            .get_mut("file")
            .unwrap()
            .as_object_mut()
            .unwrap();
        legacy_file.remove("tag_model");
        legacy_file.insert("folder_id_sync_id".into(), serde_json::json!("folder-2"));
        apply(&target, &snapshot, 3);
        tags::migrate_legacy(&target).unwrap();
        let local_file = local_id_for(&target, "files", &snapshot.sync_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            tags::file_tags(&target, local_file).unwrap()[0].name,
            "Language / Podcast"
        );
        tags::replace_file_tags(&target, local_file, &[], &[]).unwrap();
        mark_uploaded(&target);
        apply(&target, &snapshot, 4);
        tags::migrate_legacy(&target).unwrap();
        assert!(tags::file_tags(&target, local_file).unwrap().is_empty());
        assert_eq!(entity_order("tags"), 0);
        assert!(entity_order("file_tags") > entity_order("library_item"));
    }
}

#[cfg(test)]
mod source_media_sync_tests {
    use super::*;
    use crate::commands::{import::SegmentInput, materials, source_media, youtube};
    fn input(video: &str) -> materials::MaterialInput {
        let content = "1\n00:00:01,000 --> 00:00:02,000\nHello world.\n";
        let track = youtube::SubtitleTrack {
            lang: "en".into(),
            language: "en".into(),
            is_auto: false,
            source: youtube::downloads::SubtitleSource::Manual,
            source_language: Some("en".into()),
        };
        let source=source_media::source_from_subtitles(video,&track,content,&serde_json::json!({"title":"fixture","duration":3,"formats":[{"format_id":"140","ext":"m4a","acodec":"mp4a.40.2","vcodec":"none","language":"en"}]})).unwrap();
        materials::MaterialInput {
            document: None,
            normalized_kind: None,
            operation_id: video.into(),
            name: "same.srt".into(),
            content: content.into(),
            segments: vec![SegmentInput {
                index: 0,
                en_text: "Hello world.".into(),
                zh_text: None,
                start_time: Some("00:00:01.000".into()),
                end_time: Some("00:00:02.000".into()),
            }],
            source: Some(source),
        }
    }
    #[test]
    fn simulated_two_device_library_merge_keeps_distinct_media_and_uses_capability_gate() {
        let d = tempfile::tempdir().unwrap();
        let a = crate::db::init_db(&d.path().join("a.db")).unwrap();
        let b = crate::db::init_db(&d.path().join("b.db")).unwrap();
        for video in ["abcdefghijk", "lmnopqrstuv"] {
            let import = materials::import_material(&a, &input(video)).unwrap();
            let record = library_item_record(&a, import.file_id).unwrap();
            let event = EntityEvent {
                version: 4,
                table_name: "library_item".into(),
                sync_id: video.into(),
                operation: "upsert".into(),
                record: Some(serde_json::to_value(record).unwrap()),
            };
            let encoded = encode_event(&event).unwrap();
            let decoded = decode_event(&encoded).unwrap();
            assert_eq!(decoded.version, 5); // existing v3/v4-only clients stop before applying unknown fields
            assert!(
                apply_library_item_event(&b, video, "upsert", decoded.record.as_ref(), "1")
                    .unwrap()
            );
        }
        let rows = materials::list(&b, &[], false).unwrap();
        assert_eq!(rows.len(), 2);
        assert_ne!(
            rows[0].source.as_ref().unwrap().key,
            rows[1].source.as_ref().unwrap().key
        );
        assert_eq!(
            stable_identity_updates(&b, &[7; 32])
                .unwrap()
                .iter()
                .filter(|r| r.table == "files")
                .count(),
            2
        );
        for row in rows {
            let opened = materials::open(&b, row.id).unwrap();
            assert_eq!(opened.media_refs.len(), 1);
            let r = opened.media_refs.values().next().unwrap();
            assert_eq!(
                source_media::status(&b, d.path(), r).unwrap().status,
                "missing"
            );
        }
    }
}

#[cfg(test)]
mod document_source_sync_tests {
    use super::*;
    use crate::commands::{document_source_tests, materials, saved};
    #[test]
    fn clipboard_and_web_origins_use_version_seven_and_keep_saved_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let a = crate::db::init_db(&dir.path().join("a.db")).unwrap();
        let b = crate::db::init_db(&dir.path().join("b.db")).unwrap();
        for format in ["clipboard", "webpage"] {
            let mut input = document_source_tests::input(format, format);
            let doc = input.document.as_mut().unwrap();
            doc.schema_version = 2;
            doc.origin = Some(if format == "clipboard" {
                crate::commands::document_source::ContentOrigin::Clipboard {
                    title: doc.display_name.clone(),
                }
            } else {
                crate::commands::document_source::ContentOrigin::Webpage {
                    title: doc.display_name.clone(),
                    submitted_url: "https://example.com/one".into(),
                    final_url: "https://example.com/one".into(),
                    fetched_at: 1793350000000,
                }
            });
            let id = materials::import_material(&a, &input).unwrap().file_id;
            let event = EntityEvent {
                version: 3,
                table_name: "library_item".into(),
                sync_id: format.into(),
                operation: "upsert".into(),
                record: Some(serde_json::to_value(library_item_record(&a, id).unwrap()).unwrap()),
            };
            let decoded = decode_event(&encode_event(&event).unwrap()).unwrap();
            assert_eq!(decoded.version, 7);
            assert!(![3, 4, 5, 6].contains(&decoded.version));
            assert!(apply_entity_event(&b, &decoded, "00000000000000000001:00000000:a").unwrap());
            let remote = local_id_for(&b, "files", format).unwrap().unwrap();
            assert_eq!(
                materials::open(&b, remote).unwrap().material.document,
                input.document
            );
            let segment = materials::open(&a, id).unwrap().segments[0].id;
            let record = saved::mutate(
                &a,
                format,
                &saved::Mutation::Save {
                    input: saved::SaveInput {
                        segment_id: segment,
                        expression: "world".into(),
                        start_offset: 9,
                        end_offset: 14,
                        explanation: None,
                        explanation_source: "unknown".into(),
                        dictionary_snapshot: None,
                        dictionary_reference: None,
                    },
                },
            )
            .unwrap()
            .record;
            let event = EntityEvent {
                version: 3,
                table_name: "saved_records".into(),
                sync_id: record.record_id.clone(),
                operation: "upsert".into(),
                record: Some(serde_json::to_value(&record).unwrap()),
            };
            let decoded = decode_event(&encode_event(&event).unwrap()).unwrap();
            assert_eq!(decoded.version, 7);
            assert!(apply_entity_event(&b, &decoded, "00000000000000000002:00000000:a").unwrap());
            assert_eq!(saved::get(&b, &record.record_id).unwrap().unwrap(), record);
        }
    }
    #[test]
    fn simulated_documents_and_saved_locations_roundtrip_with_version_six_gate() {
        let dir = tempfile::tempdir().unwrap();
        let a = crate::db::init_db(&dir.path().join("a.db")).unwrap();
        let b = crate::db::init_db(&dir.path().join("b.db")).unwrap();
        let mut ids = Vec::new();
        for (i, format) in ["pdf", "txt", "epub"].iter().enumerate() {
            let input = document_source_tests::input(format, format);
            let id = materials::import_material(&a, &input).unwrap().file_id;
            let file_sync_id = format!("fixture-{i}");
            let event = EntityEvent {
                version: 3,
                table_name: "library_item".into(),
                sync_id: file_sync_id.clone(),
                operation: "upsert".into(),
                record: Some(serde_json::to_value(library_item_record(&a, id).unwrap()).unwrap()),
            };
            let decoded = decode_event(&encode_event(&event).unwrap()).unwrap();
            assert_eq!(decoded.version, 6);
            // Existing clients recognize at most 3/4/5 and stop before apply.
            assert!(![3, 4, 5].contains(&decoded.version));
            assert!(apply_entity_event(&b, &decoded, "00000000000000000001:00000000:a").unwrap());
            let remote = local_id_for(&b, "files", &file_sync_id).unwrap().unwrap();
            ids.push(remote);
            let opened = materials::open(&b, remote).unwrap();
            assert_eq!(opened.material.document.as_ref(), input.document.as_ref());
            assert!(opened.media_refs.is_empty());
            let segment = materials::open(&a, id).unwrap().segments[0].id;
            let saved = saved::mutate(
                &a,
                &format!("save-{i}"),
                &saved::Mutation::Save {
                    input: saved::SaveInput {
                        segment_id: segment,
                        expression: "world".into(),
                        start_offset: 9,
                        end_offset: 14,
                        explanation: Some("context meaning".into()),
                        explanation_source: "personal".into(),
                        dictionary_snapshot: None,
                        dictionary_reference: None,
                    },
                },
            )
            .unwrap()
            .record;
            let event = EntityEvent {
                version: 3,
                table_name: "saved_records".into(),
                sync_id: saved.record_id.clone(),
                operation: "upsert".into(),
                record: Some(serde_json::to_value(&saved).unwrap()),
            };
            let decoded = decode_event(&encode_event(&event).unwrap()).unwrap();
            assert_eq!(decoded.version, 6);
            assert!(apply_entity_event(&b, &decoded, "00000000000000000002:00000000:a").unwrap());
            assert_eq!(saved::get(&b, &saved.record_id).unwrap().unwrap(), saved);
            assert_eq!(
                saved::resolve_source(&b, &saved.record_id)
                    .unwrap()
                    .unwrap()
                    .file_id,
                remote
            );
        }
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 3);
        assert_eq!(
            stable_identity_updates(&b, &[7; 32])
                .unwrap()
                .iter()
                .filter(|r| r.table == "files")
                .count(),
            3
        );
    }
    #[test]
    fn old_or_changed_remote_document_cannot_silently_strip_provenance_or_rewrite_body() {
        let dir = tempfile::tempdir().unwrap();
        let a = crate::db::init_db(&dir.path().join("a.db")).unwrap();
        let b = crate::db::init_db(&dir.path().join("b.db")).unwrap();
        let input = document_source_tests::input("pdf", "pdf");
        let id = materials::import_material(&a, &input).unwrap().file_id;
        let mut event = EntityEvent {
            version: 6,
            table_name: "library_item".into(),
            sync_id: "pdf-source".into(),
            operation: "upsert".into(),
            record: Some(serde_json::to_value(library_item_record(&a, id).unwrap()).unwrap()),
        };
        assert!(apply_entity_event(&b, &event, "1").unwrap());
        let local = local_id_for(&b, "files", "pdf-source").unwrap().unwrap();
        let file = event.record.as_mut().unwrap()["file"]
            .as_object_mut()
            .unwrap();
        file.remove("document_source");
        file.remove("document_identity");
        assert_eq!(
            apply_entity_event(&b, &event, "2").err().unwrap(),
            "material_document_version_conflict"
        );
        assert!(materials::open(&b, local)
            .unwrap()
            .material
            .document
            .is_some());
        let mut changed = document_source_tests::input("changed", "pdf");
        changed.content = changed.content.replace("42", "43");
        changed.segments[0].en_text = changed.content.clone();
        let doc = changed.document.as_mut().unwrap();
        doc.blocks[0].text = changed.content.clone();
        doc.normalized_sha256 = format!("{:x}", sha2::Sha256::digest(changed.content.as_bytes()));
        doc.extractor_version = "later-extractor".into();
        let c = crate::db::init_db(&dir.path().join("c.db")).unwrap();
        let newer = materials::import_material(&c, &changed).unwrap().file_id;
        event.record = Some(serde_json::to_value(library_item_record(&c, newer).unwrap()).unwrap());
        assert_eq!(
            apply_entity_event(&b, &event, "3").err().unwrap(),
            "material_document_version_conflict"
        );
        assert_eq!(
            materials::open(&b, local).unwrap().segments[0].en_text,
            input.content
        );
    }
}
