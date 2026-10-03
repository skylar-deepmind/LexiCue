import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, BookOpen, RefreshCw, X } from 'lucide-react';
import { useOllamaStore } from '../stores/ollamaStore';
import { useAiStore } from '../stores/aiStore';
import { getAiConfig } from '../lib/ai';
import { previewPhraseKey, previewPieces, type PreviewPhrase, type AnalysisPreview } from '../lib/analysisPreview';
import type { Segment } from '../lib/types';
import { invalidateCaches } from '../lib/cacheInvalidation';
import { useFileStore } from '../stores/fileStore';

const EMPTY_PHRASES: PreviewPhrase[] = [];

const PreviewRow = memo(function PreviewRow({ segment, phrases, selectedKey, onSelect, onHeight, analyzing }: {
  segment: Segment; phrases: PreviewPhrase[]; selectedKey: string | null; analyzing: boolean;
  onSelect: (key: string) => void; onHeight: (id: number, height: number) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => onHeight(segment.index_num, node.getBoundingClientRect().height));
    observer.observe(node);
    return () => observer.disconnect();
  }, [segment.index_num, onHeight]);
  const pieces = useMemo(() => previewPieces(segment.en_text, phrases, selectedKey), [segment.en_text, phrases, selectedKey]);
  return <div ref={ref} className="analysis-preview__row" data-segment={segment.index_num}>
    <div className="analysis-preview__row-meta"><span>{segment.start_time ?? `#${segment.index_num + 1}`}</span><span>{t(analyzing ? 'analysisPreview.analyzing' : 'analysisPreview.processed')}</span></div>
    <p className="analysis-preview__sentence">{pieces.map(piece => piece.highlighted
      ? <mark key={piece.start} className={piece.selected ? 'analysis-preview__mark is-selected' : 'analysis-preview__mark'}>{piece.text}</mark>
      : <span key={piece.start}>{piece.text}</span>)}</p>
    {segment.zh_text && <p className="analysis-preview__translation">{segment.zh_text}</p>}
    <div className="analysis-preview__phrases">{phrases.map(phrase => {
      const key = previewPhraseKey(phrase);
      return <button key={key} type="button" className="analysis-preview__chip" aria-pressed={selectedKey === key} onClick={() => onSelect(key)}>
        <strong>{phrase.canonical}</strong><span>{t(`analysisPreview.categories.${phrase.category}`)}</span>
      </button>;
    })}</div>
  </div>;
});

function SubtitlePreview({ segments, bySegment, processed, targetIndex, selectedKey, onSelect, follow, onPause }: {
  segments: Segment[]; bySegment: Record<number, PreviewPhrase[]>; processed: Set<number>; targetIndex?: number;
  selectedKey: string | null; onSelect: (key: string) => void; follow: boolean; onPause: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const pendingHeights = useRef<Record<number, number>>({});
  const frame = useRef<number | null>(null);
  const onHeight = useCallback((id: number, height: number) => {
    pendingHeights.current[id] = height;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const updates = pendingHeights.current;
      pendingHeights.current = {};
      setHeights(previous => Object.entries(updates).some(([id, height]) => Math.abs((previous[Number(id)] ?? 0) - height) > 0.5) ? { ...previous, ...updates } : previous);
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(([entry]) => setViewport(entry.contentRect.height));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);
  const offsets = useMemo(() => {
    const values = [0];
    for (const segment of segments) values.push(values.at(-1)! + (heights[segment.index_num] ?? 170));
    return values;
  }, [segments, heights]);
  const total = offsets.at(-1) ?? 0;
  const findIndex = (position: number) => {
    let lo = 0, hi = segments.length;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (offsets[middle + 1] < position) lo = middle + 1; else hi = middle; }
    return lo;
  };
  const start = Math.max(0, findIndex(Math.max(0, scrollTop - 350)));
  const end = Math.min(segments.length, findIndex(scrollTop + viewport + 350) + 1);
  const offsetsRef = useRef(offsets);
  const segmentsRef = useRef(segments);
  useLayoutEffect(() => { offsetsRef.current = offsets; segmentsRef.current = segments; }, [offsets, segments]);
  useEffect(() => {
    if (!selectedKey || !scrollRef.current) return;
    const index = segmentsRef.current.findIndex(segment => segment.index_num === Number(selectedKey.split('|')[0]));
    if (index >= 0) scrollRef.current.scrollTop = offsetsRef.current[index];
  }, [selectedKey]);
  useLayoutEffect(() => {
    if (!follow || !scrollRef.current || targetIndex === undefined) return;
    const index = segments.findIndex(segment => segment.index_num === targetIndex);
    if (index >= 0) scrollRef.current.scrollTop = offsets[index];
  }, [follow, segments, offsets, targetIndex]);
  return <div ref={scrollRef} className="analysis-preview__subtitles" tabIndex={0}
    onFocus={onPause}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onWheel={onPause} onTouchMove={onPause} onPointerDown={onPause}
    onKeyDown={event => { if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) onPause(); }}>
    <div style={{ height: offsets[start] }} aria-hidden="true" />
    {segments.slice(start,end).map(segment => <PreviewRow key={segment.id} segment={segment}
      phrases={bySegment[segment.index_num] ?? EMPTY_PHRASES} selectedKey={selectedKey?.startsWith(`${segment.index_num}|`) ? selectedKey : null}
      onSelect={onSelect} onHeight={onHeight} analyzing={!processed.has(segment.index_num)} />)}
    <div style={{ height: total - offsets[end] }} aria-hidden="true" />
  </div>;
}

export default function AnalysisPreviewDrawer() {
  const fileId = useOllamaStore(state => state.previewFileId);
  const preview = useOllamaStore(state => fileId === null ? undefined : state.previews[fileId]);
  return preview ? <PreviewContent key={preview.runId} preview={preview} /> : null;
}

function PreviewContent({ preview }: { preview: AnalysisPreview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileId = preview.fileId;
  const progress = useOllamaStore(state => fileId === null ? undefined : state.progress[fileId]);
  const retrying = useOllamaStore(state => fileId === null ? undefined : state.retrying[fileId]);
  const close = useOllamaStore(state => state.closePreview);
  const cancel = useOllamaStore(state => state.cancelAnalysis);
  const loadSnapshot = useOllamaStore(state => state.loadPreviewSnapshot);
  const loadSegments = useOllamaStore(state => state.loadPreviewSegments);
  const startAnalysis = useOllamaStore(state => state.startAnalysis);
  const aiEnabled = useAiStore(state => state.enabled);
  const [follow, setFollow] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1359px)').matches);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = matchMedia('(max-width: 1359px)');
    const changed = () => setNarrow(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !narrow) return;
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (!panelRef.current?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [narrow, close]);
  const { segments: sourceSegments, processed } = preview;
  const batches = useMemo(() => Object.values(preview.pending), [preview.pending]);
  const currentBatch = useMemo(() => [...batches].sort((a,b) => b.sequence-a.sequence)[0], [batches]);
  const segments = useMemo(() => {
    const visible = new Set([...processed, ...batches.flatMap(batch => batch.segmentIndices)]);
    return sourceSegments.filter(segment => visible.has(segment.index_num));
  }, [sourceSegments, processed, batches]);
  const [now, setNow] = useState(Date.now);
  const activeAttempt = currentBatch?.attemptId;
  useEffect(() => {
    if (!activeAttempt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeAttempt]);
  const effectiveSelectedKey = selectedKey && preview.phrases[selectedKey] ? selectedKey : null;
  const select = useCallback((key: string) => { setFollow(false); setSelectedKey(key); }, []);
  const pause = useCallback(() => setFollow(false), []);
  const phrases = useMemo(() => Object.values(preview.phrases), [preview.phrases]);
  const grouped = useMemo(() => {
    const map = new Map<string, PreviewPhrase>();
    for (const phrase of phrases) if (!map.has(phrase.canonical)) map.set(phrase.canonical, phrase);
    return [...map.values()];
  }, [phrases]);
  const active = preview.status === 'processing';
  const interrupted = preview.error?.includes('STREAM_INTERRUPTED');
  const statusKey = (() => {
    if (!active) return preview.status === 'error' && interrupted ? 'interrupted' : preview.status;
    if (progress?.phase === 'saving') return 'saving';
    if (currentBatch) return currentBatch.receivedAt ? 'receiving' : 'waitingFirst';
    return preview.processed.size ? 'processing' : 'waitingFirst';
  })();
  useEffect(() => {
    if (narrow && !panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
  }, [narrow, active]);
  const retry = async () => {
    setActionError('');
    try {
      const config = getAiConfig();
      if (!aiEnabled || !config.model) { navigate('/settings'); close(); return; }
      await startAnalysis(fileId, config, false, { fileName: preview.fileName, language: 'en' });
      invalidateCaches('phrases', 'insights', 'storage');
      useFileStore.getState().invalidateFiles();
      await useFileStore.getState().loadFiles(true);
    } catch (error) { setActionError(String(error)); }
  };
  const cancelRun = async () => {
    setCancelling(true); setActionError('');
    try { await cancel(fileId); } catch (error) { setActionError(String(error)); setCancelling(false); }
  };
  return <>
    {narrow && <button type="button" className="analysis-preview__backdrop" aria-label={t('common.close')} onClick={close} />}
    <aside ref={panelRef} className="analysis-preview" role={narrow ? 'dialog' : 'complementary'} aria-modal={narrow || undefined} aria-labelledby="analysis-preview-title">
      <header className="analysis-preview__header">
        <div><h2 id="analysis-preview-title">{t('analysisPreview.title')}</h2><p className="analysis-preview__filename">{preview.fileName}</p></div>
        <button ref={closeRef} type="button" className="analysis-preview__button" aria-label={t('common.close')} onClick={close}><X size={18} /></button>
      </header>
      <div className="analysis-preview__summary">
        <p role="status" aria-live="polite">{t(`analysisPreview.status.${statusKey}`)}</p>
        <div className="analysis-preview__counts">
          <span>{t('analysisPreview.segments', { processed: preview.processed.size, total: preview.segments.length || progress?.totalSegments || 0 })}</span>
          <span>{t('analysisPreview.counts', { phrases: preview.unique.size, occurrences: preview.occurrenceCount })}</span>
        </div>
        <div className="analysis-preview__progress" role="progressbar" aria-label={t('analysisPreview.title')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={preview.status === 'saved' ? 100 : progress?.percent ?? 0}>
          <div style={{ width: `${preview.status === 'saved' ? 100 : progress?.percent ?? 0}%` }} />
        </div>
        {currentBatch && <p className="analysis-preview__notice">{t('analysisPreview.currentBatch', { batch: currentBatch.batchId, start: Math.min(...currentBatch.segmentIndices) + 1, end: Math.max(...currentBatch.segmentIndices) + 1, seconds: Math.max(0, Math.floor((now-currentBatch.startedAt)/1000)) })}</p>}
        <div className="analysis-preview__toolbar">
          <button type="button" className="analysis-preview__button" aria-pressed={follow} onClick={() => { setSelectedKey(null); setFollow(value => !value); }}><ArrowDown size={15} />{t('analysisPreview.follow')}</button>
          {active && <button type="button" className="analysis-preview__button" disabled={cancelling} onClick={() => void cancelRun()}>{t(cancelling ? 'analysisPreview.cancelling' : 'fileCard.cancel')}</button>}
          {!active && preview.status !== 'saved' && <button type="button" className="analysis-preview__button" onClick={() => void retry()}><RefreshCw size={15} />{t('analysisPreview.continue')}</button>}
          {preview.status === 'saved' && <button type="button" className="analysis-preview__button" onClick={() => { navigate(`/files/${fileId}`); close(); }}><BookOpen size={15} />{t('analysisPreview.viewSaved')}</button>}
        </div>
        {retrying && <p className="analysis-preview__notice">{t('fileCard.retrying', { reason: retrying.reason, attempt: retrying.attempt, maxAttempts: retrying.maxAttempts })}</p>}
        {preview.snapshotError && <p className="analysis-preview__notice" role="alert">{t('analysisPreview.snapshotFailed')} <button type="button" className="analysis-preview__button" onClick={() => void loadSnapshot(fileId, preview.runId)}>{t('analysisPreview.reload')}</button></p>}
        {actionError && <p className="analysis-preview__error" role="alert">{actionError}</p>}
        {preview.status === 'error' && preview.error && !interrupted && <p className="analysis-preview__error" role="alert">{preview.error}</p>}
      </div>
      {grouped.length > 0 && <nav className="analysis-preview__index" aria-label={t('analysisPreview.phraseList')}>{grouped.map(phrase => <button type="button" key={phrase.canonical}
        className="analysis-preview__chip" aria-pressed={effectiveSelectedKey ? preview.phrases[effectiveSelectedKey]?.canonical === phrase.canonical : false} onClick={() => select(previewPhraseKey(phrase))}>{phrase.canonical}</button>)}</nav>}
      {preview.loading && <p className="analysis-preview__empty">{t('analysisPreview.loading')}</p>}
      {preview.loadError ? <div className="analysis-preview__empty"><p role="alert">{t('analysisPreview.loadFailed')}</p><button type="button" className="analysis-preview__button" onClick={() => void loadSegments(fileId, preview.runId)}>{t('analysisPreview.reload')}</button></div>
        : segments.length ? <SubtitlePreview key={preview.runId} segments={segments} bySegment={preview.bySegment} processed={processed} targetIndex={preview.latestSegmentIndex} selectedKey={effectiveSelectedKey} onSelect={select} follow={follow} onPause={pause} />
        : !preview.loading && <p className="analysis-preview__empty">{t(active ? 'analysisPreview.waiting' : 'analysisPreview.empty')}</p>}
      <footer className="analysis-preview__footer">{t(active ? currentBatch ? 'analysisPreview.temporary' : 'analysisPreview.notSaved' : preview.status === 'saved' ? 'analysisPreview.savedHint' : 'analysisPreview.incomplete')}</footer>
    </aside>
  </>;
}
