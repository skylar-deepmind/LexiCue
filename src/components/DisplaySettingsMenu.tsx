import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import AdaptiveMenu from './AdaptiveMenu';
import { backNavigation } from '../lib/backNavigation';
import { CONTENT_FONT_CATEGORIES, MIN_CONTENT_FONT_SCALE, MAX_CONTENT_FONT_SCALE } from '../lib/contentFontScale';
import { usePreferencesStore, type ContentFontSize } from '../stores/preferencesStore';
import { useRecallStore } from '../stores/recallStore';
import './display-settings.css';

interface DisplaySettingsMenuProps { className?: string; showRecall?: boolean; dock?: boolean; active?: boolean; }

export default function DisplaySettingsMenu(props: DisplaySettingsMenuProps) {
  return props.dock ? <DockDisplaySettingsMenu {...props}/> : <LegacyDisplaySettingsMenu {...props}/>;
}

function DockDisplaySettingsMenu({ className = '', showRecall = true, dock = false, active = true }: DisplaySettingsMenuProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 8, top: 8 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  const keyboard = useRef(false);
  const suppressFocusOpen = useRef(false);
  const pointer = useRef({ x: -1, y: -1, type: 'mouse' });
  const clearClosing = useCallback(() => {
    clearTimeout(closingTimer.current);
    closingTimer.current = undefined;
  }, []);
  const pointerInside = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    const { x, y } = pointer.current;
    const inside = (rect: { left: number; right: number; top: number; bottom: number }) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (!anchor || !panel) return false;
    // The small corridor bridges the trigger and panel, including the mobile placement.
    const corridor = panel.left >= anchor.right
      ? { left: anchor.right, right: panel.left, top: Math.max(anchor.top, panel.top), bottom: Math.min(anchor.bottom, panel.bottom) }
      : panel.bottom <= anchor.top
        ? { left: Math.max(anchor.left, panel.left), right: Math.min(anchor.right, panel.right), top: panel.bottom, bottom: anchor.top }
        : { left: Math.max(anchor.left, panel.left), right: Math.min(anchor.right, panel.right), top: anchor.bottom, bottom: panel.top };
    return inside(anchor) || inside(panel) || inside(corridor);
  }, []);
  const contains = useCallback((target: EventTarget | null) => target instanceof Node &&
    (!!rootRef.current?.contains(target) || !!panelRef.current?.contains(target)), []);
  const closeLater = useCallback(() => {
    if (closingTimer.current !== undefined) return;
    closingTimer.current = setTimeout(() => {
      closingTimer.current = undefined;
      if (dragging.current || pointerInside()) return;
      if (keyboard.current && contains(document.activeElement)) return;
      setOpen(false);
    }, 200);
  }, [pointerInside, contains]);
  const close = useCallback(() => {
    clearClosing();
    dragging.current = false;
    suppressFocusOpen.current = true;
    setOpen(false);
    if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
  }, [clearClosing]);

  useEffect(() => { if (!active) { clearClosing(); setOpen(false); } }, [active, clearClosing]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      if (!triggerRef.current?.getClientRects().length) { setOpen(false); return; }
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      const left = mobile ? anchor.left + anchor.width / 2 - panel.width / 2 : anchor.right + 10;
      const top = mobile ? anchor.top - panel.height - 10 : anchor.top + anchor.height / 2 - panel.height / 2;
      setPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - panel.width - 8)),
        top: Math.max(8, Math.min(top, window.innerHeight - panel.height - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    const track = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY, type: event.pointerType }; };
    const move = (event: PointerEvent) => {
      track(event);
      if (event.pointerType === 'mouse') keyboard.current = false;
      if (!open || event.pointerType !== 'mouse') return;
      if (pointerInside()) clearClosing();
      else if (!dragging.current) closeLater();
    };
    const down = (event: PointerEvent) => {
      track(event);
      keyboard.current = false;
      suppressFocusOpen.current = false;
      if (open && !contains(event.target)) {
        clearClosing(); setOpen(false);
      }
    };
    const up = (event: PointerEvent) => {
      track(event);
      dragging.current = false;
      if (open && event.pointerType === 'mouse' && !pointerInside()) closeLater();
      else clearClosing();
    };
    const cancel = () => { dragging.current = false; if (open) closeLater(); };
    const key = () => { keyboard.current = true; };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('keydown', key, true);
      clearClosing();
    };
  }, [open, pointerInside, clearClosing, closeLater, contains]);
  useEffect(() => open ? backNavigation.register(close) : undefined, [open, close]);

  return <div ref={rootRef} className={`display-settings ${dock ? 'display-settings--dock' : ''} ${className}`}
    onPointerEnter={event => {
      pointer.current = { x: event.clientX, y: event.clientY, type: event.pointerType };
      clearClosing();
      if (event.pointerType === 'mouse') { suppressFocusOpen.current = false; setOpen(true); }
    }}
    onPointerLeave={event => {
      pointer.current = { x: event.clientX, y: event.clientY, type: event.pointerType };
      if (event.pointerType === 'mouse') closeLater();
    }}
    onPointerDownCapture={event => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'range') {
        dragging.current = true; clearClosing();
      }
    }}
    onFocusCapture={() => { if (keyboard.current && !suppressFocusOpen.current) { clearClosing(); setOpen(true); } }}
    onBlurCapture={event => {
      if (!contains(event.relatedTarget)) {
        suppressFocusOpen.current = false;
        if (keyboard.current) { clearClosing(); setOpen(false); } else closeLater();
      }
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab' || !open) return;
      const fields = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)') ?? []);
      if (!event.shiftKey && event.target === triggerRef.current) {
        event.preventDefault(); fields[0]?.focus();
      } else if (event.shiftKey && event.target === fields[0]) {
        event.preventDefault(); triggerRef.current?.focus();
      } else if (!event.shiftKey && event.target === fields.at(-1)) {
        // The panel is portalled out of the transformed dock; preserve its logical Tab order.
        const controls = Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled),textarea:not(:disabled),[tabindex]'))
          .filter(node => node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[inert]') && !panelRef.current?.contains(node));
        const index = controls.indexOf(triggerRef.current!);
        event.preventDefault(); clearClosing(); setOpen(false);
        controls[(index + 1) % controls.length]?.focus();
      }
    }}>
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
      aria-label={t('display.aria')} title={t('display.aria')}
      className={dock ? 'b-dock-control display-settings-trigger' : 'display-settings-trigger'}
      onClick={() => { clearClosing(); setOpen(current => pointer.current.type === 'touch' ? !current : true); }}>
      <span aria-hidden="true">Aa</span>
    </button>
    {active && createPortal(<div ref={panelRef} id={id} role={open ? 'dialog' : undefined} aria-label={t('display.title')} hidden={!open || !active}
      className="display-font-popover" data-overlay-layer="" style={position}>
      <h3>{t('display.title')}</h3>
      <FontScaleControls showRecall={showRecall}/>
    </div>, document.body)}
  </div>;
}

const FONT_SCALE_LABELS = { learning: 'reader.fontLearning', definition: 'reader.fontDefinition', auxiliary: 'reader.fontAuxiliary' } as const;

function FontScaleControls({ showRecall = true }: { showRecall?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const scales = usePreferencesStore(state => state.contentFontScale);
  const setScale = usePreferencesStore(state => state.setContentFontScale);
  const hints = usePreferencesStore(state => state.reencounterHints);
  const setHints = usePreferencesStore(state => state.setReencounterHints);
  const recall = useRecallStore();
  return <div className="display-settings-controls">
    {CONTENT_FONT_CATEGORIES.map(category => <div key={category} className="display-font-field">
      <div><label htmlFor={`${id}-${category}`}>{t(FONT_SCALE_LABELS[category])}</label><output htmlFor={`${id}-${category}`}>{scales[category]}%</output></div>
      <input id={`${id}-${category}`} type="range" min={MIN_CONTENT_FONT_SCALE} max={MAX_CONTENT_FONT_SCALE} step="1"
        data-font-category={category} value={scales[category]} aria-valuetext={`${scales[category]}%`}
        onChange={event => setScale(category, Number(event.target.value))}/>
    </div>)}
    {showRecall && <section className="recall-display-setting">
      <label><input type="checkbox" checked={hints} onChange={event => setHints(event.target.checked)}/><span>{t('recall.hints')}</span></label>
      <p>{t('recall.toggleHint')}</p>
      {recall.error && <div role="alert"><p>{t('recall.indexFailed')}</p><button className="display-retry" onClick={() => void recall.refresh()} disabled={recall.loading}>{t('common.retry')}</button></div>}
    </section>}
  </div>;
}

// Legacy display menus retain their existing controls outside the approved reading toolbar.
const CATEGORIES = [
  ['learning', 'learningTextFontSize', 'setLearningTextFontSize'],
  ['definition', 'definitionFontSize', 'setDefinitionFontSize'],
  ['auxiliary', 'auxiliaryFontSize', 'setAuxiliaryFontSize'],
] as const;

function LegacyDisplaySettingsMenu({ className = '', showRecall = true }: { className?: string; showRecall?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);


  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('display.aria')}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
      >
        <SlidersHorizontal size={15} />
        <span>{t('display.title')}</span>
      </button>
      {open && (
        <AdaptiveMenu anchorRef={rootRef} label={t('display.title')} onClose={() => setOpen(false)}>
          <DisplaySettingsControls showRecall={showRecall}/>
        </AdaptiveMenu>
      )}
    </div>
  );
}

export function DisplaySettingsControls({showRecall = true}:{showRecall?: boolean}) {
  const { t } = useTranslation();
  const preferences = usePreferencesStore();
  const recall=useRecallStore();
  return <div className="display-settings-controls">{CATEGORIES.map(([category, valueKey, setterKey]) => {
            const value = preferences[valueKey] as ContentFontSize;
            const setValue = preferences[setterKey] as (size: ContentFontSize) => void;
            return (
              <div key={category} className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
                <span className="text-gray-500">{t(`display.categories.${category}`)}</span>
                <div className="flex gap-1">
                  {(['sm', 'md', 'lg'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setValue(size)}
                      aria-pressed={value === size}
                      className={`rounded px-2 py-1 transition-colors ${value === size ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {t(`display.sizes.${size}`)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}{showRecall&&<section className="recall-display-setting"><label><input type="checkbox" checked={preferences.reencounterHints} onChange={event=>preferences.setReencounterHints(event.target.checked)}/><span>{t('recall.hints')}</span></label>
          <p>{t('recall.toggleHint')}</p>{recall.error&&<div role="alert"><p>{t('recall.indexFailed')}</p><button className="ui-button" onClick={()=>void recall.refresh()} disabled={recall.loading}>{t('common.retry')}</button></div>}</section>}</div>;
}
