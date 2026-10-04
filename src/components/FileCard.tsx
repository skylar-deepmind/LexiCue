import { Trash2, FolderInput, Copy, Download, FileText, Captions, Brain, Check, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import LearningProgressRing from './LearningProgressRing';
import PhraseAnalysisActions from './PhraseAnalysisActions';
import { invoke } from '@tauri-apps/api/core';
import { ask, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';
import type { FileRecord } from '../lib/types';
import type { AnalysisDiagnostic, OllamaRetry } from '../stores/ollamaStore';
import { learningIndex } from '../lib/fileProgress';
import type { DeleteJobStatus } from '../stores/fileStore';

interface FileCardProps {
  file: FileRecord;
  folderPath?: string;
  onDelete: (id: number) => void;
  onAnalyze: (id: number, forceRefresh?: boolean) => void;
  onCancel: (id: number) => void;
  onViewAnalysis?: (id: number) => void;
  onMove: (file: FileRecord) => void;
  aiEnabled: boolean;
  analysisProgress?: {
    status: 'processing' | 'completed' | 'error';
    processedSegments: number;
    totalSegments: number;
    percent: number;
    phase?: 'extraction' | 'explanation' | 'saving' | 'completed' | 'error';
    error?: string;
  };
  analysisCompleted: boolean;
  interrupted?: boolean;
  diagnostic?: AnalysisDiagnostic;
  retrying?: OllamaRetry;
  deleteProgress?: DeleteJobStatus;
  onClick: () => void;
}

export default function FileCard({ file, folderPath, onDelete, onAnalyze, onCancel, onViewAnalysis, onMove, aiEnabled, analysisProgress, analysisCompleted, interrupted = false, diagnostic, retrying, deleteProgress, onClick }: FileCardProps) {
  const { t, i18n } = useTranslation();
  const [diagnosticNotice, setDiagnosticNotice] = useState('');
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const Icon = file.type === 'srt' ? Captions : FileText;
  const date = new Date(file.imported_at).toLocaleDateString(i18n.resolvedLanguage ?? 'zh');
  const index = learningIndex(file.word_progress, file.phrase_progress, analysisCompleted);
  const skippedItems = diagnostic?.code === 'COMPLETED' ? diagnostic.totalSkipped : file.phrase_skipped_items;

  const copyDiagnostic = async () => {
    if (!diagnostic) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify({ app: 'LexiCue', ...diagnostic }, null, 2));
      setDiagnosticNotice(t('fileCard.diagnosticCopied'));
    } catch {
      setDiagnosticNotice(t('fileCard.diagnosticActionFailed'));
    }
  };

  const exportDetailedDiagnostic = async () => {
    if (!diagnostic || diagnosticBusy) return;
    setDiagnosticBusy(true);
    try {
      const approved = await ask(t('fileCard.rawDiagnosticWarning'), { title: t('fileCard.exportDiagnostic') });
      if (!approved) return;
      const report = await invoke<string | null>('get_analysis_raw_diagnostic', { fileId: file.id });
      if (!report) { setDiagnosticNotice(t('fileCard.rawDiagnosticUnavailable')); return; }
      const path = await save({ defaultPath: `lexicue-ai-diagnostic-${diagnostic.runId.slice(0, 8)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      await writeTextFile(path, report);
      setDiagnosticNotice(t('fileCard.diagnosticExported'));
    } catch {
      setDiagnosticNotice(t('fileCard.diagnosticActionFailed'));
    } finally {
      setDiagnosticBusy(false);
    }
  };

  const processing = analysisProgress?.status === 'processing';
  const analysisDone = analysisCompleted || analysisProgress?.status === 'completed';
  // Existing jobs remain reachable if AI is switched off while they are running.
  const showAnalysis = aiEnabled || processing || Boolean(onViewAnalysis);
  const analysisLabel = processing
    ? t(analysisProgress.phase === 'extraction' ? 'fileCard.extracting'
      : analysisProgress.phase === 'explanation' ? 'fileCard.explaining'
      : analysisProgress.phase === 'saving' ? 'fileCard.saving' : 'fileCard.analyzing')
    : t(analysisProgress?.status === 'error' ? 'fileCard.analysisFailed'
      : analysisDone ? 'fileCard.analysisComplete' : 'fileCard.analysisLabel');

  return (
    <article onClick={onClick} className="file-card">
      <h3 className="file-card__title">
        <button type="button" className="file-card__open" aria-label={file.name}
          onClick={event => { event.stopPropagation(); onClick(); }}>
          <Icon size={24} className="file-card__icon" aria-hidden="true" />
          <span className="file-card__info">
            <span className="file-card__name">{file.name}</span>
            <span className="file-card__metadata">
              <span>{file.type.toUpperCase()}</span><span>{t('fileCard.segments', { count: file.segment_count })}</span><span>{date}</span>
            </span>
            {folderPath && <span className="file-card__folder" title={folderPath}>
              <FolderInput size={12} aria-hidden="true" /><span>{folderPath}</span>
            </span>}
          </span>
          <span className="ui-tooltip" role="tooltip">{file.name}</span>
        </button>
      </h3>

      <div className="file-card__footer" onClick={event => event.stopPropagation()}>
        <div className="file-card__progress">
          <LearningProgressRing value={index} />
          <div className="file-card__progress-copy">
            <span>{t('fileCard.learningProgress')}</span>
            <small>{t(analysisCompleted ? 'fileCard.wordsAndPhrases' : 'fileCard.wordsOnly')}</small>
          </div>
        </div>
        <div className="file-card__actions">
          <button type="button" onClick={() => onMove(file)} className="ui-button ui-button--icon"
            aria-label={t('fileCard.moveAria', { name: file.name })} title={t('fileCard.moveTitle')}>
            <FolderInput size={20} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onDelete(file.id)} disabled={Boolean(deleteProgress)}
            className="ui-button ui-button--icon ui-button--danger"
            aria-label={t('fileCard.deleteAria', { name: file.name })} title={t('fileCard.deleteTitle')}>
            <Trash2 size={20} aria-hidden="true" />
          </button>
        </div>
      </div>

      {deleteProgress && <div className="file-card__task file-card__task--warning" onClick={event => event.stopPropagation()}>
        <div className="file-card__task-info">
          <span>{t('fileStore.deleting')}</span>
          <span>{t('fileStore.deleteProgress', { completed: deleteProgress.completed_items, total: deleteProgress.total_items })}</span>
        </div>
        <div className="file-card__task-track" role="progressbar" aria-label={t('fileStore.deleting')}
          aria-valuemin={0} aria-valuemax={deleteProgress.total_items || 1} aria-valuenow={Math.min(deleteProgress.completed_items, deleteProgress.total_items || 1)}>
          <div style={{ width: `${deleteProgress.total_items > 0 ? Math.min(100, (deleteProgress.completed_items / deleteProgress.total_items) * 100) : 5}%` }} />
        </div>
      </div>}

      {showAnalysis && <div className="file-card__analysis" onClick={event => event.stopPropagation()}>
        <div className="file-card__analysis-header">
          <span className={`file-card__analysis-label${analysisProgress?.status === 'error' ? ' is-error' : ''}`}>
            {analysisProgress?.status === 'error' ? <TriangleAlert size={16} aria-hidden="true" />
              : analysisDone && !processing ? <Check size={16} aria-hidden="true" /> : <Brain size={16} aria-hidden="true" />}
            {analysisLabel}
          </span>
          <div className="file-card__analysis-actions">
            {processing ? <button type="button" onClick={() => onCancel(file.id)} className="ui-button"
              aria-label={t('fileCard.cancelAria')} title={t('fileCard.cancelAria')}>{t('fileCard.cancel')}</button>
              : aiEnabled && <PhraseAnalysisActions name={file.name} completed={analysisDone}
                interrupted={interrupted || analysisProgress?.status === 'error'} disabled={Boolean(deleteProgress)}
                allowForce={file.language === 'en'} onAnalyze={forceRefresh => onAnalyze(file.id, forceRefresh)} />}
            {onViewAnalysis && <button type="button" className="ui-button file-card__preview"
              onClick={() => onViewAnalysis(file.id)}>{t('analysisPreview.open')}</button>}
          </div>
        </div>

        {processing && <div className="file-card__task file-card__task--analysis">
          <div className="file-card__task-info">
            <span>{analysisProgress.totalSegments > 0
              ? t(file.language === 'en' ? 'fileCard.segmentsProgress' : analysisProgress.phase ? 'fileCard.stepsProgress' : 'fileCard.segmentsProgress', { processed: analysisProgress.processedSegments, total: analysisProgress.totalSegments })
              : t('fileCard.preparing')}</span>
            <span>{Math.round(analysisProgress.percent)}%</span>
          </div>
          <div className="file-card__task-track" role="progressbar" aria-label={analysisLabel}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisProgress.percent}>
            <div style={{ width: `${Math.max(0, Math.min(100, analysisProgress.percent))}%` }} />
          </div>
          {retrying && <p className="file-card__warning">{t('fileCard.retrying', { reason: retrying.reason, attempt: retrying.attempt, maxAttempts: retrying.maxAttempts })}</p>}
        </div>}

        {analysisProgress?.status === 'error' && <div className="file-card__error">
          <p role="alert">{diagnostic
            ? `${t(`fileCard.diagnosticCodes.${diagnostic.code}`, { defaultValue: diagnostic.code })} (${diagnostic.code}${diagnostic.httpStatus ? ` / HTTP ${diagnostic.httpStatus}` : ''}) · ${t('fileCard.diagnosticId', { id: diagnostic.runId.slice(0, 8) })}`
            : analysisProgress.error || t('fileCard.analysisFailed')}</p>
          {diagnostic && <div className="file-card__diagnostic-actions">
            <button type="button" onClick={() => void copyDiagnostic()} className="ui-button ui-button--danger ai-diagnostic-action">
              <Copy size={16} aria-hidden="true" />{t('fileCard.copyDiagnostic')}
            </button>
            {diagnostic.rawAvailable && <button type="button" disabled={diagnosticBusy} onClick={() => void exportDetailedDiagnostic()} className="ui-button ui-button--danger ai-diagnostic-action">
              <Download size={16} aria-hidden="true" />{t('fileCard.exportDiagnostic')}
            </button>}
          </div>}
          {diagnosticNotice && <p role="status">{diagnosticNotice}</p>}
        </div>}
        {analysisDone && skippedItems > 0 && <p className="file-card__warning">{t('fileCard.skippedAiItems', { count: skippedItems })}</p>}
      </div>}
    </article>
  );
}
