import { useLibraryNames } from './useLibraryNames';
import { Check } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagInfo } from '../lib/types';
import { BusyRing } from './LoadingFeedback';
import './card-tags.css';

/** One horizontal strip for both the import card and the card already on the desk. */
export default function CardTagChoices({ tags, selected, onSelect, disabled, loading, error, onRetry, autoFocus = false }: {
  tags: TagInfo[]; selected: number[]; onSelect: (ids: number[]) => void;
  disabled?: boolean; loading?: boolean; error?: boolean; onRetry?: () => void; autoFocus?: boolean;
}) {
  const { t } = useTranslation(), strip = useRef<HTMLDivElement>(null);
  const libraryNames = useLibraryNames();
  useLayoutEffect(() => {
    if (autoFocus && !loading) strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [autoFocus, loading]);
  return <div className="card-tag-choices">
    <div ref={strip} className="card-tag-options" role="listbox" aria-label={t('tags.choose')} aria-busy={loading || disabled || undefined}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
        const index = options.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        options[next]?.focus({ preventScroll: true }); options[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }}>
      {[...tags, { id: null, name: libraryNames.untagged }].map(tag => {
        const active = tag.id === null ? !selected.length : selected.includes(tag.id);
        return <button type="button" role="option" aria-selected={active} tabIndex={active ? 0 : -1} disabled={disabled || loading} key={tag.id ?? 'untagged'}
          onClick={() => onSelect(tag.id === null ? [] : [tag.id])}>{tag.name}{active && <Check size={14} aria-hidden="true"/>}</button>;
      })}
      {loading && <span role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></span>}
    </div>
    {error && <p className="tag-error" role="alert">{t('tags.loadFailed')} <button className="ui-button" onClick={onRetry}>{t('common.retry')}</button></p>}
  </div>;
}
