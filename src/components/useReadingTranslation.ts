import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createReadingTranslationSession, type ReadingTranslationOptions } from '../lib/readingTranslationSession';

export default function useReadingTranslation(options: ReadingTranslationOptions, beforeLayoutChange?: () => void) {
  const { materialId, contentHash, segments, allowGenerate } = options;
  const session = useMemo(() => createReadingTranslationSession({ materialId, contentHash, segments, allowGenerate }),
    [materialId, contentHash, segments, allowGenerate]);
  const beforeChange = useRef(beforeLayoutChange); beforeChange.current = beforeLayoutChange;
  const subscribe = useCallback((notify: () => void) => session.subscribe(() => {
    // Runs with the old DOM still present, including for asynchronous results.
    beforeChange.current?.();
    notify();
  }), [session]);
  const state = useSyncExternalStore(subscribe, session.getSnapshot);
  useEffect(() => () => session.close(), [session]);
  return { ...state, available: session.available, toggle: session.toggle, request: session.request, close: session.close };
}
