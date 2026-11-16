import { flushSync } from 'react-dom';
/** Pixel snapshots belong to the browser compositor, never to stored UI/data. */
export function dissolvePage(navigate: () => void, reverse = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { navigate(); return; }
  document.documentElement.dataset.dissolve = reverse ? 'out' : 'in';
  if (document.startViewTransition) {
    const transition = document.startViewTransition(() => { flushSync(navigate); });
    void transition.finished.finally(() => { delete document.documentElement.dataset.dissolve; });
  } else {
    const old = document.querySelector<HTMLElement>('.page-live');
    const job = old?.animate([{ opacity:1 },{ opacity:0 }], { duration:reverse?145:125, easing:'cubic-bezier(.25,.65,.3,1)', fill:'both' });
    void (job?.finished ?? Promise.resolve()).then(() => { navigate(); job?.cancel(); requestAnimationFrame(() => { document.querySelector('.page-live')?.animate([{ opacity:0 },{ opacity:1 }], { delay:reverse?85:75, duration:reverse?205:170, easing:'cubic-bezier(.25,.65,.3,1)' }); }); }, () => navigate());
  }
}
