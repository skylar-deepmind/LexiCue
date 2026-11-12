import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Short feedback anchored above the actual panel, with time to use undo when focused. */
export default function LookupSaveToast({ anchor, pending, onUndo }: { anchor: HTMLElement; pending: boolean; onUndo: () => void }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  const element = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = useRef(false);
  const stop = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
  const arm = useCallback(() => {
    stop();
    if (!pending && !hovering.current && !element.current?.contains(document.activeElement)) timer.current = setTimeout(() => setVisible(false), 1800);
  }, [pending, stop]);
  useEffect(() => { arm(); return stop; }, [arm, stop]);
  useLayoutEffect(() => {
    const panel = anchor.closest<HTMLElement>('.context-panel');
    if (!panel || !visible) return;
    const position = () => {
      const rect = panel.getBoundingClientRect();
      element.current?.style.setProperty('left', `${rect.left + rect.width / 2}px`);
      element.current?.style.setProperty('top', `${Math.max(56, rect.top - 8)}px`);
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(panel);
    panel.addEventListener('lexicue-panel-settled', position);
    window.addEventListener('resize', position);
    return () => { observer.disconnect(); panel.removeEventListener('lexicue-panel-settled', position); window.removeEventListener('resize', position); };
  }, [anchor, visible]);
  return visible ? createPortal(<div ref={element} className="lookup-save-toast" role="status" data-overlay-layer=""
    onPointerEnter={() => { hovering.current = true; stop(); }} onPointerLeave={() => { hovering.current = false; arm(); }}
    onFocusCapture={stop} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) arm(); }}>
    <Check size={20} strokeWidth={1.8} aria-hidden="true"/><span>{t('dictionaryFlow.saveToast')}</span>
    <button data-testid="lookup-undo" type="button" className="ui-button ui-button--icon" aria-label={t('savedRecords.undo')} title={t('savedRecords.undo')} disabled={pending} onClick={onUndo}><Undo2 size={20} strokeWidth={1.8} aria-hidden="true"/></button>
  </div>, document.body) : null;
}
