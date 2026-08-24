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
use std::{env, net::SocketAddr};
use sha2::{Digest, Sha256};
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
}
#[derive(Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
    device_id: String,
    device_name: String,
}
#[derive(Serialize)]
struct AuthResponse {
    access_token: String,
    key_package: String,
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
struct DeviceOutput { id: String, name: String, last_seen_at: String }

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
        headers.get(name).and_then(|v| v.to_str().ok())
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
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) || body.len() > MAX_CHUNK_BYTES {
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
    let bytes: Vec<u8> = client.query_opt("SELECT ciphertext FROM sync_chunks WHERE account_id=$1 AND hash=$2", &[&account_id, &hash]).await.map_err(internal)?
        .map(|row| row.get(0)).ok_or((StatusCode::NOT_FOUND, "encrypted chunk not found".into()))?;
    Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(bytes)).map_err(internal)
}

async fn head_chunk_v2(
    State(state): State<AppState>, headers: HeaderMap, Path(hash): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    if client.query_opt("SELECT 1 FROM sync_chunks WHERE account_id=$1 AND hash=$2", &[&account_id, &hash]).await.map_err(internal)?.is_some() { Ok(StatusCode::NO_CONTENT) } else { Err((StatusCode::NOT_FOUND, "encrypted chunk not found".into())) }
}

async fn push_event_v2(
    State(state): State<AppState>, headers: HeaderMap, body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    if body.is_empty() || body.len() > MAX_EVENT_BYTES { return Err(bad("invalid or oversized encrypted event")); }
    let event = v2_event_headers(&headers)?;
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    client.execute("INSERT INTO sync_events_v2(account_id,event_id,device_id,clock,kind,ciphertext) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,event_id) DO NOTHING", &[&account_id,&event.event_id,&event.device_id,&event.clock,&event.kind,&body.as_ref()]).await.map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pull_events_v2(
    State(state): State<AppState>, headers: HeaderMap, Query(query): Query<PullQuery>,
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
        out.extend_from_slice(&(metadata.len() as u32).to_be_bytes()); out.extend_from_slice(&metadata);
        out.extend_from_slice(&(ciphertext.len() as u32).to_be_bytes()); out.extend_from_slice(&ciphertext);
    }
    Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE, "application/vnd.lexicue.sync-events+binary;v=2")
        .body(axum::body::Body::from(out)).map_err(internal)
}

async fn list_devices_v2(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Vec<DeviceOutput>>, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let rows = client.query("SELECT id,name,last_seen_at::TEXT FROM devices WHERE account_id=$1 ORDER BY last_seen_at DESC", &[&account_id]).await.map_err(internal)?;
    Ok(Json(rows.into_iter().map(|r| DeviceOutput { id: r.get(0), name: r.get(1), last_seen_at: r.get(2) }).collect()))
}

async fn revoke_device_v2(State(state): State<AppState>, headers: HeaderMap, Path(device_id): Path<String>) -> Result<StatusCode, (StatusCode, String)> {
    let account_id = account(&headers, &state).await?;
    let client = db(&state).await?;
    let changed = client.execute("DELETE FROM devices WHERE id=$1 AND account_id=$2", &[&device_id, &account_id]).await.map_err(internal)?;
    if changed == 0 { return Err((StatusCode::NOT_FOUND, "device not found".into())); }
    client.execute("UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND device_id=$2", &[&account_id, &device_id]).await.map_err(internal)?;
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
) -> Result<(), (StatusCode, String)> {
    client.execute("INSERT INTO devices (id, account_id, name, last_seen_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, last_seen_at=NOW() WHERE devices.account_id=EXCLUDED.account_id", &[&device_id, &account_id, &name]).await.map_err(internal)?;
    Ok(())
}
async fn issue_session(client: &Client, account_id: &str, device_id: &str) -> Result<String, (StatusCode, String)> {
    let token = new_token();
    client.execute("INSERT INTO sessions (token, account_id, device_id, expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '30 days')", &[&token, &account_id, &device_id]).await.map_err(internal)?;
    Ok(token)
}
async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    if !body.email.contains('@') || body.password.len() < 10 || body.key_package.len() > 32_768 {
        return Err(bad("invalid registration payload"));
    }
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
    let account_id = Uuid::new_v4().to_string();
    let client = db(&state).await?;
    client
        .execute(
            "INSERT INTO users (id,email,password_hash,key_package) VALUES ($1,$2,$3,$4)",
            &[
                &account_id,
                &body.email.to_lowercase(),
                &password_hash,
                &body.key_package,
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
    upsert_device(&client, &account_id, &body.device_id, &body.device_name).await?;
    Ok(Json(AuthResponse {
        access_token: issue_session(&client, &account_id, &body.device_id).await?,
        key_package: body.key_package,
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
    upsert_device(&client, &account_id, &body.device_id, &body.device_name).await?;
    Ok(Json(AuthResponse {
        access_token: issue_session(&client, &account_id, &body.device_id).await?,
        key_package: row.get(2),
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
        .route("/v1/events", post(push_events).get(pull_events))
        .route("/v1/snapshot", post(put_snapshot).get(get_snapshot))
        .route("/v2/chunks/{hash}", put(put_chunk_v2).get(get_chunk_v2).head(head_chunk_v2))
        .route("/v2/events", post(push_event_v2).get(pull_events_v2))
        .route("/v2/devices", get(list_devices_v2))
        .route("/v2/devices/{device_id}", axum::routing::delete(revoke_device_v2))
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
