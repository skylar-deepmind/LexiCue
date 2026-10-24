import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { SavedRecord } from '../lib/savedRecords';
import { useRecallStore } from '../stores/recallStore';
interface Page { records: SavedRecord[]; total: number }
export default function RecallSection({ expression }: { expression: string }) {
  const { t, i18n } = useTranslation();
  const revision = useRecallStore(state => state.revision);
  const [page, setPage] = useState<Page>({ records: [], total: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const loadRef = useRef<(offset?: number) => Promise<void>>(async () => {});
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
    pending.current = false; setPage({ records: [], total: 0 });
    loadRef.current = load; void load();
    return () => { live = false; };
  }, [expression, revision, retry]);
  const record = (value: SavedRecord) => <article className="recall-context" key={value.record_id} data-record={value.record_id}>
    <p className="recall-meaning">{value.explanation || t('savedRecords.noExplanation')}</p>
    <small>{t(`savedRecords.sources.${value.explanation_source}`)} · {value.saved_at === null ? t('savedRecords.unknownTime') : new Date(value.saved_at).toLocaleString(i18n.language)}</small>
    <p className="recall-sentence" lang="en">{value.sentence || t('savedRecords.missingOriginal')}</p>
    {value.sentence_translation && <p className="recall-translation">{value.sentence_translation}</p>}
    <small>{value.source ? t('savedRecords.source', { name: value.source.file_name, index: value.source.segment_index + 1 }) : t('savedRecords.legacyMissingSource')}</small>
  </article>;
  if (!loading && !error && !page.records.length) return null;
  return <section className="recall-section" aria-label={t('recall.previous')} aria-busy={loading}>
    <h3>{t('recall.previous')}</h3><p className="recall-note">{t('recall.notCurrent')}</p>
    {!page.records.length && loading && <p role="status">{t('common.loading')}</p>}
    {page.records[0] && record(page.records[0])}
    {page.total > 1 && <details className="recall-others"><summary>{t('recall.otherSentences', { count: page.total - 1 })}</summary>{page.records.slice(1).map(record)}
      {page.records.length < page.total && <button className="ui-button" disabled={loading} onClick={() => void loadRef.current(page.records.length)}>{t('savedRecords.loadMore')}</button>}
    </details>}
    {error && <div className="recall-error" role="alert"><p>{t('recall.loadFailed')}</p><button className="ui-button" disabled={loading} onClick={() => setRetry(retry + 1)}>{t('common.retry')}</button></div>}
  </section>;
}
