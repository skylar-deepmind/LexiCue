import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Clapperboard, FileText, Upload } from 'lucide-react';
import ContextPanel from './ContextPanel';
import { useImportStore } from '../stores/importStore';
import YouTubeImport from './YouTubeImport';
export default function ImportPanel() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const state = useImportStore();
    const [youtube, setYoutube] = useState(false);
    const { open, destination, running, hide, clearDestination } = state;
    useEffect(() => { if (open && destination !== null && !running) {
        if (destination === 'materials') {
            clearDestination();
            navigate('/files');
        }
        else {
            hide();
            navigate(`/files/${destination}`);
        }
    } }, [open, destination, running, hide, clearDestination, navigate]);
    if (!state.open)
        return null;
    const processed = state.items.filter(item => ['created', 'duplicate', 'failed'].includes(item.stage)).length;
    const successes = state.items.filter(item => item.stage === 'created').length;
    const retryable = state.items.some(item => item.stage === 'failed' || item.stage === 'cancelled');
    return <ContextPanel label={t('materials.import')} onClose={state.hide}>
    <header className="import-heading"><h2>{t('materials.import')}</h2></header>
    <div className="import-body">
      {youtube && !state.running ? <YouTubeImport onBack={() => setYoutube(false)}/> : <>
        {!state.running && <div className="material-drop"><Upload size={30} aria-hidden="true"/><h3>{t('materials.drop')}</h3><p>{t('materials.srtOnly')}</p>
          <button className="ui-button saved-primary" onClick={() => void state.choose()}>{t('materials.choose')}</button></div>}
        {state.pickerError && <p className="saved-error" role="alert">{t('materials.errors.failed')}</p>}
        {state.items.length > 0 && <><p className="import-summary" role="status">{state.running ? t(state.stopping ? 'materials.stopping' : 'materials.processing', { done: processed, total: state.items.length }) : t('materials.finished', { count: successes })}</p>
          <progress className="import-progress" max={state.items.length} value={processed} aria-label={t('materials.progress')}/>
          <ul className="import-items">{state.items.map(item => <li key={item.id}><FileText size={18} aria-hidden="true"/><div><strong>{item.name}</strong><small>{t(`materials.stages.${item.stage}`)}</small>{item.error && item.stage === 'failed' && <p className="saved-error" role="alert">{t(`materials.errors.${item.error}`)}</p>}
              {item.result?.outcome === 'duplicate' && <button className="ui-button" onClick={() => { state.hide(); navigate(item.result!.readable ? `/files/${item.result!.file_id}` : `/legacy?fileId=${item.result!.file_id}`); }}>{t('materials.openExisting')}</button>}</div>
            {item.stage === 'created' && <Check className="import-check" size={20} aria-hidden="true"/>}</li>)}</ul></>}
        {state.running ? <button className="ui-button" disabled={state.stopping} onClick={state.cancel}>{t('materials.cancelRemaining')}</button> : <>
          {retryable && <button className="ui-button" onClick={() => void state.retry()}>{t(state.items.some(item => item.error === 'translation_partial') ? 'materials.englishFallback' : 'materials.retryFailed')}</button>}
          <button className="ui-button import-youtube" onClick={() => setYoutube(true)}><Clapperboard size={17} aria-hidden="true"/>{t('materials.youtube')}</button>
        </>}
      </>}
    </div>
  </ContextPanel>;
}
