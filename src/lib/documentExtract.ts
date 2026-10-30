import { DOCUMENT_LIMITS } from './documentTypes';
import { buildDocument, decodeDocumentText, documentDigest, documentFormat } from './documentCore';
import { plainDocument, markdownDocument } from './documentMarkup';
import { srtDocument, vttDocument } from './documentSubtitles';

/** Runs only in the disposable import worker; it never reads files or fetches documents. */
export async function extractDocumentBytes(bytes: Uint8Array, name: string) {
  if (!bytes.length) throw new Error('material_empty');
  if (bytes.length > DOCUMENT_LIMITS.binaryBytes) throw new Error('material_too_large');
  const format = documentFormat(name), sourceHash = await documentDigest(bytes);
  if (['txt', 'md', 'srt', 'vtt'].includes(format) && (bytes[0] === 0x50 && bytes[1] === 0x4b || new TextDecoder().decode(bytes.subarray(0, 8)).startsWith('%PDF-'))) throw new Error('material_invalid_document');
  let raw;
  if (format === 'pdf') raw = await (await import('./documentPdf')).pdfDocument(bytes);
  else if (format === 'docx' || format === 'epub') { const office = await import('./documentOffice'); raw = format === 'docx' ? await office.docxDocument(bytes) : await office.epubDocument(bytes); }
  else {
    const text = decodeDocumentText(bytes);
    raw = format === 'md' ? markdownDocument(text) : format === 'srt' ? srtDocument(text) : format === 'vtt' ? vttDocument(text) : plainDocument(text);
  }
  return buildDocument(raw, format, name, sourceHash);
}
