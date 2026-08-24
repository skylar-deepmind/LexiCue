use argon2::password_hash::{rand_core::OsRng, SaltString};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{env, net::SocketAddr};
use tokio_postgres::{Client, NoTls};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

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
async fn issue_session(client: &Client, account_id: &str) -> Result<String, (StatusCode, String)> {
    let token = new_token();
    client.execute("INSERT INTO sessions (token, account_id, expires_at) VALUES ($1,$2,NOW() + INTERVAL '30 days')", &[&token, &account_id]).await.map_err(internal)?;
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
        access_token: issue_session(&client, &account_id).await?,
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
        access_token: issue_session(&client, &account_id).await?,
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
        .layer(CorsLayer::permissive())
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
