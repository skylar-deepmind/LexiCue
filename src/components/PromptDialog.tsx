import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface PromptDialogProps {
  title: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function PromptDialog({
  title,
  placeholder,
  initial = '',
  confirmLabel,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="p-5">
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            aria-label={title}
          />
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-100 p-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
