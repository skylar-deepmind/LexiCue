import { create } from 'zustand';
import { getVersion } from '@tauri-apps/api/app';
import {
  checkForUpdates,
  checkGithubRelease,
  downloadAndInstall,
  isNewerVersion,
  relaunchApp,
  type Update,
} from '../lib/updater';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'upToDate'
  | 'downloading'
  | 'error';

interface UpdateStore {
  status: UpdateStatus;
  update: Update | null;
  version: string | null;
  notes: string | null;
  downloadUrl: string | null;
  progress: number;
  error: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  reset: () => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: 'idle',
  update: null,
  version: null,
  notes: null,
  downloadUrl: null,
  progress: 0,
  error: null,
  check: async () => {
    if (get().status === 'checking' || get().status === 'downloading') return;
    set({ status: 'checking', error: null });
    try {
      let update: Update | null = null;
      let updaterAvailable = true;
      try {
        update = await checkForUpdates();
      } catch {
        updaterAvailable = false;
      }

      if (update) {
        set({
          status: 'available',
          update,
          version: update.version,
          notes: update.body ?? null,
          downloadUrl: null,
        });
        return;
      }
      if (updaterAvailable) {
        set({ status: 'upToDate', update: null, version: null, notes: null, downloadUrl: null });
        return;
      }

      const release = await checkGithubRelease();
      if (!release) {
        set({ status: 'upToDate', update: null, version: null, notes: null, downloadUrl: null });
        return;
      }
      const current = await getVersion();
      if (isNewerVersion(release.version, current)) {
        set({
          status: 'available',
          update: null,
          version: release.version,
          notes: null,
          downloadUrl: release.url,
        });
      } else {
        set({ status: 'upToDate', update: null, version: null, notes: null, downloadUrl: null });
      }
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },
  install: async () => {
    const { update, status } = get();
    if (!update || (status !== 'available' && status !== 'error')) return;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      await downloadAndInstall(update, (progress) => {
        set({ progress: progress.percent });
      });
      set({ progress: 100 });
      await relaunchApp();
    } catch (error) {
      set({ status: 'error', error: String(error) });
    }
  },
  reset: () =>
    set({ status: 'idle', update: null, version: null, notes: null, downloadUrl: null, progress: 0, error: null }),
}));
