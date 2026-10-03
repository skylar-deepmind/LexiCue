import { useEffect, useRef, type RefObject } from 'react';

/** Keep portalled selectors in the owning dialog's keyboard focus cycle. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0);
    if (!root.contains(document.activeElement)) (root.querySelector<HTMLInputElement>('input:not(:disabled)') ?? controls()[0])?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); if (previous?.isConnected) previous.focus(); };
  }, [ref]);
}
