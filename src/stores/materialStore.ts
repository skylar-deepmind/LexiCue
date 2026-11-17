import { migrateLocalReading } from '../lib/portableReading';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Material } from '../lib/materials';
import { useReadingDeskStore } from './readingDeskStore';
let request = 0;
let loadedRevision = -1;
let pending: { revision: number; promise: Promise<void> } | undefined;
function savedView(): 'gallery' | 'list' { try { return localStorage.getItem('lexicue-material-view') === 'list' ? 'list' : 'gallery'; } catch { return 'gallery'; } }
export const useMaterialStore = create<{
    files: Material[];
    loading: boolean;
    error: boolean;
    hasLoaded: boolean;
    revision: number;
    view: 'gallery' | 'list';
    current: Material | null;
    load: (tagIds?: number[], untagged?: boolean) => Promise<void>;
    ensure: () => Promise<void>;
    updatePosition: (fileId: number, contentHash: string, position: NonNullable<Material['position']>) => void;
    changed: () => void;
    resetAfterRestore: () => void;
    setView: (view: 'gallery' | 'list') => void;
}>((set, get) => ({
    files: [], loading: true, error: false, hasLoaded: false, revision: 0, view: savedView(), current: null,
    setView: view => { try {localStorage.setItem('lexicue-material-view', view);} catch {/* optional */} set({ view }); },
    changed: () => set({ revision: get().revision + 1 }),
    resetAfterRestore: () => { ++request; set(state => ({ files: [], current: null, loading: false, error: false, hasLoaded: false, revision: state.revision + 1 })); },
    ensure: () => {
        const state = get();
        if (state.hasLoaded && !state.error && loadedRevision === state.revision) return Promise.resolve();
        return pending?.revision === state.revision ? pending.promise : state.load();
    },
    updatePosition: (fileId, contentHash, position) => set(state => ({
        files: state.files.map(file => file.id === fileId && file.content_hash === contentHash ? { ...file, position } : file),
    })),
    load: (tagIds = [], untagged = false) => {
        const revision = get().revision;
        const full = !tagIds.length && !untagged;
        const id = ++request;
        set({ loading: true, error: false });
        const promise = (async () => {
            try {
                const files = await invoke<Material[]>('list_materials', { tagIds, untagged });
                if (full && id === request) await migrateLocalReading(files);
                if (id === request) {
                    loadedRevision = full ? revision : -1;
                    set({ files, hasLoaded: true });
                    if (full) useReadingDeskStore.getState().reconcile(files);
                }
            } catch {
                if (id === request) set({ error: true });
            } finally {
                if (id === request) set({ loading: false });
            }
        })();
        if (full) {
            pending = { revision, promise };
            void promise.finally(() => { if (pending?.promise === promise) pending = undefined; });
        }
        return promise;
    },
}));
