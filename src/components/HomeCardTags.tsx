import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Material } from '../lib/materials';
import { Check, Plus } from 'lucide-react';
import { tagNameKey } from '../lib/tagAppearance';
import type { TagSelection } from '../lib/types';
import { tagErrorMessage } from '../lib/tags';
import { useFileStore } from '../stores/fileStore';
import CardTagChoices from './CardTagChoices';
import { backNavigation } from '../lib/backNavigation';

export default function HomeCardTags({ file, onClose }: { file: Material; onClose: () => void }) {
  const { t } = useTranslation(), tags = useFileStore(state => state.tags), loading = useFileStore(state => state.loadingTags), tagsError = useFileStore(state => state.tagsError);
  const root = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true);
  const [name, setName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = name !== null;
  useLayoutEffect(() => {
    if (!editing || !input.current) return;
    const strip = input.current.closest('.card-tag-options');
    if (strip) strip.scrollLeft = strip.scrollWidth;
    input.current.focus({ preventScroll: true });
  }, [editing]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    const close = () => { if (!pending.current) onClose(); };
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest('.approved-tag-edit') && !root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', key, true);
    const unregister = backNavigation.register(close);
    return () => { mounted.current = false; unregister(); document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  const choose = async (selection: TagSelection) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await useFileStore.getState().setFileTags(file.id, selection); if (mounted.current) onClose(); }
    catch (reason) { if (mounted.current) setError(t(tagErrorMessage(reason, 'tags.saveFailed'))); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const add = () => {
    const value = name?.trim();
    if (!value) return;
    const existing = tags.find(tag => tagNameKey(tag.name) === tagNameKey(value));
    void choose(existing ? { tagIds: [existing.id], newTagNames: [] } : { tagIds: [], newTagNames: [value] });
  };
  const trailing = editing ? <form className="home-create-tag-entry" onSubmit={event => { event.preventDefault(); add(); }}>
    <input ref={input} aria-label={t('tags.namePlaceholder')} placeholder={t('tags.namePlaceholder')} value={name}
      disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => event.stopPropagation()}/>
    <button type="submit" aria-label={t('common.save')} disabled={busy || !name.trim()}><Check size={18} aria-hidden="true"/></button>
  </form> : <button type="button" className="home-create-tag-action" aria-label={t('tags.create')}
    disabled={busy || loading || tagsError} onClick={() => { setError(''); setName(''); }}><Plus size={19} aria-hidden="true"/></button>;
  return <div ref={root} className="home-card-tags" data-no-trash>
    <CardTagChoices tags={tags} selected={file.tags.slice(0, 1).map(tag => tag.id)} onSelect={ids => void choose({ tagIds: ids, newTagNames: [] })} trailing={trailing} autoFocus disabled={busy} loading={loading} error={tagsError} onRetry={() => void useFileStore.getState().loadTags(true)}/>
    {error && <p className="tag-error" role="alert">{error}</p>}
  </div>;
}
