import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileRecord, BackupPayload } from '../lib/types';
import { computeHash } from '../lib/hash';
import { parseFile, type ParsedResult } from '../lib/parser';
import type { Language } from '../lib/languages';
import type { OccurrenceInput } from '../lib/types';
import type { AiConfig } from '../lib/ai';
import type { TrackSelection } from './youtubeStore';
import { useYoutubeStore } from './youtubeStore';
import { useFeedbackStore } from './feedbackStore';
import { usePreferencesStore } from './preferencesStore';
import i18n from '../i18n';
import { isCancelledError } from '../lib/errors';

interface PendingImport {
  name: string;
  fileType: 'txt' | 'srt';
  content: string;
  hash: string;
  parsed: ParsedResult | null;
  replaceFileId: number | null;
  replaceFileName: string | null;
  language: Language | null;
}

export type YoutubePhase = 'downloading' | 'parsing' | 'translating' | 'importing';

function sanitizeFileName(title: string): string {
  const cleaned = Array.from(title)
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const trimmed = cleaned.length > 100 ? cleaned.slice(0, 100).trim() : cleaned;
  return trimmed.length > 0 ? trimmed : i18n.t('fileStore.youtubeTitle');
}

interface FileStore {
  files: FileRecord[];
  loading: boolean;
  pendingImport: PendingImport | null;
  importingYouTube: boolean;
  youtubePhase: YoutubePhase | null;
  confirming: boolean;
  loadFiles: () => Promise<void>;
  importFile: () => Promise<void>;
  setImportLanguage: (language: Language) => Promise<void>;
  importKnownWords: () => Promise<void>;
  importDictionaryPack: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  deleteFile: (id: number) => Promise<void>;
  exportAll: () => Promise<void>;
  restoreAll: () => Promise<void>;
  importFromYouTube: (input: {
    url: string;
    title: string;
    primary: TrackSelection;
    secondary?: TrackSelection | null;
    language: Language;
    aiTranslate: boolean;
    config: AiConfig;
  }) => Promise<void>;
}

interface JapaneseToken {
  surface: string;
  lemma: string;
  reading: string | null;
  part_of_speech: string | null;
  position: number;
}

interface GermanToken {
  surface: string;
  lemma: string;
  part_of_speech: string | null;
  position: number;
}

interface EnglishToken {
  surface: string;
  lemma: string;
  part_of_speech: string | null;
  position: number;
}

interface ChineseToken {
  surface: string;
  lemma: string;
  reading: string | null;
  part_of_speech: string | null;
  position: number;
}

async function enrichJapaneseParsing(parsed: ParsedResult): Promise<ParsedResult> {
  const lemmas = new Set<string>();
  const occurrences: OccurrenceInput[] = [];
  const batches = await invoke<JapaneseToken[][]>('tokenize_japanese_batch', {
    texts: parsed.segments.map((segment) => segment.en_text),
  });
  parsed.segments.forEach((segment, index) => {
    for (const token of batches[index] ?? []) {
      lemmas.add(token.lemma);
      occurrences.push({
        lemma: token.lemma,
        segment_index: segment.index,
        original_form: token.surface,
        position: token.position,
        reading: token.reading,
        part_of_speech: token.part_of_speech,
      });
    }
  });
  return { ...parsed, lemmas: [...lemmas], occurrences };
}

async function enrichGermanParsing(parsed: ParsedResult): Promise<ParsedResult> {
  const lemmas = new Set<string>();
  const occurrences: OccurrenceInput[] = [];
  const batches = await invoke<GermanToken[][]>('tokenize_german_batch', {
    texts: parsed.segments.map((segment) => segment.en_text),
  });
  parsed.segments.forEach((segment, index) => {
    for (const token of batches[index] ?? []) {
      lemmas.add(token.lemma);
      occurrences.push({
        lemma: token.lemma,
        segment_index: segment.index,
        original_form: token.surface,
        position: token.position,
        part_of_speech: token.part_of_speech,
      });
    }
  });
  return { ...parsed, lemmas: [...lemmas], occurrences };
}

async function enrichEnglishParsing(parsed: ParsedResult): Promise<ParsedResult> {
  const lemmas = new Set<string>();
  const occurrences: OccurrenceInput[] = [];
  const batches = await invoke<EnglishToken[][]>('tokenize_english_batch', {
    texts: parsed.segments.map((segment) => segment.en_text),
  });
  parsed.segments.forEach((segment, index) => {
    for (const token of batches[index] ?? []) {
      lemmas.add(token.lemma);
      occurrences.push({
        lemma: token.lemma,
        segment_index: segment.index,
        original_form: token.surface,
        position: token.position,
        part_of_speech: token.part_of_speech,
      });
    }
  });
  return { ...parsed, lemmas: [...lemmas], occurrences };
}

async function enrichChineseParsing(parsed: ParsedResult): Promise<ParsedResult> {
  const lemmas = new Set<string>();
  const occurrences: OccurrenceInput[] = [];
  const batches = await invoke<ChineseToken[][]>('tokenize_chinese_batch', {
    texts: parsed.segments.map((segment) => segment.en_text),
  });
  parsed.segments.forEach((segment, index) => {
    for (const token of batches[index] ?? []) {
      lemmas.add(token.lemma);
      occurrences.push({
        lemma: token.lemma,
        segment_index: segment.index,
        original_form: token.surface,
        position: token.position,
        reading: token.reading,
        part_of_speech: token.part_of_speech,
      });
    }
  });
  return { ...parsed, lemmas: [...lemmas], occurrences };
}

async function parseContent(content: string, fileType: 'txt' | 'srt', language: Language): Promise<ParsedResult> {
  let parsed = parseFile(content, fileType, 'auto', language);
  if (language === 'ja') {
    parsed = await enrichJapaneseParsing(parsed);
  } else if (language === 'de') {
    parsed = await enrichGermanParsing(parsed);
  } else if (language === 'en') {
    parsed = await enrichEnglishParsing(parsed);
  } else if (language === 'zh') {
    parsed = await enrichChineseParsing(parsed);
  }
  return parsed;
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  loading: false,
  pendingImport: null,
  importingYouTube: false,
  youtubePhase: null,
  confirming: false,

  loadFiles: async () => {
    const language = usePreferencesStore.getState().language;
    set({ loading: true });
    try {
      const files: FileRecord[] = await invoke('list_files', {
        language: language === 'all' ? null : language,
      });
      set({ files });
    } catch (e) {
      console.error('Failed to load files:', e);
    } finally {
      set({ loading: false });
    }
  },

  importFile: async () => {
    try {
      const selected = await open({
        filters: [{ name: i18n.t('fileStore.dialogFilterText'), extensions: ['txt', 'srt'] }],
        multiple: false,
      });
      if (!selected) return;

      const filePath = selected as string;
      const content = await readTextFile(filePath);

      const name = filePath.split(/[\\/]/).pop() || 'unknown';
      const fileType = name.endsWith('.srt') ? 'srt' as const : 'txt' as const;
      const hash = await computeHash(content);

      const duplicate: { file_id: number; name: string } | null = await invoke('check_duplicate', { hash });
      if (duplicate) {
        const confirmed = await ask(i18n.t('fileStore.duplicateAsk', { name: duplicate.name }), {
          title: i18n.t('fileStore.duplicateTitle'),
          kind: 'warning',
          okLabel: i18n.t('fileStore.overwrite'),
          cancelLabel: i18n.t('common.cancel'),
        });
        if (!confirmed) return;
      }

       set({
         pendingImport: {
          name,
          fileType,
          content,
          hash,
          parsed: null,
          replaceFileId: duplicate?.file_id ?? null,
           replaceFileName: duplicate?.name ?? null,
            language: null,
         },
       });
    } catch (e) {
      console.error('Import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.parseFailed'), 'error');
    }
  },

  setImportLanguage: async (language) => {
    const pending = get().pendingImport;
    if (!pending) return;

    try {
      const parsed = await parseContent(pending.content, pending.fileType, language);
      set({ pendingImport: { ...pending, parsed, language } });
    } catch (e) {
      console.error('Import parsing failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.parseFailed'), 'error');
    }
  },

  importKnownWords: async () => {
    try {
      const selected = await open({
        filters: [{ name: i18n.t('fileStore.dialogFilterKnownWords'), extensions: ['txt'] }],
        multiple: false,
      });
      if (!selected) return;
      const content = await readTextFile(selected as string);
      const language = usePreferencesStore.getState().language;
      const isChinese = language === 'zh';
      const matchedText = isChinese ? content : (language === 'de' ? content : content.toLowerCase());
      const lemmas = Array.from(new Set(
        (matchedText.match(isChinese
          ? /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g
          : /[A-Za-zÄÖÜäöüß]+(?:['-][A-Za-zÄÖÜäöüß]+)*/g) ?? [])
          .map((word) => (language === 'de' ? word : word.toLowerCase()))
          .filter((word) => (isChinese ? word.length >= 1 : word.length > 1)),
      ));
      if (lemmas.length === 0) {
        useFeedbackStore.getState().show(i18n.t('fileStore.noValidWords'), 'error');
        return;
      }
      const words: { id: number; lemma: string; status: string }[] = await invoke('list_words', {
        statusFilter: null,
        sortBy: 'alpha',
        language: language === 'all' ? null : language,
      });
      const wordMap = new Map(words.map((word) => [word.lemma, word]));
      const matched = lemmas.map((lemma) => wordMap.get(lemma)).filter((word): word is { id: number; lemma: string; status: string } => Boolean(word));
      const target = matched.filter((word) => word.status === 'unprocessed');
      if (target.length > 0) {
        await invoke('batch_update_status', {
          wordIds: target.map((word) => word.id),
          status: 'known',
        });
      }
      useFeedbackStore.getState().show(
        i18n.t('fileStore.knownWordsImported', {
          matched: matched.length,
          target: target.length,
          unmatched: lemmas.length - matched.length,
        }),
        'success',
      );
    } catch (e) {
      console.error('Known word list import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.knownWordsImportFailed'), 'error');
    }
  },

  importDictionaryPack: async () => {
    try {
      const selected = await open({
        filters: [{ name: i18n.t('fileStore.dialogFilterDictionary'), extensions: ['json'] }],
        multiple: false,
      });
      if (!selected) return;
      const packJson = await readTextFile(selected as string);
      const count = await invoke<number>('import_dictionary_pack', { packJson });
      useFeedbackStore.getState().show(i18n.t('fileStore.dictionaryImported', { count }), 'success');
    } catch (e) {
      console.error('Dictionary pack import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.dictionaryImportFailed'), 'error');
    }
  },

  confirmImport: async () => {
    const pending = get().pendingImport;
    if (!pending || !pending.parsed || !pending.language) return;
    if (get().confirming) return;
    set({ confirming: true });
    try {
      await invoke('import_file', {
        payload: {
          name: pending.name,
          file_type: pending.fileType,
          content: pending.content,
           content_hash: pending.hash,
           language: pending.language,
          segments: pending.parsed.segments,
          lemmas: pending.parsed.lemmas,
          occurrences: pending.parsed.occurrences,
          replaceFileId: pending.replaceFileId,
        },
      });
      set({ pendingImport: null });
      if (usePreferencesStore.getState().language === pending.language) {
        await get().loadFiles();
      } else {
        usePreferencesStore.getState().setLanguage(pending.language);
      }
      useFeedbackStore.getState().show(
         i18n.t('fileStore.importedSummary', {
          segments: pending.parsed.segments.length,
          lemmas: pending.parsed.lemmas.length,
        }),
        'success',
      );
    } catch (e) {
      console.error('Import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.importFailed'), 'error');
    } finally {
      set({ confirming: false });
    }
  },

  importFromYouTube: async ({ url, title, primary, secondary, language, aiTranslate, config }) => {
    set({ importingYouTube: true, youtubePhase: 'downloading' });
    try {
      const youtube = useYoutubeStore.getState();
      const jobId = nextJobId();
      const sub = secondary
        ? await youtube.mergeSubs(jobId, url, primary, secondary)
        : await youtube.downloadSub(jobId, url, primary.lang, primary.is_auto);

      set({ youtubePhase: 'parsing' });
      let parsed = await parseContent(sub.content, 'srt', language);

      if (aiTranslate) {
        set({ youtubePhase: 'translating' });
        const translateJobId = nextJobId();
        const translations = await youtube.translateSegments(
          translateJobId,
          language,
          parsed.segments.map((segment) => ({ index: segment.index, text: segment.en_text })),
          config,
        );
        const map = new Map(translations.map((t) => [t.index, t.translation]));
        parsed = {
          ...parsed,
          segments: parsed.segments.map((segment) => ({
            ...segment,
            zh_text: map.get(segment.index) ?? segment.zh_text,
          })),
        };
      }

      set({ youtubePhase: 'importing' });
      const hash = await computeHash(sub.content);
      const duplicate: { file_id: number; name: string } | null = await invoke('check_duplicate', { hash });
      let replaceFileId: number | null = null;
      let replaceFileName: string | null = null;
      if (duplicate) {
        const confirmed = await ask(i18n.t('fileStore.duplicateAsk', { name: duplicate.name }), {
          title: i18n.t('fileStore.duplicateTitle'),
          kind: 'warning',
          okLabel: i18n.t('fileStore.overwrite'),
          cancelLabel: i18n.t('common.cancel'),
        });
        if (!confirmed) return;
        replaceFileId = duplicate.file_id;
        replaceFileName = duplicate.name;
      }

      set({
        pendingImport: {
          name: `${sanitizeFileName(title)}.srt`,
          fileType: 'srt',
          content: sub.content,
          hash,
          parsed,
          replaceFileId,
          replaceFileName,
          language,
        },
      });
    } catch (e) {
      console.error('YouTube import failed:', e);
      const messageText = String(e);
      if (isCancelledError(messageText)) {
        useFeedbackStore.getState().show(i18n.t('fileStore.importCancelled'), 'info', 2000);
      } else {
        useFeedbackStore.getState().show(messageText, 'error', 6000);
      }
      throw e;
    } finally {
      set({ importingYouTube: false, youtubePhase: null });
    }
  },

  cancelImport: () => set({ pendingImport: null }),

  deleteFile: async (id: number) => {
    try {
      const file = get().files.find((item) => item.id === id);
      const confirmed = await ask(
        file
          ? i18n.t('fileStore.deleteAskWithContent', { name: file.name })
          : i18n.t('fileStore.deleteAsk'),
        {
          title: i18n.t('fileStore.deleteTitle'),
          kind: 'warning',
          okLabel: i18n.t('common.delete'),
          cancelLabel: i18n.t('common.cancel'),
        },
      );
      if (!confirmed) return;
      await invoke('delete_file', { fileId: id });
      await get().loadFiles();
      useFeedbackStore.getState().show(i18n.t('fileStore.fileDeleted'), 'success');
    } catch (e) {
      console.error('Delete failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.deleteFailed'), 'error');
    }
  },

  exportAll: async () => {
    try {
      const backup: BackupPayload = await invoke('export_all');
      const json = JSON.stringify(backup, null, 2);
      const savePath = await save({
        filters: [{ name: i18n.t('fileStore.dialogFilterBackup'), extensions: ['json'] }],
        defaultPath: `lexicue-backup-${new Date().toISOString().slice(0, 10)}.json`,
      });
      if (!savePath) return;
      await writeTextFile(savePath, json);
      useFeedbackStore.getState().show(i18n.t('fileStore.backupExported'), 'success');
    } catch (e) {
      console.error('Export failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.backupExportFailed'), 'error');
    }
  },

  restoreAll: async () => {
    try {
      const selected = await open({
        filters: [{ name: i18n.t('fileStore.dialogFilterBackup'), extensions: ['json'] }],
        multiple: false,
      });
      if (!selected) return;

      const json = await readTextFile(selected as string);
      const backup: BackupPayload = JSON.parse(json);

       if (backup.schema_version !== 1 && backup.schema_version !== 2 && backup.schema_version !== 3 && backup.schema_version !== 4) {
        await message(i18n.t('fileStore.backupVersionError', { version: backup.schema_version }), { title: i18n.t('fileStore.backupVersionTitle'), kind: 'error' });
        return;
      }

      const confirmed = await ask(i18n.t('fileStore.restoreAsk'), {
        title: i18n.t('fileStore.restoreTitle'),
        kind: 'warning',
        okLabel: i18n.t('fileStore.restoreTitle'),
        cancelLabel: i18n.t('common.cancel'),
      });
      if (!confirmed) return;

      await invoke('restore_all', { backup });
      await get().loadFiles();
      useFeedbackStore.getState().show(i18n.t('fileStore.restored'), 'success');
    } catch (e) {
      console.error('Restore failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.restoreFailed'), 'error');
    }
  },
}));

usePreferencesStore.subscribe(
  (state) => state.language,
  () => {
    useFileStore.getState().loadFiles();
  },
);

let jobCounter = 0;
function nextJobId(): number {
  jobCounter += 1;
  return Date.now() * 100 + (jobCounter % 100);
}
