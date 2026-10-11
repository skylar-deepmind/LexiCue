import { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import type { TagInfo } from '../lib/types';
import Overlay from './Overlay';
import PromptDialog from './PromptDialog';
import { tagErrorMessage } from '../lib/tags';

export default function TagManager({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const tags = useFileStore(state => state.tags);
  const loading = useFileStore(state => state.loadingTags);
  const tagsError = useFileStore(state => state.tagsError);
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState<{ tag?: TagInfo } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const remove = async (tag: TagInfo) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (!await ask(t('tags.deleteConfirm', { name: tag.name }), { title: t('tags.delete'), kind: 'warning', okLabel: t('common.delete'), cancelLabel: t('common.cancel') })) return;
      await useFileStore.getState().deleteTag(tag.id);
    } catch { setError(t('tags.deleteFailed')); }
    finally { pending.current = false; setBusy(false); }
  };
  return <>
    <Overlay label={t('tags.manage')} onClose={() => { if (pending.current) return false; onClose(); return true; }} className="tag-dialog">
      <header className="tag-dialog__header"><h2>{t('tags.manage')}</h2><p>{t('tags.sharedHint')}</p></header>
      <div className="tag-dialog__body">
        <label htmlFor="tag-manager-search">{t('tags.search')}</label>
        <input id="tag-manager-search" className="tag-input" value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" className="ui-button tag-create" disabled={busy} onClick={() => setPrompt({})}><Plus size={16} aria-hidden="true" />{t('tags.create')}</button>
        {tagsError && <p className="tag-error" role="alert">{t('tags.loadFailed')} <button className="ui-button" onClick={() => void useFileStore.getState().loadTags(true)} disabled={loading}>{t('common.retry')}</button></p>}
        {error && <p className="tag-error" role="alert">{error}</p>}
        {loading && <p role="status" className="tag-hint">{t('common.loading')}</p>}
        <ul className="tag-manager__list">
          {tags.filter(tag => tag.name.toLowerCase().includes(query.trim().toLowerCase())).map(tag => <li key={tag.id}>
            <span>{tag.name}</span><button type="button" className="ui-button ui-button--icon" disabled={busy} onClick={() => setPrompt({ tag })} aria-label={t('tags.renameNamed', { name: tag.name })}><Pencil size={18} aria-hidden="true" /></button>
            <button type="button" className="ui-button ui-button--icon ui-button--danger" disabled={busy} onClick={() => void remove(tag)} aria-label={t('tags.deleteNamed', { name: tag.name })}><Trash2 size={18} aria-hidden="true" /></button>
          </li>)}
        </ul>
        {!loading && !tagsError && tags.filter(tag => tag.name.toLowerCase().includes(query.trim().toLowerCase())).length === 0 && <p className="tag-hint">{t(query ? 'tags.noMatch' : 'tags.noTags')}</p>}
      </div>
      <footer className="tag-dialog__footer"><button type="button" className="ui-button" disabled={busy} onClick={onClose}>{t('common.close')}</button></footer>
    </Overlay>
    {prompt && <PromptDialog title={t(prompt.tag ? 'tags.rename' : 'tags.create')} placeholder={t('tags.namePlaceholder')}
      initial={prompt.tag?.name} confirmLabel={t(prompt.tag ? 'tags.rename' : 'tags.create')} onCancel={() => setPrompt(null)}
      errorMessage={error => t(tagErrorMessage(error, 'tags.saveFailed'))}
      onConfirm={async name => {
        if (prompt.tag) await useFileStore.getState().renameTag(prompt.tag.id, name);
        else await useFileStore.getState().createTag(name);
        setPrompt(null); return true;
      }} />}
  </>;
}
