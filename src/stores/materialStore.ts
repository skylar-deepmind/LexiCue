import { migrateLocalReading } from '../lib/portableReading';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Material } from '../lib/materials';
import { useReadingDeskStore } from './readingDeskStore';
let request = 0;
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
    changed: () => void;
    resetAfterRestore: () => void;
    setView: (view: 'gallery' | 'list') => void;
}>((set, get) => ({
    files: [], loading: true, error: false, hasLoaded: false, revision: 0, view: savedView(), current: null,
    setView: view => { try {localStorage.setItem('lexicue-material-view', view);} catch {/* optional */} set({ view }); },
    changed: () => set({ revision: get().revision + 1 }),
    resetAfterRestore: () => { ++request; set(state => ({ files: [], current: null, loading: false, error: false, hasLoaded: false, revision: state.revision + 1 })); },
    load: async (tagIds = [], untagged = false) => {
        const id = ++request;
        set({ loading: true, error: false });
        try {
            const files = await invoke<Material[]>('list_materials', { tagIds, untagged });
            if (!tagIds.length && !untagged) await migrateLocalReading(files);
            if (id === request) {
                set({ files, hasLoaded: true });
                if (!tagIds.length && !untagged) useReadingDeskStore.getState().reconcile(files);
            }
        }
        catch {
            if (id === request)
                set({ error: true });
        }
        finally {
            if (id === request)
                set({ loading: false });
        }
    },
}));
