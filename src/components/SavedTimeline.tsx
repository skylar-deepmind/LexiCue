import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { savedDayString, savedInputDay, savedTimeline, type SavedDateBin } from '../lib/savedTimeline';

type Props = {
  bins: SavedDateBin[]; recordCount: number | null | undefined; start: string; end: string;
  status: 'loading' | 'ready' | 'error';
  onRangeChange: (start: string, end: string) => void; onRetry: () => void;
};
type Range = { from: number; to: number };
type Drag = Range & { pointer: number; x: number; y: number; day: number; mode: 'start' | 'end' | 'new'; moved: boolean };
const baseline = 35;

export default function SavedTimeline({ bins, recordCount, start, end, status, onRangeChange, onRetry }: Props) {
  const { t, i18n } = useTranslation(), plot = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null), pendingRange = useRef<Range | null>(null);
  const [width, setWidth] = useState(320), [draft, setDraft] = useState<Range | null>(null);
  const model = useMemo(() => savedTimeline(bins, width, draft?.from ?? savedInputDay(start), draft?.to ?? savedInputDay(end)), [bins, width, start, end, draft]);
  const statusOnly = status === 'error' || status === 'loading' && !model.total;
  const showPlot = !statusOnly && model.activeDays > 1;
  useLayoutEffect(() => {
    const node = plot.current;
    if (!node) return;
    const resize = () => { if (node.clientWidth > 0) setWidth(node.clientWidth); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showPlot]);
  const first = model.firstDay ?? 0, last = model.lastDay ?? first;
  const from = Math.max(first, Math.min(last, draft?.from ?? savedInputDay(start) ?? first)), to = Math.max(from, Math.min(last, draft?.to ?? savedInputDay(end) ?? last));
  const fullDate = new Intl.DateTimeFormat(i18n.language, {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'});
  const firstYear = new Date(from * 86400000).getUTCFullYear();
  const showYear = firstYear !== new Date().getFullYear() || firstYear !== new Date(to * 86400000).getUTCFullYear();
  const axisDate = new Intl.DateTimeFormat(i18n.language, {
    year: showYear ? 'numeric' : undefined,
    month: 'short',
    day: to - from < 62 ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
  const dateStart = axisDate.format(from * 86400000), dateEnd = axisDate.format(to * 86400000);
  const selected = !!start || !!end || !!draft;
  const xFor = (day: number) => model.activeDays === 1 ? width/2 : 22+(day-first)/Math.max(1,last-first)*Math.max(1,width-44);
  const dayAt = (x: number) => Math.round(first+Math.max(0,Math.min(1,(x-(plot.current?.getBoundingClientRect().left??0)-22)/Math.max(1,width-44)))*(last-first));
  const commit = (range: Range) => {
    const low=Math.max(first,Math.min(last,range.from)), high=Math.max(low,Math.min(last,range.to));
    onRangeChange(low===first&&high===last?'':savedDayString(low),low===first&&high===last?'':savedDayString(high));
  };
  const stopDrag = () => { drag.current=null;pendingRange.current=null;setDraft(null); };
  const handle = (side: 'start'|'end') => <button type="button" role="slider" className="saved-timeline-handle" data-range-handle={side}
    style={{left:xFor(side==='start'?from:to)}} aria-label={t(side==='start'?'approved.startDate':'approved.endDate')}
    aria-valuemin={first} aria-valuemax={last} aria-valuenow={side==='start'?from:to} aria-valuetext={fullDate.format((side==='start'?from:to)*86400000)}
    onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const current=side==='start'?from:to;
      const value=event.key==='Home'?first:event.key==='End'?last:current+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?7:1);
      commit(side==='start'?{from:Math.min(to,value),to}:{from,to:Math.max(from,value)});
    }}><span aria-hidden="true"/></button>;
  if (statusOnly) return <div className="approved-timeline saved-timeline-status" data-state={status} role={status==='error'?'alert':'status'}><span>{t(status==='error'?'approved.loadFailed':'common.loading')}</span>{status==='error'&&<button className="ui-button" onClick={onRetry}>{t('common.retry')}</button>}</div>;
  return <div className="approved-timeline saved-growing-timeline" data-phase={model.phase} data-active-days={model.activeDays} data-records={model.total} data-range-active={selected||undefined} aria-busy={status==='loading'||recordCount===null||undefined}>
    <div className="saved-timeline-summary">
      {recordCount === null && <span className="saved-timeline-label">{t('common.loading')}</span>}
      {recordCount !== undefined && recordCount !== null && <span className="saved-timeline-count">
        <Trans i18nKey="savedRecords.recordMetric" count={recordCount} components={{ value: <strong/>, unit: <span/> }}/>
      </span>}
      {(start||end)&&<button type="button" className="saved-timeline-reset approved-icon" aria-label={t('approved.allDates')} onClick={()=>onRangeChange('','')}><RotateCcw size={16} aria-hidden="true"/></button>}
    </div>
    {model.activeDays === 1 && <time className="saved-timeline-date" dateTime={savedDayString(first)}>{fullDate.format(first * 86400000)}</time>}
    {showPlot && <div className="saved-timeline-graph">
      <div ref={plot} className="saved-timeline-plot" onPointerDown={event=>{
        if(event.button!==0)return;
        const mode=(event.target as Element).closest<HTMLElement>('[data-range-handle]')?.dataset.rangeHandle as 'start'|'end'|undefined;
        drag.current={pointer:event.pointerId,x:event.clientX,y:event.clientY,day:dayAt(event.clientX),from,to,mode:mode??'new',moved:false};
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event=>{
        const current=drag.current;if(!current||current.pointer!==event.pointerId)return;
        const dx=event.clientX-current.x,dy=event.clientY-current.y;
        if(!current.moved){if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>6){stopDrag();return;}if(Math.abs(dx)<4)return;current.moved=true;}
        event.preventDefault();const day=dayAt(event.clientX);
        const next=current.mode==='start'?{from:Math.min(day,current.to),to:current.to}:current.mode==='end'?{from:current.from,to:Math.max(day,current.from)}:{from:Math.min(day,current.day),to:Math.max(day,current.day)};pendingRange.current=next;setDraft(next);
      }} onPointerUp={event=>{const current=drag.current;if(!current||current.pointer!==event.pointerId)return;if(current.moved&&pendingRange.current)commit(pendingRange.current);stopDrag();if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
        onPointerCancel={stopDrag} onLostPointerCapture={stopDrag} onKeyDown={event=>{if(event.key==='Escape'&&drag.current){event.preventDefault();event.stopPropagation();stopDrag();}}}>
        <svg width="100%" height="48" viewBox={`0 0 ${width} 48`} role="img" aria-label={t('approved.timelineSummary',{records:model.total,days:model.activeDays})}>
          <line className="saved-timeline-axis" x1={model.axisStart} x2={model.axisEnd} y1={baseline} y2={baseline}/>
          {selected&&<rect className="saved-timeline-selection" x={xFor(from)-5} y="7" width={Math.max(10,xFor(to)-xFor(from)+10)} height="30" rx="4"/>}
          {model.marks.map(mark => {
            const barWidth = mark.width * .72, barHeight = mark.height * .64;
            return <rect key={mark.key} className="saved-timeline-mark" width={barWidth} height={barHeight} rx={Math.min(barWidth / 2, 2)} style={{transform:`translate(${mark.x-barWidth/2}px,${baseline-barHeight}px)`,width:barWidth,height:barHeight,opacity:mark.selectedCount?1:.22}} data-count={mark.count} data-day={mark.firstDay} data-last-day={mark.lastDay}>
              <title>{fullDate.format(mark.firstDay*86400000)} · {t('approved.recordCount',{count:mark.count})}</title>
            </rect>;
          })}
        </svg>
        {handle('start')}{handle('end')}
      </div>
      <div className="saved-timeline-period" data-centered={selected || dateStart === dateEnd || undefined}>
        {selected && dateStart !== dateEnd ? <span>{dateStart} – {dateEnd}</span> : <><span>{dateStart}</span>{dateStart !== dateEnd && <span>{dateEnd}</span>}</>}
      </div>
    </div>}
  </div>;
}
