import { useLayoutEffect, useRef, type RefObject } from 'react';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

export default function useReaderTitleDock(scroll: RefObject<HTMLDivElement | null>) {
  const title = useRef<HTMLHeadingElement>(null);
  const dock = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const viewport = scroll.current;
    const heading = title.current;
    const bar = dock.current;
    const text = line.current;
    if (!viewport || !heading || !bar || !text) return;

    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previous = -1;
    const update = () => {
      frame = 0;
      const inline = heading.getBoundingClientRect();
      const start = 18;
      const travel = start + Math.min(inline.height, 42);
      const progress = clamp((viewport.getBoundingClientRect().top + start - inline.top) / travel);
      const visible = reducedMotion.matches ? Number(progress === 1) : smooth(progress);
      if (previous === visible) return;
      previous = visible;

      // The scrolling and fixed title occupy separate, clipped areas on either side of the bar.
      heading.style.setProperty('--reader-inline-opacity', String(1 - visible));
      bar.style.setProperty('--reader-docked-opacity', String(visible));
      bar.style.setProperty('--reader-docked-rise', `${(1 - visible) * 16}px`);
      const distanceToTitle = Math.max(0, inline.left - bar.getBoundingClientRect().left);
      bar.style.setProperty('--reader-docked-shift', `${(1 - visible) * Math.min(distanceToTitle, 72)}px`);
      bar.toggleAttribute('data-docked', visible === 1);
    };

    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const measure = () => {
      const overflow = text.offsetWidth - bar.clientWidth;
      bar.toggleAttribute('data-overflow', overflow > 0);
      if (overflow > 0) {
        bar.style.setProperty('--reader-title-overflow', `${overflow + 16}px`);
        bar.style.setProperty('--reader-title-duration', `${Math.max(2.6, (overflow + 16) / 24 + 1.4)}s`);
      }
    };

    measure();
    update();
    const sizes = new ResizeObserver(() => {
      measure();
      schedule();
    });
    sizes.observe(viewport);
    sizes.observe(heading);
    sizes.observe(bar);
    sizes.observe(text);
    viewport.addEventListener('scroll', schedule, { passive: true });
    reducedMotion.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      viewport.removeEventListener('scroll', schedule);
      reducedMotion.removeEventListener('change', schedule);
    };
  }, [scroll]);

  return { title, dock, line };
}
