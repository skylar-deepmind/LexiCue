import type { Language } from './languages';
import type { PhraseInfo, WordInfo, WordStatus } from './types';

export type AnnotationKind = 'word' | 'phrase';
export type AnnotationMode = 'batch' | 'single';
export interface AnnotationIdentity { id: number; term: string; language: Language }
export interface AnnotationScope {
  kind: AnnotationKind;
  language: Language | 'all';
  filter: WordStatus | 'all';
  sortBy: 'frequency' | 'alpha' | 'recent';
  query: string;
  includeProperNouns?: boolean;
  includeUnverified?: boolean;
}
export interface AnnotationStep { index: number; item: AnnotationIdentity; operationId: string | null }
export interface AnnotationPending {
  type: 'submit' | 'undo';
  operationId: string;
  index: number;
  status?: WordStatus;
}
export interface AnnotationSession {
  id: string;
  scope: AnnotationScope;
  items: AnnotationIdentity[];
  index: number;
  results: Record<number, WordStatus | 'skipped'>;
  lastStep: AnnotationStep | null;
  pending: AnnotationPending | null;
}

export const annotationKey = (kind: AnnotationKind, language: AnnotationScope['language']) => `${kind}:${language}`;
export function annotationItems(items: (WordInfo | PhraseInfo)[], query = ''): AnnotationIdentity[] {
  const normalized = query.trim().toLowerCase();
  return items.filter(item => 'lemma' in item
    ? item.lemma.toLowerCase().includes(normalized) || item.search_aliases.some(alias => alias.toLowerCase().includes(normalized))
    : item.text.toLowerCase().includes(normalized))
    .map(item => ({ id: item.id, term: 'lemma' in item ? item.lemma : item.text, language: item.language }));
}
export function annotationStats(session: AnnotationSession) {
  const counts = { learning: 0, known: 0, ignored: 0, unprocessed: 0, skipped: 0 };
  for (const status of Object.values(session.results)) counts[status] += 1;
  return counts;
}
export function reconcileAnnotationItems(session: AnnotationSession, actual: AnnotationIdentity[]): AnnotationSession {
  const byId = new Map(actual.map(item => [item.id, item]));
  const matches = (item: AnnotationIdentity) => {
    const found = byId.get(item.id);
    return found?.term === item.term && found.language === item.language;
  };
  const items = session.items.filter(matches);
  const index = session.items.slice(0, session.index).filter(matches).length;
  const results = Object.fromEntries(items.filter(item => session.results[item.id] !== undefined).map(item => [item.id, session.results[item.id]]));
  const lastStep = session.lastStep && matches(session.lastStep.item)
    ? { ...session.lastStep, index: items.findIndex(item => item.id === session.lastStep!.item.id) }
    : null;
  return { ...session, items, index, results, lastStep };
}

export function advanceAnnotation(session: AnnotationSession, result: WordStatus | 'skipped', operationId: string | null): AnnotationSession {
  const item = session.items[session.index];
  if (!item) return session;
  return {
    ...session, index: session.index + 1, pending: null,
    results: { ...session.results, [item.id]: result },
    lastStep: { index: session.index, item, operationId },
  };
}
export function rewindAnnotation(session: AnnotationSession): AnnotationSession {
  if (!session.lastStep) return session;
  const results = { ...session.results };
  delete results[session.lastStep.item.id];
  return { ...session, index: session.lastStep.index, results, pending: null, lastStep: null };
}

export function annotationShortcut(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey'>, editable: boolean, blocked: boolean): WordStatus | null {
  if (editable || blocked || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;
  const keys: Record<string, WordStatus> = { '1': 'learning', '2': 'known', '3': 'ignored', '0': 'unprocessed' };
  return keys[event.key] ?? null;
}
