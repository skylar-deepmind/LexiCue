/** Stable error codes surfaced by the sync service and the native client. */
export const ERROR_CODES = [
  'auth_required',
  'session_expired',
  'invalid_credentials',
  'invalid_email',
  'invalid_password',
  'invalid_recovery_code',
  'email_exists',
  'invalid_registration',
  'invalid_device',
  'network_unavailable',
  'rate_limited',
  'server_internal',
  'credential_store_unavailable',
  'credential_store_write_failed',
  'credential_missing',
  'credential_corrupted',
  'local_backup_failed',
  'local_sync_storage_error',
  'local_identity_conflict',
  'sync_service_not_configured',
  'unsupported_sync_protocol',
  'invalid_server_response',
  'invalid_key_package',
  'invalid_local_sync_key',
  'record_encryption_failed',
  'invalid_encrypted_record',
  'record_authentication_failed',
  'invalid_record_batch',
  'invalid_record',
  'record_precondition_failed',
  'invalid_blob_manifest',
  'invalid_blob',
  'blob_hash_mismatch',
  'blob_not_found',
  'cannot_revoke_current_device',
  'device_not_found',
  'metrics_disabled',
  'metrics_unauthorized',
  'sync_service_error',
  'unknown',
] as const;

export const SYNC_ERROR_CODES = ERROR_CODES;

export type SyncErrorCode = typeof ERROR_CODES[number];

// Match specific codes before their broader family (for example, manifest
// before blob and batch before record).
const SPECIFIC_CODES = [...ERROR_CODES]
  .filter((code) => code !== 'unknown')
  .sort((a, b) => b.length - a.length);

const LEGACY_MESSAGES: readonly [string, SyncErrorCode][] = [
  ['invalid encryption package', 'invalid_key_package'],
  ['incorrect password or corrupted key package', 'invalid_key_package'],
  ['invalid data key', 'invalid_key_package'],
  ['invalid local sync key', 'invalid_local_sync_key'],
  ['invalid device response', 'invalid_server_response'],
  ['cloud sync is not configured', 'sync_service_not_configured'],
];

/** Converts native/server errors into a safe, translatable sync error code. */
export function errorCode(value: unknown): SyncErrorCode {
  const text = String(value ?? '');
  const normalized = text.toLowerCase();
  const specific = SPECIFIC_CODES.find((code) => normalized.includes(code));
  if (specific) return specific;

  const legacy = LEGACY_MESSAGES.find(([message]) => normalized.includes(message));
  if (legacy) return legacy[1];

  // Keep future server variants actionable without exposing an untranslated
  // implementation-specific code to users.
  if (normalized.includes('blob_')) return 'invalid_blob';
  if (normalized.includes('invalid_record')) return 'invalid_record';

  return 'unknown';
}
