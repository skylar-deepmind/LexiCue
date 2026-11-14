import { useCallback } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

export interface PageOrigin { path: string; key: string; state: Record<string, unknown> | null; index: number | null }
/** A visit owns its actual source, including nested visits. Never infer it from the tab. */
export function visitState(location: Location) {
  return { returnOrigin: { path: location.pathname + location.search, key: location.key,
    state: location.state, index: Number.isInteger(history.state?.idx) ? history.state.idx : null } satisfies PageOrigin };
}
export function validOrigin(value: unknown): value is PageOrigin {
  if (!value || typeof value !== 'object') return false;
  const origin = value as PageOrigin;
  return typeof origin.path === 'string' && /^\/(files(?:\/\d+)?|saved|settings|legacy|example)(?:\?|$)/.test(origin.path)
    && typeof origin.key === 'string';
}
export function viewKey(location: Location) { return typeof location.state?.restoreViewKey === 'string' ? location.state.restoreViewKey : location.key; }
export function usePageReturn(fallback = '/files') {
  const location = useLocation(), navigate = useNavigate();
  const origin = validOrigin(location.state?.returnOrigin) ? location.state.returnOrigin as PageOrigin : null;
  const back = useCallback(() => {
    if (location.state?.reopenImport) window.dispatchEvent(new Event('lexicue-return-import'));
    if (origin && origin.index !== null && Number.isSafeInteger(origin.index) && origin.index>=0 && Number.isSafeInteger(history.state?.idx) && history.state.idx>origin.index) navigate(origin.index-history.state.idx);
    else if (origin) navigate(origin.path, { replace: true, state: { ...origin.state, restoreViewKey: origin.key, viewReturning: true } });
    else navigate(fallback, { replace: true, state: { viewReturning: true,restoreLibrary:fallback.includes('view=library') } });
  }, [origin, navigate, fallback,location.state]);
  return { back, origin };
}

/** Session-only view caches never enter learning data, backup or sync. */
export function createViewCache<T>(limit = 24) {
  const values = new Map<string, T>();
  const clear = () => values.clear();
  if (typeof window !== 'undefined') window.addEventListener('lexicue-data-restored', clear);
  return {
    get: (key: string) => values.get(key), clear,
    set(key: string, value: T) { values.delete(key); values.set(key, value); while (values.size > limit) values.delete(values.keys().next().value!); },
  };
}
