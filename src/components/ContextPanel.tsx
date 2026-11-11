import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { associatedGuide } from '../lib/guideFocus';
import { backNavigation } from '../lib/backNavigation';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useQuietScrollbars } from './useQuietScrollbars';
import { createLookupScrollMotion } from '../lib/lookupMotion';

/** Modeless: unused space dismisses the card without covering reading or controls.
 * Dragging, selection, scrolling and other dialogs retain their normal behavior. */
export default function ContextPanel({ label, children, onClose, canClose = true, onClosing, interactionKey, layoutSlot }: {
  label: string; children: ReactNode; onClose: () => void; canClose?: boolean; onClosing?: () => void; interactionKey?: unknown;
  layoutSlot?: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  useQuietScrollbars(panelRef, !!layoutSlot);
  const previous = useRef<HTMLElement | null>(null);
  const identity = useRef(Symbol('context-panel'));
  const callbacks = useRef({ onClose, canClose, onClosing });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Only move the original when the half sheet would cover the selected sentence.
  useLayoutEffect(() => {
    if (!layoutSlot || expanded || closing || !matchMedia('(max-width: 767px)').matches) return;
    const scroll=layoutSlot.current?.closest<HTMLElement>('.reader-scroll');
    if(!scroll)return;
    const motion=createLookupScrollMotion(scroll);
    const frame = requestAnimationFrame(() => {
      const word=scroll.querySelector<HTMLElement>('.reading-word[aria-pressed="true"]');
      const sentence = word?.closest<HTMLElement>('.reading-sentence');
      const panel = panelRef.current;
      if (!sentence || !word || !panel || !layerRef.current) return;
      const top = scroll.getBoundingClientRect().top + 12;
      // Measure the final sheet edge, independently of its entering transform.
      const bottom = Math.min(scroll.getBoundingClientRect().bottom,layerRef.current.getBoundingClientRect().bottom-panel.offsetHeight)-16;
      const sentenceRect=sentence.getBoundingClientRect();
      const rect=sentenceRect.height<=bottom-top ? sentenceRect : word.getBoundingClientRect();
      const delta=rect.top<top ? rect.top-top : rect.bottom>bottom ? rect.bottom-bottom : 0;
      if(delta)motion.move(scroll.scrollTop+delta,matchMedia('(prefers-reduced-motion: reduce)').matches);
    });
    const cancel=()=>motion.cancel();
    scroll.addEventListener('touchmove',cancel,{passive:true});scroll.addEventListener('wheel',cancel,{passive:true});
    return () => {cancelAnimationFrame(frame);motion.cancel();scroll.removeEventListener('touchmove',cancel);scroll.removeEventListener('wheel',cancel);};
  }, [interactionKey, expanded, closing, layoutSlot]);
  const lastInteraction = useRef(interactionKey);
  const markReadingClosing = useCallback((value: boolean) => {
    const layout = layoutSlot?.current?.closest<HTMLElement>('.reading-layout');
    if (layout) layout.dataset.queryClosing = String(value);
  }, [layoutSlot]);
  useLayoutEffect(() => {
    const slot = layoutSlot?.current, panel = panelRef.current;
    const viewport = slot?.closest('.reader-scroll');
    if (!slot || !panel || !viewport) return;
    const update = () => {
      const rect = slot.getBoundingClientRect();
      const columns = rect.width > 0;
      panel.dataset.readingLayout = columns ? 'columns' : 'overlay';
      panel.style.setProperty('--reading-slot-left', `${rect.left}px`);
      panel.style.setProperty('--reading-slot-width', `${rect.width}px`);
      panel.style.setProperty('--reading-slot-top', `${viewport.getBoundingClientRect().top + (columns ? 100 : 8)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(slot); observer.observe(viewport);
    slot.addEventListener('reading-layout', update);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); slot.removeEventListener('reading-layout', update); window.removeEventListener('resize', update); };
  }, [layoutSlot]);
  // Animate the paper and card on one timeline; interrupted closes resume from the visible frame.
  useLayoutEffect(() => {
    const panel = panelRef.current, layout = layoutSlot?.current?.closest<HTMLElement>('.reading-layout');
    const paper = layout?.querySelector<HTMLElement>('.reading-paper');
    if (!panel || !layout || !paper) return;
    const desktop = layout.dataset.desktop === 'true';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const shift = getComputedStyle(layout).getPropertyValue('--reading-paper-shift').trim() || '0px';
    const initial = !panel.dataset.motionStarted;
    panel.dataset.motionStarted = 'true';
    const fromPaper = initial ? `translateX(${desktop ? shift : '0px'})` : getComputedStyle(paper).transform;
    const fromCard = initial ? desktop ? `translateX(${shift})` : 'translateY(100%)' : getComputedStyle(panel).transform;
    const opacity = desktop ? initial ? '0' : getComputedStyle(panel).opacity : '1';
    const target = closing ? desktop ? `translateX(${shift})` : 'translateY(100%)' : desktop ? 'translateX(0)' : 'translateY(0)';
    const targetOpacity=desktop&&closing?'0':'1';
    const finish = () => { paper.style.transform = desktop ? target : 'none'; panel.style.transform = target; panel.style.opacity = targetOpacity; delete layout.dataset.lookupMoving; };
    if (reduced.matches) { finish(); return; }
    layout.dataset.lookupMoving = 'true';
    const options: KeyframeAnimationOptions = { duration: desktop ? (closing ? 340 : 420) : (closing ? 300 : 360), easing:'cubic-bezier(.22,1,.36,1)', fill:'both' };
    const animations = [panel.animate([{transform:fromCard,opacity},{transform:target,opacity:targetOpacity}], options)];
    if (desktop) animations.push(paper.animate([{transform:fromPaper},{transform:target}],options));
    const start = document.timeline.currentTime; if (typeof start === 'number') animations.forEach(a => { a.startTime = start; });
    void Promise.all(animations.map(a => a.finished)).then(finish, () => {});
    const settle = () => animations.forEach(a => a.finish());
    const reduce = () => { if (reduced.matches) settle(); };
    window.addEventListener('resize', settle); reduced.addEventListener('change', reduce);
    return () => {
      const cardTransform=getComputedStyle(panel).transform, cardOpacity=getComputedStyle(panel).opacity, paperTransform=getComputedStyle(paper).transform;
      animations.forEach(a=>a.cancel()); delete layout.dataset.lookupMoving; panel.style.transform=cardTransform; panel.style.opacity=cardOpacity; paper.style.transform=desktop?paperTransform:'none';
      window.removeEventListener('resize', settle); reduced.removeEventListener('change', reduce);
    };
  }, [closing, layoutSlot]);
  useEffect(() => () => { const paper=layoutSlot?.current?.closest('.reading-layout')?.querySelector<HTMLElement>('.reading-paper'); paper?.style.removeProperty('transform'); }, [layoutSlot]);
  useLayoutEffect(() => { callbacks.current = { onClose, canClose, onClosing }; });
  const requestClose = () => {
    if (!callbacks.current.canClose || timer.current) return false;
    markReadingClosing(true);
    setClosing(true);
    useWorkspaceStore.getState().remove(identity.current);
    callbacks.current.onClosing?.();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : innerWidth<768 ? 300 : 340;
    timer.current = setTimeout(() => callbacks.current.onClose(), duration);
    return true;
  };
  const closeRef = useRef(requestClose);
  useLayoutEffect(() => { closeRef.current = requestClose; });
  useLayoutEffect(() => {
    if (lastInteraction.current === interactionKey) return;
    lastInteraction.current = interactionKey;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; markReadingClosing(false); setClosing(false); useWorkspaceStore.getState().add(identity.current); }
    if (document.activeElement instanceof HTMLElement && !layerRef.current?.contains(document.activeElement)) previous.current = document.activeElement;
  }, [interactionKey, markReadingClosing]);
  useEffect(() => {
    const panelIdentity=identity.current;
    useWorkspaceStore.getState().add(panelIdentity);
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unregister = backNavigation.register(() => closeRef.current());
    panelRef.current?.focus({ preventScroll: true });
    const keys = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !layerRef.current || !layerRef.current.contains(document.activeElement)&&!associatedGuide(layerRef.current)?.contains(document.activeElement)) return;
      const items = [layerRef.current,associatedGuide(layerRef.current)].filter((root):root is HTMLElement=>!!root).flatMap(root=>Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,summary,a[href]')))
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
      if (target.closest('[data-app-guide]') || event.composedPath().includes(layerRef.current as EventTarget) || layerRef.current?.contains(target) || document.querySelector('[aria-modal="true"]') || [...document.querySelectorAll('.context-layer')].at(-1) !== layerRef.current) return;
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
    <aside className="context-panel" role="dialog" aria-label={label} tabIndex={-1} ref={panelRef} data-expanded={expanded} data-closing={closing || undefined} inert={closing} aria-hidden={closing || undefined}>
      <div className="context-sheet-controls">
        <button className="context-mobile-return" onClick={requestClose} disabled={!canClose} aria-label={t('savedRecords.collapse')}><ChevronDown size={18} aria-hidden="true" /></button>
        {layoutSlot && <button className="context-sheet-expand" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label={t(expanded ? 'reader.halfSheet' : 'reader.fullSheet')}>{expanded ? <Minimize2 size={18} aria-hidden="true"/> : <Maximize2 size={18} aria-hidden="true"/>}</button>}
      </div>{layoutSlot && <button data-testid="lookup-close" className="lookup-close" onClick={requestClose} disabled={!canClose} aria-label={t('common.close')}><X size={20}/></button>}
      {children}
    </aside>
  </div>, document.body);
}
