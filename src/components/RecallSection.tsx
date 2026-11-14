import { LoadingSkeleton, BusyRing } from './LoadingFeedback';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { contextsInScope, LIBRARY_SCOPE, type ReadingScope } from '../lib/readingScope';
import { useTranslation } from 'react-i18next';
import type { SavedRecord } from '../lib/savedRecords';
import { useRecallStore } from '../stores/recallStore';
import SavedSentence from './SavedSentence';

export interface RecallView { page:Page;activeRecord:string|null }
interface Page { records: SavedRecord[]; total: number }

export default function RecallSection({ memory, expression, expanded = false, onLoaded, onSource, sourceBusy, onRemove, removing, scope=LIBRARY_SCOPE }: { memory?:RecallView;scope?:ReadingScope; expression: string; expanded?: boolean; onLoaded?: () => void; onSource?: (record: SavedRecord, isCurrent?: () => boolean) => Promise<void>; sourceBusy?: boolean; onRemove?: (record: SavedRecord) => Promise<void>; removing?: boolean }) {
  const sessionId=scope.kind==='example'?scope.sessionId:null;
  const { t } = useTranslation();
  const revision = useRecallStore(state => state.revision);
  const [page, setPage] = useState<Page>(memory?.page ?? { records: [], total: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [changed, setChanged] = useState(0);
  const [activeRecord, setActiveRecord] = useState<string | null>(memory?.activeRecord ?? null);
  useLayoutEffect(()=>{if(memory){memory.page=page;memory.activeRecord=activeRecord;}});
  const restoredCount=useRef(memory?.page.records.length ?? 0);
  const generation = useRef(0);
  const pending = useRef(false);
  const loadRef = useRef<(offset?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    const refresh = () => setChanged(value => value + 1);
    window.addEventListener('lexicue-saved-changed', refresh);
    window.addEventListener('lexicue-sync-applied', refresh);
    window.addEventListener('lexicue-dictionary-changed', refresh);
    return () => {
      window.removeEventListener('lexicue-saved-changed', refresh);
      window.removeEventListener('lexicue-sync-applied', refresh);
      window.removeEventListener('lexicue-dictionary-changed', refresh);
    };
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    let live = true;
    const load = async (offset = 0) => {
      if (!live || pending.current) return;
      pending.current = true; setLoading(true); setError(false);
      try {
        const next = await contextsInScope(sessionId?{kind:'example',sessionId}:LIBRARY_SCOPE, expression, offset, offset ? 20 : Math.max(20,restoredCount.current));
        if (live && current === generation.current) { setPage(previous => ({ records: offset ? [...previous.records, ...next.records] : next.records, total: next.total })); }
      } catch { if (live && current === generation.current) setError(true); }
      finally { if (live && current === generation.current) { pending.current = false; setLoading(false); onLoaded?.(); } }
    };
    pending.current = false;
    loadRef.current = load; void load();
    return () => { live = false; };
  }, [expression, revision, retry, changed, onLoaded, sessionId]);
  if (!loading && !error && !page.records.length) return expanded ? <p className="recall-empty">{t('reader.noSavedSentences')}</p> : null;
  if (loading && !page.records.length) return <LoadingSkeleton kind="list" label={t('common.loading')}/>;
  if (!page.total) return error ? <div className="recall-error" role="alert"><p>{t('recall.loadFailed')}</p><button className="ui-button" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></div> : null;
  return <div className="recall-section recall-history" aria-label={t('recall.previous')} aria-busy={loading}>
    {!expanded && <p>{t('dictionaryFlow.historySummary', { count: page.total })}</p>}
    {page.records.map(value => <SavedSentence key={value.record_id} scope={scope} record={value}
      active={value.record_id === (page.records.some(record => record.record_id === activeRecord) ? activeRecord : page.records[0]?.record_id)}
      onActivate={() => setActiveRecord(value.record_id)} onRemove={onRemove} removing={removing || loading}
      onSource={onSource} sourceBusy={sourceBusy}
      onChange={next => setPage(previous => ({ ...previous, records: previous.records.map(record => record.record_id === next.record_id ? next : record) }))}/>) }
    {loading && <span role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></span>}
    {page.records.length < page.total && <button className="ui-button" disabled={loading} onClick={() => void loadRef.current(page.records.length)}>{t('savedRecords.loadMore')}</button>}
    {error && <div className="recall-error" role="alert"><p>{t('recall.loadFailed')}</p><button className="ui-button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></div>}
  </div>;
}
