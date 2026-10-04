import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Overlay from './Overlay';
import { useOverlay } from './useOverlay';
import { useMediaQuery } from './useMediaQuery';

interface Props {
  children: ReactNode; label: string; onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>; x?: number; y?: number;
}

export default function AdaptiveMenu({ children, label, onClose, anchorRef, x = 8, y = 8 }: Props) {
  const mobile = useMediaQuery('(max-width: 767px)');
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const { t } = useTranslation();
  useOverlay(ref, onClose, false, !mobile);
  useLayoutEffect(() => {
    if (mobile) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      const anchor = anchorRef?.current?.getBoundingClientRect();
      if (!rect) return;
      const left = anchor ? anchor.right - rect.width : x;
      const top = anchor ? anchor.bottom + 6 : y;
      setPosition({ left: Math.max(8, Math.min(left, innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(top, innerHeight - rect.height - 8)) });
    };
    place(); window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [mobile, anchorRef, x, y]);
  useEffect(() => {
    if (mobile) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !anchorRef?.current?.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [mobile, anchorRef, onClose]);
  if (mobile) return <Overlay variant="sheet" label={label} onClose={onClose} className="action-sheet">
    <div className="action-sheet__header"><h2>{label}</h2><button className="ui-button ui-button--icon" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button></div>
    <div role="menu" aria-label={label} className="adaptive-menu">{children}</div>
  </Overlay>;
  return createPortal(<div ref={ref} role="menu" aria-label={label} tabIndex={-1}
    data-overlay-layer="" className="adaptive-menu adaptive-menu--popover" style={position}>{children}</div>, document.body);
}
