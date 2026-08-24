CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  key_package TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_verifier_hash TEXT;
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS install_id TEXT;
UPDATE devices SET install_id=id WHERE install_id IS NULL;
ALTER TABLE devices ALTER COLUMN install_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_account_install_idx ON devices(account_id, install_id);
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

-- v3 is the entity-event feed.  It is separate from the prototype v2 feed
-- so an upgraded client can never accidentally interpret a v2 full backup as
-- a mergeable entity change.
CREATE TABLE IF NOT EXISTS sync_events_v3 (
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
CREATE INDEX IF NOT EXISTS sync_events_v3_cursor_idx ON sync_events_v3(account_id, seq);

-- A checkpoint is an opaque encrypted manifest plus the ciphertext chunks it
-- references. Chunk hashes are safe to expose to the service: they are hashes
-- of encrypted bytes, not of learning data. Keeping the relation separately
-- lets the server enforce bounded retention without decrypting a manifest.
CREATE TABLE IF NOT EXISTS sync_checkpoints (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  cursor BIGINT NOT NULL DEFAULT 0,
  encrypted_len BIGINT NOT NULL,
  manifest BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sync_checkpoints ADD COLUMN IF NOT EXISTS protocol_version SMALLINT NOT NULL DEFAULT 2;
CREATE INDEX IF NOT EXISTS sync_checkpoints_account_created_idx
  ON sync_checkpoints(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS sync_checkpoint_chunks (
  checkpoint_id TEXT NOT NULL REFERENCES sync_checkpoints(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(checkpoint_id, position),
  UNIQUE(checkpoint_id, hash)
);
CREATE INDEX IF NOT EXISTS sync_checkpoint_chunks_lookup_idx
  ON sync_checkpoint_chunks(account_id, hash);
