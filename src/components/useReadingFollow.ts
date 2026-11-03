import { useLayoutEffect, useReducer, useRef, type RefObject } from 'react';
import { createReadingFollowRecovery, createReadingScrollMotion, readingFollowDestination } from '../lib/readingFollow';

/** Follow the spoken original, never keyboard focus. Scroll input temporarily
 * yields; three seconds after scrolling settles, catch up to current playback. */
export default function useReadingFollow(scroll: RefObject<HTMLDivElement | null>, sentence: number | null, playing: boolean, listening: boolean, recoverable = playing) {
  const allowed = useRef(true);
  const [recovery, notifyRecovery] = useReducer(value => value + 1, 0);
  const latest = useRef({ sentence, playing, listening, recoverable }); latest.current = { sentence, playing, listening, recoverable };
  const update = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const motion = createReadingScrollMotion(viewport);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const idle = createReadingFollowRecovery(() => {
      if (!latest.current.recoverable || !latest.current.listening) return;
      allowed.current = true;
      // The current sentence may be outside the rendered window after a long
      // manual scroll. Let ReadingPage materialize it even without a new index.
      notifyRecovery(); update.current();
    });
    let resizeFrame = 0;
    const apply = () => {
      const state = latest.current, outer = viewport.getBoundingClientRect();
      const controls = viewport.parentElement?.querySelector<HTMLElement>('.reading-playback:not([data-closing])');
      // Leave the playback controls clear; center within the usable reading area.
      const bottom = state.listening && controls ? Math.min(outer.bottom, controls.getBoundingClientRect().top - 20) : outer.bottom;
      const available = Math.max(80, bottom - outer.top);
      if (state.listening) viewport.style.setProperty('--reading-follow-tail', `${Math.max(120, viewport.clientHeight - available / 2 + 24)}px`);
      else viewport.style.removeProperty('--reading-follow-tail');
      // A queue briefly loads between sentences; that is still playback intent.
      // Keep the user's idle deadline through buffering, but not through pauses.
      if (!state.recoverable || allowed.current) idle.cancel();
      if (viewport.hasAttribute('data-reading-anchoring')) { motion.cancel(); return; }
      if (!state.playing || !allowed.current || state.sentence === null) { motion.cancel(); return; }
      const target = viewport.querySelector<HTMLElement>(`[data-sentence="${state.sentence}"] .reading-original`);
      if (!target) { motion.cancel(); return; }
      const rect = target.getBoundingClientRect();
      motion.move(readingFollowDestination(viewport.scrollTop, rect.top - outer.top, rect.height, available, viewport.scrollHeight - viewport.clientHeight), preference.matches);
    };
    update.current = apply;
    const manual = () => { allowed.current = false; motion.cancel(); idle.intent(); };
    const tab = (event: KeyboardEvent) => { if (event.key === 'Tab') { allowed.current = false; motion.cancel(); idle.cancel(); } };
    const keys = (event: KeyboardEvent) => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) manual(); };
    const pointer = (event: PointerEvent) => { if (event.button === 0 && event.target === viewport) { allowed.current = false; motion.cancel(); idle.hold(); } };
    const release = () => idle.release();
    const onScroll = () => { if (!viewport.hasAttribute('data-reading-anchoring')) idle.scroll(); };
    const anchorStart = () => motion.cancel();
    const anchorEnd = (event: Event) => { if (!(event as CustomEvent<{interrupted:boolean}>).detail?.interrupted) apply(); };
    const resize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(apply); };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    const paper = viewport.querySelector('.reading-paper'); if (paper) observer.observe(paper);
    viewport.addEventListener('wheel', manual, { passive: true }); viewport.addEventListener('touchmove', manual, { passive: true });
    // Programmatic focus restoration after lookup is not browsing intent.
    // Actual Tab navigation still yields to the keyboard user.
    viewport.addEventListener('pointerdown', pointer); viewport.addEventListener('keydown', keys);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('reading-anchor-start', anchorStart); viewport.addEventListener('reading-anchor-end', anchorEnd);
    document.addEventListener('keydown', tab);
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    preference.addEventListener('change', apply);
    return () => {
      update.current = () => {}; motion.cancel(); idle.cancel(); cancelAnimationFrame(resizeFrame); observer.disconnect();
      viewport.style.removeProperty('--reading-follow-tail');
      viewport.removeEventListener('wheel', manual); viewport.removeEventListener('touchmove', manual);
      viewport.removeEventListener('pointerdown', pointer); viewport.removeEventListener('keydown', keys);
      viewport.removeEventListener('scroll', onScroll); window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release);
      viewport.removeEventListener('reading-anchor-start', anchorStart); viewport.removeEventListener('reading-anchor-end', anchorEnd);
      document.removeEventListener('keydown', tab);
      preference.removeEventListener('change', apply);
    };
  }, [scroll]);
  // Also handles appended sentence windows, translation/font changes, and resume.
  useLayoutEffect(() => { update.current(); });
  return { allowed, recovery };
}
