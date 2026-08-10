import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Segment } from '../lib/types';
import type { Language } from '../lib/languages';

interface WordStatusInfo {
  id: number;
  lemma: string;
  status: string;
}

export interface SegmentPhrase {
  phrase_id: number;
  text: string;
  status: string;
  definition: string | null;
  source: string;
  position: number;
  segment_index: number;
  word_count: number;
}

export interface SegmentToken {
  segment_index: number;
  surface: string;
  lemma: string;
  position: number;
}

interface ReaderStore {
  currentFileId: number | null;
  currentLanguage: Language;
  segments: Segment[];
  wordStatusMap: Map<string, WordStatusInfo>;
  phraseMap: Map<number, SegmentPhrase[]>;
  segmentTokens: Map<number, SegmentToken[]>;
  activeSegmentIndex: number;
  loading: boolean;
  setFile: (fileId: number) => Promise<void>;
  setActiveSegmentIndex: (index: number) => void;
}

export const useReaderStore = create<ReaderStore>((set) => ({
  currentFileId: null,
  currentLanguage: 'en',
  segments: [],
  wordStatusMap: new Map(),
  phraseMap: new Map(),
  segmentTokens: new Map(),
  activeSegmentIndex: 0,
  loading: false,
  setActiveSegmentIndex: (index) => set((state) => ({
    activeSegmentIndex: Math.min(
      Math.max(0, index),
      Math.max(0, state.segments.length - 1),
    ),
  })),

  setFile: async (fileId: number) => {
    set({ loading: true });
    try {
      const segments: Segment[] = await invoke('get_file_segments', { fileId });
      const files: { id: number; language: Language }[] = await invoke('list_files');
      const currentLanguage = files.find((file) => file.id === fileId)?.language ?? 'en';

      const allWords: WordStatusInfo[] = await invoke('list_words', {
        statusFilter: null,
        sortBy: 'frequency',
        language: currentLanguage,
      });
      const wordMap = new Map<string, WordStatusInfo>();
      for (const w of allWords) {
        wordMap.set(w.lemma, w);
      }
      const fileTokens: { original_form: string; lemma: string; id: number; status: string }[] = await invoke('list_file_word_tokens', { fileId });
      for (const token of fileTokens) {
        wordMap.set(token.original_form, { id: token.id, lemma: token.lemma, status: token.status });
      }

      const phrases: SegmentPhrase[] = await invoke('get_file_phrases', { fileId });
      const phraseMap = new Map<number, SegmentPhrase[]>();
      for (const ph of phrases) {
        const list = phraseMap.get(ph.segment_index) ?? [];
        list.push(ph);
        phraseMap.set(ph.segment_index, list);
      }

      let segTokens: Map<number, SegmentToken[]> = new Map();
      if (currentLanguage === 'en' || currentLanguage === 'ja' || currentLanguage === 'de' || currentLanguage === 'zh') {
        const raw: SegmentToken[] = await invoke('get_file_segment_tokens', { fileId });
        for (const t of raw) {
          const list = segTokens.get(t.segment_index) ?? [];
          list.push(t);
          segTokens.set(t.segment_index, list);
        }
      }

      set({
        currentFileId: fileId,
        currentLanguage,
        segments,
        wordStatusMap: wordMap,
        phraseMap,
        segmentTokens: segTokens,
        activeSegmentIndex: 0,
      });
    } catch (e) {
      console.error('Failed to load segments:', e);
    } finally {
      set({ loading: false });
    }
  },
}));
