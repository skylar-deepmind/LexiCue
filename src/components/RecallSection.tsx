import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { SavedRecord } from '../lib/savedRecords';
import { useRecallStore } from '../stores/recallStore';
import SavedReferenceDetails from './SavedReferenceDetails';

interface Page { records: SavedRecord[]; total: number }

export default function RecallSection({ expression }: { expression: string }) {
  const { t, i18n } = useTranslation();
  const revision = useRecallStore(state => state.revision);
  const [page, setPage] = useState<Page>({ records: [], total: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [changed, setChanged] = useState(0);
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
        const next = await invoke<Page>('saved_recall_contexts', { expression, offset, limit: 10 });
        if (live && current === generation.current) setPage(previous => ({ records: offset ? [...previous.records, ...next.records] : next.records, total: next.total }));
      } catch { if (live && current === generation.current) setError(true); }
      finally { if (live && current === generation.current) { pending.current = false; setLoading(false); } }
    };
    pending.current = false;
    loadRef.current = load; void load();
    return () => { live = false; };
  }, [expression, revision, retry, changed]);
  if (!loading && !error && !page.records.length) return null;
  if (!page.total) return error ? <div className="recall-error" role="alert"><p>{t('recall.loadFailed')}</p><button className="ui-button" onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></div> : null;
  return <details className="recall-section recall-history" aria-label={t('recall.previous')} aria-busy={loading}>
    <summary>{t('dictionaryFlow.historySummary', { count: page.total })}</summary>
    <p className="recall-note">{t('recall.notCurrent')}</p>
    {page.records.map(value => <article className="recall-context" key={value.record_id} data-record={value.record_id}>
      <p className="recall-sentence" lang="en">{value.sentence || t('savedRecords.missingOriginal')}</p>
      {value.sentence_translation && <p className="recall-translation">{value.sentence_translation}</p>}
      <small>{value.source ? t('savedRecords.source', { name: value.source.file_name, index: value.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')} · {value.saved_at === null ? t('savedRecords.unknownTime') : new Date(value.saved_at).toLocaleString(i18n.language)}</small>
      {value.explanation && <><small className="saved-history-label">{value.explanation_source === 'personal' ? t('dictionaryFlow.personalMeaning') : `${t('dictionaryFlow.savedMeaning')} · ${t(`savedRecords.sources.${value.explanation_source}`)}`}</small><p className="recall-meaning">{value.explanation}</p></>}
      {value.dictionary_reference && <SavedReferenceDetails reference={value.dictionary_reference} />}
    </article>)}
    {page.records.length < page.total && <button className="ui-button" disabled={loading} onClick={() => void loadRef.current(page.records.length)}>{t('savedRecords.loadMore')}</button>}
    {error && <div className="recall-error" role="alert"><p>{t('recall.loadFailed')}</p><button className="ui-button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{t('common.retry')}</button></div>}
  </details>;
}
