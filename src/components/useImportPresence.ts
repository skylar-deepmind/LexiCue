import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Keep the modal and focus owner mounted until its exit has actually finished. */
export function useImportPresence(open: boolean, ref: RefObject<HTMLDivElement | null>) {
  const [present, setPresent] = useState(open);
  const sequence = useRef(0);
  const invalidate = useCallback(() => { sequence.current++; }, []);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const scrim = panel.parentElement?.querySelector<HTMLElement>('.overlay-scrim');
    const token = ++sequence.current;
    if (open) setPresent(true);
    panel.inert = !open;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = { opacity: open ? '1' : '0', transform: reduce ? 'none' : open ? 'translateY(0px) scale(1)' : 'translateY(4px) scale(.975)' };
    const duration = reduce ? 1 : open ? 260 : 180;
    if (!panel.animate) {
      Object.assign(panel.style, target);
      if (scrim) scrim.style.opacity = open ? '1' : '0';
      if (!open) setPresent(false);
      return;
    }
    const style = getComputedStyle(panel);
    const animations = [panel.animate([{ opacity: style.opacity, transform: reduce ? 'none' : style.transform }, target], {
      duration, easing: open ? 'cubic-bezier(.2,.8,.25,1)' : 'cubic-bezier(.4,0,.2,1)', fill: 'forwards',
    })];
    if (scrim) animations.push(scrim.animate([{ opacity: getComputedStyle(scrim).opacity }, { opacity: open ? '1' : '0' }], { duration, easing: 'ease-out', fill: 'forwards' }));
    let settled = false;
    const finish = () => {
      if (settled || token !== sequence.current) return;
      settled = true;
      clearTimeout(fallback);
      Object.assign(panel.style, target);
      if (scrim) scrim.style.opacity = open ? '1' : '0';
      animations.forEach(animation => animation.cancel());
      if (!open) setPresent(false);
    };
    // Some WKWebView versions suspend Animation.finished in background windows.
    // Motion must never leave an invisible modal owning focus and inertness.
    const fallback = setTimeout(finish, duration + 120);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    return () => {
      clearTimeout(fallback);
      invalidate();
      // Preserve the actual in-flight frame when a quick reopen reverses an exit.
      const current = getComputedStyle(panel);
      panel.style.opacity = current.opacity;
      panel.style.transform = current.transform;
      if (scrim) scrim.style.opacity = getComputedStyle(scrim).opacity;
      animations.forEach(animation => animation.cancel());
    };
  }, [open, ref, invalidate]);
  return open || present;
}
