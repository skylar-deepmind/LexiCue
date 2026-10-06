import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { useAiStore } from '../../stores/aiStore';
import { checkAiConnection, ensureAiConnection, getAiConfig, getAiConnectionFingerprint, invalidateAiDiscovery } from '../ai';

beforeEach(() => {
  mocks.invoke.mockReset();
  useAiStore.setState({ enabled: true, provider: 'gemma', baseUrl: 'http://localhost:11434', model: 'chosen-model', apiKey: '', aiModels: [], aiFingerprint: '', aiStatus: 'idle', aiError: '' });
});

describe('shared AI model discovery', () => {
  it('loads distinct model names without changing the selected model or issuing analysis requests', async () => {
    mocks.invoke.mockImplementation(async name => name === 'ai_status' ? null : [{ name: 'one' }, { name: 'two' }, { name: 'one' }]);
    await checkAiConnection();
    expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(['ai_status', 'ai_models']);
    expect(useAiStore.getState()).toMatchObject({ aiStatus: 'ready', aiModels: ['one', 'two'], model: 'chosen-model' });
    useAiStore.getState().setModel('two');
    expect(getAiConfig().model).toBe('two');
    expect(getAiConnectionFingerprint()).toBe(useAiStore.getState().aiFingerprint);
  });

  it('preserves the current model and exposes a model-list failure for retry', async () => {
    mocks.invoke.mockImplementation(async name => { if (name === 'ai_models') throw new Error('list failed'); });
    await checkAiConnection();
    expect(useAiStore.getState()).toMatchObject({ model: 'chosen-model', aiModels: [], aiStatus: 'ready', aiError: 'Error: list failed' });
  });

  it('does not let an old service response overwrite a new service configuration', async () => {
    let resolve!: (models: { name: string }[]) => void;
    mocks.invoke.mockImplementation(name => name === 'ai_status' ? Promise.resolve() : new Promise(done => { resolve = done; }));
    const pending = checkAiConnection();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('ai_models', expect.anything()));
    useAiStore.setState({ provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test-only-key', aiStatus: 'idle', aiModels: ['new-service-model'] });
    resolve([{ name: 'old-service-model' }]);
    await pending;
    expect(useAiStore.getState().aiModels).toEqual(['new-service-model']);
    expect(useAiStore.getState().aiStatus).toBe('idle');
  });

  it('keeps connection failures retryable and uses the configured cloud service credentials', async () => {
    useAiStore.setState({ provider: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'test-only-key' });
    mocks.invoke.mockRejectedValue('unavailable');
    await checkAiConnection();
    expect(mocks.invoke).toHaveBeenCalledWith('ai_status', { config: expect.objectContaining({ provider: 'openai', apiKey: 'test-only-key' }) });
    expect(useAiStore.getState()).toMatchObject({ aiStatus: 'error', aiError: 'unavailable', model: 'chosen-model' });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});


describe('automatic discovery', () => {
  it('shares pending checks and reuses success for 60 seconds', async () => {
    mocks.invoke.mockImplementation(async name => name === 'ai_models' ? [{ name: 'one' }] : null);
    await Promise.all([ensureAiConnection(), ensureAiConnection()]);
    await ensureAiConnection();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await checkAiConnection();
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });
  it('does not auto-contact disabled AI or cloud services', async () => {
    useAiStore.setState({ enabled: false }); await ensureAiConnection();
    useAiStore.setState({ enabled: true, provider: 'openai' }); await ensureAiConnection();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('strips cloud credentials from local analysis configurations', () => {
    useAiStore.setState({ provider: 'gemma', apiKey: 'cloud-only' });
    expect(getAiConfig().apiKey).toBeUndefined();
  });
  it('local configurations have no HTTP endpoint or credentials', () => {
    expect(getAiConfig()).toMatchObject({ provider: 'gemma', model: 'chosen-model' });
    expect(getAiConfig().baseUrl).toBeUndefined();
    expect(getAiConfig().apiKey).toBeUndefined();
  });
});

it('rejects discovery responses started before model-list invalidation', async () => {
  let resolve!: (models: { name: string }[]) => void;
  mocks.invoke.mockImplementation(name => name === 'ai_status' ? Promise.resolve() : new Promise(done => { resolve = done; }));
  const pending = checkAiConnection();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('ai_models', expect.anything()));
  invalidateAiDiscovery();
  resolve([{ name: 'deleted-model' }]); await pending;
  expect(useAiStore.getState()).toMatchObject({ aiStatus: 'idle', aiModels: [] });
});
