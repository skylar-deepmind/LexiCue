import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { bindMediaTarget, type MediaRef, type MediaStatus, type MediaTarget } from '../lib/sourceMedia';
import { usePreferencesStore } from './preferencesStore';
import { EMPTY_BROWSER_SESSION } from '../lib/youtubeDownload';
let sequence = Date.now();
const jobs = new Map<string, number>();
export const useSourceMediaStore = create<{
  entries: Record<string, MediaStatus>;
  refresh: (reference: MediaRef, target: MediaTarget) => Promise<void>;
  prepare: (reference: MediaRef, target: MediaTarget) => Promise<void>;
  cancel: (key: string) => void;
}>((set, get) => {
  const update = (key: string, value: MediaStatus) => set(s => ({ entries: { ...s.entries, [key]: value } }));
  return {
    entries: {},
    refresh: async (reference, target) => {
      const key = reference.source.key;
      if (jobs.has(key)) return;
      try { const result = await invoke<MediaStatus>('source_media_status', { target: bindMediaTarget(reference, target) }); if (!jobs.has(key)) update(key, result); }
      catch { if (!jobs.has(key)) update(key, { status: 'missing' }); }
    },
    prepare: async (reference, target) => {
      const key = reference.source.key;
      if (jobs.has(key) || get().entries[key]?.status === 'ready') return;
      const job = ++sequence; jobs.set(key, job); update(key, { status: 'preparing' });
      try {
        const result = await invoke<MediaStatus>('prepare_source_media', { target: bindMediaTarget(reference, target), jobId: job,
          session: usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION });
        if (jobs.get(key) === job) update(key, result);
      } catch (error) {
        if (jobs.get(key) === job) update(key, { status: 'failed', error: String(error).slice(0, 120) });
      } finally { if (jobs.get(key) === job) jobs.delete(key); }
    },
    cancel: key => {
      const job = jobs.get(key); if (job === undefined) return;
      jobs.delete(key); update(key, { status: 'missing', error: 'media_cancelled' });
      void invoke('youtube_cancel_job', { jobId: job }).catch(() => {});
    },
  };
});
