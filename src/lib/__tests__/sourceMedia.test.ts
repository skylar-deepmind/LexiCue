import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import { useSourceMediaStore } from '../../stores/sourceMediaStore';
import type { MediaRef } from '../sourceMedia';

const ref = { source: { key: 'source-a' }, start_ms: 1000, end_ms: 2000 } as MediaRef;
beforeEach(() => { useSourceMediaStore.setState({ entries: {} }); mock.invoke.mockReset(); });

describe('local audio status', () => {
  it('checks the exact clip without a download or playback side effect', async () => {
    mock.invoke.mockResolvedValue({ status: 'ready' });
    await useSourceMediaStore.getState().refresh(ref, { segment_id: 1 });
    expect(mock.invoke.mock.calls).toEqual([['source_media_status', {
      target: { segment_id: 1, source_key: 'source-a', start_ms: 1000, end_ms: 2000 },
    }]]);
    expect(useSourceMediaStore.getState().entries['source-a'].status).toBe('ready');
  });
  it('treats unavailable audio as missing', async () => {
    mock.invoke.mockRejectedValue('media_missing');
    await useSourceMediaStore.getState().refresh(ref, { record_id: 'saved-a' });
    expect(useSourceMediaStore.getState().entries['source-a']).toEqual({ status: 'missing' });
  });
});
