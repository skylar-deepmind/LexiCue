import { paintedCopy } from './visualSnapshot';

export type PosterEntrance = { tag: string; origin: DOMRect };

export function playPosterDeal(viewport: HTMLElement, entrance: PosterEntrance) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = viewport.getBoundingClientRect();
  const posters = [...viewport.querySelectorAll<HTMLElement>('.approved-poster')].flatMap(node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > bounds.left + 6 && rect.left < bounds.right - 6
      ? [{ node, rect }] : [];
  });
  if (!posters.length) return;
  const layer = document.createElement('div');
  layer.className = 'approved-poster-deal';
  layer.inert = true;
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  viewport.dataset.dealing = '';
  const sourceX = entrance.origin.left + entrance.origin.width / 2;
  const sourceY = entrance.origin.top + entrance.origin.height * .49;
  const columnPositions = [...new Set(posters.map(({ rect }) => Math.round(rect.x)))];
  const restores: (() => void)[] = [];
  const jobs: Animation[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    delete viewport.dataset.dealing;
    jobs.forEach(job => job.cancel());
    restores.forEach(restore => restore());
    layer.remove();
    viewport.removeEventListener('wheel', dispose);
    viewport.removeEventListener('pointerdown', dispose);
    viewport.removeEventListener('keydown', dispose);
    window.removeEventListener('resize', dispose);
  };
  for (const [index, { node, rect }] of posters.entries()) {
    const copy = paintedCopy(node);
    copy.classList.add('approved-poster-deal-card');
    const visibility = node.style.visibility;
    restores.push(() => { node.style.visibility = visibility; });
    node.style.visibility = 'hidden';
    Object.assign(copy.style, { left: rect.x + 'px', top: rect.y + 'px', transformOrigin: '50% 50%' });
    layer.append(copy);
    const landing = { transform: 'none', opacity: 1 };
    let job: Animation;
    if (index === 0) {
      const dx = sourceX - (rect.x + rect.width / 2);
      const dy = sourceY - (rect.y + rect.height / 2);
      const scale = Math.min(.8, 96 / Math.max(rect.width, rect.height));
      const sweep = Math.min(130, rect.height * .24 + 47);
      job = copy.animate([
        { transform: `translate(${dx}px,${dy + 13}px) rotate(-21deg) scale(${scale * .9})`, opacity: 0, easing: 'ease-out' },
        { transform: `translate(${dx * .84}px,${dy * .78 - sweep}px) rotate(-21deg) scale(${scale * 1.17})`, opacity: 1, offset: .31, easing: 'cubic-bezier(.2,.72,.2,1)' },
        landing,
      ], { duration: 410, fill: 'both' });
    } else {
      // All posters in a column travel the same distance, as one vertical strip.
      const column = columnPositions.indexOf(Math.round(rect.x));
      const rise = innerHeight + 32 - bounds.top;
      job = copy.animate([
        { transform: `translateY(${rise}px)`, opacity: 1, easing: 'cubic-bezier(.23,.76,.2,1)' },
        landing,
      ], { duration: 510, delay: 200 + Math.min(column * 105, 525), fill: 'both' });
    }
    jobs.push(job);
    void job.finished.then(() => { node.style.visibility = visibility; copy.remove(); }, () => {});
  }
  viewport.addEventListener('wheel', dispose, { passive: true });
  viewport.addEventListener('pointerdown', dispose);
  viewport.addEventListener('keydown', dispose);
  window.addEventListener('resize', dispose, { once: true });
  void Promise.allSettled(jobs.map(job => job.finished)).then(dispose);
  return dispose;
}
