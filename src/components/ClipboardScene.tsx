import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './useOverlay';
import type { CloseAction } from '../lib/backNavigation';

/** A full-page task state, with focus/back ownership and no floating dialog. */
export default function ClipboardScene({children,label,onClose,returnFocus}:{children:ReactNode;label:string;onClose:CloseAction;returnFocus:()=>HTMLElement|null}) {
  const ref=useRef<HTMLDivElement>(null);
  useOverlay(ref,onClose,true,true,returnFocus);
  return createPortal(<div className="clipboard-scene-layer">
    <div ref={ref} className="clipboard-scene" role="region" aria-label={label} tabIndex={-1}>{children}</div>
  </div>,document.body);
}
