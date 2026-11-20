import { paintedCopy } from './visualSnapshot';

type DealStyle = 'cascade' | 'fan' | 'columns';
export type PosterEntrance = { tag: string; origin: DOMRect; style: DealStyle };

export function posterDealStyle(): DealStyle {
  if (import.meta.env.DEV) {
    const preview = document.documentElement.dataset.posterDealPreview;
    if (preview === 'fan' || preview === 'columns') return preview;
  }
  return 'cascade';
}

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
  layer.dataset.style = entrance.style;
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
    const column = columnPositions.indexOf(Math.round(rect.x));
    const dx = sourceX - (rect.x + rect.width / 2), dy = sourceY - (rect.y + rect.height / 2);
    const scale = Math.min(.8, 96 / Math.max(rect.width, rect.height));
    const pose = (x: number,y: number,angle: number,size: number) => `translate(${x}px,${y}px) rotate(${angle}deg) scale(${size})`;
    const landing = { transform: 'none', opacity: 1 };
    let frames: Keyframe[];
    let duration: number, delay: number;
    if (entrance.style === 'fan') {
      // The whole hand opens around a shared pivot, holds, then releases together.
      const slot = posters.length < 2 ? 0 : (index / (posters.length - 1)) * 2 - 1;
      const spread = Math.min(180, bounds.width * .22);
      const pivotX = Math.max(bounds.left + spread + 55, Math.min(bounds.right - spread - 55, sourceX));
      const pivotY = Math.max(bounds.top + 110, Math.min(bounds.bottom - 100, sourceY - 44));
      const fanX = dx + (pivotX - sourceX) + slot * spread;
      const fanY = dy + (pivotY - sourceY) + slot * slot * 49;
      const turn = slot * 32;
      const openHand = pose(fanX, fanY, turn, scale * 1.55);
      frames = [
        { transform: pose(dx, dy, 0, scale * .68), opacity: 0, easing: 'cubic-bezier(.18,.8,.24,1)' },
        { transform: openHand, opacity: 1, offset: .33, easing: 'linear' },
        { transform: openHand, opacity: 1, offset: .49, easing: 'cubic-bezier(.4,0,.23,1)' },
        landing,
      ];
      duration = 940;
      delay = 0;
      copy.style.zIndex = String(posters.length - index);
    } else if (entrance.style === 'columns' && index !== 0) {
      // All posters in a column travel the same distance, as one vertical strip.
      const rise = innerHeight + 32 - bounds.top;
      frames = [
        { transform: pose(0, rise, 0, 1), opacity: 1, easing: 'cubic-bezier(.23,.76,.2,1)' },
        landing,
      ];
      duration = 510;
      delay = 200 + Math.min(column * 105, 525);
    } else {
      const turn = (index % 2 ? 13 : -21);
      const sweep = Math.min(130, (rect.height * .24) + 47);
      frames = [
        { transform: pose(dx, dy + 13, turn, scale * .9), opacity: 0, easing: 'ease-out' },
        { transform: pose(dx * .84, dy * .78 - sweep, turn, scale * 1.17), opacity: 1, offset: .31, easing: 'cubic-bezier(.2,.72,.2,1)' },
        landing,
      ];
      duration = 410;
      delay = index < 4 ? index * 105 : 315 + Math.min((index - 3) * 46, 488);
    }
    const job = copy.animate(frames, { duration, delay, fill: 'both' });
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
