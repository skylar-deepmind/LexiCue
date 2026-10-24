import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Square, Volume2 } from 'lucide-react';
import type { ReadingMaterial } from '../lib/materials';
import type { Segment } from '../lib/types';
import type { ReaderToken } from '../stores/readerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useImportStore } from '../stores/importStore';
import { useSpeechStore } from '../stores/speechStore';
import ReadingLookup, { type ReadingQuery, type LookupDraft } from '../components/ReadingLookup';
import DisplaySettingsMenu from '../components/DisplaySettingsMenu';
interface Position {
    segment: number;
    offset: number;
}
export default function ReadingPage({ data }: {
    data: ReadingMaterial;
}) {
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const { material, segments } = data;
    const positionKey = `lexicue-reader-state:${material.content_hash}`;
    const [initial] = useState<Position>(() => {
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
    const [query, setQuery] = useState<ReadingQuery | null>(null);
    const drafts = useRef(new Map<string, LookupDraft>());
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
    const speech = useSpeechStore();
    const [translation, setTranslation] = useState(true);
    const tokens = useMemo(() => { const map = new Map<number, ReaderToken[]>(); for (const token of data.tokens) {
        const list = map.get(token.segment_index) ?? [];
        list.push(token);
        map.set(token.segment_index, list);
    } return map; }, [data.tokens]);
    useEffect(() => { if (importOpen)
        setQuery(null); }, [importOpen]);
    useEffect(() => { localStorage.setItem('lexicue-last-reading', JSON.stringify({ id: material.id, hash: material.content_hash })); return () => useSpeechStore.getState().stop(); }, [material.id, material.content_hash]);
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
            if (item && node.isConnected) {
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
    }, [first, last, positionKey, segments.length]);
    const choose = (segment: Segment, start: number, end: number) => {
        const text = segment.en_text.slice(start, end);
        if (!text.trim())
            return;
        useImportStore.getState().hide();
        setKeyboardRange(null);
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
        if (/[A-Za-z]/.test(segment.en_text.slice(start, end)))
            choose(segment, start, end);
    };
    const paragraph = (segment: Segment) => {
        const spans = tokens.get(segment.index_num) ?? [];
        const pieces: ReactNode[] = [];
        let offset = 0;
        spans.forEach((token, index) => {
            pieces.push(segment.en_text.slice(offset, token.start));
            const selected = query?.segment.id === segment.id && token.start >= query.start && token.end <= query.end || keyboardRange?.segment === segment.id && index >= keyboardRange.start && index <= keyboardRange.end;
            const punctuation = segment.en_text.slice(token.end, spans[index + 1]?.start ?? segment.en_text.length).match(/^[,.;:!?…’”"')\]]+/)?.[0] ?? '';
            pieces.push(<span key={`${token.start}-${token.end}`} className="reading-token"><button className="reading-word" aria-pressed={!!selected} onClick={event => { if (event.detail === 0 || !window.getSelection()?.toString().trim())
                choose(segment, token.start, token.end); }} onKeyDown={event => { if (!event.shiftKey || !['ArrowRight', 'ArrowLeft'].includes(event.key))
                return; event.preventDefault(); const range = keyRange.current?.segment === segment.id ? keyRange.current : { segment: segment.id, anchor: index, edge: index }; range.edge = Math.max(0, Math.min(spans.length - 1, range.edge + (event.key === 'ArrowRight' ? 1 : -1))); keyRange.current = range; setKeyboardRange({ segment: segment.id, start: Math.min(range.anchor, range.edge), end: Math.max(range.anchor, range.edge) }); }} onKeyUp={event => { if (event.key !== 'Shift' || !keyRange.current)
                return; const range = keyRange.current; keyRange.current = null; choose(segment, spans[Math.min(range.anchor, range.edge)].start, spans[Math.max(range.anchor, range.edge)].end); }}>{segment.en_text.slice(token.start, token.end)}</button>{punctuation}</span>);
            offset = token.end + punctuation.length;
        });
        pieces.push(segment.en_text.slice(offset));
        return pieces;
    };
    const previous = () => { const node = scroll.current; if (!node)
        return; const height = node.scrollHeight; setFirst(value => Math.max(0, value - 60)); requestAnimationFrame(() => { node.scrollTop += node.scrollHeight - height; }); };
    return <div className="reading-page"><div className="reader-scroll" ref={scroll}><div className="workspace-paper reading-paper" data-font={size} data-lines={lineHeight} data-aux-font={auxiliaryFont} data-definition-font={definitionFont}>
    <div className="reader-tools"><label><input type="checkbox" checked={translation} onChange={event => setTranslation(event.target.checked)}/>{t('reader.translation')}</label><DisplaySettingsMenu /></div>
    {first > 0 && <button className="ui-button" onClick={previous}>{t('reader.previousSentences')}</button>}
    {segments.slice(first, last).map(segment => <section className="reading-sentence" key={segment.id} data-sentence={segment.index_num}>
      <div className="sentence-side"><small>{segment.index_num + 1}</small><button className="ui-button ui-button--icon" aria-label={t(speech.key === `row:${segment.id}` ? 'reader.stop' : 'reader.listenSentence')} onClick={() => speech.key === `row:${segment.id}` ? speech.stop() : speech.speak(segment.en_text, `row:${segment.id}`)}>{speech.key === `row:${segment.id}` ? <Square size={16}/> : <Volume2 size={17}/>}</button></div>
      <div><p className="reading-original" lang="en" onMouseUp={event => selectText(segment, event.currentTarget)} onTouchEnd={event => selectText(segment, event.currentTarget)}>{paragraph(segment)}</p>{translation && segment.zh_text && <p className="reading-translation">{segment.zh_text}</p>}</div>
    </section>)}
    {last < segments.length && <button className="ui-button reader-next" data-reader-next="" onClick={() => setLast(value => Math.min(value + 60, segments.length))}>{t('reader.moreSentences')}</button>}
    {!query && speech.error && <p className="lookup-note" role="status">{t('reader.noVoice')}</p>}
  </div></div>
    {query && <ReadingLookup key={`${query.segment.id}:${query.start}:${query.end}`} query={query} material={material} onClose={() => setQuery(null)} drafts={drafts.current}/>}
  </div>;
}
