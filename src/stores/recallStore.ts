import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
let request = 0;
export const useRecallStore = create<{
  expressions: string[]; revision: number; loaded: boolean; loading: boolean; error: boolean;
  refresh: () => Promise<void>;
}>((set) => ({
  expressions: [], revision: 0, loaded: false, loading: false, error: false,
  refresh: async () => {
    const current = ++request;
    set({ loading: true, error: false });
    try {
      const expressions = await invoke<string[]>('saved_recall_index');
      if (current === request) set(state => ({ expressions, revision: state.revision + 1, loaded: true }));
    } catch {
      // Fail closed on stale hints after a removal, without blocking reading.
      if (current === request) set(state => ({ error: true, expressions: [], loaded: false, revision: state.revision + 1 }));
    } finally { if (current === request) set({ loading: false }); }
  },
}));
