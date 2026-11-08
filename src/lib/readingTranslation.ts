import { invoke } from '@tauri-apps/api/core';
import { translateImportSegments, type TranslationProgress } from './importTranslation';
import type { Segment } from './types';

// Small transport/write batches keep the full-material job cancellable and
// retain completed work if a later request fails. This is not a UI limit.
export const READING_TRANSLATION_BATCH = 8;
export interface ReadingTranslationUpdate { id: number; zh_text: string }
export async function translateReadingBatch(fileId: number, contentHash: string, segments: Segment[], signal: AbortSignal,
    onProgress?: (translations: ReadingTranslationUpdate[], progress: TranslationProgress) => void) {
    const missing = segments.filter(segment => !!segment.en_text.trim() && !segment.zh_text?.trim());
    const translations: ReadingTranslationUpdate[] = [];
    for (let start = 0; start < missing.length; start += READING_TRANSLATION_BATCH) {
        if (signal.aborted) throw new Error('material_cancelled');
        const batch = missing.slice(start, start + READING_TRANSLATION_BATCH);
        const result = await translateImportSegments(batch.map(segment => ({...segment, index: segment.index_num})), signal, () => {});
        if (signal.aborted) throw new Error('material_cancelled');
        const translated = new Map(result.segments.map(segment => [segment.index, segment.zh_text]));
        const updates = batch.flatMap(segment => {
            const text = translated.get(segment.index_num)?.trim();
            return text ? [{id: segment.id, en_text: segment.en_text, zh_text: text}] : [];
        });
        const stored = updates.length ? await invoke<ReadingTranslationUpdate[]>('fill_reading_translations', {fileId, contentHash, segments: updates}) : [];
        if (signal.aborted) throw new Error('material_cancelled');
        translations.push(...stored);
        onProgress?.(stored, {done: translations.length, total: missing.length});
        if (result.failed || stored.length < batch.length) return {translations, failed: true};
    }
    if (signal.aborted) throw new Error('material_cancelled');
    return {translations, failed: false};
}
