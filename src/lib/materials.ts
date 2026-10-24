import type { Segment, SegmentInput, TagInfo } from './types';
import type { ReaderToken } from '../stores/readerStore';
export interface Material {
    id: number;
    name: string;
    content_hash: string;
    imported_at: number;
    segment_count: number;
    preview: string;
    tags: TagInfo[];
}
export interface ReadingMaterial {
    material: Material;
    segments: Segment[];
    tokens: ReaderToken[];
}
export interface ReadingExplanation {
    meaning: string;
    source: 'dictionary' | 'ai' | 'personal' | 'unknown';
    provider: string;
    more: string[];
}
export interface MaterialImportResult {
    file_id: number;
    outcome: 'created' | 'duplicate';
    readable: boolean;
}
export { parseEnglishSrt } from './englishSrt';
export function parseSrtInWorker(content: string, signal: AbortSignal): Promise<SegmentInput[]> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('material_cancelled'));
            return;
        }
        const worker = new Worker(new URL('./srtWorker.ts', import.meta.url), { type: 'module' });
        const cleanup = () => { signal.removeEventListener('abort', abort); worker.terminate(); };
        const abort = () => { cleanup(); reject(new Error('material_cancelled')); };
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = event => { cleanup(); if (event.data.error)
            reject(new Error(event.data.error));
        else
            resolve(event.data.segments); };
        worker.onerror = () => { cleanup(); reject(new Error('material_parse_failed')); };
        worker.postMessage(content);
    });
}
export function materialError(error: unknown) {
    const message = String(error);
    return ['empty', 'too_large', 'read_failed', 'parse_failed', 'english_only', 'invalid_srt', 'source_removed', 'operation_conflict', 'translation_partial', 'download_failed'].find(code => message.includes(`material_${code}`)) ?? 'failed';
}

/** File dialogs return native paths; decode only actual file/content URIs. */
export function importFileName(path:string):string {
    let display=path;
    if (/^(?:file|content):/i.test(path)) {try {display=decodeURIComponent(path);}catch {/* Keep the provided name if an URI escape is malformed. */}}
    return display.split(/[\\/:]/).at(-1)||'subtitles.srt';
}
