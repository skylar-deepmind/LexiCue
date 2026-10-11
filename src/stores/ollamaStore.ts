import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AiConfig } from '../lib/ai';
import { useFeedbackStore } from './feedbackStore';
import i18n from '../i18n';
import type { Segment } from '../lib/types';
import { createPreview, mergePreviews, finishPreview, applyPreviewSnapshot, type AnalysisPreviewSnapshot, type AnalysisPreview, type AnalysisPreviewEvent } from '../lib/analysisPreview';

export interface OllamaProgress {
  fileId: number;
  status: 'processing' | 'completed' | 'error';
  processedSegments: number;
  totalSegments: number;
  percent: number;
  phase?: 'extraction' | 'explanation' | 'saving' | 'completed' | 'error';
  error?: string;
  runId?: string;
  skippedItems?: number;
  errorCode?: string;
}

export interface AnalysisStageUsage {
  requests: number;
  contentRetries: number;
  transportRetries: number;
  splits: number;
  cacheHits: number;
  inputChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AnalysisDiagnostic {
  runId: string;
  fileId: number;
  stage: string;
  status: string;
  batch: number;
  code: string;
  errorKind: string | null;
  httpStatus: number | null;
  provider: string;
  model: string;
  requestId: string | null;
  finishReason: string | null;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  validCount: number;
  skippedCount: number;
  totalSkipped: number;
  missingFields: string[];
  rawAvailable: boolean;
  occurredAt: number;
  extraction: AnalysisStageUsage;
  explanation: AnalysisStageUsage;
  cacheErrors: number;
  streamRequests?: number;
  streamFallbacks?: number;
  firstPreviewMs?: number | null;
  usageIncomplete?: boolean;
}

export interface OllamaRetry {
  fileId: number;
  attempt: number;
  maxAttempts: number;
  reason: string;
  runId?: string;
}

interface OllamaStore {
  progress: Record<number, OllamaProgress>;
  diagnostics: Record<number, AnalysisDiagnostic>;
  retrying: Record<number, OllamaRetry>;
  previews: Record<number, AnalysisPreview>;
  previewFileId: number | null;
  openPreview: (fileId: number) => void;
  closePreview: () => void;
  clearPreview: (fileId: number) => void;
  loadPreviewSegments: (fileId: number, runId: string) => Promise<void>;
  loadPreviewSnapshot: (fileId: number, runId: string) => Promise<void>;
  initialize: () => Promise<void>;
  startAnalysis: (fileId: number, config: AiConfig, forceRefresh?: boolean, metadata?: { fileName: string; language: string }) => Promise<{ phrase_count: number; occurrence_count: number }>;
  cancelAnalysis: (fileId: number) => Promise<void>;
}

let initialization: Promise<void> | null = null;
const retryToastIds = new Map<number, number>();

const previewQueues = new Map<number, { runId: string; events: AnalysisPreviewEvent[]; timer: ReturnType<typeof setTimeout> }>();
function flushPreview(fileId: number) {
  const queue = previewQueues.get(fileId);
  if (!queue) return;
  clearTimeout(queue.timer); previewQueues.delete(fileId);
  useOllamaStore.setState(state => {
    const current = state.previews[fileId];
    if (!current || current.runId !== queue.runId) return {};
    const next = mergePreviews(current, queue.events);
    return next === current ? {} : { previews: { ...state.previews, [fileId]: next } };
  });
}
function discardPreviewQueue(fileId: number) {
  const queue = previewQueues.get(fileId);
  if (queue) clearTimeout(queue.timer);
  previewQueues.delete(fileId);
}

function dismissRetryToast(fileId: number) {
  const prev = retryToastIds.get(fileId);
  if (prev !== undefined) {
    retryToastIds.delete(fileId);
    useFeedbackStore.getState().dismiss(prev);
  }
}

export const useOllamaStore = create<OllamaStore>((set, get) => ({
  progress: {},
  diagnostics: {},
  retrying: {},
  previews: {},
  previewFileId: null,
  openPreview: (fileId) => set({ previewFileId: fileId }),
  closePreview: () => set({ previewFileId: null }),
  clearPreview: (fileId) => set(state => {
    discardPreviewQueue(fileId);
    const previews = { ...state.previews }; delete previews[fileId];
    const progress = { ...state.progress }; delete progress[fileId];
    const retrying = { ...state.retrying }; delete retrying[fileId];
    const diagnostics = { ...state.diagnostics }; delete diagnostics[fileId];
    dismissRetryToast(fileId);
    return { previews, progress, retrying, diagnostics, previewFileId: state.previewFileId === fileId ? null : state.previewFileId };
  }),
  loadPreviewSegments: async (fileId, runId) => {
    set(state => state.previews[fileId]?.runId === runId ? { previews: { ...state.previews, [fileId]: { ...state.previews[fileId], loading: true, loadError: undefined } } } : {});
    try {
      const segments = await invoke<Segment[]>('get_file_segments', { fileId });
      set(state => state.previews[fileId]?.runId === runId ? { previews: { ...state.previews, [fileId]: { ...state.previews[fileId], loading: false, segments } } } : {});
    } catch (error) {
      set(state => state.previews[fileId]?.runId === runId ? { previews: { ...state.previews, [fileId]: { ...state.previews[fileId], loading: false, loadError: String(error) } } } : {});
    }
  },

  loadPreviewSnapshot: async (fileId, runId) => {
    try {
      const snapshot = await invoke<AnalysisPreviewSnapshot | null>('get_analysis_preview_snapshot', { fileId, runId });
      if (!snapshot) throw new Error('Preview snapshot unavailable');
      set(state => state.previews[fileId]?.runId === runId ? { previews: { ...state.previews, [fileId]: applyPreviewSnapshot(state.previews[fileId], snapshot) } } : {});
    } catch (error) {
      set(state => state.previews[fileId]?.runId === runId ? { previews: { ...state.previews, [fileId]: { ...state.previews[fileId], snapshotError: String(error) } } } : {});
    }
  },

  initialize: async () => {
    if (initialization) return initialization;
    const unlisteners: (() => void)[] = [];
    initialization = (async () => {
    unlisteners.push(await listen<OllamaProgress>('ollama-analysis-progress', (event) => {
      set((state) => {
        const existing = state.progress[event.payload.fileId];
        if (!existing || (existing.runId && event.payload.runId && existing.runId !== event.payload.runId)) return {};
        const preview = state.previews[event.payload.fileId];
        if (preview && preview.status !== 'processing') return {};
        return { progress: { ...state.progress, [event.payload.fileId]: event.payload.status === 'error' ? { ...event.payload, percent: existing.percent, processedSegments: existing.processedSegments, totalSegments: existing.totalSegments, runId: event.payload.runId ?? existing.runId } : { ...event.payload, runId: event.payload.runId ?? existing.runId } } };
      });
    }));
    unlisteners.push(await listen<AnalysisPreviewEvent>('ollama-analysis-preview', event => {
      const payload = event.payload;
      const current = get().previews[payload.fileId];
      if (!current || current.runId !== payload.runId || current.status !== 'processing') return;
      if (payload.operation === 'append') {
        const queue = previewQueues.get(payload.fileId);
        if (queue?.runId === payload.runId) queue.events.push(payload);
        else {
          discardPreviewQueue(payload.fileId);
          previewQueues.set(payload.fileId, { runId: payload.runId, events: [payload], timer: setTimeout(() => flushPreview(payload.fileId), 50) });
        }
        return;
      }
      flushPreview(payload.fileId);
      set(state => {
        const current = state.previews[payload.fileId];
        if (!current) return {};
        const next = mergePreviews(current, [payload]);
        return next === current ? {} : { previews: { ...state.previews, [payload.fileId]: next } };
      });
    }));
    unlisteners.push(await listen<OllamaRetry>('ollama-analysis-retry', (event) => {
      const { fileId, attempt, maxAttempts, reason, runId } = event.payload;
      const active = get().progress[fileId];
      if (active?.status !== 'processing' || (runId && active.runId !== runId)) return;
      const feedback = useFeedbackStore.getState();
      dismissRetryToast(fileId);
      const id = feedback.show(
        i18n.t('ollama.retrying', { reason, attempt, maxAttempts }),
        'error',
      );
      retryToastIds.set(fileId, id);
      set((state) => ({
        retrying: { ...state.retrying, [fileId]: { fileId, attempt, maxAttempts, reason } },
      }));
    }));
    })().catch(error => { unlisteners.forEach(unlisten => unlisten()); initialization = null; throw error; });
    return initialization;
  },

  startAnalysis: async (fileId, config, forceRefresh = false, metadata) => {
    if (get().progress[fileId]?.status === 'processing') throw new Error(i18n.t('files.aiAnalyzing'));
    await get().initialize();
    if (get().progress[fileId]?.status === 'processing') throw new Error(i18n.t('files.aiAnalyzing'));
    discardPreviewQueue(fileId);
    const runId = crypto.randomUUID();
    const previewEnabled = (metadata?.language ?? 'en') === 'en';
    set((state) => ({
      ...(previewEnabled ? { previews: { ...state.previews, [fileId]: createPreview(fileId, metadata?.fileName ?? String(fileId), runId) }, previewFileId: fileId } : {}),
      diagnostics: Object.fromEntries(Object.entries(state.diagnostics).filter(([id]) => Number(id) !== fileId)),
      progress: {
        ...state.progress,
        [fileId]: {
          fileId,
          status: 'processing',
          runId,
          processedSegments: 0,
          totalSegments: 0,
          percent: 0,
        },
      },
    }));
    const isCurrent = (state: OllamaStore) => (!state.progress[fileId] || state.progress[fileId].runId === runId) && (!previewEnabled || state.previews[fileId]?.runId === runId);
    if (previewEnabled) void get().loadPreviewSegments(fileId, runId);
    try {
      const result = await invoke<{ phrase_count: number; occurrence_count: number }>('analyze_file_phrases', { fileId, config, forceRefresh, runId });
      flushPreview(fileId);
      set(state => {
        if (!isCurrent(state)) return {};
        const progress = { ...state.progress }; delete progress[fileId];
        return { progress, ...(previewEnabled ? { previews: { ...state.previews, [fileId]: finishPreview(state.previews[fileId], 'saved') } } : {}) };
      });
      if (previewEnabled && isCurrent(get())) await get().loadPreviewSnapshot(fileId, runId);
      const diagnostic = await invoke<AnalysisDiagnostic | null>('get_analysis_diagnostic', { fileId }).catch(() => null);
      set(state => isCurrent(state) && diagnostic ? { diagnostics: { ...state.diagnostics, [fileId]: diagnostic } } : {});
      return result;
    } catch (error) {
      flushPreview(fileId);
      set(state => {
        if (!isCurrent(state)) return {};
        const progress = { ...state.progress };
        if (String(error).includes('ERR_CANCELLED')) delete progress[fileId];
        else progress[fileId] = { ...progress[fileId], fileId, status: 'error', error: String(error) };
        return { progress, ...(previewEnabled ? { previews: { ...state.previews, [fileId]: finishPreview(state.previews[fileId], String(error).includes('ERR_CANCELLED') ? 'cancelled' : 'error', String(error)) } } : {}) };
      });
      if (previewEnabled && isCurrent(get())) await get().loadPreviewSnapshot(fileId, runId);
      const diagnostic = await invoke<AnalysisDiagnostic | null>('get_analysis_diagnostic', { fileId }).catch(() => null);
      set(state => isCurrent(state) && diagnostic ? { diagnostics: { ...state.diagnostics, [fileId]: diagnostic } } : {});
      throw error;
    } finally {
      set((state) => {
        if (!isCurrent(state)) return {};
        const retrying = { ...state.retrying };
        delete retrying[fileId];
        return { retrying };
      });
      if (isCurrent(get())) dismissRetryToast(fileId);
    }
  },

  cancelAnalysis: async (fileId) => {
    await invoke('cancel_phrase_analysis', { fileId });
  },
}));
