import { translateReadingBatch, type ReadingTranslationUpdate } from './readingTranslation';
import type { TranslationProgress } from './importTranslation';
import type { Segment } from './types';

export type ReadingTranslationStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'error';
export interface ReadingTranslationSnapshot {
  enabled: boolean;
  confirming: boolean;
  missingCount: number;
  status: ReadingTranslationStatus;
  progress: TranslationProgress | null;
  generated: Record<number, string>;
}
export interface ReadingTranslationOptions {
  materialId: number;
  contentHash: string;
  segments: readonly Segment[];
  allowGenerate: boolean;
  initial?: ReadingTranslationSnapshot;
}

/** Confirmation authorizes one material version, never a viewport or another file. */
export function createReadingTranslationSession(options: ReadingTranslationOptions) {
  const originals = new Map(options.segments.map(segment => [segment.id, { ...segment }]));
  let state: ReadingTranslationSnapshot = { enabled: false, confirming: false,
    missingCount: options.segments.filter(row => !!row.en_text.trim() && !row.zh_text?.trim()).length,
    status: 'idle', progress: null, generated: {} };
  if(options.initial) state={...options.initial,confirming:false,progress:null,status:options.initial.status==='loading'?'partial':options.initial.status};
  let generation = 0, authorized = false;
  let request: AbortController | null = null;
  const listeners = new Set<() => void>();
  const missing = () => [...originals.values()].filter(row => !!row.en_text.trim() && !row.zh_text?.trim() && !state.generated[row.id]);
  const publish = (next: Partial<ReadingTranslationSnapshot>) => {
    state = { ...state, ...next };
    state = { ...state, missingCount: missing().length };
    listeners.forEach(listener => listener());
  };
  const cancel = () => {
    generation++;
    request?.abort(); request = null;
    publish({ status: Object.keys(state.generated).length ? 'partial' : 'idle', progress: null });
  };
  const available = options.segments.some(segment => !!segment.zh_text?.trim())
    || options.allowGenerate && options.segments.some(segment => !!segment.en_text.trim());
  const load = async () => {
    if (!authorized || request || !options.allowGenerate) return;
    const rows = missing();
    if (!rows.length) { publish({ status: 'ready' }); return; }
    const controller = new AbortController(); request = controller;
    const current = ++generation;
    publish({ status: 'loading', progress: {done: 0, total: rows.length} });
    const validIds = new Set(rows.map(row => row.id));
    const accept = (updates: ReadingTranslationUpdate[]) => Object.fromEntries(updates
      .filter(row => validIds.has(row.id) && !!row.zh_text.trim()).map(row => [row.id, row.zh_text]));
    try {
      const result = await translateReadingBatch(options.materialId, options.contentHash, rows, controller.signal, (updates, progress) => {
        if (current !== generation || controller.signal.aborted) return;
        publish({ generated: {...state.generated, ...accept(updates)}, progress });
      });
      if (current !== generation || controller.signal.aborted) return;
      const additions = accept(result.translations);
      const failed = result.failed || Object.keys(additions).length < rows.length;
      publish({ generated: {...state.generated, ...additions}, status: failed ? Object.keys(state.generated).length || Object.keys(additions).length ? 'partial' : 'error' : 'ready' });
    } catch {
      if (current === generation && !controller.signal.aborted) publish({ status: Object.keys(state.generated).length ? 'partial' : 'error' });
    } finally { if (request === controller) request = null; }
  };
  return {
    available,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    request: load,
    cancel,
    dismissConfirmation: () => publish({confirming: false}),
    confirm() {
      if (!state.confirming) return;
      authorized = true;
      publish({confirming: false, enabled: true});
      void load();
    },
    toggle() {
      if (state.enabled) publish({ enabled: false, confirming: false });
      else if (available) {
        if (options.allowGenerate && missing().length && !request) publish({confirming: true});
        else publish({enabled: true, confirming: false, status: request ? 'loading' : 'ready'});
      }
    },
    close() { cancel(); authorized = false; publish({ enabled: false, confirming: false, status: 'idle' }); },
  };
}
