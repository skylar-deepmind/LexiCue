import AppSelect from './AppSelect';
import { useEffect, useId } from 'react';
import { Brain, Download, RefreshCw, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAiStore, OPENAI_PRESETS, DEFAULT_OLLAMA_URL } from '../stores/aiStore';
import { checkAiConnection, ensureAiConnection, getAiConnectionFingerprint } from '../lib/ai';

export default function AnalysisModelPicker() {
  const { t } = useTranslation();
  const id = useId();
  const enabled = useAiStore(state => state.enabled);
  const provider = useAiStore(state => state.provider);
  const baseUrl = useAiStore(state => state.baseUrl);
  const apiKey = useAiStore(state => state.apiKey);
  const model = useAiStore(state => state.model);
  const models = useAiStore(state => state.aiModels);
  const status = useAiStore(state => state.aiStatus);
  const error = useAiStore(state => state.aiError);
  const fingerprint = useAiStore(state => state.aiFingerprint);
  const setModel = useAiStore(state => state.setModel);
  const current = fingerprint === getAiConnectionFingerprint({ provider, baseUrl: baseUrl.trim() || (provider === 'ollama' ? DEFAULT_OLLAMA_URL : ''), apiKey, model });
  const listedModels = current ? models : [];
  const options = [...new Set(model && !listedModels.includes(model) ? [model, ...listedModels] : listedModels)];
  const checking = current && status === 'checking';
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void ensureAiConnection(), 350);
    return () => clearTimeout(timer);
  }, [enabled, provider, baseUrl, apiKey]);
  const service = provider === 'ollama' ? 'Ollama' : OPENAI_PRESETS.find(preset => preset.baseUrl && preset.baseUrl.replace(/\/+$/, '') === baseUrl.trim().replace(/\/+$/, ''))?.label ?? t('settings.ai.custom');

  if (!enabled) return null;

  return (
    <section className="analysis-model-picker" aria-label={t('analysisModel.title')}>
      <div className="analysis-model-picker__controls">
        <label htmlFor={id} className="analysis-model-picker__label"><Brain size={16} aria-hidden="true" />{t('analysisModel.title')}</label>
        <span className="analysis-model-picker__service">{service}</span>
        <AppSelect id={id} className="analysis-model-picker__select" value={model} onChange={setModel} disabled={!enabled || checking}
          aria-describedby={`${id}-hint`} placeholder={t('settings.ai.selectModel')} searchable options={options.map(name => ({ value: name, label: name }))} />
        <button type="button" className="analysis-model-picker__action" onClick={() => void checkAiConnection()} disabled={!enabled || checking} aria-label={t('analysisModel.refresh')} title={t('analysisModel.refresh')}>
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <Link to="/settings#ai-models" className="analysis-model-picker__get"><Download size={16} aria-hidden="true" />{t('gemmaModels.getModels')}</Link>
        <Link to="/settings#ai" className="analysis-model-picker__action" aria-label={t('analysisModel.settings')} title={t('analysisModel.settings')}><Settings2 size={16} aria-hidden="true" /></Link>
      </div>
      <p id={`${id}-hint`} className="analysis-model-picker__hint" role="status">
        {checking ? t('analysisModel.loading') : current && error ? t('analysisModel.loadFailed') : !options.length ? t('analysisModel.empty') : t('analysisModel.nextAnalysis')}
      </p>
    </section>
  );
}
