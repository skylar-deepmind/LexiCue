import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Download, Upload as ImportIcon, Clapperboard, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import { useOllamaStore } from '../stores/ollamaStore';
import FileCard from '../components/FileCard';
import EmptyState from '../components/EmptyState';
import ImportPreview from '../components/ImportPreview';
import ImportLanguageDialog from '../components/ImportLanguageDialog';
import YouTubeDialog from '../components/YouTubeDialog';
import Skeleton from '../components/Skeleton';
import { useFeedbackStore } from '../stores/feedbackStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useAiStore } from '../stores/aiStore';
import { getAiConfig } from '../lib/ai';
import { isCancelledError } from '../lib/errors';

export default function FilesPage() {
  const { t } = useTranslation();
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [moreOpen]);
  const {
    files,
    loading,
    pendingImport,
    confirming,
    loadFiles,
    importFile,
    setImportLanguage,
    importKnownWords,
    confirmImport,
    cancelImport,
    deleteFile,
    exportAll,
    restoreAll,
  } = useFileStore();
  const navigate = useNavigate();
  const aiEnabled = useAiStore((state) => state.enabled);
  const analysisProgress = useOllamaStore((state) => state.progress);
  const retrying = useOllamaStore((state) => state.retrying);
  const startAnalysis = useOllamaStore((state) => state.startAnalysis);
  const cancelAnalysis = useOllamaStore((state) => state.cancelAnalysis);
  const globalLanguage = usePreferencesStore((state) => state.language);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleFileClick = (fileId: number) => {
    navigate(`/reading?fileId=${fileId}`);
  };

  const handleAnalyze = async (fileId: number) => {
    const config = getAiConfig();
    if (!aiEnabled || !config.model) {
      useFeedbackStore.getState().show(t('errors.needAiSetup'), 'error');
      navigate('/settings');
      return;
    }
    try {
      useFeedbackStore.getState().show(t('files.aiAnalyzing'), 'info', 5000);
      const result = await startAnalysis(fileId, config);
      await loadFiles();
      useFeedbackStore.getState().show(t('files.aiDone', { phrases: result.phrase_count, occurrences: result.occurrence_count }), 'success', 5000);
    } catch (error) {
      console.error('AI phrase analysis failed:', error);
      const message = String(error);
      if (isCancelledError(message)) {
        useFeedbackStore.getState().show(t('files.aiCancelled'), 'info', 2000);
      } else {
        useFeedbackStore.getState().show(message, 'error', 6000);
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h1 className="text-xl font-semibold text-gray-900">{t('files.title')}</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setYoutubeDialogOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Clapperboard size={16} />
            {t('files.importFromYoutube')}
          </button>
          <button
            onClick={importFile}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Upload size={16} />
            {t('files.importFile')}
          </button>
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-label={t('files.moreAria')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <MoreHorizontal size={16} />
              <span className="hidden sm:inline">{t('files.more')}</span>
            </button>
            {moreOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    void importKnownWords();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  title={t('files.importKnownWordsTitle')}
                >
                  <Upload size={15} className="text-gray-400" />
                  {t('files.importKnownWords')}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    void exportAll();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <Download size={15} className="text-gray-400" />
                  {t('files.exportBackup')}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    void restoreAll();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <ImportIcon size={15} className="text-gray-400" />
                  {t('files.restoreBackup')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {youtubeDialogOpen && <YouTubeDialog onClose={() => setYoutubeDialogOpen(false)} />}

      {pendingImport && (
        pendingImport.parsed === null || pendingImport.language === null ? (
          <ImportLanguageDialog
            fileName={pendingImport.name}
            defaultLanguage={globalLanguage}
            onConfirm={(language) => void setImportLanguage(language)}
            onCancel={cancelImport}
          />
        ) : <ImportPreview
          fileName={pendingImport.name}
          segmentCount={pendingImport.parsed.segments.length}
          wordCount={pendingImport.parsed.lemmas.length}
          language={pendingImport.language}
          replaceFileName={pendingImport.replaceFileName}
          preview={pendingImport.parsed.segments.slice(0, 8).map((segment) => ({
            en: segment.en_text,
            zh: segment.zh_text,
          }))}
          busy={confirming}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon="📂"
            title={t('files.emptyTitle')}
            description={t('files.emptyDescription')}
            action={{ label: t('files.emptyAction'), onClick: importFile }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                aiEnabled={aiEnabled}
                onDelete={deleteFile}
                onAnalyze={(id) => void handleAnalyze(id)}
                onCancel={(id) => void cancelAnalysis(id)}
                analysisProgress={analysisProgress[file.id]}
                analysisCompleted={file.phrase_analyzed}
                retrying={retrying[file.id]}
                onClick={() => handleFileClick(file.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
