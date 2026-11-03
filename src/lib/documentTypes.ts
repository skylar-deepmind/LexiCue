import type { SegmentInput } from './types';

export type DocumentFormat = 'pdf' | 'docx' | 'epub' | 'md' | 'txt' | 'srt' | 'vtt' | 'clipboard' | 'webpage';
export type DocumentSelection = { kind: 'all' } | { kind: 'pages'; start: number; end: number } | { kind: 'chapters'; section_ids: string[] };
export interface DocumentLocation {
  section_id: string;
  paragraph: number;
  page?: number;
  spine_id?: string;
  cue_id?: string;
  start_ms?: number;
  end_ms?: number;
}
export interface DocumentSection { id: string; title: string; page?: number; spine_id?: string }
export interface DocumentBlock {
  id: string;
  section_id: string;
  kind: 'heading' | 'paragraph' | 'list' | 'quote' | 'table' | 'code';
  text: string;
  locations: DocumentLocation[];
  /** Half-open offsets in the normalized content, measured in UTF-16 code units. */
  start_utf16: number;
  end_utf16: number;
  segment_indices: number[];
}
export interface DocumentSource {
  schema_version: 1 | 2;
  origin?: ContentOrigin;
  original_format: DocumentFormat;
  display_name: string;
  source_sha256: string;
  extractor_version: string;
  normalized_sha256: string;
  offset_unit: 'utf16';
  extraction_status: 'complete' | 'partial';
  warnings: string[];
  sections: DocumentSection[];
  blocks: DocumentBlock[];
  selection: DocumentSelection;
  /** SHA-256 of original bytes + format + canonical selection. Extractor version is separate. */
  identity: string;
}
export interface ExtractedDocument { content: string; segments: SegmentInput[]; document: DocumentSource; normalized_kind: 'txt' | 'srt' }
export const DOCUMENT_LIMITS = Object.freeze({ binaryBytes: 64 * 1024 * 1024, textBytes: 32 * 1024 * 1024, zipEntries: 10000, zipEntryBytes: 16 * 1024 * 1024, zipTotalBytes: 128 * 1024 * 1024, pdfPages: 2000, pdfPageItems: 100000, pdfTotalItems: 1000000, timeoutMs: 120000, blocks: 150000 });
export function documentLocationLabel(location?: DocumentLocation): string {
  if (!location) return '';
  if (location.page !== undefined) return `p. ${location.page} · ¶ ${location.paragraph}`;
  if (location.start_ms !== undefined) {
    const ms = location.start_ms;
    const time = `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    return `${time} · ${location.cue_id ?? ''}`;
  }
  return `¶ ${location.paragraph}`;
}

export type ContentOrigin = { kind: 'clipboard'; title: string } | { kind: 'webpage'; title: string; submitted_url: string; final_url: string; fetched_at: number };
