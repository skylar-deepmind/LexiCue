import { Brain, Trash2, FolderInput, FileText, Captions } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileRecord } from '../lib/types';
import type { OllamaRetry } from '../stores/ollamaStore';
import { learningIndex, learningStage } from '../lib/fileProgress';

interface FileCardProps {
  file: FileRecord;
  folderPath?: string;
  onDelete: (id: number) => void;
  onAnalyze: (id: number) => void;
  onCancel: (id: number) => void;
  onMove: (file: FileRecord) => void;
  aiEnabled: boolean;
  analysisProgress?: {
    status: 'processing' | 'completed' | 'error';
    processedSegments: number;
    totalSegments: number;
    percent: number;
  };
  analysisCompleted: boolean;
  retrying?: OllamaRetry;
  onClick: () => void;
}

export default function FileCard({ file, folderPath, onDelete, onAnalyze, onCancel, onMove, aiEnabled, analysisProgress, analysisCompleted, retrying, onClick }: FileCardProps) {
  const { t, i18n } = useTranslation();
  const TypeIcon = file.type === 'srt' ? Captions : FileText;
  const date = new Date(file.imported_at).toLocaleDateString(i18n.resolvedLanguage ?? 'zh');
  const index = learningIndex(file.word_progress, file.phrase_progress, analysisCompleted);
  const stage = learningStage(index);

  return (
    <article className="ui-card file-card p-4 transition-all hover:border-blue-300 hover:shadow-sm" aria-busy={analysisProgress?.status === 'processing' || undefined}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button onClick={onClick} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left" aria-label={t('fileCard.openAria', { name: file.name })}>
          <span className="file-card-icon grid size-10 shrink-0 place-items-center rounded-xl"><TypeIcon size={19} strokeWidth={1.7} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h3 className="break-words font-medium text-gray-900 text-sm" title={file.name}>{file.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {file.type.toUpperCase()} · {t('fileCard.segments', { count: file.segment_count })} · {date}
            </p>
            {folderPath && (
              <p className="mt-1 flex items-center gap-1 text-xs text-gray-400" title={folderPath}>
                <FolderInput size={11} className="shrink-0" />
                <span className="truncate">{folderPath}</span>
              </p>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {aiEnabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze(file.id);
              }}
              disabled={analysisCompleted || Boolean(analysisProgress)}
              className="ui-icon-button size-9 min-h-9 min-w-9 text-gray-400 hover:text-purple-600 disabled:cursor-wait disabled:opacity-50"
              aria-label={t('fileCard.analyzeAria', { name: file.name })}
              title={analysisCompleted ? t('fileCard.analyzedTitle') : t('fileCard.analyzeTitle')}
            >
              <Brain size={16} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMove(file);
            }}
            className="ui-icon-button size-9 min-h-9 min-w-9 text-gray-400 hover:text-blue-600"
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
            className="ui-icon-button size-9 min-h-9 min-w-9 text-gray-400 hover:text-red-500"
            aria-label={t('fileCard.deleteAria', { name: file.name })}
            title={t('fileCard.deleteTitle')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div
        className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3"
        aria-label={index === null ? t('fileCard.noLearningContent') : t('fileCard.learningProgressAria', { stage: t(`fileCard.stage.${stage}`) })}
      >
        <span className="text-xs text-gray-400">{t('fileCard.learningProgress')}</span>
        {index === null ? (
          <span className="text-xs text-gray-400">{t('fileCard.noLearningContent')}</span>
        ) : (
          <span className={`learning-stage learning-stage-${stage} flex items-center gap-1.5 text-xs font-medium`}>
            <span className="learning-stage-dot" aria-hidden="true" />
            <span>{t(`fileCard.stage.${stage}`)}</span>
          </span>
        )}
      </div>
      {!analysisCompleted && <p className="mt-1 text-right text-[11px] text-gray-400">{t('fileCard.wordsOnlyPending')}</p>}
      {aiEnabled && analysisCompleted && !analysisProgress && (
        <p className="mt-3 text-xs text-green-700">{t('fileCard.aiDone')}</p>
      )}
      {aiEnabled && analysisProgress?.status === 'error' && (
        <p className="mt-3 text-xs text-red-600">{t('fileCard.analysisFailed')}</p>
      )}
      {aiEnabled && analysisProgress?.status === 'completed' && (
        <p className="mt-3 text-xs text-green-700">{t('fileCard.aiDone')}</p>
      )}
      {aiEnabled && analysisProgress?.status === 'processing' && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-purple-700">
            <span>{t('fileCard.analyzing')}</span>
            <span className="flex items-center gap-2">
              {analysisProgress.totalSegments > 0
                ? t('fileCard.segmentsProgress', { processed: analysisProgress.processedSegments, total: analysisProgress.totalSegments })
                : t('fileCard.preparing')}
              <button
                onClick={() => onCancel(file.id)}
                disabled={retrying !== undefined}
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
    </article>
  );
}
