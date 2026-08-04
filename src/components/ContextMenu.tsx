import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const padding = 8;
    const left = Math.min(x, Math.max(padding, window.innerWidth - rect.width - padding));
    const top = Math.min(y, Math.max(padding, window.innerHeight - rect.height - padding));
    setPosition({ left, top });
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 100 }}
      className="bg-white rounded-xl shadow-lg border border-gray-200 py-1 min-w-[140px]"
    >
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
    </div>
  );
}
