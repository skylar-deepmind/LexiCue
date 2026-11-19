import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagInfo } from '../lib/types';
import { useFileStore } from '../stores/fileStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import useTrashDrag from './useTrashDrag';

export default function LibraryCategoryCard({ tag, disabled, children }: { tag?: TagInfo; disabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), { t } = useTranslation();
  useTrashDrag(ref, { id: `category:${tag?.id ?? 'system'}`, label: tag?.name ?? '', disabled: !tag || disabled,
    remove: async () => {
      if (!tag) return false;
      try { await useFileStore.getState().deleteTag(tag.id); return true; }
      catch { useFeedbackStore.getState().show(t('tags.deleteFailed'), 'error'); return false; }
    } });
  return <div ref={ref} className="approved-tag-stack" data-category-card={tag?.id}>{children}</div>;
}
