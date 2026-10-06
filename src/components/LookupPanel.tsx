import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Overlay from './Overlay';
import type { ReaderToken } from '../stores/readerStore';
import type { DictionaryEntry } from '../lib/types';
import { dictionaryLanguageState, useDictionaryStore } from '../stores/dictionaryStore';
export default function LookupPanel({ token, sentence, onClose }: { token: ReaderToken; sentence: string; onClose: () => void }) {
  const { t } = useTranslation();
  const sourceState = useDictionaryStore(s => dictionaryLanguageState(s, token.language));
  const [mode, setMode] = useState<'local' | 'online'>('local');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ entry: DictionaryEntry | null; error: string } | null>(null);
  const localSourceState = mode === 'local' ? sourceState : '';
  useEffect(() => {
    let active = true;
    void invoke<DictionaryEntry>('lookup_dictionary', { lemma: token.lemma, language: token.language, mode, refresh: mode === 'online' })
      .then(entry => { if (active) setResult({ entry, error: '' }); })
      .catch(error => { if (active) setResult({ entry: null, error: String(error) }); });
    return () => { active = false; };
  }, [token, localSourceState, mode, revision]);
  const query = (next: 'local' | 'online') => { setResult(null); setMode(next); setRevision(v => v + 1); };
  return <Overlay variant="detail" label={t('lookup.title', { term: token.surface })} onClose={onClose} className="detail-panel lookup-panel">
    <header className="lookup-panel__header"><div><h2>{token.surface}</h2>{token.lemma !== token.surface.toLowerCase() && <p>{token.lemma}</p>}</div><button className="ui-button ui-button--icon" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button></header>
    <div className="detail-panel__body lookup-panel__body">
      {!result && <p role="status">{t('common.loading')}</p>}
      {result?.entry && <><p className="lookup-panel__source">{result.entry.provider}{result.entry.phonetic && ` · ${result.entry.phonetic}`}</p>{result.entry.definitions.map((item, i) => <section key={i}><p className="lookup-panel__source">{item.part_of_speech}</p>{item.definition && <p>{item.definition}</p>}{item.translation && <p>{item.translation}</p>}{item.example && <p className="lookup-panel__source">{item.example}</p>}</section>)}</>}
      {result?.error && <div role="status"><p>{t(result.error.includes('PREPARING') ? 'lookup.preparing' : result.error.includes('NOT_FOUND') ? 'lookup.notFound' : 'lookup.failed')}</p><button className="ui-button" onClick={() => query(mode)}>{t('common.retry')}</button></div>}
      <p className="lookup-panel__context">{sentence}</p>
      <button className="ui-button" disabled={!result} onClick={() => query('online')}>{t('lookup.online')}</button>
    </div>
  </Overlay>;
}
