import { useLayoutEffect, useReducer, useRef, type RefObject } from 'react';
import { createReadingFollowRecovery, createReadingScrollMotion, readingFollowDestination } from '../lib/readingFollow';

type FollowState = {
  sentence: number | null;
  playing: boolean;
  listening: boolean;
  recoverable: boolean;
  canBrowse: boolean;
  onBrowse: () => void;
  onBrowseEnd: () => void;
};

/** Keep following the spoken sentence unless the user is browsing the page. */
export default function useReadingFollow(scroll: RefObject<HTMLDivElement | null>, state: FollowState) {
  const allowed = useRef(true);
  const [recovery, notifyRecovery] = useReducer(value => value + 1, 0);
  const latest = useRef(state);
  latest.current = state;
  const update = useRef<() => void>(() => {});
  const cancelBrowsing = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    const motion = createReadingScrollMotion(viewport);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let browsing = false, previewFrame = 0, touchHeld = false, mouseHeld = false;
    const stopBrowsing = () => {
      browsing = false;
      idle.cancel();
      cancelAnimationFrame(previewFrame);
      previewFrame = 0;
      latest.current.onBrowseEnd();
    };
    cancelBrowsing.current = stopBrowsing;
    const idle = createReadingFollowRecovery(() => {
      browsing = false;
      if (!latest.current.recoverable) return;
      stopBrowsing();
      allowed.current = true;
      // The current sentence may be outside the rendered window after a long
      // manual scroll. Let ReadingPage materialize it even without a new index.
      notifyRecovery(); update.current();
    });
    let resizeFrame = 0;
    const apply = () => {
      const state = latest.current, outer = viewport.getBoundingClientRect();
      const controls = viewport.closest('.b-shell')?.querySelector<HTMLElement>('.mobile-reading-bar')
        ?? viewport.parentElement?.querySelector<HTMLElement>('.reading-playback:not([data-closing])');
      // Leave the visible playback controls clear.
      const controlsBox = controls?.getBoundingClientRect();
      const bottom = state.listening && controlsBox?.height ? Math.min(outer.bottom, controlsBox.top - 20) : outer.bottom;
      const available = Math.max(80, bottom - outer.top);
      if (state.listening) viewport.style.setProperty('--reading-follow-tail', `${Math.max(120, viewport.clientHeight - available / 2 + 24)}px`);
      else viewport.style.removeProperty('--reading-follow-tail');
      if (!state.canBrowse) stopBrowsing();
      if (viewport.hasAttribute('data-reading-anchoring')) { motion.cancel(); return; }
      if (!state.playing || !allowed.current || state.sentence === null) { motion.cancel(); return; }
      const target = viewport.querySelector<HTMLElement>(`[data-sentence="${state.sentence}"] .reading-original`);
      if (!target) { motion.cancel(); return; }
      const rect = target.getBoundingClientRect();
      motion.move(readingFollowDestination(viewport.scrollTop, rect.top - outer.top, rect.height, available, viewport.scrollHeight - viewport.clientHeight), preference.matches);
    };
    update.current = apply;
    const manual = () => {
      if (!latest.current.canBrowse) return;
      browsing = true;
      allowed.current = false;
      motion.cancel();
      idle.intent();
    };
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && event.deltaY !== 0) manual(); };
    const touchStart = (event: TouchEvent) => {
      if (browsing && event.touches.length === 1) { touchHeld = true; idle.hold(); }
    };
    const touchMove = (event: TouchEvent) => {
      if (!latest.current.canBrowse || event.touches.length !== 1) return;
      if (!touchHeld) { touchHeld = true; idle.hold(); }
      manual();
    };
    const touchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0 && touchHeld) { touchHeld = false; if (!mouseHeld) idle.release(); }
    };
    const tab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') { browsing = false; allowed.current = false; motion.cancel(); idle.cancel(); }
    };
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as Element).closest('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === ' ' && (event.target as Element).closest('button,a')) return;
      if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) manual();
    };
    const pointer = (event: PointerEvent) => {
      if (!latest.current.canBrowse || event.pointerType === 'touch' || event.button !== 0) return;
      if (event.target !== viewport && !(browsing && (event.target as Element).closest('.reader-playback-guide'))) return;
      manual();
      mouseHeld = true;
      idle.hold();
    };
    const release = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && mouseHeld) { mouseHeld = false; if (!touchHeld) idle.release(); }
    };
    const onScroll = () => {
      if (!browsing || viewport.hasAttribute('data-reading-anchoring')) return;
      idle.scroll();
      if (!previewFrame) previewFrame = requestAnimationFrame(() => {
        previewFrame = 0;
        if (browsing && latest.current.canBrowse) latest.current.onBrowse();
      });
    };
    const anchorStart = () => motion.cancel();
    const anchorEnd = (event: Event) => { if (!(event as CustomEvent<{interrupted:boolean}>).detail?.interrupted) apply(); };
    const resize = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(apply); };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    const paper = viewport.querySelector('.reading-paper'); if (paper) observer.observe(paper);
    viewport.addEventListener('wheel', wheel, { passive: true });
    viewport.addEventListener('touchstart', touchStart, { passive: true });
    viewport.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true, capture: true });
    window.addEventListener('touchcancel', touchEnd, { passive: true, capture: true });
    // Programmatic focus restoration after lookup is not browsing intent.
    // Actual Tab navigation still yields to the keyboard user.
    viewport.addEventListener('pointerdown', pointer); viewport.addEventListener('keydown', keys);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('reading-anchor-start', anchorStart); viewport.addEventListener('reading-anchor-end', anchorEnd);
    document.addEventListener('keydown', tab);
    window.addEventListener('pointerup', release, true); window.addEventListener('pointercancel', release, true);
    preference.addEventListener('change', apply);
    return () => {
      update.current = () => {};
      cancelBrowsing.current = () => {};
      motion.cancel(); idle.cancel(); cancelAnimationFrame(previewFrame); cancelAnimationFrame(resizeFrame); observer.disconnect();
      viewport.style.removeProperty('--reading-follow-tail');
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('touchstart', touchStart); viewport.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd, true); window.removeEventListener('touchcancel', touchEnd, true);
      viewport.removeEventListener('pointerdown', pointer); viewport.removeEventListener('keydown', keys);
      viewport.removeEventListener('scroll', onScroll); window.removeEventListener('pointerup', release, true); window.removeEventListener('pointercancel', release, true);
      viewport.removeEventListener('reading-anchor-start', anchorStart); viewport.removeEventListener('reading-anchor-end', anchorEnd);
      document.removeEventListener('keydown', tab);
      preference.removeEventListener('change', apply);
    };
  }, [scroll]);
  // Also handles appended sentence windows, translation/font changes, and resume.
  useLayoutEffect(() => { update.current(); });
  return { allowed, recovery, cancelBrowsing };
}
