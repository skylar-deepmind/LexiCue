import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import type { FileRecord, TagSelection } from '../lib/types';
import Overlay from './Overlay';
import TagPicker from './TagPicker';
import { tagErrorMessage } from '../lib/tags';

export default function TagEditDialog({ file, onClose }: { file: FileRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const tags = useFileStore(state => state.tags);
  const loading = useFileStore(state => state.loadingTags);
  const tagsError = useFileStore(state => state.tagsError);
  const loadTags = useFileStore(state => state.loadTags);
  const [value, setValue] = useState<TagSelection>({ tagIds: file.tags.map(tag => tag.id), newTagNames: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const close = () => { if (pending.current) return false; onClose(); return true; };
  const save = async () => {
    if (pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      await useFileStore.getState().setFileTags(file.id, value);
      onClose();
    } catch (error) { setError(t(tagErrorMessage(error, 'tags.saveFailed'))); }
    finally { pending.current = false; setSaving(false); }
  };
  return <Overlay label={t('tags.edit')} onClose={close} className="tag-dialog">
    <header className="tag-dialog__header"><h2>{t('tags.edit')}</h2><p title={file.name}>{file.name}</p></header>
    <div className="tag-dialog__body"><TagPicker tags={tags} value={value} onChange={setValue} disabled={saving}
      loading={loading} error={tagsError} onRetry={() => void loadTags(true)} />
      {error && <p className="tag-error" role="alert">{error}</p>}
    </div>
    <footer className="tag-dialog__footer"><button type="button" className="ui-button" onClick={close} disabled={saving}>{t('common.cancel')}</button>
      <button type="button" className="ui-button tag-primary" disabled={saving || loading} onClick={() => void save()}>{t(saving ? 'tags.saving' : 'common.save')}</button></footer>
  </Overlay>;
}
