import type { WordStatus } from './types';

export interface StatusUpdate {
  id: number;
  status: WordStatus;
}

export interface RemovedItem<T> {
  item: T;
  index: number;
}

export function applyStatusUpdates<T extends { id: number; status: WordStatus }>(
  words: T[],
  updates: StatusUpdate[],
  filter: WordStatus | 'all',
): { words: T[]; removed: RemovedItem<T>[] } {
  const byId = new Map(updates.map((u) => [u.id, u.status]));
  if (filter === 'all') {
    return {
      words: words.map((w) => (byId.has(w.id) ? { ...w, status: byId.get(w.id)! } : w)),
      removed: [],
    };
  }
  const remaining: T[] = [];
  const removed: RemovedItem<T>[] = [];
  words.forEach((w, index) => {
    const next = byId.get(w.id);
    if (next === undefined) {
      remaining.push(w);
    } else if (next === filter) {
      remaining.push({ ...w, status: next });
    } else {
      removed.push({ item: w, index });
    }
  });
  return { words: remaining, removed };
}
