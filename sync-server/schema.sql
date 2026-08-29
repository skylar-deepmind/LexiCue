CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  key_package TEXT NOT NULL,
  recovery_verifier_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  install_id TEXT NOT NULL,
  name TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, install_id)
);

-- Both token classes are stored irreversibly so a database disclosure does
-- not yield a bearer credential that can be replayed.
CREATE TABLE IF NOT EXISTS access_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS access_sessions_account_device_idx
  ON access_sessions(account_id, device_id);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refresh_sessions_account_device_idx
  ON refresh_sessions(account_id, device_id);

-- The server owns only opaque authenticated envelopes. `seq` is reassigned on
-- every accepted update, so clients can page a stable high-watermark without
-- retaining an event feed or creating a baseline.
CREATE SEQUENCE IF NOT EXISTS sync_record_seq;
CREATE TABLE IF NOT EXISTS sync_records (
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  etag TEXT NOT NULL,
  seq BIGINT NOT NULL DEFAULT nextval('sync_record_seq'),
  schema_version SMALLINT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  nonce BYTEA NOT NULL,
  ciphertext BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(account_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS sync_records_cursor_idx
  ON sync_records(account_id, seq);

-- Previous opaque versions are for operational recovery only and are pruned
-- after 30 days. Normal clients can never enumerate this table.
CREATE TABLE IF NOT EXISTS sync_record_history (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  etag TEXT NOT NULL,
  seq BIGINT NOT NULL,
  schema_version SMALLINT NOT NULL,
  deleted BOOLEAN NOT NULL,
  nonce BYTEA NOT NULL,
  ciphertext BYTEA NOT NULL,
  replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sync_record_history_retention_idx
  ON sync_record_history(replaced_at);

CREATE TABLE IF NOT EXISTS sync_blobs (
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(account_id, hash)
);
