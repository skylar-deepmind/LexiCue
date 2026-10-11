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
  token_positions: number[] | null;
}

export interface SegmentToken {
  segment_index: number;
  surface: string;
  lemma: string;
  position: number;
}

export interface ReaderToken { segment_index: number; language: Language; surface: string; lemma: string; start: number; end: number; legacy_position?: number | null; builtin_position?: number | null; word_id: number | null; status: string | null }
let fileGeneration = 0;
interface ReaderStore {
  currentFileId: number | null;
  currentLanguage: Language;
  segments: Segment[];
  wordStatusMap: Map<string, WordStatusInfo>;
  phraseMap: Map<number, SegmentPhrase[]>;
  segmentTokens: Map<number, SegmentToken[]>;
  activeSegmentIndex: number;
  readerTokens: Map<number, ReaderToken[]>;
  error: string;
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
  readerTokens: new Map(),
  error: '',
  loading: false,
  setActiveSegmentIndex: (index) => set((state) => ({
    activeSegmentIndex: Math.min(
      Math.max(0, index),
      Math.max(0, state.segments.length - 1),
    ),
  })),

  setFile: async (fileId: number) => {
    const request = ++fileGeneration;
    set({ loading: true, error: '', currentFileId: fileId, segments: [], readerTokens: new Map(), wordStatusMap: new Map(), phraseMap: new Map(), segmentTokens: new Map() });
    try {
      const [segments, file, fileTokens, phrases, raw, fullTokens] = await Promise.all([
        invoke<Segment[]>('get_file_segments', { fileId }),
        invoke<{ language: Language }>('get_file_info', { fileId }),
        invoke<{ original_form: string; lemma: string; id: number; status: string }[]>('list_file_word_tokens', { fileId }),
        invoke<SegmentPhrase[]>('get_file_phrases', { fileId }),
        invoke<SegmentToken[]>('get_file_segment_tokens', { fileId }),
        invoke<ReaderToken[]>('get_file_reader_tokens', { fileId }),
      ]);
      if (request !== fileGeneration) return;
      const currentLanguage = file.language;
      const wordMap = new Map<string, WordStatusInfo>();
      for (const token of fileTokens) {
        wordMap.set(token.lemma, { id: token.id, lemma: token.lemma, status: token.status });
        wordMap.set(token.original_form, { id: token.id, lemma: token.lemma, status: token.status });
      }

      const phraseMap = new Map<number, SegmentPhrase[]>();
      for (const ph of phrases) {
        const list = phraseMap.get(ph.segment_index) ?? [];
        list.push(ph);
        phraseMap.set(ph.segment_index, list);
      }

      const segTokens: Map<number, SegmentToken[]> = new Map();
      if (currentLanguage === 'en' || currentLanguage === 'ja' || currentLanguage === 'de' || currentLanguage === 'zh') {
        for (const t of raw) {
          const list = segTokens.get(t.segment_index) ?? [];
          list.push(t);
          segTokens.set(t.segment_index, list);
        }
      }

      const readerTokens = new Map<number, ReaderToken[]>();
      for (const token of fullTokens) { const list=readerTokens.get(token.segment_index) ?? []; list.push(token); readerTokens.set(token.segment_index,list); }
      for (const token of fullTokens) if (token.word_id !== null) wordMap.set(token.lemma, { id: token.word_id, lemma: token.lemma, status: token.status ?? 'unprocessed' });
      if (request !== fileGeneration) return;
      set({
        currentFileId: fileId,
        currentLanguage,
        segments,
        readerTokens,
        wordStatusMap: wordMap,
        phraseMap,
        segmentTokens: segTokens,
        activeSegmentIndex: 0,
      });
    } catch (e) {
      if (request === fileGeneration) set({ error: String(e) });
    } finally {
      if (request === fileGeneration) set({ loading: false });
    }
  },
}));
