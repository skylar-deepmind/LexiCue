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
      const turn = ((index % 9) - 4) * 5;
      frames = [
        { transform: pose(dx, dy, -10, scale * .8), opacity: 0 },
        { transform: pose(dx + turn * 2, dy - 42, turn, scale * 1.26), opacity: 1, offset: .32 },
        { transform: pose(dx * .46, dy * .46 - 48, turn * .6, .76), offset: .63 },
        landing,
      ];
      duration = 700;
      delay = Math.min(index * 12, 115);
    } else if (entrance.style === 'columns') {
      const turn = (column % 2 === 0 ? -1 : 1) * 12;
      frames = [
        { transform: pose(dx, dy, turn * 1.5, scale), opacity: 0 },
        { transform: pose(dx * .48, dy * .5 - 32, turn, .74), opacity: 1, offset: .48 },
        landing,
      ];
      duration = 480;
      delay = Math.min(column * 86, 490) + (index % 2) * 10;
    } else {
      const turn = index % 2 ? 9 : -15;
      frames = [
        { transform: pose(dx, dy, turn, scale), opacity: 0 },
        { transform: pose(dx * .62, dy * .55 - 38, turn * .77, .68), opacity: 1, offset: .38 },
        landing,
      ];
      duration = 510;
      delay = Math.min(index * 39, 540);
    }
    const job = copy.animate(frames, { duration, delay, easing: 'cubic-bezier(.24,.7,.24,1)', fill: 'both' });
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
