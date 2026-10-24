import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Check, Square, Volume2 } from 'lucide-react';
import RecallSection from './RecallSection';
import { useRecallStore } from '../stores/recallStore';
import { normalizeRecall } from '../lib/recallMatcher';
import ContextPanel from './ContextPanel';
import type { Material, ReadingExplanation } from '../lib/materials';
import type { Segment } from '../lib/types';
import { mutateSaved, undoSaved, savedErrorKey, type SavedRecord, type SavedMutation } from '../lib/savedRecords';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useSpeechStore } from '../stores/speechStore';
import { dictionaryLanguageState, useDictionaryStore } from '../stores/dictionaryStore';
export interface ReadingQuery {
    segment: Segment;
    start: number;
    end: number;
    expression: string;
}
export interface LookupDraft {
    value: string;
    personal: boolean;
}
export default function ReadingLookup({ query, material, onClose, drafts }: {
    query: ReadingQuery;
    material: Material;
    onClose: () => void;
    drafts: Map<string, LookupDraft>;
}) {
    const { t } = useTranslation();
    const key = `${query.segment.id}:${query.start}:${query.end}`;
    const existingDraft = drafts.get(key);
    const [result, setResult] = useState<ReadingExplanation | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    const [draft, setDraft] = useState(existingDraft?.value ?? '');
    const personal = useRef(existingDraft?.personal ?? false);
    const [editing, setEditing] = useState(!!existingDraft?.personal);
    const [saved, setSaved] = useState<SavedRecord | null>(null);
    const [receipt, setReceipt] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [writeError, setWriteError] = useState('');
    const action = useRef<{
        signature: string;
        id: string;
    } | null>(null);
    const acted = useRef(false);
    const live = useRef(true);
    const sourceState = useDictionaryStore(state => dictionaryLanguageState(state, 'en'));
    const speech = useSpeechStore();
    const reminders=usePreferencesStore(state=>state.reencounterHints);
    const expressions=useRecallStore(state=>state.expressions);
    const normalized=normalizeRecall(query.expression);
    const [recallRequested]=useState(()=>reminders&&expressions.includes(normalized));
    const showRecall=recallRequested&&reminders&&expressions.includes(normalized);
    const selection = useMemo(() => ({ segment_id: query.segment.id, expression: query.expression, start_offset: query.start, end_offset: query.end, explanation: null, explanation_source: 'unknown' }), [query.segment.id, query.expression, query.start, query.end]);
    const dictionaryReady = useDictionaryStore(state => state.ready);
    const dictionaryFailed=useDictionaryStore(state=>!!state.error||state.snapshot?.state==='failed');
    const definitionFont=usePreferencesStore(state=>state.definitionFontSize);
    const auxiliaryFont=usePreferencesStore(state=>state.auxiliaryFontSize);
    useEffect(() => { live.current = true; return () => { live.current = false; useSpeechStore.getState().stop(); }; }, []);
    useEffect(() => {
        let active = true;
        setLoading(true);
        setLookupError('');
        void invoke<ReadingExplanation>('lookup_reading_expression', { expression: query.expression }).then(value => { if (active)
            setResult(value); }).catch(error => { if (active)
            setLookupError(String(error).includes('NOT_FOUND') ? 'notFound' : 'failed'); }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    }, [query.expression, retry, sourceState]);
    useEffect(() => { let active = true; void invoke<SavedRecord | null>('saved_for_selection', { input: selection }).then(record => { if (active && !acted.current) {
        setSaved(record);
        if (record?.explanation_source === 'personal' && !personal.current) {
            personal.current = true;
            setDraft(record.explanation ?? '');
        }
    } }).catch(() => { }); return () => { active = false; }; }, [key, selection]);
    const meaning = personal.current ? draft : result?.meaning ?? '';
    const source = personal.current ? 'personal' : result?.source ?? 'unknown';
    const save = async (edit = false) => {
        if (busy)
            return;
        setBusy(true);
        setWriteError('');
        acted.current = true;
        const mutation: SavedMutation = edit && saved ? { kind: 'edit', record_id: saved.record_id, expected_revision: saved.revision, explanation: draft } : { kind: 'save', input: { ...selection, explanation: meaning || null, explanation_source: source } };
        const signature = JSON.stringify(mutation);
        if (action.current?.signature !== signature)
            action.current = { signature, id: crypto.randomUUID() };
        try {
            const next = await mutateSaved(mutation, action.current!.id);
            if (live.current) {
                setSaved(next.record);
                setReceipt(next.changed ? next.operation_id : null);
                setEditing(false);
                action.current = null;
            }
        }
        catch (error) {
            if (live.current)
                setWriteError(t(savedErrorKey(error)));
        }
        finally {
            if (live.current)
                setBusy(false);
        }
    };
    const undo = async () => { if (!receipt || busy)
        return; setBusy(true); setWriteError(''); try {
        const previous = await undoSaved(receipt);
        if (live.current) {
            setSaved(previous.deleted_at === null ? previous : null);
            setReceipt(null);
            if (previous.deleted_at === null) {
                personal.current = previous.explanation_source === 'personal';
                const restored = personal.current ? previous.explanation ?? '' : '';
                setDraft(restored);
                drafts.set(key, { value: restored, personal: personal.current });
            }
        }
    }
    catch (error) {
        if (live.current)
            setWriteError(t(savedErrorKey(error)));
    }
    finally {
        if (live.current)
            setBusy(false);
    } };
    const listen = (text: string, audioKey: string) => speech.key === audioKey ? speech.stop() : speech.speak(text, audioKey);
    return <ContextPanel label={query.expression} onClose={onClose}>
    <header className="lookup-heading"><small>{t('reader.understand')}</small><div><h2 lang="en">{query.expression}</h2><button className="ui-button ui-button--icon" onClick={() => listen(query.expression, 'term')} aria-label={t(speech.key === 'term' ? 'reader.stop' : 'reader.listenExpression')}>{speech.key === 'term' ? <Square size={18}/> : <Volume2 size={20}/>}</button></div></header>
    <div className="lookup-body" data-definition-font={definitionFont} data-aux-font={auxiliaryFont}>
      {showRecall&&<><RecallSection expression={query.expression}/><h3 className="lookup-current-heading">{t('recall.currentQuery')}</h3></>}
      {loading && !personal.current && <p role="status">{t('common.loading')}</p>}
      {meaning && <><p className="lookup-meaning">{meaning}</p><small className="lookup-provider">{t(`savedRecords.sources.${source}`)}{result && source !== 'personal' ? ` · ${result.provider}` : ''}</small></>}
      {!meaning && !loading && <p role="status">{t(!dictionaryReady ? dictionaryFailed?'reader.dictionaryFailed':'reader.dictionaryPreparing' : `reader.${lookupError || 'notFound'}`)}</p>}
      {!loading && (lookupError||dictionaryFailed) && <button className="ui-button" onClick={() => {if(dictionaryFailed)void useDictionaryStore.getState().retry();setRetry(retry + 1);}}>{t('common.retry')}</button>}
      {!!result?.more.length && <details className="lookup-more"><summary>{t('reader.moreMeanings')}</summary>{result.more.map((value, index) => <p key={index}>{value}</p>)}</details>}
      <button className="ui-button lookup-edit" onClick={() => { if (!personal.current)
        setDraft(meaning); setEditing(!editing); }} aria-expanded={editing}>{t('reader.personalExplanation')}</button>
      {editing && <div className="lookup-editor"><label htmlFor="reader-meaning">{t('savedRecords.explanation')}</label><textarea id="reader-meaning" value={draft} onChange={event => { personal.current = true; setDraft(event.target.value); drafts.set(key, { value: event.target.value, personal: true }); }} disabled={busy}/>{saved && <button className="ui-button" onClick={() => void save(true)} disabled={busy}>{t('savedRecords.saveChanges')}</button>}</div>}
      <section className="lookup-context"><div><small>{t('savedRecords.original')}</small><button className="ui-button ui-button--icon" aria-label={t(speech.key === 'sentence' ? 'reader.stop' : 'reader.listenSentence')} onClick={() => listen(query.segment.en_text, 'sentence')}>{speech.key === 'sentence' ? <Square size={17}/> : <Volume2 size={18}/>}</button></div><p lang="en">{query.segment.en_text}</p><small>{t('savedRecords.source', { name: material.name, index: query.segment.index_num + 1 })}</small></section>
      {speech.error && <p className="lookup-note" role="status">{t('reader.noVoice')}</p>}
      {writeError && <p className="saved-error" role="alert">{writeError}</p>}
    </div>
    <footer className="lookup-footer">{saved ? <div className="lookup-saved" role="status"><Check size={20} aria-hidden="true"/><strong>{t('reader.saved')}</strong>{receipt && <button className="ui-button" onClick={() => void undo()} disabled={busy}>{t('savedRecords.undo')}</button>}</div> : <button className="ui-button saved-primary" onClick={() => void save()} disabled={busy}>{t('common.save')}</button>}</footer>
  </ContextPanel>;
}
