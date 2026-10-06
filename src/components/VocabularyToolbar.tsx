import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, X } from 'lucide-react';
import AppSelect from './AppSelect';
import Overlay from './Overlay';
import AnnotationModeSwitch from './AnnotationModeSwitch';
import DisplaySettingsMenu, { DisplaySettingsControls } from './DisplaySettingsMenu';
import type { AnnotationMode } from '../lib/annotation';
import type { WordStatus } from '../lib/types';
interface Props {
  kind: 'word' | 'phrase'; query: string; onQuery: (query: string) => void;
  filter: WordStatus | 'all'; onFilter: (filter: WordStatus | 'all') => void;
  sort: string; onSort: (sort: 'frequency' | 'alpha' | 'recent') => void;
  mode: AnnotationMode; onMode: (mode: AnnotationMode) => void; disabled?: boolean;
  extra?: { value: boolean; onChange: (value: boolean) => void; label: string };
}
const states = ['unprocessed', 'learning', 'known', 'ignored', 'all'] as const;
const sorts = ['frequency', 'alpha', 'recent'] as const;
export default function VocabularyToolbar(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const title = t(p.kind === 'word' ? 'words.title' : 'phrases.title');
  const label = (state: typeof states[number]) => t(state === 'all' ? 'common.all' : `status.${state}`);
  const sortControls = <div className="vocabulary-sort" role="group" aria-label={t('common.sort')}>{sorts.map(sort => <button type="button" className="ui-button" aria-pressed={p.sort === sort} key={sort} onClick={() => p.onSort(sort)}>{t(`sort.${sort}`)}</button>)}</div>;
  const extra = p.extra && <label className="vocabulary-extra"><input type="checkbox" checked={p.extra.value} onChange={event => p.extra!.onChange(event.target.checked)} />{p.extra.label}</label>;
  return <header className="vocabulary-toolbar">
    <div className="vocabulary-toolbar__title"><h1>{title}</h1><div className="vocabulary-desktop"><AnnotationModeSwitch mode={p.mode} onChange={p.onMode} disabled={p.disabled} /><DisplaySettingsMenu /></div></div>
    <input className="vocabulary-search" value={p.query} onChange={event => p.onQuery(event.target.value)} placeholder={t(p.kind === 'word' ? 'words.searchPlaceholder' : 'phrases.searchPlaceholder')} aria-label={t(p.kind === 'word' ? 'words.searchAria' : 'phrases.searchAria')} />
    <div className="vocabulary-toolbar__filters">
      <div className="vocabulary-mobile"><AppSelect value={p.filter} options={states.map(value => ({ value, label: label(value) }))} onChange={value => p.onFilter(value as Props['filter'])} aria-label={t('mobileBrowse.status')} /></div>
      <div className="vocabulary-desktop vocabulary-states" role="group" aria-label={t('mobileBrowse.status')}>{states.map(state => <button className="ui-button" key={state} aria-pressed={state === p.filter} onClick={() => p.onFilter(state)}>{label(state)}</button>)}</div>
      <div className="vocabulary-desktop">{sortControls}{extra}</div>
      <button className="ui-button vocabulary-tools-trigger vocabulary-mobile" aria-expanded={open} onClick={() => setOpen(true)}><SlidersHorizontal size={18} aria-hidden="true" /><span>{t('mobileBrowse.filters')}</span><span className="vocabulary-summary">{t(`sort.${p.sort}`)}</span></button>
    </div>
    {p.extra?.value && <p className="vocabulary-mobile vocabulary-summary">{p.extra.label}</p>}
    {open && <Overlay variant="sheet" label={t('mobileBrowse.filters')} onClose={() => setOpen(false)} className="vocabulary-tools-sheet"><header className="action-sheet__header"><h2>{t('mobileBrowse.filters')}</h2><button className="ui-button ui-button--icon" aria-label={t('common.close')} onClick={() => setOpen(false)}><X size={20} /></button></header><div className="vocabulary-tools-sheet__body">
      <fieldset><legend>{t('common.sort')}</legend>{sortControls}</fieldset>
      {extra && <fieldset><legend>{t('mobileBrowse.options')}</legend>{extra}</fieldset>}
      <fieldset><legend>{t('annotation.mode')}</legend><AnnotationModeSwitch mode={p.mode} disabled={p.disabled} onChange={value => { setOpen(false); p.onMode(value); }} /></fieldset>
      <fieldset><legend>{t('display.title')}</legend><DisplaySettingsControls /></fieldset>
    </div></Overlay>}
  </header>;
}
