import { Check, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagInfo } from '../lib/types';
import { tagErrorMessage } from '../lib/tags';
import { useFileStore } from '../stores/fileStore';

/** Pointer hold edits the caption in place; keyboard activation has the same result. */
export default function InlineTagName({ tag, editing, onEdit, onFinish }: { tag?: TagInfo; editing: boolean; onEdit: () => void; onFinish: () => void }) {
  const { t } = useTranslation(), input = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined), start = useRef<{ x: number; y: number } | null>(null), pending = useRef(false);
  const [name, setName] = useState(tag?.name ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const clear = () => { clearTimeout(hold.current); start.current = null; };
  useLayoutEffect(() => {
    if (editing) { setName(tag?.name ?? ''); setError(''); input.current?.focus({ preventScroll: true }); input.current?.select(); input.current?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    return clear;
  }, [editing, tag?.name]);
  const finish = () => { onFinish(); requestAnimationFrame(() => button.current?.focus({ preventScroll: true })); };
  const save = async () => {
    if (pending.current || !name.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try { if (tag) await useFileStore.getState().renameTag(tag.id, name); else await useFileStore.getState().createTag(name); finish(); }
    catch (reason) { setError(t(tagErrorMessage(reason, 'tags.saveFailed'))); }
    finally { pending.current = false; setBusy(false); }
  };
  return editing ? <form className="approved-tag-name-editor" aria-busy={busy} onSubmit={event => { event.preventDefault(); void save(); }}>
    <input ref={input} aria-label={t(tag ? 'tags.rename' : 'tags.create')} value={name} maxLength={100} disabled={busy} onChange={event => setName(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending.current) finish(); }
      }}/>
    <div><button type="button" className="approved-icon" disabled={busy} aria-label={t('common.cancel')} onClick={finish}><X size={17} aria-hidden="true"/></button><button className="approved-icon" disabled={busy || !name.trim()} aria-label={t('common.save')} aria-busy={busy}><Check size={18} aria-hidden="true"/></button></div>
    {error && <p className="tag-error" role="alert">{error}</p>}
  </form> : <button ref={button} className="approved-tag-name" aria-label={t('tags.renameNamed', { name: tag?.name })}
    onPointerDown={event => { if (event.button !== 0) return; clear(); start.current = { x: event.clientX, y: event.clientY }; hold.current = setTimeout(onEdit, 450); }}
    onPointerMove={event => { if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 7) clear(); }}
    onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) onEdit(); }}><strong>{tag?.name}</strong></button>;
}
