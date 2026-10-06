import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('navigator', { language: 'en' });
  return { invoke: vi.fn(), open: vi.fn(), ask: vi.fn(), read: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, ask: mocks.ask, message: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.read, writeTextFile: vi.fn() }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../lib/hash', () => ({ computeHash: async () => 'hash' }));
vi.mock('../../lib/parser', () => ({ parseFile: () => ({ segments: [{ index: 0, en_text: 'Hello', zh_text: null }], lemmas: [], occurrences: [] }) }));

import { useFileStore } from '../fileStore';
import { usePreferencesStore } from '../preferencesStore';
import { useFeedbackStore } from '../feedbackStore';
import { invalidateCaches } from '../../lib/cacheInvalidation';
import type { FileRecord } from '../../lib/types';

const tags = [{ id: 1, name: 'Study', created_at: 1 }, { id: 2, name: 'Podcast', created_at: 2 }];
const oldFile = { id: 10, name: 'old.txt', tags } as FileRecord;
const store = () => useFileStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(useFeedbackStore.getState(), 'show').mockImplementation(() => 0);
  invalidateCaches('files');
  usePreferencesStore.setState({ language: 'en' });
  useFileStore.setState({ files: [], tags, selectedTagIds: [], untaggedOnly: false, pendingImport: null, confirming: false, loading: false, loadingTags: false, tagsError: false });
  mocks.open.mockResolvedValue('/tmp/new.txt'); mocks.read.mockResolvedValue('Hello'); mocks.ask.mockResolvedValue(true);
  mocks.invoke.mockImplementation(async command => {
    if (command === 'list_tags') return tags;
    if (command === 'list_files') return [];
    if (command === 'get_file_info') return oldFile;
    if (command === 'tokenize_english_batch') return [[]];
    if (command === 'import_file') return 12;
    return null;
  });
});

describe('file tags', () => {
  it('does not inherit filters or create draft tags when a new import is cancelled', async () => {
    useFileStore.setState({ selectedTagIds: [1,2] });
    await store().importFile();
    await store().setImportLanguage('en');
    expect(store().pendingImport?.tags).toEqual({ tagIds: [], newTagNames: [] });
    store().setImportTags({ tagIds: [1], newTagNames: ['Draft'] });
    store().cancelImport();
    expect(store().pendingImport).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => ['create_tag','import_file'].includes(command))).toBe(false);
  });

  it('prefills replacement tags and submits their final selection with the Rust field names', async () => {
    mocks.invoke.mockImplementation(async command => command === 'check_duplicate' ? { file_id: 10, name: 'old.txt' }
      : command === 'get_file_info' ? oldFile : command === 'list_tags' ? tags : command === 'import_file' ? 12 : []);
    await store().importFile(); await store().setImportLanguage('en');
    expect(store().pendingImport?.tags.tagIds).toEqual([1,2]);
    store().setImportTags({ tagIds: [2], newTagNames: ['Fresh'] });
    await store().confirmImport();
    expect(mocks.invoke).toHaveBeenCalledWith('import_file', { payload: expect.objectContaining({ replace_file_id: 10, tag_ids: [2], new_tag_names: ['Fresh'] }) });
    expect(store().pendingImport).toBeNull();
  });

  it('retains the import and tag draft when the transaction fails', async () => {
    await store().importFile(); await store().setImportLanguage('en');
    store().setImportTags({ tagIds: [1], newTagNames: ['Keep'] });
    mocks.invoke.mockRejectedValueOnce(new Error('write failed'));
    await store().confirmImport();
    expect(store().pendingImport?.tags).toEqual({ tagIds: [1], newTagNames: ['Keep'] });
    expect(store().confirming).toBe(false);
  });

  it('offers view all for an import hidden by the active filter without clearing it automatically', async () => {
    useFileStore.setState({ selectedTagIds: [2] });
    await store().importFile(); await store().setImportLanguage('en'); await store().confirmImport();
    expect(store().selectedTagIds).toEqual([2]);
    expect(useFeedbackStore.getState().show).toHaveBeenLastCalledWith(expect.any(String),'success',10000,expect.objectContaining({ label: 'tags.viewAll' }));
    const action = vi.mocked(useFeedbackStore.getState().show).mock.calls.at(-1)?.[3];
    action?.onClick(); expect(store().selectedTagIds).toEqual([]);
  });

  it('does not cancel a forced tag refresh when another view reads the warm cache', async () => {
    await store().loadTags(true);
    let resolve!: (value: typeof tags) => void;
    mocks.invoke.mockImplementation(command => command === 'list_tags' ? new Promise(done => { resolve = done; }) : Promise.resolve([]));
    const refresh = store().loadTags(true);
    await store().loadTags();
    const updated = [...tags, { id: 3, name: 'New', created_at: 3 }];
    resolve(updated); await refresh;
    expect(store().tags).toEqual(updated); expect(store().loadingTags).toBe(false);
  });

  it('ignores a late file query when the selected tags change', async () => {
    let resolveOld!: (value: FileRecord[]) => void;
    mocks.invoke.mockImplementation(async (command,args) => command === 'list_files'
      ? args.tagIds.includes(1) ? new Promise(resolve => { resolveOld = resolve; }) : [oldFile] : tags);
    store().setTagFilter([1]);
    store().setTagFilter([2]);
    await store().loadFiles();
    resolveOld([]); await Promise.resolve(); await Promise.resolve();
    expect(store().files).toEqual([oldFile]); expect(store().selectedTagIds).toEqual([2]); expect(store().loading).toBe(false);
    store().setTagFilter([],true); expect(store().selectedTagIds).toEqual([]); expect(store().untaggedOnly).toBe(true);
    store().setTagFilter([2]); expect(store().untaggedOnly).toBe(false);
  });
});
