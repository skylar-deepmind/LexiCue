import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Material } from '../lib/materials';
let request = 0;
export const useMaterialStore = create<{
    files: Material[];
    loading: boolean;
    error: boolean;
    revision: number;
    view: 'gallery' | 'list';
    current: Material | null;
    load: (tagIds?: number[], untagged?: boolean) => Promise<void>;
    changed: () => void;
    setView: (view: 'gallery' | 'list') => void;
}>((set, get) => ({
    files: [], loading: true, error: false, revision: 0, view: localStorage.getItem('lexicue-material-view') === 'list' ? 'list' : 'gallery', current: null,
    setView: view => { localStorage.setItem('lexicue-material-view', view); set({ view }); },
    changed: () => set({ revision: get().revision + 1 }),
    load: async (tagIds = [], untagged = false) => {
        const id = ++request;
        set({ loading: true, error: false });
        try {
            const files = await invoke<Material[]>('list_materials', { tagIds, untagged });
            if (id === request)
                set({ files });
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
