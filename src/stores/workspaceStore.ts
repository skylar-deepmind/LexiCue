import { create } from 'zustand';
export const useWorkspaceStore = create<{
    panels: symbol[];
    add: (id: symbol) => void;
    remove: (id: symbol) => void;
}>((set) => ({
    panels: [], add: id => set(state => ({ panels: [...state.panels, id] })), remove: id => set(state => ({ panels: state.panels.filter(item => item !== id) })),
}));
