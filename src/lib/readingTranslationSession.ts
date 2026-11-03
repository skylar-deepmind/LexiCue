import { READING_TRANSLATION_BATCH, translateReadingBatch } from './readingTranslation';
import type { Segment } from './types';

export type ReadingTranslationStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'error';
export interface ReadingTranslationSnapshot {
  enabled: boolean;
  status: ReadingTranslationStatus;
  generated: Record<number, string>;
}
export interface ReadingTranslationOptions {
  materialId: number;
  contentHash: string;
  segments: readonly Segment[];
  allowGenerate: boolean;
}

/** One immutable material version owns each request and its visible result. */
export function createReadingTranslationSession(options: ReadingTranslationOptions) {
  let state: ReadingTranslationSnapshot = { enabled: false, status: 'idle', generated: {} };
  let generation = 0;
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const originals = new Map(options.segments.map(segment => [segment.id, { ...segment }]));
  const publish = (next: Partial<ReadingTranslationSnapshot>) => {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const cancel = () => {
    generation++;
    request?.abort();
    request = null;
  };
  const available = options.segments.some(segment => !!segment.zh_text?.trim())
    || options.allowGenerate && options.segments.some(segment => !!segment.en_text.trim());
  const load = async (visible: readonly Segment[]) => {
    if (!state.enabled || request || !options.allowGenerate) return;
    // Do not trust a caller's stale merged rows after a route/version change.
    const seen = new Set<number>();
    const rows = visible.flatMap(row => {
      const original = originals.get(row.id);
      if (!original || seen.has(row.id) || original.en_text !== row.en_text || original.index_num !== row.index_num) return [];
      seen.add(row.id);
      return original.zh_text?.trim() || state.generated[row.id] ? [] : [original];
    });
    if (!rows.length) { publish({ status: 'ready' }); return; }
    const controller = new AbortController();
    request = controller;
    const current = ++generation;
    publish({ status: 'loading' });
    try {
      const result = await translateReadingBatch(options.materialId, options.contentHash, rows, controller.signal);
      if (current !== generation || controller.signal.aborted || !state.enabled) return;
      const validIds = new Set(rows.slice(0, READING_TRANSLATION_BATCH).map(row => row.id));
      const additions = Object.fromEntries(result.translations
        .filter(row => validIds.has(row.id) && !!row.zh_text.trim())
        .map(row => [row.id, row.zh_text]));
      const failed = result.failed || Object.keys(additions).length < Math.min(READING_TRANSLATION_BATCH, rows.length);
      publish({ generated: { ...state.generated, ...additions }, status: failed ? Object.keys(additions).length ? 'partial' : 'error' : 'ready' });
    } catch {
      if (current === generation && !controller.signal.aborted && state.enabled) publish({ status: 'error' });
    } finally {
      if (request === controller) request = null;
    }
  };
  return {
    available,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    request: load,
    toggle(visible: readonly Segment[]) {
      if (state.enabled) { cancel(); publish({ enabled: false, status: 'idle' }); }
      else if (available) { publish({ enabled: true, status: 'ready' }); void load(visible); }
    },
    close() { cancel(); publish({ enabled: false, status: 'idle' }); },
  };
}
