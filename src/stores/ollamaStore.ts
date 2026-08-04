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
}

export interface OllamaRetry {
  fileId: number;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

interface OllamaStore {
  progress: Record<number, OllamaProgress>;
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
      return await invoke<{ phrase_count: number; occurrence_count: number }>('analyze_file_phrases', {
        fileId,
        config,
      });
    } finally {
      set((state) => {
        const progress = { ...state.progress };
        delete progress[fileId];
        const retrying = { ...state.retrying };
        delete retrying[fileId];
        return { progress, retrying };
      });
      dismissRetryToast(fileId);
    }
  },

  cancelAnalysis: async (fileId) => {
    await invoke('cancel_phrase_analysis', { fileId });
  },
}));
