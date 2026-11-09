import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { SegmentInput } from './types';

export interface TranslationProgress { done: number; total: number }
export interface ImportTranslationResult { segments: SegmentInput[]; failed: boolean }
let sequence = Date.now();

// The service accepts at most 1,400 characters per line. Split only transport
// text; the original sentence, timing and its eventual writeback stay intact.
function translationParts(text: string): string[] {
  const points = Array.from(text.replace(/\s+/g, ' ').trim());
  const parts: string[] = [];
  for (let at = 0; at < points.length;) {
    let size = Math.min(1200, points.length - at);
    if (at + size < points.length) {
      const space = points.slice(at, at + size).findLastIndex(point => point === ' ');
      if (space >= 600) size = space + 1;
    }
    parts.push(points.slice(at, at + size).join('').trim());
    at += size;
  }
  return parts;
}

export async function translateImportSegments(segments: SegmentInput[], signal: AbortSignal,
  progress: (value: TranslationProgress) => void): Promise<ImportTranslationResult> {
  const missing = segments.filter(segment => !!segment.en_text.trim() && !segment.zh_text?.trim());
  if (!missing.length) return { segments, failed: false };
  let nextIndex = segments.reduce((max, segment) => Math.max(max, segment.index), -1) + 1;
  const sentences: Array<{index: number; text: string}> = [];
  const plans = missing.map(segment => ({segment, parts: translationParts(segment.en_text).map((text, part) => {
    const row = {index: part ? nextIndex++ : segment.index, text};
    const position = sentences.length; sentences.push(row);
    return {...row, position};
  })}));
  const jobId = ++sequence;
  const abort = () => { void invoke('cancel_import_translation', { jobId }).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let unlisten: (() => void) | undefined;
  try {
    if (signal.aborted) throw new Error('material_cancelled');
    progress({ done: 0, total: missing.length });
    unlisten = await listen<TranslationProgress & { jobId: number }>('import-translation-progress', event => {
      if (event.payload.jobId === jobId && !signal.aborted) progress({done: plans.filter(plan => plan.parts.every(part => part.position < event.payload.done)).length, total: missing.length});
    });
    if (signal.aborted) throw new Error('material_cancelled');
    const result = await invoke<{ translations: Array<{ index: number; translation: string }>; error: string | null }>(
      'translate_import_sentences', { jobId, sentences });
    if (signal.aborted) throw new Error('material_cancelled');
    const translations = new Map(result.translations.map(row => [row.index, row.translation.trim()]));
    const completed = new Map(plans.filter(plan => plan.parts.every(part => translations.has(part.index) && !!translations.get(part.index)))
      .map(plan => [plan.segment.index, plan.parts.map(part => translations.get(part.index)).join(' ')]));
    const translated = segments.map(segment => segment.zh_text?.trim() ? segment
      : { ...segment, zh_text: completed.get(segment.index) || null });
    progress({done: completed.size, total: missing.length});
    return { segments: translated, failed: !!result.error || missing.some(segment => !completed.has(segment.index)) };
  } catch (error) {
    if (signal.aborted) throw error;
    return { segments, failed: true };
  } finally {
    signal.removeEventListener('abort', abort);
    unlisten?.();
  }
}
