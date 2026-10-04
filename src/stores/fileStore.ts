import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileRecord, BackupPayload, FolderInfo } from '../lib/types';
import { computeHash } from '../lib/hash';
import { parseFile, type ParsedResult } from '../lib/parser';
import type { Language } from '../lib/languages';
import type { OccurrenceInput } from '../lib/types';
import type { AiConfig } from '../lib/ai';
import { downloadError, EMPTY_BROWSER_SESSION, isYouTubeCancelled, type BrowserSession, type YouTubeDownloadError } from '../lib/youtubeDownload';
import { trackLanguage } from '../lib/youtubeSelection';
import type { TrackSelection, SubtitleResult } from './youtubeStore';
import type { YouTubeLanguagePair } from '../lib/youtubeSelection';
import { useYoutubeStore } from './youtubeStore';
import { useFeedbackStore } from './feedbackStore';
import { usePreferencesStore } from './preferencesStore';
import i18n from '../i18n';
import { errorCode } from '../lib/syncErrors';
import { QueryCache } from '../lib/queryCache';
import { invalidateCaches, registerCacheInvalidator } from '../lib/cacheInvalidation';

export interface DeleteJobStatus {
  job_id: string;
  file_id: number;
  phase: string;
  completed_items: number;
  total_items: number;
  completed_bytes: number;
  total_bytes: number;
  error_code: string | null;
}

interface PendingImport {
  youtubeSelection?: YouTubeLanguagePair;
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

export interface YouTubeImportInput {
  url: string; title: string; primary: TrackSelection; secondary?: TrackSelection | null;
  language: Language; aiTranslate: boolean; config: AiConfig; session?: BrowserSession;
  fallback?: 'ai' | 'original';
}
export interface YouTubeRecovery {
  primary: SubtitleResult; error: YouTubeDownloadError; pair: YouTubeLanguagePair;
  url: string; primaryTrack: TrackSelection;
}
let youtubeImportGeneration = 0;

interface FileStore {
  files: FileRecord[];
  folders: FolderInfo[];
  currentFolderId: number | null;
  loading: boolean;
  pendingImport: PendingImport | null;
  importingYouTube: boolean;
  youtubePhase: YoutubePhase | null;
  youtubeActiveJobId: number | null;
  youtubeRecovery: YouTubeRecovery | null;
  youtubeFailure: YouTubeDownloadError | null;
  youtubeCooldownUntil: number;
  resetYouTubeRecovery: () => void;
  cancelYouTubeImport: () => Promise<void>;
  confirming: boolean;
  deletingFiles: Record<number, DeleteJobStatus>;
  loadFiles: (force?: boolean) => Promise<void>;
  loadFolders: (force?: boolean) => Promise<void>;
  invalidateFiles: () => void;
  setCurrentFolder: (folderId: number | null) => void;
  createFolder: (name: string, parentId: number | null) => Promise<boolean>;
  renameFolder: (folderId: number, name: string) => Promise<boolean>;
  deleteFolder: (folderId: number) => Promise<void>;
  moveFolder: (folderId: number, targetParentId: number | null) => Promise<void>;
  moveFile: (fileId: number, folderId: number | null) => Promise<void>;
  importFile: () => Promise<void>;
  setImportLanguage: (language: Language) => Promise<void>;
  importKnownWords: () => Promise<void>;
  importDictionaryPack: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  deleteFile: (id: number) => Promise<void>;
  exportAll: () => Promise<void>;
  restoreAll: () => Promise<void>;
  importFromYouTube: (input: YouTubeImportInput) => Promise<boolean>;
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
  word_kind: 'common' | 'proper_noun' | 'noise' | 'ambiguous';
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
        word_kind: token.word_kind,
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

const fileCache = new QueryCache<FileRecord[]>(6);
const folderCache = new QueryCache<FolderInfo[]>(4);
registerCacheInvalidator('files', () => fileCache.invalidate());

function fileQueryKey(folderId: number | null): string {
  return JSON.stringify([usePreferencesStore.getState().language, folderId]);
}

function folderQueryKey(): string {
  return usePreferencesStore.getState().language;
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  deletingFiles: {},
  folders: [],
  currentFolderId: null,
  loading: true,
  pendingImport: null,
  youtubeActiveJobId: null,
  youtubeRecovery: null,
  youtubeFailure: null,
  youtubeCooldownUntil: 0,
  resetYouTubeRecovery: () => set({ youtubeRecovery: null, youtubeFailure: null, youtubeCooldownUntil: 0 }),
  cancelYouTubeImport: async () => {
    youtubeImportGeneration++;
    const id = get().youtubeActiveJobId;
    if (id != null) {
      const youtube = useYoutubeStore.getState();
      if (get().youtubePhase === 'translating') await youtube.cancelTranslate(id);
      else await youtube.cancelJob(id);
    }
  },
  importingYouTube: false,
  youtubePhase: null,
  confirming: false,

  loadFiles: async (force = false) => {
    const language = usePreferencesStore.getState().language;
    const folderId = get().currentFolderId;
    const key = fileQueryKey(folderId);
    const cached = fileCache.peek(key);
    if (cached) set({ files: cached, loading: false });
    if (!force && fileCache.isFresh(key)) return;
    if (!cached) set({ loading: true });
    try {
      const files = await fileCache.fetch(key, () => invoke<FileRecord[]>('list_files', {
          language: language === 'all' ? null : language,
          folderId,
        }), force);
      if (fileQueryKey(get().currentFolderId) === key) set({ files });
    } catch (e) {
      console.error('Failed to load files:', e);
    } finally {
      if (fileQueryKey(get().currentFolderId) === key) set({ loading: false });
    }
  },

  loadFolders: async (force = false) => {
    const language = usePreferencesStore.getState().language;
    const key = folderQueryKey();
    const cached = folderCache.peek(key);
    if (cached) set({ folders: cached });
    if (!force && folderCache.isFresh(key)) return;
    try {
      const folders = await folderCache.fetch(key, () => invoke<FolderInfo[]>('list_folders', {
          language: language === 'all' ? null : language,
        }), force);
      if (folderQueryKey() === key) set({ folders });
    } catch (e) {
      console.error('Failed to load folders:', e);
    }
  },

  invalidateFiles: () => fileCache.invalidate(),

  setCurrentFolder: (folderId) => {
    set({ currentFolderId: folderId });
    void get().loadFiles();
  },

  createFolder: async (name, parentId) => {
    try {
      await invoke('create_folder', { name, parentId });
      folderCache.invalidate();
      await get().loadFolders(true);
      return true;
    } catch (e) {
      console.error('Failed to create folder:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.folderOpFailed'), 'error');
      return false;
    }
  },

  renameFolder: async (folderId, name) => {
    try {
      await invoke('rename_folder', { folderId, name });
      folderCache.invalidate();
      await get().loadFolders(true);
      return true;
    } catch (e) {
      console.error('Failed to rename folder:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.folderOpFailed'), 'error');
      return false;
    }
  },

  deleteFolder: async (folderId) => {
    try {
      await invoke('delete_folder', { folderId });
      fileCache.invalidate();
      folderCache.invalidate();
      await Promise.all([get().loadFiles(true), get().loadFolders(true)]);
    } catch (e) {
      console.error('Failed to delete folder:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.folderOpFailed'), 'error');
    }
  },

  moveFolder: async (folderId, targetParentId) => {
    try {
      await invoke('move_folder', { folderId, targetParentId });
      folderCache.invalidate();
      await get().loadFolders(true);
    } catch (e) {
      console.error('Failed to move folder:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.folderOpFailed'), 'error');
    }
  },

  moveFile: async (fileId, folderId) => {
    try {
      await invoke('move_file', { fileId, folderId });
      fileCache.invalidate();
      folderCache.invalidate();
      await Promise.all([get().loadFiles(true), get().loadFolders(true)]);
    } catch (e) {
      console.error('Failed to move file:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.fileMoveFailed'), 'error');
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
      fileCache.invalidate();
      invalidateCaches('words', 'review', 'insights');
      await get().loadFiles(true);
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
      invalidateCaches('storage');
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
          folderId: get().currentFolderId,
        },
      });
      if (pending.youtubeSelection) usePreferencesStore.getState().recordYouTubeImport(pending.youtubeSelection);
      invalidateCaches('words', 'phrases', 'review', 'insights', 'storage');
      set({ pendingImport: null });
      if (usePreferencesStore.getState().language === pending.language) {
        fileCache.invalidate();
        await get().loadFiles(true);
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

  importFromYouTube: async ({ url, title, primary, secondary, language, aiTranslate, config, session, fallback }) => {
    if (get().importingYouTube) return false;
    const generation = ++youtubeImportGeneration;
    const ensureCurrent = () => { if (generation !== youtubeImportGeneration) throw { code: 'cancelled' }; };
    const recovery = get().youtubeRecovery;
    const matchesRecovery = recovery?.url === url && recovery.primaryTrack.lang === primary.lang && recovery.primaryTrack.is_auto === primary.is_auto;
    const pair: YouTubeLanguagePair = matchesRecovery ? recovery.pair : { primary: trackLanguage(primary), secondary: secondary ? trackLanguage(secondary) : null };
    let original: SubtitleResult | null = matchesRecovery ? recovery.primary : null;
    set({ importingYouTube: true, youtubePhase: 'downloading', youtubeFailure: null });
    try {
      const youtube = useYoutubeStore.getState();
      let sub: SubtitleResult;
      if (fallback && original) {
        sub = original;
      } else {
        const jobId = nextJobId();
        set({ youtubeActiveJobId: jobId });
        const prepared = await youtube.prepareSubtitles(jobId, url, primary, secondary ?? null, session ?? usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION);
        ensureCurrent();
        if (prepared.status === 'partial') {
          set({ youtubeRecovery: { primary: prepared.primary, error: prepared.error, pair, url, primaryTrack: primary },
            youtubeFailure: prepared.error, youtubeCooldownUntil: Date.now() + prepared.error.cooldown_seconds * 1000 });
          return false;
        }
        sub = prepared.subtitle;
        // Single-track AI imports also retain their source if translation fails.
        if (!secondary) original = sub;
      }
      ensureCurrent();
      set({ youtubePhase: 'parsing', youtubeActiveJobId: null });
      let parsed = await parseContent(sub.content, 'srt', language);
      ensureCurrent();
      if (fallback === 'ai' || !fallback && aiTranslate) {
        set({ youtubePhase: 'translating' });
        const translateJobId = nextJobId();
        set({ youtubeActiveJobId: translateJobId });
        const translations = await youtube.translateSegments(translateJobId, language,
          parsed.segments.map(segment => ({ index: segment.index, text: segment.en_text })), config);
        ensureCurrent();
        const map = new Map(translations.map(item => [item.index, item.translation]));
        parsed = { ...parsed, segments: parsed.segments.map(segment => ({ ...segment, zh_text: map.get(segment.index) ?? segment.zh_text })) };
      }
      ensureCurrent();
      set({ youtubePhase: 'importing', youtubeActiveJobId: null });
      const hash = await computeHash(sub.content);
      ensureCurrent();
      const duplicate: { file_id: number; name: string } | null = await invoke('check_duplicate', { hash });
      ensureCurrent();
      let replaceFileId: number | null = null;
      let replaceFileName: string | null = null;
      if (duplicate) {
        const confirmed = await ask(i18n.t('fileStore.duplicateAsk', { name: duplicate.name }), {
          title: i18n.t('fileStore.duplicateTitle'), kind: 'warning', okLabel: i18n.t('fileStore.overwrite'), cancelLabel: i18n.t('common.cancel'),
        });
        ensureCurrent();
        if (!confirmed) return false;
        replaceFileId = duplicate.file_id; replaceFileName = duplicate.name;
      }
      set({ pendingImport: { youtubeSelection: pair, name: `${sanitizeFileName(title)}.srt`, fileType: 'srt', content: sub.content, hash, parsed, replaceFileId, replaceFileName, language },
        youtubeRecovery: null, youtubeFailure: null, youtubeCooldownUntil: 0 });
      return true;
    } catch (error) {
      if (generation !== youtubeImportGeneration || isYouTubeCancelled(error)) throw { ...downloadError(error), code: 'cancelled' };
      const failure = downloadError(error);
      if (get().youtubePhase === 'translating') { failure.code = 'translation_failed'; failure.stage = 'translate'; failure.role = 'secondary'; failure.language = 'zh-Hans'; }
      set({ youtubeFailure: failure, youtubeCooldownUntil: Date.now() + failure.cooldown_seconds * 1000,
        ...(original ? { youtubeRecovery: { primary: original, error: failure, pair, url, primaryTrack: primary } } : {}) });
      throw failure;
    } finally {
      set({ importingYouTube: false, youtubePhase: null, youtubeActiveJobId: null });
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
      const started = await invoke<DeleteJobStatus>('delete_file_start', { fileId: id });
      set((state) => ({ deletingFiles: { ...state.deletingFiles, [id]: started } }));
      let current = started;
      while (current.phase !== 'done' && current.phase !== 'failed') {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        current = await invoke<DeleteJobStatus>('delete_file_status', { jobId: current.job_id });
        set((state) => ({ deletingFiles: { ...state.deletingFiles, [id]: current } }));
      }
      if (current.phase === 'failed') throw new Error(current.error_code ?? 'local_delete_failed');
      set((state) => {
        const deletingFiles = { ...state.deletingFiles };
        delete deletingFiles[id];
        return { deletingFiles };
      });
      invalidateCaches('words', 'phrases', 'review', 'insights', 'storage');
      fileCache.invalidate();
      await get().loadFiles(true);
      useFeedbackStore.getState().show(i18n.t('fileStore.fileDeleted'), 'success');
    } catch (e) {
      console.error('Delete failed:', e);
      const code = errorCode(e);
      const messageKey = code === 'unknown' ? 'fileStore.deleteFailed' : `settings.cloudSync.errors.${code}`;
      useFeedbackStore.getState().show(i18n.t(messageKey), 'error', 6000);
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
      invalidateCaches('words', 'phrases', 'review', 'insights', 'storage');
      fileCache.invalidate();
      folderCache.invalidate();
      await Promise.all([get().loadFiles(true), get().loadFolders(true)]);
      useFeedbackStore.getState().show(i18n.t('fileStore.restored'), 'success');
    } catch (e) {
      console.error('Restore failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.restoreFailed'), 'error');
    }
  },
}));

let jobCounter = 0;
function nextJobId(): number {
  jobCounter += 1;
  return Date.now() * 100 + (jobCounter % 100);
}
