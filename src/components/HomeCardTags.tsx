import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Material } from '../lib/materials';
import type { TagSelection } from '../lib/types';
import { tagErrorMessage } from '../lib/tags';
import { useFileStore } from '../stores/fileStore';
import EdgePicker from './EdgePicker';

export default function HomeCardTags({ file }: { file: Material }) {
  const { t } = useTranslation(),
    tags = useFileStore((s) => s.tags),
    loading = useFileStore((s) => s.loadingTags),
    tagsError = useFileStore((s) => s.tagsError);
  const pending = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function choose(value: TagSelection) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await useFileStore.getState().setFileTags(file.id, value);
      return true;
    } catch (reason) {
      setError(t(tagErrorMessage(reason, 'tags.saveFailed')));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <EdgePicker
      tags={tags}
      current={file.tags[0]?.name ?? ''}
      loading={loading}
      disabled={busy}
      error={tagsError ? t('tags.loadFailed') : error}
      retry={tagsError ? () => void useFileStore.getState().loadTags(true) : undefined}
      choose={choose}
    />
  );
}
