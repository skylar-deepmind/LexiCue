import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('navigator', { language: 'en' });
  return { invoke: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
import { useSourceMediaStore } from '../../stores/sourceMediaStore';
import type { MediaRef } from '../sourceMedia';
const ref = { source: { key: 'source-a' }, start_ms: 1000, end_ms: 2000 } as MediaRef;
beforeEach(() => { useSourceMediaStore.setState({ entries: {} }); mock.invoke.mockReset(); });
describe('source preparation ownership', () => {
  it('deduplicates concurrent prepare, never requests playback or writes a saved record', async () => {
    let resolve!: (value: unknown) => void;
    mock.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
    const a = useSourceMediaStore.getState().prepare(ref, { segment_id: 1 });
    await useSourceMediaStore.getState().prepare(ref, { record_id: 'saved-a' });
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(useSourceMediaStore.getState().entries['source-a'].status).toBe('preparing');
    resolve({ status: 'ready' }); await a;
    expect(useSourceMediaStore.getState().entries['source-a'].status).toBe('ready');
    expect(mock.invoke.mock.calls[0][0]).toBe('prepare_source_media');
  });
  it('cancelled completion cannot turn an unsaved original into ready or play', async () => {
    let resolve!: (value: unknown) => void;
    mock.invoke.mockImplementation((cmd: string) => cmd === 'prepare_source_media' ? new Promise(done => { resolve = done; }) : Promise.resolve());
    const a = useSourceMediaStore.getState().prepare(ref, { segment_id: 1 });
    useSourceMediaStore.getState().cancel(ref.source.key);
    resolve({ status: 'ready' }); await a;
    expect(useSourceMediaStore.getState().entries['source-a'].status).toBe('missing');
    expect(mock.invoke.mock.calls.map(c => c[0])).toEqual(['prepare_source_media', 'youtube_cancel_job']);
  });
  it('keeps text independent when preparation fails', async () => {
    mock.invoke.mockRejectedValue('media_network');
    await useSourceMediaStore.getState().prepare(ref, { record_id: 'saved-a' });
    expect(useSourceMediaStore.getState().entries['source-a']).toEqual({ status: 'failed', error: 'media_network' });
  });
});
