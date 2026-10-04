import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  return { invoke: vi.fn(), load: vi.fn(async () => {}) };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../wordStore', () => ({ useWordStore: { getState: () => ({ loadWords: mocks.load }) } }));
vi.mock('../phraseStore', () => ({ usePhraseStore: { getState: () => ({ loadPhrases: mocks.load }) } }));
import { useAnnotationStore } from '../annotationStore';
import type { AnnotationScope } from '../../lib/annotation';

const scope: AnnotationScope = { kind: 'word', language: 'en', filter: 'unprocessed', sortBy: 'frequency', query: '' };
const items = [{ id: 1, term: 'book', language: 'en' as const }, { id: 2, term: 'read', language: 'en' as const }];
const store = () => useAnnotationStore.getState();
const current = () => store().sessions['word:en'];
let saved: { state: Pick<ReturnType<typeof store>, 'sessions'>; version?: number } | null = null;
useAnnotationStore.persist.setOptions({ storage: {
  getItem: () => saved,
  setItem: (_name, value) => { saved = JSON.parse(JSON.stringify(value)); },
  removeItem: () => { saved = null; },
} });
beforeEach(() => {
  vi.clearAllMocks();
  useAnnotationStore.setState({ sessions: {}, busy: {}, errors: {} });
  mocks.invoke.mockImplementation(async command => command === 'annotation_identities' ? items : null);
  store().start(scope, items);
});
describe('annotation sessions', () => {
  it('rehydrates the durable queue, cursor, result and one-step undo without restoring transient locks', async () => {
    await store().submit('word:en', 'known');
    const serialized = saved;
    useAnnotationStore.setState({ sessions: {}, busy: {}, errors: {} });
    saved = serialized;
    await useAnnotationStore.persist.rehydrate();
    expect(current().index).toBe(1);
    expect(current().scope).toEqual(scope);
    expect(current().lastStep?.operationId).toBeTruthy();
    expect(store().busy).toEqual({});
    await store().undo('word:en');
    expect(current().index).toBe(0);
  });
  it('advances only after the save and prevents duplicate submits and skips in flight', async () => {
    let resolve!: () => void;
    mocks.invoke.mockImplementation(() => new Promise<void>(yes => { resolve = yes; }));
    const pending = store().submit('word:en', 'learning');
    expect(current().index).toBe(0);
    expect(current().pending?.status).toBe('learning');
    await store().submit('word:en', 'known'); store().skip('word:en');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    resolve(); await pending;
    expect(current().index).toBe(1);
    expect(current().lastStep?.operationId).toBeTruthy();
  });
  it('keeps failed saves at the current item and retries using the same operation ID', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('offline'));
    await store().submit('word:en', 'learning');
    const op = current().pending!.operationId;
    expect(current().index).toBe(0);
    expect(store().errors['word:en']).toContain('offline');
    await store().retry('word:en');
    expect(mocks.invoke).toHaveBeenLastCalledWith('annotate_item', expect.objectContaining({ operationId: op }));
    expect(current().index).toBe(1);
    expect(current().pending).toBeNull();
  });
  it('recovers a committed submission after frontend interruption without resubmitting', async () => {
    const initial = current();
    useAnnotationStore.setState({ sessions: { 'word:en': { ...initial, pending: { type: 'submit', operationId: 'committed', index: 0, status: 'known' } } } });
    mocks.invoke.mockImplementation(async command => command === 'annotation_operation' ? false : items);
    expect(await store().resume('word:en')).toBe(true);
    expect(current().index).toBe(1);
    expect(current().results[1]).toBe('known');
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'annotate_item')).toBe(false);
  });
  it('does not treat an identity-read failure as deletion, and can retry', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('database locked'));
    expect(await store().resume('word:en')).toBe(false);
    expect(current().items).toEqual(items);
    expect(await store().resume('word:en')).toBe(true);
  });
  it('undoes submit and skip, supports the completion page and replays only skipped IDs', async () => {
    await store().submit('word:en', 'learning');
    await store().undo('word:en');
    expect(current().index).toBe(0);
    expect(current().results).toEqual({});
    store().skip('word:en'); await store().submit('word:en', 'known');
    expect(current().index).toBe(2);
    store().reviewSkipped('word:en');
    expect(current().items).toEqual([items[0]]);
    store().skip('word:en'); await store().undo('word:en');
    expect(current().index).toBe(0);
    expect(current().lastStep).toBeNull();
  });
  it('recovers a committed undo and keeps language/kind scopes independent', async () => {
    await store().submit('word:en', 'known');
    const state = current();
    useAnnotationStore.setState({ sessions: { 'word:en': { ...state, pending: { type: 'undo', operationId: state.lastStep!.operationId!, index: 0 } } } });
    mocks.invoke.mockImplementation(async command => command === 'annotation_operation' ? true : items);
    await store().resume('word:en');
    expect(current().index).toBe(0);
    store().start({ ...scope, kind: 'phrase' }, items);
    store().start({ ...scope, language: 'all' }, items);
    expect(Object.keys(store().sessions)).toEqual(['word:en', 'phrase:en', 'word:all']);
  });
});
