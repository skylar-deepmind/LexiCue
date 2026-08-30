use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_postgres::{Client, GenericClient, NoTls, Row};
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const MAX_RECORD_BYTES: usize = 768 * 1024;
const MAX_BLOB_BYTES: usize = 512 * 1024;
const MAX_BATCH_RECORDS: usize = 100;
const PROTOCOL_VERSION: i16 = 1;
const DEFAULT_SYNC_READ_LIMIT: u32 = 3000;

#[derive(Clone)]
struct AppState {
    database_url: String,
    limits: Arc<Mutex<HashMap<String, RateBucket>>>,
    metrics: Arc<Metrics>,
    metrics_token: Option<String>,
}

struct RateBucket {
    started: Instant,
    count: u32,
}

#[derive(Default)]
struct Metrics {
    requests: std::sync::atomic::AtomicU64,
    rejected: std::sync::atomic::AtomicU64,
    auth_failures: std::sync::atomic::AtomicU64,
    accepted_records: std::sync::atomic::AtomicU64,
    record_conflicts: std::sync::atomic::AtomicU64,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status;
        let mut response = (status, Json(ErrorBody { code: self.code })).into_response();
        if status == StatusCode::TOO_MANY_REQUESTS {
            response.headers_mut().insert(
                header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("10"),
            );
        }
        response
    }
}

type ApiResult<T> = Result<T, ApiError>;

fn error(status: StatusCode, code: &'static str) -> ApiError {
    ApiError { status, code }
}

fn internal<E: std::fmt::Display>(value: E) -> ApiError {
    tracing::error!(error = %value, "sync service operation failed");
    error(StatusCode::INTERNAL_SERVER_ERROR, "server_internal")
}

fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string()
}

fn limited(state: &AppState, scope: &str, maximum: u32) -> ApiResult<()> {
    let mut limits = state.limits.lock().map_err(internal)?;
    let now = Instant::now();
    let bucket = limits.entry(scope.to_string()).or_insert(RateBucket {
        started: now,
        count: 0,
    });
    if now.duration_since(bucket.started) >= Duration::from_secs(60) {
        bucket.started = now;
        bucket.count = 0;
    }
    bucket.count += 1;
    state
        .metrics
        .requests
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if bucket.count > maximum {
        state
            .metrics
            .rejected
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        return Err(error(StatusCode::TOO_MANY_REQUESTS, "rate_limited"));
    }
    Ok(())
}

async fn db(state: &AppState) -> ApiResult<Client> {
    let (client, connection) = tokio_postgres::connect(&state.database_url, NoTls)
        .await
        .map_err(internal)?;
    tokio::spawn(async move {
        if let Err(value) = connection.await {
            tracing::error!(error = %value, "postgres connection ended");
        }
    });
    Ok(client)
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn token_hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

async fn authenticated_account(
    headers: &HeaderMap,
    state: &AppState,
) -> ApiResult<(String, String)> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "auth_required"))?;
    let client = db(state).await?;
    let row = client
        .query_opt(
            "SELECT account_id,device_id FROM access_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()",
            &[&token_hash(token)],
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| {
            state
                .metrics
                .auth_failures
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            error(StatusCode::UNAUTHORIZED, "session_expired")
        })?;
    Ok((row.get(0), row.get(1)))
}

async fn account(headers: &HeaderMap, state: &AppState) -> ApiResult<(String, String)> {
    let (account_id, device_id) = authenticated_account(headers, state).await?;
    limited(state, &format!("account:{account_id}"), 600)?;
    Ok((account_id, device_id))
}

async fn sync_account(headers: &HeaderMap, state: &AppState) -> ApiResult<(String, String)> {
    let (account_id, device_id) = authenticated_account(headers, state).await?;
    let maximum = env::var("SYNC_READ_REQUESTS_PER_MINUTE")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(DEFAULT_SYNC_READ_LIMIT);
    limited(state, &format!("sync-read:{account_id}"), maximum)?;
    Ok((account_id, device_id))
}

async fn upsert_device(
    client: &Client,
    account_id: &str,
    install_id: &str,
    name: &str,
) -> ApiResult<String> {
    if install_id.is_empty() || install_id.len() > 256 || name.len() > 256 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_device"));
    }
    if let Some(row) = client
        .query_opt(
            "SELECT id FROM devices WHERE account_id=$1 AND install_id=$2",
            &[&account_id, &install_id],
        )
        .await
        .map_err(internal)?
    {
        let id: String = row.get(0);
        client
            .execute(
                "UPDATE devices SET name=$1,last_seen_at=NOW() WHERE id=$2",
                &[&name, &id],
            )
            .await
            .map_err(internal)?;
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    client
        .execute(
            "INSERT INTO devices(id,account_id,install_id,name) VALUES($1,$2,$3,$4)",
            &[&id, &account_id, &install_id, &name],
        )
        .await
        .map_err(internal)?;
    Ok(id)
}

async fn issue_tokens<C: GenericClient + Sync>(
    client: &C,
    account_id: &str,
    device_id: &str,
) -> ApiResult<(String, String)> {
    let access = new_token();
    let refresh = new_token();
    client
        .execute(
            "INSERT INTO access_sessions(token_hash,account_id,device_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '15 minutes')",
            &[&token_hash(&access), &account_id, &device_id],
        )
        .await
        .map_err(internal)?;
    client
        .execute(
            "INSERT INTO refresh_sessions(token_hash,account_id,device_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 days')",
            &[&token_hash(&refresh), &account_id, &device_id],
        )
        .await
        .map_err(internal)?;
    Ok((access, refresh))
}

#[derive(Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
    install_id: String,
    device_name: String,
    key_package: String,
    recovery_verifier: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
    install_id: String,
    device_name: String,
}

#[derive(Deserialize)]
struct RecoveryPackageRequest {
    email: String,
    recovery_verifier: String,
}

#[derive(Deserialize)]
struct RecoverRequest {
    email: String,
    recovery_verifier: String,
    password: String,
    key_package: String,
    install_id: String,
    device_name: String,
}

#[derive(Deserialize)]
struct RefreshRequest {
    refresh_token: String,
}

#[derive(Serialize, Deserialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    key_package: String,
    device_id: String,
    account_id: String,
}

fn valid_email(value: &str) -> bool {
    value.len() <= 320 && value.contains('@')
}

async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> ApiResult<Json<AuthResponse>> {
    limited(&state, &format!("register:{}", client_ip(&headers)), 10)?;
    if !valid_email(&body.email) {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_email"));
    }
    if body.password.len() < 10 || body.password.len() > 1024 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_password"));
    }
    if body.key_package.len() > 32_768 || body.recovery_verifier.len() != 64 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_registration"));
    }
    let password_salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &password_salt)
        .map_err(internal)?
        .to_string();
    let recovery_salt = SaltString::generate(&mut OsRng);
    let recovery_hash = Argon2::default()
        .hash_password(body.recovery_verifier.as_bytes(), &recovery_salt)
        .map_err(internal)?
        .to_string();
    let account_id = Uuid::new_v4().to_string();
    let client = db(&state).await?;
    client
        .execute(
            "INSERT INTO users(id,email,password_hash,key_package,recovery_verifier_hash) VALUES($1,$2,$3,$4,$5)",
            &[&account_id, &body.email.to_lowercase(), &password_hash, &body.key_package, &recovery_hash],
        )
        .await
        .map_err(|value| {
            if value.code().map(|code| code.code()) == Some("23505") {
                error(StatusCode::CONFLICT, "email_exists")
            } else {
                internal(value)
            }
        })?;
    let device_id =
        upsert_device(&client, &account_id, &body.install_id, &body.device_name).await?;
    let (access_token, refresh_token) = issue_tokens(&client, &account_id, &device_id).await?;
    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        key_package: body.key_package,
        device_id,
        account_id,
    }))
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> ApiResult<Json<AuthResponse>> {
    limited(&state, &format!("login:{}", client_ip(&headers)), 20)?;
    let client = db(&state).await?;
    let row = client
        .query_opt(
            "SELECT id,password_hash,key_package FROM users WHERE email=$1",
            &[&body.email.to_lowercase()],
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "invalid_credentials"))?;
    let stored_password_hash: String = row.get(1);
    let parsed = PasswordHash::new(&stored_password_hash).map_err(internal)?;
    Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed)
        .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_credentials"))?;
    let account_id: String = row.get(0);
    let device_id =
        upsert_device(&client, &account_id, &body.install_id, &body.device_name).await?;
    let (access_token, refresh_token) = issue_tokens(&client, &account_id, &device_id).await?;
    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        key_package: row.get(2),
        device_id,
        account_id,
    }))
}

async fn verify_recovery(
    client: &Client,
    email: &str,
    verifier: &str,
) -> ApiResult<(String, String)> {
    if verifier.len() != 64 {
        return Err(error(StatusCode::UNAUTHORIZED, "invalid_recovery_code"));
    }
    let row = client
        .query_opt(
            "SELECT id,key_package,recovery_verifier_hash FROM users WHERE email=$1",
            &[&email.to_lowercase()],
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "invalid_recovery_code"))?;
    let stored_recovery_hash: String = row.get(2);
    let parsed = PasswordHash::new(&stored_recovery_hash).map_err(internal)?;
    Argon2::default()
        .verify_password(verifier.as_bytes(), &parsed)
        .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_recovery_code"))?;
    Ok((row.get(0), row.get(1)))
}

async fn recovery_package(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RecoveryPackageRequest>,
) -> ApiResult<Json<AuthResponse>> {
    limited(&state, &format!("recover:{}", client_ip(&headers)), 10)?;
    let client = db(&state).await?;
    let (account_id, key_package) =
        verify_recovery(&client, &body.email, &body.recovery_verifier).await?;
    Ok(Json(AuthResponse {
        access_token: String::new(),
        refresh_token: String::new(),
        key_package,
        device_id: String::new(),
        account_id,
    }))
}

async fn recover(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RecoverRequest>,
) -> ApiResult<Json<AuthResponse>> {
    limited(&state, &format!("recover:{}", client_ip(&headers)), 10)?;
    if body.password.len() < 10 || body.key_package.len() > 32_768 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_password"));
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
            "UPDATE access_sessions SET revoked_at=NOW() WHERE account_id=$1",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    client
        .execute(
            "UPDATE refresh_sessions SET revoked_at=NOW() WHERE account_id=$1",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    let device_id =
        upsert_device(&client, &account_id, &body.install_id, &body.device_name).await?;
    let (access_token, refresh_token) = issue_tokens(&client, &account_id, &device_id).await?;
    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        key_package: body.key_package,
        device_id,
        account_id,
    }))
}

async fn refresh_access(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RefreshRequest>,
) -> ApiResult<Json<AuthResponse>> {
    limited(&state, &format!("refresh:{}", client_ip(&headers)), 30)?;
    let mut client = db(&state).await?;
    let transaction = client.transaction().await.map_err(internal)?;
    let hash = token_hash(&body.refresh_token);
    let row = transaction
        .query_opt(
            "SELECT account_id,device_id FROM refresh_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW() FOR UPDATE",
            &[&hash],
        )
        .await
        .map_err(internal)?
        .ok_or_else(|| error(StatusCode::UNAUTHORIZED, "session_expired"))?;
    transaction
        .execute(
            "UPDATE refresh_sessions SET revoked_at=NOW() WHERE token_hash=$1",
            &[&hash],
        )
        .await
        .map_err(internal)?;
    let account_id: String = row.get(0);
    let device_id: String = row.get(1);
    let (access_token, refresh_token) = issue_tokens(&transaction, &account_id, &device_id).await?;
    transaction.commit().await.map_err(internal)?;
    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        key_package: String::new(),
        device_id,
        account_id,
    }))
}

async fn logout(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> ApiResult<StatusCode> {
    let client = db(&state).await?;
    let hash = token_hash(&body.refresh_token);
    if let Some(row) = client
        .query_opt(
            "SELECT account_id,device_id FROM refresh_sessions WHERE token_hash=$1 AND revoked_at IS NULL",
            &[&hash],
        )
        .await
        .map_err(internal)?
    {
        let account_id: String = row.get(0);
        let device_id: String = row.get(1);
        client
            .execute(
                "UPDATE refresh_sessions SET revoked_at=NOW() WHERE account_id=$1 AND device_id=$2",
                &[&account_id, &device_id],
            )
            .await
            .map_err(internal)?;
        client
            .execute(
                "UPDATE access_sessions SET revoked_at=NOW() WHERE account_id=$1 AND device_id=$2",
                &[&account_id, &device_id],
            )
            .await
            .map_err(internal)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct Capabilities {
    protocol_version: i16,
    max_batch_records: usize,
    max_record_bytes: usize,
    max_blob_bytes: usize,
}

async fn capabilities() -> Json<Capabilities> {
    Json(Capabilities {
        protocol_version: PROTOCOL_VERSION,
        max_batch_records: MAX_BATCH_RECORDS,
        max_record_bytes: MAX_RECORD_BYTES,
        max_blob_bytes: MAX_BLOB_BYTES,
    })
}

#[derive(Serialize)]
struct HeadResponse {
    cursor: i64,
}

async fn sync_head(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<HeadResponse>> {
    let (account_id, _) = sync_account(&headers, &state).await?;
    let client = db(&state).await?;
    let row = client
        .query_one(
            "SELECT COALESCE(MAX(seq),0) FROM sync_records WHERE account_id=$1",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    Ok(Json(HeadResponse { cursor: row.get(0) }))
}

#[derive(Deserialize)]
struct RecordsQuery {
    after: Option<i64>,
    until: Option<i64>,
    limit: Option<i64>,
}

#[derive(Clone, Serialize)]
struct RecordOutput {
    entity_type: String,
    entity_id: String,
    etag: String,
    seq: i64,
    schema_version: i16,
    deleted: bool,
    nonce: String,
    ciphertext: String,
}

fn record_output(row: &Row) -> RecordOutput {
    RecordOutput {
        entity_type: row.get(0),
        entity_id: row.get(1),
        etag: row.get(2),
        seq: row.get(3),
        schema_version: row.get(4),
        deleted: row.get(5),
        nonce: URL_SAFE_NO_PAD.encode(row.get::<_, Vec<u8>>(6)),
        ciphertext: URL_SAFE_NO_PAD.encode(row.get::<_, Vec<u8>>(7)),
    }
}

async fn list_records(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RecordsQuery>,
) -> ApiResult<Json<Vec<RecordOutput>>> {
    let (account_id, _) = sync_account(&headers, &state).await?;
    let after = query.after.unwrap_or(0).max(0);
    let until = query.until.unwrap_or(i64::MAX).max(after);
    let limit = query.limit.unwrap_or(50).clamp(1, 50);
    let client = db(&state).await?;
    let rows = client
        .query(
            "SELECT entity_type,entity_id,etag,seq,schema_version,deleted,nonce,ciphertext FROM sync_records WHERE account_id=$1 AND seq>$2 AND seq<=$3 ORDER BY seq LIMIT $4",
            &[&account_id, &after, &until, &limit],
        )
        .await
        .map_err(internal)?;
    Ok(Json(rows.iter().map(record_output).collect()))
}

#[derive(Deserialize)]
struct RecordInput {
    entity_type: String,
    entity_id: String,
    base_etag: Option<String>,
    schema_version: i16,
    deleted: bool,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
struct BatchInput {
    records: Vec<RecordInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum RecordResultStatus {
    Accepted,
    Conflict,
}

#[derive(Serialize)]
struct RecordResult {
    entity_type: String,
    entity_id: String,
    status: RecordResultStatus,
    etag: String,
    seq: i64,
    current: Option<RecordOutput>,
}

#[derive(Serialize)]
struct BatchOutput {
    results: Vec<RecordResult>,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

async fn push_records(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<BatchInput>,
) -> ApiResult<Json<BatchOutput>> {
    let (account_id, _) = account(&headers, &state).await?;
    if body.records.is_empty() || body.records.len() > MAX_BATCH_RECORDS {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_record_batch"));
    }
    let mut decoded = Vec::with_capacity(body.records.len());
    for record in body.records {
        let nonce = URL_SAFE_NO_PAD
            .decode(&record.nonce)
            .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_record"))?;
        let ciphertext = URL_SAFE_NO_PAD
            .decode(&record.ciphertext)
            .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_record"))?;
        if !valid_identifier(&record.entity_type)
            || !valid_identifier(&record.entity_id)
            || nonce.len() != 24
            || ciphertext.is_empty()
            || ciphertext.len() > MAX_RECORD_BYTES
            || record.schema_version != PROTOCOL_VERSION
        {
            return Err(error(StatusCode::BAD_REQUEST, "invalid_record"));
        }
        decoded.push((record, nonce, ciphertext));
    }

    let mut client = db(&state).await?;
    let transaction = client.transaction().await.map_err(internal)?;
    let mut results = Vec::with_capacity(decoded.len());
    for (record, nonce, ciphertext) in decoded {
        let current = transaction
            .query_opt(
                "SELECT entity_type,entity_id,etag,seq,schema_version,deleted,nonce,ciphertext FROM sync_records WHERE account_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE",
                &[&account_id, &record.entity_type, &record.entity_id],
            )
            .await
            .map_err(internal)?;
        let matches = match (&current, record.base_etag.as_deref()) {
            (None, None) => true,
            (Some(row), Some(base)) => row.get::<_, String>(2) == base,
            _ => false,
        };
        if !matches {
            let output = current
                .as_ref()
                .map(record_output)
                .ok_or_else(|| error(StatusCode::CONFLICT, "record_precondition_failed"))?;
            state
                .metrics
                .record_conflicts
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            results.push(RecordResult {
                entity_type: record.entity_type,
                entity_id: record.entity_id,
                status: RecordResultStatus::Conflict,
                etag: output.etag.clone(),
                seq: output.seq,
                current: Some(output),
            });
            continue;
        }
        if let Some(row) = &current {
            transaction
                .execute(
                    "INSERT INTO sync_record_history(account_id,entity_type,entity_id,etag,seq,schema_version,deleted,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    &[&account_id, &row.get::<_, String>(0), &row.get::<_, String>(1), &row.get::<_, String>(2), &row.get::<_, i64>(3), &row.get::<_, i16>(4), &row.get::<_, bool>(5), &row.get::<_, Vec<u8>>(6), &row.get::<_, Vec<u8>>(7)],
                )
                .await
                .map_err(internal)?;
        }
        let etag = Uuid::new_v4().to_string();
        let seq: i64 = transaction
            .query_one("SELECT nextval('sync_record_seq')", &[])
            .await
            .map_err(internal)?
            .get(0);
        transaction
            .execute(
                "INSERT INTO sync_records(account_id,entity_type,entity_id,etag,seq,schema_version,deleted,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(account_id,entity_type,entity_id) DO UPDATE SET etag=EXCLUDED.etag,seq=EXCLUDED.seq,schema_version=EXCLUDED.schema_version,deleted=EXCLUDED.deleted,nonce=EXCLUDED.nonce,ciphertext=EXCLUDED.ciphertext,updated_at=NOW()",
                &[&account_id, &record.entity_type, &record.entity_id, &etag, &seq, &record.schema_version, &record.deleted, &nonce, &ciphertext],
            )
            .await
            .map_err(internal)?;
        state
            .metrics
            .accepted_records
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        results.push(RecordResult {
            entity_type: record.entity_type,
            entity_id: record.entity_id,
            status: RecordResultStatus::Accepted,
            etag,
            seq,
            current: None,
        });
    }
    transaction
        .execute(
            "DELETE FROM sync_record_history WHERE replaced_at < NOW()-INTERVAL '30 days'",
            &[],
        )
        .await
        .map_err(internal)?;
    transaction.commit().await.map_err(internal)?;
    Ok(Json(BatchOutput { results }))
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn put_blob(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
    body: Bytes,
) -> ApiResult<StatusCode> {
    limited(&state, &format!("blob:{}", client_ip(&headers)), 360)?;
    if !valid_hash(&hash) || body.is_empty() || body.len() > MAX_BLOB_BYTES {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_blob"));
    }
    if format!("{:x}", Sha256::digest(&body)) != hash {
        return Err(error(StatusCode::BAD_REQUEST, "blob_hash_mismatch"));
    }
    let (account_id, _) = account(&headers, &state).await?;
    let client = db(&state).await?;
    client
        .execute(
            "INSERT INTO sync_blobs(account_id,hash,ciphertext) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            &[&account_id, &hash, &body.as_ref()],
        )
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_blob(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> ApiResult<Response> {
    let (account_id, _) = account(&headers, &state).await?;
    let client = db(&state).await?;
    let bytes: Vec<u8> = client
        .query_opt(
            "SELECT ciphertext FROM sync_blobs WHERE account_id=$1 AND hash=$2",
            &[&account_id, &hash],
        )
        .await
        .map_err(internal)?
        .map(|row| row.get(0))
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "blob_not_found"))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(bytes))
        .map_err(internal)
}

async fn head_blob(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(hash): Path<String>,
) -> ApiResult<StatusCode> {
    let (account_id, _) = account(&headers, &state).await?;
    let client = db(&state).await?;
    let found = client
        .query_opt(
            "SELECT 1 FROM sync_blobs WHERE account_id=$1 AND hash=$2",
            &[&account_id, &hash],
        )
        .await
        .map_err(internal)?
        .is_some();
    Ok(if found {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    })
}

#[derive(Serialize)]
struct DeviceOutput {
    id: String,
    name: String,
    last_seen_at: String,
}

async fn list_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Vec<DeviceOutput>>> {
    let (account_id, _) = account(&headers, &state).await?;
    let client = db(&state).await?;
    let rows = client
        .query(
            "SELECT id,name,last_seen_at::TEXT FROM devices WHERE account_id=$1 ORDER BY last_seen_at DESC",
            &[&account_id],
        )
        .await
        .map_err(internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|row| DeviceOutput {
                id: row.get(0),
                name: row.get(1),
                last_seen_at: row.get(2),
            })
            .collect(),
    ))
}

async fn revoke_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> ApiResult<StatusCode> {
    let (account_id, current_device) = account(&headers, &state).await?;
    if device_id == current_device {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "cannot_revoke_current_device",
        ));
    }
    let client = db(&state).await?;
    let changed = client
        .execute(
            "DELETE FROM devices WHERE account_id=$1 AND id=$2",
            &[&account_id, &device_id],
        )
        .await
        .map_err(internal)?;
    if changed == 0 {
        return Err(error(StatusCode::NOT_FOUND, "device_not_found"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_account(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let (account_id, _) = account(&headers, &state).await?;
    let client = db(&state).await?;
    client
        .execute("DELETE FROM users WHERE id=$1", &[&account_id])
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn health(State(state): State<AppState>) -> ApiResult<&'static str> {
    db(&state)
        .await?
        .query_one("SELECT 1", &[])
        .await
        .map_err(internal)?;
    Ok("ok")
}

async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<String> {
    let expected = state
        .metrics_token
        .as_deref()
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "metrics_disabled"))?;
    if headers
        .get("x-sync-metrics-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        != expected
    {
        return Err(error(StatusCode::UNAUTHORIZED, "metrics_unauthorized"));
    }
    Ok(format!(
        "lexicue_sync_requests_total {}\nlexicue_sync_rate_limited_total {}\nlexicue_sync_auth_failures_total {}\nlexicue_sync_records_accepted_total {}\nlexicue_sync_record_conflicts_total {}\n",
        state.metrics.requests.load(std::sync::atomic::Ordering::Relaxed),
        state.metrics.rejected.load(std::sync::atomic::Ordering::Relaxed),
        state.metrics.auth_failures.load(std::sync::atomic::Ordering::Relaxed),
        state.metrics.accepted_records.load(std::sync::atomic::Ordering::Relaxed),
        state.metrics.record_conflicts.load(std::sync::atomic::Ordering::Relaxed),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_opaque_identifiers_and_blob_hashes() {
        assert!(valid_identifier("word"));
        assert!(valid_identifier("abc_DEF-123"));
        assert!(!valid_identifier("../word"));
        assert!(valid_hash(&"a".repeat(64)));
        assert!(!valid_hash("not-a-hash"));
    }

    #[test]
    fn tokens_are_not_stored_verbatim() {
        let token = new_token();
        assert_ne!(token, token_hash(&token));
        assert_eq!(token_hash(&token).len(), 64);
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter("info")
        .init();
    let state = AppState {
        database_url: env::var("DATABASE_URL").expect("DATABASE_URL is required"),
        limits: Arc::new(Mutex::new(HashMap::new())),
        metrics: Arc::new(Metrics::default()),
        metrics_token: env::var("SYNC_METRICS_TOKEN")
            .ok()
            .filter(|value| !value.is_empty()),
    };
    db(&state)
        .await
        .expect("database unavailable")
        .batch_execute(include_str!("../schema.sql"))
        .await
        .expect("schema initialization failed");

    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/v1/capabilities", get(capabilities))
        .route("/v1/auth/register", post(register))
        .route("/v1/auth/login", post(login))
        .route("/v1/auth/recovery-package", post(recovery_package))
        .route("/v1/auth/recover", post(recover))
        .route("/v1/auth/refresh", post(refresh_access))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/sync/head", get(sync_head))
        .route("/v1/sync/records", get(list_records))
        .route("/v1/sync/records/batch", post(push_records))
        .route(
            "/v1/sync/blobs/{hash}",
            put(put_blob).get(get_blob).head(head_blob),
        )
        .route("/v1/devices", get(list_devices))
        .route("/v1/devices/{device_id}", delete(revoke_device))
        .route("/v1/account", delete(delete_account))
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let address: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()
        .expect("invalid BIND_ADDR");
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind failed");
    axum::serve(listener, app).await.expect("server failed");
}
