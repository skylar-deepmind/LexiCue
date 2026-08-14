import { Brain, Trash2, FolderInput } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileRecord } from '../lib/types';
import type { OllamaRetry } from '../stores/ollamaStore';

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
  const icon = file.type === 'srt' ? '🎬' : '📄';
  const date = new Date(file.imported_at).toLocaleDateString(i18n.resolvedLanguage ?? 'zh');

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="shrink-0 text-2xl">{icon}</span>
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
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {aiEnabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze(file.id);
              }}
              disabled={analysisCompleted || Boolean(analysisProgress)}
              className="p-1 text-gray-400 transition-colors hover:text-purple-600 disabled:cursor-wait disabled:opacity-50"
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
            className="p-1 text-gray-400 transition-colors hover:text-blue-600"
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
            className="text-gray-400 hover:text-red-500 transition-colors p-1"
            aria-label={t('fileCard.deleteAria', { name: file.name })}
            title={t('fileCard.deleteTitle')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {aiEnabled && analysisCompleted && !analysisProgress && (
        <p className="mt-3 text-xs text-green-700">{t('fileCard.aiDone')}</p>
      )}
      {aiEnabled && analysisProgress && (
        <div className="mt-3" onClick={(event) => event.stopPropagation()}>
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
    </div>
  );
}
