import { useLayoutEffect, useRef, type RefObject } from 'react';
import { backNavigation, type CloseAction } from '../lib/backNavigation';

const layers: { element: HTMLElement; modal: boolean }[] = [];
const inertBefore = new Map<HTMLElement, boolean>();

function updateInert() {
  for (const [element, value] of inertBefore) element.inert = value;
  inertBefore.clear();
  const modal = layers.findLast(layer => layer.modal);
  if (!modal) return;
  // A portalled child selector may live inside the dialog or in its own body layer.
  const active = layers.slice(layers.indexOf(modal)).map(layer => layer.element);
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || active.some(element => child.contains(element))) continue;
    inertBefore.set(child, child.inert);
    child.inert = true;
  }
}

export function useOverlay(ref: RefObject<HTMLElement | null>, onClose: CloseAction, modal = true, enabled = true) {
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = { element, modal };
    layers.push(layer);
    element.style.setProperty('--overlay-order', String(layers.length));
    element.closest<HTMLElement>('[data-overlay-layer]')?.style.setProperty('--overlay-order', String(layers.length));
    const unregister = backNavigation.register(() => close.current());
    updateInert();
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]',
    )).filter(node => node.tabIndex >= 0 && !node.closest('[inert]') && node.getClientRects().length > 0);
    if (!element.contains(document.activeElement)) (controls()[0] ?? element).focus();
    const keys = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer || event.defaultPrevented) return;
      if (event.key === 'Tab' && !modal) {
        event.preventDefault();
        backNavigation.dismiss();
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Tab' && modal) {
        const items = controls();
        if (!items.length) { event.preventDefault(); element.focus(); return; }
        const first = items[0], last = items.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
      if ((element.getAttribute('role') === 'menu' || element.querySelector('[role="menu"]')) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = controls();
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
          (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      const wasTop = layers.at(-1) === layer;
      unregister(); layers.splice(layers.indexOf(layer), 1); updateInert();
      document.removeEventListener('keydown', keys);
      if (wasTop && previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [ref, modal, enabled]);
}
