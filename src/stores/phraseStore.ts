import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { PhraseInfo, PhraseDetail, WordStatus } from '../lib/types';
import { applyStatusUpdates, type RemovedItem } from '../lib/statusList';
import { usePreferencesStore } from './preferencesStore';

interface BatchAction {
  changes: { id: number; status: WordStatus }[];
  removed: RemovedItem<PhraseInfo>[];
}

interface PhraseStore {
  phrases: PhraseInfo[];
  detail: PhraseDetail | null;
  filter: WordStatus | 'all';
  sortBy: 'frequency' | 'alpha' | 'recent';
  selected: Set<number>;
  batchUpdating: boolean;
  lastBatchAction: BatchAction | null;
  loading: boolean;
  detailLoading: boolean;
  detailError: boolean;
  detailErrorId: number | null;
  refreshKey: number;
  loadPhrases: () => Promise<void>;
  loadDetail: (phraseId: number) => Promise<void>;
  closeDetail: () => void;
  setFilter: (f: WordStatus | 'all') => void;
  setSortBy: (s: 'frequency' | 'alpha' | 'recent') => void;
  updateStatus: (phraseId: number, status: WordStatus) => Promise<void>;
  updateDefinition: (phraseId: number, definition: string) => Promise<void>;
  batchUpdateStatus: (status: WordStatus) => Promise<number>;
  undoBatchUpdate: () => Promise<void>;
  toggleSelected: (id: number) => void;
  selectAll: (ids?: number[]) => void;
  clearSelection: () => void;
}

export const usePhraseStore = create<PhraseStore>((set, get) => ({
  phrases: [],
  detail: null,
  filter: 'unprocessed',
  sortBy: 'frequency',
  selected: new Set(),
  batchUpdating: false,
  lastBatchAction: null,
  loading: false,
  detailLoading: false,
  detailError: false,
  detailErrorId: null,
  refreshKey: 0,

  loadPhrases: async () => {
    const { filter, sortBy } = get();
    const language = usePreferencesStore.getState().language;
    set({ loading: true });
    try {
      const phrases: PhraseInfo[] = await invoke('list_phrases', {
        statusFilter: filter === 'all' ? null : filter,
        sortBy,
        language: language === 'all' ? null : language,
      });
      set({ phrases, refreshKey: get().refreshKey + 1 });
    } catch (e) {
      console.error('Failed to load phrases:', e);
    } finally {
      set({ loading: false });
    }
  },

  loadDetail: async (phraseId: number) => {
    set({ detailLoading: true, detailError: false, detailErrorId: phraseId });
    try {
      const detail: PhraseDetail = await invoke('phrase_detail', { phraseId });
      set({ detail, detailError: false, detailErrorId: null });
    } catch (e) {
      console.error('Failed to load phrase detail:', e);
      set({ detail: null, detailError: true });
    } finally {
      set({ detailLoading: false });
    }
  },

  closeDetail: () => set({ detail: null, detailError: false, detailErrorId: null }),

  setFilter: (f) => {
    set({ filter: f, selected: new Set() });
    get().loadPhrases();
  },

  setSortBy: (s) => {
    set({ sortBy: s });
    get().loadPhrases();
  },

  updateStatus: async (phraseId, status) => {
    await invoke('update_phrase_status', { phraseId, status });
    if (status === 'learning') {
      await invoke('create_phrase_review_card', { phraseId });
    }
    const result = applyStatusUpdates(get().phrases, [{ id: phraseId, status }], get().filter);
    const keptIds = new Set(result.words.map((p) => p.id));
    set({
      phrases: result.words,
      selected: new Set(Array.from(get().selected).filter((id) => keptIds.has(id))),
      lastBatchAction: null,
    });
    const { detail } = get();
    if (detail && detail.phrase.id === phraseId) {
      get().loadDetail(phraseId);
    }
  },

  updateDefinition: async (phraseId, definition) => {
    await invoke('update_phrase_definition', { phraseId, definition });
    const { detail } = get();
    if (detail && detail.phrase.id === phraseId) {
      get().loadDetail(phraseId);
    }
    await get().loadPhrases();
  },

  batchUpdateStatus: async (status) => {
    const { selected } = get();
    if (selected.size === 0) return 0;
    const changes = get().phrases
      .filter((phrase) => selected.has(phrase.id))
      .map((phrase) => ({ id: phrase.id, status: phrase.status }));
    if (changes.length === 0) return 0;
    set({ batchUpdating: true });
    try {
      await invoke('batch_update_phrase_status', {
        phraseIds: Array.from(selected),
        status,
      });
      if (status === 'learning') {
        await Promise.all(
          Array.from(selected).map((phraseId) => invoke('create_phrase_review_card', { phraseId })),
        );
      }
      const result = applyStatusUpdates(
        get().phrases,
        changes.map((c) => ({ id: c.id, status })),
        get().filter,
      );
      set({
        phrases: result.words,
        selected: new Set(),
        lastBatchAction: { changes, removed: result.removed },
      });
      return changes.length;
    } finally {
      set({ batchUpdating: false });
    }
  },

  undoBatchUpdate: async () => {
    const action = get().lastBatchAction;
    if (!action || action.changes.length === 0) return;
    set({ batchUpdating: true });
    try {
      const grouped = new Map<WordStatus, number[]>();
      for (const change of action.changes) {
        const ids = grouped.get(change.status) ?? [];
        ids.push(change.id);
        grouped.set(change.status, ids);
      }
      for (const [status, ids] of grouped) {
        await invoke('batch_update_phrase_status', { phraseIds: ids, status });
      }
      let phrases = applyStatusUpdates(get().phrases, action.changes, 'all').words;
      const removed = [...action.removed].sort((a, b) => a.index - b.index);
      for (const r of removed) {
        phrases.splice(Math.min(r.index, phrases.length), 0, r.item);
      }
      set({
        phrases,
        lastBatchAction: null,
        refreshKey: get().refreshKey + 1,
      });
    } finally {
      set({ batchUpdating: false });
    }
  },

  toggleSelected: (id) => {
    const next = new Set(get().selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ selected: next });
  },

  selectAll: (ids) => {
    set({ selected: new Set(ids ?? get().phrases.map(p => p.id)) });
  },

  clearSelection: () => set({ selected: new Set() }),
}));

usePreferencesStore.subscribe(
  (state) => state.language,
  () => {
    const store = usePhraseStore.getState();
    store.clearSelection();
    usePhraseStore.setState({ detail: null, detailError: false, detailErrorId: null });
    store.loadPhrases();
  },
);
