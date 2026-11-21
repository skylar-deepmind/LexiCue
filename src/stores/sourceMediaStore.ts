import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { bindMediaTarget, type MediaRef, type MediaStatus, type MediaTarget } from '../lib/sourceMedia';

export const useSourceMediaStore = create<{
  entries: Record<string, MediaStatus>;
  refresh: (reference: MediaRef, target: MediaTarget) => Promise<void>;
}>((set) => ({
  entries: {},
  refresh: async (reference, target) => {
    let status: MediaStatus;
    try {
      status = await invoke<MediaStatus>('source_media_status', { target: bindMediaTarget(reference, target) });
    } catch {
      status = { status: 'missing' };
    }
    set(s => ({ entries: { ...s.entries, [reference.source.key]: status } }));
  },
}));
