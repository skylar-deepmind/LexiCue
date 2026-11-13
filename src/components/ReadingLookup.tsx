import { LoadingSkeleton } from './LoadingFeedback';
import LookupSourceSwitch, { type LookupSourceState } from './LookupSourceSwitch';
import './lookup-controls.css';
import useContentFontScaleStyle from './useContentFontScaleStyle';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SpeechOwnerContext } from './speechOwner';
import { createPortal } from 'react-dom';
import { recoverLookupUndo, startLookupUndo, type LookupUndoSession } from './lookupUndoSession';
import { useTranslation } from 'react-i18next';
import { Undo2, Volume2 } from 'lucide-react';
import LookupSaveToast from './LookupSaveToast';
import SpeechButton, { SpeechFeedback } from './SpeechButton';
import RecallSection from './RecallSection';
import { useRecallStore } from '../stores/recallStore';
import { recallExpression } from '../lib/recallMatcher';
import ContextPanel from './ContextPanel';
import SoftContentRefresh from './SoftContentRefresh';
import type { Material } from '../lib/materials';
import LongmanResult from './LongmanResult';
import { dictionaryReference, hasSubstantiveTargetContent, lookupLocal, type DictionaryView, type DictionaryResult } from '../lib/dictionaryResult';
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
    onSource?: (record: SavedRecord, isCurrent?: () => boolean) => Promise<void>;
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
    const [sourceHost, setSourceHost] = useState<HTMLDivElement | null>(null);
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
    return <SpeechOwnerContext.Provider value={ownerScope}><ContextPanel compactHeader layoutSlot={props.layoutSlot} label={props.query.expression} interactionKey={props.query} onClose={props.onClose} onClosing={() => { useSpeechStore.getState().stopScope(ownerScope); }}>
      <div className="lookup-stage" style={fontScaleStyle} data-lookup-state={ready ? 'ready' : 'loading'}>
        <div className="lookup-fixed-header">
          <header className="lookup-heading"><div><div className="lookup-word-identity"><h2 lang="en" title={props.query.expression}>{props.query.expression}</h2></div><SpeechButton text={props.query.expression} speechKey="lookup:term" kind={/\s/.test(props.query.expression.trim()) ? 'phrase' : 'word'} label={t('reader.listenExpression')} idleIcon={<Volume2 size={20} strokeWidth={1.8} aria-hidden="true"/>}/></div></header>
          <div className="lookup-source-host" ref={setSourceHost}/>
          <div className="lookup-tabs" data-tab={effectiveTab} role="tablist"><span className="lookup-tab-indicator" aria-hidden="true"/><button data-testid="lookup-meaning-tab" role="tab" aria-selected={effectiveTab==='meaning'} className={effectiveTab==='meaning'?'active':''} onClick={()=>setTab('meaning')}>{t('annotation.meaning')}</button><button data-testid="lookup-records-tab" role="tab" aria-selected={effectiveTab==='records'} className={effectiveTab==='records'?'active':''} onClick={()=>{if (effectiveTab !== 'records') {setRecordsReady(false);setTab('records');}}}>{t('reader.myRecords')} <span className="lookup-record-count">{count}</span></button></div>
        </div>
        <SoftContentRefresh className="lookup-content" contentKey={`${key}:${effectiveTab}`} resizeContainer=".context-panel" ready={effectiveTab === 'meaning' ? ready : recordsReady} label={props.query.expression} pendingLabel={t('common.loading')}>
          <LookupContent key={key} {...props} tab={effectiveTab} onProvider={onProvider} sourceHost={sourceHost} onRecordsReady={onRecordsReady} onReady={onReady} footerHost={footerHost}/>
        </SoftContentRefresh>
        <div className="lookup-action-slot" ref={setFooterHost}/>
      </div>
    </ContextPanel></SpeechOwnerContext.Provider>;

}

function LookupContent({ query, scope, onSkip, drafts, session, onReady, onRecordsReady, footerHost, tab, initialProvider, onProvider, sourceHost, onSource, sourceBusy }: LookupProps & { sourceHost: HTMLDivElement | null; onProvider: (provider: DictionaryView) => void; onReady: (key: string) => void; onRecordsReady: () => void; footerHost: HTMLDivElement | null; tab: 'meaning' | 'records' }) {
    const { t } = useTranslation();
    const preferredOnline = usePreferencesStore(state => state.onlineDictionary);
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
    const initialChoice = existingDraft?.provider ?? initialProvider ?? 'local';
    const [provider, setProvider] = useState<DictionaryView>(initialChoice);
    const requestedProvider = useRef<OnlineProvider>(initialChoice === 'wiktionary' || initialChoice === 'cambridge' ? initialChoice : preferredOnline);
    useEffect(() => { onProvider(provider); }, [provider, onProvider]);
    const [onlineRequest, setOnlineRequest] = useState(initialChoice === 'cambridge' || initialChoice === 'wiktionary' ? 1 : 0);
    const [onlineState, setOnlineState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
    const [onlineError, setOnlineError] = useState<OnlineIssue | null>(null);
    const result = (provider === 'local' || provider === 'longman') ? localResult : onlineResults[provider] ?? null;
    const activeProvider: DictionaryView = provider === 'longman' ? 'local' : provider;
    const [lookupError, setLookupError] = useState('');
    const [loading, setLoading] = useState(true);
    const [retry, setRetry] = useState(0);
    useEffect(() => { const refresh = () => setRetry(value => value + 1); window.addEventListener('lexicue-dictionary-changed', refresh); return () => window.removeEventListener('lexicue-dictionary-changed', refresh); }, []);
    const [draft, setDraft] = useState(existingDraft?.value ?? '');
    const personal = useRef(existingDraft?.personal ?? false);
    const [saved, setSaved] = useState<SavedRecord | null>(null);
    const [receipt, setReceipt] = useState<string | null>(() => session.receipts.get(key) ?? null);
    const initialSave = useRef(session.actions.get(key)?.promise);
    const initialUndo = useRef(session.undos.get(key)?.promise);
    const historyKey = `history:${query.expression.trim()}`;
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
        if (!onlineRequest) return;
        const controller = new AbortController();
        setOnlineState('loading'); setOnlineError(null);
        void runOnlineDictionary({ expression: query.expression, context: query.segment.en_text,
            local: localResultRef.current, mode: 'manual', preferred: requestedProvider.current, signal: controller.signal,
            onResult: (next, value) => {
                if (controller.signal.aborted) return;
                setOnlineResults(current => current[next]?.entries.length && !hasSubstantiveTargetContent(value) ? current : ({ ...current, [next]: value }));
            },
        }).then(outcome => {
            if (controller.signal.aborted) return;
            setOnlineState(outcome.issue ? 'failed' : 'ready'); setOnlineError(outcome.issue);
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
    const touch = () => { drafts.set(key, { value: draft, personal: personal.current, provider }); };
    const switchSource = (next: DictionaryView) => {
        touch(); setProvider(next);
        drafts.set(key, { value: draft, personal: personal.current, provider: next });
    };
    const continueOnline = () => {
        if (onlineState === 'loading') { switchSource(requestedProvider.current); return; }
        switchSource(preferredOnline);
        if (onlineResults[preferredOnline]?.entries.length) return;
        requestedProvider.current = preferredOnline;
        setOnlineRequest(value => value + 1);
    };
    const retryLocal = () => { setLoading(true); setRetry(value => value + 1); };
    const localState: LookupSourceState = loading ? 'loading' : localResult?.entries.length ? 'ready' : lookupError || localResult?.status === 'unavailable' ? 'error' : 'missing';
    const displayedOnline = provider === 'local' || provider === 'longman' ? preferredOnline : provider;
    const onlineStateLabel: LookupSourceState = onlineState === 'loading' ? 'loading'
        : onlineResults[displayedOnline]?.entries.length ? 'ready'
        : onlineState === 'failed' ? onlineError === 'not_found' ? 'missing' : 'error' : 'idle';
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
                drafts.delete(key); action.current = null;
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
    {sourceHost && createPortal(<LookupSourceSwitch selected={activeProvider === 'local' ? 'local' : 'online'} local={localState} online={onlineStateLabel}
      onLocal={() => { switchSource('local'); if(localState === 'error')retryLocal(); }} onOnline={continueOnline}/>, sourceHost)}
    <div className="lookup-body" data-definition-font={definitionFont} data-aux-font={auxiliaryFont} data-active-dictionary={activeProvider} data-online-state={onlineState}>
      {tab === 'records' ? <><RecallSection scope={scope} expression={query.expression} expanded onLoaded={onRecordsReady} onSource={onSource} sourceBusy={sourceBusy} onRemove={changeHistory} removing={busy}/>{historyReceipt && <div className="recall-undo" role="status"><span>{t('savedRecords.removed')}</span><button className="ui-button" disabled={busy} onClick={() => void changeHistory()}><Undo2 size={18} aria-hidden="true"/>{t('savedRecords.undo')}</button></div>}</> : <>
      {example && guideActive && !guidedTour && <div className="example-card-hint"><small role="status">{t(guideStep === 3 ? 'onboarding.step3' : 'onboarding.step2')}</small><button className="ui-button" onClick={onSkip}>{t('onboarding.skip')}</button></div>}
      {(loading && activeProvider === 'local' || onlineState === 'loading' && activeProvider !== 'local') && !result?.entries.length && <LoadingSkeleton kind="text" label={t('common.loading')}/>}
      {result && (!loading || !!result.entries.length) && <LongmanResult result={result} onInteract={touch} compact/>}
      {!loading && activeProvider === 'local' && !localResult?.entries.length && <p className="longman-notice" role="status">{t(lookupError ? 'reader.failed' : 'dictionarySwitch.local.missing')}</p>}
      {onlineState === 'failed' && activeProvider !== 'local' && <p className="longman-notice" role="status">{t(`dictionary.issues.${onlineError ?? 'unavailable'}`)}</p>}

      {!loading && (lookupError || localResult?.status === 'unavailable') && activeProvider === 'local' && <button className="ui-button" onClick={retryLocal}>{t('common.retry')}</button>}
      {showRecall && <p className="lookup-note" role="status">{t('recall.previous')}</p>}
      {saved?.explanation && saved.explanation_source !== 'personal' && <details className="lookup-more"><summary>{t('dictionaryFlow.historicalMeaning')}</summary><p>{saved.explanation}</p><small>{t(`savedRecords.sources.${saved.explanation_source}`)}</small></details>}
      <SpeechFeedback prefix="lookup:"/>
      </>}
    </div>
    {footerHost && createPortal(<>
      {tab === 'meaning' && !saved && !receipt && <footer className="lookup-footer"><button data-testid="lookup-save" className="ui-button saved-primary" onClick={() => void save()} disabled={!canSave}>{t(busy ? 'dictionaryFlow.saving' : 'reader.saveSentence')}</button></footer>}
      {writeError && <p className="saved-error lookup-write-error" role="alert">{writeError}</p>}
      {saveFeedback === 'dictionary.referenceOmitted' && <p className="lookup-note" role="status">{t(saveFeedback)}</p>}
      {receipt && saved && saveFeedback && <LookupSaveToast key={receipt} anchor={footerHost} pending={busy} onUndo={() => void undo()}/>}
    </>, footerHost)}
  </>;
}
