import { invoke } from '@tauri-apps/api/core';
import type { ReadingMaterial } from './materials';
import type { SavedRecord } from './savedRecords';

export interface SavedNoteDraft { text: string; revision: string; operationId?: string; editing?: boolean }
export interface SavedViewSnapshot {
  query: string; loadedGroups: number; expandedGroupId: string | null;
  loadedContexts: Record<string, number>; scrollTop: number;
  anchor?: { recordId: string; offset: number }; focusRecordId?: string;
}
export interface ReaderViewSnapshot {
  materialId: number; contentHash: string; segment: number; offset: number;
  query?: { segmentId: number; start: number; end: number; expression: string; tab: 'meaning' | 'records'; provider?: 'longman' | 'cambridge' | 'wiktionary' };
}
export type ReturnOrigin = { kind: 'saved'; path: '/saved'; view: SavedViewSnapshot }
  | { kind: 'reader'; path: string; view: ReaderViewSnapshot; parentVisitToken?: string };
export interface ReaderSourceTarget {
  recordId: string; fileId: number; segmentIndex: number; contentHash: string;
  sentence: string; expression: string; start: number | null; end: number | null;
  documentIdentity?: string; mediaIdentity?: string;
}
export interface ReturnContext { origin: ReturnOrigin; target: ReaderSourceTarget }

// Session-only drafts never become saved content or enter backup/sync payloads.
export const savedNoteDrafts = new Map<string, SavedNoteDraft>();
const visits = new Map<string, ReturnContext>();
export const readerNavigation = {
  clear() { visits.clear(); savedNoteDrafts.clear(); },
  create(origin: ReturnOrigin, target: ReaderSourceTarget): string {
    const token = crypto.randomUUID(); visits.set(token, structuredClone({ origin, target }));
    while (visits.size > 16) visits.delete(visits.keys().next().value!);
    return token;
  },
  get(token: unknown): ReturnContext | undefined { return typeof token === 'string' ? visits.get(token) : undefined; },
  complete(token: unknown) { if (typeof token === 'string') visits.delete(token); },
};

export function sourceMatches(target: ReaderSourceTarget, data: ReadingMaterial): boolean {
  const segment = data.segments.find(item => item.index_num === target.segmentIndex);
  if (data.material.id !== target.fileId || data.material.content_hash !== target.contentHash || !segment || segment.en_text !== target.sentence) return false;
  if ((data.material.document?.identity ?? null) !== (target.documentIdentity ?? null)) return false;
  if ((data.material.source?.key ?? null) !== (target.mediaIdentity ?? null)) return false;
  const normalize = (value: string) => value.trim().replace(/\s+/gu, ' ').toLowerCase();
  return target.start === null && target.end === null || (target.start !== null && target.end !== null && Number.isSafeInteger(target.start) && Number.isSafeInteger(target.end) && target.start >= 0 && target.end > target.start && target.end <= segment.en_text.length && normalize(segment.en_text.slice(target.start, target.end)) === normalize(target.expression));
}

/** null is unavailable; transport/read failures remain errors, never a false source match. */
export async function resolveSavedSource(record: SavedRecord): Promise<ReaderSourceTarget | null> {
  if (!record.source || !record.sentence) return null;
  const location = await invoke<{ file_id: number; segment_index: number } | null>('saved_record_source', { recordId: record.record_id });
  if (!location) return null;
  const target: ReaderSourceTarget = { recordId: record.record_id, fileId: location.file_id, segmentIndex: location.segment_index,
    contentHash: record.source.content_hash, sentence: record.sentence, expression: record.expression,
    start: record.source.start_offset, end: record.source.end_offset,
    documentIdentity: record.source.document?.identity, mediaIdentity: record.source.media_identity ?? record.source.media?.source.key };
  const data = await invoke<ReadingMaterial>('open_reading_material', { fileId: target.fileId });
  return sourceMatches(target, data) ? target : null;
}
