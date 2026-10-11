import { describe, expect, it } from 'vitest';
import { createPreview, mergePreview, finishPreview, applyPreviewSnapshot, previewPhraseKey, previewPieces, type AnalysisPreviewEvent, type PreviewPhrase } from '../analysisPreview';

const phrase: PreviewPhrase = { segmentIndex: 0, canonical: 'pick up', category: 'phrasal_verb', surface: 'picked up', tokenPositions: [1,3], ranges: [{ start: 2, end: 8 }, { start: 12, end: 14 }] };
const batch: AnalysisPreviewEvent = { fileId: 1, runId: 'one', sequence: 1, segmentIndices: [0,1], source: 'ai', phrases: [phrase] };

describe('analysis preview', () => {
  it('retains distinct occurrences but deduplicates events and repeated results', () => {
    const first = mergePreview(createPreview(1,'a','one'),batch);
    expect(first.unique.size).toBe(1);
    expect(first.occurrenceCount).toBe(1);
    expect(first.processed.size).toBe(2);
    expect(mergePreview(first,batch)).toBe(first);
    const duplicate = mergePreview(first,{ ...batch, sequence: 2 });
    expect(duplicate.occurrenceCount).toBe(1);
    expect(first.sequences.size).toBe(1);
    const second = mergePreview(duplicate,{ ...batch, sequence: 3, phrases: [{ ...phrase, segmentIndex: 1 }] });
    expect(second.occurrenceCount).toBe(2);
    expect(second.unique.size).toBe(1);
    expect(second.bySegment[0]).toBe(first.bySegment[0]);
  });

  it('isolates files and runs and rejects results after failure, cancellation or save', () => {
    const current = createPreview(1,'a','one');
    expect(mergePreview(current,{ ...batch,fileId: 2 })).toBe(current);
    expect(mergePreview(current,{ ...batch,runId: 'old' })).toBe(current);
    for (const status of ['saved','cancelled','error'] as const) {
      const terminal = { ...current,status };
      expect(mergePreview(terminal,batch)).toBe(terminal);
    }
    expect(createPreview(1,'a','two').occurrenceCount).toBe(0);
  });

  it('handles out-of-order batches, cached results and empty batches', () => {
    const later = mergePreview(createPreview(1,'a','one'),{ ...batch,sequence: 3,source: 'cache',segmentIndices: [2],phrases: [] });
    const first = mergePreview(later,batch);
    expect([...first.processed].sort()).toEqual([0,1,2]);
    expect(first.occurrenceCount).toBe(1);
  });

  it('highlights separated tokens without highlighting the object', () => {
    const pieces = previewPieces('I picked it up.',[phrase],previewPhraseKey(phrase));
    expect(pieces.filter(p => p.highlighted).map(p => p.text)).toEqual(['picked','up']);
    expect(pieces.filter(p => !p.highlighted).map(p => p.text).join('')).toBe('I  it .');
    expect(pieces.map(p => p.text).join('')).toBe('I picked it up.');
  });

  it('keeps overlapping phrases and original UTF-16 ranges including repeated words', () => {
    const text = '🎬 pick it up, pick it up.';
    const selected = { ...phrase, ranges: [{ start: 15,end: 19 },{ start: 23,end: 25 }] };
    const overlapping = { ...selected,canonical: 'pick it',tokenPositions: [4,5],ranges: [{ start: 15,end: 22 }] };
    const pieces = previewPieces(text,[selected,overlapping],previewPhraseKey(selected));
    expect(pieces.map(p => p.text).join('')).toBe(text);
    expect(pieces.filter(p => p.selected).map(p => p.text).join('')).toBe('pickup');
    expect(pieces.find(p => p.text.includes('pick it up,'))?.highlighted).toBe(false);
    expect(pieces.some(p => p.highlighted && !p.selected)).toBe(true);
  });
  it('shows temporary candidates without counting processed subtitles, then replaces them authoritatively', () => {
    const event = { ...batch, operation: 'begin' as const, batchId: '1', attemptId: 'a', phrases: [] };
    let current = mergePreview(createPreview(1,'a','one'),event);
    expect(current.processed.size).toBe(0);
    expect(current.pending.a.segmentIndices).toEqual([0,1]);
    current = mergePreview(current,{ ...event,sequence:2,operation:'append',phrases:[phrase] });
    expect(current.occurrenceCount).toBe(1);
    expect(current.processed.size).toBe(0);
    current = mergePreview(current,{ ...event,sequence:3,operation:'commit',phrases:[] });
    expect(current.occurrenceCount).toBe(0);
    expect(current.processed.size).toBe(2);
    expect(Object.keys(current.pending)).toHaveLength(0);
  });
  it('rolls back only the failed attempt and rejects late events while keeping successful children', () => {
    const event = { ...batch,batchId:'1',attemptId:'parent',operation:'append' as const };
    let current = mergePreview(createPreview(1,'a','one'),event);
    current = mergePreview(current,{ ...event,sequence:2,operation:'rollback',phrases:[] });
    expect(current.occurrenceCount).toBe(0);
    current = mergePreview(current,{ ...event,sequence:3,batchId:'101',attemptId:'child',operation:'commit' });
    const after = mergePreview(current,{ ...event,sequence:4 });
    expect(after).toBe(current);
    expect(finishPreview(current,'cancelled').occurrenceCount).toBe(1);
  });
  it('merges out-of-order fragments from an active attempt but ignores obsolete attempts', () => {
    const event = { ...batch,batchId:'1',attemptId:'a',operation:'activity' as const,sequence:5,phrases:[] };
    let current = mergePreview(createPreview(1,'a','one'),event);
    current = mergePreview(current,{ ...event,sequence:3,operation:'append',phrases:[phrase] });
    expect(current.occurrenceCount).toBe(1);
    current = mergePreview(current,{ ...event,sequence:6,attemptId:'b',operation:'begin' });
    expect(current.occurrenceCount).toBe(0);
    expect(mergePreview(current,{ ...event,sequence:7,operation:'append',phrases:[phrase] })).toBe(current);
    current = mergePreview(current,{ ...event,attemptId:'b',sequence:8,operation:'commit',phrases:[phrase] });
    expect(current.processed.size).toBe(2);
  });
  it('reconciles terminal state with the committed snapshot even when the final event was late', () => {
    const terminal = finishPreview(createPreview(1,'a','one'),'saved');
    const current = applyPreviewSnapshot(terminal,{ ...batch,sequence:9 });
    expect(current.status).toBe('saved');
    expect(current.occurrenceCount).toBe(1);
    expect(current.processed.size).toBe(2);
    expect(applyPreviewSnapshot(current,{ ...batch,sequence:8 })).toBe(current);
    expect(applyPreviewSnapshot(current,{ ...batch,runId:'old',sequence:10 })).toBe(current);
  });

});
