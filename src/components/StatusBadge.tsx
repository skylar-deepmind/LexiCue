import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

const STATUS_CONFIG: Record<string, { className: string }> = {
  unprocessed: { className: 'bg-gray-100 text-gray-600' },
  learning: { className: 'bg-blue-100 text-blue-700' },
  known: { className: 'bg-green-100 text-green-700' },
  ignored: { className: 'bg-gray-200 text-gray-400' },
};

interface StatusBadgeProps {
  status: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export default function StatusBadge({ status, onClick }: StatusBadgeProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.unprocessed;
  const label = t(`status.${status}`);

  if (onClick) {
    return (
      <button
          onClick={(e) => {
            e.stopPropagation();
            onClick(e);
        }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors hover:ring-2 hover:ring-offset-1 ${config.className}`}
        title={t('statusBadge.selectTitle')}
      >
        {label}
        <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium select-none ${config.className}`}>
      {label}
    </span>
  );
}

export { STATUS_CONFIG };
