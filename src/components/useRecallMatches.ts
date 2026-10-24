import { useEffect, useRef, useState } from 'react';
import { useRecallStore } from '../stores/recallStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { Segment } from '../lib/types';
import type { RecallMatch } from '../lib/recallMatcher';
const empty = new Map<number, RecallMatch[]>();
export default function useRecallMatches(segments: Segment[], first: number, last: number, inLibrary = true) {
  const enabled = usePreferencesStore(state => state.reencounterHints) && inLibrary;
  const { expressions, revision, loaded, loading, error, refresh } = useRecallStore();
  const [state, setState] = useState<{ version: number; first: number; last: number; matches: Map<number, RecallMatch[]>; error: boolean }>({ version: -1, first: 0, last: 0, matches: empty, error: false });
  const channel = useRef<{ worker: Worker; version: number } | null>(null);
  const request = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const changed = () => { void refresh(); };
    const foreground = () => { if (document.visibilityState === 'visible') changed(); };
    window.addEventListener('lexicue-saved-changed', changed);
    window.addEventListener('lexicue-sync-applied', changed);
    window.addEventListener('focus', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      window.removeEventListener('lexicue-saved-changed', changed);
      window.removeEventListener('lexicue-sync-applied', changed);
      window.removeEventListener('focus', foreground);
      document.removeEventListener('visibilitychange', foreground);
    };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !loaded || error) return;
    const current = ++request.current;
    let live=true;
    try {
      if (!channel.current) channel.current = { worker: new Worker(new URL('../lib/recallWorker.ts', import.meta.url), { type: 'module' }), version: -1 };
      const active = channel.current;
      const failed = () => {
        if (!live || request.current !== current) return;
        active.worker.terminate(); if (channel.current === active) channel.current = null;
        setState({ version: revision, first, last, matches: empty, error: true });
        useRecallStore.setState({error:true});
      };
      active.worker.onmessage = event => {
        if (!live || event.data.version !== revision || (event.data.request !== current && !(event.data.error&&event.data.request===null))) return;
        if(event.data.error){failed();return;}
        setState({ version: revision, first, last, matches: new Map(event.data.matches.map((item: { index: number; matches: RecallMatch[] }) => [item.index, item.matches])), error: false });
      };
      active.worker.onerror = failed;
      if (active.version !== revision) { active.worker.postMessage({ type: 'index', version: revision, expressions }); active.version = revision; }
      active.worker.postMessage({ type: 'match', version: revision, request: current, segments: segments.slice(first, last).map(segment => ({ index: segment.index_num, text: segment.en_text })) });
    } catch { setState({ version: revision, first, last, matches: empty, error: true });useRecallStore.setState({error:true}); }
    return () => { live=false; };
  }, [enabled, loaded, error, revision, expressions, segments, first, last]);
  useEffect(() => {
    if (!enabled) { channel.current?.worker.terminate(); channel.current = null; }
    return () => { channel.current?.worker.terminate(); channel.current = null; };
  }, [enabled]);
  const valid = enabled && !error && state.version === revision;
  const failed = enabled && (error || state.error && state.version === revision);
  return { matches: valid ? state.matches : empty, status: !enabled ? 'off' : failed ? 'failed' : !loaded || loading || !valid || state.first !== first || state.last !== last ? 'loading' : 'ready' };
}
