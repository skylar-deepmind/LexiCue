import { useLayoutEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './saved-explanation-editor.css';

export default function SavedExplanationEditor({ id, value, busy, error, onChange, onSave, onCancel, returnFocus }: {
  id: string; value: string; busy: boolean; error: string;
  onChange: (text: string) => void; onSave: () => void; onCancel: () => void; returnFocus: () => HTMLElement | null;
}) {
  const { t } = useTranslation(), input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = input.current; if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
    const reveal = () => requestAnimationFrame(() => node.closest('form')?.scrollIntoView({ block: 'nearest', behavior: 'auto' }));
    reveal(); window.visualViewport?.addEventListener('resize', reveal);
    return () => window.visualViewport?.removeEventListener('resize', reveal);
  }, []);
  useLayoutEffect(() => {
    const node = input.current; if (!node) return;
    node.style.height = 'auto'; node.style.height = `${Math.max(44, node.scrollHeight)}px`;
  }, [value]);
  const cancel = () => { onCancel(); requestAnimationFrame(() => returnFocus()?.focus({ preventScroll: true })); };
  return <form className="approved-folio-editor approved-inline-note" data-no-trash aria-busy={busy} onSubmit={event => { event.preventDefault(); onSave(); }}>
    <label htmlFor={`note-${id}`}>{t('dictionaryFlow.personalMeaning')}：</label>
    <textarea rows={1} ref={input} id={`note-${id}`} value={value} disabled={busy} onChange={event => onChange(event.target.value)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel(); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); onSave(); } }}/>
    {error && <p className="saved-error" role="alert">{error}</p>}
    <div><button className="approved-icon" type="button" disabled={busy} onClick={cancel} aria-label={t('common.cancel')}><X size={19} aria-hidden="true"/></button>
      <button className="approved-icon" type="submit" disabled={busy} aria-busy={busy} aria-label={t('savedRecords.saveExplanation')}><Check size={20} aria-hidden="true"/></button></div>
  </form>;
}
