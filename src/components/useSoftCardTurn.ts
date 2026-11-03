import { useLayoutEffect, useRef } from 'react';

// Neighbours occupy the same grid cell as the current paper. Only transforms
// change during a turn; the intrinsic grid size keeps the pager and dock still.
export function deskCardTransform(position: number) {
  const side = Math.sign(position);
  return `translateX(${position * 78}%) scale(${position === 0 ? 1 : .86}) rotateY(${-side * 12}deg) rotateZ(${side * 3}deg)`;
}

type Turn = { positions: Map<HTMLElement, number> };

export function useSoftCardTurn(id: number | null | undefined, index: number, count: number, onStep: (step: number) => void) {
  const stackRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ index, count, onStep });
  const flight = useRef<Turn | null>(null);
  const queued = useRef(0);
  const request = useRef<(direction: number) => void>(() => {});
  latest.current = { index, count, onStep };

  function turn(direction: number) {
    if (flight.current) { queued.current = direction; return; }
    const state = latest.current;
    if (state.index + direction < 0 || state.index + direction >= state.count) return;
    const stack = stackRef.current;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !stack) {
      state.onStep(direction);
      return;
    }
    flight.current = { positions: new Map([...stack.querySelectorAll<HTMLElement>(':scope > .desk-paper')].map(paper => [paper, Number(paper.dataset.deskPosition)])) };
    state.onStep(direction);
  }
  request.current = turn;

  useLayoutEffect(() => {
    const turn = flight.current, stack = stackRef.current;
    if (!turn || !stack || !id) { flight.current = null; queued.current = 0; return; }
    let cancelled = false;
    const animations: Animation[] = [];
    const moving: HTMLElement[] = [];
    stack.dataset.turning = 'true';
    for (const [paper, before] of turn.positions) {
      if (!paper.isConnected) continue;
      const after = Number(paper.dataset.deskPosition);
      if (Math.abs(before) > 1 && Math.abs(after) > 1) continue;
      // Keep an exiting neighbour visible until it has cleared the stage.
      paper.style.visibility = 'visible';
      paper.style.zIndex = after === 0 ? '5' : before === 0 ? '4' : '2';
      moving.push(paper);
      animations.push(paper.animate([
        { transform: deskCardTransform(before), opacity: Math.abs(before) <= 1 ? 1 : 0 },
        { transform: deskCardTransform(after), opacity: Math.abs(after) <= 1 ? 1 : 0 },
      ], { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' }));
    }
    const start = document.timeline.currentTime;
    if (typeof start === 'number') animations.forEach(animation => { animation.startTime = start; });
    function clear() {
      animations.forEach(animation => animation.cancel());
      moving.forEach(paper => { paper.style.removeProperty('visibility'); paper.style.removeProperty('z-index'); });
      delete stack!.dataset.turning;
      if (flight.current === turn) flight.current = null;
    }
    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (cancelled) return;
      clear();
      const next = queued.current;
      queued.current = 0;
      if (next && stack.isConnected) request.current(next);
    }).catch(() => {});
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => { if (preference.matches) animations.forEach(animation => animation.finish()); };
    const resize = () => { queued.current = 0; animations.forEach(animation => animation.finish()); };
    preference.addEventListener('change', finish);
    window.addEventListener('resize', resize);
    return () => {
      cancelled = true; queued.current = 0;
      preference.removeEventListener('change', finish);
      window.removeEventListener('resize', resize);
      clear();
    };
  }, [id, index, count]);

  return { stackRef, turn };
}
