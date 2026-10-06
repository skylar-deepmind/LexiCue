import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDictionaryStore } from '../stores/dictionaryStore';
export default function DictionaryInitNotice() {
  const { t } = useTranslation();
  const { snapshot, error, retry } = useDictionaryStore();
  const [expanded, setExpanded] = useState(false);
  if (snapshot?.state === 'ready') return null;
  const failed = snapshot?.state === 'failed' || Boolean(error);
  const completed = snapshot?.sources.filter(s => s.state === 'ready').length ?? 0;
  const current = snapshot?.sources.find(s => s.name === snapshot.currentSource);
  return <section className="dictionary-init-notice" aria-label={t('dictionaryInit.title')}>
    <div role="status"><span>{t(failed ? 'dictionaryInit.failed' : 'dictionaryInit.progress', { completed, total: snapshot?.sources.length ?? 7 })}</span>{current && <span className="dictionary-init-notice__source">{current.name} · {t('dictionaryInit.rows', { count: current.processedRows })}</span>}</div>
    {failed && <><button className="ui-button" onClick={() => { void retry(); }}>{t('common.retry')}</button><button className="ui-button" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{t('dictionaryInit.details')}</button></>}
    {expanded && <div className="dictionary-init-notice__errors">{error || snapshot?.sources.filter(s => s.state === 'failed').map(s => <p key={s.name}>{s.name}: {s.error}</p>)}</div>}
  </section>;
}
