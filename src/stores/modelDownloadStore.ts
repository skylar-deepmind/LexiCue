import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { checkAiConnection, getAiConnectionFingerprint, isLocalOllamaUrl, invalidateAiDiscovery } from '../lib/ai';
import { useAiStore, DEFAULT_OLLAMA_URL, type AiModelInfo } from './aiStore';

export interface ModelRecommendation {
  model: string; label: string; quantization: string; estimatedBytes: number; recommended: boolean; preferred: boolean;
}
export interface LocalAiEnvironment {
  os: string; architecture: string; cpu: string | null; memoryBytes: number | null; unifiedMemory: boolean; models: ModelRecommendation[];
}
export interface ModelDownloadProgress {
  downloadId: string; model: string; sequence: number;
  phase: 'manifest' | 'downloading' | 'verifying' | 'installing' | 'completed';
  digest: string | null; total: number | null; completed: number | null; bytesPerSecond: number | null;
}
export interface ModelDownload {
  id: string; model: string; baseUrl: string; status: 'active' | 'completed' | 'cancelled' | 'error';
  progress: ModelDownloadProgress | null; useAfterDownload: boolean; error: string; cancelRequested: boolean; autoSelected: boolean;
}
interface DownloadState {
  environment: LocalAiEnvironment | null; environmentError: string; environmentLoading: boolean;
  installedModels: string[]; installedInfo: AiModelInfo[]; installedUrl: string; installedError: string; installedLoading: boolean;
  download: ModelDownload | null; deletion: { model: string; baseUrl: string } | null; deleteError: string; deleteFailure: { model: string; baseUrl: string } | null;
  activity: { generations: number; pulling: boolean; deleting: boolean; sequence: number } | null;
}
export const useModelDownloadStore = create<DownloadState>(() => ({
  environment: null, environmentError: '', environmentLoading: false,
  installedModels: [], installedInfo: [], installedUrl: '', installedError: '', installedLoading: false, download: null, deletion: null, deleteError: '', deleteFailure: null, activity: null,
}));
let environmentPromise: Promise<void> | undefined;
let modelsPromise: { url: string; promise: Promise<void> } | undefined;
let modelsAttempt = 0;
const canonical = (value: string) => (value.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
export function localModelBaseUrl() {
  const state = useAiStore.getState();
  return (state.provider === 'ollama' ? state.baseUrl : state.profiles.ollama.baseUrl).trim() || DEFAULT_OLLAMA_URL;
}
export function loadLocalAiEnvironment(force = false): Promise<void> {
  if (environmentPromise) return environmentPromise;
  if (!force && useModelDownloadStore.getState().environment) return Promise.resolve();
  useModelDownloadStore.setState({ environmentLoading: true, environmentError: '' });
  const promise = invoke<LocalAiEnvironment>('get_local_ai_environment').then(environment => {
    useModelDownloadStore.setState({ environment });
  }).catch(error => { useModelDownloadStore.setState({ environmentError: String(error) }); }).finally(() => {
    useModelDownloadStore.setState({ environmentLoading: false });
    if (environmentPromise === promise) environmentPromise = undefined;
  });
  environmentPromise = promise;
  return promise;
}
export function refreshInstalledModels(baseUrl = localModelBaseUrl(), force = false): Promise<void> {
  const url = canonical(baseUrl);
  if (!isLocalOllamaUrl(url)) {
    useModelDownloadStore.setState({ installedUrl: url, installedModels: [], installedInfo: [], installedError: '', installedLoading: false });
    ++modelsAttempt;
    return Promise.resolve();
  }
  const ai = useAiStore.getState();
  if (!force && ai.provider === 'ollama' && canonical(ai.baseUrl) === url && ai.aiStatus === 'ready' && !ai.aiError && ai.aiFingerprint === getAiConnectionFingerprint()) {
    useModelDownloadStore.setState({ installedUrl: url, installedModels: ai.aiModels, installedInfo: ai.aiModelInfo, installedError: '', installedLoading: false });
    ++modelsAttempt;
    return Promise.resolve();
  }
  if (!force && modelsPromise?.url === url) return modelsPromise.promise;
  const attempt = ++modelsAttempt;
  useModelDownloadStore.setState({ installedUrl: url, installedLoading: true, installedError: '', installedModels: [] });
  const promise = invoke<AiModelInfo[]>('ai_models', { config: { provider: 'ollama', baseUrl: url, model: '' } }).then(models => {
    if (attempt === modelsAttempt) {
      const names = [...new Set(models.map(m => m.name))];
      useModelDownloadStore.setState({ installedModels: names, installedInfo: models });
      const current = useAiStore.getState();
      if (current.provider === 'ollama' && canonical(current.baseUrl) === url)
        useAiStore.setState({ aiModels: names, aiModelInfo: models, aiStatus: 'ready', aiError: '', aiFingerprint: getAiConnectionFingerprint() });
    }
  }).catch(error => {
    if (attempt === modelsAttempt) useModelDownloadStore.setState({ installedError: String(error) });
  }).finally(() => {
    if (attempt === modelsAttempt) useModelDownloadStore.setState({ installedLoading: false });
    if (modelsPromise?.promise === promise) modelsPromise = undefined;
  });
  modelsPromise = { url, promise };
  return promise;
}
export function applyDownloadProgress(event: ModelDownloadProgress): void {
  useModelDownloadStore.setState(state => {
    const download = state.download;
    if (!download || download.status !== 'active' || event.downloadId !== download.id || event.model !== download.model || event.sequence <= (download.progress?.sequence ?? 0)) return state;
    return { download: { ...download, progress: event } };
  });
}
export function selectInstalledOllamaModel(model: string, baseUrl = localModelBaseUrl()): void {
  if (!isLocalOllamaUrl(baseUrl)) return;
  const state = useAiStore.getState();
  state.setProvider('ollama');
  state.setBaseUrl(baseUrl);
  state.setModel(model);
  void checkAiConnection();
}
export async function downloadOllamaModel(model: string, useAfterDownload: boolean, baseUrl = localModelBaseUrl()): Promise<void> {
  if (useModelDownloadStore.getState().download?.status === 'active' || useModelDownloadStore.getState().deletion || useModelDownloadStore.getState().activity?.deleting) return;
  if (!isLocalOllamaUrl(baseUrl)) return;
  const store = useModelDownloadStore.getState();
  if (canonical(store.installedUrl) === canonical(baseUrl) && store.installedModels.includes(model)) {
    if (useAfterDownload) selectInstalledOllamaModel(model, baseUrl);
    return;
  }
  const revision = useAiStore.getState().selectionRevision;
  const initial = useAiStore.getState();
  const selection = { provider: initial.provider, baseUrl: initial.baseUrl, model: initial.model, enabled: initial.enabled };
  const id = crypto.randomUUID();
  useModelDownloadStore.setState({ download: { id, model, baseUrl, status: 'active', progress: null, useAfterDownload, error: '', cancelRequested: false, autoSelected: false } });
  const update = (values: Partial<ModelDownload>) => useModelDownloadStore.setState(state => state.download?.id === id ? { download: { ...state.download, ...values } } : state);
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<ModelDownloadProgress>('ollama-model-download-progress', event => applyDownloadProgress(event.payload));
    if (useModelDownloadStore.getState().download?.cancelRequested) { update({ status: 'cancelled' }); return; }
    await invoke('pull_ollama_model', { baseUrl, model, downloadId: id });
    // The command confirms the install; a completion event alone does not terminate the job.
    update({ status: 'completed' });
    invalidateAiDiscovery({ provider: 'ollama', baseUrl, model: '' });
    await refreshInstalledModels(localModelBaseUrl(), true);
    if (useAiStore.getState().provider === 'ollama' && canonical(useAiStore.getState().baseUrl) === canonical(baseUrl)) await checkAiConnection();
    const current = useAiStore.getState();
    if (useModelDownloadStore.getState().download?.id === id && useAfterDownload && current.selectionRevision === revision && Object.entries(selection).every(([key, value]) => current[key as keyof typeof selection] === value)) {
      selectInstalledOllamaModel(model, baseUrl);
      update({ autoSelected: true });
    }
  } catch (error) {
    const message = String(error);
    update({ status: message.includes('ERR_CANCELLED') ? 'cancelled' : 'error', error: message });
  } finally { unlisten?.(); }
}
export async function cancelModelDownload(): Promise<void> {
  const download = useModelDownloadStore.getState().download;
  if (!download || download.status !== 'active' || download.cancelRequested) return;
  useModelDownloadStore.setState({ download: { ...download, cancelRequested: true } });
  try { await invoke('cancel_ollama_model_download', { downloadId: download.id }); }
  catch (error) { useModelDownloadStore.setState(state => state.download?.id === download.id ? { download: { ...state.download, cancelRequested: false, error: String(error) } } : state); }
}

let activityInitialization: Promise<void> | undefined;
export function initializeLocalActivity(): Promise<void> {
  if (activityInitialization) return activityInitialization;
  const apply = (next: DownloadState['activity']) => {
    if (next) useModelDownloadStore.setState(state => !state.activity || next.sequence >= state.activity.sequence ? { activity: next } : {});
  };
  activityInitialization = (async () => {
    const stop = await listen<NonNullable<DownloadState['activity']>>('ollama-local-activity', event => apply(event.payload));
    try { apply(await invoke<DownloadState['activity']>('get_local_ollama_activity')); }
    catch (error) { stop(); throw error; }
  })().catch(() => { activityInitialization = undefined; });
  return activityInitialization;
}
export function localModelOperationsBusy(): boolean {
  const { activity, deletion, download } = useModelDownloadStore.getState();
  return Boolean(deletion || download?.status === 'active' || activity && (activity.generations > 0 || activity.pulling || activity.deleting));
}
export async function deleteOllamaModel(model: string, baseUrl = localModelBaseUrl()): Promise<{ alreadyAbsent: boolean } | null> {
  if (!isLocalOllamaUrl(baseUrl) || localModelOperationsBusy()) return null;
  useModelDownloadStore.setState({ deletion: { model, baseUrl }, deleteError: '', deleteFailure: null });
  try {
    const result = await invoke<{ alreadyAbsent: boolean }>('delete_ollama_model', { baseUrl, model });
    // Clear only the still-matching local profile, never another provider or a new selection.
    useAiStore.setState(state => {
      const profile = state.profiles.ollama;
      if (canonical(profile.baseUrl) !== canonical(baseUrl) || profile.model !== model) return {};
      const profiles = { ...state.profiles, ollama: { ...profile, model: '' } };
      return { profiles, ...(state.provider === 'ollama' ? { model: '' } : {}), selectionRevision: state.selectionRevision + 1 };
    });
    invalidateAiDiscovery({ provider: 'ollama', baseUrl, model: '' });
    await refreshInstalledModels(localModelBaseUrl(), true);
    if (useAiStore.getState().provider === 'ollama' && canonical(useAiStore.getState().baseUrl) === canonical(baseUrl)) await checkAiConnection();
    return result;
  } catch (error) {
    useModelDownloadStore.setState({ deleteError: String(error), deleteFailure: { model, baseUrl } });
    invalidateAiDiscovery({ provider: 'ollama', baseUrl, model: '' });
    await refreshInstalledModels(localModelBaseUrl(), true);
    if (useAiStore.getState().provider === 'ollama' && canonical(useAiStore.getState().baseUrl) === canonical(baseUrl)) await checkAiConnection();
    return null;
  } finally { useModelDownloadStore.setState({ deletion: null }); }
}
