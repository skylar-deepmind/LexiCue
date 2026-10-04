import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import {
  advanceAnnotation, annotationKey, reconcileAnnotationItems, rewindAnnotation,
  type AnnotationIdentity, type AnnotationScope, type AnnotationSession,
} from '../lib/annotation';
import type { WordStatus } from '../lib/types';
import { invalidateCaches } from '../lib/cacheInvalidation';
import { useWordStore } from './wordStore';
import { usePhraseStore } from './phraseStore';

interface AnnotationStore {
  sessions: Record<string, AnnotationSession>;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  start: (scope: AnnotationScope, items: AnnotationIdentity[]) => void;
  resume: (key: string) => Promise<boolean>;
  submit: (key: string, status: WordStatus) => Promise<void>;
  skip: (key: string) => void;
  undo: (key: string) => Promise<void>;
  retry: (key: string) => Promise<void>;
  reviewSkipped: (key: string) => void;
}

function refresh(kind: AnnotationScope['kind']) {
  invalidateCaches(kind === 'word' ? 'words' : 'phrases', 'files', 'review', 'insights');
  if (kind === 'word') void useWordStore.getState().loadWords(true);
  else void usePhraseStore.getState().loadPhrases(true);
}

export const useAnnotationStore = create<AnnotationStore>()(persist((set, get) => {
  const update = (key: string, id: string, change: (session: AnnotationSession) => AnnotationSession) => {
    const current = get().sessions[key];
    if (current?.id === id) set({ sessions: { ...get().sessions, [key]: change(current) } });
  };
  const error = (key: string, value: unknown) => set({ errors: { ...get().errors, [key]: String(value) } });
  const lock = (key: string, value: boolean) => set({ busy: { ...get().busy, [key]: value } });
  const finishPending = (key: string, session: AnnotationSession) => {
    const pending = session.pending;
    if (!pending) return;
    update(key, session.id, current => pending.type === 'undo'
      ? rewindAnnotation(current)
      : advanceAnnotation(current, pending.status!, pending.operationId));
    refresh(session.scope.kind);
  };
  const executePending = async (key: string, session: AnnotationSession) => {
    const pending = session.pending;
    if (!pending) return;
    if (pending.type === 'undo') {
      await invoke('undo_annotation', { operationId: pending.operationId });
    } else {
      const item = session.items[pending.index];
      await invoke('annotate_item', {
        operationId: pending.operationId, kind: session.scope.kind, itemId: item.id,
        term: item.term, language: item.language, status: pending.status,
      });
    }
    finishPending(key, session);
  };
  return {
    sessions: {}, busy: {}, errors: {},
    start: (scope, items) => {
      const key = annotationKey(scope.kind, scope.language);
      if (get().busy[key] || get().sessions[key]?.pending) return;
      const seen = new Set<number>();
      const unique = items.filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
      set({ sessions: { ...get().sessions, [key]: {
        id: crypto.randomUUID(), scope: { ...scope }, items: unique, index: 0,
        results: {}, lastStep: null, pending: null,
      } }, errors: { ...get().errors, [key]: '' } });
    },
    resume: async key => {
      const session = get().sessions[key];
      if (!session || get().busy[key]) return false;
      lock(key, true); error(key, '');
      try {
        if (session.pending) {
          const undone = await invoke<boolean | null>('annotation_operation', { operationId: session.pending.operationId });
          if ((session.pending.type === 'submit' && undone === false) || (session.pending.type === 'undo' && undone === true)) {
            finishPending(key, session);
          } else if ((undone === null && session.pending.type === 'submit') || (undone === false && session.pending.type === 'undo')) {
            update(key, session.id, current => ({ ...current, pending: null }));
          } else {
            update(key, session.id, current => ({ ...current, pending: null, lastStep: null }));
            throw new Error('annotation_conflict');
          }
        }
        const current = get().sessions[key];
        const actual = await invoke<AnnotationIdentity[]>('annotation_identities', { kind: session.scope.kind, ids: current.items.map(item => item.id) });
        update(key, session.id, next => reconcileAnnotationItems(next, actual));
        return true;
      } catch (e) { error(key, e); return false; }
      finally { lock(key, false); }
    },
    submit: async (key, status) => {
      const session = get().sessions[key];
      if (!session || !session.items[session.index] || session.pending || get().busy[key]) return;
      lock(key, true); error(key, '');
      try {
        update(key, session.id, current => ({ ...current, pending: { type: 'submit', operationId: crypto.randomUUID(), index: current.index, status } }));
        await executePending(key, get().sessions[key]);
      } catch (e) { error(key, e); }
      finally { lock(key, false); }
    },
    skip: key => {
      const session = get().sessions[key];
      if (!session || get().busy[key] || session.pending) return;
      update(key, session.id, current => advanceAnnotation(current, 'skipped', null)); error(key, '');
    },
    undo: async key => {
      const session = get().sessions[key];
      if (!session?.lastStep || get().busy[key] || session.pending) return;
      if (!session.lastStep.operationId) {
        update(key, session.id, rewindAnnotation); error(key, ''); return;
      }
      lock(key, true); error(key, '');
      try {
        update(key, session.id, current => ({ ...current, pending: { type: 'undo', operationId: current.lastStep!.operationId!, index: current.lastStep!.index } }));
        await executePending(key, get().sessions[key]);
      } catch (e) { error(key, e); }
      finally { lock(key, false); }
    },
    retry: async key => {
      const session = get().sessions[key];
      if (!session?.pending || get().busy[key]) return;
      lock(key, true); error(key, '');
      try { await executePending(key, session); }
      catch (e) { error(key, e); }
      finally { lock(key, false); }
    },
    reviewSkipped: key => {
      const session = get().sessions[key];
      if (!session || get().busy[key] || session.pending) return;
      get().start(session.scope, session.items.filter(item => session.results[item.id] === 'skipped'));
    },
  };
}, {
  name: 'lexicue-annotation-sessions', version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: state => ({ sessions: state.sessions }),
}));
