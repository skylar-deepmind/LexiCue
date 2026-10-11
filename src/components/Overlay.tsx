import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CloseAction } from '../lib/backNavigation';
import { useOverlay } from './useOverlay';

interface Props {
  children: ReactNode;
  onClose: CloseAction;
  label: string;
  variant?: 'dialog' | 'detail' | 'sheet';
  className?: string;
  panelRef?: RefObject<HTMLDivElement | null>;
}

/** Body portal: background inertness and focus ownership are shared across all dialogs. */
export default function Overlay({ children, onClose, label, variant = 'dialog', className = '', panelRef }: Props) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? ownRef;
  const closing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const requestClose = async () => {
    if (closing.current) return false;
    closing.current = true;
    try { return await onClose(); } finally { closing.current = false; }
  };
  useOverlay(ref, requestClose);
  return createPortal(
    <div className={`overlay-layer overlay-layer--${variant}${expanded ? ' is-expanded' : ''}`} data-overlay-layer="">
      <div className="overlay-scrim" onClick={() => void requestClose().catch(() => {})} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={`overlay-panel ${className}`}>
        {variant === 'detail' && <div className="detail-sheet-control">
          <span className="detail-sheet-handle" aria-hidden="true" />
          <button className="ui-button ui-button--icon" onClick={() => setExpanded(value => !value)}
            aria-label={t(expanded ? 'shell.collapseDetail' : 'shell.expandDetail')} aria-expanded={expanded}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>}
        {children}
      </div>
    </div>, document.body,
  );
}
