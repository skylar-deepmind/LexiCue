import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { backNavigation } from '../lib/backNavigation';
import { useWorkspaceStore } from '../stores/workspaceStore';

/** Modeless on desktop: only the dedicated blank strip dismisses the card.
 * Original controls remain usable; Tab, Escape and system back retain focus. */
export default function ContextPanel({ label, children, onClose, canClose = true, onClosing }: {
  label: string; children: ReactNode; onClose: () => void; canClose?: boolean; onClosing?: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const identity = useRef(Symbol('context-panel'));
  const callbacks = useRef({ onClose, canClose, onClosing });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
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
  useEffect(() => {
    const panelIdentity=identity.current;
    useWorkspaceStore.getState().add(panelIdentity);
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = backNavigation.register(() => closeRef.current());
    panelRef.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !layerRef.current?.contains(document.activeElement)) return;
      const items = Array.from(layerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,summary,a[href]'))
        .filter(item => item.getClientRects().length > 0);
      if (!items.length) return;
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panelRef.current)) {
        event.preventDefault(); items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault(); items[0].focus();
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      useWorkspaceStore.getState().remove(panelIdentity);
      unregister(); document.removeEventListener('keydown', keys);
      if (timer.current) clearTimeout(timer.current);
      if (previous.current?.isConnected) previous.current.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div className={`context-layer${closing ? ' context-layer--closing' : ''}`} ref={layerRef}>
    <button className="context-blank-return" onClick={requestClose} disabled={!canClose} aria-label={t('savedRecords.collapse')} />
    <aside className="context-panel" role="dialog" aria-label={label} tabIndex={-1} ref={panelRef}>
      <button className="context-mobile-return" onClick={requestClose} disabled={!canClose}><ChevronDown size={18} aria-hidden="true" />{t('savedRecords.collapse')}</button>
      {children}
    </aside>
  </div>, document.body);
}
