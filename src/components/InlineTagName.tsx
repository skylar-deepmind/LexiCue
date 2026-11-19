import { Check } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { tagErrorMessage } from '../lib/tags';

interface Props {
  name: string;
  onRename: (name: string) => void | Promise<void>;
  editing: boolean;
  onEdit: () => void;
  onFinish: () => void;
}

export default function InlineTagName({ name, onRename, editing, onEdit, onFinish }: Props) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null), caption = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [draft, setDraft] = useState(name), [busy, setBusy] = useState(false), [error, setError] = useState('');

  useLayoutEffect(() => {
    if (!editing) return;
    const field = input.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.select();
    // Center the snap target so an edge card's complete input and confirm stay visible.
    field.closest('.approved-tag-group')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
  }, [editing]);

  const finish = () => {
    onFinish();
    requestAnimationFrame(() => caption.current?.focus({ preventScroll: true }));
  };
  const save = async () => {
    const next = draft.trim();
    if (pending.current || !next) return;
    if (next === name) { finish(); return; }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await onRename(next);
      finish();
    } catch (reason) {
      setError(t(tagErrorMessage(reason, 'tags.saveFailed')));
      input.current?.focus({ preventScroll: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return editing ? <div className="approved-tag-name-editor" data-no-trash aria-busy={busy}
    onBlur={event => { if (!pending.current && !event.currentTarget.contains(event.relatedTarget)) onFinish(); }}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        if (!pending.current) finish();
      }
    }}>
    <div className="approved-tag-name-field">
      <input ref={input} aria-label={t('tags.rename')} value={draft} maxLength={100} readOnly={busy}
        onChange={event => { setDraft(event.target.value); setError(''); }}/>
      <button type="button" className="approved-icon" disabled={busy || !draft.trim()} aria-label={t('common.save')}
        onPointerDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={() => void save()}>
        <Check size={18} aria-hidden="true"/>
      </button>
    </div>
    {error && <p className="tag-error" role="alert">{error}</p>}
  </div> : <button ref={caption} type="button" className="approved-tag-name" data-no-trash
    aria-label={t('tags.renameNamed', { name })} onClick={() => {
      setDraft(name);
      setError('');
      // Mount and focus during the tap so WebKit opens the software keyboard.
      flushSync(onEdit);
    }}>
    <strong>{name}</strong>
  </button>;
}
