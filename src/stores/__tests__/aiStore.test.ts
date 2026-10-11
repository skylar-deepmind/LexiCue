import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
});
import { migrateAiSettings, useAiStore } from '../aiStore';

beforeEach(() => useAiStore.setState({ ...migrateAiSettings({}), selectionRevision: 0 }));
describe('provider profiles and migration', () => {
  it('repairs the screenshot configuration and keeps cloud credentials and model', () => {
    const result = migrateAiSettings({ enabled: true, provider: 'ollama', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: 'test-key' });
    expect(result).toMatchObject({ provider: 'gemma', baseUrl: '', model: '', apiKey: '' });
    expect(result.profiles.openai).toEqual({ baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: 'test-key' });
    expect(result.apiKeys['https://api.deepseek.com']).toBe('test-key');
  });
  it('migrates old local profiles to pending install while retaining enabled and cloud settings', () => {
    const cloud = { baseUrl: 'https://custom.test/v1', model: 'cloud', apiKey: 'test-key' };
    expect(migrateAiSettings({ enabled: true, provider: 'ollama', profiles: { ollama: { baseUrl: 'http://192.168.1.5:11434', model: 'old' }, openai: cloud } })).toMatchObject({ enabled: true, provider: 'gemma', model: '', profiles: { gemma: { model: '' }, openai: cloud } });
    expect(migrateAiSettings(undefined, { baseUrl: 'http://localhost:12222', model: 'old' })).toMatchObject({ enabled: true, provider: 'gemma', baseUrl: '', model: '' });
  });
  it('remembers local and cloud selections independently and restores endpoint keys', () => {
    const store = useAiStore.getState();
    store.setModel('local');
    store.setProvider('openai'); store.selectBaseUrl('https://api.deepseek.com'); store.setApiKey('test-key'); store.setModel('cloud');
    store.setProvider('gemma');
    expect(useAiStore.getState()).toMatchObject({ baseUrl: '', model: 'local', apiKey: '', aiStatus: 'idle' });
    store.setProvider('openai');
    expect(useAiStore.getState()).toMatchObject({ baseUrl: 'https://api.deepseek.com', model: 'cloud', apiKey: 'test-key' });
    store.selectBaseUrl('https://custom.test'); store.setApiKey('second-key'); store.selectBaseUrl('https://api.deepseek.com');
    expect(useAiStore.getState().apiKey).toBe('test-key');
  });
  it('new persistence stores profiles but excludes stale connection results', () => {
    const state = useAiStore.getState();
    const partial = useAiStore.persist.getOptions().partialize!(state);
    expect(partial).not.toHaveProperty('aiStatus'); expect(partial).not.toHaveProperty('aiModels');
    expect(migrateAiSettings(partial).profiles).toEqual(state.profiles);
    state.setModel('gemma4-e2b-litert-181938105e0e'); state.setProvider('openai');
    const saved = useAiStore.persist.getOptions().partialize!(useAiStore.getState());
    expect(migrateAiSettings(saved).profiles.gemma.model).toBe('gemma4-e2b-litert-181938105e0e');
  });
});
