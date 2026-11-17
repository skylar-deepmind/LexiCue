import { Check, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagInfo } from '../lib/types';
import { tagErrorMessage } from '../lib/tags';
import { useFileStore } from '../stores/fileStore';

/** Pointer hold edits the caption in place; keyboard activation has the same result. */
export default function InlineTagName({ tag, displayName, onRename, editing, onEdit, onFinish }: { tag?: TagInfo; displayName?: string; onRename?: (name: string) => void | Promise<void>; editing: boolean; onEdit: () => void; onFinish: () => void }) {
  const { t } = useTranslation(), input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined), start = useRef<{ x: number; y: number } | null>(null), pending = useRef(false);
  const initialName = tag?.name ?? displayName ?? '';
  const [name, setName] = useState(initialName), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const clear = () => { clearTimeout(hold.current); start.current = null; };
  useLayoutEffect(() => {
    if (editing) { setName(initialName); setError(''); input.current?.focus({ preventScroll: true }); input.current?.select(); input.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    return clear;
  }, [editing, initialName]);
  const finish = () => { onFinish(); requestAnimationFrame(() => button.current?.focus({ preventScroll: true })); };
  const save = async () => {
    if (pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try { if (onRename) await onRename(name); else if (tag) await useFileStore.getState().renameTag(tag.id, name); else await useFileStore.getState().createTag(name); finish(); }
    catch (reason) { setError(t(tagErrorMessage(reason, 'tags.saveFailed'))); }
    finally { pending.current = false; setBusy(false); }
  };
  const begin = (x: number, y: number) => { clear(); start.current = { x, y }; hold.current = setTimeout(onEdit, 420); };
  const move = (x: number, y: number) => { if (start.current && Math.hypot(x - start.current.x, y - start.current.y) > 8) clear(); };
  return editing ? <form className="approved-tag-name-editor" data-no-trash aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
    <input ref={input} aria-label={t(tag || onRename ? 'tags.rename' : 'tags.create')} value={name} maxLength={100} disabled={busy} onChange={event => setName(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) finish(); }
      }}/>
    <div><button type="button" className="approved-icon" disabled={busy} aria-label={t('common.cancel')} onClick={finish}><X size={17} aria-hidden="true"/></button><button className="approved-icon" disabled={busy || !name.trim()} aria-label={t('common.save')} aria-busy={busy}><Check size={18} aria-hidden="true"/></button></div>
    {error && <p className="tag-error" role="alert">{error}</p>}
  </form> : <button ref={button} className="approved-tag-name" data-no-trash aria-label={t('tags.renameNamed', { name: initialName })}
    onPointerDown={event => { event.stopPropagation(); if (event.pointerType !== 'touch' && event.button === 0) begin(event.clientX, event.clientY); }}
    onPointerMove={event => { event.stopPropagation(); if (event.pointerType !== 'touch') move(event.clientX, event.clientY); }}
    onPointerUp={event => { if (event.pointerType !== 'touch') clear(); }} onPointerCancel={event => { if (event.pointerType !== 'touch') clear(); }} onPointerLeave={event => { if (event.pointerType !== 'touch') clear(); }}
    onTouchStart={event => { event.stopPropagation(); if (event.touches.length === 1) begin(event.touches[0].clientX, event.touches[0].clientY); else clear(); }}
    onTouchMove={event => { if (event.touches.length === 1) move(event.touches[0].clientX, event.touches[0].clientY); }} onTouchEnd={clear} onTouchCancel={clear} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) onEdit(); }}><strong>{initialName}</strong></button>;
}
