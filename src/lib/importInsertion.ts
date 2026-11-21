import { copyImportCard } from './visualSnapshot';
let active = () => {};
type Flight = {
  layer: HTMLElement;
  copy: HTMLElement;
  box: DOMRect;
  source: HTMLElement;
  visibility: string;
  dispose: () => void;
};
export function captureImportInsertion(source: HTMLElement | null): Flight | null {
  active();
  if (!source || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const box = source.getBoundingClientRect(),
    copy = copyImportCard(source),
    layer = document.createElement('div'),
    visibility = source.style.visibility;
  layer.className = 'import-insertion-flight b-shell figma-shell';
  layer.inert = true;
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${source.offsetWidth}px`,
    height: `${source.offsetHeight}px`,
    margin: '0',
    translate: 'none',
    scale: 'none',
    rotate: 'none',
    transform: `scale(${box.width / source.offsetWidth},${box.height / source.offsetHeight})`,
    transformOrigin: '0 0',
    willChange: 'transform',
  });
  const veil = document.createElement('div');
  Object.assign(layer.style, { background: 'transparent', border: 'none', padding: '0' });
  Object.assign(veil.style, {
    position: 'absolute',
    inset: '0',
    background: getComputedStyle(document.body).backgroundColor,
  });
  layer.append(veil, copy);
  document.body.append(layer);
  source.style.visibility = 'hidden';
  const dispose = () => {
    layer.remove();
    if (source.isConnected) source.style.visibility = visibility;
  };
  const flight = { layer, copy, box, source, visibility, dispose };
  active = dispose;
  return flight;
}
export async function finishImportInsertion(flight: Flight | null, fileId: number) {
  let target: HTMLElement | null = null;
  const deadline = performance.now() + 1400;
  while (!target && performance.now() < deadline && !document.hidden) {
    target = document.querySelector<HTMLElement>(
      `.approved-card[data-motion-file="${fileId}"][data-desk-active="true"]`,
    );
    if (!target) await new Promise<void>((done) => requestAnimationFrame(() => done()));
  }
  if (!target || !flight || !flight.layer.isConnected) {
    flight?.dispose();
    return;
  }
  const box = target.getBoundingClientRect(),
    visibility = target.style.visibility;
  target.style.visibility = 'hidden';
  const width = parseFloat(flight.copy.style.width),
    height = parseFloat(flight.copy.style.height);
  const dx = box.x - flight.box.x,
    dy = box.y - flight.box.y,
    sx = box.width / width,
    sy = box.height / height;
  const startX = flight.box.width / width,
    startY = flight.box.height / height;
  const pose = (x: number, y: number, kx: number, ky: number) =>
    `translate3d(${x}px,${y}px,0) scale(${kx},${ky})`;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    animation.cancel();
    flight.dispose();
    if (target?.isConnected) target.style.visibility = visibility;
    window.removeEventListener('resize', dispose);
    document.removeEventListener('visibilitychange', hidden);
    if (active === dispose) active = () => {};
  };
  const hidden = () => {
    if (document.hidden) dispose();
  };
  flight.layer.firstElementChild?.animate([{ opacity: 0.96 }, { opacity: 0 }], {
    duration: 420,
    easing: 'ease-out',
    fill: 'forwards',
  });
  const animation = flight.copy.animate(
    [
      { transform: pose(0, 0, startX, startY), easing: 'cubic-bezier(.37,.04,.45,1)' },
      { transform: pose(dx, dy + 3, sx, sy), offset: 0.79, easing: 'cubic-bezier(.15,.8,.25,1)' },
      { transform: pose(dx, dy, sx, sy) },
    ],
    { duration: 610, fill: 'both' },
  );
  const timer = setTimeout(dispose, 900);
  active = dispose;
  window.addEventListener('resize', dispose, { once: true });
  document.addEventListener('visibilitychange', hidden);
  void animation.finished
    .then(() => {
      dispose();
      if (!document.hidden)
        target?.querySelector<HTMLButtonElement>('.approved-card-open')?.focus({ preventScroll: true });
    })
    .catch(dispose);
}
