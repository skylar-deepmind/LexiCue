import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('navigator', { language: 'en' });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: vi.fn() });
  return { invoke: vi.fn(), open: vi.fn(), ask: vi.fn(), read: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../lib/confirmAction', () => ({ confirmAction: mocks.ask, notifyMessage: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, ask: mocks.ask, message: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.read, writeTextFile: vi.fn() }));
vi.mock('../../i18n', () => ({ default: { t: (key: string, values?: {path?: string}) => `${key}:${values?.path ?? ''}` } }));
import { useFileStore } from '../fileStore';
import { useMaterialStore } from '../materialStore';
import { useReaderStore } from '../readerStore';
import { useRecallStore } from '../recallStore';
import { useFeedbackStore } from '../feedbackStore';
import { readerNavigation, savedNoteDrafts } from '../../lib/readerNavigation';
import type { Material } from '../../lib/materials';
const old = {id: 1, name:'old', content_hash:'old-hash', segment_count:1, preview:'old', imported_at:0, tags:[]} as Material;
const origin = {kind:'saved' as const, path:'/saved' as const, view:{query:'',loadedGroups:1,expandedGroupId:null,loadedContexts:{},scrollTop:0}};
const target = {recordId:'old',fileId:1,segmentIndex:0,contentHash:'old-hash',sentence:'old',expression:'old',start:null,end:null};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockResolvedValue('/backup.json'); mocks.read.mockResolvedValue('{"schema_version":12}'); mocks.ask.mockResolvedValue(true);
  mocks.invoke.mockImplementation(async (command: string) => command === 'restore_all' ? {safety_backup_path:'/safety.db'} : []);
  vi.spyOn(useFeedbackStore.getState(), 'show').mockImplementation(() => 0);
  useMaterialStore.setState({files:[old],current:old,hasLoaded:true});
  useReaderStore.setState({currentFileId:1,segments:[{id:1} as never]});
  useRecallStore.setState({expressions:['old'],loaded:true});
  savedNoteDrafts.clear(); savedNoteDrafts.set('old',{text:'draft',revision:'1'});
});
it.each(['cancel-file','cancel-confirm','backup-failure','restore-failure'])('keeps live state on %s', async mode => {
  const token=readerNavigation.create(origin,target);
  if(mode==='cancel-file') mocks.open.mockResolvedValue(null);
  if(mode==='cancel-confirm') mocks.ask.mockResolvedValue(false);
  if(mode==='backup-failure') mocks.invoke.mockRejectedValue('restore_safety_backup_failed: disk full');
  if(mode==='restore-failure') mocks.invoke.mockRejectedValue('restore_failed; safety_backup_path=/safety.db: invalid');
  await useFileStore.getState().restoreAll();
  expect(useMaterialStore.getState().current).toEqual(old);
  expect(useReaderStore.getState().segments).toHaveLength(1);
  expect(useRecallStore.getState().expressions).toEqual(['old']);
  expect(readerNavigation.get(token)).toBeDefined(); expect(savedNoteDrafts.has('old')).toBe(true);
  if(mode.startsWith('cancel')) expect(useFeedbackStore.getState().show).not.toHaveBeenCalled();
  else expect(useFeedbackStore.getState().show).toHaveBeenCalledWith(expect.stringContaining(mode==='backup-failure'?'restoreSafetyFailed':'restoreFailedWithBackup'), 'error', 15000);
});
it('clears old sessions and ignores a pending old catalog after successful restore', async () => {
  const token=readerNavigation.create(origin,target);
  let resolveOld!: (value: Material[]) => void;
  mocks.invoke.mockImplementation((command:string) => command === 'list_materials' ? new Promise(resolve => {resolveOld=resolve;}) : Promise.resolve(command === 'restore_all' ? {safety_backup_path:'/safety.db'} : []));
  const pending=useMaterialStore.getState().load();
  await useFileStore.getState().restoreAll();
  resolveOld([old]); await pending;
  expect(useMaterialStore.getState().files).toEqual([]); expect(useMaterialStore.getState().current).toBeNull();
  expect(useReaderStore.getState().segments).toEqual([]); expect(useRecallStore.getState().expressions).toEqual([]);
  expect(readerNavigation.get(token)).toBeUndefined(); expect(savedNoteDrafts.size).toBe(0);
  expect(useFeedbackStore.getState().show).toHaveBeenCalledWith('fileStore.restoredWithBackup:/safety.db','success',15000);
});
it('reports a committed restore accurately if refreshing the interface throws', async () => {
  const { useSpeechStore } = await import('../speechStore');
  const stop = vi.spyOn(useSpeechStore.getState(), 'stop').mockImplementationOnce(() => { throw Error('refresh failure'); });
  await useFileStore.getState().restoreAll();
  expect(useFeedbackStore.getState().show).toHaveBeenCalledWith('fileStore.restoreRefreshFailed:/safety.db','error',15000);
  stop.mockRestore();
});
it('discards warm old files and tags if the post-restore reload fails', async () => {
  mocks.invoke.mockImplementation(async (command: string) => command === 'list_files' ? [{id:1,name:'old'}] : command === 'list_tags' ? [{id:7,name:'old tag'}] : {safety_backup_path:'/safety.db'});
  await useFileStore.getState().loadFiles(true); await useFileStore.getState().loadTags(true);
  expect(useFileStore.getState().files).toHaveLength(1); expect(useFileStore.getState().tags).toHaveLength(1);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'restore_all') return {safety_backup_path:'/safety.db'};
    throw Error('reload failed');
  });
  await useFileStore.getState().restoreAll();
  expect(useFileStore.getState().files).toEqual([]); expect(useFileStore.getState().tags).toEqual([]);
  expect(useFeedbackStore.getState().show).toHaveBeenCalledWith('fileStore.restoreRefreshFailed:/safety.db','error',15000);
});
it('does not invoke restore while a material import is committing', async () => {
  const { useImportStore } = await import('../importStore');
  useImportStore.setState({phase:'committing'});
  try {
    await useFileStore.getState().restoreAll();
    expect(mocks.invoke).not.toHaveBeenCalledWith('restore_all', expect.anything());
    expect(useMaterialStore.getState().current).toEqual(old);
    expect(useFeedbackStore.getState().show).toHaveBeenCalledWith('fileStore.restoreImportBusy:', 'error');
  } finally { useImportStore.setState({phase:'source'}); }
});
it('holds the restore guard through native work and releases it on failure, blocking import commits', async () => {
  const { useRestoreGuard } = await import('../restoreGuard');
  const { useImportStore } = await import('../importStore');
  let reject!: (reason: unknown) => void;
  mocks.invoke.mockImplementation((command: string) => command === 'restore_all' ? new Promise((_resolve, fail) => {reject=fail;}) : Promise.resolve([]));
  const restoring = useFileStore.getState().restoreAll();
  await vi.waitFor(() => expect(useRestoreGuard.getState().active).toBe(true));
  useImportStore.setState({phase:'preview',running:false,items:[{id:'a', name:'A', stage:'ready', draft:{operation_id:'op',name:'A',content:'text',segments:[],wordCount:1},read:async()=>''}]});
  await useImportStore.getState().confirm();
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'import_reading_material')).toBe(false);
  expect(useImportStore.getState().phase).toBe('preview');
  reject('restore_safety_backup_failed: disk'); await restoring;
  expect(useRestoreGuard.getState().active).toBe(false);
  useImportStore.setState({phase:'source',items:[]});
});
it('clears potentially stale state and reports an unknown restore outcome without claiming failure or success', async () => {
  const token=readerNavigation.create(origin,target);
  mocks.invoke.mockRejectedValue('restore_status_unknown: restore worker failed');
  await useFileStore.getState().restoreAll();
  expect(useMaterialStore.getState().current).toBeNull();
  expect(useReaderStore.getState().segments).toEqual([]);
  expect(useRecallStore.getState().expressions).toEqual([]);
  expect(readerNavigation.get(token)).toBeUndefined();
  expect(useFeedbackStore.getState().show).toHaveBeenCalledWith('fileStore.restoreStatusUnknown:', 'error', 15000);
  expect(useFeedbackStore.getState().show).not.toHaveBeenCalledWith(expect.stringContaining('restoreFailed:'), expect.anything(), expect.anything());
});
