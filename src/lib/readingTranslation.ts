import { invoke } from '@tauri-apps/api/core';
import { translateImportSegments } from './importTranslation';
import type { Segment } from './types';

export const READING_TRANSLATION_BATCH = 8;
/** Only explicit, small reading requests can reach the existing translation service. */
export async function translateReadingBatch(fileId: number, contentHash: string, segments: Segment[], signal: AbortSignal) {
    const batch = segments.filter(segment => !segment.zh_text?.trim()).slice(0, READING_TRANSLATION_BATCH);
    if (signal.aborted) throw new Error('material_cancelled');
    if (!batch.length) return {translations: [] as Array<{id: number; zh_text: string}>, failed: false};
    const result = await translateImportSegments(batch.map(segment => ({...segment, index: segment.index_num})), signal, () => {});
    if (signal.aborted) throw new Error('material_cancelled');
    const translated = new Map(result.segments.map(segment => [segment.index, segment.zh_text]));
    const updates = batch.flatMap(segment => {
        const text = translated.get(segment.index_num)?.trim();
        return text ? [{id: segment.id, en_text: segment.en_text, zh_text: text}] : [];
    });
    const translations = updates.length ? await invoke<Array<{id: number; zh_text: string}>>('fill_reading_translations', {fileId, contentHash, segments: updates}) : [];
    if (signal.aborted) throw new Error('material_cancelled');
    return {translations, failed: result.failed || translations.length < batch.length};
}
