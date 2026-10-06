import Overlay from './Overlay';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PromptDialogProps {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  onConfirm: (value: string) => boolean | Promise<boolean>;
  onCancel: () => void;
  errorMessage?: (error: unknown) => string;
}

export default function PromptDialog({
  title,
  placeholder,
  initial = '',
  confirmLabel,
  onConfirm,
  onCancel,
  errorMessage,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorText, setErrorText] = useState('');
  const pending = useRef(false);
  const cancel = () => { if (pending.current) return false; onCancel(); return true; };

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || pending.current) return;
    pending.current = true; setSaving(true); setFailed(false); setErrorText('');
    try { setFailed(!await onConfirm(trimmed)); }
    catch (error) { setFailed(true); setErrorText(errorMessage?.(error) ?? t('shell.saveFailed')); }
    finally { pending.current = false; setSaving(false); }
  };

  return (
    <Overlay label={title} onClose={cancel} className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="p-5">
          <input
            autoFocus
            disabled={saving}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            aria-label={title}
          />
          {failed && <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--sync-error-text)' }}>{errorText || t('shell.saveFailed')}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-100 p-4">
          <button onClick={cancel} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!value.trim() || saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {confirmLabel}
          </button>
        </div>
    </Overlay>
  );
}
