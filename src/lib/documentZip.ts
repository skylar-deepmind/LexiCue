import { Unzip, UnzipInflate } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DOCUMENT_LIMITS } from './documentTypes';

export function safeArchivePath(path: string): string {
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some(v => v === '..' || v === '.')) throw new Error('material_unsafe_archive');
  return path;
}
export function resolveArchivePath(base: string, href: string): string {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('/') || href.includes('\\')) throw new Error('material_unsafe_archive');
  let decoded: string;
  try { decoded = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { throw new Error('material_unsafe_archive'); }
  const parts = base.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) throw new Error('material_unsafe_archive'); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return safeArchivePath(parts.join('/'));
}
/** Streaming inflate checks actual text output. No archive entry is ever written to disk. */
export function boundedDocumentZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('material_invalid_document');
  // Reject truncated/multi-disk/ZIP64 containers before any inflation.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { eocd = at; break; }
  if (eocd < 0 || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true)) throw new Error('material_invalid_document');
  const declaredEntries = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (declaredEntries > DOCUMENT_LIMITS.zipEntries || declaredEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('material_archive_limit');
  if (centralOffset + centralSize > eocd || view.getUint16(eocd + 8, true) !== declaredEntries) throw new Error('material_invalid_document');
  let centralAt = centralOffset;
  const centralNames = new Set<string>();
  for (let i = 0; i < declaredEntries; i++) {
    if (centralAt + 46 > eocd || view.getUint32(centralAt, true) !== 0x02014b50) throw new Error('material_invalid_document');
    const length = view.getUint16(centralAt + 28, true), extra = view.getUint16(centralAt + 30, true), comment = view.getUint16(centralAt + 32, true);
    if (centralAt + 46 + length + extra + comment > eocd) throw new Error('material_invalid_document');
    const name = safeArchivePath(new TextDecoder().decode(bytes.subarray(centralAt + 46, centralAt + 46 + length)));
    if (centralNames.has(name)) throw new Error('material_invalid_document');
    centralNames.add(name);
    if (view.getUint16(centralAt + 8, true) & 1) throw new Error('material_protected_document');
    centralAt += 46 + length + extra + comment;
  }
  if (centralAt !== centralOffset + centralSize) throw new Error('material_invalid_document');
  const files = new Map<string, Uint8Array>();
  const localNames = new Set<string>();
  let entries = 0, total = 0;
  try {
    const zip = new Unzip(file => {
      if (++entries > DOCUMENT_LIMITS.zipEntries) throw new Error('material_archive_limit');
      const name = safeArchivePath(file.name);
      if (localNames.has(name) || !centralNames.has(name)) throw new Error('material_invalid_document');
      localNames.add(name);
      // Do not inflate images, fonts, media, or embedded objects.
      const needed = /(?:\.(?:xml|rels|opf|ncx|xhtml|html|htm|txt)|(?:^|\/)mimetype)$/i.test(name);
      if (file.originalSize !== undefined && file.originalSize > DOCUMENT_LIMITS.zipEntryBytes && needed) throw new Error('material_archive_limit');
      if (!needed || name.endsWith('/')) return;
      let size = 0; const chunks: Uint8Array[] = [];
      file.ondata = (error, data, final) => {
        if (error) { if (String(error).includes('material_')) throw error; throw new Error('material_invalid_document'); }
        size += data.length; total += data.length;
        if (size > DOCUMENT_LIMITS.zipEntryBytes || total > DOCUMENT_LIMITS.zipTotalBytes) throw new Error('material_archive_limit');
        chunks.push(data);
        if (final) { const result = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } files.set(name, result); }
      };
      file.start();
    });
    zip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 4096) zip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  } catch (error) {
    if (String(error).includes('material_')) throw error;
    throw new Error('material_invalid_document');
  }
  if (entries !== declaredEntries) throw new Error('material_invalid_document');
  return files;
}
export function xmlDocument(bytes: Uint8Array | undefined): any {
  if (!bytes) throw new Error('material_invalid_document');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('material_invalid_encoding'); }
  if (/<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('material_invalid_document');
  try { return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, processEntities: true, parseTagValue: false, parseAttributeValue: false }).parse(text); } catch { throw new Error('material_invalid_document'); }
}
export const arrayOf = <T>(value: T | T[] | null | undefined): T[] => value == null ? [] : Array.isArray(value) ? value : [value];
