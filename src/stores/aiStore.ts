import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AiProvider = 'ollama' | 'openai';
export type AiConnectionStatus = 'idle' | 'checking' | 'ready' | 'error';
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export interface AiPreset { key?: 'custom'; label: string; baseUrl: string }
export const OPENAI_PRESETS: AiPreset[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { label: 'OpenCode', baseUrl: 'https://opencode.ai/zen/go/v1' },
  { key: 'custom', label: 'Custom', baseUrl: '' },
];
export interface AiModelInfo { name: string; size?: number | null; digest?: string | null; modifiedAt?: string | null }
export interface AiProfile { baseUrl: string; model: string; apiKey: string }
export type AiProfiles = Record<AiProvider, AiProfile>;
const normalize = (url: string) => url.trim().replace(/\/+$/, '');
const emptyProfiles = (): AiProfiles => ({
  ollama: { baseUrl: DEFAULT_OLLAMA_URL, model: '', apiKey: '' },
  openai: { baseUrl: OPENAI_PRESETS[0].baseUrl, model: '', apiKey: '' },
});

/** Pure migration: keep ambiguous custom endpoints, repair known cloud URLs in the local tab. */
export function migrateAiSettings(value: unknown, legacy?: { baseUrl: string | null; model: string | null }) {
  const saved = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const profiles = emptyProfiles();
  const apiKeys = { ...((saved.apiKeys && typeof saved.apiKeys === 'object' ? saved.apiKeys : {}) as Record<string, string>) };
  const provider: AiProvider = saved.provider === 'openai' ? 'openai' : 'ollama';
  if (saved.profiles && typeof saved.profiles === 'object') {
    for (const name of ['ollama', 'openai'] as const) {
      const profile = (saved.profiles as Partial<AiProfiles>)[name];
      if (profile) profiles[name] = { baseUrl: typeof profile.baseUrl === 'string' ? profile.baseUrl : profiles[name].baseUrl, model: typeof profile.model === 'string' ? profile.model : '', apiKey: name === 'openai' && typeof profile.apiKey === 'string' ? profile.apiKey : '' };
    }
  } else {
    const baseUrl = typeof saved.baseUrl === 'string' ? saved.baseUrl : legacy?.baseUrl ?? DEFAULT_OLLAMA_URL;
    const model = typeof saved.model === 'string' ? saved.model : legacy?.model ?? '';
    const apiKey = typeof saved.apiKey === 'string' ? saved.apiKey : apiKeys[normalize(baseUrl)] ?? '';
    const knownCloud = OPENAI_PRESETS.some(p => p.baseUrl && normalize(p.baseUrl) === normalize(baseUrl));
    const owner = knownCloud ? 'openai' : provider;
    profiles[owner] = { baseUrl, model, apiKey: owner === 'openai' ? apiKey : '' };
    if (apiKey) apiKeys[normalize(baseUrl)] = apiKey;
  }
  const active = profiles[provider];
  return { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : Boolean(legacy?.baseUrl || legacy?.model), provider, profiles, apiKeys, ...active };
}

interface AiState {
  enabled: boolean; provider: AiProvider; baseUrl: string; model: string; apiKey: string;
  profiles: AiProfiles; apiKeys: Record<string, string>; selectionRevision: number;
  aiStatus: AiConnectionStatus; aiModels: string[]; aiModelInfo: AiModelInfo[]; aiError: string; aiFingerprint: string;
  setEnabled: (enabled: boolean) => void; setProvider: (provider: AiProvider) => void;
  setBaseUrl: (url: string) => void; setModel: (model: string) => void; setApiKey: (key: string) => void;
  selectBaseUrl: (url: string) => void; setAiStatus: (status: AiConnectionStatus) => void;
  setAiModels: (models: string[]) => void; setAiError: (error: string) => void;
  setAiFingerprint: (fingerprint: string) => void; resetAiCheck: () => void;
}
const idle = { aiStatus: 'idle' as const, aiModels: [] as string[], aiModelInfo: [] as AiModelInfo[], aiError: '', aiFingerprint: '' };
function changeProfile(state: AiState, update: Partial<AiProfile>) {
  const profile = { baseUrl: state.baseUrl, model: state.model, apiKey: state.provider === 'openai' ? state.apiKey : '', ...update };
  const changed = profile.baseUrl !== state.baseUrl || profile.model !== state.model || profile.apiKey !== state.apiKey;
  return { ...profile, profiles: { ...state.profiles, [state.provider]: profile }, selectionRevision: state.selectionRevision + Number(changed) };
}
export const useAiStore = create<AiState>()(persist((set) => ({
  enabled: false, provider: 'ollama', ...emptyProfiles().ollama,
  profiles: emptyProfiles(), apiKeys: {}, selectionRevision: 0, ...idle,
  setEnabled: enabled => set(state => ({ enabled, selectionRevision: state.selectionRevision + Number(enabled !== state.enabled) })),
  setProvider: provider => set(state => {
    if (state.provider === provider) return state;
    const profiles = { ...state.profiles, [state.provider]: { baseUrl: state.baseUrl, model: state.model, apiKey: state.provider === 'openai' ? state.apiKey : '' } };
    return { provider, profiles, ...profiles[provider], ...idle, selectionRevision: state.selectionRevision + 1 };
  }),
  setBaseUrl: baseUrl => set(state => ({ ...changeProfile(state, { baseUrl, apiKey: state.provider === 'openai' ? state.apiKeys[normalize(baseUrl)] ?? '' : '' }), ...(baseUrl !== state.baseUrl ? idle : {}) })),
  selectBaseUrl: baseUrl => set(state => ({ ...changeProfile(state, { baseUrl, apiKey: state.provider === 'openai' ? state.apiKeys[normalize(baseUrl)] ?? '' : '' }), ...idle })),
  setModel: model => set(state => changeProfile(state, { model })),
  setApiKey: apiKey => set(state => state.provider === 'openai' ? { ...changeProfile(state, { apiKey }), apiKeys: { ...state.apiKeys, [normalize(state.baseUrl)]: apiKey }, ...idle } : {}),
  setAiStatus: aiStatus => set({ aiStatus }), setAiModels: aiModels => set({ aiModels }),
  setAiError: aiError => set({ aiError }), setAiFingerprint: aiFingerprint => set({ aiFingerprint }),
  resetAiCheck: () => set(idle),
}), {
  name: 'lexicue-ai', version: 1, storage: createJSONStorage(() => localStorage),
  partialize: state => ({ enabled: state.enabled, provider: state.provider, profiles: state.profiles, apiKeys: state.apiKeys }),
  migrate: persisted => migrateAiSettings(persisted),
  merge: (persisted, current) => {
    const legacy = { baseUrl: localStorage.getItem('lexicue.ollama.baseUrl'), model: localStorage.getItem('lexicue.ollama.model') };
    const restored = migrateAiSettings(persisted, legacy);
    if (legacy.baseUrl || legacy.model) { localStorage.removeItem('lexicue.ollama.baseUrl'); localStorage.removeItem('lexicue.ollama.model'); }
    return { ...current, ...restored, ...idle, selectionRevision: 0 };
  },
}));
