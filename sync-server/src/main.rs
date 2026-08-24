use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::{get, post, put},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, env, net::SocketAddr};
use tokio_postgres::{Client, NoTls};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const MAX_CHUNK_BYTES: usize = 512 * 1024;
const MAX_EVENT_BYTES: usize = 768 * 1024;

#[derive(Clone)]
struct AppState {
    database_url: String,
}
#[derive(Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
    device_id: String,
    device_name: String,
    key_package: String,
    recovery_verifier: Option<String>,
}
#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
    device_id: String,
    device_name: String,
}
#[derive(Deserialize)]
struct RecoveryPackageRequest {
    email: String,
    recovery_verifier: String,
}
#[derive(Deserialize)]
struct PasswordResetRequest {
    email: String,
    recovery_verifier: String,
    password: String,
    key_package: String,
    device_id: String,
    device_name: String,
}
#[derive(Serialize)]
struct AuthResponse {
    access_token: String,
    key_package: String,
    device_id: String,
}
#[derive(Deserialize)]
struct EventInput {
    event_id: String,
    device_id: String,
    clock: String,
    kind: String,
    ciphertext: String,
}
#[derive(Serialize)]
struct EventOutput {
    seq: i64,
    event_id: String,
    device_id: String,
    clock: String,
    kind: String,
    ciphertext: String,
}
#[derive(Deserialize)]
struct PullQuery {
    after: Option<i64>,
    limit: Option<i64>,
}
#[derive(Deserialize)]
struct SnapshotInput {
    ciphertext: String,
    cursor: i64,
}
#[derive(Serialize)]
struct SnapshotOutput {
    ciphertext: String,
    cursor: i64,
}
#[derive(Serialize)]
struct DeviceOutput {
    id: String,
    name: String,
    last_seen_at: String,
}

#[derive(Deserialize)]
struct CheckpointInput {
    id: String,
    cursor: i64,
    encrypted_len: i64,
    /// The encrypted manifest is small (it only describes the chunks) and is
    /// encoded for JSON transport. Checkpoint bytes themselves stay binary.
    manifest: String,
    chunk_hashes: Vec<String>,
}
#[derive(Serialize)]
struct CheckpointOutput {
    id: String,
    device_id: String,
    device_name: String,
    cursor: i64,
    encrypted_len: i64,
    created_at: String,
}
#[derive(Serialize)]
struct CheckpointDetail {
    #[serde(flatten)]
    checkpoint: CheckpointOutput,
    manifest: String,
    chunk_hashes: Vec<String>,
}

const CHECKPOINT_RETENTION: i64 = 5;

/// Metadata travels in headers while encrypted bytes remain a binary body.
/// This keeps the v2 transport free of base64 expansion.
struct V2EventHeaders {
    event_id: String,
    device_id: String,
    clock: String,
    kind: String,
}

fn v2_event_headers(headers: &HeaderMap) -> Result<V2EventHeaders, (StatusCode, String)> {
    let value = |name: &'static str| -> Result<String, (StatusCode, String)> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .filter(|v| !v.is_empty() && v.len() <= 256)
            .map(ToOwned::to_owned)
            .ok_or_else(|| bad("missing or invalid v2 event header"))
    };
    Ok(V2EventHeaders {
        event_id: value("x-sync-event-id")?,
        device_id: value("x-sync-device-id")?,
        clock: value("x-sync-clock")?,
        kind: value("x-sync-kind")?,
    })
}

async fn put_chunk_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    if hash.len() != 64
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        || body.len() > MAX_CHUNK_BYTES
    {
        return Err(bad("invalid or oversized encrypted chunk"));
    }
    let calculated = format!("{:x}", Sha256::digest(&body));
    if calculated != hash {
        return Err(bad("encrypted chunk hash mismatch"));
    }
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    client.execute("INSERT INTO sync_chunks(account_id,hash,ciphertext) VALUES ($1,$2,$3) ON CONFLICT(account_id,hash) DO NOTHING", &[&account_id, &hash, &body.as_ref()]).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_chunk_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> Result<Response, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let bytes: Vec<u8> = client
        .query_opt(
            "SELECT ciphertext FROM sync_chunks WHERE account_id=$1 AND hash=$2",
            &[&account_id, &hash],
        )
        .await
        .map_err(internal)?
        .map(|row| row.get(0))
        .ok_or((StatusCode::NOT_FOUND, "encrypted chunk not found".into()))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(bytes))
        .map_err(internal)
}

async fn head_chunk_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    if client
        .query_opt(
            "SELECT 1 FROM sync_chunks WHERE account_id=$1 AND hash=$2",
            &[&account_id, &hash],
        )
        .await
        .map_err(internal)?
        .is_some()
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, "encrypted chunk not found".into()))
    }
}

async fn push_event_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    if body.is_empty() || body.len() > MAX_EVENT_BYTES {
        return Err(bad("invalid or oversized encrypted event"));
    }
    let event = v2_event_headers(&headers)?;
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    client.execute("INSERT INTO sync_events_v2(account_id,event_id,device_id,clock,kind,ciphertext) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,event_id) DO NOTHING", &[&account_id,&event.event_id,&event.device_id,&event.clock,&event.kind,&body.as_ref()]).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pull_events_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Response, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let limit = query.limit.unwrap_or(100).clamp(1, 100);
    let after = query.after.unwrap_or(0);
    let rows = client.query("SELECT seq,event_id,device_id,clock,kind,ciphertext FROM sync_events_v2 WHERE account_id=$1 AND seq>$2 ORDER BY seq LIMIT $3", &[&account_id,&after,&limit]).await.map_err(internal)?;
    // Binary framing: u32 metadata-json length, metadata JSON, u32 ciphertext length, ciphertext.
    let mut out = Vec::new();
    for row in rows {
        let metadata = serde_json::json!({"seq": row.get::<_, i64>(0), "event_id": row.get::<_, String>(1), "device_id": row.get::<_, String>(2), "clock": row.get::<_, String>(3), "kind": row.get::<_, String>(4)});
        let metadata = serde_json::to_vec(&metadata).map_err(internal)?;
        let ciphertext: Vec<u8> = row.get(5);
        out.extend_from_slice(&(metadata.len() as u32).to_be_bytes());
        out.extend_from_slice(&metadata);
        out.extend_from_slice(&(ciphertext.len() as u32).to_be_bytes());
        out.extend_from_slice(&ciphertext);
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/vnd.lexicue.sync-events+binary;v=2",
        )
        .body(axum::body::Body::from(out))
        .map_err(internal)
}

fn checkpoint_id(value: &str) -> Result<(), (StatusCode, String)> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| bad("invalid checkpoint id"))
}

fn chunk_hashes_are_valid(hashes: &[String]) -> bool {
    !hashes.is_empty()
        && hashes.len() <= 20_000
        && hashes
            .iter()
            .all(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        && hashes.iter().collect::<HashSet<_>>().len() == hashes.len()
}

async fn put_checkpoint_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CheckpointInput>,
) -> Result<StatusCode, (StatusCode, String)> {
    checkpoint_id(&body.id)?;
    if body.encrypted_len <= 0
        || body.encrypted_len > 20_i64 * 1024 * 1024 * 1024
        || !chunk_hashes_are_valid(&body.chunk_hashes)
    {
        return Err(bad("invalid checkpoint metadata"));
    }
    let manifest = URL_SAFE_NO_PAD
        .decode(&body.manifest)
        .map_err(|_| bad("invalid encrypted checkpoint manifest"))?;
    if manifest.is_empty() || manifest.len() > MAX_EVENT_BYTES {
        return Err(bad("invalid encrypted checkpoint manifest"));
    }
    let account_id = account(&headers, &state).await?;
    let device_id = headers
        .get("x-sync-device-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| bad("missing device id"))?;
    let mut client = db(&state).await?;
    let transaction = client.transaction().await.map_err(internal)?;

    if transaction
        .query_opt(
            "SELECT 1 FROM devices WHERE id=$1 AND account_id=$2",
            &[&device_id, &account_id],
        )
        .await
        .map_err(internal)?
        .is_none()
    {
        return Err((
            StatusCode::UNAUTHORIZED,
            "device is not authorized for this account".into(),
        ));
    }

    // Do not accept references to another account's chunks, or manifests with
    // fabricated length. The latter keeps the directory useful for UI only.
    let rows = transaction
        .query(
            "SELECT hash, octet_length(ciphertext) FROM sync_chunks WHERE account_id=$1 AND hash = ANY($2)",
            &[&account_id, &body.chunk_hashes],
        )
        .await
        .map_err(internal)?;
    if rows.len() != body.chunk_hashes.len() {
        return Err(bad("checkpoint references missing encrypted chunks"));
    }
    let actual_len: i64 = rows.iter().map(|row| row.get::<_, i32>(1) as i64).sum();
    if actual_len != body.encrypted_len {
        return Err(bad("checkpoint encrypted length mismatch"));
    }
    transaction
        .execute(
            "INSERT INTO sync_checkpoints(id,account_id,device_id,cursor,encrypted_len,manifest) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
            &[&body.id, &account_id, &device_id, &body.cursor, &body.encrypted_len, &manifest],
        )
        .await
        .map_err(internal)?;
    for (position, hash) in body.chunk_hashes.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO sync_checkpoint_chunks(checkpoint_id,account_id,hash,position) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                &[&body.id, &account_id, hash, &(position as i32)],
            )
            .await
            .map_err(internal)?;
    }

    let old = transaction
        .query(
            "SELECT id FROM sync_checkpoints WHERE account_id=$1 ORDER BY created_at DESC, id DESC OFFSET $2",
            &[&account_id, &CHECKPOINT_RETENTION],
        )
        .await
        .map_err(internal)?;
    for row in old {
        let id: String = row.get(0);
        transaction
            .execute("DELETE FROM sync_checkpoints WHERE id=$1", &[&id])
            .await
            .map_err(internal)?;
    }
    // A chunk may be shared by retained checkpoints, so collect only blocks
    // that no checkpoint references after retention has run.
    transaction
        .execute(
            "DELETE FROM sync_chunks c WHERE c.account_id=$1 AND c.created_at < NOW() - INTERVAL '1 hour' AND NOT EXISTS (SELECT 1 FROM sync_checkpoint_chunks r WHERE r.account_id=c.account_id AND r.hash=c.hash)",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    transaction.commit().await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_checkpoints_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<CheckpointOutput>>, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let rows = client
        .query(
            "SELECT c.id,c.device_id,COALESCE(d.name,'Unknown device'),c.cursor,c.encrypted_len,c.created_at::TEXT FROM sync_checkpoints c LEFT JOIN devices d ON d.id=c.device_id AND d.account_id=c.account_id WHERE c.account_id=$1 ORDER BY c.created_at DESC,c.id DESC",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|row| CheckpointOutput {
                id: row.get(0),
                device_id: row.get(1),
                device_name: row.get(2),
                cursor: row.get(3),
                encrypted_len: row.get(4),
                created_at: row.get(5),
            })
            .collect(),
    ))
}

async fn get_checkpoint_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<CheckpointDetail>, (StatusCode, String)> {
    checkpoint_id(&id)?;
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let row = client.query_opt(
        "SELECT c.id,c.device_id,COALESCE(d.name,'Unknown device'),c.cursor,c.encrypted_len,c.created_at::TEXT,c.manifest FROM sync_checkpoints c LEFT JOIN devices d ON d.id=c.device_id AND d.account_id=c.account_id WHERE c.account_id=$1 AND c.id=$2",
        &[&account_id, &id],
    ).await.map_err(internal)?.ok_or((StatusCode::NOT_FOUND, "checkpoint not found".into()))?;
    let chunk_rows = client.query(
        "SELECT hash FROM sync_checkpoint_chunks WHERE account_id=$1 AND checkpoint_id=$2 ORDER BY position ASC",
        &[&account_id, &id],
    ).await.map_err(internal)?;
    Ok(Json(CheckpointDetail {
        checkpoint: CheckpointOutput {
            id: row.get(0),
            device_id: row.get(1),
            device_name: row.get(2),
            cursor: row.get(3),
            encrypted_len: row.get(4),
            created_at: row.get(5),
        },
        manifest: URL_SAFE_NO_PAD.encode(row.get::<_, Vec<u8>>(6)),
        chunk_hashes: chunk_rows.into_iter().map(|item| item.get(0)).collect(),
    }))
}

async fn list_devices_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<DeviceOutput>>, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let rows = client.query("SELECT id,name,last_seen_at::TEXT FROM devices WHERE account_id=$1 ORDER BY last_seen_at DESC", &[&account_id]).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| DeviceOutput {
                id: r.get(0),
                name: r.get(1),
                last_seen_at: r.get(2),
            })
            .collect(),
    ))
}

async fn revoke_device_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let changed = client
        .execute(
            "DELETE FROM devices WHERE id=$1 AND account_id=$2",
            &[&device_id, &account_id],
        )
        .await
        .map_err(internal)?;
    if changed == 0 {
        return Err((StatusCode::NOT_FOUND, "device not found".into()));
    }
    client
        .execute(
            "UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND device_id=$2",
            &[&account_id, &device_id],
        )
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_account_v2(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    // All sync tables have account foreign keys with cascade deletion. This is
    // intentionally irreversible; callers must present a live access token.
    client
        .execute("DELETE FROM users WHERE id=$1", &[&account_id])
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn db(state: &AppState) -> Result<Client, (StatusCode, String)> {
    let (client, connection) = tokio_postgres::connect(&state.database_url, NoTls)
        .await
        .map_err(internal)?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    Ok(client)
}
fn internal<E: std::fmt::Display>(error: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
fn bad(message: &str) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, message.to_string())
}

async fn account(headers: &HeaderMap, state: &AppState) -> Result<String, (StatusCode, String)> {
    let value = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "missing access token".into()))?;
    let token = value
        .strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "invalid access token".into()))?;
    let client = db(state).await?;
    client.query_opt("SELECT account_id FROM sessions WHERE token = $1 AND revoked_at IS NULL AND expires_at > NOW()", &[&token]).await
        .map_err(internal)?.map(|row| row.get(0)).ok_or((StatusCode::UNAUTHORIZED, "expired access token".into()))
}
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
async fn upsert_device(
    client: &Client,
    account_id: &str,
    device_id: &str,
    name: &str,
) -> Result<String, (StatusCode, String)> {
    if let Some(row) = client
        .query_opt(
            "SELECT id FROM devices WHERE account_id=$1 AND install_id=$2",
            &[&account_id, &device_id],
        )
        .await
        .map_err(internal)?
    {
        let id: String = row.get(0);
        client
            .execute(
                "UPDATE devices SET name=$1,last_seen_at=NOW() WHERE id=$2 AND account_id=$3",
                &[&name, &id, &account_id],
            )
            .await
            .map_err(internal)?;
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    client
        .execute(
            "INSERT INTO devices(id,account_id,install_id,name,last_seen_at) VALUES ($1,$2,$3,$4,NOW())",
            &[&id, &account_id, &device_id, &name],
        )
        .await
        .map_err(internal)?;
    Ok(id)
}
async fn issue_session(
    client: &Client,
    account_id: &str,
    device_id: &str,
) -> Result<String, (StatusCode, String)> {
    let token = new_token();
    client.execute("INSERT INTO sessions (token, account_id, device_id, expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '30 days')", &[&token, &account_id, &device_id]).await.map_err(internal)?;
    Ok(token)
}
async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let valid_recovery_verifier = body
        .recovery_verifier
        .as_deref()
        .map(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .unwrap_or(true);
    if !body.email.contains('@')
        || body.password.len() < 10
        || body.key_package.len() > 32_768
        || !valid_recovery_verifier
    {
        return Err(bad("invalid registration payload"));
    }
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
    let recovery_verifier_hash = if let Some(verifier) = body.recovery_verifier.as_deref() {
        let recovery_salt = SaltString::generate(&mut OsRng);
        Some(
            Argon2::default()
                .hash_password(verifier.as_bytes(), &recovery_salt)
                .map_err(internal)?
                .to_string(),
        )
    } else {
        None
    };
    let account_id = Uuid::new_v4().to_string();
    let client = db(&state).await?;
    client
        .execute(
            "INSERT INTO users (id,email,password_hash,key_package,recovery_verifier_hash) VALUES ($1,$2,$3,$4,$5)",
            &[
                &account_id,
                &body.email.to_lowercase(),
                &password_hash,
                &body.key_package,
                &recovery_verifier_hash,
            ],
        )
        .await
        .map_err(|e| {
            if e.code().map(|c| c.code()) == Some("23505") {
                (StatusCode::CONFLICT, "email already registered".into())
            } else {
                internal(e)
            }
        })?;
    let device_id = upsert_device(&client, &account_id, &body.device_id, &body.device_name).await?;
    Ok(Json(AuthResponse {
        access_token: issue_session(&client, &account_id, &device_id).await?,
        key_package: body.key_package,
        device_id,
    }))
}

async fn verify_recovery(
    client: &Client,
    email: &str,
    recovery_verifier: &str,
) -> Result<(String, String), (StatusCode, String)> {
    if recovery_verifier.len() != 64
        || !recovery_verifier
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err((StatusCode::UNAUTHORIZED, "invalid recovery code".into()));
    }
    let row = client
        .query_opt(
            "SELECT id,key_package,recovery_verifier_hash FROM users WHERE email=$1",
            &[&email.to_lowercase()],
        )
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid recovery code".into()))?;
    let stored: Option<String> = row.get(2);
    let stored = stored.ok_or((
        StatusCode::UNAUTHORIZED,
        "recovery is unavailable for this legacy account".into(),
    ))?;
    let parsed = PasswordHash::new(&stored).map_err(internal)?;
    Argon2::default()
        .verify_password(recovery_verifier.as_bytes(), &parsed)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid recovery code".into()))?;
    Ok((row.get(0), row.get(1)))
}

async fn recovery_package(
    State(state): State<AppState>,
    Json(body): Json<RecoveryPackageRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let client = db(&state).await?;
    let (account_id, key_package) =
        verify_recovery(&client, &body.email, &body.recovery_verifier).await?;
    // No session is issued here: possession of the verifier may retrieve an
    // opaque key package, but cannot access encrypted sync data.
    Ok(Json(AuthResponse {
        access_token: String::new(),
        key_package,
        device_id: account_id,
    }))
}

async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<PasswordResetRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    if body.password.len() < 10 || body.key_package.len() > 32_768 {
        return Err(bad("invalid password reset payload"));
    }
    let client = db(&state).await?;
    let (account_id, _) = verify_recovery(&client, &body.email, &body.recovery_verifier).await?;
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
    client
        .execute(
            "UPDATE users SET password_hash=$1,key_package=$2 WHERE id=$3",
            &[&password_hash, &body.key_package, &account_id],
        )
        .await
        .map_err(internal)?;
    client
        .execute(
            "UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    let device_id = upsert_device(&client, &account_id, &body.device_id, &body.device_name).await?;
    Ok(Json(AuthResponse {
        access_token: issue_session(&client, &account_id, &device_id).await?,
        key_package: body.key_package,
        device_id,
    }))
}
async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let client = db(&state).await?;
    let row = client
        .query_opt(
            "SELECT id,password_hash,key_package FROM users WHERE email=$1",
            &[&body.email.to_lowercase()],
        )
        .await
        .map_err(internal)?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid email or password".into()))?;
    let hash: String = row.get(1);
    let parsed = PasswordHash::new(&hash).map_err(internal)?;
    Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid email or password".into()))?;
    let account_id: String = row.get(0);
    let device_id = upsert_device(&client, &account_id, &body.device_id, &body.device_name).await?;
    Ok(Json(AuthResponse {
        access_token: issue_session(&client, &account_id, &device_id).await?,
        key_package: row.get(2),
        device_id,
    }))
}
async fn push_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(events): Json<Vec<EventInput>>,
) -> Result<Json<Vec<String>>, (StatusCode, String)> {
    if events.len() > 100 {
        return Err(bad("maximum 100 events per request"));
    }
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let mut accepted = Vec::new();
    for event in events {
        if event.ciphertext.len() > 1_500_000 {
            return Err(bad("event too large"));
        }
        let count = client.execute("INSERT INTO sync_events (account_id,event_id,device_id,clock,kind,ciphertext) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (account_id,event_id) DO NOTHING", &[&account_id,&event.event_id,&event.device_id,&event.clock,&event.kind,&event.ciphertext]).await.map_err(internal)?;
        if count == 1 {
            accepted.push(event.event_id);
        }
    }
    Ok(Json(accepted))
}
async fn pull_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Json<Vec<EventOutput>>, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let limit = query.limit.unwrap_or(100).clamp(1, 100);
    let after = query.after.unwrap_or(0);
    let rows = client.query("SELECT seq,event_id,device_id,clock,kind,ciphertext FROM sync_events WHERE account_id=$1 AND seq>$2 ORDER BY seq LIMIT $3", &[&account_id,&after,&limit]).await.map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| EventOutput {
                seq: r.get(0),
                event_id: r.get(1),
                device_id: r.get(2),
                clock: r.get(3),
                kind: r.get(4),
                ciphertext: r.get(5),
            })
            .collect(),
    ))
}
async fn put_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SnapshotInput>,
) -> Result<StatusCode, (StatusCode, String)> {
    if body.ciphertext.len() > 20_000_000 {
        return Err(bad("snapshot too large"));
    }
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    client.execute("INSERT INTO snapshots (account_id,ciphertext,cursor,created_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (account_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,cursor=EXCLUDED.cursor,created_at=NOW()", &[&account_id,&body.ciphertext,&body.cursor]).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn get_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<SnapshotOutput>>, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    Ok(Json(
        client
            .query_opt(
                "SELECT ciphertext,cursor FROM snapshots WHERE account_id=$1",
                &[&account_id],
            )
            .await
            .map_err(internal)?
            .map(|r| SnapshotOutput {
                ciphertext: r.get(0),
                cursor: r.get(1),
            }),
    ))
}
async fn health() -> &'static str {
    "ok"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkpoint_metadata_rejects_duplicate_or_invalid_hashes() {
        let hash = "a".repeat(64);
        assert!(chunk_hashes_are_valid(std::slice::from_ref(&hash)));
        assert!(!chunk_hashes_are_valid(&[hash.clone(), hash]));
        assert!(!chunk_hashes_are_valid(&["not-a-hash".into()]));
        assert!(checkpoint_id(&Uuid::new_v4().to_string()).is_ok());
        assert!(checkpoint_id("not-a-uuid").is_err());
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let state = AppState {
        database_url: env::var("DATABASE_URL").expect("DATABASE_URL is required"),
    };
    let client = db(&state).await.expect("database unavailable");
    client
        .batch_execute(include_str!("../schema.sql"))
        .await
        .expect("schema migration failed");
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/recovery-package", post(recovery_package))
        .route("/v1/auth/reset-password", post(reset_password))
        .route("/v1/events", post(push_events).get(pull_events))
        .route("/v1/snapshot", post(put_snapshot).get(get_snapshot))
        .route(
            "/v2/chunks/{hash}",
            put(put_chunk_v2).get(get_chunk_v2).head(head_chunk_v2),
        )
        .route("/v2/events", post(push_event_v2).get(pull_events_v2))
        .route(
            "/v2/checkpoints",
            post(put_checkpoint_v2).get(list_checkpoints_v2),
        )
        .route("/v2/checkpoints/{id}", get(get_checkpoint_v2))
        .route("/v2/devices", get(list_devices_v2))
        .route(
            "/v2/devices/{device_id}",
            axum::routing::delete(revoke_device_v2),
        )
        .route("/v2/account", axum::routing::delete(delete_account_v2))
        // Axum defaults JSON extraction to 2 MiB. The legacy endpoint remains
        // available during migration, so set an explicit, documented cap.
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()
        .expect("invalid BIND_ADDR");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind failed");
    axum::serve(listener, app).await.expect("server failed");
}
