import { useLayoutEffect, useRef } from 'react';

// The cut is in the face of the card. Its ends are bonded to the backing.
export const seamOffset = 13;
export const seamInset = (span: number, top: boolean) => top ? Math.min(18, span * 0.045) : Math.min(27, span * 0.09);

export default function usePaperSeam(top: boolean) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pressure = useRef<(position: number, depth: number, lean?: number) => void>(() => {});
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0,
      h = 0,
      dpr = 1,
      raf = 0,
      last = 0,
      dark = false;
    let position = 0,
      targetPosition = 0,
      depth = 0,
      goalDepth = 0,
      lean = 0,
      goalLean = 0;
    const ramps = new Map<number, CanvasGradient>();
    const paint = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const span = top ? w : h;
      const inset = seamInset(span, top), end = span - inset;
      const spread = top ? Math.max(70, (end - inset) * 0.38) : 48;
      const shadow = dark ? '4,9,10' : '43,49,48';
      // Shade the recess and one continuous, shallow bevel on the outer sheet.
      // The relief falls to zero away from the paper and at both fixed ends.
      for (let row = Math.floor(inset); row < end; row++) {
        const tip = Math.min(1, (row - inset + 1) / 7, (end - row) / 7);
        const falloff = Math.exp(-Math.pow((row - position) / spread, 2)) * Math.max(0, tip);
        const level = Math.round(100 * falloff * depth);
        const strain = level / 100;
        const gap = 0.7 + (top ? 11 : 4.1) * strain,
          front = seamOffset + gap;
        let shade = ramps.get(level);
        const origin = seamOffset - 2 - strain,
          length = front + 10 - origin;
        if (!shade) {
          const ramp = ctx.createLinearGradient(origin, 0, front + 10, 0);
          const stop = (x: number, rgba: string) => ramp.addColorStop((x - origin) / length, rgba);
          const tint = (a: number) => 'rgba(' + shadow + ',' + a + ')';
          ramp.addColorStop(0, tint(0));
          stop(seamOffset, tint(0.11 + 0.18 * strain));
          stop(front - 0.32, tint((dark ? 0.67 : 0.31) + 0.18 * strain));
          stop(front + 0.23, 'rgba(255,255,255,' + (dark ? 0.12 : 0.57) + ')');
          stop(front + 1.5, 'rgba(255,255,255,' + (dark ? 0.035 : 0.18) + ')');
          stop(front + 3, tint(0.022 + 0.025 * strain));
          ramp.addColorStop(1, tint(0));
          shade = ramp;
          ramps.set(level, ramp);
        }
        // At pickup the free edge leans toward the source, with both ends fixed.
        const offset = lean * 4.8 * falloff;
        if (top) ctx.setTransform(0, dpr, dpr, 0, 0, offset * dpr);
        else ctx.setTransform(dpr, 0, 0, dpr, offset * dpr, 0);
        ctx.globalAlpha = Math.max(0, tip);
        ctx.fillStyle = shade;
        ctx.fillRect(origin, row, length, 1);
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(64, now - (last || now - 16));
      last = now;
      const k = media.matches ? 1 : 1 - Math.exp(-dt / (goalDepth > depth ? 76 : 155));
      depth += (goalDepth - depth) * k;
      lean += (goalLean - lean) * k;
      position += (targetPosition - position) * Math.min(1, k * 1.7);
      if (
        Math.abs(goalDepth - depth) > 0.006 ||
        Math.abs(targetPosition - position) > 0.3 ||
        Math.abs(goalLean - lean) > 0.006
      ) {
        raf = requestAnimationFrame(tick);
      } else {
        depth = goalDepth;
        lean = goalLean;
        position = targetPosition;
      }
      paint();
    };
    const schedule = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    pressure.current = (at, amount, direction = 0) => {
      const span = top ? w : h, inset = seamInset(span, top);
      if (amount > 0) targetPosition = Math.max(inset + 7, Math.min(span - inset - 7, at));
      if (depth < 0.03) position = targetPosition;
      goalDepth = Math.max(0, Math.min(1, amount));
      goalLean = direction;
      schedule();
    };
    const size = () => {
      ramps.clear();
      w = el.clientWidth;
      h = el.clientHeight;
      dpr = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      position = targetPosition = (top ? w : h) * 0.52;
      paint();
    };
    const theme = () => {
      ramps.clear();
      dark = document.documentElement.dataset.theme === 'midnight';
      paint();
    };
    const observer = new ResizeObserver(size);
    observer.observe(el);
    const appearance = new MutationObserver(theme);
    appearance.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    size();
    theme();
    return () => {
      observer.disconnect();
      appearance.disconnect();
      cancelAnimationFrame(raf);
      pressure.current = () => {};
    };
  }, [top]);
  return { canvas, pressure };
}
