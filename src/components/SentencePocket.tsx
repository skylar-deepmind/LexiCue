import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { useMediaQuery } from './useMediaQuery';
import { isMobilePlatform } from '../lib/platform';
import usePaperSeam, { seamOffset, seamInset } from './usePaperSeam';

type Point = { x: number; y: number };
interface Props {
  segmentId: number;
  sentence: string;
  expression: string;
  count: number;
  saved: boolean;
  disabled: boolean;
  open: boolean;
  toggle: () => void;
  save: () => void;
}
const limit = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export default function SentencePocket(props: Props) {
  const { t } = useTranslation();
  const narrow = useMediaQuery('(max-width: 767px)');
  const top = narrow || isMobilePlatform();
  const { canvas, pressure } = usePaperSeam(top);
  const latest = useRef(props);
  latest.current = props;
  const mouth = useRef<HTMLButtonElement>(null),
    activate = useRef<() => void>(() => {});
  const [phase, phaseTo] = useState('idle');
  useLayoutEffect(() => {
    const sheet = document.querySelector<HTMLElement>(
      '[data-sheet-active] [data-sheet-id="' + props.segmentId + '"]',
    );
    const slot = sheet?.parentElement;
    activate.current = () => latest.current.toggle();
    if (!sheet || !slot) return;
    const note = sheet,
      seat = slot;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    let touch: { id: number; start: Point } | null = null;
    let box: DOMRect | null = null,
      grip: Point = { x: 0, y: 0 },
      pose = '',
      active = false,
      finishing = false;
    let maskFrame = 0;
    let swallow = false,
      clearClick = 0,
      settle = 0,
      receipt = 0,
      anim: Animation | null = null;
    const inPocket = (at: Point) => {
      const r = mouth.current?.closest('.context-panel')?.getBoundingClientRect();
      return !!r && at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
    };
    // Measure travel across the lip and alignment along it, in viewport coordinates.
    const axes = (r: DOMRect) => top
      ? { across: r.top, depth: r.height, along: r.left, span: r.width }
      : { across: r.left, depth: r.width, along: r.top, span: r.height };
    const clip = (trim: number, forward: boolean) => {
      if (top) return `inset(-18px -18px ${trim}px -18px)`;
      return forward ? `inset(-18px ${trim}px -18px -18px)` : `inset(-18px -18px -18px ${trim}px)`;
    };
    const display = (pt: Point) => {
      if (!box) return;
      const dx = pt.x - box.left - grip.x,
        dy = pt.y - box.top - grip.y,
        progress = Math.min(1, Math.hypot(dx, dy) / 230);
      const t = progress * progress * (3 - 2 * progress);
      const paper = axes(box), rim = axes(mouth.current!.getBoundingClientRect());
      const inset = seamInset(rim.span, top);
      const carryScale = top ? Math.min(0.82, (rim.span - 2 * inset) / paper.span) : 0.61;
      const scale = 1 - (reduced() ? 0 : t) * (1 - carryScale);
      const slit = rim.across + seamOffset;
      const forward = top || rim.across > paper.depth * scale + 10;
      const alongGrip = top ? grip.x : grip.y;
      const edge = top ? pt.y - grip.y * scale : pt.x - grip.x * scale;
      const extent = paper.depth * scale;
      const center = (top ? pt.x : pt.y) + (paper.span / 2 - alongGrip) * scale;
      const cross = center - rim.along;
      const travel = forward ? edge + extent - slit : slit - edge;
      const contact = cross > inset && cross < rim.span - inset ? limit((travel + 48) / 48, 0, 1) : 0;
      const past = contact === 1 ? Math.max(0, travel - extent * 0.68) : 0;
      const correction = forward ? -past : past;
      const angle = reduced() ? 0 : t * 2.3 * (1 - contact);
      pose = `translate(${dx + (top ? 0 : correction)}px,${dy + (top ? correction : 0)}px) rotate(${angle}deg) scale(${scale})`;
      note.style.transform = pose;
      const hidden = travel - past;
      note.style.clipPath = contact === 1 && hidden > -9 ? clip(hidden / scale, forward) : 'inset(-18px)';
      const source = limit(paper.along + alongGrip - rim.along, inset + 25, rim.span - inset - 25);
      const contactPoint = source + (cross - source) * contact;
      const towardSentence = paper.across + paper.depth / 2 < slit ? -1 : 1;
      const invitation = 1 - contact;
      const depth = 0.73 * invitation + contact * (0.73 + 0.27 * limit(travel / 35, 0, 1));
      pressure.current(contactPoint, depth, towardSentence * invitation);
      note.style.setProperty('--rise', String(t));
      phaseTo(inPocket(pt) ? 'over' : 'carrying');
    };
    const lift = (at: Point) => {
      if (active || finishing || latest.current.disabled) return false;
      box = note.getBoundingClientRect();
      grip = { x: at.x - box.left, y: at.y - box.top };
      seat.style.width = box.width + 'px';
      seat.style.height = box.height + 'px';
      seat.dataset.empty = 'true';
      note.dataset.floating = 'true';
      Object.assign(note.style, {
        left: box.left + 'px',
        top: box.top + 'px',
        width: box.width + 'px',
        height: box.height + 'px',
        transformOrigin: grip.x + 'px ' + grip.y + 'px',
      });
      note.setAttribute('popover', 'manual');
      note.showPopover?.();
      active = true;
      display(at);
      return true;
    };
    const restore = () => {
      if (note.hidePopover) note.hidePopover();
      note.removeAttribute('popover');
      note.removeAttribute('data-floating');
      note.removeAttribute('style');
      seat.removeAttribute('data-empty');
      seat.style.removeProperty('width');
      seat.style.removeProperty('height');
      active = false;
      finishing = false;
      touch = null;
      box = null;
    };
    const finish = (insert: boolean) => {
      if (!active || finishing || !box || !mouth.current) return;
      finishing = true;
      touch = null;
      const dest = mouth.current.getBoundingClientRect(),
        loc = note.getBoundingClientRect(),
        original = box,
        home = seat.getBoundingClientRect();
      const rim = axes(dest), paper = axes(original), current = axes(loc);
      const bound = seamInset(rim.span, top) + 4;
      const scale = top ? Math.min(0.82, (rim.span - 2 * bound) / paper.span)
        : Math.min(0.86, 225 / original.width, Math.max(36, dest.height - 16) / original.height);
      const forward = top || rim.across > paper.depth * scale + 10;
      const slit = rim.across + seamOffset, extent = paper.depth * scale;
      const across = forward ? current.across + current.depth - slit : slit - current.across;
      const tucked = limit(across / extent, 0, 0.6);
      const dock = forward ? slit - extent * (1 - tucked) : slit - extent * tucked;
      const along = limit(current.along, rim.along + bound, rim.along + rim.span - paper.span * scale - bound);
      const end = forward ? slit : slit - extent;
      const contactPoint = along + paper.span * scale / 2 - rim.along;
      pressure.current(contactPoint, insert ? 1 : 0);
      const align = (x: number, y: number, s: number) =>
        'translate(' +
        (x - original.x - grip.x * (1 - s)) +
        'px,' +
        (y - original.y - grip.y * (1 - s)) +
        'px) scale(' +
        s +
        ')';
      const zero = note.style.clipPath || 'inset(-18px)';
      const frames: Keyframe[] = [
        { transform: pose, clipPath: insert ? undefined : zero, easing: 'cubic-bezier(.22,.65,.35,1)' },
      ];
      if (insert) {
        frames.push(
          { transform: align(top ? along : dock, top ? dock : along, scale), offset: 0.46, easing: 'cubic-bezier(.32,0,.45,1)' },
          { transform: align(top ? along : end, top ? end : along, scale), offset: 1 },
        );
      } else frames.push({ transform: align(home.x, home.y, 1), clipPath: 'inset(-18px)' });
      phaseTo(insert ? 'sliding' : 'returning');
      if (insert && !latest.current.saved && !latest.current.disabled) latest.current.save();
      const duration = reduced() ? 90 : insert ? 680 : 290;
      anim = note.animate(reduced() ? [{ opacity: 1 }, { opacity: insert ? 0 : 1 }] : frames, {
        duration,
        fill: 'forwards',
      });
      // Cut against the stationary lip in viewport coordinates throughout the slide.
      // Animating a percentage mask on a scaling note can make the edge drift.
      const cutAtLip = () => {
        const r = note.getBoundingClientRect(),
          factor = r.width / original.width;
        if (factor > 0) {
          const edge = axes(r);
          const overhang = forward ? edge.across + edge.depth - slit : slit - edge.across;
          note.style.clipPath = clip(limit(overhang / factor, -18, paper.depth + 12), forward);
        }
        maskFrame = requestAnimationFrame(cutAtLip);
      };
      if (insert && !reduced()) cutAtLip();
      const done = () => {
        if (!finishing) return;
        cancelAnimationFrame(maskFrame);
        clearTimeout(settle);
        if (anim) {
          anim.onfinish = null;
          anim.cancel();
          anim = null;
        }
        pressure.current(contactPoint, 0);
        restore();
        phaseTo(insert ? 'arrived' : 'idle');
        if (insert) {
          if (!reduced()) note.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240 });
          receipt = window.setTimeout(() => phaseTo('idle'), 650);
        }
      };
      anim.onfinish = done;
      settle = window.setTimeout(done, duration + 90);
    };
    const pickup = () => {
      const r = note.getBoundingClientRect();
      if (lift({ x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 }))
        mouth.current?.focus({ preventScroll: true });
    };
    activate.current = () => {
      if (finishing) return;
      if (active) finish(true);
      else latest.current.toggle();
    };
    const down = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        !e.isPrimary ||
        !note.contains(e.target as Node) ||
        finishing ||
        latest.current.disabled ||
        e.shiftKey
      )
        return;
      clearTimeout(clearClick);
      swallow = false;
      touch = { id: e.pointerId, start: { x: e.clientX, y: e.clientY } };
      // A stationary click still goes to its word. Drag only claims the gesture once it moves.
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (!touch || e.pointerId !== touch.id || finishing) return;
      const pt = { x: e.clientX, y: e.clientY };
      if (!active && Math.hypot(pt.x - touch.start.x, pt.y - touch.start.y) < 4) return;
      if (!active && !lift(touch.start)) return;
      if (!note.hasPointerCapture(e.pointerId)) note.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      display(pt);
    };
    const suppressClick = () => {
      swallow = true;
      clearClick = window.setTimeout(() => {
        swallow = false;
      }, 500);
    };
    const up = (e: PointerEvent) => {
      if (!touch || touch.id !== e.pointerId) return;
      touch = null;
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick();
      finish(inPocket({ x: e.clientX, y: e.clientY }));
    };
    const cancel = () => {
      touch = null;
      if (active && !finishing) {
        suppressClick();
        finish(false);
      }
    };
    const click = (e: MouseEvent) => {
      if (swallow) {
        swallow = false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (
        !latest.current.disabled &&
        note.contains(e.target as Node) &&
        (!(e.target as Element).closest('.reading-word') ||
          (e.target as Element).closest('.reading-word[aria-pressed="true"]'))
      ) {
        e.stopPropagation();
        e.preventDefault();
        if (!active) pickup();
      }
    };
    const keys = (e: KeyboardEvent) => {
      if (active && e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
        return;
      }
      if (e.target === note && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          if (active) finish(true);
          else pickup();
        }
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('click', click, true);
      clearTimeout(clearClick);
      clearTimeout(settle);
      clearTimeout(receipt);
      cancelAnimationFrame(maskFrame);
      anim?.cancel();
      pressure.current(0, 0);
      if (active) restore();
      activate.current = () => {};
    };
  }, [props.segmentId, props.expression, pressure, top]);
  useEffect(() => {
    phaseTo('idle');
  }, [props.segmentId, props.expression, top]);
  return (
    <>
      <button
        type="button"
        className="quiet-pocket"
        ref={mouth}
        data-edge={top ? 'top' : 'side'}
        data-phase={phase}
        data-open={props.open}
        aria-expanded={props.open}
        aria-label={
          phase === 'carrying' || phase === 'over'
            ? t('reader.saveSentence')
            : (props.open ? t('annotation.meaning') : t('reader.myRecords')) +
              ' · ' +
              props.expression +
              ' · ' +
              props.count
        }
        onClick={() => activate.current()}
      >
        <canvas className="paper-seam" ref={canvas} aria-hidden="true" />
      </button>
      <span className="sr-only" role="status">
        {phase === 'arrived' && props.saved ? t('dictionaryFlow.saveToast') : ''}
      </span>
    </>
  );
}
