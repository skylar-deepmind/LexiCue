import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface DictionaryStore {
  ready: boolean;
  initialize: () => Promise<void>;
}

let initialized = false;

export const useDictionaryStore = create<DictionaryStore>((set) => ({
  ready: false,

  initialize: async () => {
    if (initialized) return;
    initialized = true;
    try {
      set({ ready: await invoke<boolean>('dictionary_status') });
    } catch {
      // ignore
    }
    await listen<boolean>('dictionary-ready', (e) => {
      set({ ready: e.payload });
    });
  },
}));
