import { useAiStore, DEFAULT_OLLAMA_URL, type AiProvider } from '../stores/aiStore';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export function getAiConfig(): AiConfig {
  const { provider, baseUrl, model, apiKey } = useAiStore.getState();
  return {
    provider,
    baseUrl: baseUrl.trim() || DEFAULT_OLLAMA_URL,
    model,
    apiKey,
  };
}

export function isAiEnabled(): boolean {
  return useAiStore.getState().enabled;
}
