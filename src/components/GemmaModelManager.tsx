import { useEffect, useRef, useState } from 'react';
import { Download, Check, RefreshCw, Cpu, X, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAiStore, DEFAULT_OLLAMA_URL } from '../stores/aiStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { ensureAiConnection, isLocalOllamaUrl } from '../lib/ai';
import { cancelModelDownload, deleteOllamaModel, initializeLocalActivity, localModelOperationsBusy, downloadOllamaModel, loadLocalAiEnvironment, localModelBaseUrl, refreshInstalledModels, selectInstalledOllamaModel, useModelDownloadStore, type ModelRecommendation } from '../stores/modelDownloadStore';

const localUrl = (value: string) => (value.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');

// Ollama registry sizes use decimal bytes; do not label binary GiB as GB.
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = bytes > 0 ? Math.min(4, Math.floor(Math.log10(bytes) / 3)) : 0;
  return `${(bytes / 1000 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function DeleteConfirmation({ model, baseUrl, onCancel, onConfirm }: { model: string; baseUrl: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="model-delete-dialog" onClick={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <div ref={panel} className="model-delete-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="model-delete-title" aria-describedby="model-delete-description"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onCancel(); }
        if (event.key === 'Tab') {
          const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button');
          if (!buttons?.length) return;
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
          else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
        }
      }}>
      <h3 id="model-delete-title">{t('modelManagement.deleteTitle')}</h3>
      <p className="gemma-model-manager__hint">{t('modelManagement.service', { address: baseUrl })}</p>
      <p id="model-delete-description">{t('modelManagement.deleteConfirm', { model })}</p>
      <div className="model-delete-dialog__actions">
        <button ref={cancel} className="ui-button" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="ui-button ui-button--danger" onClick={onConfirm}><Trash2 size={16} aria-hidden="true" />{t('modelManagement.delete')}</button>
      </div>
    </div>
  </div>;
}
function ModelCard({ item, installed, busy, baseUrl }: { item: ModelRecommendation; installed: boolean; busy: boolean; baseUrl: string }) {
  const { t } = useTranslation();
  const [useAfter, setUseAfter] = useState(item.preferred && item.label === '12B');
  const provider = useAiStore(s => s.provider);
  const model = useAiStore(s => s.model);
  const selectedUrl = useAiStore(s => s.baseUrl);
  const selected = provider === 'ollama' && model === item.model && localUrl(selectedUrl) === localUrl(baseUrl);
  return <article className={`gemma-model-card${item.preferred ? ' gemma-model-card--preferred' : ''}${selected ? ' gemma-model-card--selected' : ''}`}>
    <div className="gemma-model-card__heading">
      <h4>Gemma 4 {item.label}</h4>
      {item.preferred && <span className="gemma-model-card__badge">{t('gemmaModels.preferred')}</span>}
      {installed && <span className="gemma-model-card__installed"><Check size={14} aria-hidden="true" />{t('gemmaModels.installed')}</span>}
    </div>
    <p className="gemma-model-card__meta">{item.quantization} · {t('gemmaModels.estimatedSize', { size: formatBytes(item.estimatedBytes) })}</p>
    <p className="gemma-model-card__reason">{t(`gemmaModels.reason.${item.preferred ? 'preferred' : item.recommended ? item.label === 'E2B' || item.label === 'E4B' ? 'lightweight' : 'larger' : 'manual'}`)}</p>
    <div className="gemma-model-card__actions">
      {!installed && <label className="gemma-model-card__checkbox"><input type="checkbox" checked={useAfter} onChange={e => setUseAfter(e.target.checked)} disabled={busy} />{t('gemmaModels.useAfter')}</label>}
      <button type="button" className={`gemma-button${!installed && item.preferred ? ' gemma-button--primary' : ''}`} disabled={busy || selected} onClick={() => installed ? selectInstalledOllamaModel(item.model, baseUrl) : void downloadOllamaModel(item.model, useAfter, baseUrl)}>
        {installed ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        {selected ? t('gemmaModels.selected') : installed ? t('gemmaModels.use') : t('gemmaModels.download')}
      </button>
    </div>
  </article>;
}
function downloadErrorKey(message: string): string {
  if (message.includes('ERR_DOWNLOAD_IDLE_TIMEOUT')) return 'idle';
  if (message.includes('ERR_DOWNLOAD_CONNECTION') || message.includes('ERR_DOWNLOAD_INTERRUPTED')) return 'connection';
  if (message.includes('ERR_DOWNLOAD_BUSY')) return 'busy';
  if (/no space|disk full|空间/i.test(message)) return 'space';
  if (/not found|does not exist|404/i.test(message)) return 'notFound';
  return 'failed';
}
export default function GemmaModelManager() {
  const { t } = useTranslation();
  const environment = useModelDownloadStore(s => s.environment);
  const environmentLoading = useModelDownloadStore(s => s.environmentLoading);
  const environmentError = useModelDownloadStore(s => s.environmentError);
  const installedInfo = useModelDownloadStore(s => s.installedInfo);
  const deletion = useModelDownloadStore(s => s.deletion);
  const deleteFailure = useModelDownloadStore(s => s.deleteFailure);
  const deleteError = useModelDownloadStore(s => s.deleteError);
  const activity = useModelDownloadStore(s => s.activity);
  const selectedModel = useAiStore(s => s.model);
  const [deleteTarget, setDeleteTarget] = useState<{ model: string; baseUrl: string } | null>(null);
  const installedModels = useModelDownloadStore(s => s.installedModels);
  const installedUrl = useModelDownloadStore(s => s.installedUrl);
  const installedError = useModelDownloadStore(s => s.installedError);
  const installedLoading = useModelDownloadStore(s => s.installedLoading);
  const download = useModelDownloadStore(s => s.download);
  const provider = useAiStore(s => s.provider);
  const currentUrl = useAiStore(s => s.baseUrl);
  const savedLocalUrl = useAiStore(s => s.profiles.ollama.baseUrl);
  const baseUrl = localModelBaseUrl();
  const local = isLocalOllamaUrl(baseUrl);
  const busy = download?.status === 'active';
  const deleteBusy = localModelOperationsBusy() || !activity;
  const [showOther, setShowOther] = useState(false);
  useEffect(() => { void loadLocalAiEnvironment(); void initializeLocalActivity(); }, []);
  useEffect(() => { if (!local) return; const timer = setTimeout(() => void ensureAiConnection().then(() => refreshInstalledModels(baseUrl)), 350); return () => clearTimeout(timer); }, [baseUrl, local, provider, currentUrl, savedLocalUrl]);
  const recommended = environment?.models.filter(m => m.recommended) ?? [];
  const others = environment?.models.filter(m => !m.recommended) ?? [];
  const visibleModels = recommended.length ? recommended : others;
  const progress = download?.progress;
  return <section id="ai-models" className="gemma-model-manager" aria-labelledby="gemma-model-title" tabIndex={-1}>
    <div className="gemma-model-manager__heading"><h3 id="gemma-model-title" tabIndex={-1}><Cpu size={18} aria-hidden="true" />{t('gemmaModels.title')}</h3><button type="button" className="gemma-button" onClick={() => { void loadLocalAiEnvironment(true); if (local) void refreshInstalledModels(baseUrl, true); void initializeLocalActivity(); }} disabled={environmentLoading || installedLoading} aria-label={t('gemmaModels.refresh')}><RefreshCw size={16} aria-hidden="true" />{t('gemmaModels.refresh')}</button></div>
    {environmentLoading && !environment && <p role="status">{t('gemmaModels.detecting')}</p>}
    {environment && <p className="gemma-model-manager__device">{environment.cpu ?? t('gemmaModels.unknownCpu')} · {environment.os} {environment.architecture} · {environment.memoryBytes ? t(environment.unifiedMemory ? 'gemmaModels.unifiedMemory' : 'gemmaModels.memory', { size: `${Math.round(environment.memoryBytes / 2 ** 30)} GiB` }) : t('gemmaModels.unknownMemory')}</p>}
    {environmentError && <p className="gemma-model-error" role="alert">{t('gemmaModels.environmentError')}</p>}
    {!local ? <p className="gemma-model-notice">{t('gemmaModels.remote')}</p> : <>
      {environment && !environment.unifiedMemory && <p className="gemma-model-notice">{t('gemmaModels.accelerationUnknown')}</p>}
      {environment && !recommended.length && <p className="gemma-model-notice">{t('gemmaModels.noRecommendation')}</p>}
      <p className="gemma-model-manager__hint">{t('gemmaModels.memoryHint')}</p>
      {installedLoading && <p role="status">{t('gemmaModels.loadingInstalled')}</p>}
      {installedError && <p className="gemma-model-error" role="alert">{t('gemmaModels.serviceUnavailable')}</p>}
      <div className="gemma-model-grid">{visibleModels.map(item => <ModelCard key={item.model} item={item} installed={localUrl(installedUrl) === localUrl(baseUrl) && installedModels.includes(item.model)} busy={Boolean(busy) || Boolean(deletion || activity?.deleting) || installedLoading || Boolean(installedError)} baseUrl={baseUrl} />)}</div>
      {recommended.length > 0 && others.length > 0 && <><button type="button" className="gemma-button gemma-model-manager__more" aria-expanded={showOther} aria-controls="gemma-other-models" onClick={() => setShowOther(!showOther)}>{t(showOther ? 'gemmaModels.hideOther' : 'gemmaModels.showOther')}</button>{showOther && <div id="gemma-other-models" className="gemma-model-grid">{others.map(item => <ModelCard key={item.model} item={item} installed={localUrl(installedUrl) === localUrl(baseUrl) && installedModels.includes(item.model)} busy={Boolean(busy) || Boolean(deletion || activity?.deleting) || installedLoading || Boolean(installedError)} baseUrl={baseUrl} />)}</div>}</>}
      <div className="installed-models">
        <h4>{t('modelManagement.installedTitle')}</h4>
        {!installedLoading && !installedError && installedModels.length === 0 && <p className="gemma-model-manager__hint">{t('modelManagement.empty')}</p>}
        {localUrl(installedUrl) === localUrl(baseUrl) && installedModels.map(name => {
          const info = installedInfo.find(item => item.name === name);
          const selected = provider === 'ollama' && localUrl(currentUrl) === localUrl(baseUrl) && selectedModel === name;
          return <div className="installed-model" key={name}>
            <div className="installed-model__name">{name}<small>{info?.size != null ? formatBytes(info.size) : t('modelManagement.unknownSize')}{selected && ` · ${t('gemmaModels.selected')}`}</small></div>
            <div className="installed-model__actions">
              <button className="ui-button" disabled={selected || Boolean(deletion || activity?.deleting)} onClick={() => selectInstalledOllamaModel(name, baseUrl)}>{selected ? t('gemmaModels.selected') : t('gemmaModels.use')}</button>
              <button className="ui-button ui-button--danger" disabled={deleteBusy} title={deleteBusy ? t('modelManagement.busy') : t('modelManagement.delete')}
                aria-label={t('modelManagement.deleteAria', { model: name })} onClick={() => setDeleteTarget({ model: name, baseUrl })}><Trash2 size={16} aria-hidden="true" />{deletion?.model === name ? t('modelManagement.deleting') : t('modelManagement.delete')}</button>
            </div>
          </div>;
        })}
        {deleteBusy && activity && !deletion && <p className="gemma-model-manager__hint" role="status">{t('modelManagement.busy')}</p>}
        {deletion && <p role="status">{t('modelManagement.deleting')}</p>}
        {deleteError && deleteFailure && localUrl(deleteFailure.baseUrl) === localUrl(baseUrl) && <div>
          <p className="gemma-model-error" role="alert">{t('modelManagement.failed')} {deleteError}</p>
          <button className="ui-button" disabled={deleteBusy} onClick={() => setDeleteTarget(deleteFailure)}>{t('modelManagement.retry')}</button>
        </div>}
      </div>
    </>}
    {deleteTarget && <DeleteConfirmation model={deleteTarget.model} baseUrl={deleteTarget.baseUrl} onCancel={() => setDeleteTarget(null)} onConfirm={() => {
      const target = deleteTarget; setDeleteTarget(null);
      void deleteOllamaModel(target.model, target.baseUrl).then(result => {
        if (result) {
          useFeedbackStore.getState().show(t(result.alreadyAbsent ? 'modelManagement.alreadyAbsent' : 'modelManagement.deleted', { model: target.model }), 'success');
          if (document.activeElement === document.body) document.getElementById('gemma-model-title')?.focus();
        }
      });
    }} />}
    {download && <div className="gemma-download" aria-label={t('gemmaModels.progressTitle')}>
      <div className="gemma-download__heading"><strong>{download.model}</strong><span role="status">{t(`gemmaModels.phase.${download.status === 'active' ? download.cancelRequested ? 'cancelling' : progress?.phase === 'completed' ? 'installing' : progress?.phase ?? 'manifest' : download.status}`)}</span></div>
      {busy && progress?.phase === 'downloading' && progress.total != null && progress.completed != null && <><progress max={progress.total || 1} value={Math.min(progress.completed, progress.total)} aria-label={t('gemmaModels.layerProgress')} /><p>{t('gemmaModels.layerBytes', { completed: formatBytes(progress.completed), total: formatBytes(progress.total) })}{progress.bytesPerSecond != null && progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}</p></>}
      {download.status === 'error' && <p className="gemma-model-error" role="alert">{t(`gemmaModels.error.${downloadErrorKey(download.error)}`)}</p>}
      {download.error && <details className="gemma-download__details"><summary>{t('gemmaModels.errorDetails')}</summary><p>{download.error}</p></details>}
      {download.autoSelected && <p>{t('gemmaModels.nowSelected')}</p>}
      <div className="gemma-download__actions">{busy ? <button type="button" className="gemma-button" onClick={() => void cancelModelDownload()} disabled={download.cancelRequested}><X size={16} aria-hidden="true" />{t('gemmaModels.cancel')}</button> : download.status === 'completed' ? !download.autoSelected && installedModels.includes(download.model) && <button type="button" className="gemma-button" onClick={() => selectInstalledOllamaModel(download.model, download.baseUrl)}>{t('gemmaModels.use')}</button> : <button type="button" className="gemma-button" onClick={() => void downloadOllamaModel(download.model, download.useAfterDownload, download.baseUrl)}>{t('gemmaModels.retry')}</button>}</div>
    </div>}
  </section>;
}
