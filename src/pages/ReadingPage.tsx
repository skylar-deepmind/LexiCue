import { bookmarkTitle } from '../lib/bookmarkDesk';
import ReaderHeading from '../components/ReaderHeading';
import useReaderTitleDock from '../components/useReaderTitleDock';
import { finishReadingEntrance, prepareReadingReturn } from '../lib/readingMotion';
import { useRestoreGuard } from '../stores/restoreGuard';
import { readerViews } from '../lib/readerViewMemory';
import { usePageReturn, viewKey, visitState } from '../lib/pageNavigation';
import { invoke } from '@tauri-apps/api/core';
import { positionMatchesMaterial } from '../lib/readingDesk';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { readerNavigation, resolveSavedSource, sourceMatches, type ReaderViewSnapshot } from '../lib/readerNavigation';
import type { SavedRecord } from '../lib/savedRecords';
import { backNavigation } from '../lib/backNavigation';
import './source-return.css';
import { readingReturnPath } from '../lib/readingEntry';
import { useTranslation } from 'react-i18next';
import { SpeechFeedback } from '../components/SpeechButton';
import SourceAudioControls from '../components/SourceAudioControls';
import ReadingPlaybackControls from '../components/ReadingPlaybackControls';
import { ChevronLeft, Play } from 'lucide-react';
import { useReadingToolsStore } from '../stores/readingToolsStore';
import type { ReadingMaterial } from '../lib/materials';
import type { Segment } from '../lib/types';
import type { ReaderToken } from '../stores/readerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useImportStore } from '../stores/importStore';
import { useSpeechStore } from '../stores/speechStore';
import ReadingLookup, { type ReadingQuery, type LookupDraft, type LookupSession } from '../components/ReadingLookup';
import useReadingLayout from '../components/useReadingLayout';
import { useQuietScrollbars } from '../components/useQuietScrollbars';
import useReadingAnchor from '../components/useReadingAnchor';
import useReadingFollow from '../components/useReadingFollow';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { createLookupPlaybackInterruption } from '../lib/lookupPlayback';
import useRecallMatches from '../components/useRecallMatches';
import useContentFontScaleStyle from '../components/useContentFontScaleStyle';
import type { ReadingScope } from '../lib/readingScope';
import { useOnboardingStore } from '../stores/onboardingStore';
import useReadingTranslation from '../components/useReadingTranslation';
import ReadingTranslationDialog from '../components/ReadingTranslationDialog';
import { useRecallStore } from '../stores/recallStore';
import { useMaterialStore } from '../stores/materialStore';
import { compileRecall } from '../lib/recallMatcher';
import type { RecallMatch } from '../lib/recallMatcher';
import ReadingSentenceTokens, { type TokenActions } from '../components/ReadingSentenceTokens';
const noTokens: ReaderToken[] = [];
const noMatches: RecallMatch[] = [];
const returnLookupMemory = new Map<string, { drafts: Map<string, LookupDraft>; session: LookupSession }>();
if (typeof window !== 'undefined') window.addEventListener('lexicue-data-restored', () => returnLookupMemory.clear());
interface Position {
    segment: number;
    offset: number;
}
export default function ReadingPage({ data, scope }: {
    data: ReadingMaterial;
    scope: ReadingScope;
}) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const example = scope.kind === 'example';
    const guide = useOnboardingStore();
    const skip = () => { guide.finish('skipped'); pageBack(); };
    const [params] = useSearchParams();
    const { material } = data;
    const memoryKey=viewKey(location);
    const [viewGeneration]=useState(()=>useRestoreGuard.getState().generation);
    const [memory]=useState(()=>readerViews.get(memoryKey));
    const memoryView=memory?.view.contentHash===material.content_hash ? memory.view : undefined;
    const {back:originBack,origin:pageOrigin}=usePageReturn(readingReturnPath(location.state));
    const pageBack = useCallback(() => { if (location.state?.readingMotion) prepareReadingReturn(material.id); originBack(); }, [originBack, material.id, location.state]);
    const visitToken = location.state?.sourceVisitToken;
    const visit = readerNavigation.get(visitToken);
    const [returnContext] = useState(() => readerNavigation.get(location.state?.restoreVisitToken));
    const returnView = memoryView ?? (returnContext?.origin.kind === 'reader' && returnContext.origin.view.materialId === material.id && returnContext.origin.view.contentHash === material.content_hash ? returnContext.origin.view : undefined);
    const [sourceError, setSourceError] = useState('');
    const sourceRequest = useRef(0);
    const [sourceBusy, setSourceBusy] = useState(false);
    useEffect(() => () => { sourceRequest.current++; }, []);
    const returnToOrigin = useCallback(() => {
        if (pageOrigin) {pageBack();return;}
        if (!visit) {pageBack();return;}
        navigate(visit.origin.path, { state: { restoreVisitToken: visitToken, sourceVisitToken: visit.origin.kind === 'reader' ? visit.origin.parentVisitToken : undefined } });
    }, [navigate, visit, visitToken, pageOrigin, pageBack]);
    useEffect(() => visit || pageOrigin ? backNavigation.setPage(() => { returnToOrigin(); return true; }, 20) : undefined, [visit, pageOrigin, returnToOrigin]);
    const preserveTranslationPosition = useRef<() => void>(() => {});
    const translationState = useReadingTranslation({ materialId: material.id, contentHash: material.content_hash, segments: data.segments, allowGenerate: !example, initial: memory?.translation }, () => preserveTranslationPosition.current());
    const { generated: generatedTranslations, enabled: translation, status: translationStatus } = translationState;
    const [translationToast, setTranslationToast] = useState(true);
    useEffect(() => { setTranslationToast(true); if (translationStatus !== 'error' && translationStatus !== 'partial') return; const timer = setTimeout(() => setTranslationToast(false), 4200); return () => clearTimeout(timer); }, [translationStatus]);
    const segments = useMemo(() => data.segments.map(segment => segment.zh_text?.trim() || !generatedTranslations[segment.id] ? segment : {...segment, zh_text: generatedTranslations[segment.id]}), [data.segments, generatedTranslations]);
    const mediaIdentity = material.source?.key ?? material.document?.identity ?? material.content_hash;
    const sourceBlocks = useMemo(() => {
        const map = new Map<number, NonNullable<typeof material.document>['blocks'][number]>();
        for (const block of material.document?.blocks ?? []) for (const index of block.segment_indices) map.set(index, block);
        return map;
    }, [material.document]);
    const positionKey = `lexicue-reader-state:${mediaIdentity}`;
    const [initial] = useState<Position>(() => {
        if (returnView) return { segment: returnView.segment, offset: returnView.offset };
        if (visit && sourceMatches(visit.target, data)) return { segment: visit.target.segmentIndex, offset: 0 };
        if (scope.kind === 'example') return { segment: segments[0]?.index_num ?? 0, offset: 0 };
        const requested = params.get('segment');
        if (requested !== null && segments.some(segment => segment.index_num === Number(requested)))
            return { segment: Number(requested), offset: 0 };
        try {
            const stored = JSON.parse(localStorage.getItem(positionKey) ?? 'null');
            if (material.position) return {segment: material.position.segment, offset:
                stored?.revision === material.position.revision && stored.segment === material.position.segment ? stored.offset : 0};
            if (positionMatchesMaterial(stored, material, mediaIdentity) && segments.some(segment => segment.index_num === stored.segment))
                return stored;
        }
        catch { /* Ignore invalid local scroll metadata. */ }
        return { segment: material.position?.segment ?? segments[0]?.index_num ?? 0, offset: 0 };
    });
    const progressIntent = useRef(false);
    const lastPosition = useRef(initial.segment);
    const rememberPickedSegment = useRef<(index: number) => void>(() => {});
    const positionRevision = useRef(material.position?.revision);
    const positionWrites = useRef(Promise.resolve());
    const initialIndex = Math.max(0, segments.findIndex(segment => segment.index_num === initial.segment));
    const [first, setFirst] = useState(Math.max(0, initialIndex - 20));
    const [last, setLast] = useState(Math.min(segments.length, Math.max(0, initialIndex - 20) + 80));
    const libraryRecall=useRecallMatches(segments,first,last,!example);
    const exampleMatches=useMemo(()=>{
      const matcher=compileRecall(guide.saved.map(record=>record.expression),[],true);
      return new Map(segments.map(segment=>[segment.index_num,matcher.match(segment.en_text)]));
    },[guide.saved,segments]);
    const recall=example?{matches:exampleMatches,status:'ready'}:libraryRecall;
    const [query, setQuery] = useState<ReadingQuery | null>(() => {
        const q = returnView?.query, segment = q && segments.find(item => item.id === q.segmentId);
        return q && segment && segment.en_text.slice(q.start, q.end).trim() === q.expression.trim() ? { segment, start: q.start, end: q.end, expression: q.expression } : null;
    });
    const lookupView = useRef({ tab: returnView?.query?.tab ?? 'meaning', provider: returnView?.query?.provider });
    const recoveredAudioReady = useSourceMediaStore(state =>
        !!material.source && !material.source.audio && state.entries[material.source.key]?.status === 'ready');
    const hasSourceAudio = !!material.source?.audio || recoveredAudioReady;
    const queryWithMedia = useMemo(() => query ? {...query,media:data.media_refs?.[query.segment.id]} : null, [query,data.media_refs]);
    const drafts = useRef(memory?.drafts ?? returnLookupMemory.get(location.state?.restoreVisitToken)?.drafts ?? new Map<string, LookupDraft>());
    const lookupSession = useRef<LookupSession>(memory?.session ?? returnLookupMemory.get(location.state?.restoreVisitToken)?.session ?? {receipts:new Map(), actions:new Map(), undos:new Map()});
    const lookupTrigger = useRef<{ node: HTMLElement; segment: number; index: number } | null>(null);
    const pointerSelection = useRef(false);
    const pointerRange = useRef<{ segment: number; anchor: number; edge: number } | null>(null);
    const importOpen = useImportStore(s => s.open);
    const scroll = useRef<HTMLDivElement>(null);
    useQuietScrollbars(scroll, true);
    const restored = useRef(false);
    const visible = useRef(new Map<number, HTMLElement>());
    const keyRange = useRef<{
        segment: number;
        anchor: number;
        edge: number;
    } | null>(null);
    const [keyboardRange, setKeyboardRange] = useState<{
        segment: number;
        start: number;
        end: number;
    } | null>(null);
    const size = usePreferencesStore(s => s.learningTextFontSize);
    const auxiliaryFont=usePreferencesStore(state=>state.auxiliaryFontSize);
    const definitionFont=usePreferencesStore(state=>state.definitionFontSize);
    const lineHeight = usePreferencesStore(s => s.readingLineHeight);
    const requestTranslations = () => translationState.request();
    const toggleTranslation = () => translationState.toggle();
    const readingStartIndex = () => {
        const firstVisible = [...visible.current.keys()].sort((a, b) => a - b)[0];
        const index = segments.findIndex(segment => segment.index_num === firstVisible);
        return index >= 0 ? index : initialIndex;
    };
    const [documentJump, setDocumentJump] = useState<number | null>(null);
    const jumpDocument = (index: number) => {
        progressIntent.current = true;
        followAllowed.current = false;
        setQuery(null);
        setFirst(Math.max(0, index));
        setLast(Math.min(segments.length, index + 75));
        setDocumentJump(index);
    };
    useLayoutEffect(() => {
        if (documentJump === null) return;
        scroll.current?.querySelector<HTMLElement>(`[data-sentence="${segments[documentJump]?.index_num}"]`)?.scrollIntoView({block: 'start'});
        setDocumentJump(null);
    }, [documentJump, segments]);
    const [listening, setListening] = useState(memory?.listening ?? false);
    const pausedIndex=useRef(memory?.playbackIndex);
    const speech = useSpeechStore();
    const reading = speech.reading?.key.startsWith(`reader:${mediaIdentity}:`) ? speech.reading : null;
    const currentReadingIndex = reading?.mode === 'source-continuous' && reading.status === 'playing' ? speech.queueIndex : reading?.index;
    const fontScaleStyle = useContentFontScaleStyle();
    const readingLayout = useReadingLayout(scroll, !!query, size, lineHeight, translation);
    const { preservePosition, rememberViewport } = useReadingAnchor(scroll);
    preserveTranslationPosition.current = preservePosition;
    const [playbackTarget, showPlaybackTarget] = useState<number | null>(null);
    const playbackTargetRef = useRef<number | null>(null);
    const segmentIndices = useMemo(() => new Map(segments.map((segment, index) => [segment.index_num, index])), [segments]);
    const speechItems = useMemo(() => segments.map(segment => ({text:segment.en_text,key:`reader:${mediaIdentity}:${segment.index_num}`})), [segments,mediaIdentity]);
    const pendingListen = useRef<number | null>(null);
    const pendingPlayback = useRef<'resume' | 'replay' | null>(null);
    const selectPlaybackTarget = (index: number | null) => {
        if (playbackTargetRef.current === index) return;
        playbackTargetRef.current = index;
        showPlaybackTarget(index);
    };
    const previewPlaybackTarget = () => {
        const viewport = scroll.current;
        if (!viewport) return;
        const bounds = viewport.getBoundingClientRect();
        const tools = viewport.closest('.b-shell')?.querySelector('.mobile-reading-bar')?.getBoundingClientRect();
        const bottom = Math.min(bounds.bottom, tools?.top ?? bounds.bottom);
        const guide = bounds.top + (bottom - bounds.top) / 3;
        const closest = (rows: Iterable<HTMLElement>) => {
            let selected: number | null = null, distance = Infinity;
            for (const row of rows) {
                const index = segmentIndices.get(Number(row.dataset.sentence));
                if (index === undefined) continue;
                const rect = row.querySelector('.reading-original')?.getBoundingClientRect();
                if (!rect || rect.top < bounds.top || rect.top >= bottom) continue;
                const next = Math.abs(rect.top - guide);
                if (next < distance) { distance = next; selected = index; }
            }
            return selected;
        };
        // IntersectionObserver may still report the old rows after a large scroll.
        selectPlaybackTarget(closest(visible.current.values()) ?? closest(viewport.querySelectorAll<HTMLElement>('[data-sentence]')));
    };
    const { allowed: followAllowed, recovery: followRecovery, cancelBrowsing } = useReadingFollow(scroll, {
        sentence: currentReadingIndex == null ? null : segments[currentReadingIndex]?.index_num ?? null,
        playing: listening && !query && reading?.status === 'playing',
        listening,
        recoverable: listening && !query && (reading?.status === 'playing' || reading?.status === 'loading'),
        canBrowse: listening && !query && !importOpen && !!segments.length,
        onBrowse: previewPlaybackTarget,
        onBrowseEnd: () => selectPlaybackTarget(null),
    });
    const lookupInterruption = useRef(createLookupPlaybackInterruption());
    const pauseForLookup = (reason: 'selection' | 'lookup') => {
        const state = useSpeechStore.getState();
        const current = state.reading?.key.startsWith(`reader:${mediaIdentity}:`) ? state.reading : null;
        if (listening && lookupInterruption.current.remember(current)) state.pause(reason);
    };
    const startListening = useCallback((index: number) => {
        lookupInterruption.current.clear();
        followAllowed.current=true;
        const segment=segments[index], ref=segment && data.media_refs?.[segment.id];
        const state=useSpeechStore.getState();
        setSourceError('');
        if (ref && state.playbackMode==='source-continuous' && state.continuousFileId===material.id && state.continuousSourceKey===mediaIdentity) {
            if (state.jumpSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,index})) {
                if (state.reading?.status === 'paused') void state.resume();
                return;
            }
            // A paused or interrupted session may need its original source resolved again.
        }
        const usingSynthesis = state.reading?.mode === 'tts-queue' && state.reading.key.startsWith(`reader:${mediaIdentity}:`);
        if (hasSourceAudio && ref && !usingSynthesis) {
            void state.startSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,key:`reader:${mediaIdentity}:continuous`,index,fallbackItems:speechItems});
        } else void state.startQueue(speechItems,index);
    },[segments,data.media_refs,material.id,hasSourceAudio,speechItems,mediaIdentity,followAllowed]);
    const listenFrom = (index: number) => {
        cancelBrowsing.current();
        progressIntent.current = true;
        followAllowed.current=true;
        setListening(true);
        pointerRange.current = null; keyRange.current = null; setKeyboardRange(null);
        window.getSelection()?.removeAllRanges();
        // Finish closing any card-owned pronunciation before a deliberate start.
        if (query) {
            pendingListen.current = index;
            setQuery(null);
        } else startListening(index);
    };
    useEffect(() => {
        if (query || pendingListen.current === null) return;
        const index = pendingListen.current; pendingListen.current = null;
        if (listening) startListening(index);
    }, [query, listening, startListening]);
    useEffect(() => {
        if (query || !pendingPlayback.current) return;
        const action = pendingPlayback.current; pendingPlayback.current = null;
        if (listening) { followAllowed.current = true; void useSpeechStore.getState()[action === 'resume' ? 'resume' : 'replayCurrent'](); }
    }, [query, listening, followAllowed]);
    const playbackAction = (action: 'resume' | 'replay') => {
        cancelBrowsing.current();
        lookupInterruption.current.clear();
        followAllowed.current = true;
        if (!reading) { listenFrom(pausedIndex.current ?? readingStartIndex()); pausedIndex.current=undefined; return; }
        if (query) { pendingPlayback.current = action; closeLookup(); return; }
        void useSpeechStore.getState()[action === 'resume' ? 'resume' : 'replayCurrent']();
    };
    useLayoutEffect(() => {
        useReadingToolsStore.setState({ available: true, listening, translation, hasTranslation: translationState.available, showRecall: !example,
            translationProgress: translationStatus === 'loading' ? translationState.progress : null,
            playing:reading?.status==='playing'||reading?.status==='loading',loading:reading?.status==='loading',disabled:!segments.length,rate:reading?.rate??speech.rate,
            onPlay:()=>playbackAction('resume'),onPause:()=>{cancelBrowsing.current();followAllowed.current=false;useSpeechStore.getState().pause('user');},
            onRate:()=>{const rates=[1,1.25,1.5,.75] as const;useSpeechStore.getState().setRate(rates[(rates.indexOf(reading?.rate??speech.rate)+1)%rates.length]);},
            onListen: () => { if (listening) { cancelBrowsing.current(); pendingListen.current = null; pendingPlayback.current = null; useSpeechStore.getState().exitReading(); setListening(false); } else if (segments.length) listenFrom(readingStartIndex()); else setListening(true); },
            onTranslation: toggleTranslation,
        });
    });
    useLayoutEffect(() => () => { pendingListen.current = null; useReadingToolsStore.setState({ available: false }); }, []);
    useLayoutEffect(() => {
        const index=currentReadingIndex;
        if (query || !listening || reading?.status !== 'playing' || index == null || !followAllowed.current || !segments[index]) return;
        if (index<first) {setFirst(Math.max(0,index-20));setLast(Math.min(segments.length,index+60));return;}
        // Keep the material currently in view while appending a distant target.
        // Recovery can then scroll there rather than replace the visible prose.
        if (index>=last) setLast(Math.min(segments.length,index+60));
    },[currentReadingIndex,reading?.status,listening,query,first,last,segments,followRecovery,followAllowed]);
    const tokens = useMemo(() => { const map = new Map<number, ReaderToken[]>(); for (const token of data.tokens) {
        const list = map.get(token.segment_index) ?? [];
        list.push(token);
        map.set(token.segment_index, list);
    } return map; }, [data.tokens]);
    useEffect(() => { if (importOpen)
        setQuery(null); }, [importOpen]);
    useEffect(() => { try { if (!example) localStorage.setItem('lexicue-last-reading', JSON.stringify({ id: material.id, hash: material.content_hash })); } catch { /* Reading must remain available when local storage is unavailable. */ } return () => {const current=useSpeechStore.getState();if(current.reading?.key.startsWith(`reader:${mediaIdentity}:`))current.exitReading();}; }, [material.id, material.content_hash, mediaIdentity, example]);
    useLayoutEffect(() => {
        const node = scroll.current;
        if (!node || restored.current) return;
        let cancelled = false;
        const restore = () => {
            if (cancelled) return;
            const target = node.querySelector<HTMLElement>(`[data-sentence="${initial.segment}"]`);
            if (!target) return;
            if (initial.segment === segments[0]?.index_num && initial.offset === 0 && !visit && !returnView) node.scrollTop = 0;
            else node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top + initial.offset;
            // A resize can arrive before the scroll event for this move. Preserve
            // the restored passage through that reflow, starting in this frame.
            rememberViewport();
            restored.current = true;
            if (returnView) { readerNavigation.complete(location.state?.restoreVisitToken); returnLookupMemory.delete(location.state?.restoreVisitToken); }
        };
        if (document.fonts.status==='loaded' || returnView) restore();
        else void document.fonts.ready.then(restore);
        return () => { cancelled = true; };
    }, [initial, returnView, location.state?.restoreVisitToken, segments, visit, rememberViewport]);
    const titleDock = useReaderTitleDock(scroll);
    // Register the handoff after the layout and saved-position restoration.
    useLayoutEffect(() => finishReadingEntrance(material.id), [material.id]);
    useLayoutEffect(() => {
        const node = scroll.current;
        if (!node)
            return;
        visible.current.clear();
        const positions = visible.current;
        let frame = 0;
        let idle: ReturnType<typeof setTimeout> | undefined;
        let picked: number | null = null;
        const currentAnchor = () => {
            if (picked !== null && positions.has(picked)) return [picked, positions.get(picked)!] as const;
            const entries = [...positions.entries()];
            if (node.scrollTop + node.clientHeight >= node.scrollHeight - 3) return entries.sort((a,b)=>b[0]-a[0])[0];
            const y = node.getBoundingClientRect().top + node.clientHeight * .37;
            return entries.sort((a,b)=>Math.abs(a[1].getBoundingClientRect().top-y)-Math.abs(b[1].getBoundingClientRect().top-y))[0];
        };
        const write = () => {
            const segment = currentAnchor()?.[0];
            if (example || !progressIntent.current || !restored.current || segment === undefined) return;
            progressIntent.current=false;
            if(lastPosition.current===segment) return;
            const back = segment < lastPosition.current;
            lastPosition.current = segment;
            const generation = useRestoreGuard.getState().generation;
            positionWrites.current = positionWrites.current.then(async () => {
                if (useRestoreGuard.getState().generation !== generation) return;
                const next = await invoke<string|null>('remember_reading_position', {fileId:material.id,contentHash:material.content_hash,
                    segment,back,legacy:false,parent:positionRevision.current ?? null});
                if (next && useRestoreGuard.getState().generation === generation) {
                    positionRevision.current = next;
                    useMaterialStore.getState().updatePosition(material.id, material.content_hash, { segment, revision: next });
                    try { const stored=JSON.parse(localStorage.getItem(positionKey)??'null'); if(stored?.hash===material.content_hash && stored.segment===segment) localStorage.setItem(positionKey,JSON.stringify({...stored,revision:next})); } catch { /* Best-effort local recovery metadata. */ }
                }
            }).catch(() => { /* Local scroll recovery is still available. */ });
        };
        const markIntent = () => { picked = null; progressIntent.current = true; };
        const markKey = (event:KeyboardEvent) => { if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) markIntent(); };
        const persist = () => {
            const item = currentAnchor();
            if (!example && restored.current && item && node.isConnected) {
                const offset = node.getBoundingClientRect().top - item[1].getBoundingClientRect().top;
                try { localStorage.setItem(positionKey, JSON.stringify({segment:item[0],offset,hash:material.content_hash,revision:positionRevision.current})); } catch { /* Best-effort local reading position. */ }
            }
        };
        rememberPickedSegment.current = index => { picked=index; progressIntent.current=true; persist(); write(); };
        const remember = () => {
            cancelAnimationFrame(frame); frame=requestAnimationFrame(persist);
            clearTimeout(idle); idle=setTimeout(write,300);
        };
        const observer = new IntersectionObserver(entries => { for (const entry of entries) {
            const id = Number((entry.target as HTMLElement).dataset.sentence);
            if (entry.isIntersecting)
                positions.set(id, entry.target as HTMLElement);
            else
                positions.delete(id);
        } remember(); }, { root: node });
        node.querySelectorAll<HTMLElement>('[data-sentence]').forEach(element => observer.observe(element));
        const bottom = node.querySelector('[data-reader-next]');
        const nextObserver = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting))
            setLast(value => Math.min(value + 60, segments.length)); }, { root: node, rootMargin: '120px' });
        if (bottom)
            nextObserver.observe(bottom);
        node.addEventListener('scroll', remember, { passive: true });
        node.addEventListener('wheel',markIntent,{passive:true});
        node.addEventListener('touchmove',markIntent,{passive:true});
        node.addEventListener('keydown',markKey);
        return () => {
            clearTimeout(idle); write(); persist(); rememberPickedSegment.current=()=>{};
            node.removeEventListener('wheel',markIntent); node.removeEventListener('touchmove',markIntent); node.removeEventListener('keydown',markKey);
            observer.disconnect(); nextObserver.disconnect(); cancelAnimationFrame(frame); node.removeEventListener('scroll', remember); };
    }, [first, last, positionKey, segments.length, example, material.content_hash, material.id]);
    const choose = (segment: Segment, start: number, end: number) => {
        rememberPickedSegment.current(segment.index_num);
        followAllowed.current=false;
        pauseForLookup('lookup');
        lookupView.current={tab:'meaning',provider:undefined};
        const text = segment.en_text.slice(start, end);
        if (!text.trim())
            return;
        useImportStore.getState().hide();
        window.getSelection()?.removeAllRanges();
        keyRange.current = null;
        setKeyboardRange(null);
        const trigger = document.activeElement;
        lookupTrigger.current = trigger instanceof HTMLElement && trigger.matches('.reading-word') && trigger.closest('[data-sentence]')?.getAttribute('data-sentence') === String(segment.index_num)
            ? { node: trigger, segment: segment.index_num, index: Number(trigger.dataset.wordIndex) } : null;
        setQuery({ segment, start, end, expression: text.trim(), revealInReader: true });
    };
    const selectText = (segment: Segment, paragraph: HTMLElement) => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount)
            return;
        const range = selection.getRangeAt(0);
        if (!paragraph.contains(range.startContainer) || !paragraph.contains(range.endContainer))
            return;
        const before = range.cloneRange();
        before.selectNodeContents(paragraph);
        before.setEnd(range.startContainer, range.startOffset);
        const start = before.toString().length;
        const after = range.cloneRange();
        after.selectNodeContents(paragraph);
        after.setEnd(range.endContainer, range.endOffset);
        const end = after.toString().length;
        if (/[A-Za-z]/.test(segment.en_text.slice(start, end))) {
            pointerSelection.current = true;
            range.startContainer.parentElement?.closest<HTMLElement>('.reading-word')?.focus({ preventScroll: true });
            choose(segment, start, end);
        }
    };
    const beginPointerRange = (segment: Segment, event: ReactPointerEvent<HTMLElement>) => {
        pointerSelection.current = false;
        pointerRange.current = null;
        if (event.pointerType === 'touch' || event.button !== 0) return;
        if (listening) { followAllowed.current = false; pauseForLookup('selection'); }
        const word = event.target instanceof Element ? event.target.closest<HTMLElement>('.reading-word') : null;
        const index = Number(word?.dataset.wordIndex);
        if (word && Number.isInteger(index)) { word.focus({ preventScroll: true }); pointerRange.current = { segment: segment.id, anchor: index, edge: index }; }
    };
    const extendPointerRange = (segment: Segment, event: ReactPointerEvent<HTMLElement>) => {
        const range = pointerRange.current;
        if (!range || range.segment !== segment.id) return;
        // WebKit may keep dispatching a captured drag to the starting button.
        // Resolve the actual word under the pointer instead of its event target.
        const word = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.reading-word');
        if (word && !event.currentTarget.contains(word)) return;
        const index = Number(word?.dataset.wordIndex);
        if (!word || !Number.isInteger(index) || index === range.edge) return;
        range.edge = index;
        setKeyboardRange({ segment: segment.id, start: Math.min(range.anchor, range.edge), end: Math.max(range.anchor, range.edge) });
    };
    const finishPointerRange = (segment: Segment) => {
        const range = pointerRange.current;
        pointerRange.current = null;
        if (!range || range.segment !== segment.id || range.anchor === range.edge) return;
        const spans = tokens.get(segment.index_num) ?? [];
        pointerSelection.current = true;
        choose(segment, spans[Math.min(range.anchor, range.edge)].start, spans[Math.max(range.anchor, range.edge)].end);
    };
    const cancelPointerRange = () => { if (pointerRange.current) { pointerRange.current = null; setKeyboardRange(null); } };
    const tokenActions = useRef<TokenActions>(null);
    useLayoutEffect(() => {
        tokenActions.current = {
            pointerSelection,
            keyRange,
            choose,
            setKeyboardRange,
            pauseForSelection: () => {
                if (listening) { followAllowed.current = false; pauseForLookup('selection'); }
            },
        };
    });
    const closeLookup = () => {
        const current = useSpeechStore.getState().reading;
        if (lookupInterruption.current.consume(current) && listening && pendingListen.current === null && !pendingPlayback.current) pendingPlayback.current = 'resume';
        if (example) useOnboardingStore.getState().closed();
        // Saving/removing a match can regroup its tokens and replace the DOM
        // trigger retained by ContextPanel. Restore that same logical token.
        const trigger = lookupTrigger.current;
        if (trigger && !trigger.node.isConnected) scroll.current?.querySelector<HTMLElement>(`[data-sentence="${trigger.segment}"] .reading-word[data-word-index="${trigger.index}"]`)?.focus({ preventScroll: true });
        lookupTrigger.current = null;
        keyRange.current = null; pointerRange.current = null; setKeyboardRange(null); setQuery(null);
    };
    const captureView = () => {
        const viewport=scroll.current, top=viewport?.getBoundingClientRect().top ?? 0;
        const anchor=viewport && [...viewport.querySelectorAll<HTMLElement>('[data-sentence]')].find(node=>node.getBoundingClientRect().bottom>top);
        const view:ReaderViewSnapshot={materialId:material.id,contentHash:material.content_hash,
            segment:anchor?Number(anchor.dataset.sentence):initial.segment,offset:anchor?top-anchor.getBoundingClientRect().top:0,
            query:query?{segmentId:query.segment.id,start:query.start,end:query.end,expression:query.expression,...lookupView.current}:undefined};
        return {data,view,drafts:drafts.current,session:lookupSession.current,translation:translationState,
            listening,playbackIndex:currentReadingIndex ?? pausedIndex.current};
    };
    const latestView=useRef(captureView);latestView.current=captureView;
    useLayoutEffect(()=>()=>{if(!example && restored.current && useRestoreGuard.getState().generation===viewGeneration)readerViews.set(memoryKey,latestView.current());},[memoryKey,example,viewGeneration]);
    const visitSource = async (record: SavedRecord, isCurrent?: () => boolean) => {
        if (sourceBusy || example) return;
        const generation = ++sourceRequest.current;
        setSourceBusy(true); setSourceError('');
        try {
            const target = await resolveSavedSource(record);
            if (sourceRequest.current !== generation || isCurrent?.() === false) return;
            if (!target) { setSourceError(t('savedRecords.sourceMissing')); return; }
            const viewport = scroll.current!, top = viewport.getBoundingClientRect().top;
            const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-sentence]')].find(node => node.getBoundingClientRect().bottom > top);
            const view: ReaderViewSnapshot = { materialId: material.id, contentHash: material.content_hash,
                segment: anchor ? Number(anchor.dataset.sentence) : initial.segment, offset: anchor ? top - anchor.getBoundingClientRect().top : 0,
                query: query ? { segmentId: query.segment.id, start: query.start, end: query.end, expression: query.expression, ...lookupView.current } : undefined };
            const token = readerNavigation.create({ kind: 'reader', path: location.pathname + location.search, view, parentVisitToken: visitToken }, target);
            returnLookupMemory.set(token, { drafts: drafts.current, session: lookupSession.current });
            while (returnLookupMemory.size > 16) returnLookupMemory.delete(returnLookupMemory.keys().next().value!);
            readerViews.set(memoryKey, captureView());
            navigate(`/files/${target.fileId}?segment=${target.segmentIndex}`, { state: { sourceVisitToken: token, ...visitState(location) } });
        } catch { if (sourceRequest.current === generation) setSourceError(t('savedRecords.sourceError')); }
        finally { if (sourceRequest.current === generation) setSourceBusy(false); }
    };
    const prepending = useRef<{index:number;top:number}|null>(null);
    useLayoutEffect(()=>{
        const saved=prepending.current,node=scroll.current;
        if(!saved||!node)return;
        const anchor=node.querySelector<HTMLElement>(`[data-sentence="${saved.index}"]`);
        if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-saved.top;
        prepending.current=null;
    },[first]);
    useEffect(()=>{
        const node=scroll.current;if(!node||!first)return;
        let distance=0,touchY:number|null=null,frame=0;
        const earlier=(amount:number)=>{
            if(!restored.current||prepending.current)return;
            distance=amount>0?distance+amount:0;
            if(distance<64||frame)return;
            // Measure after this input's native scroll. Restoring a pre-input
            // anchor would cancel the user's final wheel/touch movement.
            frame=requestAnimationFrame(()=>{
                frame=0;if(prepending.current||node.scrollTop>Math.max(280,node.clientHeight*.5))return;
                const top=node.getBoundingClientRect().top;
                const anchor=[...node.querySelectorAll<HTMLElement>('[data-sentence]')].find(item=>item.getBoundingClientRect().bottom>top);
                if(!anchor)return;
                prepending.current={index:Number(anchor.dataset.sentence),top:anchor.getBoundingClientRect().top};
                setFirst(value=>Math.max(0,value-60));distance=0;
            });
        };
        const wheel=(event:WheelEvent)=>{
            // At the window's top this gesture reveals preceding content. Cancel
            // its clamped native scroll so residual wheel easing cannot start
            // scrolling again after the newly prepended space becomes available.
            if(event.deltaY<0&&node.scrollTop<=1)event.preventDefault();
            earlier(-event.deltaY);
        };
        const start=(event:TouchEvent)=>{touchY=event.touches.length===1?event.touches[0].clientY:null;};
        const move=(event:TouchEvent)=>{if(touchY===null||event.touches.length!==1)return;const y=event.touches[0].clientY;earlier(y-touchY);touchY=y;};
        const end=()=>{touchY=null;};
        const key=(event:KeyboardEvent)=>{if((event.target as Element).closest('input,textarea,[contenteditable="true"]'))return;if(['ArrowUp','PageUp','Home'].includes(event.key))earlier(event.key==='ArrowUp'?32:80);};
        node.addEventListener('wheel',wheel,{passive:false});node.addEventListener('touchstart',start,{passive:true});node.addEventListener('touchmove',move,{passive:true});node.addEventListener('touchend',end);node.addEventListener('touchcancel',end);node.addEventListener('keydown',key);
        return()=>{cancelAnimationFrame(frame);node.removeEventListener('wheel',wheel);node.removeEventListener('touchstart',start);node.removeEventListener('touchmove',move);node.removeEventListener('touchend',end);node.removeEventListener('touchcancel',end);node.removeEventListener('keydown',key);};
    },[first]);
    return <div className="reading-page reader-with-cover" style={fontScaleStyle} data-listening={listening} data-reading-material={material.id}><nav className="reading-breadcrumb" aria-label={t('materials.path')}>{visit || pageOrigin ? <button className="reader-return-origin page-back" aria-label={`${t('common.back')} · ${t(visit?.origin.kind === 'saved' ? 'savedRecords.title' : 'reader.title', { defaultValue: '阅读' })}`} data-testid="source-return" onClick={returnToOrigin}><ChevronLeft className="mobile-reader-back" size={22} aria-hidden="true"/></button> : <button className="page-back" onClick={pageBack} aria-label={t(location.state?.readingOrigin === 'library' ? 'readingDesk.backLibrary' : 'readingDesk.backMaterials')}><ChevronLeft className="mobile-reader-back" size={22} aria-hidden="true"/></button>}
        <span className="reader-docked-title" ref={titleDock.dock} aria-hidden="true">
          <span className="reader-docked-title-motion">
            <span className="reader-docked-title-line" ref={titleDock.line}>{bookmarkTitle(material.name)}</span>
          </span>
        </span>
    </nav><div className="reader-scroll" ref={scroll} tabIndex={0}
      aria-keyshortcuts={playbackTarget === null ? undefined : 'Enter'}
      onKeyDown={event => {
        if (event.currentTarget !== event.target || event.key !== 'Enter' || event.repeat
          || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || playbackTarget === null) return;
        event.preventDefault();
        listenFrom(playbackTarget);
      }}><div className="reading-layout" ref={readingLayout.layout} data-query-open={!!query}><div className="workspace-paper reading-paper" data-recall-state={recall.status} data-font={size} data-lines={lineHeight} data-aux-font={auxiliaryFont} data-definition-font={definitionFont}><ReaderHeading material={material} titleRef={titleDock.title}/>{sourceError && <p className="saved-error" role="status">{sourceError}</p>}{recall.status === 'failed' && <div className="reading-recall-error saved-error" role="status"><span>{t('recall.indexFailed')}</span><button type="button" className="ui-button" onClick={() => void useRecallStore.getState().refresh()}>{t('common.retry')}</button></div>}
    {example && <section className="example-intro" aria-label={t('onboarding.sample')}>
      <div><h1>{t('onboarding.sample')}</h1>{guide.active && !guide.tour && !query && <button className="ui-button" onClick={skip}>{t('onboarding.skip')}</button>}</div>
      <p>{t('onboarding.privacy')}</p>
      <p className="example-instruction" role="status">{guide.active && !guide.tour ? t(`onboarding.step${guide.step}`) : ''}</p>
    </section>}
    {Object.entries(data.media_refs ?? {}).slice(0,1).map(([id, ref]) => <SourceAudioControls key={ref.source.key} reference={ref} target={{segment_id:Number(id)}} text={segments[0]?.en_text ?? ''} speechKey="reader:source" statusOnly/>)}
    {material.document && (material.document.sections.length > 1 || material.document.origin || material.document.blocks.some(block => block.kind === 'code')) && <div className="reading-document-nav">
        {material.document.sections.length > 1 && <label>{t('documents.jump')}<select aria-label={t('documents.jump')} value={sourceBlocks.get(segments[first]?.index_num)?.section_id ?? ''} onChange={event => {
            const block = material.document?.blocks.find(block => block.section_id === event.target.value && block.segment_indices.length);
            if (block) jumpDocument(segments.findIndex(segment => segment.index_num === block.segment_indices[0]));
        }}>{material.document.sections.filter(section => material.document!.blocks.some(block => block.section_id === section.id && block.segment_indices.length)).map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
        {material.document.origin && <details className="reading-document-code"><summary>{t('documents.fullPreview')}</summary>{material.document.blocks.map(block => <p key={block.id} style={{whiteSpace:'pre-wrap'}}>{block.text}</p>)}</details>}
        {material.document.blocks.some(block => block.kind === 'code') && <details className="reading-document-code"><summary>{t('documents.codeBlocks')}</summary>{material.document.blocks.filter(block => block.kind === 'code').map(block => <pre key={block.id}>{block.text}</pre>)}</details>}
    </div>}
    {!example && (translationStatus === 'loading' || translationToast && (translationStatus === 'error' || translationStatus === 'partial')) && <div className="reading-translation-status" role="status">
        <span>{t(translationStatus === 'loading' ? 'reader.translationProgress' : translationStatus === 'error' ? 'reader.translationError' : 'documents.translationFailed', translationState.progress ?? {})}</span>
        <button className="ui-button" onClick={() => translationStatus === 'loading' ? translationState.cancel() : void requestTranslations()}>{t(translationStatus === 'loading' ? 'common.cancel' : 'common.retry')}</button>
    </div>}
    {!segments.length && <p className="lookup-note" role="status">{t('reader.emptyContent')}</p>}
    {segments.slice(first, last).map((segment, offset) => {
      const key = speechItems[first + offset].key;
      const active = listening && currentReadingIndex===first+offset;
      const failed = speech.errorKey === key && speech.error;
      const matches = recall.matches.get(segment.index_num);
      const selection = keyboardRange ? undefined : query?.segment.id === segment.id ? query : undefined;
      const keyboardSelection = keyboardRange?.segment === segment.id ? keyboardRange : undefined;
      return <section className="reading-sentence" key={segment.id} data-sentence={segment.index_num} data-source-highlight={visit?.target.segmentIndex === segment.index_num || undefined} data-current={active} data-playback-target={playbackTarget === first + offset || undefined} data-speech-state={active ? speech.status : failed ? 'error' : 'idle'}>
      <div><p className="reading-original" lang="en" onPointerDown={event => beginPointerRange(segment, event)} onPointerMove={event => extendPointerRange(segment, event)} onPointerUp={() => finishPointerRange(segment)} onPointerCancel={cancelPointerRange} onPointerLeave={cancelPointerRange} onMouseDown={event => { if (event.button === 0) { event.preventDefault(); window.getSelection()?.removeAllRanges(); } }} onMouseUp={event => selectText(segment, event.currentTarget)} onTouchEnd={event => selectText(segment, event.currentTarget)}>
        {playbackTarget === first + offset && <button className="reader-playback-guide" type="button"
          aria-label={t('reader.listenFromSentence', { index: segment.index_num + 1 })}
          onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}
          onTouchEnd={event => event.stopPropagation()} onClick={() => listenFrom(first + offset)}>
          <Play size={12} fill="currentColor" strokeWidth={0} aria-hidden="true"/>
        </button>}
        <ReadingSentenceTokens segment={segment} spans={tokens.get(segment.index_num) ?? noTokens} matches={matches?.length ? matches : noMatches} selection={selection} keyboardSelection={keyboardSelection} actions={tokenActions}/></p>{segment.zh_text && <div className="reading-translation-disclosure" data-open={translation || undefined} aria-hidden={!translation}><div className="reading-translation-clip"><p className="reading-translation">{segment.zh_text}</p></div></div>}{listening && (active && speech.loading || failed) && <span className="sr-only" role="status">{t(active ? 'common.loading' : 'speech.retry')}</span>}{failed && <SpeechFeedback speechKeys={[key]}/>}</div>
    </section>; })}
    {last < segments.length && <button className="ui-button reader-next" data-reader-next="" onClick={() => setLast(value => Math.min(value + 60, segments.length))}>{t('reader.moreSentences')}</button>}
    {!query && <SpeechFeedback prefix="reader:"/>}
  </div><div className="reading-query-slot" ref={readingLayout.slot} aria-hidden="true"/></div></div>
    <ReadingPlaybackControls visible={listening} playing={reading?.status === 'playing' || reading?.status === 'loading'} loading={reading?.status === 'loading'} paused={reading?.status === 'paused'} restartSentence={reading?.status === 'paused' && reading.resumeMode === 'restart-sentence'} disabled={!segments.length} rate={reading?.rate ?? speech.rate} onPlay={() => playbackAction('resume')} onPause={() => { cancelBrowsing.current(); followAllowed.current = false; useSpeechStore.getState().pause('user'); }} onReplay={() => playbackAction('replay')} onRate={() => { const rates = [1, 1.25, 1.5, .75] as const; useSpeechStore.getState().setRate(rates[(rates.indexOf(reading?.rate ?? speech.rate) + 1) % rates.length]); }} onExit={() => { cancelBrowsing.current(); pendingListen.current = null; pendingPlayback.current = null; useSpeechStore.getState().exitReading(); setListening(false); }}/>
    {queryWithMedia && <ReadingLookup layoutSlot={readingLayout.slot} query={queryWithMedia} material={material} scope={scope} onClose={closeLookup} onSkip={skip} drafts={drafts.current} session={lookupSession.current} initialTab={query?.segment.id===returnView?.query?.segmentId && query?.start===returnView?.query?.start && query?.end===returnView?.query?.end ? returnView?.query?.tab : undefined} initialProvider={query?.segment.id===returnView?.query?.segmentId && query?.start===returnView?.query?.start && query?.end===returnView?.query?.end ? returnView?.query?.provider : undefined} onViewChange={view => { lookupView.current = {tab:view.tab,provider:view.provider}; }} onSource={example ? undefined : visitSource} sourceBusy={sourceBusy}/>}
    {translationState.confirming && <ReadingTranslationDialog count={translationState.missingCount} onConfirm={translationState.confirm} onCancel={translationState.dismissConfirmation}/>}
  </div>;
}
