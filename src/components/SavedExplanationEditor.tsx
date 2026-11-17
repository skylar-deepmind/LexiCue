import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Overlay from './Overlay';
import './saved-explanation-editor.css';

export default function SavedExplanationEditor({ id, value, busy, error, onChange, onSave, onCancel, returnFocus }: {
  id: string; value: string; busy: boolean; error: string;
  onChange: (text: string) => void; onSave: () => void; onCancel: () => void; returnFocus: () => HTMLElement | null;
}) {
  const { t } = useTranslation(), input = useRef<HTMLTextAreaElement>(null);
  return <Overlay label={t('dictionaryFlow.personalMeaning')} onClose={() => { if (busy) return false; onCancel(); }}
    className="approved-note-dialog" layerClassName="approved-note-layer" returnFocus={returnFocus} initialFocus={() => input.current}>
    <h2>{t('dictionaryFlow.personalMeaning')}</h2>
    <form className="approved-folio-editor" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <label className="sr-only" htmlFor={`note-${id}`}>{t('dictionaryFlow.personalMeaning')}</label>
      <textarea ref={input} id={`note-${id}`} value={value} disabled={busy} onChange={event => onChange(event.target.value)}/>
      {error && <p className="saved-error" role="alert">{error}</p>}
      <div><button className="ui-button" type="button" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
        <button className="ui-button" type="submit" disabled={busy} aria-busy={busy}>{t('savedRecords.saveExplanation')}</button></div>
    </form>
  </Overlay>;
}
