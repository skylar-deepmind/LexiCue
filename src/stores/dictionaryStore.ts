import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface DictionarySourceStatus { name: string; language: string; state: 'pending' | 'running' | 'ready' | 'failed'; processedRows: number; error: string | null }
export interface DictionarySnapshot { runId: number; sequence: number; state: 'idle' | 'running' | 'ready' | 'failed'; currentSource: string | null; sources: DictionarySourceStatus[] }
interface DictionaryStore { ready: boolean; snapshot: DictionarySnapshot | null; error: string; initialize: () => Promise<void>; retry: () => Promise<void> }
let initialization: Promise<void> | undefined;
let subscribed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  clearTimeout(timer);
  if (!useDictionaryStore.getState().snapshot || ['idle', 'running'].includes(useDictionaryStore.getState().snapshot!.state)) timer = setTimeout(() => { void (subscribed ? synchronize() : useDictionaryStore.getState().initialize()); }, 2000);
}
export function applyDictionarySnapshot(next: DictionarySnapshot) {
  if (!next || !Array.isArray(next.sources)) return;
  useDictionaryStore.setState(current => {
    const old = current.snapshot;
    if (old && (next.runId < old.runId || next.runId === old.runId && next.sequence < old.sequence)) return {};
    return { snapshot: next, ready: next.state === 'ready', error: '' };
  });
  schedule();
}
async function synchronize() {
  try { applyDictionarySnapshot(await invoke<DictionarySnapshot>('dictionary_init_status')); }
  catch (error) { useDictionaryStore.setState({ error: String(error) }); }
  schedule();
}
export function dictionaryLanguageState(state: Pick<DictionaryStore, 'snapshot' | 'ready'>, language: string): string {
  return state.snapshot?.sources.filter(s => s.language === language).map(s => `${s.name}:${s.state}`).join('|') ?? String(state.ready);
}
export const useDictionaryStore = create<DictionaryStore>(() => ({
  ready: false, snapshot: null, error: '',
  initialize: async () => {
    if (initialization) return initialization;
    initialization = (async () => {
      if (!subscribed) {
        await listen<DictionarySnapshot>('dictionary-init-progress', event => applyDictionarySnapshot(event.payload));
        subscribed = true;
        const foreground = () => { if (document.visibilityState === 'visible') void synchronize(); };
        document.addEventListener('visibilitychange', foreground);
        window.addEventListener('focus', () => { void synchronize(); });
      }
      await synchronize();
    })().catch(error => { useDictionaryStore.setState({ error: String(error) }); schedule(); })
      .finally(() => { initialization = undefined; });
    return initialization;
  },
  retry: async () => {
    await useDictionaryStore.getState().initialize();
    try { applyDictionarySnapshot(await invoke<DictionarySnapshot>('retry_dictionary_init')); }
    catch (error) { useDictionaryStore.setState({ error: String(error) }); }
  },
}));
