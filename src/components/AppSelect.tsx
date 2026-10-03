import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SelectOption { value: string; label: string; disabled?: boolean }
interface Props {
  id?: string; value: string; options: SelectOption[]; onChange: (value: string) => void | Promise<void>;
  placeholder?: string; disabled?: boolean; searchable?: boolean; className?: string;
  'aria-label'?: string; 'aria-describedby'?: string;
}
export default function AppSelect({ id, value, options, onChange, placeholder, disabled, searchable, className = '', ...aria }: Props) {
  const { t } = useTranslation();
  const generated = useId();
  const listId = `${id ?? generated}-options`;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<Element | null>(null);
  const [accessibleLabel, setAccessibleLabel] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(value);
  const [activeInteraction, setActiveInteraction] = useState<'pointer' | 'keyboard' | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const typeAhead = useRef({ text: '', at: 0 });
  const withSearch = searchable ?? options.length > 10;
  const filtered = options.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const enabled = filtered.filter(item => !item.disabled);
  const current = options.find(item => item.value === value);
  const activeValue = enabled.some(item => item.value === active) ? active : enabled[0]?.value;
  const activeIndex = filtered.findIndex(item => item.value === activeValue);
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => { if (!disabled) {
    setPortalRoot(trigger.current?.closest('[role="dialog"]') ?? document.body);
    setAccessibleLabel(trigger.current?.labels?.[0]?.textContent ?? '');
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition(previous => ({ ...previous, width: Math.min(Math.max(0, window.innerWidth - 16), rect.width) }));
    setQuery(''); setActive(value); setActiveInteraction(null); setOpen(true);
  } };
  const choose = (next: string) => { close(); if (next !== value) void onChange(next); };
  const onKeys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = enabled.findIndex(item => item.value === activeValue);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      if (enabled[next]) { setActive(enabled[next].value); setActiveInteraction('keyboard'); }
    } else if (event.key === 'Enter' || event.key === ' ' && event.target !== search.current) {
      event.preventDefault(); if (activeValue !== undefined) choose(activeValue);
    } else if (!withSearch && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const text = event.timeStamp - typeAhead.current.at < 700 ? typeAhead.current.text + event.key : event.key;
      typeAhead.current = { text, at: event.timeStamp };
      const match = enabled.find(item => item.label.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()));
      if (match) { setActive(match.value); setActiveInteraction('keyboard'); }
    }
  };
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const up = below < 240 && above > below;
      const maxHeight = Math.max(80, Math.min(320, up ? above : below));
      const height = Math.min(panel.current?.scrollHeight ?? 320, maxHeight);
      const width = Math.min(Math.max(0, window.innerWidth - 16), rect.width);
      const next = { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: up ? Math.max(8, rect.top - height - 6) : rect.bottom + 6, width, maxHeight };
      setPosition(previous => previous.left === next.left && previous.top === next.top &&
        previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
    };
    update();
    const observer = new ResizeObserver(update);
    if (trigger.current) observer.observe(trigger.current);
    if (panel.current) observer.observe(panel.current);
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) update(); };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); window.removeEventListener('scroll', onScroll, true); };
  }, [open, filtered.length, withSearch]);
  useEffect(() => {
    if (!open) return;
    (withSearch ? search.current : list.current)?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, withSearch]);
  useEffect(() => {
    // A running task may disable an already-open selector; close its external overlay.
    // oxlint-disable-next-line react/set-state-in-effect
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const option = list.current?.children[activeIndex] as HTMLElement | undefined;
    if (option && list.current) {
      if (option.offsetTop < list.current.scrollTop) list.current.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > list.current.scrollTop + list.current.clientHeight)
        list.current.scrollTop = option.offsetTop + option.offsetHeight - list.current.clientHeight;
    }
  }, [open, activeIndex, position.width]);
  const label = aria['aria-label'] ?? (accessibleLabel || placeholder);
  return <>
    <button ref={trigger} id={id} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} disabled={disabled} {...aria}
      className={`app-select ${className}`} onClick={() => open ? close() : show()}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); } }}>
      <span className={!current ? 'app-select__placeholder' : ''} title={current?.label}>{current?.label ?? placeholder ?? t('appSelect.choose')}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && portalRoot && createPortal(<div ref={panel} className="app-select__popover" style={position} onKeyDown={onKeys}>
      {withSearch && <div className="app-select__search"><Search size={15} aria-hidden="true" /><input ref={search} value={query}
        onChange={event => { setQuery(event.target.value); setActiveInteraction(null); }} placeholder={t('appSelect.search')} aria-label={t('appSelect.search')}
        role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined} /></div>}
      <div ref={list} id={listId} className="app-select__list" role="listbox" aria-label={label ?? t('appSelect.choose')}
        tabIndex={-1} aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}>
        {filtered.map((item, index) => <div key={item.value} id={`${listId}-${index}`} role="option" aria-selected={value === item.value}
          aria-disabled={item.disabled || undefined} className={`app-select__option${activeInteraction && activeValue === item.value ? ' is-focused' : ''}${value === item.value ? ' is-selected' : ''}`}
          onPointerMove={() => { if (!item.disabled) { setActive(item.value); setActiveInteraction('pointer'); } }}
          onPointerLeave={() => setActiveInteraction(interaction => interaction === 'pointer' ? null : interaction)}
          onClick={() => !item.disabled && choose(item.value)}>
          <span>{item.label}</span>{value === item.value && <Check size={16} aria-hidden="true" />}
        </div>)}
        {!filtered.length && <p className="app-select__empty" role="status">{t('appSelect.empty')}</p>}
      </div>
    </div>, portalRoot)}
  </>;
}
