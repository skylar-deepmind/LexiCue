import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AiConfig } from '../lib/ai';
import { useFeedbackStore } from './feedbackStore';
import i18n from '../i18n';

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
}

export interface OllamaRetry {
  fileId: number;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

interface OllamaStore {
  progress: Record<number, OllamaProgress>;
  diagnostics: Record<number, AnalysisDiagnostic>;
  retrying: Record<number, OllamaRetry>;
  initialize: () => Promise<void>;
  startAnalysis: (fileId: number, config: AiConfig) => Promise<{ phrase_count: number; occurrence_count: number }>;
  cancelAnalysis: (fileId: number) => Promise<void>;
}

let initialized = false;
const retryToastIds = new Map<number, number>();

function dismissRetryToast(fileId: number) {
  const prev = retryToastIds.get(fileId);
  if (prev !== undefined) {
    retryToastIds.delete(fileId);
    useFeedbackStore.getState().dismiss(prev);
  }
}

export const useOllamaStore = create<OllamaStore>((set) => ({
  progress: {},
  diagnostics: {},
  retrying: {},

  initialize: async () => {
    if (initialized) return;
    initialized = true;
    await listen<OllamaProgress>('ollama-analysis-progress', (event) => {
      set((state) => ({
        progress: { ...state.progress, [event.payload.fileId]: event.payload },
      }));
    });
    await listen<OllamaRetry>('ollama-analysis-retry', (event) => {
      const { fileId, attempt, maxAttempts, reason } = event.payload;
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
    });
  },

  startAnalysis: async (fileId, config) => {
    set((state) => ({
      diagnostics: Object.fromEntries(Object.entries(state.diagnostics).filter(([id]) => Number(id) !== fileId)),
      progress: {
        ...state.progress,
        [fileId]: {
          fileId,
          status: 'processing',
          processedSegments: 0,
          totalSegments: 0,
          percent: 0,
        },
      },
    }));
    try {
      const result = await invoke<{ phrase_count: number; occurrence_count: number }>('analyze_file_phrases', {
        fileId,
        config,
      });
      const diagnostic = await invoke<AnalysisDiagnostic | null>('get_analysis_diagnostic', { fileId }).catch(() => null);
      set((state) => {
        const progress = { ...state.progress };
        delete progress[fileId];
        return { progress, diagnostics: diagnostic ? { ...state.diagnostics, [fileId]: diagnostic } : state.diagnostics };
      });
      return result;
    } catch (error) {
      const diagnostic = await invoke<AnalysisDiagnostic | null>('get_analysis_diagnostic', { fileId }).catch(() => null);
      set((state) => {
        const progress = { ...state.progress };
        if (String(error).includes('ERR_CANCELLED')) delete progress[fileId];
        else progress[fileId] = { ...progress[fileId], fileId, status: 'error', error: String(error) };
        return { progress, diagnostics: diagnostic ? { ...state.diagnostics, [fileId]: diagnostic } : state.diagnostics };
      });
      throw error;
    } finally {
      set((state) => {
        const retrying = { ...state.retrying };
        delete retrying[fileId];
        return { retrying };
      });
      dismissRetryToast(fileId);
    }
  },

  cancelAnalysis: async (fileId) => {
    await invoke('cancel_phrase_analysis', { fileId });
  },
}));
