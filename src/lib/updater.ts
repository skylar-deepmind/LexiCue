import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';

export type { Update };

export interface LatestRelease {
  version: string;
  url: string;
  publishedAt?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percent: number;
}

export function checkForUpdates(): Promise<Update | null> {
  return check();
}

export async function checkGithubRelease(): Promise<LatestRelease | null> {
  return invoke<LatestRelease | null>('check_github_release');
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map((part) => Number(part));
  const b = current.replace(/^v/, '').split('.').map((part) => Number(part));
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export function downloadAndInstall(
  update: Update,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  let contentLength: number | null = null;
  let downloaded = 0;

  return update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? null;
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        break;
      case 'Finished':
        break;
    }
    onProgress?.({
      downloaded,
      total: contentLength,
      percent: contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0,
    });
  });
}

export function relaunchApp(): Promise<void> {
  return relaunch();
}
