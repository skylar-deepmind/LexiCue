import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Material } from '../lib/materials';
import { tagErrorMessage } from '../lib/tags';
import { useFileStore } from '../stores/fileStore';
import CardTagChoices from './CardTagChoices';
import { backNavigation } from '../lib/backNavigation';

export default function HomeCardTags({ file, onClose }: { file: Material; onClose: () => void }) {
  const { t } = useTranslation(), tags = useFileStore(state => state.tags), loading = useFileStore(state => state.loadingTags), tagsError = useFileStore(state => state.tagsError);
  const root = useRef<HTMLDivElement>(null), pending = useRef(false), mounted = useRef(true);
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
  const choose = async (ids: number[]) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await useFileStore.getState().setFileTags(file.id, { tagIds: ids, newTagNames: [] }); if (mounted.current) onClose(); }
    catch (reason) { if (mounted.current) setError(t(tagErrorMessage(reason, 'tags.saveFailed'))); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div ref={root} className="home-card-tags" data-no-trash>
    <CardTagChoices tags={tags} selected={file.tags.slice(0, 1).map(tag => tag.id)} onSelect={ids => void choose(ids)} autoFocus disabled={busy} loading={loading} error={tagsError} onRetry={() => void useFileStore.getState().loadTags(true)}/>
    {error && <p className="tag-error" role="alert">{error}</p>}
  </div>;
}
