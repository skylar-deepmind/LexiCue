CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  key_package TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_device_idx ON sessions(account_id, device_id);
CREATE TABLE IF NOT EXISTS sync_events (
  seq BIGSERIAL PRIMARY KEY, account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL, device_id TEXT NOT NULL, clock TEXT NOT NULL, kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(account_id,event_id)
);
CREATE INDEX IF NOT EXISTS sync_events_cursor_idx ON sync_events(account_id, seq);
CREATE TABLE IF NOT EXISTS snapshots (
  account_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL, cursor BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
-- V2 transport stores opaque encrypted blocks separately from the event feed.
-- Hashes are calculated over ciphertext, so the server never learns content.
CREATE TABLE IF NOT EXISTS sync_chunks (
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(account_id, hash)
);
CREATE TABLE IF NOT EXISTS sync_events_v2 (
  seq BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  clock TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, event_id)
);
CREATE INDEX IF NOT EXISTS sync_events_v2_cursor_idx ON sync_events_v2(account_id, seq);
