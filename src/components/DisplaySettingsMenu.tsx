import AdaptiveMenu from './AdaptiveMenu';
import { SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
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
        <AdaptiveMenu anchorRef={rootRef} label={t('display.title')} onClose={() => setOpen(false)}>
          <DisplaySettingsControls />
        </AdaptiveMenu>
      )}
    </div>
  );
}

export function DisplaySettingsControls() {
  const { t } = useTranslation();
  const preferences = usePreferencesStore();
  return <div className="display-settings-controls">{CATEGORIES.map(([category, valueKey, setterKey]) => {
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
          })}</div>;
}
