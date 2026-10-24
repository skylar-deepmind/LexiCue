import type { OpenDialogOptions } from '@tauri-apps/plugin-dialog';
import { importFileName } from './materials';

export function materialPickerOptions(): OpenDialogOptions {
  // Android providers disagree about subtitle MIME types. Validate the real
  // display name and SRT contents after selection instead of hiding valid files.
  return /Android/i.test(navigator.userAgent)
    ? { multiple: true }
    : { multiple: true, filters: [{ name: 'English SRT', extensions: ['srt'] }] };
}

export function selectedMaterialName(path: string): string {
  if (!/^content:/i.test(path)) return importFileName(path);
  const bridge = (window as Window & {
    LexiCueSystemUi?: { documentDisplayName?: (uri: string) => string | null };
  }).LexiCueSystemUi;
  const name = bridge?.documentDisplayName?.(path);
  if (!name?.trim()) throw new Error('material_read_failed');
  return name;
}

export function pickedMaterialSource(path: string, read: (path: string) => Promise<string>) {
  try {
    const name = selectedMaterialName(path);
    return { name, read: () => read(path) };
  } catch {
    // Keep metadata failures per file, so other selections can still import.
    // This placeholder is never written into a material or saved snapshot.
    return { name: 'subtitles.srt', read: async (): Promise<string> => { throw new Error('material_read_failed'); } };
  }
}
