import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { savedDayString, savedInputDay, savedTimeline, type SavedDateBin } from '../lib/savedTimeline';

type Props = {
  bins: SavedDateBin[]; start: string; end: string;
  status: 'loading' | 'ready' | 'error';
  onRangeChange: (start: string, end: string) => void; onRetry: () => void;
};
type Range = { from: number; to: number };
type Drag = Range & {
  pointer: number; x: number; y: number; day: number; scroll: number;
  mode: 'start' | 'end' | 'new' | 'pan'; moved: boolean;
};
const dayMs = 86400000;
const baseline = 35;

export default function SavedTimeline({ bins, start, end, status, onRangeChange, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null), plot = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null), pendingRange = useRef<Range | null>(null);
  const [availableWidth, setWidth] = useState(320), [scrollLeft, setScrollLeft] = useState(0);
  const [draft, setDraft] = useState<Range | null>(null);
  const model = useMemo(() => savedTimeline(bins, availableWidth), [bins, availableWidth]);
  const statusOnly = status === 'error' || status === 'loading' && !model.total;
  const showPlot = !statusOnly && model.activeDays > 1;
  const overflow = model.width > availableWidth;
  const viewportWidth = Math.min(availableWidth, model.width);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const resize = () => { if (node.clientWidth > 0) setWidth(node.clientWidth); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showPlot]);

  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport || !overflow) return;
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    setScrollLeft(viewport.scrollLeft);
  }, [showPlot, overflow]);

  const first = model.firstDay ?? 0, last = model.lastDay ?? first;
  const from = Math.max(first, Math.min(last, draft?.from ?? savedInputDay(start) ?? first));
  const to = Math.max(from, Math.min(last, draft?.to ?? savedInputDay(end) ?? last));
  const selected = !!start || !!end || !!draft;
  const labelStart = selected || !overflow ? from : Math.round(model.dayAt(scrollLeft));
  const labelEnd = selected || !overflow ? to : Math.round(model.dayAt(scrollLeft + viewportWidth));
  const fullDate = useMemo(() => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }), [i18n.language]);
  const firstYear = new Date(labelStart * dayMs).getUTCFullYear();
  const showYear = firstYear !== new Date().getFullYear() || firstYear !== new Date(labelEnd * dayMs).getUTCFullYear();
  const showDay = labelEnd - labelStart < 62;
  const axisDate = useMemo(() => new Intl.DateTimeFormat(i18n.language, {
    year: showYear ? 'numeric' : undefined, month: 'short',
    day: showDay ? 'numeric' : undefined, timeZone: 'UTC',
  }), [i18n.language, showYear, showDay]);
  const dateStart = axisDate.format(labelStart * dayMs), dateEnd = axisDate.format(labelEnd * dayMs);
  const centerLabels = selected || dateStart === dateEnd || viewportWidth < 155;
  const dayAtClientX = (x: number) => Math.round(model.dayAt(x - (plot.current?.getBoundingClientRect().left ?? 0)));
  const commit = (range: Range) => {
    const low = Math.max(first, Math.min(last, range.from)), high = Math.max(low, Math.min(last, range.to));
    const all = low === first && high === last;
    onRangeChange(all ? '' : savedDayString(low), all ? '' : savedDayString(high));
  };
  const stopDrag = () => {
    drag.current = null;
    pendingRange.current = null;
    setDraft(null);
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target as Element;
    const edge = target.closest<HTMLElement>('[data-range-handle]')?.dataset.rangeHandle as 'start' | 'end' | undefined;
    const dateTrack = event.clientY - (plot.current?.getBoundingClientRect().top ?? 0) > baseline + 2;
    const mode = edge ?? (overflow && dateTrack && !event.shiftKey ? 'pan' : 'new');
    drag.current = {
      pointer: event.pointerId, x: event.clientX, y: event.clientY, day: dayAtClientX(event.clientX), from, to,
      scroll: scroll.current?.scrollLeft ?? 0, mode, moved: false,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) { stopDrag(); return; }
      if (Math.abs(dx) < 4) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    const viewport = scroll.current;
    if (current.mode === 'pan') {
      if (viewport) viewport.scrollLeft = current.scroll - dx;
      return;
    }
    const day = dayAtClientX(event.clientX);
    const next = current.mode === 'start' ? { from: Math.min(day, current.to), to: current.to }
      : current.mode === 'end' ? { from: current.from, to: Math.max(day, current.from) }
        : { from: Math.min(day, current.day), to: Math.max(day, current.day) };
    pendingRange.current = next;
    setDraft(next);
  };
  const handle = (side: 'start' | 'end') => {
    const day = side === 'start' ? from : to;
    return <button type="button" role="slider" className="saved-timeline-handle" data-range-handle={side}
      style={{ left: model.xFor(day) }} aria-label={t(side === 'start' ? 'approved.startDate' : 'approved.endDate')}
      aria-valuemin={first} aria-valuemax={last} aria-valuenow={day} aria-valuetext={fullDate.format(day * dayMs)}
      onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const value = event.key === 'Home' ? first : event.key === 'End' ? last : day + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1);
        const next = side === 'start' ? { from: Math.min(to,value), to } : { from, to: Math.max(from,value) };
        commit(next);
        const viewport = scroll.current;
        if (!viewport || !overflow) return;
        const x = model.xFor(Math.max(first, Math.min(last, side === 'start' ? next.from : next.to)));
        if (x < viewport.scrollLeft + 22 || x > viewport.scrollLeft + viewport.clientWidth - 22) viewport.scrollLeft = x - viewport.clientWidth / 2;
      }}><span aria-hidden="true"/></button>;
  };

  if (statusOnly) return <div className="approved-timeline saved-timeline-status" data-state={status} role={status === 'error' ? 'alert' : 'status'}>
    <span>{t(status === 'error' ? 'approved.loadFailed' : 'common.loading')}</span>
    {status === 'error' && <button className="ui-button" onClick={onRetry}>{t('common.retry')}</button>}
  </div>;
  return <div ref={root} className="approved-timeline saved-growing-timeline" data-phase={model.phase} data-active-days={model.activeDays}
    data-records={model.total} data-range-active={selected || undefined} aria-busy={status === 'loading' || undefined}>
    {model.activeDays === 1 && <time className="saved-timeline-date" dateTime={savedDayString(first)}>{fullDate.format(first * dayMs)}</time>}
    {showPlot && <div className="saved-timeline-graph" data-overflow={overflow || undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={event => {
        if (drag.current?.pointer !== event.pointerId) return;
        if (pendingRange.current) commit(pendingRange.current);
        stopDrag();
      }} onPointerLeave={() => { if (!drag.current?.moved) stopDrag(); }} onPointerCancel={stopDrag} onLostPointerCapture={event => {
        if (event.target === event.currentTarget && drag.current?.pointer === event.pointerId) stopDrag();
      }}
      onKeyDown={event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); stopDrag(); } }}>
      <div ref={scroll} className="saved-timeline-scroll" style={{ maxWidth: model.width }} onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}>
        <div ref={plot} className="saved-timeline-plot" style={{ width: model.width }}>
          <svg width="100%" height="48" viewBox={`0 0 ${model.width} 48`} role="img" aria-label={t('savedRecords.timeline')}>
            <line className="saved-timeline-axis" x1={model.axisStart} x2={model.axisEnd} y1={baseline} y2={baseline}/>
            {selected && <rect className="saved-timeline-selection" x={model.xFor(from) - 5} y="7" width={model.xFor(to) - model.xFor(from) + 10} height="30" rx="4"/>}
            {model.marks.filter(mark => !overflow || mark.x >= scrollLeft - 150 && mark.x <= scrollLeft + viewportWidth + 150).map(mark => {
              const barWidth = mark.width * .72, barHeight = mark.height * .64;
              return <rect key={mark.key} className="saved-timeline-mark" width={barWidth} height={barHeight} rx={Math.min(barWidth / 2, 2)}
                style={{ transform: `translate(${mark.x - barWidth / 2}px,${baseline - barHeight}px)`, opacity: mark.firstDay >= from && mark.lastDay <= to ? 1 : .22 }}
                data-count={mark.count} data-day={mark.firstDay} data-last-day={mark.lastDay}><title>{fullDate.format(mark.firstDay * dayMs)}</title></rect>;
            })}
          </svg>
          {handle('start')}{handle('end')}
        </div>
      </div>
      <div className="saved-timeline-period" data-centered={centerLabels || undefined} style={{ maxWidth: Math.max(180, model.width) }}>
        {centerLabels ? <span>{dateStart}{dateStart !== dateEnd && ` – ${dateEnd}`}</span> : <><span>{dateStart}</span><span>{dateEnd}</span></>}
      </div>
    </div>}
    {(start || end) && <button type="button" className="saved-timeline-reset approved-icon" aria-label={t('approved.allDates')} onClick={() => onRangeChange('', '')}><RotateCcw size={16} aria-hidden="true"/></button>}
  </div>;
}
