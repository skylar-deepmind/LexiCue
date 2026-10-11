import type { Segment } from './types';

export interface PreviewPhrase {
  segmentIndex: number; canonical: string; category: string; surface: string;
  tokenPositions: number[]; ranges: { start: number; end: number }[];
}
export type PreviewOperation = 'begin' | 'append' | 'commit' | 'rollback' | 'activity';
export interface AnalysisPreviewEvent {
  fileId: number; runId: string; sequence: number; segmentIndices: number[];
  source: 'ai' | 'cache'; phrases: PreviewPhrase[];
  operation?: PreviewOperation; batchId?: string; attemptId?: string;
}
export interface PreviewBatch {
  batchId: string; attemptId: string; segmentIndices: number[];
  phrases: Record<string, PreviewPhrase>; startedAt: number; receivedAt?: number; sequence: number;
}
export interface AnalysisPreviewSnapshot {
  fileId: number; runId: string; sequence: number; segmentIndices: number[]; phrases: PreviewPhrase[];
}
export interface AnalysisPreview {
  fileId: number; fileName: string; runId: string; status: 'processing' | 'saved' | 'error' | 'cancelled';
  segments: Segment[]; loading: boolean; loadError?: string; snapshotError?: string; error?: string;
  processed: Set<number>; sequences: Set<number>; confirmed: Record<string,PreviewPhrase>;
  pending: Record<string,PreviewBatch>; closedAttempts: Set<string>; batchSequences: Record<string,number>; snapshotSequence: number;
  phrases: Record<string,PreviewPhrase>; bySegment: Record<number,PreviewPhrase[]>;
  unique: Set<string>; occurrenceCount: number; latestSegmentIndex?: number;
}
export function previewPhraseKey(phrase: PreviewPhrase): string {
  return `${phrase.segmentIndex}|${phrase.canonical}|${phrase.tokenPositions.join(',')}`;
}
export function createPreview(fileId: number, fileName: string, runId: string): AnalysisPreview {
  return { fileId,fileName,runId,status:'processing',segments:[],loading:true,
    processed:new Set(),sequences:new Set(),confirmed:{},pending:{},closedAttempts:new Set(),batchSequences:{},snapshotSequence:0,
    phrases:{},bySegment:{},unique:new Set(),occurrenceCount:0 };
}
function derive(previous: AnalysisPreview, next: AnalysisPreview): AnalysisPreview {
  const phrases = { ...next.confirmed };
  for (const batch of Object.values(next.pending)) Object.assign(phrases,batch.phrases);
  const bySegment: Record<number,PreviewPhrase[]> = {};
  const unique = new Set<string>();
  for (const phrase of Object.values(phrases)) {
    (bySegment[phrase.segmentIndex] ??= []).push(phrase); unique.add(phrase.canonical);
  }
  for (const [index,items] of Object.entries(bySegment)) {
    const old = previous.bySegment[Number(index)];
    if (old?.length === items.length && items.every((item,i) => item === old[i])) bySegment[Number(index)] = old;
  }
  const visible = new Set([...next.processed,...Object.values(next.pending).flatMap(batch => batch.segmentIndices)]);
  return { ...next,phrases,bySegment,unique,occurrenceCount:Object.keys(phrases).length,
    latestSegmentIndex:next.latestSegmentIndex !== undefined && visible.has(next.latestSegmentIndex) ? next.latestSegmentIndex : [...next.processed].sort((a,b)=>a-b).at(-1) };
}
function mergeOne(current: AnalysisPreview, event: AnalysisPreviewEvent): AnalysisPreview {
  if (current.fileId !== event.fileId || current.runId !== event.runId || current.status !== 'processing' || current.sequences.has(event.sequence) || event.sequence <= current.snapshotSequence) return current;
  const next = { ...current,sequences:new Set(current.sequences).add(event.sequence),confirmed:{...current.confirmed},
    pending:{...current.pending},closedAttempts:new Set(current.closedAttempts),batchSequences:{...current.batchSequences} };
  const operation = event.operation ?? 'commit';
  if (!event.operation) {
    next.processed = new Set([...current.processed,...event.segmentIndices]);
    for (const phrase of event.phrases) next.confirmed[previewPhraseKey(phrase)] ??= phrase;
    next.latestSegmentIndex = event.phrases.at(-1)?.segmentIndex ?? event.segmentIndices.at(-1) ?? current.latestSegmentIndex;
    return next;
  }
  const batchId = event.batchId, attemptId = event.attemptId;
  if (!batchId || !attemptId) return current;
  const previousSequence = current.batchSequences[batchId] ?? 0;
  if (next.closedAttempts.has(attemptId)) return current;
  if (event.sequence < previousSequence && !current.pending[attemptId]) {
    if (operation === 'rollback') { next.closedAttempts.add(attemptId); delete next.pending[attemptId]; return next; }
    return current;
  }
  next.batchSequences[batchId] = Math.max(previousSequence,event.sequence);
  for (const [id,batch] of Object.entries(next.pending)) {
    if (batch.batchId === batchId && id !== attemptId) { delete next.pending[id]; next.closedAttempts.add(id); }
  }
  if (operation === 'commit' || operation === 'rollback') {
    delete next.pending[attemptId]; next.closedAttempts.add(attemptId);
    if (operation === 'commit') {
      next.processed = new Set([...current.processed,...event.segmentIndices]);
      for (const [key,phrase] of Object.entries(next.confirmed)) if (event.segmentIndices.includes(phrase.segmentIndex)) delete next.confirmed[key];
      for (const phrase of event.phrases) next.confirmed[previewPhraseKey(phrase)] = phrase;
      next.latestSegmentIndex = event.phrases.at(-1)?.segmentIndex ?? current.latestSegmentIndex ?? event.segmentIndices[0];
    }
  } else {
    const batch = next.pending[attemptId] ?? { batchId,attemptId,segmentIndices:event.segmentIndices,phrases:{},startedAt:Date.now(),sequence:event.sequence };
    next.pending[attemptId] = { ...batch,phrases:{...batch.phrases},sequence:Math.max(batch.sequence,event.sequence) };
    if (operation === 'append') {
      for (const phrase of event.phrases) next.pending[attemptId].phrases[previewPhraseKey(phrase)] ??= phrase;
      next.pending[attemptId].receivedAt = Date.now();
      next.latestSegmentIndex = event.phrases.at(-1)?.segmentIndex ?? current.latestSegmentIndex;
    } else if (operation === 'activity') next.pending[attemptId].receivedAt = Date.now();
    else if (!current.pending[attemptId]) next.latestSegmentIndex = event.segmentIndices[0] ?? current.latestSegmentIndex;
  }
  return next;
}
export function mergePreviews(current: AnalysisPreview, events: AnalysisPreviewEvent[]): AnalysisPreview {
  const next = events.reduce(mergeOne,current);
  return next === current ? current : derive(current,next);
}
export function mergePreview(current: AnalysisPreview, event: AnalysisPreviewEvent): AnalysisPreview { return mergePreviews(current,[event]); }
export function finishPreview(current: AnalysisPreview, status: AnalysisPreview['status'], error?: string): AnalysisPreview {
  return derive(current,{...current,status,error,pending:{},closedAttempts:new Set([...current.closedAttempts,...Object.keys(current.pending)])});
}
export function applyPreviewSnapshot(current: AnalysisPreview, snapshot: AnalysisPreviewSnapshot): AnalysisPreview {
  if (snapshot.fileId !== current.fileId || snapshot.runId !== current.runId || snapshot.sequence < current.snapshotSequence) return current;
  return derive(current,{...current,processed:new Set(snapshot.segmentIndices),confirmed:Object.fromEntries(snapshot.phrases.map(phrase=>[previewPhraseKey(phrase),phrase])),
    pending:{},snapshotSequence:snapshot.sequence,snapshotError:undefined,closedAttempts:new Set([...current.closedAttempts,...Object.keys(current.pending)])});
}

export function previewPieces(text: string, phrases: PreviewPhrase[], selectedKey: string | null) {
  const valid = phrases.flatMap(phrase => phrase.ranges.filter(r => r.start >= 0 && r.end > r.start && r.end <= text.length)
    .map(range => ({ ...range, key: previewPhraseKey(phrase) })));
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(r => [r.start, r.end])])].sort((a,b) => a-b);
  return boundaries.slice(0,-1).map((start,i) => {
    const end = boundaries[i+1];
    const covered = valid.filter(r => r.start <= start && r.end >= end);
    return { text: text.slice(start,end), start, highlighted: covered.length > 0, selected: covered.some(r => r.key === selectedKey) };
  });
}
