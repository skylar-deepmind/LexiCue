import { bookmarkTitle } from '../lib/bookmarkDesk';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import EmptyLibraryArtwork from './EmptyLibraryArtwork';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Material } from '../lib/materials';
import { materialCover } from '../lib/materialCover';
import { desktopPosterLayout, phonePosterLayout, type PosterScale } from '../lib/posterLayout';
import MaterialCover from './MaterialCover';
import { useMediaQuery } from './useMediaQuery';
import useTrashDrag, { isTrashDragging } from './useTrashDrag';
import { useFileStore } from '../stores/fileStore';
import { finishReadingReturn } from '../lib/readingMotion';
import { playPosterDeal, type PosterEntrance } from '../lib/posterDeal';

type WallPosition = { x: number; y: number; focus: number | null; scale: PosterScale };
const positions = new Map<string, WallPosition>();
const scales: { key: PosterScale; icon: number[] }[] = [
  { key: 'large', icon: [1, 2] }, { key: 'medium', icon: [2, 3, 2] }, { key: 'small', icon: [3, 4, 3, 4] },
];
export default function PosterWall({ files, title, identity, entrance, onBack, onOpen }: { files: Material[]; title: string; identity: string; entrance: PosterEntrance | null; onBack: () => void; onOpen: (file: Material, node: HTMLElement) => void }) {
  const { t } = useTranslation(), mobile = useMediaQuery('(max-width: 767px)');
  const viewport = useRef<HTMLDivElement>(null), wall = useRef<HTMLDivElement>(null);
  const memory = useRef<WallPosition>(positions.get(identity) ?? { x: 0, y: 0, focus: null, scale: 'medium' });
  const suppression = useRef(0), restoring = useRef(true);
  const [scale, setScale] = useState(memory.current.scale);
  const scaleAnchor = useRef<{ id: string; x: number } | null>(null);
  const endDeal = useRef<(() => void) | undefined>(undefined);
  const desktop = useMemo(() => desktopPosterLayout(files, scale), [files, scale]);
  const changeScale = (next: PosterScale) => {
    if (scale === next || !viewport.current) return;
    endDeal.current?.();
    const bounds = viewport.current.getBoundingClientRect();
    const middle = bounds.left + bounds.width / 2;
    let best = Infinity;
    for (const poster of viewport.current.querySelectorAll<HTMLElement>('.approved-poster')) {
      const rect = poster.getBoundingClientRect();
      if (rect.right <= bounds.left || rect.left >= bounds.right) continue;
      const x = rect.left + rect.width / 2;
      if (Math.abs(x - middle) >= best) continue;
      best = Math.abs(x - middle);
      scaleAnchor.current = { id: poster.dataset.motionFile!, x: x - bounds.left };
    }
    memory.current.scale = next;
    positions.set(identity, memory.current);
    setScale(next);
  };
  const columns = useMemo(() => phonePosterLayout(files.map(file => ({ id: file.id, characters: file.character_count ?? file.document?.blocks.reduce((count, block) => count + block.text.length, 0) ?? file.preview.length * Math.max(1, file.segment_count) }))), [files]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const y = memory.current.y;
    restoring.current = true;
    if (memory.current.focus) node.querySelector<HTMLElement>(`[data-motion-file="${memory.current.focus}"] > button`)?.focus({ preventScroll: true });
    // WKWebView can scroll a focused source after the route has restored it.
    // Keep the saved offset through those frames before measuring the reverse.
    let frame = 0;
    const restore = (remaining: number) => {
      node.scrollTop = y;
      if (remaining) frame = requestAnimationFrame(() => restore(remaining - 1));
      else { restoring.current = false; finishReadingReturn('wall'); }
    };
    restore(2);
    return () => cancelAnimationFrame(frame);
  }, [identity, mobile]);
  useLayoutEffect(() => {
    if (mobile || !entrance || !viewport.current) return;
    const view = viewport.current;
    const frame = requestAnimationFrame(() => { endDeal.current = playPosterDeal(view, entrance); });
    return () => { cancelAnimationFrame(frame); endDeal.current?.(); endDeal.current = undefined; };
  }, [mobile, entrance]);
  useLayoutEffect(() => {
    const view = viewport.current, plane = wall.current;
    if (!view || !plane || mobile) return;
    let x = memory.current.x, target = x, previous = performance.now(), lastInput = -Infinity, frame = 0;
    let drag: { id: number; x: number; start: number; moved: boolean } | null = null;
    const max = () => Math.max(0, plane.scrollWidth - view.clientWidth);
    const clamp = (value: number) => Math.max(0, Math.min(max(), value));
    const anchor = scaleAnchor.current;
    if (anchor) {
      scaleAnchor.current = null;
      const node = plane.querySelector<HTMLElement>(`[data-motion-file="${anchor.id}"]`);
      if (node) {
        const rect = node.getBoundingClientRect();
        x = clamp(rect.left - plane.getBoundingClientRect().left + rect.width / 2 - anchor.x);
        memory.current.x = x;
        target = x;
      }
    }
    const paint = (now: number) => {
      const dt = Math.min(40, Math.max(1, now - previous)); previous = now;
      const moving = now - lastInput < 210 || !!drag;
      if (!moving) {
        const stops = [...plane.querySelectorAll<HTMLElement>('.approved-poster-column')].map(column => clamp(column.offsetLeft));
        stops.push(max());
        target += ((stops.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target) - target) * (1 - Math.exp(-dt / 80));
      }
      x += (clamp(target) - x) * (1 - Math.exp(-dt / (moving ? 47 : 60)));
      plane.style.transform = `translate3d(${-x}px,0,0)`;
      memory.current.x = x; positions.set(identity, memory.current);
      if (Math.abs(target - x) > .08 || moving) frame = requestAnimationFrame(paint); else frame = 0;
    };
    const wake = () => { lastInput = performance.now(); if (!frame) { previous = lastInput; frame = requestAnimationFrame(paint); } };
    const wheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta || event.ctrlKey || !max()) return;
      event.preventDefault(); target = clamp(target + delta * .95); wake();
    };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; drag = { id: event.pointerId, x: event.clientX, start: target, moved: false }; };
    const move = (event: PointerEvent) => {
      if(isTrashDragging()){drag=null;return;}
      if (!drag || drag.id !== event.pointerId) return;
      const delta = drag.x - event.clientX;
      if (Math.abs(delta) > 4) { drag.moved = true; view.setPointerCapture(event.pointerId); }
      if (!drag.moved) return;
      event.preventDefault(); target = clamp(drag.start + delta * .95); wake();
    };
    const end = (event: PointerEvent) => { if (!drag || drag.id !== event.pointerId) return; if (drag.moved) suppression.current = performance.now() + 350; if (view.hasPointerCapture(event.pointerId)) view.releasePointerCapture(event.pointerId); drag = null; wake(); };
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); target = event.key === 'Home' ? 0 : event.key === 'End' ? max() : clamp(target + (event.key === 'ArrowRight' ? 1 : -1) * 260); wake();
    };
    plane.style.transform = `translate3d(${-clamp(x)}px,0,0)`;
    view.addEventListener('wheel', wheel, { passive: false });
    view.addEventListener('pointerdown', down); view.addEventListener('pointermove', move); view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end); view.addEventListener('keydown', key);
    const resize = () => { target = clamp(target); wake(); }; window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); view.removeEventListener('wheel', wheel); view.removeEventListener('pointerdown', down); view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', end); view.removeEventListener('pointercancel', end); view.removeEventListener('keydown', key); window.removeEventListener('resize', resize); };
  }, [mobile, identity, files, scale]);
  const poster = (file: Material, units?: number) => <RemovablePoster key={file.id} file={file}><article className="approved-poster" key={file.id} data-motion-file={file.id} style={units ? { '--poster-units': units } as CSSProperties : undefined}><button aria-label={t('readingDesk.openNamed', { name: file.name })} title={mobile ? undefined : bookmarkTitle(file.name)} onClick={event => {
    if (performance.now() < suppression.current) return;
    memory.current.focus = file.id; memory.current.y = viewport.current?.scrollTop ?? 0; positions.set(identity, memory.current);
    onOpen(file, event.currentTarget.closest('article')!);
  }}><MaterialCover src={materialCover(file)} identity={file.content_hash}/><span><strong lang="en">{bookmarkTitle(file.name)}</strong></span></button></article></RemovablePoster>;
  return <section className="approved-wall" data-poster-scale={mobile ? undefined : scale} aria-label={title}>
    <header><button className="approved-icon approved-back" onClick={onBack} aria-label={t('readingDesk.backLibrary')}><ChevronLeft size={22}/></button><h1>{title}</h1>{!mobile && !!files.length && <div className="approved-poster-scales" role="group" aria-label={t('readingDesk.posterScale')}>
      {scales.map(({ key, icon }) => <button key={key} type="button" className="approved-icon" aria-pressed={scale === key} aria-label={t('readingDesk.posterScale_'+key)} title={t('readingDesk.posterScale_'+key)} onClick={() => changeScale(key)}>
        <span className="approved-poster-scale-icon" aria-hidden="true">{icon.map((cards, index) => <span key={index}>{Array.from({length:cards}, (_, card) => <i key={card}/>)}</span>)}</span>
      </button>)}
    </div>}</header>
    {!files.length ? <div className="approved-wall-empty" role="status"><EmptyLibraryArtwork/><p>{t('materials.noMatches')}</p></div> : <div ref={viewport} className="approved-wall-viewport" tabIndex={0} aria-label={title} onScroll={() => { if (restoring.current) return; memory.current.y = viewport.current?.scrollTop ?? 0; positions.set(identity, memory.current); }}><div ref={wall} className="approved-poster-plane" data-few={files.length <= 2 || undefined}>
      {mobile ? columns.map((column, i) => <div className="approved-phone-column" key={i}>{column.map(item => poster(files.find(file => file.id === item.id)!, item.units))}</div>)
        : desktop.map(({ width, heights, items }, i) => <div key={i} className="approved-poster-column"
          style={{ '--poster-column-width': width+'px', gridTemplateRows: heights.map(height => `minmax(0,${height}fr)`).join(' ') } as CSSProperties}>{items.map(file => poster(file))}</div>)}
    </div></div>}
  </section>;
}

function RemovablePoster({file,children}:{file:Material;children:React.ReactNode}) {
 const ref=useRef<HTMLDivElement>(null),deleting=useFileStore(s=>!!s.deletingFiles[file.id]);
 useTrashDrag(ref,{id:`material:${file.id}`,label:file.name,disabled:deleting,remove:()=>useFileStore.getState().deleteFile(file.id,file.name,'trash-drop')});
 return <div ref={ref} className="approved-trash-poster">{children}</div>;
}
