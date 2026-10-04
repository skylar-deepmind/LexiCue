import AdaptiveMenu from './AdaptiveMenu';
import { useTranslation } from 'react-i18next';
import { STATUS_CONFIG } from './StatusBadge';

export interface ContextMenuItem {
  label: string;
  status?: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const { t } = useTranslation();
  return (
    <AdaptiveMenu x={x} y={y} label={t('shell.vocabulary')} onClose={onClose}>
      {items.map((item, i) => {
        const badgeStyle = item.status
          ? STATUS_CONFIG[item.status] ?? STATUS_CONFIG.unprocessed
          : null;

        return (
          <button
            key={i}
            role="menuitem"
            aria-current={item.active ? 'true' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              item.onClick();
              onClose();
            }}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
              item.active
                ? 'bg-blue-50 text-blue-700'
                : item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {badgeStyle && (
              <span className={`inline-block w-2 h-2 rounded-full ${badgeStyle.className.replace('bg-', 'bg-').replace('text-', '').split(' ')[0]}`} />
            )}
            <span>{item.label}</span>
            {item.active && (
              <span className="ml-auto text-blue-500 text-xs">✓</span>
            )}
          </button>
        );
      })}
    </AdaptiveMenu>
  );
}
