import { useRef, type PointerEvent, type RefObject } from 'react';

export function useSavedIndexPull(
  region: RefObject<HTMLDivElement | null>,
  panel: RefObject<HTMLDivElement | null>,
  expanded: boolean,
  disabled: boolean,
  onChange: (expanded: boolean) => void,
) {
  const drag = useRef<{ pointer: number; x: number; y: number; height: number; moved: boolean } | null>(null);
  const finish = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    region.current?.removeAttribute('data-pulling');
    region.current?.style.removeProperty('--saved-pull');
    const distance = (event.clientY - active.y) * (expanded ? -1 : 1);
    if (active.moved && !disabled && commit && distance >= Math.min(56, active.height * .4)) onChange(!expanded);
  };

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const height = panel.current?.clientHeight;
      if (disabled || !height || !event.isPrimary || event.button !== 0) return;
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, height, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const active = drag.current;
      const node = region.current;
      if (!active || !node || active.pointer !== event.pointerId) return;
      const distance = event.clientY - active.y;
      if (!active.moved) {
        const sideways = Math.abs(event.clientX - active.x);
        if (sideways >= 8 && sideways > Math.abs(distance)) { finish(event, false); return; }
        if (distance * (expanded ? -1 : 1) < 6) return;
      }
      active.moved = true;
      node.dataset.pulling = '';
      const height = Math.max(0, Math.min(active.height, (expanded ? active.height : 0) + distance));
      node.style.setProperty('--saved-pull', `${height}px`);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => finish(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => finish(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => finish(event, false),
  };
}
