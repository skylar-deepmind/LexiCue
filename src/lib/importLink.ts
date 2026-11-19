import { isTauri } from '@tauri-apps/api/core';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export type ImportLinkError = 'clipboardEmpty' | 'invalidLink' | 'unsupportedLink';
export type ImportLink = { url: string; error?: undefined } | { url: string; error: ImportLinkError };

/** Validate locally before handing any clipboard content to a network source. */
export function inspectImportLink(text: string | null): ImportLink {
  const value = text?.trim() ?? '';
  if (!value) return { url: '', error: 'clipboardEmpty' };
  if (value.length > 8192) return { url: '', error: 'invalidLink' };
  let url: URL;
  try { url = new URL(value); } catch { return { url: '', error: 'invalidLink' }; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return { url: '', error: 'invalidLink' };
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname) || url.port) {
    return { url: value, error: 'unsupportedLink' };
  }
  return { url: value };
}

/** Called only from the user's Paste link action. No polling or write access. */
export async function readImportClipboard(): Promise<string | null> {
  if (!isTauri()) return navigator.clipboard.readText();
  try { return await readText(); }
  catch (error) {
    // The desktop and iOS plugins reject when there is no text format. This
    // is an empty text source; permission and transport failures still reject.
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : null;
    if (message === 'The clipboard contents were not available in the requested format or the clipboard is empty.' || message === 'Clipboard is empty') return null;
    throw error;
  }
}
