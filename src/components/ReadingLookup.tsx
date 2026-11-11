import { LoadingSkeleton, BusyRing } from './LoadingFeedback';
import { dictionarySourceLabelKey, dictionaryOnlineSourceNumber } from '../lib/dictionaryPresentation';
import { documentLocationLabel } from '../lib/documentTypes';
import useContentFontScaleStyle from './useContentFontScaleStyle';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SpeechOwnerContext } from './speechOwner';
import { createPortal } from 'react-dom';
import { recoverLookupUndo, startLookupUndo, type LookupUndoSession } from './lookupUndoSession';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Undo2 } from 'lucide-react';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import SourceAudioControls from './SourceAudioControls';
import RecallSection from './RecallSection';
import { useRecallStore } from '../stores/recallStore';
import { recallExpression } from '../lib/recallMatcher';
import ContextPanel from './ContextPanel';
import SoftContentRefresh from './SoftContentRefresh';
import type { Material } from '../lib/materials';
import LongmanResult from './LongmanResult';
import { dictionaryReference, hasSubstantiveTargetContent, lookupLocal, type DictionaryView, shouldLookupCambridge, type DictionaryResult } from '../lib/dictionaryResult';
import { runOnlineDictionary, type OnlineIssue, type OnlineProvider } from '../lib/onlineDictionary';
import type { Segment } from '../lib/types';
import { savedErrorKey, type SavedRecord, type SavedMutation, type SavedMutationResult } from '../lib/savedRecords';
import { LIBRARY_SCOPE, contextsInScope, selectionInScope, mutateInScope, undoInScope, type ReadingScope } from '../lib/readingScope';
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
export interface LookupSession extends LookupUndoSession {
    actions: Map<string, { mutation: SavedMutation; id: string; promise?: Promise<SavedMutationResult> }>;
}
export interface LookupDraft {
    value: string;
    personal: boolean;
    provider?: DictionaryView;
}
interface LookupProps {
    layoutSlot?: RefObject<HTMLDivElement | null>;
    query: ReadingQuery;
    material: Material;
    scope: ReadingScope;
    onClose: () => void;
    onSkip: () => void;
    drafts: Map<string, LookupDraft>;
    session: LookupSession;
    initialTab?: 'meaning' | 'records';
    initialProvider?: DictionaryView;
    onViewChange?: (view: { tab: 'meaning' | 'records'; provider?: DictionaryView }) => void;
    onSource?: (record: SavedRecord) => Promise<void>;
    sourceBusy?: boolean;
}
const queryKey = (query: ReadingQuery) => `${query.segment.id}:${query.start}:${query.end}`;

/** The new query, context and save action are usable while its dictionary loads. */
export default function ReadingLookup(props: LookupProps) {
    const ownerScope=useId();
    useEffect(()=>()=>useSpeechStore.getState().stopScope(ownerScope),[ownerScope]);
    const { t } = useTranslation();
    const fontScaleStyle = useContentFontScaleStyle();
    const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
    const [tab, setTab] = useState<'meaning' | 'records'>(props.initialTab ?? 'meaning');
    const [recordsReady, setRecordsReady] = useState(false);
    const onRecordsReady = useCallback(() => setRecordsReady(true), []);
    const recallSessionId=props.scope.kind==='example'?props.scope.sessionId:null;
    const exampleSavedVersion=useOnboardingStore(state=>state.saved);
    const [count, setCount] = useState(0);
    const key = queryKey(props.query);
    const currentKey = useRef(key);
    currentKey.current = key;
    const [savedVersion, setSavedVersion] = useState(0);
    useEffect(() => {
      const refresh = () => setSavedVersion(value => value + 1);
      window.addEventListener('lexicue-saved-changed', refresh);
      window.addEventListener('lexicue-sync-applied', refresh);
      return () => { window.removeEventListener('lexicue-saved-changed', refresh); window.removeEventListener('lexicue-sync-applied', refresh); };
    }, []);
    useEffect(() => {
      let active = true;
      void contextsInScope(recallSessionId?{kind:'example',sessionId:recallSessionId}:LIBRARY_SCOPE, props.query.expression, 0, 1).then(page => { if (active && currentKey.current === key) setCount(page.total); }).catch(() => { if (active && currentKey.current === key) setCount(0); });
      return () => { active = false; };
    }, [key, props.query.expression, recallSessionId, savedVersion, exampleSavedVersion]);
    const previousKey = useRef(key);
    useLayoutEffect(() => { if (previousKey.current !== key) { previousKey.current = key; setTab('meaning'); setCount(0); setRecordsReady(false); } }, [key]);
    const providerRef = useRef(props.initialProvider);
    const onViewChange = props.onViewChange;
    const onProvider = useCallback((provider: DictionaryView) => { providerRef.current = provider; onViewChange?.({tab,provider}); }, [onViewChange,tab]);
    useEffect(() => { props.onViewChange?.({tab, provider:providerRef.current}); });
    // Keep the records tab reachable after removing its final sentence so undo stays available.
    const effectiveTab = previousKey.current === key ? tab : 'meaning';
    const [prepared, setPrepared] = useState({ key, ready: false });
    if (prepared.key !== key) setPrepared({ key, ready: false });
    const onReady = useCallback((readyKey: string) => setPrepared(current => current.key === readyKey && !current.ready ? { key: readyKey, ready: true } : current), []);
    const ready = prepared.key === key && prepared.ready;
    return <SpeechOwnerContext.Provider value={ownerScope}><ContextPanel layoutSlot={props.layoutSlot} label={props.query.expression} interactionKey={props.query} onClose={props.onClose} onClosing={() => { useSpeechStore.getState().stopScope(ownerScope); }}>
      <div className="lookup-stage" style={fontScaleStyle} data-lookup-state={ready ? 'ready' : 'loading'}>
        <SoftContentRefresh className="lookup-content" contentKey={`${key}:${effectiveTab}`} resizeContainer=".context-panel" ready={effectiveTab === 'meaning' ? ready : recordsReady} label={props.query.expression} pendingLabel={t('common.loading')}>
          <header className="lookup-heading"><div><h2 lang="en">{props.query.expression}</h2><SpeechButton text={props.query.expression} speechKey="lookup:term" kind={/\s/.test(props.query.expression.trim()) ? 'phrase' : 'word'} label={t('reader.listenExpression')}/></div></header>
          {(count > 0 || effectiveTab === 'records') && <div className="lookup-tabs" data-tab={effectiveTab} role="tablist"><span className="lookup-tab-indicator" aria-hidden="true"/><button data-testid="lookup-meaning-tab" role="tab" aria-selected={effectiveTab==='meaning'} className={effectiveTab==='meaning'?'active':''} onClick={()=>setTab('meaning')}>{t('annotation.meaning')}</button><button data-testid="lookup-records-tab" role="tab" aria-selected={effectiveTab==='records'} className={effectiveTab==='records'?'active':''} onClick={()=>{if (effectiveTab !== 'records') {setRecordsReady(false);setTab('records');}}}>{t('reader.myRecords')} <span>{count}</span></button></div>}
          <LookupContent key={key} {...props} tab={effectiveTab} onProvider={onProvider} onRecordsReady={onRecordsReady} onReady={onReady} footerHost={footerHost}/>
        </SoftContentRefresh>
        <div className="lookup-action-slot" ref={setFooterHost}/>
      </div>
    </ContextPanel></SpeechOwnerContext.Provider>;
}

function LookupContent({ query, material, scope, onSkip, drafts, session, onReady, onRecordsReady, footerHost, tab, initialProvider, onProvider, onSource, sourceBusy }: LookupProps & { onProvider: (provider: DictionaryView) => void; onReady: (key: string) => void; onRecordsReady: () => void; footerHost: HTMLDivElement | null; tab: 'meaning' | 'records' }) {
    const { t } = useTranslation();
    const example = scope.kind === 'example';
    const guideActive = useOnboardingStore(state => state.active);
    const guidedTour = useOnboardingStore(state => state.tour);
    const guideStep = useOnboardingStore(state => state.step);
    const key = queryKey(query);
    const existingDraft = drafts.get(key);
    const [localResult, setLocalResult] = useState<DictionaryResult | null>(null);
    const localResultRef = useRef(localResult);
    localResultRef.current = localResult;
    const [onlineResults, setOnlineResults] = useState<Partial<Record<OnlineProvider, DictionaryResult>>>({});
    const [provider, setProvider] = useState<DictionaryView>(existingDraft?.provider ?? initialProvider ?? 'local');
    useEffect(() => { onProvider(provider); }, [provider, onProvider]);
    const [onlineRequest, setOnlineRequest] = useState(0);
    const requestMode = useRef<'automatic' | 'manual' | 'continue'>('automatic');
    const attempted = useRef<Set<OnlineProvider>>(new Set());
    const [onlineState, setOnlineState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
    const [onlineError, setOnlineError] = useState<OnlineIssue | null>(null);
    const result = (provider === 'local' || provider === 'longman') ? localResult : onlineResults[provider] ?? localResult;
    const hasOnlineContent = Object.values(onlineResults).some(value => !!value?.entries.length);
    const activeProvider: DictionaryView = result === localResult ? 'local' : result?.entries[0]?.source.provider ?? provider;
    const [lookupError, setLookupError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    useEffect(() => { const refresh = () => setRetry(value => value + 1); window.addEventListener('lexicue-dictionary-changed', refresh); return () => window.removeEventListener('lexicue-dictionary-changed', refresh); }, []);
    const [draft, setDraft] = useState(existingDraft?.value ?? '');
    const personal = useRef(existingDraft?.personal ?? false);
    const userModeTouched = useRef(!!existingDraft);
    const interactionVersion = useRef(0);
    const manualOnlineSelection = useRef<number | null>(null);
    const [editing, setEditing] = useState(!!existingDraft?.personal);
    const [saved, setSaved] = useState<SavedRecord | null>(null);
    const [receipt, setReceipt] = useState<string | null>(() => session.receipts.get(key) ?? null);
    const initialSave = useRef(session.actions.get(key)?.promise);
    const initialUndo = useRef(session.undos.get(key)?.promise);
    const historyKey = `history:${query.expression.trim().toLowerCase()}`;
    const [historyReceipt, setHistoryReceipt] = useState<string | null>(() => session.receipts.get(historyKey) ?? null);
    const [saveFeedback, setSaveFeedback] = useState('');
    const [busy, setBusy] = useState(() => !!(session.actions.get(key)?.promise || session.undos.get(key)));
    const busyRef = useRef(!!(session.actions.get(key)?.promise || session.undos.get(key)));
    const [writeError, setWriteError] = useState('');
    const action = useRef<{ mutation: SavedMutation; id: string; promise?: Promise<SavedMutationResult> } | null>(session.actions.get(key) ?? null);
    const acted = useRef(!!(session.actions.get(key)?.promise || session.undos.get(key)));
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
    // Reattach to an already submitted write after the user changes words or closes the card.
    useEffect(() => {
        const pending = initialSave.current;
        if (!pending) return;
        let active = true;
        void pending.then(next => { if (active) {
            setSaved(next.record); setReceipt(session.receipts.get(key) ?? null);
            setSaveFeedback(next.changed ? 'dictionaryFlow.savedAdded' : 'dictionaryFlow.savedCurrent');
        } }).catch(error => { if (active) setWriteError(t(savedErrorKey(error))); }).finally(() => {
            if (active) { busyRef.current = false; setBusy(false); }
        });
        return () => { active = false; };
    }, [key, session, t]);
    // A newly mounted card follows an undo already in progress, including failure.
    useEffect(() => {
        const pending = initialUndo.current;
        if (!pending) return;
        let active = true;
        void pending.then(previous => { if (active) {
            setSaved(previous.deleted_at === null ? previous : null);
            setReceipt(session.receipts.get(key) ?? null); setSaveFeedback('');
        } }).catch(async error => {
            if (!active) return;
            setWriteError(t(savedErrorKey(error)));
            try {
                const restored = await recoverLookupUndo(session, key, () => selectionInScope(scope, selection));
                if (active) { setSaved(restored.record); setReceipt(restored.receipt); }
            } catch { if (active) setReceipt(session.receipts.get(key) ?? null); }
        }).finally(() => {
            if (active) { busyRef.current=false; setBusy(false); }
        });
        return () => { active=false; };
    }, [key, session, t, scope, selection]);
    useEffect(() => {
        let active = true;
        setLoading(true); setLookupError('');
        void lookupLocal(query.expression, query.segment.en_text).then(value => { if (active) {
            setLocalResult(value); if (example) useOnboardingStore.getState().lookedUp();
        } }).catch(error => { if (active) setLookupError(String(error).includes('NOT_FOUND') ? 'notFound' : 'failed'); }).finally(() => { if (active) { setLoading(false); onReady(key); } });
        return () => { active = false; };
    }, [query.expression, query.segment.en_text, retry, example, key, onReady]);
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
    const switchSource = (next: DictionaryView) => {
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
        if (busyRef.current || !validSelection || (!edit && saved && !action.current)) return;
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
        const pendingAction = action.current;
        session.actions.set(key, pendingAction);
        // Keep failed retries bounded without discarding any in-flight operation ID.
        if (session.actions.size > 100) {
            const oldest = [...session.actions].find(([candidate, value]) => candidate !== key && !value.promise);
            if (oldest) session.actions.delete(oldest[0]);
        }
        const request = pendingAction.promise ?? mutateInScope(scope, pendingAction.mutation, pendingAction.id);
        pendingAction.promise = request;
        try {
            const next = await request;
            if (session.actions.get(key)?.id === pendingAction.id) session.actions.delete(key);
            if (next.changed) {
                session.receipts.delete(key); session.receipts.set(key, next.operation_id);
                if (session.receipts.size > 100) session.receipts.delete(session.receipts.keys().next().value!);
            }
            if (live.current) {
                if (example) useOnboardingStore.getState().recordChanged(next.record);
                setSaved(next.record); setReceipt(session.receipts.get(key) ?? null);
                if (!personal.current && next.record.explanation_source === 'personal') {
                    personal.current = true; setDraft(next.record.explanation ?? '');
                }
                setSaveFeedback(current => current === 'dictionary.referenceOmitted' ? current : next.changed ? hadHistory ? 'dictionaryFlow.savedAdded' : 'dictionaryFlow.savedNew' : 'dictionaryFlow.savedCurrent');
                setEditing(false); drafts.delete(key); action.current = null;
            }
        } catch (error) { if (live.current) setWriteError(t(savedErrorKey(error))); }
        finally { delete pendingAction.promise; busyRef.current = false; if (live.current) setBusy(false); }
    };
    const undo = async () => {
        if (!receipt || busyRef.current) return;
        busyRef.current = true; setBusy(true); setWriteError('');
        try {
            const previous = await startLookupUndo(session, key, receipt, id => undoInScope(scope, id));
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
    const changeHistory = async (record?: SavedRecord) => {
        const undoReceipt = session.receipts.get(historyKey);
        if (busyRef.current || (!record && !undoReceipt)) return;
        busyRef.current = true; setBusy(true); setWriteError('');
        try {
            if (record) {
                const operationKey = `remove:${record.record_id}:${record.revision}`;
                const pending = session.actions.get(operationKey) ?? { id: crypto.randomUUID(), mutation: { kind: 'remove' as const, record_id: record.record_id, expected_revision: record.revision } };
                session.actions.set(operationKey, pending);
                const request = pending.promise ?? mutateInScope(scope, pending.mutation, pending.id);
                pending.promise = request;
                let result: SavedMutationResult;
                try { result = await request; } finally { delete pending.promise; }
                session.actions.delete(operationKey);
                if (result.changed) session.receipts.set(historyKey, result.operation_id);
                if (example) useOnboardingStore.getState().recordChanged(result.record);
            } else {
                const restored = await startLookupUndo(session, historyKey, undoReceipt!, id => undoInScope(scope, id));
                if (example) useOnboardingStore.getState().recordChanged(restored);
            }
            // Removing the current sentence must also update its pinned save action.
            // Clear its old save receipt only if this operation touched that record.
            const current = await selectionInScope(scope, selection);
            if (live.current) {
                if (current?.revision !== saved?.revision || (current === null) !== (saved === null)) {
                    session.receipts.delete(key); setReceipt(null); setSaveFeedback('');
                }
                setSaved(current); setHistoryReceipt(session.receipts.get(historyKey) ?? null);
            }
        } catch (error) {
            if (live.current) {
                setHistoryReceipt(session.receipts.get(historyKey) ?? null);
                setWriteError(t(savedErrorKey(error)));
            }
        } finally { busyRef.current = false; if (live.current) setBusy(false); }
    };
    // A failed response may follow a committed write. Replay its exact operation ID on re-entry.
    const retryAction = useRef(save);
    retryAction.current = save;
    useEffect(() => {
        if (action.current && !action.current.promise) void retryAction.current(action.current.mutation.kind === 'edit');
    }, [key]);
    return <>
    <div className="lookup-body" data-definition-font={definitionFont} data-aux-font={auxiliaryFont} data-active-dictionary={activeProvider} data-online-state={onlineState}>
      {tab === 'records' ? <><RecallSection scope={scope} expression={query.expression} expanded onLoaded={onRecordsReady} onSource={onSource} sourceBusy={sourceBusy} onRemove={changeHistory} removing={busy}/>{historyReceipt && <div className="recall-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" disabled={busy} onClick={() => void changeHistory()}><Undo2 size={18} aria-hidden="true"/>{t('savedRecords.undo')}</button></div>}</> : <>
      {example && guideActive && !guidedTour && <div className="example-card-hint"><small role="status">{t(guideStep === 3 ? 'onboarding.step3' : 'onboarding.step2')}</small><button className="ui-button" onClick={onSkip}>{t('onboarding.skip')}</button></div>}
      {loading && !result?.entries.length && <LoadingSkeleton kind="text" label={t('common.loading')}/>}
      {result && (!loading || !!result.entries.length) && <LongmanResult result={result} onInteract={touch} compact/>}
      <details className="lookup-secondary"><summary>{t('dictionary.sources')}{onlineState === 'loading' && <span role="status"><BusyRing/><span className="sr-only">{t('dictionary.onlineLoading')}</span></span>}</summary>
      {!loading && <div className="dictionary-controls" aria-label={t('dictionary.sources')}>
        {([['local', localResult], ['cambridge', onlineResults.cambridge], ['wiktionary', onlineResults.wiktionary]] as const).filter(([, value]) => !!value?.entries.length).map(([next], _index, available) => {
          const label = t(dictionarySourceLabelKey(next));
          const number = dictionaryOnlineSourceNumber(next, available.map(([provider]) => provider));
          return <button key={next} className="ui-button" aria-pressed={activeProvider === next} onClick={() => switchSource(next)}>{number ? t('dictionary.numberedSource', { source: label, index: number }) : label}</button>;
        })}
        {(!attempted.current.has('wiktionary') || onlineState === 'failed') && <button className="ui-button" onClick={continueOnline} disabled={onlineState === 'loading'}>{t(onlineState === 'failed' ? 'dictionary.retryOnline' : attempted.current.has('cambridge') ? 'dictionary.continueOnline' : 'dictionary.lookupOnline')}</button>}
      </div>}
      {onlineState === 'failed' && <p className="longman-notice" role="status">{t(`dictionary.issues.${onlineError ?? 'unavailable'}`)}</p>}
      {activeProvider === 'local' && hasOnlineContent && <p className="lookup-note" role="status">{t('dictionary.onlineAvailable')}</p>}
      {!loading && !localResult?.entries.length && !hasOnlineContent && onlineState === 'idle' && <p className="longman-notice" role="status">{t('dictionary.cannotConfirm')}</p>}
      {!loading && (lookupError || localResult?.status === 'unavailable') && activeProvider === 'local' && <button className="ui-button" onClick={retryLocal}>{t('common.retry')}</button>}
      {showRecall && <p className="lookup-note" role="status">{t('recall.previous')}</p>}
      {saved?.explanation && saved.explanation_source !== 'personal' && <details className="lookup-more"><summary>{t('dictionaryFlow.historicalMeaning')}</summary><p>{saved.explanation}</p><small>{t(`savedRecords.sources.${saved.explanation_source}`)}</small></details>}
      <button className="ui-button ui-button--icon lookup-edit" aria-label={t('reader.personalExplanation')} title={t('reader.personalExplanation')} onClick={() => { touch(); setEditing(!editing); }} aria-expanded={editing}><Pencil size={20} aria-hidden="true" /></button>
      {editing && <div className="lookup-editor"><label htmlFor="reader-meaning">{t('savedRecords.explanation')}</label><textarea id="reader-meaning" value={draft} onChange={event => {
        touch(); personal.current = true; setDraft(event.target.value); action.current = null; session.actions.delete(key);
        drafts.set(key, { value: event.target.value, personal: true, provider: activeProvider });
      }} disabled={busy}/>{saved && <button className="ui-button" onClick={() => void save(true)} disabled={!canSave}>{t('savedRecords.saveChanges')}</button>}</div>}
      <section className="lookup-context"><div><small>{t('savedRecords.original')}</small><SourceAudioControls reference={query.media} target={{ segment_id: query.segment.id }} text={query.segment.en_text} speechKey="lookup:sentence"/></div><p lang="en">{query.segment.en_text}</p><small>{t('savedRecords.source', { name: material.name, index: query.segment.index_num + 1 })}</small>{material.document && <small>{[material.document.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : material.document.origin?.kind === 'webpage' ? material.document.origin.final_url : material.document.original_format.toUpperCase(), documentLocationLabel(material.document.blocks.find(block => block.segment_indices.includes(query.segment.index_num))?.locations[0])].filter(Boolean).join(' · ')}</small>}</section>
      <SpeechFeedback prefix="lookup:"/>
      </details>
      </>}
    </div>
    {footerHost && createPortal(<footer className="lookup-footer">{saved || receipt ? <div className="lookup-saved" role="status"><Check size={20} aria-hidden="true"/><strong>{t(saved ? saveFeedback || 'dictionaryFlow.savedCurrent' : 'savedRecords.writeError')}</strong>{receipt && <button data-testid="lookup-undo" className="ui-button ui-button--icon" aria-label={t('savedRecords.undo')} title={t('savedRecords.undo')} onClick={() => void undo()} disabled={busy}><Undo2 size={20} aria-hidden="true" /></button>}</div> : <><button data-testid="lookup-save" className="ui-button saved-primary" onClick={() => void save()} disabled={!canSave}>{t(busy ? 'dictionaryFlow.saving' : 'reader.saveSentence')}</button></>}{writeError && <p className="saved-error" role="alert">{writeError}</p>}</footer>, footerHost)}
  </>;
}
