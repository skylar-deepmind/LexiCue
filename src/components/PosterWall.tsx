import { bookmarkTitle } from '../lib/bookmarkDesk';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Material } from '../lib/materials';
import { materialCover } from '../lib/materialCover';
import { phonePosterLayout } from '../lib/posterLayout';
import MaterialCover from './MaterialCover';
import { useMediaQuery } from './useMediaQuery';
import { finishReadingReturn } from '../lib/readingMotion';

const positions = new Map<string, { x: number; y: number; focus: number | null }>();
export default function PosterWall({ files, title, identity, onBack, onOpen, onManage }: { files: Material[]; title: string; identity: string; onBack: () => void; onOpen: (file: Material, node: HTMLElement) => void; onManage: () => void }) {
  const { t } = useTranslation(), mobile = useMediaQuery('(max-width: 767px)');
  const viewport = useRef<HTMLDivElement>(null), wall = useRef<HTMLDivElement>(null), projector = useRef<HTMLDivElement>(null);
  const memory = useRef(positions.get(identity) ?? { x: 0, y: 0, focus: null });
  const suppression = useRef(0);
  const columns = useMemo(() => phonePosterLayout(files.map(file => ({ id: file.id, characters: file.character_count ?? file.document?.blocks.reduce((count, block) => count + block.text.length, 0) ?? file.preview.length * Math.max(1, file.segment_count) }))), [files]);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    node.scrollTop = memory.current.y;
    if (memory.current.focus) node.querySelector<HTMLElement>(`[data-motion-file="${memory.current.focus}"] > button`)?.focus({ preventScroll: true });
    finishReadingReturn();
  }, [identity, mobile]);
  useEffect(() => {
    const view = viewport.current, plane = wall.current, beam = projector.current;
    if (!view || !plane || mobile) return;
    let x = memory.current.x, target = x, previous = performance.now(), lastInput = -Infinity, frame = 0, energy = 0;
    let drag: { id: number; x: number; start: number; moved: boolean } | null = null;
    const max = () => Math.max(0, plane.scrollWidth - view.clientWidth);
    const clamp = (value: number) => Math.max(0, Math.min(max(), value));
    const paint = (now: number) => {
      const dt = Math.min(40, Math.max(1, now - previous)); previous = now;
      const moving = now - lastInput < 210 || !!drag;
      if (!moving) {
        const stops = [...plane.querySelectorAll<HTMLElement>('.approved-poster-column')].map(column => clamp(column.offsetLeft));
        stops.push(max());
        target += ((stops.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? target) - target) * (1 - Math.exp(-dt / 80));
      }
      const old = x; x += (clamp(target) - x) * (1 - Math.exp(-dt / (moving ? 47 : 60)));
      const demand = 1 - Math.exp(-.9 * Math.abs(x - old) / dt);
      energy += (demand - energy) * (1 - Math.exp(-dt / (demand > energy ? 75 : 190)));
      plane.style.transform = `translate3d(${-x}px,0,0)`;
      view.style.setProperty('--projection-energy', String(energy));
      memory.current.x = x; positions.set(identity, memory.current);
      if (Math.abs(target - x) > .08 || moving || energy > .002) frame = requestAnimationFrame(paint); else frame = 0;
    };
    const wake = () => { lastInput = performance.now(); if (!frame) { previous = lastInput; frame = requestAnimationFrame(paint); } };
    const wheel = (event: WheelEvent) => {
      const delta = event.currentTarget === beam ? event.deltaX || event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault(); target = clamp(target + delta * .95); wake();
    };
    const down = (event: PointerEvent) => { if (event.button !== 0) return; drag = { id: event.pointerId, x: event.clientX, start: target, moved: false }; };
    const move = (event: PointerEvent) => {
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
    view.addEventListener('wheel', wheel, { passive: false }); beam?.addEventListener('wheel', wheel, { passive: false });
    view.addEventListener('pointerdown', down); view.addEventListener('pointermove', move); view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end); view.addEventListener('keydown', key);
    const resize = () => { target = clamp(target); wake(); }; window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); view.removeEventListener('wheel', wheel); beam?.removeEventListener('wheel', wheel); view.removeEventListener('pointerdown', down); view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', end); view.removeEventListener('pointercancel', end); view.removeEventListener('keydown', key); window.removeEventListener('resize', resize); };
  }, [mobile, identity, files]);
  const poster = (file: Material, units?: number) => <article className="approved-poster" key={file.id} data-motion-file={file.id} style={units ? { '--poster-units': units } as React.CSSProperties : undefined}><button aria-label={t('readingDesk.openNamed', { name: file.name })} onClick={event => {
    if (performance.now() < suppression.current) return;
    memory.current.focus = file.id; memory.current.y = viewport.current?.scrollTop ?? 0; positions.set(identity, memory.current);
    onOpen(file, event.currentTarget.closest('article')!);
  }}><MaterialCover src={materialCover(file)} identity={file.content_hash}/><span><small>{file.tags[0]?.name ?? title}</small><strong lang="en">{bookmarkTitle(file.name)}</strong></span></button></article>;
  return <section className="approved-wall" aria-label={title}>
    <header><button className="approved-icon" onClick={onBack} aria-label={t('readingDesk.backLibrary')}><ArrowLeft size={23}/></button><h1>{title}</h1><button className="approved-icon" onClick={onManage} aria-label={t('approved.manage')}><MoreHorizontal size={24}/></button></header>
    {!files.length ? <p className="approved-wall-empty" role="status">{t('materials.noMatches')}</p> : <div ref={viewport} className="approved-wall-viewport" tabIndex={0} aria-label={title} onScroll={() => { memory.current.y = viewport.current?.scrollTop ?? 0; positions.set(identity, memory.current); }}><div ref={wall} className="approved-poster-plane">
      {mobile ? columns.map((column, i) => <div className="approved-phone-column" key={i}>{column.map(item => poster(files.find(file => file.id === item.id)!, item.units))}</div>) : Array.from({ length: Math.ceil(files.length / 3) * 2 }, (_, i) => {
        const start = Math.floor(i / 2) * 3 + (i % 2 ? 1 : 0), chunk = files.slice(start, start + (i % 2 ? 2 : 1));
        return chunk.length ? <div key={i} className="approved-poster-column" data-paired={i % 2 === 1}>{chunk.map(file => poster(file))}</div> : null;
      })}
    </div><div className="approved-projection-light" aria-hidden="true"/></div>}
    <div ref={projector} className="approved-projector" aria-hidden="true"><div className="approved-projector-beam"/><img src="/design/optics.jpg" alt=""/><i/></div>
  </section>;
}
