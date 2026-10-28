import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
let request = 0;
export interface RecallCatalog { expressions: string[]; case_exclusions: string[]; literal_only: boolean }
export const useRecallStore = create<{
  expressions: string[]; caseExclusions: string[]; literalOnly: boolean; revision: number; loaded: boolean; loading: boolean; error: boolean;
  invalidate: () => void;
  refresh: () => Promise<void>;
}>((set) => ({
  expressions: [], caseExclusions: [], literalOnly: true, revision: 0, loaded: false, loading: false, error: false,
  invalidate: () => {
    ++request;
    set(state => ({ expressions: [], caseExclusions: [], literalOnly: true, loaded: false, loading: false, error: false, revision: state.revision + 1 }));
  },
  refresh: async () => {
    const current = ++request;
    set({ loading: true, error: false });
    try {
      const catalog = await invoke<RecallCatalog>('saved_recall_catalog');
      if (!Array.isArray(catalog?.expressions) || !Array.isArray(catalog.case_exclusions) || typeof catalog.literal_only !== 'boolean'
        || !catalog.expressions.every(item => typeof item === 'string') || !catalog.case_exclusions.every(item => typeof item === 'string')) throw Error('recall_catalog_invalid');
      if (current === request) set(state => ({ expressions: catalog.expressions, caseExclusions: catalog.case_exclusions, literalOnly: catalog.literal_only, revision: state.revision + 1, loaded: true }));
    } catch {
      // Fail closed on stale hints after a removal, without blocking reading.
      if (current === request) set(state => ({ error: true, expressions: [], caseExclusions: [], literalOnly: true, loaded: false, revision: state.revision + 1 }));
    } finally { if (current === request) set({ loading: false }); }
  },
}));
