import { describe, expect, it } from 'vitest';
import { advanceAnnotation, annotationItems, annotationShortcut, annotationStats, reconcileAnnotationItems, rewindAnnotation, type AnnotationSession } from '../annotation';

const session = (): AnnotationSession => ({
  id: 'round', scope: { kind: 'word', language: 'en', filter: 'unprocessed', sortBy: 'frequency', query: 'book' },
  items: Array.from({ length: 75 }, (_, index) => ({ id: index + 1, term: `book-${index}`, language: 'en' as const })),
  index: 0, results: {}, lastStep: null, pending: null,
});
describe('annotation queue', () => {
  it('keeps all 75 items and a stable denominator while annotating, skipping and undoing', () => {
    let state = advanceAnnotation(session(), 'learning', 'op');
    state = advanceAnnotation(state, 'skipped', null);
    expect(state.items).toHaveLength(75);
    expect(state.index).toBe(2);
    expect(annotationStats(state)).toMatchObject({ learning: 1, skipped: 1 });
    state = rewindAnnotation(state);
    expect(state.index).toBe(1);
    expect(state.items[state.index].id).toBe(2);
    expect(annotationStats(state)).toMatchObject({ learning: 1, skipped: 0 });
    expect(state.lastStep).toBeNull();
  });
  it('supports completion and undo on the final item, including an all-skipped round', () => {
    let state = session();
    for (const _ of state.items) state = advanceAnnotation(state, 'skipped', null);
    expect(state.index).toBe(75);
    expect(annotationStats(state).skipped).toBe(75);
    expect(rewindAnnotation(state).index).toBe(74);
    expect(advanceAnnotation(state, 'known', 'op')).toBe(state);
  });
  it('prunes only confirmed missing or changed identities and preserves queue order and cursor', () => {
    let state = advanceAnnotation(session(), 'known', 'op');
    state = advanceAnnotation(state, 'skipped', null);
    const actual = state.items.slice(1).map(item => item.id === 3 ? { ...item, term: 'replacement' } : item);
    const restored = reconcileAnnotationItems(state, actual);
    expect(restored.items).toHaveLength(73);
    expect(restored.index).toBe(1);
    expect(restored.items[restored.index].id).toBe(4);
    expect(restored.lastStep?.index).toBe(0);
    expect(annotationStats(restored).known).toBe(0);
    expect(annotationStats(restored).skipped).toBe(1);
  });
  it('normalizes both kinds without depending on review data', () => {
    expect(annotationItems([{ id: 1, lemma: 'book', language: 'en', search_aliases: [] }, { id: 2, text: 'look up', language: 'de' }] as Parameters<typeof annotationItems>[0]))
      .toEqual([{ id: 1, term: 'book', language: 'en' }, { id: 2, term: 'look up', language: 'de' }]);
  });
  it('uses the same normalized search and word aliases when starting from fresh results', () => {
    const items = [{ id: 1, lemma: 'go', language: 'en', search_aliases: ['went'] }, { id: 2, text: 'go out', language: 'en' }] as Parameters<typeof annotationItems>[0];
    expect(annotationItems(items, ' WENT ')).toEqual([{ id: 1, term: 'go', language: 'en' }]);
    expect(annotationItems(items, 'OUT')).toEqual([{ id: 2, term: 'go out', language: 'en' }]);
  });
  it('ignores editable fields, drawers, submissions, modifiers and held keys', () => {
    const event = { key: '2', repeat: false, ctrlKey: false, metaKey: false, altKey: false };
    expect(annotationShortcut(event, false, false)).toBe('known');
    expect(annotationShortcut(event, true, false)).toBeNull();
    expect(annotationShortcut(event, false, true)).toBeNull();
    expect(annotationShortcut({ ...event, repeat: true }, false, false)).toBeNull();
    expect(annotationShortcut({ ...event, ctrlKey: true }, false, false)).toBeNull();
  });
});
