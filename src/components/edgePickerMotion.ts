import { backNavigation } from '../lib/backNavigation';
import { isTrashDragging } from './useTrashDrag';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Point = { x: number; y: number };
type Press = { id: number; start: Point; point: Point };
export function bindEdgePicker(
  root: HTMLElement,
  selected: number,
  pick: (index: number) => void,
  disabled: () => boolean,
  finishWriting: () => void,
) {
  const desk = root.closest<HTMLElement>('.import-card-stage,.approved-desk')!;
  const importing = desk.classList.contains('import-card-stage');
  const card = desk.querySelector<HTMLElement>(
    importing ? '.import-material-card' : '[data-desk-active=true]',
  )!;
  const edge = card.querySelector<HTMLElement>('.gesture-bottom-edge')!;
  const label = card.querySelector<HTMLButtonElement>('.approved-tag-edit')!;
  const rail = root.querySelector<HTMLElement>('.draw-rail')!,
    cards = rail.firstElementChild!.children;
  let phase: 'idle' | 'peek' | 'open' = 'idle',
    press: Press | null = null,
    hot = -1,
    originX = 0,
    frame = 0,
    lastTime = 0,
    blockUntil = 0;
  let baseline = card.getBoundingClientRect(),
    width = 0,
    height = 0,
    left = 0,
    top = 0,
    first = 0,
    stride = 1,
    maxScroll = 0,
    scroll = 0;
  let scrollDrag: { id: number; x: number; offset: number; moved: boolean } | null = null;
  function mark(i: number) {
    if (i === hot) return;
    if (hot >= 0) cards[hot]?.removeAttribute('data-hot');
    hot = i;
    if (i >= 0) (cards[i] as HTMLElement).dataset.hot = 'true';
  }
  let dismissLayer: (() => void) | undefined;
  function state(next: typeof phase) {
    if (next === 'open' && !dismissLayer)
      dismissLayer = backNavigation.register(() => {
        close();
        return true;
      });
    if (next !== 'open' && dismissLayer) {
      dismissLayer();
      dismissLayer = undefined;
    }
    phase = next;
    root.dataset.phase = next;
    desk.dataset.edgePhase = next;
    rail.inert = next !== 'open';
    root.setAttribute('aria-hidden', String(next !== 'open'));
    label.setAttribute('aria-expanded', String(next === 'open'));
  }
  function stopFrame() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function close() {
    const wasOpen = phase === 'open';
    stopFrame();
    mark(-1);
    press = null;
    scrollDrag = null;
    state('idle');
    delete document.documentElement.dataset.homeScrub;
    finishWriting();
    if (wasOpen) label.focus({ preventScroll: true });
  }
  function near(p: Point) {
    return (
      p.x >= baseline.left + baseline.width * 0.04 - 5 &&
      p.x <= baseline.right - baseline.width * 0.04 + 5 &&
      p.y >= baseline.bottom - 39 &&
      p.y <= baseline.bottom + 13
    );
  }
  function layout(x: number) {
    const host = desk.getBoundingClientRect(),
      viewHeight = importing ? window.innerHeight : desk.clientHeight;
    width = rail.clientWidth;
    height = root.offsetHeight;
    left = host.left + clamp(x - host.left - width / 2, 0, Math.max(0, desk.clientWidth - width));
    root.style.setProperty('--clip-left', Math.max(0, x - left - 104) + 'px');
    root.style.setProperty('--clip-right', Math.max(0, width - (x - left) - 104) + 'px');
    const initialTop = baseline.bottom - 15;
    top = clamp(baseline.bottom - height * 0.84, viewHeight * 0.51, viewHeight - height - 8);
    root.style.setProperty('--row-left', left - host.left + 'px');
    root.style.setProperty('--row-top', top - host.top + 'px');
    root.style.setProperty('--rise-from', initialTop - top + 'px');
    desk.style.setProperty('--edge-rise', top - baseline.bottom - 9 + 'px');
    const c = cards[0] as HTMLElement,
      second = cards[1] as HTMLElement;
    // Place the first card under the grip while keeping both end cards in reach at the scroll limits.
    const cardWidth = c.offsetWidth;
    root.style.setProperty('--rail-start', clamp(x - left - cardWidth / 2, 0, width - cardWidth) + 'px');
    first = c.offsetLeft + cardWidth / 2;
    stride = second.offsetLeft - c.offsetLeft;
    maxScroll = Math.max(0, rail.scrollWidth - width);
    scroll = clamp(first + selected * stride - (x - left), 0, maxScroll);
    rail.scrollLeft = scroll;
    originX = x;
  }
  function peek(p: Point) {
    if (phase === 'idle') {
      baseline = card.getBoundingClientRect();
      layout(p.x);
      desk.style.setProperty('--pull', '0');
      state('peek');
    }
  }
  function begin(p: Point) {
    if (phase === 'idle') peek(p);
    if (Math.abs(p.x - originX) > 5) layout(p.x);
    desk.style.setProperty('--pull', '1');
    state('open');
    scroll = rail.scrollLeft;
  }
  // Uniform card widths let us resolve the nearest card with one calculation.
  // Only the two cards whose visual state changed receive DOM writes.
  function update(now: number, advance: boolean) {
    if (!press || phase !== 'open') return false;
    const { x, y } = press.point,
      local = x - left;
    if (y < top - 16 || y > top + height + 16) {
      mark(-1);
      lastTime = 0;
      return false;
    }
    const edgeBand = Math.min(60, width * 0.19);
    const depth = clamp((edgeBand - Math.min(local, width - local)) / edgeBand, 0, 1);
    const dir = local < width / 2 ? -1 : 1;
    const pos = clamp(local, 1, width - 1);
    const end = clamp(first + (dir < 0 ? 0 : cards.length - 1) * stride - pos, 0, maxScroll);
    const remaining = (end - scroll) * dir;
    if (advance && depth > 0 && remaining > 0.25) {
      const dt = lastTime ? clamp(now - lastTime, 0, 50) : 0;
      const delta = Math.min(remaining, dt * (0.06 * depth + 1.23 * depth * depth));
      scroll += delta * dir;
      rail.scrollLeft = scroll;
    }
    // On release sample the painted offset, including native wheel/trackpad scrolling.
    const offset = advance ? scroll : rail.scrollLeft;
    const index = Math.round((offset + pos - first) / stride);
    mark(index >= 0 && index < cards.length ? index : -1);
    lastTime = now;
    return depth > 0 && remaining > 0.25;
  }
  function draw(time: number) {
    frame = 0;
    if (update(time, true)) frame = requestAnimationFrame(draw);
    else lastTime = 0;
  }
  function request() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function move(e: PointerEvent) {
    const p = { x: e.clientX, y: e.clientY };
    if (!press) {
      if (phase === 'open' || disabled() || e.pointerType !== 'mouse' || e.buttons) return;
      if (phase === 'idle' && !card.contains(e.target as Node) && !near(p)) return;
      if (phase === 'idle') baseline = card.getBoundingClientRect();
      if (near(p)) peek(p);
      else if (phase === 'peek') close();
      return;
    }
    if (e.pointerId !== press.id) return;
    press.point = p;
    const dy = press.start.y - p.y,
      dx = p.x - press.start.x;
    if (phase === 'peek') {
      if (isTrashDragging() || dy < -12 || (Math.abs(dx) > 22 && dy < Math.abs(dx) * 0.6)) {
        close();
        return;
      }
      const progress = clamp(dy / 27, 0, 1);
      if (progress >= 1 && dy > Math.abs(dx) * 0.85) {
        begin(p);
        document.documentElement.dataset.homeScrub = 'edge';
        try {
          edge.setPointerCapture(e.pointerId);
        } catch {}
      } else desk.style.setProperty('--pull', String(progress));
    }
    if (phase === 'open') {
      if (e.cancelable) e.preventDefault();
      request();
    }
  }
  function down(e: PointerEvent) {
    if (!e.isPrimary || e.button !== 0 || disabled()) return;
    blockUntil = 0;
    if (phase === 'open') {
      if (!root.contains(e.target as Node) && !label.contains(e.target as Node)) close();
      return;
    }
    if (phase === 'idle') baseline = card.getBoundingClientRect();
    const p = { x: e.clientX, y: e.clientY };
    if (!near(p) || (!edge.contains(e.target as Node) && phase !== 'peek')) return;
    peek(p);
    layout(p.x);
    press = { id: e.pointerId, start: p, point: p };
  }
  function up(e: PointerEvent) {
    if (!press || press.id !== e.pointerId) return;
    if (phase !== 'open') {
      close();
      return;
    }
    press.point = { x: e.clientX, y: e.clientY };
    update(performance.now(), false);
    const i = hot;
    blockUntil = performance.now() + 380;
    stopFrame();
    press = null;
    delete document.documentElement.dataset.homeScrub;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (i < 0) close();
    else pick(i);
  }
  function openViaTag() {
    if (disabled()) return;
    if (phase === 'open') {
      close();
      return;
    }
    baseline = card.getBoundingClientRect();
    begin({ x: baseline.x + baseline.width / 2, y: baseline.bottom });
    (cards[selected] as HTMLElement)?.focus({ preventScroll: true });
  }
  function wheel(e: WheelEvent) {
    if (!e.shiftKey || phase !== 'open') return;
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    rail.scrollLeft += d * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1);
    scroll = rail.scrollLeft;
  }
  function startScroll(e: PointerEvent) {
    if (e.pointerType !== 'touch' && e.button === 0) {
      scrollDrag = { id: e.pointerId, x: e.clientX, offset: rail.scrollLeft, moved: false };
      blockUntil = 0;
    }
  }
  function moveScroll(e: PointerEvent) {
    if (!scrollDrag || scrollDrag.id !== e.pointerId || !(e.buttons & 1)) return;
    const dx = e.clientX - scrollDrag.x;
    if (!scrollDrag.moved && Math.abs(dx) < 5) return;
    scrollDrag.moved = true;
    rail.setPointerCapture(e.pointerId);
    rail.scrollLeft = scrollDrag.offset - dx;
  }
  function endScroll() {
    if (scrollDrag?.moved) blockUntil = performance.now() + 350;
    scrollDrag = null;
  }
  const click = (e: MouseEvent) => {
    if (e.detail && performance.now() < blockUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && phase !== 'idle' && !e.isComposing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  const leave = () => {
    if (phase === 'peek' && !press) close();
  };
  const resize = () => {
    if (root.dataset.writing === 'true') return;
    close();
    baseline = card.getBoundingClientRect();
  };
  const ac = new AbortController(),
    capture = { capture: true, signal: ac.signal },
    listen = { signal: ac.signal };
  desk.dataset.gestureMode = 'edge';
  state('idle');
  document.addEventListener('pointermove', move, { ...capture, passive: false });
  document.addEventListener('pointerdown', down, capture);
  document.addEventListener('pointerup', up, capture);
  document.addEventListener('pointercancel', close, capture);
  document.documentElement.addEventListener('pointerleave', leave, listen);
  rail.addEventListener('wheel', wheel, { ...listen, passive: false });
  rail.addEventListener('pointerdown', startScroll, listen);
  rail.addEventListener('pointermove', moveScroll, listen);
  rail.addEventListener('pointerup', endScroll, listen);
  document.addEventListener('click', click, capture);
  window.addEventListener('keydown', key, capture);
  window.addEventListener('blur', close, listen);
  window.addEventListener('resize', resize, listen);
  if (importing) label.addEventListener('import-tag-picker', openViaTag, listen);
  else window.addEventListener('home-tag-picker', openViaTag, listen);
  return {
    close,
    destroy: () => {
      ac.abort();
      dismissLayer?.();
      stopFrame();
      delete desk.dataset.edgePhase;
      delete desk.dataset.gestureMode;
      delete document.documentElement.dataset.homeScrub;
    },
  };
}
