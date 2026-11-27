import { migrateTagColors } from '../lib/portableReading';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { confirmAction as ask, notifyMessage as message } from '../lib/confirmAction';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type {TagColors} from '../lib/tagAppearance';
import type { FileRecord, BackupPayload, TagInfo, TagSelection } from '../lib/types';
import { computeHash } from '../lib/hash';
import { parseFile, type ParsedResult } from '../lib/parser';
import type { Language } from '../lib/languages';
import type { OccurrenceInput } from '../lib/types';
import { useFeedbackStore } from './feedbackStore';
import { usePreferencesStore } from './preferencesStore';
import i18n from '../i18n';
import { errorCode } from '../lib/syncErrors';
import { QueryCache } from '../lib/queryCache';
import { clearCaches, invalidateCaches, registerCacheInvalidator } from '../lib/cacheInvalidation';
import { useImportStore } from './importStore';
import { useRestoreGuard } from './restoreGuard';
import { useMaterialStore } from './materialStore';
import { useReadingDeskStore } from './readingDeskStore';
import { useReaderStore } from './readerStore';
import { useRecallStore } from './recallStore';
import { useSpeechStore } from './speechStore';
import { readerNavigation } from '../lib/readerNavigation';
import { isIOSPlatform } from '../lib/platform';
import { clearImportedReading } from '../lib/readingEntry';

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
  tags: TagSelection;
  name: string;
  fileType: 'txt' | 'srt';
  content: string;
  hash: string;
  parsed: ParsedResult | null;
  replaceFileId: number | null;
  replaceFileName: string | null;
  language: Language | null;
}

interface FileStore {
  files: FileRecord[];
  tags: TagInfo[];
  selectedTagIds: number[];
  untaggedOnly: boolean;
  tagsError: boolean;
  loadingTags: boolean;
  loading: boolean;
  pendingImport: PendingImport | null;
  confirming: boolean;
  deletingFiles: Record<number, DeleteJobStatus>;
  loadFiles: (force?: boolean, throwOnError?: boolean) => Promise<void>;
  loadTags: (force?: boolean, throwOnError?: boolean) => Promise<void>;
  invalidateFiles: () => void;
  setTagFilter: (tagIds: number[], untagged?: boolean) => void;
  createTag: (name: string) => Promise<void>;
  renameTag: (tagId: number, name: string) => Promise<void>;
  deleteTag: (tagId: number) => Promise<void>;
  setFileTags: (fileId: number, selection: TagSelection, tones?: TagColors) => Promise<void>;
  setImportTags: (selection: TagSelection) => void;
  importFile: () => Promise<void>;
  setImportLanguage: (language: Language) => Promise<void>;
  importKnownWords: () => Promise<void>;
  importDictionaryPack: () => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  deleteFile: (id: number, name?: string, confirmation?: 'trash-drop') => Promise<boolean>;
  exportAll: (complete?: boolean) => Promise<void>;
  restoreAll: (mergeBackupId?: string) => Promise<void>;
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
const tagCache = new QueryCache<TagInfo[]>(1);
let fileRequest = 0;
let tagRequest = 0;
registerCacheInvalidator('files', () => {
  fileRequest++; tagRequest++;
  fileCache.invalidate(); tagCache.invalidate();
});

function fileQueryKey(tagIds: number[], untagged: boolean): string {
  return JSON.stringify([usePreferencesStore.getState().language, [...tagIds].sort((a,b) => a-b), untagged]);
}

async function replacementTags(fileId: number | null): Promise<TagSelection> {
  if (fileId === null) return { tagIds: [], newTagNames: [] };
  const file = await invoke<FileRecord>('get_file_info', { fileId });
  return { tagIds: (file.tags ?? []).map(tag => tag.id), newTagNames: [] };
}

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  deletingFiles: {},
  tags: [],
  selectedTagIds: [],
  untaggedOnly: false,
  tagsError: false,
  loadingTags: false,
  loading: true,
  pendingImport: null,
  confirming: false,

  loadFiles: async (force = false, throwOnError = false) => {
    const language = usePreferencesStore.getState().language;
    const { selectedTagIds, untaggedOnly } = get();
    const key = fileQueryKey(selectedTagIds, untaggedOnly);
    const cached = fileCache.peek(key);
    if (cached) set({ files: cached, loading: false });
    if (!force && fileCache.isFresh(key)) return;
    const request = ++fileRequest;
    if (!cached) set({ loading: true, files: [] });
    const current = () => request === fileRequest && fileQueryKey(get().selectedTagIds, get().untaggedOnly) === key;
    try {
      const files = await fileCache.fetch(key, () => invoke<FileRecord[]>('list_files', {
        language: language === 'all' ? null : language, tagIds: selectedTagIds, untagged: untaggedOnly,
      }), force);
      if (current()) set({ files });
    } catch (error) {
      if (current()) useFeedbackStore.getState().show(i18n.t('tags.loadFilesFailed'), 'error');
      console.error('Failed to load files:', error);
      if (throwOnError) throw error;
    } finally {
      if (current()) set({ loading: false });
    }
  },

  loadTags: async (force = false, throwOnError = false) => {
    const cached = tagCache.peek('all');
    if (cached) set({ tags: cached });
    if (!force && tagCache.isFresh('all')) return;
    const request = ++tagRequest;
    set({ loadingTags: true, tagsError: false });
    try {
      const tags = await tagCache.fetch('all', async () => {
        const values = await invoke<TagInfo[]>('list_tags');
        await migrateTagColors(values);
        return values;
      }, force);
      if (request !== tagRequest) return;
      const selectedTagIds = get().selectedTagIds.filter(id => tags.some(tag => tag.id === id));
      const changed = selectedTagIds.length !== get().selectedTagIds.length;
      set({ tags, selectedTagIds });
      if (changed) void get().loadFiles();
    } catch (error) {
      if (request === tagRequest) set({ tagsError: true });
      console.error('Failed to load tags:', error);
      if (throwOnError) throw error;
    } finally {
      if (request === tagRequest) set({ loadingTags: false });
    }
  },

  invalidateFiles: () => { fileRequest++; fileCache.invalidate(); },
  setTagFilter: (tagIds, untagged = false) => {
    set({ selectedTagIds: untagged ? [] : [...new Set(tagIds)].sort((a,b) => a-b), untaggedOnly: untagged });
    void get().loadFiles();
  },
  createTag: async name => {
    await invoke('create_tag', { name });
    tagCache.invalidate();
    invalidateCaches('storage');
    await get().loadTags(true);
  },
  renameTag: async (tagId, name) => {
    const previousName=get().tags.find(tag=>tag.id===tagId)?.name;
    await invoke('rename_tag', { tagId, name });
    const appearance=usePreferencesStore.getState();
    const tone=previousName&&appearance.tagColors[previousName.trim().toLowerCase()];
    if(tone)appearance.setTagColors({[name.trim().toLowerCase()]:tone});
    invalidateCaches('files', 'storage');
    await get().loadTags(true);
    await get().loadFiles(true);
    await useMaterialStore.getState().load();
  },
  deleteTag: async tagId => {
    await invoke('delete_tag', { tagId });
    invalidateCaches('files', 'storage');
    await get().loadTags(true);
    await get().loadFiles(true);
    await useMaterialStore.getState().load();
  },
  setFileTags: async (fileId, selection, tones) => {
    await invoke('set_file_tags', { fileId, tagIds: selection.tagIds, newTagNames: selection.newTagNames, tones });
    invalidateCaches('files', 'storage');
    await get().loadTags(true);
    await get().loadFiles(true);
    await useMaterialStore.getState().load();
  },
  setImportTags: tags => {
    const pendingImport = get().pendingImport;
    if (pendingImport && !get().confirming) set({ pendingImport: { ...pendingImport, tags } });
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
          tags: await replacementTags(duplicate?.file_id ?? null),
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
    const restoreGeneration = useRestoreGuard.getState().generation;
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
      if (useRestoreGuard.getState().active || useRestoreGuard.getState().generation !== restoreGeneration) { useFeedbackStore.getState().show(i18n.t('fileStore.restoreInProgress'), 'error'); return; }
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
    const restoreGeneration = useRestoreGuard.getState().generation;
    try {
      const selected = await open({
        filters: [{ name: i18n.t('fileStore.dialogFilterDictionary'), extensions: ['json'] }],
        multiple: false,
      });
      if (!selected) return;
      const packJson = await readTextFile(selected as string);
      if (useRestoreGuard.getState().active || useRestoreGuard.getState().generation !== restoreGeneration) { useFeedbackStore.getState().show(i18n.t('fileStore.restoreInProgress'), 'error'); return; }
      const count = await invoke<number>('import_dictionary_pack', { packJson });
      window.dispatchEvent(new Event('lexicue-dictionary-changed'));
      invalidateCaches('storage');
      useFeedbackStore.getState().show(i18n.t('fileStore.dictionaryImported', { count }), 'success');
    } catch (e) {
      console.error('Dictionary pack import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.dictionaryImportFailed'), 'error');
    }
  },

  confirmImport: async () => {
    if (useRestoreGuard.getState().active) { useFeedbackStore.getState().show(i18n.t('fileStore.restoreInProgress'), 'error'); return; }
    const pending = get().pendingImport;
    if (!pending || !pending.parsed || !pending.language) return;
    if (get().confirming) return;
    set({ confirming: true });
    try {
      await invoke<number>('import_file', {
        payload: {
          name: pending.name,
          file_type: pending.fileType,
          content: pending.content,
           content_hash: pending.hash,
           language: pending.language,
          segments: pending.parsed.segments,
          lemmas: pending.parsed.lemmas,
          occurrences: pending.parsed.occurrences,
          replace_file_id: pending.replaceFileId,
          tag_ids: pending.tags.tagIds,
          new_tag_names: pending.tags.newTagNames,
        },
      });
      invalidateCaches('files', 'words', 'phrases', 'review', 'insights', 'storage');
      set({ pendingImport: null });
      await get().loadTags(true);
      if (usePreferencesStore.getState().language === pending.language) {
        fileCache.invalidate();
        await get().loadFiles(true);
      } else {
        usePreferencesStore.getState().setLanguage(pending.language);
      }
      const { selectedTagIds, untaggedOnly, tags } = get();
      const hidden = untaggedOnly ? pending.tags.tagIds.length + pending.tags.newTagNames.length > 0 : selectedTagIds.some(id => !pending.tags.tagIds.includes(id) && !pending.tags.newTagNames.some(name => name.trim().toLowerCase() === tags.find(tag => tag.id === id)?.name.toLowerCase()));
      useFeedbackStore.getState().show(
        i18n.t('fileStore.importedSummary', { segments: pending.parsed.segments.length, lemmas: pending.parsed.lemmas.length }),
        'success', hidden ? 10000 : 3000,
        hidden ? { label: i18n.t('tags.viewAll'), onClick: () => get().setTagFilter([]) } : undefined,
      );
    } catch (e) {
      console.error('Import failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.importFailed'), 'error');
    } finally {
      set({ confirming: false });
    }
  },

  cancelImport: () => set({ pendingImport: null }),

  deleteFile: async (id: number, name?: string, confirmation?: 'trash-drop') => {
    try {
      const file = get().files.find((item) => item.id === id);
      const confirmed = confirmation === 'trash-drop' || await ask(
        name || file
          ? i18n.t('fileStore.deleteAskWithContent', { name: name ?? file!.name })
          : i18n.t('fileStore.deleteAsk'),
        {
          title: i18n.t('fileStore.deleteTitle'),
          kind: 'warning',
          okLabel: i18n.t('common.delete'),
          cancelLabel: i18n.t('common.cancel'),
        },
      );
      if (!confirmed) return false;
      const started = await invoke<DeleteJobStatus>('delete_file_start', { fileId: id });
      set((state) => ({ deletingFiles: { ...state.deletingFiles, [id]: started } }));
      let current = started;
      while (current.phase !== 'done' && current.phase !== 'failed') {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        current = await invoke<DeleteJobStatus>('delete_file_status', { jobId: current.job_id });
        set((state) => ({ deletingFiles: { ...state.deletingFiles, [id]: current } }));
      }
      if (current.phase === 'failed') throw new Error(current.error_code ?? 'local_delete_failed');
      invalidateCaches('files', 'words', 'phrases', 'review', 'insights', 'storage');
      await Promise.allSettled([get().loadTags(true), get().loadFiles(true), useMaterialStore.getState().load()]);
      useFeedbackStore.getState().show(i18n.t('fileStore.fileDeleted'), 'success');
      return true;
    } catch (e) {
      console.error('Delete failed:', e);
      const code = errorCode(e);
      const messageKey = code === 'unknown' ? 'fileStore.deleteFailed' : `settings.cloudSync.errors.${code}`;
      useFeedbackStore.getState().show(i18n.t(messageKey), 'error', 6000);
      return false;
    } finally {
      set(state => { const deletingFiles = { ...state.deletingFiles }; delete deletingFiles[id]; return { deletingFiles }; });
    }
  },

  exportAll: async (complete = false) => {
    try {
      const extension = complete ? 'lexicuebackup' : 'json';
      const savePath = await save({
        filters: [{ name: i18n.t(complete ? 'fileStore.dialogFilterFullBackup' : 'fileStore.dialogFilterBackup'), extensions: [extension] }],
        defaultPath: `lexicue-backup-${new Date().toISOString().slice(0, 10)}.${extension}`,
      });
      if (!savePath) return;
      if (complete) {
        await invoke('export_library_archive', { path: savePath });
      } else {
        const backup: BackupPayload = await invoke('export_all');
        await writeTextFile(savePath, JSON.stringify(backup, null, 2));
      }
      useFeedbackStore.getState().show(i18n.t('fileStore.backupExported'), 'success');
    } catch (e) {
      console.error('Export failed:', e);
      useFeedbackStore.getState().show(i18n.t('fileStore.backupExportFailed'), 'error');
    }
  },

  restoreAll: async (mergeBackupId) => {
    if (useRestoreGuard.getState().active) return;
    let ownsGuard = false;
    let committed: { safety_backup_path: string } | undefined;
    const discardRestoreState = () => {
      useSpeechStore.getState().stop();
      useMaterialStore.getState().resetAfterRestore();
      useReaderStore.getState().resetAfterRestore();
      useReadingDeskStore.getState().resetAfterRestore();
      useRecallStore.getState().invalidate();
      readerNavigation.clear();
      clearImportedReading();
      window.dispatchEvent(new Event('lexicue-data-restored'));
      window.dispatchEvent(new Event('lexicue-saved-changed'));
      clearCaches('words', 'phrases', 'review', 'insights', 'storage');
      fileRequest++; tagRequest++;
      fileCache.clear();
      tagCache.clear();
      set({ files: [], tags: [], selectedTagIds: [], untaggedOnly: false, pendingImport: null });
    };
    try {
      let backup: BackupPayload | undefined;
      let archivePath: string | undefined;
      if (!mergeBackupId) {
        const selected = await open({
          filters: [{ name: i18n.t('fileStore.dialogFilterBackup'),
            extensions: isIOSPlatform() || /Macintosh/i.test(navigator.userAgent) ? ['json', 'lexicuebackup'] : ['json'] }],
          multiple: false,
        });
        if (!selected) return;

        if (typeof selected !== 'string') return;
        if (/\.lexicuebackup$/i.test(selected)) {
          archivePath = selected;
        } else {
          const json = await readTextFile(selected);
          backup = JSON.parse(json) as BackupPayload;
          if (!Number.isInteger(backup.schema_version) || backup.schema_version < 1 || backup.schema_version > 13) {
            await message(i18n.t('fileStore.backupVersionError', { version: backup.schema_version }), { title: i18n.t('fileStore.backupVersionTitle'), kind: 'error' });
            return;
          }
        }

        const confirmed = await ask(i18n.t('fileStore.restoreAsk'), {
          title: i18n.t('fileStore.restoreTitle'),
          kind: 'warning',
          okLabel: i18n.t('fileStore.restoreTitle'),
          cancelLabel: i18n.t('common.cancel'),
        });
        if (!confirmed) return;
      }

      if (useRestoreGuard.getState().active || useImportStore.getState().phase === 'committing' || get().confirming) {
        useFeedbackStore.getState().show(i18n.t('fileStore.restoreImportBusy'), 'error');
        return;
      }
      useRestoreGuard.getState().setActive(true); ownsGuard = true;
      const result = mergeBackupId
        ? await invoke<{ safety_backup_path: string }>('restore_device_merge_backup', { id: mergeBackupId })
        : archivePath
          ? await invoke<{ safety_backup_path: string }>('restore_library_archive', { path: archivePath })
          : await invoke<{ safety_backup_path: string }>('restore_all', { backup });
      committed = result;
      discardRestoreState();
      await Promise.all([get().loadFiles(true, true), get().loadTags(true, true)]);
      useFeedbackStore.getState().show(i18n.t('fileStore.restoredWithBackup', { path: result.safety_backup_path }), 'success', 15000);
    } catch (e) {
      console.error('Restore failed:', e);
      if (committed) {
        useFeedbackStore.getState().show(i18n.t('fileStore.restoreRefreshFailed', { path: committed.safety_backup_path }), 'error', 15000);
        return;
      }
      const detail = String(e);
      if (detail.includes('restore_status_unknown:')) {
        try { discardRestoreState(); } catch (cleanupError) { console.error('Restore state cleanup failed:', cleanupError); }
        useFeedbackStore.getState().show(i18n.t('fileStore.restoreStatusUnknown'), 'error', 15000);
        return;
      }
      const safetyFailure = detail.includes('restore_safety_backup_failed:');
      const backupPath = detail.match(/restore_failed; safety_backup_path=(.*?): /)?.[1];
      useFeedbackStore.getState().show(i18n.t(safetyFailure ? 'fileStore.restoreSafetyFailed' : backupPath ? 'fileStore.restoreFailedWithBackup' : 'fileStore.restoreFailed', { path: backupPath }), 'error', 15000);
    } finally {
      if (ownsGuard) useRestoreGuard.getState().setActive(false);
    }
  },
}));
