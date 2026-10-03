import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
import { migrateAiSettings, useAiStore } from '../aiStore';
import { applyDownloadProgress, cancelModelDownload, deleteOllamaModel, downloadOllamaModel, loadLocalAiEnvironment, refreshInstalledModels, useModelDownloadStore, type ModelDownloadProgress } from '../modelDownloadStore';
const model = 'gemma4:12b-it-q4_K_M';
const tick = (sequence = 1, id = useModelDownloadStore.getState().download!.id): ModelDownloadProgress => ({ downloadId: id, model, sequence, phase: 'downloading', digest: 'layer', total: 100, completed: sequence, bytesPerSecond: null });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.clearAllMocks();
  useAiStore.setState({ ...migrateAiSettings({ enabled: true }), model: 'previous', selectionRevision: 0, aiStatus: 'idle', aiModels: [], aiError: '', aiFingerprint: '' });
  useModelDownloadStore.setState({ environment: null, environmentError: '', environmentLoading: false, download: null, deletion: null, deleteError: '', deleteFailure: null, activity: null, installedModels: [], installedUrl: '', installedError: '', installedLoading: false });
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.invoke.mockImplementation(async name => name === 'ai_models' ? [{ name: model }] : null);
});
describe('local model downloads', () => {
  it('registers events before pulling, confirms installation, and uses the checked model', async () => {
    const pull = deferred<unknown>();
    mocks.invoke.mockImplementation(name => name === 'pull_ollama_model' ? pull.promise : Promise.resolve(name === 'ai_models' ? [{ name: model }] : null));
    const pending = downloadOllamaModel(model, true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('pull_ollama_model', expect.anything()));
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
    applyDownloadProgress({ ...tick(1), phase: 'completed' });
    expect(useModelDownloadStore.getState().download?.status).toBe('active');
    pull.resolve({ model }); await pending;
    expect(useModelDownloadStore.getState().download).toMatchObject({ status: 'completed', autoSelected: true });
    expect(useAiStore.getState().model).toBe(model);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls.some(c => /analyze|chat|generate/.test(c[0]))).toBe(false);
  });
  it('keeps the user selection if it changed during a download, even if restored', async () => {
    const pull = deferred<unknown>();
    mocks.invoke.mockImplementation(name => name === 'pull_ollama_model' ? pull.promise : Promise.resolve(name === 'ai_models' ? [{ name: model }] : null));
    const pending = downloadOllamaModel(model, true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    useAiStore.getState().setModel('new'); useAiStore.getState().setModel('previous');
    pull.resolve(null); await pending;
    expect(useAiStore.getState().model).toBe('previous');
    expect(useModelDownloadStore.getState().download?.autoSelected).toBe(false);
  });
  it('does not automatically select unchecked downloads or issue duplicate pulls', async () => {
    const pull = deferred<unknown>();
    mocks.invoke.mockImplementation(name => name === 'pull_ollama_model' ? pull.promise : Promise.resolve([{ name: model }]));
    const pending = downloadOllamaModel(model, false);
    await downloadOllamaModel(model, true);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls.filter(c => c[0] === 'pull_ollama_model')).toHaveLength(1);
    pull.resolve(null); await pending;
    expect(useAiStore.getState().model).toBe('previous');
  });
  it('ignores duplicate, out of order, old-job and terminal late events', async () => {
    const pull = deferred<unknown>();
    mocks.invoke.mockImplementation(name => name === 'pull_ollama_model' ? pull.promise : Promise.resolve([{ name: model }]));
    const pending = downloadOllamaModel(model, false);
    applyDownloadProgress(tick(2)); applyDownloadProgress(tick(1)); applyDownloadProgress(tick(99, 'old'));
    expect(useModelDownloadStore.getState().download?.progress?.completed).toBe(2);
    pull.resolve(null); await pending;
    applyDownloadProgress(tick(100));
    expect(useModelDownloadStore.getState().download?.progress?.sequence).toBe(2);
  });
  it('cancel and disconnect do not select a model and remain retryable', async () => {
    for (const error of ['ERR_CANCELLED', 'ERR_DOWNLOAD_INTERRUPTED']) {
      const pull = deferred<unknown>();
      mocks.invoke.mockImplementation(name => name === 'pull_ollama_model' ? pull.promise : Promise.resolve(null));
      const pending = downloadOllamaModel(model, true);
      await vi.waitFor(() => expect(mocks.invoke.mock.calls.some(c => c[0] === 'pull_ollama_model')).toBe(true));
      if (error === 'ERR_CANCELLED') await cancelModelDownload();
      pull.reject(error); await pending;
      expect(useModelDownloadStore.getState().download?.status).toBe(error === 'ERR_CANCELLED' ? 'cancelled' : 'error');
      expect(useAiStore.getState().model).toBe('previous');
    }
  });
  it('uses already installed models without pulling and rejects remote downloads', async () => {
    useModelDownloadStore.setState({ installedUrl: 'http://localhost:11434', installedModels: [model] });
    await downloadOllamaModel(model, false);
    await downloadOllamaModel(model, true, 'http://localhost.evil.test');
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(useModelDownloadStore.getState().download).toBeNull();
  });
  it('failed event registration prevents an invisible download', async () => {
    mocks.listen.mockRejectedValueOnce('listen failed');
    await downloadOllamaModel(model, true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(useModelDownloadStore.getState().download).toMatchObject({ status: 'error', error: 'listen failed' });
  });
  it('deduplicates device detection and preserves unknown memory results', async () => {
    const environment = { os: 'macos', architecture: 'aarch64', cpu: null, memoryBytes: null, unifiedMemory: false, models: [] };
    mocks.invoke.mockResolvedValue(environment);
    await Promise.all([loadLocalAiEnvironment(), loadLocalAiEnvironment()]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(useModelDownloadStore.getState().environment).toEqual(environment);
  });
  it('a late installed-model list cannot replace a new endpoint', async () => {
    const models = deferred<{ name: string }[]>(); mocks.invoke.mockReturnValue(models.promise);
    const pending = refreshInstalledModels('http://localhost:11111');
    await refreshInstalledModels('http://remote.test');
    models.resolve([{ name: 'old' }]); await pending;
    expect(useModelDownloadStore.getState()).toMatchObject({ installedUrl: 'http://remote.test', installedModels: [], installedLoading: false });
  });
});

describe('local model deletion', () => {
  function select(name = 'other-vendor:test') { useAiStore.getState().setModel(name); }
  it('clears only a matching local selection and refreshes both model lists', async () => {
    select();
    mocks.invoke.mockImplementation(async name => name === 'delete_ollama_model' ? { alreadyAbsent: false } : name === 'ai_models' ? [{ name: model, size: 8000 }] : null);
    expect(await deleteOllamaModel('other-vendor:test')).toEqual({ alreadyAbsent: false });
    expect(useAiStore.getState().model).toBe('');
    expect(useAiStore.getState().profiles.ollama.model).toBe('');
    expect(useModelDownloadStore.getState().installedInfo).toEqual([{ name: model, size: 8000 }]);
    expect(useAiStore.getState().aiModels).toEqual([model]);
  });
  it('preserves a new model selected while deletion is pending and deduplicates clicks', async () => {
    select(); const command = deferred<{ alreadyAbsent: boolean }>();
    mocks.invoke.mockImplementation(name => name === 'delete_ollama_model' ? command.promise : Promise.resolve(name === 'ai_models' ? [{ name: model }] : null));
    const pending = deleteOllamaModel('other-vendor:test');
    await deleteOllamaModel('other-vendor:test');
    useAiStore.getState().setModel('new-selection');
    command.resolve({ alreadyAbsent: false }); await pending;
    expect(useAiStore.getState().model).toBe('new-selection');
    expect(mocks.invoke.mock.calls.filter(c => c[0] === 'delete_ollama_model')).toHaveLength(1);
  });
  it('keeps cloud settings when clearing a deleted local model', async () => {
    select(); useAiStore.getState().setProvider('openai'); useAiStore.getState().setModel('cloud-model'); useAiStore.getState().setApiKey('test-key');
    useAiStore.setState({ aiModels: ['cloud-chosen'], aiStatus: 'ready' });
    mocks.invoke.mockImplementation(async name => name === 'delete_ollama_model' ? { alreadyAbsent: true } : name === 'ai_models' ? [] : null);
    expect(await deleteOllamaModel('other-vendor:test')).toEqual({ alreadyAbsent: true });
    expect(useAiStore.getState()).toMatchObject({ provider: 'openai', model: 'cloud-model', apiKey: 'test-key', aiModels: ['cloud-chosen'], aiStatus: 'ready' });
    expect(useAiStore.getState().profiles.ollama.model).toBe('');
    expect(mocks.invoke.mock.calls.some(call => call[0] === 'ai_status')).toBe(false);
  });
  it('does not send deletion while generation, download, deletion or remote addressing is active', async () => {
    for (const activity of [{ generations: 1, pulling: false, deleting: false, sequence: 1 }, { generations: 0, pulling: true, deleting: false, sequence: 2 }, { generations: 0, pulling: false, deleting: true, sequence: 3 }]) {
      useModelDownloadStore.setState({ activity });
      expect(await deleteOllamaModel('other-vendor:test')).toBeNull();
    }
    useModelDownloadStore.setState({ activity: null });
    expect(await deleteOllamaModel('other-vendor:test', 'http://localhost.evil.test')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('preserves selection after failure and allows retry', async () => {
    select(); mocks.invoke.mockImplementation(async name => { if (name === 'delete_ollama_model') throw 'connection lost'; return name === 'ai_models' ? [{ name: 'other-vendor:test' }] : null; });
    expect(await deleteOllamaModel('other-vendor:test')).toBeNull();
    expect(useAiStore.getState().model).toBe('other-vendor:test');
    expect(useModelDownloadStore.getState()).toMatchObject({ deletion: null, deleteError: 'connection lost', deleteFailure: { model: 'other-vendor:test', baseUrl: 'http://localhost:11434' } });
  });
});
