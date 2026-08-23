import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Language } from '../lib/languages';
import { QueryCache } from '../lib/queryCache';
import { registerCacheInvalidator } from '../lib/cacheInvalidation';

export interface DailyReviewStat {
  day_start: number;
  count: number;
}

export interface FileProgress {
  id: number;
  name: string;
  language: string;
  total_words: number;
  unprocessed: number;
  learning: number;
  known: number;
  ignored: number;
  total_phrases: number;
  phrases_unprocessed: number;
  phrases_learning: number;
  phrases_known: number;
  phrases_ignored: number;
  phrase_analyzed: boolean;
}

export interface LearningStats {
  total_words: number;
  unprocessed: number;
  learning: number;
  known: number;
  ignored: number;
  due_cards: number;
  total_reviews: number;
  total_phrases: number;
  phrases_unprocessed: number;
  phrases_learning: number;
  phrases_known: number;
  phrases_ignored: number;
  due_phrase_cards: number;
  total_phrase_reviews: number;
  daily_reviews: DailyReviewStat[];
  files: FileProgress[];
}

interface InsightsStore {
  stats: LearningStats | null;
  loading: boolean;
  error: boolean;
  activeLanguage: Language | 'all';
  load: (language: Language | 'all', force?: boolean) => Promise<void>;
  invalidate: () => void;
}

const statsCache = new QueryCache<LearningStats>(1);
registerCacheInvalidator('insights', () => statsCache.invalidate());

function statsKey(language: Language | 'all'): string {
  return `learning-stats:${language}`;
}

export const useInsightsStore = create<InsightsStore>((set) => ({
  stats: null,
  loading: true,
  error: false,
  activeLanguage: 'all',
  load: async (language, force = false) => {
    const key = statsKey(language);
    const cached = statsCache.peek(key);
    set({ activeLanguage: language });
    if (cached) set({ stats: cached, loading: false, error: false });
    if (!force && statsCache.isFresh(key)) return;
    if (!cached) set({ loading: true, error: false });
    try {
      const stats = await statsCache.fetch(
        key,
        () => invoke<LearningStats>('get_learning_stats', {
          language: language === 'all' ? null : language,
        }),
        force,
      );
      if (useInsightsStore.getState().activeLanguage === language) set({ stats, error: false });
    } catch (reason) {
      console.error('Failed to load learning stats:', reason);
      if (!cached && useInsightsStore.getState().activeLanguage === language) set({ error: true });
    } finally {
      if (useInsightsStore.getState().activeLanguage === language) set({ loading: false });
    }
  },
  invalidate: () => statsCache.invalidate(),
}));
