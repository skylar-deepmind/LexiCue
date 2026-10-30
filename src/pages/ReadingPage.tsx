import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SpeechFeedback } from '../components/SpeechButton';
import SourceAudioControls from '../components/SourceAudioControls';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { Play } from 'lucide-react';
import { useReadingToolsStore } from '../stores/readingToolsStore';
import type { ReadingMaterial } from '../lib/materials';
import type { Segment } from '../lib/types';
import type { ReaderToken } from '../stores/readerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useImportStore } from '../stores/importStore';
import { useSpeechStore } from '../stores/speechStore';
import ReadingLookup, { type ReadingQuery, type LookupDraft } from '../components/ReadingLookup';
import useReadingLayout from '../components/useReadingLayout';
import useReadingAnchor from '../components/useReadingAnchor';
import useRecallMatches from '../components/useRecallMatches';
import useContentFontScaleStyle from '../components/useContentFontScaleStyle';
import type { ReadingScope } from '../lib/readingScope';
import { useOnboardingStore } from '../stores/onboardingStore';
import { translateReadingBatch } from '../lib/readingTranslation';
import { documentLocationLabel } from '../lib/documentTypes';
import type { RecallMatch } from '../lib/recallMatcher';
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
    const example = scope.kind === 'example';
    const guide = useOnboardingStore();
    const skip = () => { guide.finish('skipped'); navigate('/files', {replace:true}); };
    const [params] = useSearchParams();
    const { material } = data;
    const [generatedTranslations, setGeneratedTranslations] = useState<Record<number, string>>({});
    const segments = useMemo(() => data.segments.map(segment => segment.zh_text?.trim() || !generatedTranslations[segment.id] ? segment : {...segment, zh_text: generatedTranslations[segment.id]}), [data.segments, generatedTranslations]);
    const mediaIdentity = material.source?.key ?? material.document?.identity ?? material.content_hash;
    const sourceBlocks = useMemo(() => {
        const map = new Map<number, NonNullable<typeof material.document>['blocks'][number]>();
        for (const block of material.document?.blocks ?? []) for (const index of block.segment_indices) map.set(index, block);
        return map;
    }, [material.document]);
    const positionKey = `lexicue-reader-state:${mediaIdentity}`;
    const [initial] = useState<Position>(() => {
        if (scope.kind === 'example') return { segment: segments[0]?.index_num ?? 0, offset: 0 };
        const requested = params.get('segment');
        if (requested !== null && segments.some(segment => segment.index_num === Number(requested)))
            return { segment: Number(requested), offset: 0 };
        try {
            const stored = JSON.parse(localStorage.getItem(positionKey) ?? 'null');
            if (stored && segments.some(segment => segment.index_num === stored.segment))
                return stored;
        }
        catch { /* Ignore invalid local scroll metadata. */ }
        const legacy = Number(localStorage.getItem(`lexicue-reading-position-${material.id}`));
        return { segment: segments[legacy]?.index_num ?? segments[0]?.index_num ?? 0, offset: 0 };
    });
    const initialIndex = Math.max(0, segments.findIndex(segment => segment.index_num === initial.segment));
    const [first, setFirst] = useState(Math.max(0, initialIndex - 20));
    const [last, setLast] = useState(Math.min(segments.length, Math.max(0, initialIndex - 20) + 80));
    const recall=useRecallMatches(segments,first,last,!example);
    const [query, setQuery] = useState<ReadingQuery | null>(null);
    const queryWithMedia = useMemo(() => query ? {...query,media:data.media_refs?.[query.segment.id]} : null, [query,data.media_refs]);
    const drafts = useRef(new Map<string, LookupDraft>());
    const lookupTrigger = useRef<{ node: HTMLElement; segment: number; index: number } | null>(null);
    const pointerSelection = useRef(false);
    const pointerRange = useRef<{ segment: number; anchor: number; edge: number } | null>(null);
    const importOpen = useImportStore(s => s.open);
    const scroll = useRef<HTMLDivElement>(null);
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
    const [translation, setTranslation] = useState(() => segments.some(segment => !!segment.zh_text));
    const [translationStatus, setTranslationStatus] = useState<'idle' | 'loading' | 'failed' | 'done'>('idle');
    const translationRequest = useRef<AbortController | null>(null);
    const requestTranslations = useCallback(async () => {
        if (example || material.source || translationRequest.current) return;
        const indices = [...visible.current.keys()].sort((a, b) => a - b);
        const batch = indices.length ? indices.map(index => segments.find(segment => segment.index_num === index)!).filter(Boolean) : segments.slice(first, first + 8);
        const missing = batch.filter(segment => !segment.zh_text?.trim());
        if (!missing.length) return;
        const controller = new AbortController();
        translationRequest.current = controller;
        setTranslationStatus('loading');
        try {
            const result = await translateReadingBatch(material.id, material.content_hash, missing, controller.signal);
            if (!controller.signal.aborted) {
                setGeneratedTranslations(value => ({...value, ...Object.fromEntries(result.translations.map(row => [row.id, row.zh_text]))}));
                setTranslationStatus(result.failed ? 'failed' : 'done');
            }
        } catch { if (!controller.signal.aborted) setTranslationStatus('failed'); }
        finally { if (translationRequest.current === controller) translationRequest.current = null; }
    }, [example, material.id, material.content_hash, material.source, segments, first]);
    useEffect(() => () => {translationRequest.current?.abort(); translationRequest.current = null;}, [material.id, material.content_hash]);
    const toggleTranslation = () => {
        if (translation) { translationRequest.current?.abort(); translationRequest.current = null; setTranslationStatus('idle'); }
        else void requestTranslations();
        setTranslation(value => !value);
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
    const fontScaleStyle = useContentFontScaleStyle();
    const readingLayout = useReadingLayout(scroll);
    useReadingAnchor(scroll);
    const mediaEntries = useSourceMediaStore(state => state.entries);
    const speechItems = useMemo(() => segments.map(segment => ({text:segment.en_text,key:`reader:${mediaIdentity}:${segment.index_num}`})), [segments,mediaIdentity]);
    const pendingListen = useRef<number | null>(null);
    const followAllowed = useRef(true);
    const startListening = useCallback((index: number) => {
        followAllowed.current=true;
        const segment=segments[index], ref=segment && data.media_refs?.[segment.id];
        const state=useSpeechStore.getState();
        if (state.playbackMode==='source-continuous' && state.continuousFileId===material.id && state.continuousSourceKey===mediaIdentity) {
            if (ref) state.jumpSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,index});
            return; // A missing mapping never inserts TTS into an original-audio session.
        }
        if (ref && mediaEntries[ref.source.key]?.status==='ready')
            void state.startSourceContinuous({fileId:material.id,segmentId:segment.id,sourceKey:ref.source.key,key:`reader:${mediaIdentity}:continuous`,index});
        else void state.startQueue(speechItems.map(({text,key})=>({text,key})),index);
    },[segments,data.media_refs,material.id,mediaEntries,speechItems,mediaIdentity]);
    const listenFrom = (index: number) => {
        const state=useSpeechStore.getState();
        if ((state.playbackMode==='source-continuous' && state.continuousFileId===material.id && state.queueIndex===index)
            || state.key === speechItems[index]?.key) {state.stop(); return;}
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
    useLayoutEffect(() => {
        useReadingToolsStore.setState({ available: true, listening, translation, hasTranslation: segments.some(segment => !!segment.zh_text) || !example && !material.source, showRecall: !example,
            onListen: () => { if (listening) { pendingListen.current = null; useSpeechStore.getState().stop(); setListening(false); } else listenFrom(0); },
            onTranslation: toggleTranslation,
        });
    });
    useLayoutEffect(() => () => { pendingListen.current = null; useReadingToolsStore.setState({ available: false }); }, []);
    useEffect(() => {
        const node=scroll.current; if (!node) return;
        const manual=()=>{followAllowed.current=false;};
        const keys=(event:KeyboardEvent)=>{if (['PageUp','PageDown','ArrowUp','ArrowDown','Home','End'].includes(event.key)) manual();};
        const pointer=(event:PointerEvent)=>{if(event.target===node)manual();};
        node.addEventListener('wheel',manual,{passive:true});node.addEventListener('touchmove',manual,{passive:true});node.addEventListener('focusin',manual);
        node.addEventListener('pointerdown',pointer);node.addEventListener('keydown',keys);
        return()=>{node.removeEventListener('wheel',manual);node.removeEventListener('touchmove',manual);node.removeEventListener('focusin',manual);node.removeEventListener('pointerdown',pointer);node.removeEventListener('keydown',keys);};
    },[]);
    useLayoutEffect(() => {
        const index=speech.queueIndex;
        if (query || !listening || speech.playbackMode!=='source-continuous' || !speech.queueActive || index===null || !followAllowed.current || !segments[index]) return;
        if (index<first || index>=last) {setFirst(Math.max(0,index-20));setLast(Math.min(segments.length,index+60));return;}
        const node=scroll.current, target=node?.querySelector<HTMLElement>(`[data-sentence="${segments[index].index_num}"]`);
        if (!node || !target) return;
        const outer=node.getBoundingClientRect(), rect=target.getBoundingClientRect();
        if (rect.top<outer.top || rect.bottom>outer.bottom) node.scrollTop+=rect.top-outer.top-outer.height*.3;
        // Scrolling never moves keyboard focus; deliberate scroll input suspends following until a new start/jump.
    },[speech.queueIndex,speech.queueActive,speech.playbackMode,listening,query,first,last,segments]);
    const tokens = useMemo(() => { const map = new Map<number, ReaderToken[]>(); for (const token of data.tokens) {
        const list = map.get(token.segment_index) ?? [];
        list.push(token);
        map.set(token.segment_index, list);
    } return map; }, [data.tokens]);
    useEffect(() => { if (importOpen)
        setQuery(null); }, [importOpen]);
    useEffect(() => { if (!example) localStorage.setItem('lexicue-last-reading', JSON.stringify({ id: material.id, hash: material.content_hash })); return () => {const current=useSpeechStore.getState();if(current.key?.startsWith(`reader:${mediaIdentity}:`)||current.errorKey?.startsWith(`reader:${mediaIdentity}:`))current.stop();}; }, [material.id, material.content_hash, mediaIdentity, example]);
    useLayoutEffect(() => {
        const node = scroll.current;
        if (!node || restored.current)
            return;
        const target = node.querySelector<HTMLElement>(`[data-sentence="${initial.segment}"]`);
        if (target) {
            node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top + initial.offset;
            restored.current = true;
        }
    }, [initial]);
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
                localStorage.setItem(positionKey, JSON.stringify({segment:item[0],offset}));
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
    }, [first, last, positionKey, segments.length, example]);
    const choose = (segment: Segment, start: number, end: number) => {
        followAllowed.current=false;
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
        if (event.pointerType === 'touch' || event.button !== 0) return;
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
                return; event.preventDefault(); const range = keyRange.current?.segment === segment.id ? keyRange.current : { segment: segment.id, anchor: index, edge: index }; range.edge = Math.max(0, Math.min(spans.length - 1, range.edge + (event.key === 'ArrowRight' ? 1 : -1))); keyRange.current = range; setKeyboardRange({ segment: segment.id, start: Math.min(range.anchor, range.edge), end: Math.max(range.anchor, range.edge) }); }} onKeyUp={event => { if (event.key !== 'Shift' || !keyRange.current)
                return; const range = keyRange.current; keyRange.current = null; choose(segment, spans[Math.min(range.anchor, range.edge)].start, spans[Math.max(range.anchor, range.edge)].end); }}>{word}</button>{tail}</span>, marked);
            offset = token.end + punctuation.length;
        });
        appendGap(offset, segment.en_text.length);
        flushGroup();
        return pieces;
    };
    const closeLookup = () => {
        if (example) useOnboardingStore.getState().closed();
        // Saving/removing a match can regroup its tokens and replace the DOM
        // trigger retained by ContextPanel. Restore that same logical token.
        const trigger = lookupTrigger.current;
        if (trigger && !trigger.node.isConnected) scroll.current?.querySelector<HTMLElement>(`[data-sentence="${trigger.segment}"] .reading-word[data-word-index="${trigger.index}"]`)?.focus({ preventScroll: true });
        lookupTrigger.current = null;
        keyRange.current = null; pointerRange.current = null; setKeyboardRange(null); setQuery(null);
    };
    const previous = () => { const node = scroll.current; if (!node)
        return; const height = node.scrollHeight; setFirst(value => Math.max(0, value - 60)); requestAnimationFrame(() => { node.scrollTop += node.scrollHeight - height; }); };
    return <div className="reading-page" style={fontScaleStyle} data-listening={listening}><div className="reader-scroll" ref={scroll}><div className="reading-layout" ref={readingLayout.layout} data-query-open={!!query}><div className="workspace-paper reading-paper" data-recall-state={recall.status} data-font={size} data-lines={lineHeight} data-aux-font={auxiliaryFont} data-definition-font={definitionFont}>
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
        <button className="ui-button" onClick={() => jumpDocument(segments.length - 1)}>{t('documents.last')}</button>
        {material.document.origin && <details className="reading-document-code"><summary>{t('documents.fullPreview')}</summary>{material.document.blocks.map(block => <p key={block.id} style={{whiteSpace:'pre-wrap'}}>{block.text}</p>)}</details>}
        {material.document.blocks.some(block => block.kind === 'code') && <details className="reading-document-code"><summary>{t('documents.codeBlocks')}</summary>{material.document.blocks.filter(block => block.kind === 'code').map(block => <pre key={block.id}>{block.text}</pre>)}</details>}
    </div>}
    {translation && !example && !material.source && <div className="reading-translation-status" role="status">
        <span>{t(translationStatus === 'loading' ? 'documents.translating' : translationStatus === 'failed' ? 'documents.translationFailed' : 'documents.translationOnDemand')}</span>
        <button className="ui-button" disabled={translationStatus === 'loading'} onClick={() => void requestTranslations()}>{t(translationStatus === 'failed' ? 'common.retry' : 'documents.translateVisible')}</button>
    </div>}
    {first > 0 && <button className="ui-button" onClick={previous}>{t('reader.previousSentences')}</button>}
    {segments.slice(first, last).map((segment, offset) => {
      const sourceBlock = sourceBlocks.get(segment.index_num);
      const key = speechItems[first + offset].key;
      const continuous = speech.playbackMode==='source-continuous' && speech.continuousFileId===material.id && speech.continuousSourceKey===mediaIdentity;
      const noTiming=(continuous || !!material.source?.audio && mediaEntries[mediaIdentity]?.status==='ready') && !data.media_refs?.[segment.id];
      const active = (continuous ? speech.queueIndex===first+offset : speech.key===key) && (speech.status === 'loading' || speech.status === 'playing');
      const failed = speech.errorKey === key && speech.error;
      return <section className="reading-sentence" key={segment.id} data-sentence={segment.index_num} data-current={active} data-speech-state={active ? speech.status : failed ? 'error' : 'idle'}>
      <div className="sentence-side">{listening ? <button type="button" className="sentence-listen" disabled={noTiming} title={noTiming ? t('sourceAudio.noTiming') : undefined} aria-busy={active && speech.loading} aria-label={t(noTiming ? 'sourceAudio.noTiming' : failed ? 'speech.retry' : 'reader.listenFromSentence', { index: segment.index_num + 1 })} aria-current={active ? 'step' : undefined} onClick={event => { event.stopPropagation(); listenFrom(first + offset); }}>
        <small className="sentence-number" aria-hidden="true">{segment.index_num + 1}</small><Play className="sentence-play" size={16} aria-hidden="true"/>
      </button> : <span className="sentence-number-static"><small>{segment.index_num + 1}</small></span>}</div>
      <div>{sourceBlock && <small className="reading-document-location">{[material.document?.sections.find(section => section.id === sourceBlock.section_id)?.title, documentLocationLabel(sourceBlock.locations[0])].filter(Boolean).join(' · ')}</small>}<p className="reading-original" lang="en" onPointerDown={event => beginPointerRange(segment, event)} onPointerMove={event => extendPointerRange(segment, event)} onPointerUp={() => finishPointerRange(segment)} onPointerCancel={cancelPointerRange} onPointerLeave={cancelPointerRange} onMouseDown={event => { if (event.button === 0) { event.preventDefault(); window.getSelection()?.removeAllRanges(); } }} onMouseUp={event => selectText(segment, event.currentTarget)} onTouchEnd={event => selectText(segment, event.currentTarget)}>{paragraph(segment)}</p>{translation && segment.zh_text && <p className="reading-translation">{segment.zh_text}</p>}{listening && (active && speech.loading || failed) && <span className="sr-only" role="status">{t(active ? 'common.loading' : 'speech.retry')}</span>}{failed && <SpeechFeedback speechKeys={[key]}/>}</div>
    </section>; })}
    {last < segments.length && <button className="ui-button reader-next" data-reader-next="" onClick={() => setLast(value => Math.min(value + 60, segments.length))}>{t('reader.moreSentences')}</button>}
    {!query && <SpeechFeedback prefix="reader:"/>}
  </div><div className="reading-query-slot" ref={readingLayout.slot} aria-hidden="true"/></div></div>
    {queryWithMedia && <ReadingLookup layoutSlot={readingLayout.slot} query={queryWithMedia} material={material} scope={scope} onClose={closeLookup} onSkip={skip} drafts={drafts.current}/>}
  </div>;
}
