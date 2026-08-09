import { Copy, X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeedbackStore } from '../stores/feedbackStore';

const STYLE_MAP = {
  success: { container: 'border-green-200 bg-green-50 text-green-800', icon: CheckCircle2, iconColor: 'text-green-600' },
  error: { container: 'border-red-200 bg-red-50 text-red-800', icon: AlertCircle, iconColor: 'text-red-600' },
  info: { container: 'border-gray-200 bg-white text-gray-800', icon: Info, iconColor: 'text-gray-400' },
};

export default function ToastHost() {
  const { t } = useTranslation();
  const { messages, dismiss } = useFeedbackStore();

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100vw-2rem)] flex-col gap-2 sm:w-80">
      {messages.map((item) => {
        const style = STYLE_MAP[item.type];
        const Icon = style.icon;
        return (
          <div
            key={item.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${style.container}`}
          >
            <Icon size={17} className={`mt-0.5 shrink-0 ${style.iconColor}`} />
            <span className="flex-1 break-words">{item.message}</span>
            {item.type === 'error' && (
              <button
                onClick={() => navigator.clipboard.writeText(item.message)}
                aria-label={t('toast.copyErrorAria')}
                title={t('toast.copyErrorAria')}
                className="shrink-0 cursor-pointer rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100"
              >
                <Copy size={15} />
              </button>
            )}
            <button
              onClick={() => dismiss(item.id)}
              aria-label={t('toast.closeAria')}
              className="shrink-0 cursor-pointer rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
