import { useAiStore, type AiProvider, type AiModelInfo } from '../stores/aiStore';
import { invoke } from '@tauri-apps/api/core';

export interface AiConfig {
  provider: AiProvider;
  baseUrl?: string;
  model: string;
  apiKey?: string;
}

export function getAiConfig(): AiConfig {
  const { provider, baseUrl, model, apiKey } = useAiStore.getState();
  return {
    provider,
    baseUrl: provider === 'openai' ? baseUrl.trim() : undefined,
    model,
    apiKey: provider === 'openai' ? apiKey : undefined,
  };
}

export function isAiEnabled(): boolean {
  return useAiStore.getState().enabled;
}

export function getAiConnectionFingerprint(config = getAiConfig()): string {
  return JSON.stringify({ provider: config.provider, baseUrl: config.provider === 'openai' ? config.baseUrl : undefined, apiKey: config.provider === 'openai' ? config.apiKey : undefined });
}

let connectionCheck = 0;
const discoveryVersions = new Map<string, number>();
let inFlight: { fingerprint: string; promise: Promise<void> } | undefined;
let lastSuccess: { fingerprint: string; at: number } | undefined;

/** Auto discovery never generates text and shares pending checks across mounted views. */
export function ensureAiConnection(): Promise<void> {
  const state = useAiStore.getState();
  if (!state.enabled || state.provider !== 'gemma') return Promise.resolve();
  return checkAiConnection(false);
}

/** Share connection/model discovery between Settings and the home-page picker. */
export function checkAiConnection(force = true): Promise<void> {
  const fingerprint = getAiConnectionFingerprint();
  if (inFlight?.fingerprint === fingerprint) return inFlight.promise;
  const state = useAiStore.getState();
  if (!force && lastSuccess?.fingerprint === fingerprint && Date.now() - lastSuccess.at < 60_000 && state.aiStatus === 'ready' && state.aiFingerprint === fingerprint && !state.aiError) return Promise.resolve();
  const promise = discoverAiConnection().finally(() => { if (inFlight?.promise === promise) inFlight = undefined; });
  inFlight = { fingerprint, promise };
  return promise;
}

async function discoverAiConnection(): Promise<void> {
  const attempt = ++connectionCheck;
  const config = getAiConfig();
  if (config.provider === 'gemma') config.apiKey = undefined;
  const fingerprint = getAiConnectionFingerprint(config);
  const version = discoveryVersions.get(fingerprint) ?? 0;
  useAiStore.setState({ aiStatus: 'checking', aiError: '', aiFingerprint: fingerprint });
  const isCurrent = () => attempt === connectionCheck && getAiConnectionFingerprint() === fingerprint && version === (discoveryVersions.get(fingerprint) ?? 0);
  try {
    await invoke('ai_status', { config });
    if (!isCurrent()) return;
    try {
      const models = await invoke<AiModelInfo[]>('ai_models', { config });
      if (!isCurrent()) return;
      useAiStore.setState({ aiModelInfo: models, aiModels: [...new Set(models.map(item => item.name).filter(Boolean))], aiStatus: 'ready' });
      lastSuccess = { fingerprint, at: Date.now() };
    } catch (error) {
      if (isCurrent()) useAiStore.setState({ aiModels: [], aiStatus: 'ready', aiError: String(error) });
    }
  } catch (error) {
    if (isCurrent()) useAiStore.setState({ aiModels: [], aiStatus: 'error', aiError: String(error) });
  }
}

/** Invalidate both pending and successful discovery after install/delete. */
export function invalidateAiDiscovery(config = getAiConfig()): void {
  const fingerprint = getAiConnectionFingerprint(config);
  discoveryVersions.set(fingerprint, (discoveryVersions.get(fingerprint) ?? 0) + 1);
  if (inFlight?.fingerprint === fingerprint) inFlight = undefined;
  if (lastSuccess?.fingerprint === fingerprint) lastSuccess = undefined;
  if (getAiConnectionFingerprint() === fingerprint) useAiStore.getState().resetAiCheck();
}

export function aiModelLabel(model: string): string {
  const match = /^gemma4-(e2b|e4b)-(litert|gguf)-/.exec(model);
  return match ? `Gemma 4 ${match[1].toUpperCase()}` : model;
}
