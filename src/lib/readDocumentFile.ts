import { open } from '@tauri-apps/plugin-fs';
import { DOCUMENT_LIMITS } from './documentTypes';

/** Read through a granted native path/content URI without unbounded read_to_end. */
export async function readDocumentFile(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const cancelled = () => {if (signal?.aborted) throw new Error('material_cancelled');};
    cancelled();
    const file = await open(path, {read: true});
    try {
        cancelled();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            cancelled();
            const buffer = new Uint8Array(Math.min(1024 * 1024, DOCUMENT_LIMITS.binaryBytes - size + 1));
            const count = await file.read(buffer);
            cancelled();
            if (count === null || count === 0) break;
            size += count;
            if (size > DOCUMENT_LIMITS.binaryBytes) throw new Error('material_too_large');
            chunks.push(buffer.slice(0, count));
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
        return bytes;
    } finally {await file.close();}
}
