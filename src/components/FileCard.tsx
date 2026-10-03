import { Trash2, FolderInput, Copy, Download } from 'lucide-react';
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
  const icon = file.type === 'srt' ? '🎬' : '📄';
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

  return (
    <div
      onClick={onClick}
      className="file-card bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="shrink-0 text-2xl">{icon}</span>
          <div className="min-w-0 flex-1">
            <h3 className="file-card__title font-medium text-gray-900 text-sm"><button type="button" className="file-card__open" aria-label={file.name}
              onClick={event => { event.stopPropagation(); onClick(); }}><span className="file-card__name">{file.name}</span><span className="ui-tooltip" role="tooltip">{file.name}</span></button></h3>
            <p className="file-card__metadata text-xs text-gray-500 mt-0.5">
              <span>{file.type.toUpperCase()}</span><span>{t('fileCard.segments', { count: file.segment_count })}</span><span>{date}</span>
            </p>
            {folderPath && (
              <p className="mt-1 flex items-center gap-1 text-xs text-gray-400" title={folderPath}>
                <FolderInput size={11} className="shrink-0" />
                <span className="truncate">{folderPath}</span>
              </p>
            )}
          </div>
        </div>

      </div>
      {deleteProgress && (
        <div className="mt-3 border-t border-gray-100 pt-3" onClick={(event) => event.stopPropagation()}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-amber-700">
            <span>{t('fileStore.deleting')}</span>
            <span>{t('fileStore.deleteProgress', { completed: deleteProgress.completed_items, total: deleteProgress.total_items })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-amber-100" role="progressbar" aria-valuemin={0} aria-valuemax={deleteProgress.total_items || 1} aria-valuenow={Math.min(deleteProgress.completed_items, deleteProgress.total_items || 1)}>
            <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${deleteProgress.total_items > 0 ? Math.min(100, (deleteProgress.completed_items / deleteProgress.total_items) * 100) : 5}%` }} />
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-400">{t('fileCard.learningProgress')}</span>
        <LearningProgressRing value={index} />
      </div>
      {!analysisCompleted && <p className="mt-1 text-right text-[11px] text-gray-400">{t('fileCard.wordsOnlyPending')}</p>}
      {aiEnabled && analysisCompleted && !analysisProgress && (
        <p className="mt-3 text-xs text-green-700">{t('fileCard.aiDone')}</p>
      )}
      {aiEnabled && analysisProgress?.status === 'error' && (
        <div className="mt-3 text-xs text-red-600" onClick={(event) => event.stopPropagation()}>
          <p role="alert">{t('fileCard.analysisFailed')}{diagnostic
            ? ` · ${t(`fileCard.diagnosticCodes.${diagnostic.code}`, { defaultValue: diagnostic.code })} (${diagnostic.code}${diagnostic.httpStatus ? ` / HTTP ${diagnostic.httpStatus}` : ''}) · ${t('fileCard.diagnosticId', { id: diagnostic.runId.slice(0, 8) })}`
            : analysisProgress.error ? `：${analysisProgress.error}` : ''}</p>
          {diagnostic && <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyDiagnostic()} className="ai-diagnostic-action inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50"><Copy size={13} />{t('fileCard.copyDiagnostic')}</button>
            {diagnostic.rawAvailable && <button type="button" disabled={diagnosticBusy} onClick={() => void exportDetailedDiagnostic()} className="ai-diagnostic-action inline-flex items-center gap-1 rounded px-2 py-1 text-red-600 hover:bg-red-50"><Download size={13} />{t('fileCard.exportDiagnostic')}</button>}
          </div>}
          {diagnosticNotice && <p className="mt-1" role="status">{diagnosticNotice}</p>}
        </div>
      )}
      {aiEnabled && analysisProgress?.status === 'completed' && (
        <p className="mt-3 text-xs text-green-700">{t('fileCard.aiDone')}</p>
      )}
      {onViewAnalysis && <button type="button" className="analysis-preview__button mt-2" onClick={event => { event.stopPropagation(); onViewAnalysis(file.id); }}>{t('analysisPreview.open')}</button>}
      {aiEnabled && analysisCompleted && skippedItems > 0 && (
        <p className="mt-1 text-xs text-amber-700">{t('fileCard.skippedAiItems', { count: skippedItems })}</p>
      )}
      {aiEnabled && analysisProgress?.status === 'processing' && (
        <div className="mt-3" onClick={(event) => event.stopPropagation()}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-purple-700">
            <span>{analysisProgress.phase === 'extraction' ? t('fileCard.extracting') : analysisProgress.phase === 'explanation' ? t('fileCard.explaining') : analysisProgress.phase === 'saving' ? t('fileCard.saving') : t('fileCard.analyzing')}</span>
            <span className="flex items-center gap-2">
              {analysisProgress.totalSegments > 0
                ? t(file.language === 'en' ? 'fileCard.segmentsProgress' : analysisProgress.phase ? 'fileCard.stepsProgress' : 'fileCard.segmentsProgress', { processed: analysisProgress.processedSegments, total: analysisProgress.totalSegments })
                : t('fileCard.preparing')}
              <button
                onClick={() => onCancel(file.id)}
                                className="rounded border border-purple-200 px-1.5 py-0.5 text-purple-700 transition-colors hover:bg-purple-50 disabled:opacity-50"
                aria-label={t('fileCard.cancelAria')}
                title={t('fileCard.cancelAria')}
              >
                {t('fileCard.cancel')}
              </button>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-purple-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={analysisProgress.percent}>
            <div className="h-full rounded-full bg-purple-500 transition-[width] duration-300" style={{ width: `${analysisProgress.percent}%` }} />
          </div>
          {retrying && (
            <p className="mt-1 text-xs text-amber-600">
              {t('fileCard.retrying', { reason: retrying.reason, attempt: retrying.attempt, maxAttempts: retrying.maxAttempts })}
            </p>
          )}
        </div>
      )}
        <div className="file-card__actions">
          {aiEnabled && (
            <PhraseAnalysisActions
              name={file.name}
              completed={analysisCompleted}
              interrupted={interrupted || analysisProgress?.status === 'error'}
              processing={analysisProgress?.status === 'processing'}
              disabled={analysisProgress?.status === 'processing' || Boolean(deleteProgress)}
              allowForce={file.language === 'en'}
              onAnalyze={(forceRefresh) => onAnalyze(file.id, forceRefresh)}
            />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMove(file);
            }}
            className="ui-button ui-button--icon"
            aria-label={t('fileCard.moveAria', { name: file.name })}
            title={t('fileCard.moveTitle')}
          >
            <FolderInput size={16} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file.id);
            }}
            disabled={Boolean(deleteProgress)}
            className="ui-button ui-button--icon ui-button--danger"
            aria-label={t('fileCard.deleteAria', { name: file.name })}
            title={t('fileCard.deleteTitle')}
          >
            <Trash2 size={16} />
          </button>
        </div>
    </div>
  );
}
