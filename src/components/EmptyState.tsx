import { type LucideIcon, FolderOpen, Search, BookOpen, ChartNoAxesCombined, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon | string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon = FolderOpen, title, description, action }: EmptyStateProps) {
  const Icon = typeof icon === 'string'
    ? ({ '🔎': Search, '📖': BookOpen, '📚': BookOpen, '📊': ChartNoAxesCombined, '📭': Inbox, '📂': FolderOpen, '🎉': ChartNoAxesCombined }[icon] ?? FolderOpen)
    : icon;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="empty-state-icon mb-4 grid size-14 place-items-center rounded-2xl"><Icon size={26} strokeWidth={1.7} aria-hidden="true" /></div>
      <h3 className="ui-section-title mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="ui-button ui-button-primary mt-4"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
