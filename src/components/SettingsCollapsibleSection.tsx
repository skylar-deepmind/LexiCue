import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SettingsCollapsibleSectionProps {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  summary: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expandLabel: string;
  collapseLabel: string;
  children: ReactNode;
}

export default function SettingsCollapsibleSection({
  id,
  icon,
  title,
  description,
  summary,
  open,
  onOpenChange,
  expandLabel,
  collapseLabel,
  children,
}: SettingsCollapsibleSectionProps) {
  const contentId = `${id}-content`;

  return (
    <section id={id} data-expanded={open} className="settings-collapsible-section scroll-mt-6 rounded-2xl border shadow-sm">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={contentId}
        className="settings-collapsible-section__trigger flex w-full items-start justify-between gap-4 p-5 text-left transition-colors"
      >
        <span className="flex min-w-0 items-start gap-3">
          {icon}
          <span className="min-w-0">
            <span className="block font-semibold text-gray-900">{title}</span>
            <span className="mt-1 block text-sm text-gray-500">{description}</span>
            <span className="mt-2 block text-xs font-medium text-gray-600">{summary}</span>
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-gray-500">
          {open ? collapseLabel : expandLabel}
          <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>
      {open && <div id={contentId} className="settings-collapsible-section__content border-t p-5">{children}</div>}
    </section>
  );
}
