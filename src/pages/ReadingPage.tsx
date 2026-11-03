import { positionMatchesMaterial } from '../lib/readingDesk';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { readerNavigation, resolveSavedSource, sourceMatches, type ReaderViewSnapshot } from '../lib/readerNavigation';
import type { SavedRecord } from '../lib/savedRecords';
import { backNavigation } from '../lib/backNavigation';
import './source-return.css';
import { readingReturnPath } from '../lib/readingEntry';
import { useTranslation } from 'react-i18next';
import { SpeechFeedback } from '../components/SpeechButton';
import SourceAudioControls from '../components/SourceAudioControls';
import ReadingPlaybackControls from '../components/ReadingPlaybackControls';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { Play, ArrowDownToLine } from 'lucide-react';
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
import { createLookupPlaybackInterruption } from '../lib/lookupPlayback';
import useRecallMatches from '../components/useRecallMatches';
import useContentFontScaleStyle from '../components/useContentFontScaleStyle';
import type { ReadingScope } from '../lib/readingScope';
import { useOnboardingStore } from '../stores/onboardingStore';
import useReadingTranslation from '../components/useReadingTranslation';
import { documentLocationLabel } from '../lib/documentTypes';
import type { RecallMatch } from '../lib/recallMatcher';
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
    const skip = () => { guide.finish('skipped'); navigate('/files', {replace:true}); };
    const [params] = useSearchParams();
    const { material } = data;
    const visitToken = location.state?.sourceVisitToken;
    const visit = readerNavigation.get(visitToken);
    const [returnContext] = useState(() => readerNavigation.get(location.state?.restoreVisitToken));
    const returnView = returnContext?.origin.kind === 'reader' && returnContext.origin.view.materialId === material.id && returnContext.origin.view.contentHash === material.content_hash ? returnContext.origin.view : undefined;
    const [sourceError, setSourceError] = useState('');
    const sourceRequest = useRef(0);
    const [sourceBusy, setSourceBusy] = useState(false);
    useEffect(() => () => { sourceRequest.current++; }, []);
    const returnToOrigin = useCallback(() => {
        if (!visit) return;
        navigate(visit.origin.path, { state: { restoreVisitToken: visitToken, sourceVisitToken: visit.origin.kind === 'reader' ? visit.origin.parentVisitToken : undefined } });
    }, [navigate, visit, visitToken]);
    useEffect(() => visit ? backNavigation.setPage(() => { returnToOrigin(); return true; }, 20) : undefined, [visit, returnToOrigin]);
    const preserveTranslationPosition = useRef<() => void>(() => {});
    const translationState = useReadingTranslation({ materialId: material.id, contentHash: material.content_hash, segments: data.segments, allowGenerate: !example && !material.source }, () => preserveTranslationPosition.current());
    const { generated: generatedTranslations, enabled: translation, status: translationStatus } = translationState;
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
            if (positionMatchesMaterial(stored, material, mediaIdentity) && segments.some(segment => segment.index_num === stored.segment))
                return stored;
        }
        catch { /* Ignore invalid local scroll metadata. */ }
        return { segment: segments[0]?.index_num ?? 0, offset: 0 };
    });
    const initialIndex = Math.max(0, segments.findIndex(segment => segment.index_num === initial.segment));
    const [first, setFirst] = useState(Math.max(0, initialIndex - 20));
    const [last, setLast] = useState(Math.min(segments.length, Math.max(0, initialIndex - 20) + 80));
    const recall=useRecallMatches(segments,first,last,!example);
    const [query, setQuery] = useState<ReadingQuery | null>(() => {
        const q = returnView?.query, segment = q && segments.find(item => item.id === q.segmentId);
        return q && segment && segment.en_text.slice(q.start, q.end).trim() === q.expression.trim() ? { segment, start: q.start, end: q.end, expression: q.expression } : null;
    });
    const lookupView = useRef({ tab: returnView?.query?.tab ?? 'meaning', provider: returnView?.query?.provider });
    const queryWithMedia = useMemo(() => query ? {...query,media:data.media_refs?.[query.segment.id]} : null, [query,data.media_refs]);
    const drafts = useRef(returnLookupMemory.get(location.state?.restoreVisitToken)?.drafts ?? new Map<string, LookupDraft>());
    const lookupSession = useRef<LookupSession>(returnLookupMemory.get(location.state?.restoreVisitToken)?.session ?? {receipts:new Map(), actions:new Map(), undos:new Map()});
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
    const visibleSegments = () => {
        const indices = [...visible.current.keys()].sort((a, b) => a - b);
        return indices.length ? indices.map(index => data.segments.find(segment => segment.index_num === index)!).filter(Boolean) : data.segments.slice(first, first + 8);
    };
    const requestTranslations = () => translationState.request(visibleSegments());
    const toggleTranslation = () => translationState.toggle(visibleSegments());
    const readingStartIndex = () => {
        const firstVisible = [...visible.current.keys()].sort((a, b) => a - b)[0];
        const index = segments.findIndex(segment => segment.index_num === firstVisible);
        return index >= 0 ? index : initialIndex;
    };
    const [documentJump, setDocumentJump] = useState<number | null>(null);
    const jumpDocument = (index: number) => {
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
    const [listening, setListening] = useState(false);
    const speech = useSpeechStore();
    const reading = speech.reading?.key.startsWith(`reader:${mediaIdentity}:`) ? speech.reading : null;
    const currentReadingIndex = reading?.mode === 'source-continuous' && reading.status === 'playing' ? speech.queueIndex : reading?.index;
    const fontScaleStyle = useContentFontScaleStyle();
    const readingLayout = useReadingLayout(scroll);
    const preserveReadingPosition = useReadingAnchor(scroll);
    preserveTranslationPosition.current = preserveReadingPosition;
    const mediaEntries = useSourceMediaStore(state => state.entries);
    const speechItems = useMemo(() => segments.map(segment => ({text:segment.en_text,key:`reader:${mediaIdentity}:${segment.index_num}`})), [segments,mediaIdentity]);
    const pendingListen = useRef<number | null>(null);
    const pendingPlayback = useRef<'resume' | 'replay' | null>(null);
    const { allowed: followAllowed, recovery: followRecovery } = useReadingFollow(scroll, currentReadingIndex == null ? null : segments[currentReadingIndex]?.index_num ?? null, listening && !query && reading?.status === 'playing', listening, listening && !query && (reading?.status === 'playing' || reading?.status === 'loading'));
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
        if (state.playbackMode==='source-continuous' && state.continuousFileId===material.id && state.continuousSourceKey===mediaIdentity) {
            if (!ref) { setSourceError(t('sourceAudio.noTiming')); return; }
            if (state.jumpSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,index})) {
                setSourceError('');
                if (state.reading?.status === 'paused') void state.resume();
                return;
            }
            // A paused or interrupted session may need its original source resolved again.
        }
        if (material.source) {
            if (!ref) { setSourceError(t('sourceAudio.noTiming')); return; }
            setSourceError('');
            void state.startSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,key:`reader:${mediaIdentity}:continuous`,index});
        } else void state.startQueue(speechItems.map(({text,key})=>({text,key})),index);
    },[segments,data.media_refs,material.id,material.source,speechItems,mediaIdentity,t,followAllowed]);
    const listenFrom = (index: number) => {
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
        lookupInterruption.current.clear();
        followAllowed.current = true;
        if (!reading) { listenFrom(readingStartIndex()); return; }
        if (query) { pendingPlayback.current = action; closeLookup(); return; }
        void useSpeechStore.getState()[action === 'resume' ? 'resume' : 'replayCurrent']();
    };
    useLayoutEffect(() => {
        useReadingToolsStore.setState({ available: true, listening, translation, hasTranslation: translationState.available, showRecall: !example,
            onListen: () => { if (listening) { pendingListen.current = null; pendingPlayback.current = null; useSpeechStore.getState().exitReading(); setListening(false); } else if (segments.length) listenFrom(readingStartIndex()); else setListening(true); },
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
        let cancelled = false, frame = 0;
        const restore = () => { frame = requestAnimationFrame(() => {
            if (cancelled) return;
            const target = node.querySelector<HTMLElement>(`[data-sentence="${initial.segment}"]`);
            if (!target) return;
            node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top + initial.offset;
            restored.current = true;
            if (returnView) { readerNavigation.complete(location.state?.restoreVisitToken); returnLookupMemory.delete(location.state?.restoreVisitToken); }
        }); };
        void document.fonts.ready.then(restore);
        return () => { cancelled = true; cancelAnimationFrame(frame); };
    }, [initial, returnView, location.state?.restoreVisitToken]);
    useLayoutEffect(() => {
        const node = scroll.current;
        if (!node)
            return;
        visible.current.clear();
        const positions = visible.current;
        let frame = 0;
        const persist = () => {
            const item = [...positions.entries()].sort((a, b) => a[0] - b[0])[0];
            if (!example && item && node.isConnected) {
                const offset = node.getBoundingClientRect().top - item[1].getBoundingClientRect().top;
                try { localStorage.setItem(positionKey, JSON.stringify({segment:item[0],offset,hash:material.content_hash})); } catch { /* Best-effort local reading position. */ }
            }
        };
        const remember = () => {cancelAnimationFrame(frame);frame=requestAnimationFrame(persist);};
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
        return () => { persist();observer.disconnect(); nextObserver.disconnect(); cancelAnimationFrame(frame); node.removeEventListener('scroll', remember); };
    }, [first, last, positionKey, segments.length, example, material.content_hash]);
    const choose = (segment: Segment, start: number, end: number) => {
        followAllowed.current=false;
        pauseForLookup('lookup');
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
        setQuery({ segment, start, end, expression: text.trim() });
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
        if (event.pointerType !== 'touch' && event.button !== 0) return;
        if (listening) { followAllowed.current = false; pauseForLookup('selection'); }
        if (event.pointerType === 'touch') return;
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
    const paragraph = (segment: Segment) => {
        const spans = tokens.get(segment.index_num) ?? [];
        const matches = recall.matches.get(segment.index_num) ?? [];
        const pieces: ReactNode[] = [];
        let group: { match: RecallMatch; pieces: ReactNode[] } | null = null;
        const flushGroup = () => {
            if (!group) return;
            pieces.push(<span className="reading-recall" key={`recall-${group.match.start}-${group.match.end}`} data-recall-start={group.match.start} data-recall-end={group.match.end}>{group.pieces}</span>);
            group = null;
        };
        const append = (piece: ReactNode, match?: RecallMatch) => {
            if (group?.match !== match) flushGroup();
            if (match && !group) group = { match, pieces: [] };
            (group?.pieces ?? pieces).push(piece);
        };
        // Decorate only characters inside the existing match. In particular,
        // trailing punctuation stays attached to its word without being painted.
        const gap = (start: number, end: number, match?: RecallMatch) => {
            if (start >= end) return '';
            const text = segment.en_text.slice(start, end);
            if (!match || start >= match.end || end <= match.start) return text;
            const from = Math.max(start, match.start), to = Math.min(end, match.end);
            return <Fragment key={`gap-${start}-${end}`}>{segment.en_text.slice(start, from)}<span className="reading-recall-ink reading-recall-gap">{segment.en_text.slice(from, to)}</span>{segment.en_text.slice(to, end)}</Fragment>;
        };
        const appendGap = (start: number, end: number) => {
            let cursor = start;
            for (const match of matches) {
                if (match.end <= cursor || match.start >= end) continue;
                const from = Math.max(cursor, match.start), to = Math.min(end, match.end);
                if (cursor < from) append(segment.en_text.slice(cursor, from));
                append(gap(from, to, match), match);
                cursor = to;
            }
            if (cursor < end) append(segment.en_text.slice(cursor, end));
        };
        let offset = 0;
        spans.forEach((token, index) => {
            appendGap(offset, token.start);
            const marked=matches.find(match=>token.start>=match.start&&token.end<=match.end);
            const selected = keyboardRange ? keyboardRange.segment === segment.id && index >= keyboardRange.start && index <= keyboardRange.end : query?.segment.id === segment.id && token.start >= query.start && token.end <= query.end;
            const punctuation = segment.en_text.slice(token.end, spans[index + 1]?.start ?? segment.en_text.length).match(/^[,.;:!?…’”"')\]]+/)?.[0] ?? '';
            const word = marked ? <span className="reading-recall-ink">{segment.en_text.slice(token.start, token.end)}</span> : segment.en_text.slice(token.start, token.end);
            const tail = gap(token.end, token.end + punctuation.length, marked);
            append(<span key={`${token.start}-${token.end}`} className="reading-token"><button className={`reading-word${marked?' reading-word--recalled':''}`} data-word-index={index} data-recall={marked?.expression} title={marked?t('recall.marked',{expression:marked.expression}):undefined} aria-description={marked?t('recall.marked',{expression:marked.expression}):undefined} aria-pressed={!!selected} onClick={event => { if (pointerSelection.current && event.detail !== 0) { pointerSelection.current = false; return; } if (event.detail === 0 || !window.getSelection()?.toString().trim()) {
                event.currentTarget.focus({preventScroll:true});
                choose(segment, marked?.start??token.start, marked?.end??token.end); } }} onKeyDown={event => { if (!event.shiftKey || !['ArrowRight', 'ArrowLeft'].includes(event.key))
                return; event.preventDefault(); if (listening) { followAllowed.current = false; pauseForLookup('selection'); } const range = keyRange.current?.segment === segment.id ? keyRange.current : { segment: segment.id, anchor: index, edge: index }; range.edge = Math.max(0, Math.min(spans.length - 1, range.edge + (event.key === 'ArrowRight' ? 1 : -1))); keyRange.current = range; setKeyboardRange({ segment: segment.id, start: Math.min(range.anchor, range.edge), end: Math.max(range.anchor, range.edge) }); }} onKeyUp={event => { if (event.key !== 'Shift' || !keyRange.current)
                return; const range = keyRange.current; keyRange.current = null; choose(segment, spans[Math.min(range.anchor, range.edge)].start, spans[Math.max(range.anchor, range.edge)].end); }}>{word}</button>{tail}</span>, marked);
            offset = token.end + punctuation.length;
        });
        appendGap(offset, segment.en_text.length);
        flushGroup();
        return pieces;
    };
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
    const visitSource = async (record: SavedRecord) => {
        if (sourceBusy || example) return;
        const generation = ++sourceRequest.current;
        setSourceBusy(true); setSourceError('');
        try {
            const target = await resolveSavedSource(record);
            if (sourceRequest.current !== generation) return;
            if (!target) { setSourceError(t('savedRecords.sourceMissing')); return; }
            const viewport = scroll.current!, top = viewport.getBoundingClientRect().top;
            const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-sentence]')].find(node => node.getBoundingClientRect().bottom > top);
            const view: ReaderViewSnapshot = { materialId: material.id, contentHash: material.content_hash,
                segment: anchor ? Number(anchor.dataset.sentence) : initial.segment, offset: anchor ? top - anchor.getBoundingClientRect().top : 0,
                query: query ? { segmentId: query.segment.id, start: query.start, end: query.end, expression: query.expression, ...lookupView.current } : undefined };
            const token = readerNavigation.create({ kind: 'reader', path: location.pathname + location.search, view, parentVisitToken: visitToken }, target);
            returnLookupMemory.set(token, { drafts: drafts.current, session: lookupSession.current });
            while (returnLookupMemory.size > 16) returnLookupMemory.delete(returnLookupMemory.keys().next().value!);
            navigate(`/files/${target.fileId}?segment=${target.segmentIndex}`, { state: { sourceVisitToken: token } });
        } catch { if (sourceRequest.current === generation) setSourceError(t('savedRecords.sourceError')); }
        finally { if (sourceRequest.current === generation) setSourceBusy(false); }
    };
    const previous = () => { const node = scroll.current; if (!node)
        return; const height = node.scrollHeight; setFirst(value => Math.max(0, value - 60)); requestAnimationFrame(() => { node.scrollTop += node.scrollHeight - height; }); };
    return <div className="reading-page" style={fontScaleStyle} data-listening={listening}><nav className="reading-breadcrumb" aria-label={t('materials.path')}>{visit ? <button className="reader-return-origin" data-testid="source-return" onClick={returnToOrigin}>{t('common.back')} · {t(visit.origin.kind === 'saved' ? 'savedRecords.title' : 'reader.title', { defaultValue: '阅读' })}</button> : <Link to={readingReturnPath(location.state)} state={{restoreLibrary:true}}>{t(location.state?.readingOrigin === 'library' ? 'readingDesk.library' : 'materials.title')}</Link>}<span aria-hidden="true">/</span><span>{material.name}</span></nav><div className="reader-scroll" ref={scroll}><div className="reading-layout" ref={readingLayout.layout} data-query-open={!!query}><div className="workspace-paper reading-paper" data-recall-state={recall.status} data-font={size} data-lines={lineHeight} data-aux-font={auxiliaryFont} data-definition-font={definitionFont}><h1 className="reading-title" lang="en">{material.name}</h1>{sourceError && <p className="saved-error" role="status">{sourceError}</p>}
    {example && <section className="example-intro" aria-label={t('onboarding.sample')}>
      <div><h1>{t('onboarding.sample')}</h1>{guide.active && !query && <button className="ui-button" onClick={skip}>{t('onboarding.skip')}</button>}</div>
      <p>{t('onboarding.privacy')}</p>
      <p className="example-instruction" role="status">{guide.active ? t(`onboarding.step${guide.step}`) : ''}</p>
    </section>}
    {Object.entries(data.media_refs ?? {}).slice(0,1).map(([id, ref]) => <SourceAudioControls key={ref.source.key} reference={ref} target={{segment_id:Number(id)}} text={segments[0]?.en_text ?? ''} speechKey="reader:source" statusOnly/>)}
    {material.source && !material.source.audio && <p className="lookup-note" role="status">{t('sourceAudio.sourceUnavailable')}</p>}
    {material.document && <div className="reading-document-nav">
        <span>{material.document.origin?.kind === 'clipboard' ? t('materials.importDialog.clipboardText') : material.document.origin?.kind === 'webpage' ? material.document.origin.final_url : material.document.original_format.toUpperCase()} · {material.name}</span>
        {material.document.sections.length > 1 && <label>{t('documents.jump')}<select aria-label={t('documents.jump')} value={sourceBlocks.get(segments[first]?.index_num)?.section_id ?? ''} onChange={event => {
            const block = material.document?.blocks.find(block => block.section_id === event.target.value && block.segment_indices.length);
            if (block) jumpDocument(segments.findIndex(segment => segment.index_num === block.segment_indices[0]));
        }}>{material.document.sections.filter(section => material.document!.blocks.some(block => block.section_id === section.id && block.segment_indices.length)).map(section => <option key={section.id} value={section.id}>{section.title}</option>)}</select></label>}
        <button className="ui-button ui-button--icon" aria-label={t('documents.last')} title={t('documents.last')} onClick={() => jumpDocument(segments.length - 1)}><ArrowDownToLine size={20} aria-hidden="true" /></button>
        {material.document.origin && <details className="reading-document-code"><summary>{t('documents.fullPreview')}</summary>{material.document.blocks.map(block => <p key={block.id} style={{whiteSpace:'pre-wrap'}}>{block.text}</p>)}</details>}
        {material.document.blocks.some(block => block.kind === 'code') && <details className="reading-document-code"><summary>{t('documents.codeBlocks')}</summary>{material.document.blocks.filter(block => block.kind === 'code').map(block => <pre key={block.id}>{block.text}</pre>)}</details>}
    </div>}
    {translation && !example && !material.source && (translationStatus === 'loading' || segments.some(segment => !!segment.en_text.trim() && !segment.zh_text?.trim())) && <div className="reading-translation-status" role="status">
        <span>{t(translationStatus === 'loading' ? 'documents.translating' : translationStatus === 'error' ? 'reader.translationError' : translationStatus === 'partial' ? 'documents.translationFailed' : 'documents.translationOnDemand')}</span>
        <button className="ui-button" disabled={translationStatus === 'loading'} onClick={() => void requestTranslations()}>{t(translationStatus === 'error' || translationStatus === 'partial' ? 'common.retry' : 'documents.translateVisible')}</button>
    </div>}
    {!segments.length && <p className="lookup-note" role="status">{t('reader.emptyContent')}</p>}
    {first > 0 && <button className="ui-button" onClick={previous}>{t('reader.previousSentences')}</button>}
    {segments.slice(first, last).map((segment, offset) => {
      const sourceBlock = sourceBlocks.get(segment.index_num);
      const key = speechItems[first + offset].key;
      const continuous = speech.playbackMode==='source-continuous' && speech.continuousFileId===material.id && speech.continuousSourceKey===mediaIdentity;
      const noTiming=(continuous || !!material.source?.audio && mediaEntries[mediaIdentity]?.status==='ready') && !data.media_refs?.[segment.id];
      const active = listening && currentReadingIndex===first+offset;
      const failed = speech.errorKey === key && speech.error;
      return <section className="reading-sentence" key={segment.id} data-sentence={segment.index_num} data-source-highlight={visit?.target.segmentIndex === segment.index_num || undefined} data-current={active} data-speech-state={active ? speech.status : failed ? 'error' : 'idle'}>
      <div className="sentence-side">{listening ? <button type="button" className="sentence-listen" disabled={noTiming} title={noTiming ? t('sourceAudio.noTiming') : undefined} aria-busy={active && speech.loading} aria-label={t(noTiming ? 'sourceAudio.noTiming' : failed ? 'speech.retry' : 'reader.listenFromSentence', { index: segment.index_num + 1 })} aria-current={active ? 'step' : undefined} onClick={event => { event.stopPropagation(); listenFrom(first + offset); }}>
        <small className="sentence-number" aria-hidden="true">{segment.index_num + 1}</small><Play className="sentence-play" size={16} aria-hidden="true"/>
      </button> : <span className="sentence-number-static"><small>{segment.index_num + 1}</small></span>}</div>
      <div>{sourceBlock && <small className="reading-document-location">{[material.document?.sections.find(section => section.id === sourceBlock.section_id)?.title, documentLocationLabel(sourceBlock.locations[0])].filter(Boolean).join(' · ')}</small>}<p className="reading-original" lang="en" onPointerDown={event => beginPointerRange(segment, event)} onPointerMove={event => extendPointerRange(segment, event)} onPointerUp={() => finishPointerRange(segment)} onPointerCancel={cancelPointerRange} onPointerLeave={cancelPointerRange} onMouseDown={event => { if (event.button === 0) { event.preventDefault(); window.getSelection()?.removeAllRanges(); } }} onMouseUp={event => selectText(segment, event.currentTarget)} onTouchEnd={event => selectText(segment, event.currentTarget)}>{paragraph(segment)}</p>{segment.zh_text && <div className="reading-translation-disclosure" data-open={translation || undefined} aria-hidden={!translation}><div className="reading-translation-clip"><p className="reading-translation">{segment.zh_text}</p></div></div>}{listening && (active && speech.loading || failed) && <span className="sr-only" role="status">{t(active ? 'common.loading' : 'speech.retry')}</span>}{failed && <SpeechFeedback speechKeys={[key]}/>}</div>
    </section>; })}
    {last < segments.length && <button className="ui-button reader-next" data-reader-next="" onClick={() => setLast(value => Math.min(value + 60, segments.length))}>{t('reader.moreSentences')}</button>}
    {!query && <SpeechFeedback prefix="reader:"/>}
  </div><div className="reading-query-slot" ref={readingLayout.slot} aria-hidden="true"/></div></div>
    <ReadingPlaybackControls visible={listening} playing={reading?.status === 'playing' || reading?.status === 'loading'} loading={reading?.status === 'loading'} paused={reading?.status === 'paused'} restartSentence={reading?.status === 'paused' && reading.resumeMode === 'restart-sentence'} disabled={!segments.length} rate={reading?.rate ?? speech.rate} onPlay={() => playbackAction('resume')} onPause={() => { followAllowed.current = false; useSpeechStore.getState().pause('user'); }} onReplay={() => playbackAction('replay')} onRate={() => { const rates = [1, 1.25, 1.5, .75] as const; useSpeechStore.getState().setRate(rates[(rates.indexOf(reading?.rate ?? speech.rate) + 1) % rates.length]); }} onExit={() => { pendingListen.current = null; pendingPlayback.current = null; useSpeechStore.getState().exitReading(); setListening(false); }}/>
    {queryWithMedia && <ReadingLookup layoutSlot={readingLayout.slot} query={queryWithMedia} material={material} scope={scope} onClose={closeLookup} onSkip={skip} drafts={drafts.current} session={lookupSession.current} initialTab={returnView?.query?.tab} initialProvider={returnView?.query?.provider} onViewChange={view => { lookupView.current = {tab:view.tab,provider:view.provider}; }} onSource={example ? undefined : visitSource} sourceBusy={sourceBusy}/>}
  </div>;
}
