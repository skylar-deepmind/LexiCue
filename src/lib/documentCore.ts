import { splitIntoSentences, alignSentenceStreams } from './sentenceMerge';
import { clearlyNonEnglish, readableEnglishSegment } from './englishScope';
import { DOCUMENT_LIMITS, type DocumentBlock, type DocumentFormat, type DocumentLocation, type DocumentSection, type DocumentSelection, type DocumentSource, type ExtractedDocument } from './documentTypes';
import type { SegmentInput } from './types';

export interface RawDocumentBlock { kind: DocumentBlock['kind']; text: string; section_id: string; locations: DocumentLocation[]; cueTexts?: string[] }
export interface RawDocument { sections: DocumentSection[]; blocks: RawDocumentBlock[]; warnings: string[]; partial?: boolean }
export const DOCUMENT_EXTRACTOR_VERSION = 'lexicue-documents/1.1.0';
export async function documentDigest(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function documentFormat(name: string): DocumentFormat {
  const ext = name.toLowerCase().split('.').at(-1);
  if (ext === 'markdown') return 'md';
  if (ext && ['pdf', 'docx', 'epub', 'md', 'txt', 'srt', 'vtt'].includes(ext)) return ext as DocumentFormat;
  throw new Error('material_unsupported_format');
}
export function decodeDocumentText(bytes: Uint8Array): string {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    // Reject binary control bytes while allowing tab and line endings.
    // oxlint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('binary');
    return text.replace(/\r\n?/g, '\n');
  } catch { throw new Error('material_invalid_encoding'); }
}
export function documentTime(ms: number): string {
  const value = Math.round(ms);
  return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
function bilingual(text: string): { en: string; zh: string } {
  const english: string[] = [], chinese: string[] = [];
  for (const line of text.split('\n').map(v => v.trim()).filter(Boolean)) {
    // Preserve mixed-script quotes, names, brackets and punctuation verbatim.
    // Only separate a wholly Chinese explanatory line from the English stream.
    if (/\p{Script=Han}/u.test(line) && !/[A-Za-z]/.test(line) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)) chinese.push(line);
    else english.push(line);
  }
  return { en: english.join(' '), zh: chinese.join(' ') };
}
function sentences(block: RawDocumentBlock, index: number): SegmentInput[] {
  if (block.kind === 'code') return [];
  const { en, zh } = bilingual(block.text);
  const english = en.replace(/\s+/g, ' ').trim();
  const parts = splitIntoSentences(english, 'en', 1000).filter(readableEnglishSegment);
  const translated = zh ? splitIntoSentences(zh, 'zh') : [];
  const aligned = alignSentenceStreams(parts, translated, 'en');
  const translations = new Map<number, string>();
  let alignedIndex = 0;
  for (const pair of aligned) {
    if (pair.translation) translations.set(alignedIndex, pair.translation);
    let remaining = pair.source.length;
    while (remaining > 0 && alignedIndex < parts.length) {
      remaining -= parts[alignedIndex++].length + 1;
    }
  }
  let offset = 0;
  const cueSpans = block.cueTexts?.flatMap((text, i) => {
    const cue = bilingual(text).en.replace(/\s+/g, ' ').trim();
    if (!cue) return [];
    const from = offset;
    offset += cue.length + 1;
    return [{ from, to: from + cue.length, location: block.locations[i] }];
  });
  let cursor = 0;
  return parts.map((text, i) => {
    const from = english.indexOf(text, cursor);
    cursor = from + text.length;
    const spans = cueSpans?.filter(cue => cue.from < cursor && cue.to > from);
    const start = spans?.[0]?.location.start_ms;
    const end = spans?.length ? Math.max(...spans.map(cue => cue.location.end_ms!)) : undefined;
    return {
      index: index + i, en_text: text, zh_text: translations.get(i) ?? null,
      start_time: start === undefined ? null : documentTime(start),
      end_time: end === undefined ? null : documentTime(end),
    };
  });
}
export async function buildDocument(raw: RawDocument, format: DocumentFormat, name: string, sourceHash: string, selection: DocumentSelection = { kind: 'all' }): Promise<ExtractedDocument> {
  if (raw.blocks.length > DOCUMENT_LIMITS.blocks) throw new Error('material_too_large');
  const blocks: DocumentBlock[] = [], segments: SegmentInput[] = [];
  const warnings = [...raw.warnings];
  let partial = !!raw.partial;
  let content = '';
  for (const item of raw.blocks) {
    // Strip embedded NUL bytes before persisting extracted text.
    // oxlint-disable-next-line no-control-regex
    const text = item.text.replace(/\u0000/g, '').trim();
    if (!text) continue;
    if (content) content += '\n\n';
    const start = content.length;
    content += text;
    const result = sentences({ ...item, text }, segments.length);
    if (!result.length && item.kind !== 'code') {
      const parts = bilingual(text);
      if (!parts.en && parts.zh && segments.length && !segments.at(-1)!.zh_text) segments.at(-1)!.zh_text = parts.zh;
      else if (/\p{Alphabetic}/u.test(text) && !parts.zh) {
        partial = true;
        warnings.push('少量非英语独立段落保留在正文预览中，不作为英语朗读句。 / Standalone non-English passages remain in the source preview.');
      }
    }
    blocks.push({ id: `b${blocks.length + 1}`, section_id: item.section_id, kind: item.kind, text, locations: item.locations, start_utf16: start, end_utf16: content.length, segment_indices: result.map(segment => segment.index) });
    segments.push(...result);
  }
  if (new TextEncoder().encode(content).length > DOCUMENT_LIMITS.textBytes) throw new Error('material_too_large');
  if (!content.trim()) throw new Error('material_empty');
  const learningText = segments.map(v => v.en_text).join(' ');
  if (!/[A-Za-z]/.test(learningText) || clearlyNonEnglish(learningText)) throw new Error('material_english_only');
  const normalized_sha256 = await documentDigest(new TextEncoder().encode(content));
  const identity = await documentDigest(new TextEncoder().encode(`${sourceHash}\n${format}\n${JSON.stringify(selection)}`));
  const document: DocumentSource = {
    schema_version: 1, original_format: format, display_name: name.split(/[\\/]/).at(-1) || 'document',
    source_sha256: sourceHash, extractor_version: DOCUMENT_EXTRACTOR_VERSION, normalized_sha256,
    offset_unit: 'utf16', extraction_status: partial ? 'partial' : 'complete', warnings: [...new Set(warnings)],
    sections: raw.sections, blocks, selection, identity,
  };
  return { content, segments, document, normalized_kind: format === 'srt' || format === 'vtt' ? 'srt' : 'txt' };
}
export async function rangeFromDocument(full: ExtractedDocument, selection: DocumentSelection): Promise<ExtractedDocument> {
  const doc = full.document;
  if (selection.kind === 'pages' && (doc.original_format !== 'pdf' || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 1 || selection.end < selection.start || selection.end > Math.max(...doc.sections.map(s => s.page ?? 0)))) throw new Error('material_invalid_range');
  if (selection.kind === 'chapters' && (doc.original_format !== 'epub' || !selection.section_ids.length || selection.section_ids.some(id => !doc.sections.some(s => s.id === id)))) throw new Error('material_invalid_range');
  const keep = new Set(doc.sections.filter(section => selection.kind === 'all' || selection.kind === 'pages' && section.page !== undefined && section.page >= selection.start && section.page <= selection.end || selection.kind === 'chapters' && selection.section_ids.includes(section.id)).map(s => s.id));
  const canonical: DocumentSelection = keep.size === doc.sections.length ? { kind: 'all' } : selection.kind === 'chapters' ? { kind: 'chapters', section_ids: doc.sections.filter(s => keep.has(s.id)).map(s => s.id) } : selection.kind === 'pages' ? { kind: 'pages', start: selection.start, end: selection.end } : { kind: 'all' };
  const blocks: DocumentBlock[] = [], segments: SegmentInput[] = [];
  let content = '';
  let processed = 0;
  for (const block of doc.blocks) {
    if (!keep.has(block.section_id)) continue;
    if (++processed % 500 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    if (content) content += '\n\n';
    const start = content.length; content += block.text;
    const indices: number[] = [];
    for (const index of block.segment_indices) { const segment = full.segments[index]; if (segment) { indices.push(segments.length); segments.push({ ...segment, index: segments.length }); } }
    blocks.push({ ...block, locations: block.locations.map(v => ({ ...v })), start_utf16: start, end_utf16: content.length, segment_indices: indices });
  }
  if (!segments.length) throw new Error('material_empty');
  const identity = await documentDigest(new TextEncoder().encode(`${doc.source_sha256}\n${doc.original_format}\n${JSON.stringify(canonical)}`));
  return { content, segments, normalized_kind: full.normalized_kind, document: { ...doc, blocks, sections: doc.sections.filter(v => keep.has(v.id)), selection: canonical, identity, normalized_sha256: await documentDigest(new TextEncoder().encode(content)) } };
}
