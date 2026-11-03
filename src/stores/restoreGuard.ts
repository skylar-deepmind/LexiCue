import { create } from 'zustand';
/** Synchronous guard shared by the restore command and import commit entry points. */
export const useRestoreGuard = create<{ active: boolean; generation: number; setActive: (active: boolean) => void }>(set => ({
  active: false, generation: 0,
  setActive: active => set(state => ({ active, generation: active ? state.generation + 1 : state.generation })),
}));
