import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AiProvider = 'ollama' | 'openai';

export type AiConnectionStatus = 'idle' | 'checking' | 'ready' | 'error';

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export interface AiPreset {
  key?: 'custom';
  label: string;
  baseUrl: string;
}

export const OPENAI_PRESETS: AiPreset[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { label: 'OpenCode', baseUrl: 'https://opencode.ai/zen/go/v1' },
  { key: 'custom', label: 'Custom', baseUrl: '' },
];

const LEGACY_BASE_URL_KEY = 'lexicue.ollama.baseUrl';
const LEGACY_MODEL_KEY = 'lexicue.ollama.model';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

interface AiState {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeys: Record<string, string>;
  aiStatus: AiConnectionStatus;
  aiModels: string[];
  aiError: string;
  aiFingerprint: string;
  setEnabled: (enabled: boolean) => void;
  setProvider: (provider: AiProvider) => void;
  setBaseUrl: (baseUrl: string) => void;
  setModel: (model: string) => void;
  setApiKey: (apiKey: string) => void;
  selectBaseUrl: (baseUrl: string) => void;
  setAiStatus: (status: AiConnectionStatus) => void;
  setAiModels: (models: string[]) => void;
  setAiError: (error: string) => void;
  setAiFingerprint: (fingerprint: string) => void;
  resetAiCheck: () => void;
}

type PersistedAi = Partial<Omit<
  AiState,
  | 'setEnabled'
  | 'setProvider'
  | 'setBaseUrl'
  | 'setModel'
  | 'setApiKey'
  | 'selectBaseUrl'
  | 'setAiStatus'
  | 'setAiModels'
  | 'setAiError'
  | 'setAiFingerprint'
  | 'resetAiCheck'
>>;

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      enabled: false,
      provider: 'ollama',
      baseUrl: DEFAULT_OLLAMA_URL,
      model: '',
      apiKey: '',
      apiKeys: {},
      aiStatus: 'idle',
      aiModels: [],
      aiError: '',
      aiFingerprint: '',
      setEnabled: (enabled) => set({ enabled }),
      setProvider: (provider) => set({ provider }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setModel: (model) => set({ model }),
      setApiKey: (apiKey) => set((state) => ({
        apiKey,
        apiKeys: { ...state.apiKeys, [normalizeBaseUrl(state.baseUrl)]: apiKey },
      })),
      selectBaseUrl: (baseUrl) => set((state) => ({
        baseUrl,
        apiKey: state.apiKeys[normalizeBaseUrl(baseUrl)] ?? '',
      })),
      setAiStatus: (status) => set({ aiStatus: status }),
      setAiModels: (models) => set({ aiModels: models }),
      setAiError: (error) => set({ aiError: error }),
      setAiFingerprint: (fingerprint) => set({ aiFingerprint: fingerprint }),
      resetAiCheck: () => set({ aiStatus: 'idle', aiModels: [], aiError: '', aiFingerprint: '' }),
    }),
    {
      name: 'lexicue-ai',
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as PersistedAi;
        const legacyBaseUrl = localStorage.getItem(LEGACY_BASE_URL_KEY);
        const legacyModel = localStorage.getItem(LEGACY_MODEL_KEY);
        const hasLegacy = Boolean(legacyBaseUrl || legacyModel);
        if (hasLegacy) {
          localStorage.removeItem(LEGACY_BASE_URL_KEY);
          localStorage.removeItem(LEGACY_MODEL_KEY);
        }
        const baseUrl = typeof saved.baseUrl === 'string'
          ? saved.baseUrl
          : legacyBaseUrl ?? DEFAULT_OLLAMA_URL;
        const apiKey = typeof saved.apiKey === 'string' ? saved.apiKey : '';
        const apiKeys = saved.apiKeys && typeof saved.apiKeys === 'object'
          ? saved.apiKeys as Record<string, string>
          : (apiKey ? { [normalizeBaseUrl(baseUrl)]: apiKey } : {});
        const savedStatus = saved.aiStatus === 'ready' || saved.aiStatus === 'error'
          ? saved.aiStatus
          : 'idle';
        return {
          ...current,
          ...saved,
          enabled: typeof saved.enabled === 'boolean' ? saved.enabled : hasLegacy,
          provider: saved.provider === 'openai' ? 'openai' : 'ollama',
          baseUrl,
          model: typeof saved.model === 'string' ? saved.model : (legacyModel ?? ''),
          apiKey,
          apiKeys,
          aiStatus: savedStatus,
          aiModels: Array.isArray(saved.aiModels) ? saved.aiModels : [],
          aiError: typeof saved.aiError === 'string' ? saved.aiError : '',
          aiFingerprint: typeof saved.aiFingerprint === 'string' ? saved.aiFingerprint : '',
        };
      },
    },
  ),
);
