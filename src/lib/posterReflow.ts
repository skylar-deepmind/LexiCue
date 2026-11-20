function isInWall(rect: DOMRect, wall: DOMRect) {
  return rect.right > wall.left && rect.left < wall.right && rect.bottom > wall.top && rect.top < wall.bottom;
}
function readPosters(viewport: HTMLElement) {
  return [...viewport.querySelectorAll<HTMLElement>('.approved-poster[data-motion-file]')].map(poster => ({
    poster, id: poster.dataset.motionFile!, rect: poster.getBoundingClientRect(),
  }));
}

export function capturePosterReflow(viewport: HTMLElement) {
  const bounds = viewport.getBoundingClientRect();
  const middle = bounds.left + bounds.width / 2;
  const previous = new Map<string, DOMRect>();
  let anchor: { id: string; x: number } | undefined;
  for (const { id, rect } of readPosters(viewport)) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    previous.set(id, rect);
    const center = rect.left + rect.width / 2;
    if (isInWall(rect, bounds) && (!anchor || Math.abs(center - middle) < Math.abs(anchor.x - bounds.width / 2))) {
      anchor = { id, x: center - bounds.left };
    }
  }
  return { bounds, anchor, previous };
}

export function playPosterReflow(viewport: HTMLElement, snapshot: ReturnType<typeof capturePosterReflow>) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = viewport.getBoundingClientRect();
  const moves = readPosters(viewport).flatMap(({ poster, id, rect }) => {
    const before = snapshot.previous.get(id);
    if (!before || !rect.width || !rect.height || (!isInWall(before, snapshot.bounds) && !isInWall(rect, bounds))) return [];
    const dx = Math.max(-bounds.width, Math.min(bounds.width, before.x - rect.x));
    const dy = before.y - rect.y;
    const sx = before.width / rect.width, sy = before.height / rect.height;
    if (Math.abs(dx) < .75 && Math.abs(dy) < .75 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) return [];
    return [{ poster, transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }];
  });
  if (!moves.length) return;
  viewport.dataset.reflowing = '';
  const jobs = moves.map(({ poster, transform }) => poster.animate([
    { transformOrigin: 'top left', transform },
    { transformOrigin: 'top left', transform: 'none' },
  ], { duration: 390, easing: 'cubic-bezier(.2,.72,.22,1)' }));
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    delete viewport.dataset.reflowing;
    jobs.forEach(job => job.cancel());
  };
  void Promise.allSettled(jobs.map(job => job.finished)).then(stop);
  return stop;
}
