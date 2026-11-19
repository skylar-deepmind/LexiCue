import { startTransition, useEffect, useState } from 'react';
import { useRecallStore } from '../stores/recallStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { Segment } from '../lib/types';
import type { RecallMatch } from '../lib/recallMatcher';

const empty = new Map<number, RecallMatch[]>();
let channel: { worker: Worker; version: number } | undefined;
let request = 0;
usePreferencesStore.subscribe((state, previous) => {
  if (previous.reencounterHints && !state.reencounterHints) {
    channel?.worker.terminate();
    channel = undefined;
  }
});

export default function useRecallMatches(segments: Segment[], first: number, last: number, inLibrary = true) {
  const enabled = usePreferencesStore(state => state.reencounterHints) && inLibrary;
  const { expressions, caseExclusions, literalOnly, revision, loaded, loading, error, refresh } = useRecallStore();
  const [state, setState] = useState<{ version: number; first: number; last: number; matches: Map<number, RecallMatch[]>; error: boolean }>({ version: -1, first: 0, last: 0, matches: empty, error: false });
  useEffect(() => {
    const current = useRecallStore.getState();
    if (enabled && !current.loaded && !current.loading && !current.error) void refresh();
  }, [enabled, loaded, loading, error, refresh]);
  useEffect(() => {
    if (!enabled) return;
    if (useRecallStore.getState().error) void refresh();
    const foreground = () => {
      if (document.visibilityState === 'visible' && !useRecallStore.getState().loading) void refresh();
    };
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !loaded || error) return;
    const current = ++request;
    try {
      channel ??= { worker: new Worker(new URL('../lib/recallWorker.ts', import.meta.url), { type: 'module' }), version: -1 };
      const active = channel;
      const failed = () => {
        active.worker.terminate();
        if (channel === active) channel = undefined;
        setState({ version: revision, first, last, matches: empty, error: true });
        useRecallStore.setState({ error: true });
      };
      const receive = (event: MessageEvent) => {
        if (event.data.version !== revision || (event.data.request !== current && !(event.data.error && event.data.request === null))) return;
        if (event.data.error) { failed(); return; }
        const matches = new Map<number, RecallMatch[]>(event.data.matches.map((item: { index: number; matches: RecallMatch[] }) => [item.index, item.matches]));
        startTransition(() => setState({ version: revision, first, last, matches, error: false }));
      };
      if (active.version !== revision) {
        active.worker.postMessage({ type: 'index', version: revision, expressions, caseExclusions, literalOnly });
        active.version = revision;
      }
      active.worker.postMessage({ type: 'match', version: revision, request: current, segments: segments.slice(first, last).map(segment => ({ index: segment.index_num, text: segment.en_text })) });
      active.worker.addEventListener('message', receive);
      active.worker.addEventListener('error', failed);
      return () => {
        active.worker.removeEventListener('message', receive);
        active.worker.removeEventListener('error', failed);
      };
    } catch {
      channel?.worker.terminate();
      channel = undefined;
      setState({ version: revision, first, last, matches: empty, error: true });
      useRecallStore.setState({ error: true });
    }
  }, [enabled, loaded, error, revision, expressions, caseExclusions, literalOnly, segments, first, last]);
  const valid = enabled && !error && state.version === revision;
  const failed = enabled && (error || state.error && state.version === revision);
  return { matches: valid ? state.matches : empty, status: !enabled ? 'off' : failed ? 'failed' : !loaded || loading || !valid || state.first !== first || state.last !== last ? 'loading' : 'ready' };
}
