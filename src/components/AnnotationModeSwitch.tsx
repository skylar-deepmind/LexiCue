import { Layers, RectangleHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AnnotationMode } from '../lib/annotation';

export default function AnnotationModeSwitch({ mode, onChange, disabled = false }: {
  mode: AnnotationMode; onChange: (mode: AnnotationMode) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="annotation-mode" role="group" aria-label={t('annotation.mode')}>
    {(['batch', 'single'] as const).map(value => <button key={value} type="button"
      aria-pressed={mode === value} disabled={disabled} onClick={() => onChange(value)}>
      {value === 'batch' ? <Layers size={16} aria-hidden="true" /> : <RectangleHorizontal size={16} aria-hidden="true" />}
      {t(`annotation.${value}`)}
    </button>)}
  </div>;
}
