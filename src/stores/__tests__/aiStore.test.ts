import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
});
import { DEFAULT_OLLAMA_URL, migrateAiSettings, useAiStore } from '../aiStore';

beforeEach(() => useAiStore.setState({ ...migrateAiSettings({}), selectionRevision: 0 }));
describe('provider profiles and migration', () => {
  it('repairs the screenshot configuration and keeps cloud credentials and model', () => {
    const result = migrateAiSettings({ enabled: true, provider: 'ollama', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: 'test-key' });
    expect(result).toMatchObject({ provider: 'ollama', baseUrl: DEFAULT_OLLAMA_URL, model: '', apiKey: '' });
    expect(result.profiles.openai).toEqual({ baseUrl: 'https://api.deepseek.com/', model: 'deepseek-chat', apiKey: 'test-key' });
    expect(result.apiKeys['https://api.deepseek.com']).toBe('test-key');
  });
  it('keeps custom local URLs and ambiguous endpoints intact', () => {
    for (const baseUrl of ['http://192.168.1.5:11434', 'https://custom.example.test/api']) {
      expect(migrateAiSettings({ provider: 'ollama', baseUrl, model: 'custom' })).toMatchObject({ baseUrl, model: 'custom', apiKey: '' });
    }
  });
  it('restores legacy local settings without trusting a saved connection', () => {
    expect(migrateAiSettings(undefined, { baseUrl: 'http://localhost:12222', model: 'legacy' })).toMatchObject({ enabled: true, baseUrl: 'http://localhost:12222', model: 'legacy' });
  });
  it('remembers local and cloud selections independently and restores endpoint keys', () => {
    const store = useAiStore.getState();
    store.setBaseUrl('http://localhost:12222'); store.setModel('local');
    store.setProvider('openai'); store.selectBaseUrl('https://api.deepseek.com'); store.setApiKey('test-key'); store.setModel('cloud');
    store.setProvider('ollama');
    expect(useAiStore.getState()).toMatchObject({ baseUrl: 'http://localhost:12222', model: 'local', apiKey: '', aiStatus: 'idle' });
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
  });
});
