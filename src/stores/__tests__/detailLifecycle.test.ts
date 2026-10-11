import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  return { invoke: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { useWordStore } from '../wordStore';
import { usePhraseStore } from '../phraseStore';

beforeEach(() => {
  mocks.invoke.mockReset();
  useWordStore.getState().closeDetail();
  usePhraseStore.getState().closeDetail();
});

describe.each([
  ['word', useWordStore], ['phrase', usePhraseStore],
] as const)('%s detail lifecycle', (_kind, store) => {
  it('does not reopen a dismissed loading panel when its request completes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const load = store.getState().loadDetail(1);
    expect(store.getState().detailLoading).toBe(true);
    store.getState().closeDetail();
    resolve({ id: 1 });
    await load;
    expect(store.getState().detail).toBeNull();
    expect(store.getState().detailLoading).toBe(false);
  });
  it('keeps the newest selection when requests finish out of order', async () => {
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(done => { first = done; }))
      .mockImplementationOnce(() => new Promise(done => { second = done; }));
    const old = store.getState().loadDetail(1);
    const latest = store.getState().loadDetail(2);
    second({ id: 2 }); await latest;
    first({ id: 1 }); await old;
    expect(store.getState().detail).toEqual({ id: 2 });
    expect(store.getState().detailLoading).toBe(false);
  });
});
