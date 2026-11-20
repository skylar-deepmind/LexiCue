import { useRef, type PointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  region: RefObject<HTMLDivElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  handle: RefObject<HTMLButtonElement | null>;
  heading: RefObject<HTMLHeadingElement | null>;
  expression?: string;
  expanded: boolean;
  disabled: boolean;
  onChange: (expanded: boolean) => void;
};

export default function SavedIndexPull({ region, panel, handle, heading, expression, expanded, disabled, onChange }: Props) {
  const { t } = useTranslation();
  const drag = useRef<{ pointer: number; y: number; height: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    region.current?.removeAttribute('data-pulling');
    region.current?.style.removeProperty('--saved-pull');
    if (!active.moved) return;
    suppressClick.current = true;
    const distance = (event.clientY - active.y) * (expanded ? -1 : 1);
    if (!disabled && commit && distance >= Math.min(56, active.height * .4)) onChange(!expanded);
  };

  return <div className="saved-index-strip" onPointerDown={event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    const height = panel.current?.clientHeight;
    if (disabled || !height) return;
    drag.current = { pointer: event.pointerId, y: event.clientY, height, moved: false };
    (event.target as Element).setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const active = drag.current;
    const node = region.current;
    if (!active || !node || active.pointer !== event.pointerId) return;
    const distance = event.clientY - active.y;
    if (!active.moved && Math.abs(distance) < 6) return;
    active.moved = true;
    node.dataset.pulling = '';
    node.style.setProperty('--saved-pull', `${Math.max(0, Math.min(active.height, (expanded ? active.height : 0) + distance))}px`);
  }} onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
    {expanded ? <h1 ref={heading} tabIndex={-1}>{t('savedRecords.wordIndex')}</h1> : <span lang="en">{expression}</span>}
    <button ref={handle} type="button" className="approved-index-toggle" aria-expanded={expanded} aria-controls="saved-word-index"
      aria-label={t(expanded ? 'savedRecords.closeWords' : 'savedRecords.browseWords')} disabled={disabled} onClick={event => {
        if (!suppressClick.current || event.detail === 0) onChange(!expanded);
        suppressClick.current = false;
      }}><span aria-hidden="true"/></button>
  </div>;
}
