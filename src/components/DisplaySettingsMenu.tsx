import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreferencesStore, type ContentFontSize } from '../stores/preferencesStore';

const CATEGORIES = [
  ['learning', 'learningTextFontSize', 'setLearningTextFontSize'],
  ['definition', 'definitionFontSize', 'setDefinitionFontSize'],
  ['auxiliary', 'auxiliaryFontSize', 'setAuxiliaryFontSize'],
] as const;

export default function DisplaySettingsMenu({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const preferences = usePreferencesStore();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('display.aria')}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 transition-colors hover:bg-gray-50"
      >
        <SlidersHorizontal size={15} />
        <span>{t('display.title')}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-[236px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          {CATEGORIES.map(([category, valueKey, setterKey]) => {
            const value = preferences[valueKey] as ContentFontSize;
            const setValue = preferences[setterKey] as (size: ContentFontSize) => void;
            return (
              <div key={category} className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs">
                <span className="text-gray-500">{t(`display.categories.${category}`)}</span>
                <div className="flex gap-1">
                  {(['sm', 'md', 'lg'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setValue(size)}
                      aria-pressed={value === size}
                      className={`rounded px-2 py-1 transition-colors ${value === size ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {t(`display.sizes.${size}`)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
