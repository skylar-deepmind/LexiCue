import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { savedDayString, savedInputDay, savedTimeline, type SavedDateBin } from '../lib/savedTimeline';

type Props = {
  bins: SavedDateBin[]; recordCount: number; start: string; end: string;
  status: 'loading' | 'ready' | 'error';
  onRangeChange: (start: string, end: string) => void; onRetry: () => void;
};
export default function SavedTimeline({ bins, recordCount, start, end, status, onRangeChange, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const root = useRef<HTMLDivElement>(null), activator = useRef<HTMLButtonElement>(null), firstInput = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(320), [filterOpen, setFilterOpen] = useState(false);
  const id = useId();
  useLayoutEffect(() => {
    const node = root.current; if (!node) return;
    const resize = () => setWidth(Math.max(1, node.clientWidth));
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (filterOpen) firstInput.current?.focus(); }, [filterOpen]);
  const model = useMemo(() => savedTimeline(bins, width, savedInputDay(start), savedInputDay(end)), [bins, width, start, end]);
  const fullDate = useMemo(() => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }), [i18n.language]);
  const showYear = model.firstDay !== undefined && (new Date(model.firstDay * 86400000).getUTCFullYear() !== new Date().getFullYear() || new Date(model.firstDay * 86400000).getUTCFullYear() !== new Date(model.lastDay! * 86400000).getUTCFullYear());
  const axisDate = useMemo(() => new Intl.DateTimeFormat(i18n.language, { ...(showYear ? { year: 'numeric' as const } : {}), month: 'short', day: 'numeric', timeZone: 'UTC' }), [i18n.language, showYear]);
  const close = () => { setFilterOpen(false); activator.current?.focus(); };
  const dateButton = (day: number, side: 'first' | 'last' | 'only') => <button type="button" className={`saved-timeline-date saved-timeline-date--${side}`} style={{ left: side === 'only' ? width / 2 : side === 'first' ? 22 : width - 22 }} aria-expanded={filterOpen} aria-controls={id} aria-label={`${t('approved.filterDates')} · ${fullDate.format(day * 86400000)}`} onClick={event => { activator.current = event.currentTarget; setFilterOpen(value => !value); }}>{axisDate.format(day * 86400000)}</button>;
  if (status === 'error' || (status === 'loading' && !model.total)) return <div ref={root} className="approved-timeline saved-timeline-status" data-state={status} role={status === 'error' ? 'alert' : 'status'}><span>{t(status === 'error' ? 'approved.loadFailed' : 'common.loading')}</span>{status === 'error' && <button className="ui-button" onClick={onRetry}>{t('common.retry')}</button>}</div>;
  return <div ref={root} className="approved-timeline saved-growing-timeline" data-phase={model.phase} aria-busy={status === 'loading' || undefined} data-active-days={model.activeDays} data-records={model.total}>
    {model.total > 0 && <div className="saved-timeline-plot">
      <svg width="100%" height="76" viewBox={`0 0 ${width} 76`} role="img" aria-label={t('approved.timelineSummary', { records: model.total, days: model.activeDays })}>
        <line className="saved-timeline-axis" x1={model.axisStart} x2={model.axisEnd} y1="64" y2="64"/>
        {model.marks.map(mark => <rect key={mark.key} className="saved-timeline-mark" x="0" y="0" width={mark.width} height={mark.height} rx={mark.width / 2} style={{ transform: `translate(${mark.x - mark.width / 2}px, ${64 - mark.height}px)`, width: mark.width, height: mark.height, opacity: mark.selectedCount ? 1 : .24 }} data-count={mark.count} data-day={mark.firstDay} data-last-day={mark.lastDay}>
          <title>{fullDate.format(mark.firstDay * 86400000)}{mark.lastDay !== mark.firstDay ? ` – ${fullDate.format(mark.lastDay * 86400000)}` : ''} · {t('approved.recordCount', { count: mark.count })}</title>
        </rect>)}
      </svg>
      {model.firstDay !== undefined && dateButton(model.firstDay, model.activeDays === 1 ? 'only' : 'first')}
      {model.activeDays > 1 && dateButton(model.lastDay!, 'last')}
    </div>}
    <div className="saved-timeline-meta"><span>{t('approved.recordCount', { count: recordCount })}</span>{(start || end) && <button type="button" onClick={() => onRangeChange('', '')}>{t('approved.allDates')}</button>}</div>
    {filterOpen && model.firstDay !== undefined && <div id={id} className="saved-timeline-filter" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <label>{t('approved.startDate')}<input ref={firstInput} type="date" value={start || savedDayString(model.firstDay)} min={savedDayString(model.firstDay)} max={end || savedDayString(model.lastDay!)} onChange={event => { const value = event.target.value, day = savedInputDay(value), last = savedInputDay(end) ?? model.lastDay!; onRangeChange(day !== undefined && day > last ? savedDayString(last) : value, end); }}/></label>
      <label>{t('approved.endDate')}<input type="date" value={end || savedDayString(model.lastDay!)} min={start || savedDayString(model.firstDay)} max={savedDayString(model.lastDay!)} onChange={event => { const value = event.target.value, day = savedInputDay(value), first = savedInputDay(start) ?? model.firstDay!; onRangeChange(start, day !== undefined && day < first ? savedDayString(first) : value); }}/></label>
      <button className="approved-icon" type="button" aria-label={t('common.close')} onClick={close}><X size={18}/></button>
    </div>}
  </div>;
}
