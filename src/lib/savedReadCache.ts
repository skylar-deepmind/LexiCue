import { useSyncExternalStore } from 'react';
import { QueryCache } from './queryCache';
import type { SavedContextPage, SavedGroupPage, SavedRecord } from './savedRecords';

export const savedGroupCache = new QueryCache<SavedGroupPage>(8);
export const savedContextCache = new QueryCache<SavedContextPage>(6);
export const savedPocketCache = new QueryCache<SavedRecord | null>(1);
let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => revision;

export const useSavedReadRevision = () => useSyncExternalStore(subscribe, snapshot);

export function invalidateSavedReads() {
  savedGroupCache.clear();
  savedContextCache.clear();
  savedPocketCache.clear();
  revision++;
  listeners.forEach(listener => listener());
}
