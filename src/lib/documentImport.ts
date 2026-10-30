import { DOCUMENT_LIMITS, type DocumentSelection, type ExtractedDocument } from './documentTypes';
import { rangeFromDocument } from './documentCore';
export type { DocumentSource, DocumentBlock, DocumentSection, DocumentSelection, DocumentLocation, DocumentFormat, ExtractedDocument } from './documentTypes';
export { documentFormat } from './documentCore';
export { DOCUMENT_LIMITS, documentLocationLabel } from './documentTypes';

export function extractDocument(bytes: Uint8Array, name: string, signal: AbortSignal): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('material_cancelled')); return; }
    if (bytes.length > DOCUMENT_LIMITS.binaryBytes) { reject(new Error('material_too_large')); return; }
    const worker = new Worker(new URL('./documentWorker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { cleanup(); reject(new Error('material_parse_timeout')); }, DOCUMENT_LIMITS.timeoutMs);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new Error('material_cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => { if (!event.data || !('error' in event.data) && !('result' in event.data)) return; cleanup(); if (import.meta.env.DEV && event.data.diagnostic) window.dispatchEvent(new CustomEvent('lexicue-document-diagnostic', { detail: event.data.diagnostic })); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    worker.onerror = event => { if (import.meta.env.DEV) window.dispatchEvent(new CustomEvent('lexicue-document-diagnostic', { detail: { message: event.message, filename: event.filename, line: event.lineno, column: event.colno } })); cleanup(); reject(new Error('material_parse_failed')); };
    const copy = new Uint8Array(bytes);
    worker.postMessage({ bytes: copy, name }, [copy.buffer]);
  });
}
export async function selectDocumentRange(full: ExtractedDocument, selection: DocumentSelection): Promise<ExtractedDocument> { return rangeFromDocument(full, selection); }
