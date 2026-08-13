import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { WordInfo, WordDetail, WordStatus } from '../lib/types';
import { applyStatusUpdates, type RemovedItem } from '../lib/statusList';
import { usePreferencesStore } from './preferencesStore';

interface BatchAction {
  changes: { id: number; status: WordStatus }[];
  removed: RemovedItem<WordInfo>[];
}

interface WordStore {
  words: WordInfo[];
  detail: WordDetail | null;
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
  loadWords: () => Promise<void>;
  loadDetail: (wordId: number) => Promise<void>;
  closeDetail: () => void;
  setFilter: (f: WordStatus | 'all') => void;
  setSortBy: (s: 'frequency' | 'alpha' | 'recent') => void;
  updateStatus: (wordId: number, status: WordStatus) => Promise<void>;
  updateDefinition: (wordId: number, definition: string) => Promise<void>;
  batchUpdateStatus: (status: WordStatus) => Promise<number>;
  undoBatchUpdate: () => Promise<void>;
  toggleSelected: (id: number) => void;
  selectAll: (ids?: number[]) => void;
  clearSelection: () => void;
}

export const useWordStore = create<WordStore>((set, get) => ({
  words: [],
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

  loadWords: async () => {
    const { filter, sortBy } = get();
    const language = usePreferencesStore.getState().language;
    set({ loading: true });
    try {
      const words: WordInfo[] = await invoke('list_words', {
        statusFilter: filter === 'all' ? null : filter,
        sortBy,
        language: language === 'all' ? null : language,
      });
      set({ words, refreshKey: get().refreshKey + 1 });
    } catch (e) {
      console.error('Failed to load words:', e);
    } finally {
      set({ loading: false });
    }
  },

  loadDetail: async (wordId: number) => {
    set({ detailLoading: true, detailError: false, detailErrorId: wordId });
    try {
      const detail: WordDetail = await invoke('word_detail', { wordId });
      set({ detail, detailError: false, detailErrorId: null });
    } catch (e) {
      console.error('Failed to load word detail:', e);
      set({ detail: null, detailError: true });
    } finally {
      set({ detailLoading: false });
    }
  },

  closeDetail: () => set({ detail: null, detailError: false, detailErrorId: null }),

  setFilter: (f) => {
    set({ filter: f, selected: new Set() });
    get().loadWords();
  },

  setSortBy: (s) => {
    set({ sortBy: s });
    get().loadWords();
  },

  updateStatus: async (wordId, status) => {
    await invoke('update_word_status', { wordId, status });
    if (status === 'learning') {
      await invoke('create_review_card', { wordId });
    }
    const result = applyStatusUpdates(get().words, [{ id: wordId, status }], get().filter);
    const keptIds = new Set(result.words.map((w) => w.id));
    set({
      words: result.words,
      selected: new Set(Array.from(get().selected).filter((id) => keptIds.has(id))),
      lastBatchAction: null,
    });
    const { detail } = get();
    if (detail && detail.word.id === wordId) {
      get().loadDetail(wordId);
    }
  },

  updateDefinition: async (wordId, definition) => {
    await invoke('update_word_definition', { wordId, definition });
    const { detail } = get();
    if (detail && detail.word.id === wordId) {
      get().loadDetail(wordId);
    }
    await get().loadWords();
  },

  batchUpdateStatus: async (status) => {
    const { selected } = get();
    if (selected.size === 0) return 0;
    const changes = get().words
      .filter((word) => selected.has(word.id))
      .map((word) => ({ id: word.id, status: word.status }));
    if (changes.length === 0) return 0;
    set({ batchUpdating: true });
    try {
      await invoke('batch_update_status', {
        wordIds: Array.from(selected),
        status,
      });
      if (status === 'learning') {
        await Promise.all(
          Array.from(selected).map((wordId) => invoke('create_review_card', { wordId })),
        );
      }
      const result = applyStatusUpdates(
        get().words,
        changes.map((c) => ({ id: c.id, status })),
        get().filter,
      );
      set({
        words: result.words,
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
        await invoke('batch_update_status', { wordIds: ids, status });
      }
      let words = applyStatusUpdates(get().words, action.changes, 'all').words;
      const removed = [...action.removed].sort((a, b) => a.index - b.index);
      for (const r of removed) {
        words.splice(Math.min(r.index, words.length), 0, r.item);
      }
      set({
        words,
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
    set({ selected: new Set(ids ?? get().words.map(w => w.id)) });
  },

  clearSelection: () => set({ selected: new Set() }),
}));

usePreferencesStore.subscribe(
  (state) => state.language,
  () => {
    const store = useWordStore.getState();
    store.clearSelection();
    useWordStore.setState({ detail: null, detailError: false, detailErrorId: null });
    store.loadWords();
  },
);
