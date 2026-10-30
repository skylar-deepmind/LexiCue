import { documentLocationLabel } from '../lib/documentTypes';
import useContentFontScaleStyle from './useContentFontScaleStyle';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SpeechOwnerContext } from './speechOwner';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import SourceAudioControls from './SourceAudioControls';
import RecallSection from './RecallSection';
import { useRecallStore } from '../stores/recallStore';
import { recallExpression } from '../lib/recallMatcher';
import ContextPanel from './ContextPanel';
import SoftContentRefresh from './SoftContentRefresh';
import type { Material } from '../lib/materials';
import LongmanResult from './LongmanResult';
import SavedDictionaryDetails from './SavedDictionaryDetails';
import SavedReferenceDetails from './SavedReferenceDetails';
import { dictionaryReference, hasSubstantiveTargetContent, lookupLongman, shouldLookupCambridge, type DictionaryEntry, type DictionaryResult } from '../lib/dictionaryResult';
import { runOnlineDictionary, type OnlineIssue, type OnlineProvider } from '../lib/onlineDictionary';
import type { Segment } from '../lib/types';
import { savedErrorKey, type SavedRecord, type SavedMutation } from '../lib/savedRecords';
import { selectionInScope, mutateInScope, undoInScope, type ReadingScope } from '../lib/readingScope';
import { useOnboardingStore } from '../stores/onboardingStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useSpeechStore } from '../stores/speechStore';
export interface ReadingQuery {
  media?: import('../lib/sourceMedia').MediaRef;
    segment: Segment;
    start: number;
    end: number;
    expression: string;
}
export interface LookupDraft {
    value: string;
    personal: boolean;
    provider?: DictionaryEntry['source']['provider'];
}
interface LookupProps {
    layoutSlot?: RefObject<HTMLDivElement | null>;
    query: ReadingQuery;
    material: Material;
    scope: ReadingScope;
    onClose: () => void;
    onSkip: () => void;
    drafts: Map<string, LookupDraft>;
}
const queryKey = (query: ReadingQuery) => `${query.segment.id}:${query.start}:${query.end}`;

/** The new query, context and save action are usable while its dictionary loads. */
export default function ReadingLookup(props: LookupProps) {
    const ownerScope=useId();
    useEffect(()=>()=>useSpeechStore.getState().stopScope(ownerScope),[ownerScope]);
    const { t } = useTranslation();
    const fontScaleStyle = useContentFontScaleStyle();
    const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
    const key = queryKey(props.query);
    const [prepared, setPrepared] = useState({ key, ready: false });
    if (prepared.key !== key) setPrepared({ key, ready: false });
    const onReady = useCallback((readyKey: string) => setPrepared(current => current.key === readyKey && !current.ready ? { key: readyKey, ready: true } : current), []);
    const ready = prepared.key === key && prepared.ready;
    return <SpeechOwnerContext.Provider value={ownerScope}><ContextPanel layoutSlot={props.layoutSlot} label={props.query.expression} interactionKey={props.query} onClose={props.onClose} onClosing={() => { useSpeechStore.getState().stopScope(ownerScope); }}>
      <div className="lookup-stage" style={fontScaleStyle} data-lookup-state={ready ? 'ready' : 'loading'}>
        <SoftContentRefresh className="lookup-content" contentKey={key} ready label={props.query.expression} pendingLabel={t('common.loading')}>
          <LookupContent key={key} {...props} onReady={onReady} footerHost={footerHost}/>
        </SoftContentRefresh>
        <div className="lookup-action-slot" ref={setFooterHost}/>
      </div>
    </ContextPanel></SpeechOwnerContext.Provider>;
}

function LookupContent({ query, material, scope, onSkip, drafts, onReady, footerHost }: LookupProps & { onReady: (key: string) => void; footerHost: HTMLDivElement | null }) {
    const { t } = useTranslation();
    const example = scope.kind === 'example';
    const guideActive = useOnboardingStore(state => state.active);
    const guideStep = useOnboardingStore(state => state.step);
    const key = queryKey(query);
    const existingDraft = drafts.get(key);
    const [localResult, setLocalResult] = useState<DictionaryResult | null>(null);
    const localResultRef = useRef(localResult);
    localResultRef.current = localResult;
    const [onlineResults, setOnlineResults] = useState<Partial<Record<OnlineProvider, DictionaryResult>>>({});
    const [provider, setProvider] = useState<DictionaryEntry['source']['provider']>(existingDraft?.provider ?? 'longman');
    const [onlineRequest, setOnlineRequest] = useState(0);
    const requestMode = useRef<'automatic' | 'manual' | 'continue'>('automatic');
    const attempted = useRef<Set<OnlineProvider>>(new Set());
    const [onlineState, setOnlineState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
    const [onlineError, setOnlineError] = useState<OnlineIssue | null>(null);
    const result = provider === 'longman' ? localResult : onlineResults[provider] ?? localResult;
    const hasOnlineContent = Object.values(onlineResults).some(value => !!value?.entries.length);
    const activeProvider = result?.entries[0]?.source.provider ?? provider;
    const headword = result?.notices.some(notice => notice.code === 'inflection_candidates')
        ? query.expression : result?.entries.find(entry => entry.id === result.default_entry_id)?.headword ?? query.expression;
    const [lookupError, setLookupError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    const [draft, setDraft] = useState(existingDraft?.value ?? '');
    const personal = useRef(existingDraft?.personal ?? false);
    const userModeTouched = useRef(!!existingDraft);
    const interactionVersion = useRef(0);
    const manualOnlineSelection = useRef<number | null>(null);
    const [editing, setEditing] = useState(!!existingDraft?.personal);
    const [saved, setSaved] = useState<SavedRecord | null>(null);
    const [receipt, setReceipt] = useState<string | null>(null);
    const [saveFeedback, setSaveFeedback] = useState('');
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [writeError, setWriteError] = useState('');
    const action = useRef<{ mutation: SavedMutation; id: string } | null>(null);
    const acted = useRef(false);
    const live = useRef(true);
    const reminders = usePreferencesStore(state => state.reencounterHints);
    const expressions = useRecallStore(state => state.expressions);
    const caseExclusions = useRecallStore(state => state.caseExclusions);
    const literalOnly = useRecallStore(state => state.literalOnly);
    const reservedCases = useMemo(() => new Set(caseExclusions), [caseExclusions]);
    const recalled = recallExpression(expressions, query.expression, reservedCases, literalOnly);
    const showRecall = !example && reminders && !!recalled;
    const selection = useMemo(() => ({ segment_id: query.segment.id, expression: query.expression, start_offset: query.start, end_offset: query.end, explanation: null, explanation_source: 'unknown' as const }), [query.segment.id, query.expression, query.start, query.end]);
    const definitionFont = usePreferencesStore(state => state.definitionFontSize);
    const auxiliaryFont = usePreferencesStore(state => state.auxiliaryFontSize);
    useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
    useEffect(() => {
        let active = true;
        setLoading(true); setLookupError('');
        void lookupLongman(query.expression, query.segment.en_text).then(value => { if (active) {
            setLocalResult(value); if (example) useOnboardingStore.getState().lookedUp();
        } }).catch(error => { if (active) setLookupError(String(error).includes('NOT_FOUND') ? 'notFound' : 'failed'); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [query.expression, query.segment.en_text, retry, example]);
    const displayReady = !loading;
    useLayoutEffect(() => { if (displayReady) onReady(key); }, [displayReady, key, onReady]);
    useEffect(() => {
        if (!loading && onlineRequest === 0 && shouldLookupCambridge(localResult)) {
            requestMode.current = 'automatic'; setOnlineRequest(1);
        }
    }, [loading, localResult, onlineRequest]);
    useEffect(() => {
        if (!onlineRequest) return;
        const controller = new AbortController();
        setOnlineState('loading'); setOnlineError(null);
        void runOnlineDictionary({ expression: query.expression, context: query.segment.en_text,
            local: localResultRef.current, mode: requestMode.current, signal: controller.signal,
            onResult: (next, value) => {
                if (controller.signal.aborted) return;
                setOnlineResults(current => current[next]?.entries.length && !hasSubstantiveTargetContent(value) ? current : ({ ...current, [next]: value }));
                if (hasSubstantiveTargetContent(value) && ((manualOnlineSelection.current !== null && manualOnlineSelection.current === interactionVersion.current) || (!userModeTouched.current && !acted.current && !personal.current))) setProvider(next);
            },
        }).then(outcome => {
            if (controller.signal.aborted) return;
            outcome.attempted.forEach(next => attempted.current.add(next));
            setOnlineState(outcome.issue ? 'failed' : 'ready'); setOnlineError(outcome.issue);
            manualOnlineSelection.current = null;
        });
        return () => controller.abort();
    }, [onlineRequest, query.expression, query.segment.en_text]);
    useEffect(() => {
        let active = true;
        void selectionInScope(scope, selection).then(record => { if (active && !acted.current) {
            setSaved(record);
            if (example && record) useOnboardingStore.getState().recordChanged(record);
            if (record?.explanation_source === 'personal' && !personal.current) {
                personal.current = true; setDraft(record.explanation ?? '');
            }
        } }).catch(() => {});
        return () => { active = false; };
    }, [selection, scope, example]);
    const touch = () => { userModeTouched.current = true; interactionVersion.current++; };
    const switchSource = (next: DictionaryEntry['source']['provider']) => {
        touch(); setProvider(next);
        drafts.set(key, { value: draft, personal: personal.current, provider: next });
    };
    const continueOnline = () => {
        if (onlineState === 'loading') return;
        touch(); manualOnlineSelection.current = interactionVersion.current;
        requestMode.current = attempted.current.has('cambridge') && !attempted.current.has('wiktionary') ? 'continue' : 'manual';
        setOnlineRequest(value => value + 1);
    };
    const retryLocal = () => {
        touch(); setLoading(true); setOnlineRequest(0); setOnlineState('idle'); setOnlineError(null);
        attempted.current.clear(); setRetry(value => value + 1);
    };
    const validSelection = query.start >= 0 && query.end > query.start && query.end <= query.segment.en_text.length
        && query.segment.en_text.slice(query.start, query.end).trim() === query.expression.trim() && /[a-z]/i.test(query.expression);
    const canSave = !busy && validSelection;
    const save = async (edit = false) => {
        if (busyRef.current || !validSelection || (!edit && saved)) return;
        busyRef.current = true; setBusy(true); setWriteError(''); acted.current = true; touch();
        // Capture the currently displayed source/reference once, including retries.
        // Optional dictionary work is never a prerequisite for retaining the source.
        if (!action.current) {
            const note = personal.current ? draft.trim() || null : null;
            const reference = dictionaryReference(result);
            if (result?.entries.length && !reference) setSaveFeedback('dictionary.referenceOmitted');
            action.current = { id: crypto.randomUUID(), mutation: edit && saved
                ? { kind: 'edit', record_id: saved.record_id, expected_revision: saved.revision, explanation: draft }
                : { kind: 'save', input: { ...selection, explanation: note, explanation_source: note ? 'personal' : 'unknown', dictionary_reference: reference } } };
        }
        const hadHistory = !!recalled;
        try {
            const next = await mutateInScope(scope, action.current.mutation, action.current.id);
            if (live.current) {
                if (example) useOnboardingStore.getState().recordChanged(next.record);
                setSaved(next.record); setReceipt(next.changed ? next.operation_id : null);
                if (!personal.current && next.record.explanation_source === 'personal') {
                    personal.current = true; setDraft(next.record.explanation ?? '');
                }
                setSaveFeedback(current => current === 'dictionary.referenceOmitted' ? current : next.changed ? hadHistory ? 'dictionaryFlow.savedAdded' : 'dictionaryFlow.savedNew' : 'dictionaryFlow.savedCurrent');
                setEditing(false); drafts.delete(key); action.current = null;
            }
        } catch (error) { if (live.current) setWriteError(t(savedErrorKey(error))); }
        finally { busyRef.current = false; if (live.current) setBusy(false); }
    };
    const undo = async () => {
        if (!receipt || busyRef.current) return;
        busyRef.current = true; setBusy(true); setWriteError('');
        try {
            const previous = await undoInScope(scope, receipt);
            if (live.current) {
                if (example) useOnboardingStore.getState().recordChanged(previous);
                setSaved(previous.deleted_at === null ? previous : null); setReceipt(null); setSaveFeedback('');
                if (previous.deleted_at === null) {
                    personal.current = previous.explanation_source === 'personal';
                    const restored = personal.current ? previous.explanation ?? '' : '';
                    setDraft(restored); drafts.delete(key);
                }
            }
        } catch (error) { if (live.current) setWriteError(t(savedErrorKey(error))); }
        finally { busyRef.current = false; if (live.current) setBusy(false); }
    };
    return <>
    <header className="lookup-heading">{example && guideActive && <div className="example-card-hint"><small role="status">{t(guideStep === 3 ? 'onboarding.step3' : 'onboarding.step2')}</small><button className="ui-button" onClick={onSkip}>{t('onboarding.skip')}</button></div>}<small>{t('reader.understand')}</small><div><h2 lang="en">{headword}</h2><SpeechButton text={query.expression} speechKey="lookup:term" kind={/\s/.test(query.expression.trim()) ? 'phrase' : 'word'} label={t('reader.listenExpression')}/></div>{headword !== query.expression && <small lang="en">{query.expression} → {headword}</small>}</header>
    <div className="lookup-body" data-definition-font={definitionFont} data-aux-font={auxiliaryFont} data-active-dictionary={activeProvider} data-online-state={onlineState}>
      {loading && <p role="status">{t('common.loading')}</p>}
      {!loading && result && <LongmanResult result={result} onInteract={touch}/>}
      {!loading && <div className="dictionary-controls" aria-label={t('dictionary.sources')}>
        {([['longman', localResult], ['cambridge', onlineResults.cambridge], ['wiktionary', onlineResults.wiktionary]] as const).filter(([, value]) => !!value?.entries.length).map(([next]) => <button key={next} className="ui-button" aria-pressed={activeProvider === next} onClick={() => switchSource(next)}>{t(`dictionary.${next}`)}</button>)}
        {(!attempted.current.has('wiktionary') || onlineState === 'failed') && <button className="ui-button" onClick={continueOnline} disabled={onlineState === 'loading'}>{t(onlineState === 'failed' ? 'dictionary.retryOnline' : attempted.current.has('cambridge') ? 'dictionary.continueOnline' : 'dictionary.lookupOnline')}</button>}
      </div>}
      {onlineState === 'loading' && <p className="lookup-note" role="status">{t('dictionary.onlineLoading')}</p>}
      {onlineState === 'failed' && <p className="longman-notice" role="status">{t(`dictionary.issues.${onlineError ?? 'unavailable'}`)}</p>}
      {activeProvider === 'longman' && hasOnlineContent && <p className="lookup-note" role="status">{t('dictionary.onlineAvailable')}</p>}
      {!loading && !localResult?.entries.length && !hasOnlineContent && onlineState === 'idle' && <p className="longman-notice" role="status">{t('dictionary.cannotConfirm')}</p>}
      {!loading && (lookupError || localResult?.status === 'unavailable') && activeProvider === 'longman' && <button className="ui-button" onClick={retryLocal}>{t('common.retry')}</button>}
      {showRecall && <RecallSection expression={recalled!}/>}
      {saved?.dictionary_reference && <SavedReferenceDetails reference={saved.dictionary_reference}/>}
      {saved?.dictionary_snapshot && <SavedDictionaryDetails snapshot={saved.dictionary_snapshot}/>}
      {saved?.explanation && saved.explanation_source !== 'personal' && <details className="lookup-more"><summary>{t('dictionaryFlow.historicalMeaning')}</summary><p>{saved.explanation}</p><small>{t(`savedRecords.sources.${saved.explanation_source}`)}</small></details>}
      <button className="ui-button lookup-edit" onClick={() => { touch(); setEditing(!editing); }} aria-expanded={editing}>{t('reader.personalExplanation')}</button>
      {editing && <div className="lookup-editor"><label htmlFor="reader-meaning">{t('savedRecords.explanation')}</label><textarea id="reader-meaning" value={draft} onChange={event => {
        touch(); personal.current = true; setDraft(event.target.value); action.current = null;
        drafts.set(key, { value: event.target.value, personal: true, provider: activeProvider });
      }} disabled={busy}/>{saved && <button className="ui-button" onClick={() => void save(true)} disabled={!canSave}>{t('savedRecords.saveChanges')}</button>}</div>}
      <section className="lookup-context"><div><small>{t('savedRecords.original')}</small><SourceAudioControls reference={query.media} target={{ segment_id: query.segment.id }} text={query.segment.en_text} speechKey="lookup:sentence" saved={!!saved}/></div><p lang="en">{query.segment.en_text}</p><small>{t('savedRecords.source', { name: material.name, index: query.segment.index_num + 1 })}</small>{material.document && <small>{[material.document.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : material.document.origin?.kind === 'webpage' ? material.document.origin.final_url : material.document.original_format.toUpperCase(), documentLocationLabel(material.document.blocks.find(block => block.segment_indices.includes(query.segment.index_num))?.locations[0])].filter(Boolean).join(' · ')}</small>}</section>
      <SpeechFeedback prefix="lookup:"/>
    </div>
    {footerHost && createPortal(<footer className="lookup-footer">{saved ? <div className="lookup-saved" role="status"><Check size={20} aria-hidden="true"/><strong>{t(saveFeedback || 'dictionaryFlow.savedCurrent')}</strong>{receipt && <button className="ui-button" onClick={() => void undo()} disabled={busy}>{t('savedRecords.undo')}</button>}</div> : <><button className="ui-button saved-primary" onClick={() => void save()} disabled={!canSave}>{t(busy ? 'dictionaryFlow.saving' : 'dictionaryFlow.save')}</button><small className="lookup-note">{t('dictionaryFlow.saveHint')}</small></>}{writeError && <p className="saved-error" role="alert">{writeError}</p>}</footer>, footerHost)}
  </>;
}
