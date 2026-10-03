import { Brain, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModelDownloadStore } from '../stores/modelDownloadStore';
import { isLocalOllamaUrl } from '../lib/ai';
import { useAiStore } from '../stores/aiStore';

import { analysisAction } from '../lib/analysisAction';

export default function PhraseAnalysisActions({ name, completed, disabled, allowForce, interrupted = false, processing = false, onAnalyze }: {
  name: string; completed: boolean; disabled: boolean; allowForce: boolean; interrupted?: boolean; processing?: boolean;
  onAnalyze: (force: boolean) => void;
}) {
  const { t } = useTranslation();
  const deleting = useModelDownloadStore(s => Boolean(s.deletion || s.activity?.deleting));
  const baseUrl = useAiStore(s => s.baseUrl);
  const action = analysisAction(completed, interrupted, allowForce);
  const label = t(`fileCard.${processing ? 'analyzing' : action.label}`);
  return <button type="button" className="ui-button file-analysis-button" disabled={disabled || deleting && isLocalOllamaUrl(baseUrl)}
    aria-label={`${label} · ${name}`} title={action.force ? t('fileCard.forceReanalyzeHint') : label}
    onClick={event => { event.stopPropagation(); onAnalyze(action.force); }}>
    {completed || interrupted ? <RefreshCw size={16} aria-hidden="true" /> : <Brain size={16} aria-hidden="true" />}{label}
  </button>;
}
