import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { checkAiConnection, invalidateAiDiscovery } from '../lib/ai';
import { useAiStore, type AiModelInfo } from './aiStore';

export interface ModelRecommendation {
  model: string; label: string; quantization: string; estimatedBytes: number; recommended: boolean; preferred: boolean; format: string; compatible: boolean; resumable: boolean;
}
export interface LocalAiEnvironment {
  os: string; architecture: string; cpu: string | null; memoryBytes: number | null; unifiedMemory: boolean; models: ModelRecommendation[]; availableMemoryBytes: number | null; freeStorageBytes: number | null; runtimeStatus: RuntimeStatus;
}
export interface RuntimeStatus { model: string | null; backend: string | null; state: string; loadMs: number | null; error: string | null }
export interface ModelDownloadProgress {
  downloadId: string; model: string; sequence: number;
  phase: 'manifest' | 'downloading' | 'verifying' | 'installing' | 'completed';
  digest: string | null; total: number | null; completed: number | null; bytesPerSecond: number | null;
}
export interface ModelDownload {
  id: string; model: string; status: 'active' | 'completed' | 'cancelled' | 'error';
  progress: ModelDownloadProgress | null; useAfterDownload: boolean; error: string; cancelRequested: boolean; autoSelected: boolean;
}
interface DownloadState {
  environment: LocalAiEnvironment | null; environmentError: string; environmentLoading: boolean;
  installedModels: string[]; installedInfo: AiModelInfo[]; installedError: string; installedLoading: boolean;
  download: ModelDownload | null; deletion: { model: string; } | null; deleteError: string; deleteFailure: { model: string; } | null;
  activity: { generations: number; pulling: boolean; deleting: boolean; sequence: number } | null;
}
export const useModelDownloadStore = create<DownloadState>(() => ({
  environment: null, environmentError: '', environmentLoading: false,
  installedModels: [], installedInfo: [], installedError: '', installedLoading: false, download: null, deletion: null, deleteError: '', deleteFailure: null, activity: null,
}));
let environmentPromise: Promise<void> | undefined;
let modelsPromise: Promise<void> | undefined;
let modelsAttempt = 0;
export function loadLocalAiEnvironment(force = false): Promise<void> {
  if (environmentPromise) return environmentPromise;
  if (!force && useModelDownloadStore.getState().environment) return Promise.resolve();
  useModelDownloadStore.setState({ environmentLoading: true, environmentError: '' });
  const promise = invoke<LocalAiEnvironment>('get_local_gemma_environment').then(environment => {
    useModelDownloadStore.setState({ environment });
  }).catch(error => { useModelDownloadStore.setState({ environmentError: String(error) }); }).finally(() => {
    useModelDownloadStore.setState({ environmentLoading: false });
    if (environmentPromise === promise) environmentPromise = undefined;
  });
  environmentPromise = promise;
  return promise;
}
export function refreshInstalledModels(force = false): Promise<void> {
  if (!force && modelsPromise) return modelsPromise;
  const attempt = ++modelsAttempt;
  useModelDownloadStore.setState({ installedLoading: true, installedError: '' });
  const promise = invoke<AiModelInfo[]>('ai_models', { config: { provider: 'gemma', model: '' } }).then(models => {
    if (attempt !== modelsAttempt) return;
    const names = [...new Set(models.map(m => m.name))];
    useModelDownloadStore.setState({ installedModels: names, installedInfo: models });
    if (useAiStore.getState().provider === 'gemma') useAiStore.setState({ aiModels: names, aiModelInfo: models });
  }).catch(error => { if (attempt === modelsAttempt) useModelDownloadStore.setState({ installedError: String(error) }); })
    .finally(() => { if (attempt === modelsAttempt) useModelDownloadStore.setState({ installedLoading: false }); if (modelsPromise === promise) modelsPromise = undefined; });
  modelsPromise = promise;
  return promise;
}
export function applyDownloadProgress(event: ModelDownloadProgress): void {
  useModelDownloadStore.setState(state => {
    const download = state.download;
    if (!download || download.status !== 'active' || event.downloadId !== download.id || event.model !== download.model || event.sequence <= (download.progress?.sequence ?? 0)) return state;
    return { download: { ...download, progress: event } };
  });
}
export function selectInstalledGemmaModel(model: string): void {
  const state = useAiStore.getState();
  state.setProvider('gemma');
  state.setModel(model);
  void checkAiConnection();
}
export async function downloadGemmaModel(model: string, useAfterDownload: boolean, importPath?: string): Promise<void> {
  if (useModelDownloadStore.getState().download?.status === 'active' || useModelDownloadStore.getState().deletion || useModelDownloadStore.getState().activity?.deleting) return;
  const store = useModelDownloadStore.getState();
  if (store.installedModels.includes(model)) {
    if (useAfterDownload) selectInstalledGemmaModel(model);
    return;
  }
  const revision = useAiStore.getState().selectionRevision;
  const initial = useAiStore.getState();
  const selection = { provider: initial.provider, baseUrl: initial.baseUrl, model: initial.model, enabled: initial.enabled };
  const id = crypto.randomUUID();
  useModelDownloadStore.setState({ download: { id, model, status: 'active', progress: null, useAfterDownload, error: '', cancelRequested: false, autoSelected: false } });
  const update = (values: Partial<ModelDownload>) => useModelDownloadStore.setState(state => state.download?.id === id ? { download: { ...state.download, ...values } } : state);
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<ModelDownloadProgress>('gemma-model-download-progress', event => applyDownloadProgress(event.payload));
    if (useModelDownloadStore.getState().download?.cancelRequested) { update({ status: 'cancelled' }); return; }
    await invoke(importPath ? 'import_gemma_model' : 'download_gemma_model', { model, downloadId: id, ...(importPath ? { path: importPath } : {}) });
    // The command confirms the install; a completion event alone does not terminate the job.
    update({ status: 'completed' });
    invalidateAiDiscovery({ provider: 'gemma', model: '' });
    await refreshInstalledModels(true);
    await loadLocalAiEnvironment(true);
    if (useAiStore.getState().provider === 'gemma') await checkAiConnection();
    const current = useAiStore.getState();
    if (useModelDownloadStore.getState().download?.id === id && useAfterDownload && current.selectionRevision === revision && Object.entries(selection).every(([key, value]) => current[key as keyof typeof selection] === value)) {
      selectInstalledGemmaModel(model);
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
  try { await invoke('cancel_gemma_model_download', { downloadId: download.id }); }
  catch (error) { useModelDownloadStore.setState(state => state.download?.id === download.id ? { download: { ...state.download, cancelRequested: false, error: String(error) } } : state); }
}

let activityInitialization: Promise<void> | undefined;
export function initializeLocalActivity(): Promise<void> {
  if (activityInitialization) return activityInitialization;
  const apply = (next: DownloadState['activity']) => {
    if (next) useModelDownloadStore.setState(state => !state.activity || next.sequence >= state.activity.sequence ? { activity: next } : {});
  };
  activityInitialization = (async () => {
    const stop = await listen<NonNullable<DownloadState['activity']>>('gemma-local-activity', event => apply(event.payload));
    let stopRuntime: (() => void) | undefined;
    try {
      stopRuntime = await listen<RuntimeStatus>('gemma-runtime-status', event => useModelDownloadStore.setState(state => state.environment ? { environment: { ...state.environment, runtimeStatus: event.payload } } : {}));
      apply(await invoke<DownloadState['activity']>('get_local_gemma_activity'));
    }
    catch (error) { stop(); stopRuntime?.(); throw error; }
  })().catch(() => { activityInitialization = undefined; });
  return activityInitialization;
}
export function localModelOperationsBusy(): boolean {
  const { activity, deletion, download } = useModelDownloadStore.getState();
  return Boolean(deletion || download?.status === 'active' || activity && (activity.generations > 0 || activity.pulling || activity.deleting));
}
export async function deleteGemmaModel(model: string): Promise<{ alreadyAbsent: boolean } | null> {
  if (localModelOperationsBusy()) return null;
  useModelDownloadStore.setState({ deletion: { model }, deleteError: '', deleteFailure: null });
  try {
    const result = await invoke<{ alreadyAbsent: boolean }>('delete_gemma_model', { model });
    // Clear only the still-matching local profile, never another provider or a new selection.
    useAiStore.setState(state => {
      const profile = state.profiles.gemma;
      if (profile.model !== model) return {};
      const profiles = { ...state.profiles, gemma: { ...profile, model: '' } };
      return { profiles, ...(state.provider === 'gemma' ? { model: '' } : {}), selectionRevision: state.selectionRevision + 1 };
    });
    invalidateAiDiscovery({ provider: 'gemma', model: '' });
    await refreshInstalledModels(true);
    await loadLocalAiEnvironment(true);
    if (useAiStore.getState().provider === 'gemma') await checkAiConnection();
    return result;
  } catch (error) {
    useModelDownloadStore.setState({ deleteError: String(error), deleteFailure: { model } });
    invalidateAiDiscovery({ provider: 'gemma', model: '' });
    await refreshInstalledModels(true);
    await loadLocalAiEnvironment(true);
    if (useAiStore.getState().provider === 'gemma') await checkAiConnection();
    return null;
  } finally { useModelDownloadStore.setState({ deletion: null }); }
}
