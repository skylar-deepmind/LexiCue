import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { bindMediaTarget, type MediaRef, type MediaStatus, type MediaTarget } from '../lib/sourceMedia';

const requests = new Map<string, number>();

export const useSourceMediaStore = create<{
  entries: Record<string, MediaStatus>;
  refresh: (reference: MediaRef, target: MediaTarget) => Promise<void>;
}>((set) => ({
  entries: {},
  refresh: async (reference, target) => {
    const key = reference.source.key;
    const request = (requests.get(key) ?? 0) + 1;
    requests.set(key, request);
    let status: MediaStatus;
    try {
      status = await invoke<MediaStatus>('source_media_status', { target: bindMediaTarget(reference, target) });
    } catch {
      status = { status: 'missing' };
    }
    if (requests.get(key) === request) set(s => ({ entries: { ...s.entries, [key]: status } }));
  },
}));
