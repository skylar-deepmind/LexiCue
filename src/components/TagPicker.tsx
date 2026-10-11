import { useId, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TagInfo, TagSelection } from '../lib/types';

interface Props {
  tags: TagInfo[];
  value: TagSelection;
  onChange: (value: TagSelection) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
}

export default function TagPicker({ tags, value, onChange, disabled, loading, error, onRetry }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const key = (name: string) => name.trim().toLowerCase();
  const normalized = key(query);
  const visible = tags.filter(tag => key(tag.name).includes(normalized));
  const selected = (tag: TagInfo) => value.tagIds.includes(tag.id) || value.newTagNames.some(name => key(name) === key(tag.name));
  const toggle = (tag: TagInfo) => onChange({
    tagIds: selected(tag) ? value.tagIds.filter(id => id !== tag.id) : [...value.tagIds, tag.id],
    newTagNames: value.newTagNames.filter(name => key(name) !== key(tag.name)),
  });
  const add = () => {
    const name = query.trim();
    if (!name || disabled) return;
    const existing = tags.find(tag => key(tag.name) === key(name));
    if (existing) {
      if (!selected(existing)) toggle(existing);
    } else if (!value.newTagNames.some(item => key(item) === key(name))) {
      onChange({ ...value, newTagNames: [...value.newTagNames, name] });
    }
    setQuery('');
  };
  const canCreate = normalized && !tags.some(tag => key(tag.name) === normalized) && !value.newTagNames.some(name => key(name) === normalized);
  return <section className="tag-picker" aria-labelledby={`${id}-label`}>
    <label id={`${id}-label`} htmlFor={id}>{t('tags.choose')}</label>
    <p className="tag-hint">{t('tags.optionalHint')}</p>
    <div className="tag-picker__selected" aria-label={t('tags.selected')}>
      {value.tagIds.map(tagId => <button type="button" className="tag-chip tag-chip--value" disabled={disabled} key={tagId}
        onClick={() => onChange({ ...value, tagIds: value.tagIds.filter(id => id !== tagId) })}
        aria-label={t('tags.removeNamed', { name: tags.find(tag => tag.id === tagId)?.name ?? t('tags.unavailableTag') })}>
        <span>{tags.find(tag => tag.id === tagId)?.name ?? t('tags.unavailableTag')}</span><X size={14} aria-hidden="true" />
      </button>)}
      {value.newTagNames.map(name => <button type="button" className="tag-chip tag-chip--value" key={name} disabled={disabled}
        onClick={() => onChange({ ...value, newTagNames: value.newTagNames.filter(item => item !== name) })}
        aria-label={t('tags.removeNamed', { name })}><span>{name}</span><small>{t('tags.new')}</small><X size={14} aria-hidden="true" /></button>)}
      {value.tagIds.length + value.newTagNames.length === 0 && <span className="tag-hint">{t('tags.noneSelected')}</span>}
    </div>
    <input id={id} className="tag-input" value={query} disabled={disabled} placeholder={t('tags.searchOrCreate')}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); add(); }
      }} />
    {error && <p role="alert" className="tag-error">{t('tags.loadFailed')} <button type="button" className="ui-button" onClick={onRetry} disabled={disabled || loading}>{t('common.retry')}</button></p>}
    {loading && <p role="status" className="tag-hint">{t('common.loading')}</p>}
    <div className="tag-picker__options" aria-label={t('tags.existing')}>
      {visible.map(tag => <button type="button" key={tag.id} className="tag-chip" aria-pressed={selected(tag)} disabled={disabled}
        onClick={() => toggle(tag)}>{selected(tag) && <Check size={15} aria-hidden="true" />}<span>{tag.name}</span></button>)}
      {!loading && !error && visible.length === 0 && <span className="tag-hint">{t(query ? 'tags.noMatch' : 'tags.noTags')}</span>}
    </div>
    {canCreate && <button type="button" className="ui-button tag-create" onClick={add} disabled={disabled}>
      <Plus size={16} aria-hidden="true" />{t('tags.createNamed', { name: query.trim() })}
    </button>}
  </section>;
}
