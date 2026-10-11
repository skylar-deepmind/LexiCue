import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Download, Upload as ImportIcon, Clapperboard, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useFileStore } from '../stores/fileStore';
import { useOllamaStore } from '../stores/ollamaStore';
import { useYoutubeStore } from '../stores/youtubeStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useAiStore } from '../stores/aiStore';
import { getAiConfig } from '../lib/ai';
import { isCancelledError } from '../lib/errors';
import { invalidateCaches } from '../lib/cacheInvalidation';
import type { FileRecord } from '../lib/types';
import AdaptiveMenu from '../components/AdaptiveMenu';
import AnalysisModelPicker from '../components/AnalysisModelPicker';
import FileCard from '../components/FileCard';
import EmptyState from '../components/EmptyState';
import ImportPreview from '../components/ImportPreview';
import ImportLanguageDialog from '../components/ImportLanguageDialog';
import YouTubeDialog from '../components/YouTubeDialog';
import Skeleton from '../components/Skeleton';
import TagFilterBar from '../components/TagFilterBar';
import TagManager from '../components/TagManager';
import TagEditDialog from '../components/TagEditDialog';

export default function FilesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(() => useYoutubeStore.getState().dialogDraft?.resumeAfterSettings === true);
  useEffect(() => {
    const draft = useYoutubeStore.getState().dialogDraft;
    if (draft?.resumeAfterSettings) useYoutubeStore.setState({ dialogDraft: { ...draft, resumeAfterSettings: false } });
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [editFile, setEditFile] = useState<FileRecord | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const { files, tags, loading, loadingTags, tagsError, selectedTagIds, untaggedOnly, pendingImport, confirming, deletingFiles,
    loadFiles, loadTags, setTagFilter, importFile, setImportLanguage, setImportTags, importKnownWords, confirmImport, cancelImport, deleteFile, exportAll, restoreAll,
  } = useFileStore(useShallow(state => ({
    files: state.files, tags: state.tags, loading: state.loading, loadingTags: state.loadingTags, tagsError: state.tagsError,
    selectedTagIds: state.selectedTagIds, untaggedOnly: state.untaggedOnly, pendingImport: state.pendingImport, confirming: state.confirming,
    deletingFiles: state.deletingFiles, loadFiles: state.loadFiles, loadTags: state.loadTags, setTagFilter: state.setTagFilter,
    importFile: state.importFile, setImportLanguage: state.setImportLanguage, setImportTags: state.setImportTags,
    importKnownWords: state.importKnownWords, confirmImport: state.confirmImport, cancelImport: state.cancelImport,
    deleteFile: state.deleteFile, exportAll: state.exportAll, restoreAll: state.restoreAll,
  })));
  const globalLanguage = usePreferencesStore(state => state.language);
  const aiEnabled = useAiStore(state => state.enabled);
  const analysisProgress = useOllamaStore(state => state.progress);
  const analysisDiagnostics = useOllamaStore(state => state.diagnostics);
  const retrying = useOllamaStore(state => state.retrying);
  const previews = useOllamaStore(state => state.previews);
  const openPreview = useOllamaStore(state => state.openPreview);
  const startAnalysis = useOllamaStore(state => state.startAnalysis);
  const cancelAnalysis = useOllamaStore(state => state.cancelAnalysis);
  const scrollKey = JSON.stringify([globalLanguage, selectedTagIds, untaggedOnly]);
  useEffect(() => { void loadFiles(); void loadTags(); }, [loadFiles, loadTags, globalLanguage]);
  useEffect(() => {
    const refresh = () => { void loadTags(true).then(() => loadFiles(true)); };
    window.addEventListener('lexicue-sync-applied', refresh);
    return () => window.removeEventListener('lexicue-sync-applied', refresh);
  }, [loadFiles, loadTags]);
  useEffect(() => {
    const node = listRef.current;
    if (!node || loading) return;
    const key = `lexicue-tag-scroll-${scrollKey}`;
    node.scrollTop = Number(sessionStorage.getItem(key) ?? 0);
    const save = () => sessionStorage.setItem(key, String(node.scrollTop));
    node.addEventListener('scroll', save, { passive: true });
    return () => node.removeEventListener('scroll', save);
  }, [scrollKey, loading]);
  const handleFileClick = (fileId: number) => navigate(`/files/${fileId}`);
  const handleAnalyze = async (fileId: number, forceRefresh = false) => {
    const config = getAiConfig();
    if (!aiEnabled || !config.model) {
      useFeedbackStore.getState().show(t('errors.needAiSetup'), 'error');
      navigate('/settings');
      return;
    }
    try {
      useFeedbackStore.getState().show(t('files.aiAnalyzing'), 'info', 5000);
      const result = await startAnalysis(fileId, config, forceRefresh, { fileName: files.find(file => file.id === fileId)?.name ?? String(fileId), language: files.find(file => file.id === fileId)?.language ?? 'en' });
      invalidateCaches('phrases', 'insights', 'storage');
      useFileStore.getState().invalidateFiles();
      await loadFiles(true);
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

  const renderFileGrid = (list: FileRecord[]) => (
    <div className="file-grid">
      {list.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          aiEnabled={aiEnabled}
          onDelete={(id) => void deleteFile(id).then(() => {
            if (!useFileStore.getState().files.some(file => file.id === id)) useOllamaStore.getState().clearPreview(id);
          })}
          onAnalyze={(id, forceRefresh) => void handleAnalyze(id, forceRefresh)}
          onViewAnalysis={previews[file.id] ? openPreview : undefined}
          onCancel={(id) => void cancelAnalysis(id)}
          onEditTags={setEditFile}
          analysisProgress={analysisProgress[file.id]}
          diagnostic={analysisDiagnostics[file.id]}
          analysisCompleted={file.phrase_analyzed}
          interrupted={previews[file.id]?.status === 'cancelled' || previews[file.id]?.status === 'error'}
          retrying={retrying[file.id]}
          deleteProgress={deletingFiles[file.id]}
          onClick={() => handleFileClick(file.id)}
        />
      ))}
    </div>
  );

  const filtered = selectedTagIds.length > 0 || untaggedOnly;
  return <div className="h-full flex flex-col">
    <header className="files-header">
      <h1>{t('tags.filesTitle')}</h1>
      <div className="flex min-w-0 flex-wrap gap-2">
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
              <AdaptiveMenu anchorRef={moreRef} label={t('files.moreAria')} onClose={() => setMoreOpen(false)}>
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
              </AdaptiveMenu>
            )}
          </div>
        </div>
      </header>
      <TagFilterBar onManage={() => setManagerOpen(true)} />

      <AnalysisModelPicker />
      {youtubeDialogOpen && <YouTubeDialog onClose={() => setYoutubeDialogOpen(false)} />}
      {managerOpen && <TagManager onClose={() => setManagerOpen(false)} />}
      {editFile && <TagEditDialog file={editFile} onClose={() => setEditFile(null)} />}
      {pendingImport && (pendingImport.parsed === null || pendingImport.language === null
        ? <ImportLanguageDialog fileName={pendingImport.name} defaultLanguage={globalLanguage} onConfirm={setImportLanguage} onCancel={cancelImport} />
        : <ImportPreview fileName={pendingImport.name} segmentCount={pendingImport.parsed.segments.length}
          wordCount={pendingImport.parsed.lemmas.length} language={pendingImport.language} replaceFileName={pendingImport.replaceFileName}
          tags={tags} tagSelection={pendingImport.tags} onTagsChange={setImportTags} tagsLoading={loadingTags} tagsError={tagsError} onTagsRetry={() => void loadTags(true)}
          preview={pendingImport.parsed.segments.slice(0,8).map(segment => ({ en: segment.en_text, zh: segment.zh_text }))}
          busy={confirming} onConfirm={() => void confirmImport()} onCancel={cancelImport} />)}
      <div ref={listRef} className="file-list-container min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? <div className="file-grid">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="file-card p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-3 w-1/2" /></div>)}</div>
          : files.length === 0 ? <EmptyState icon="📂" title={t(filtered ? 'tags.emptyResult' : 'files.emptyTitle')}
            description={t(filtered ? 'tags.emptyResultHint' : 'files.emptyDescription')}
            action={filtered ? { label: t('tags.clearFilter'), onClick: () => setTagFilter([]) } : { label: t('files.emptyAction'), onClick: importFile }} />
          : <section><div className="files-results" role="status"><h2>{t(untaggedOnly ? 'tags.untagged' : filtered ? 'tags.filteredFiles' : 'tags.allFiles')}</h2><span>{t('files.categoryCount', { count: files.length })}</span></div>{renderFileGrid(files)}</section>}
      </div>
    </div>;
}
