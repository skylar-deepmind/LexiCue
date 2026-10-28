import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SegmentInput } from './types';

export interface TranslationProgress { done: number; total: number }
export interface ImportTranslationResult { segments: SegmentInput[]; failed: boolean }
let sequence = Date.now();

export async function translateImportSegments(segments: SegmentInput[], signal: AbortSignal,
  progress: (value: TranslationProgress) => void): Promise<ImportTranslationResult> {
  const missing = segments.filter(segment => !segment.zh_text?.trim());
  if (!missing.length) return { segments, failed: false };
  const jobId = ++sequence;
  const abort = () => { void invoke('cancel_import_translation', { jobId }).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let unlisten: (() => void) | undefined;
  try {
    if (signal.aborted) throw new Error('material_cancelled');
    progress({ done: 0, total: missing.length });
    unlisten = await listen<TranslationProgress & { jobId: number }>('import-translation-progress', event => {
      if (event.payload.jobId === jobId && !signal.aborted) progress(event.payload);
    });
    if (signal.aborted) throw new Error('material_cancelled');
    const result = await invoke<{ translations: Array<{ index: number; translation: string }>; error: string | null }>(
      'translate_import_sentences', { jobId, sentences: missing.map(segment => ({ index: segment.index, text: segment.en_text })) });
    if (signal.aborted) throw new Error('material_cancelled');
    const translations = new Map(result.translations.map(row => [row.index, row.translation.trim()]));
    const translated = segments.map(segment => segment.zh_text?.trim() ? segment
      : { ...segment, zh_text: translations.get(segment.index) || null });
    return { segments: translated, failed: !!result.error || translated.some(segment => !segment.zh_text) };
  } catch (error) {
    if (signal.aborted) throw error;
    return { segments, failed: true };
  } finally {
    signal.removeEventListener('abort', abort);
    unlisten?.();
  }
}
