import { describe, expect, it } from 'vitest';
import { errorCode, SYNC_ERROR_CODES } from '../syncErrors';

describe('sync error mapping', () => {
  it('maps every declared code without falling back to unknown', () => {
    for (const code of SYNC_ERROR_CODES) {
      expect(errorCode(`sync failed: ${code}`)).toBe(code);
    }
  });

  it('maps local safety and identity errors to stable codes', () => {
    expect(errorCode('local_backup_failed')).toBe('local_backup_failed');
    expect(errorCode('local_sync_storage_error')).toBe('local_sync_storage_error');
    expect(errorCode('local_identity_conflict')).toBe('local_identity_conflict');
  });

  it('matches the most specific blob and record codes first', () => {
    expect(errorCode('invalid_blob_manifest')).toBe('invalid_blob_manifest');
    expect(errorCode('invalid_record_batch')).toBe('invalid_record_batch');
    expect(errorCode('blob_hash_mismatch')).toBe('blob_hash_mismatch');
  });

  it('groups unknown blob and record variants by family', () => {
    expect(errorCode('blob_chunk_expired')).toBe('invalid_blob');
    expect(errorCode('invalid_record_v2')).toBe('invalid_record');
  });

  it('normalizes legacy native error messages', () => {
    expect(errorCode('incorrect password or corrupted key package')).toBe('invalid_key_package');
    expect(errorCode('invalid encryption package')).toBe('invalid_key_package');
    expect(errorCode('invalid data key')).toBe('invalid_key_package');
    expect(errorCode('invalid local sync key')).toBe('invalid_local_sync_key');
    expect(errorCode('Invalid device response: malformed JSON')).toBe('invalid_server_response');
    expect(errorCode('Cloud sync is not configured.')).toBe('sync_service_not_configured');
  });

  it('keeps unrelated errors in the actionable unknown bucket', () => {
    expect(errorCode('some_future_error')).toBe('unknown');
  });
});
