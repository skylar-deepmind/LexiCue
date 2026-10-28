import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { backNavigation } from '../lib/backNavigation';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** Modeless: unused space dismisses the card without covering reading or controls.
 * Dragging, selection, scrolling and other dialogs retain their normal behavior. */
export default function ContextPanel({ label, children, onClose, canClose = true, onClosing, interactionKey }: {
  label: string; children: ReactNode; onClose: () => void; canClose?: boolean; onClosing?: () => void; interactionKey?: unknown;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const identity = useRef(Symbol('context-panel'));
  const callbacks = useRef({ onClose, canClose, onClosing });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const lastInteraction = useRef(interactionKey);
  useLayoutEffect(() => { callbacks.current = { onClose, canClose, onClosing }; });
  const requestClose = () => {
    if (!callbacks.current.canClose || timer.current) return false;
    setClosing(true);
    useWorkspaceStore.getState().remove(identity.current);
    callbacks.current.onClosing?.();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 340;
    timer.current = setTimeout(() => callbacks.current.onClose(), duration);
    return true;
  };
  const closeRef = useRef(requestClose);
  useLayoutEffect(() => { closeRef.current = requestClose; });
  useLayoutEffect(() => {
    if (lastInteraction.current === interactionKey) return;
    lastInteraction.current = interactionKey;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; setClosing(false); useWorkspaceStore.getState().add(identity.current); }
    if (document.activeElement instanceof HTMLElement && !layerRef.current?.contains(document.activeElement)) previous.current = document.activeElement;
  }, [interactionKey]);
  useEffect(() => {
    const panelIdentity=identity.current;
    useWorkspaceStore.getState().add(panelIdentity);
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = backNavigation.register(() => closeRef.current());
    panelRef.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !layerRef.current?.contains(document.activeElement)) return;
      const items = Array.from(layerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,summary,a[href]'))
        .filter(item => item.getClientRects().length > 0 && !item.closest('[inert],[aria-hidden="true"]') && getComputedStyle(item).visibility !== 'hidden');
      if (!items.length) return;
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panelRef.current)) {
        event.preventDefault(); items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault(); items[0].focus();
      }
    };
    document.addEventListener('keydown', keys);
    let pointer: { x: number; y: number; moved: boolean } | null = null;
    const down = (event: PointerEvent) => { pointer = event.button === 0 ? { x: event.clientX, y: event.clientY, moved: false } : null; };
    const move = (event: PointerEvent) => { if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 5) pointer.moved = true; };
    const outside = (event: MouseEvent) => {
      const target = event.target;
      // Later clicks in a multi-click gesture may land on newly exposed blank
      // space while the reading column makes room. They are not dismissals.
      // A panel opened by pointerup did not observe that gesture's pointerdown.
      // Its trailing click must not immediately dismiss the newly opened card.
      if (!(target instanceof Element) || event.defaultPrevented || event.button !== 0 || event.detail > 1 || !pointer || pointer.moved) return;
      // React can replace an icon during this click (play → stop). The original
      // SVG target is then detached, while the gesture's composed path still
      // identifies the panel that received it.
      if (event.composedPath().includes(layerRef.current as EventTarget) || layerRef.current?.contains(target) || document.querySelector('[aria-modal="true"]') || [...document.querySelectorAll('.context-layer')].at(-1) !== layerRef.current) return;
      if (target.closest('button,a[href],input,textarea,select,label,summary,audio,video,[role="button"],[role="tab"],[role="menuitem"],[data-overlay-layer],[contenteditable]:not([contenteditable="false"])')) return;
      // A native scrollbar is a control even though it has no DOM button.
      for (let node: Element | null = target; node; node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        if (node instanceof HTMLElement && (node.offsetWidth > node.clientWidth + 2 && event.clientX >= rect.left + node.clientWidth || node.offsetHeight > node.clientHeight + 2 && event.clientY >= rect.top + node.clientHeight)) return;
      }
      closeRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('click', outside);
    return () => {
      useWorkspaceStore.getState().remove(panelIdentity);
      unregister(); document.removeEventListener('keydown', keys);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('click', outside);
      if (timer.current) clearTimeout(timer.current);
      if (previous.current?.isConnected) previous.current.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className={`context-layer${closing ? ' context-layer--closing' : ''}`} ref={layerRef}>
    <aside className="context-panel" role="dialog" aria-label={label} tabIndex={-1} ref={panelRef}>
      <button className="context-mobile-return" onClick={requestClose} disabled={!canClose}><ChevronDown size={18} aria-hidden="true" />{t('savedRecords.collapse')}</button>
      {children}
    </aside>
  </div>, document.body);
}
