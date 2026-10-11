import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AiProvider = 'gemma' | 'openai';
export type AiConnectionStatus = 'idle' | 'checking' | 'ready' | 'error';
export interface AiPreset { key?: 'custom'; label: string; baseUrl: string }
export const OPENAI_PRESETS: AiPreset[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { label: 'OpenCode', baseUrl: 'https://opencode.ai/zen/go/v1' },
  { key: 'custom', label: 'Custom', baseUrl: '' },
];
export interface AiModelInfo { name: string; size?: number | null; digest?: string | null; modifiedAt?: string | null }
export interface AiProfile { baseUrl: string; model: string; apiKey: string }
export interface AiProfiles { gemma: { model: string }; openai: AiProfile }
const normalize = (url: string) => url.trim().replace(/\/+$/, '');
const emptyProfiles = (): AiProfiles => ({
  gemma: { model: '' },
  openai: { baseUrl: OPENAI_PRESETS[0].baseUrl, model: '', apiKey: '' },
});

/** Legacy local selections become pending installation; cloud credentials survive. */
export function migrateAiSettings(value: unknown, legacy?: { baseUrl: string | null; model: string | null }) {
  const saved = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const profiles = emptyProfiles();
  const apiKeys = { ...((saved.apiKeys && typeof saved.apiKeys === 'object' ? saved.apiKeys : {}) as Record<string, string>) };
  const provider: AiProvider = saved.provider === 'openai' ? 'openai' : 'gemma';
  const stored = saved.profiles as Partial<AiProfiles> | undefined;
  if (stored?.openai) profiles.openai = { baseUrl: typeof stored.openai.baseUrl === 'string' ? stored.openai.baseUrl : profiles.openai.baseUrl, model: typeof stored.openai.model === 'string' ? stored.openai.model : '', apiKey: typeof stored.openai.apiKey === 'string' ? stored.openai.apiKey : '' };
  if (typeof stored?.gemma?.model === 'string') profiles.gemma.model = stored.gemma.model;
  if (!stored) {
    const baseUrl = typeof saved.baseUrl === 'string' ? saved.baseUrl : legacy?.baseUrl ?? '';
    const knownCloud = OPENAI_PRESETS.some(p => p.baseUrl && normalize(p.baseUrl) === normalize(baseUrl));
    if (provider === 'openai' || knownCloud) {
      profiles.openai = { baseUrl: baseUrl || profiles.openai.baseUrl, model: typeof saved.model === 'string' ? saved.model : legacy?.model ?? '', apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : apiKeys[normalize(baseUrl)] ?? '' };
      if (profiles.openai.apiKey) apiKeys[normalize(baseUrl)] = profiles.openai.apiKey;
    }
  }
  const active = provider === 'openai' ? profiles.openai : { model: profiles.gemma.model, baseUrl: '', apiKey: '' };
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
  const profile = { baseUrl: state.baseUrl, model: state.model, apiKey: state.apiKey, ...update };
  const changed = profile.baseUrl !== state.baseUrl || profile.model !== state.model || profile.apiKey !== state.apiKey;
  return { ...profile, profiles: { ...state.profiles, [state.provider]: state.provider === 'gemma' ? { model: profile.model } : profile }, selectionRevision: state.selectionRevision + Number(changed) };
}
export const useAiStore = create<AiState>()(persist((set) => ({
  enabled: false, provider: 'gemma', baseUrl: '', model: '', apiKey: '',
  profiles: emptyProfiles(), apiKeys: {}, selectionRevision: 0, ...idle,
  setEnabled: enabled => set(state => ({ enabled, selectionRevision: state.selectionRevision + Number(enabled !== state.enabled) })),
  setProvider: provider => set(state => {
    if (state.provider === provider) return state;
    const profiles = { ...state.profiles, [state.provider]: state.provider === 'gemma' ? { model: state.model } : { baseUrl: state.baseUrl, model: state.model, apiKey: state.apiKey } };
    return { provider, profiles, ...(provider === 'gemma' ? { model: profiles.gemma.model, baseUrl: '', apiKey: '' } : profiles.openai), ...idle, selectionRevision: state.selectionRevision + 1 };
  }),
  setBaseUrl: baseUrl => set(state => state.provider === 'gemma' ? {} : ({ ...changeProfile(state, { baseUrl, apiKey: state.provider === 'openai' ? state.apiKeys[normalize(baseUrl)] ?? '' : '' }), ...(baseUrl !== state.baseUrl ? idle : {}) })),
  selectBaseUrl: baseUrl => set(state => state.provider === 'gemma' ? {} : ({ ...changeProfile(state, { baseUrl, apiKey: state.provider === 'openai' ? state.apiKeys[normalize(baseUrl)] ?? '' : '' }), ...idle })),
  setModel: model => set(state => changeProfile(state, { model })),
  setApiKey: apiKey => set(state => state.provider === 'openai' ? { ...changeProfile(state, { apiKey }), apiKeys: { ...state.apiKeys, [normalize(state.baseUrl)]: apiKey }, ...idle } : {}),
  setAiStatus: aiStatus => set({ aiStatus }), setAiModels: aiModels => set({ aiModels }),
  setAiError: aiError => set({ aiError }), setAiFingerprint: aiFingerprint => set({ aiFingerprint }),
  resetAiCheck: () => set(idle),
}), {
  name: 'lexicue-ai', version: 2, storage: createJSONStorage(() => localStorage),
  partialize: state => ({ enabled: state.enabled, provider: state.provider, profiles: state.profiles, apiKeys: state.apiKeys }),
  migrate: persisted => migrateAiSettings(persisted),
  merge: (persisted, current) => {
    const legacy = { baseUrl: localStorage.getItem('lexicue.ollama.baseUrl'), model: localStorage.getItem('lexicue.ollama.model') };
    const restored = migrateAiSettings(persisted, legacy);
    if (legacy.baseUrl || legacy.model) { localStorage.removeItem('lexicue.ollama.baseUrl'); localStorage.removeItem('lexicue.ollama.model'); }
    return { ...current, ...restored, ...idle, selectionRevision: 0 };
  },
}));
