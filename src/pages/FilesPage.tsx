import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Download,
  Upload as ImportIcon,
  Clapperboard,
  MoreHorizontal,
  FolderPlus,
  ChevronRight,
  ChevronLeft,
  Home,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ask } from '@tauri-apps/plugin-dialog';
import { useFileStore } from '../stores/fileStore';
import { useOllamaStore } from '../stores/ollamaStore';
import FileCard from '../components/FileCard';
import FolderCard from '../components/FolderCard';
import FolderTree, { type DragPayload } from '../components/FolderTree';
import EmptyState from '../components/EmptyState';
import ImportPreview from '../components/ImportPreview';
import ImportLanguageDialog from '../components/ImportLanguageDialog';
import YouTubeDialog from '../components/YouTubeDialog';
import MoveToFolderDialog from '../components/MoveToFolderDialog';
import PromptDialog from '../components/PromptDialog';
import Skeleton from '../components/Skeleton';
import { useFeedbackStore } from '../stores/feedbackStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useAiStore } from '../stores/aiStore';
import { getAiConfig } from '../lib/ai';
import { isCancelledError } from '../lib/errors';
import { getFolderPath, getFolderDescendantIds } from '../lib/folderTree';
import type { FileRecord, FolderInfo } from '../lib/types';

interface MoveTarget {
  kind: 'file' | 'folder';
  id: number;
}

interface PromptTarget {
  mode: 'create' | 'rename';
  parentId: number | null;
  folder?: FolderInfo;
}

const DRAG_TYPE = 'application/x-lexicue';

export default function FilesPage() {
  const { t } = useTranslation();
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [promptTarget, setPromptTarget] = useState<PromptTarget | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
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
    folders,
    currentFolderId,
    loading,
    pendingImport,
    confirming,
    loadFiles,
    loadFolders,
    setCurrentFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    moveFile,
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
    void loadFolders();
  }, [loadFiles, loadFolders]);

  const path = useMemo(
    () => getFolderPath(folders, currentFolderId),
    [folders, currentFolderId],
  );
  const subfolders = useMemo(
    () => folders.filter((folder) => folder.parent_id === currentFolderId),
    [folders, currentFolderId],
  );
  const pathById = useMemo(() => {
    const map = new Map<number, string>();
    for (const folder of folders) {
      map.set(folder.id, getFolderPath(folders, folder.id).map((item) => item.name).join(' / '));
    }
    return map;
  }, [folders]);
  const descendantIds = useMemo(
    () => (drag?.kind === 'folder' ? getFolderDescendantIds(folders, drag.id) : new Set<number>()),
    [drag, folders],
  );

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

  const handleDragStart = (event: React.DragEvent, payload: DragPayload) => {
    setDrag(payload);
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (targetFolderId: number | null) => {
    if (!drag) return;
    const payload = drag;
    setDrag(null);
    if (payload.kind === 'file') {
      void moveFile(payload.id, targetFolderId);
    } else if (
      targetFolderId === null ||
      (targetFolderId !== payload.id && !descendantIds.has(targetFolderId))
    ) {
      void moveFolder(payload.id, targetFolderId);
    }
  };

  const handleDeleteFolder = async (folder: FolderInfo) => {
    const confirmed = await ask(t('folders.deleteConfirm', { name: folder.name }), {
      title: t('folders.deleteTitle'),
      kind: 'warning',
      okLabel: t('folders.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    const subtree = getFolderDescendantIds(folders, folder.id);
    await deleteFolder(folder.id);
    if (currentFolderId !== null && subtree.has(currentFolderId)) {
      setCurrentFolder(null);
    }
  };

  const renderFileGrid = (list: FileRecord[]) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          folderPath={
            currentFolderId === null && file.folder_id !== null
              ? pathById.get(file.folder_id)
              : undefined
          }
          aiEnabled={aiEnabled}
          onDelete={deleteFile}
          onAnalyze={(id) => void handleAnalyze(id)}
          onCancel={(id) => void cancelAnalysis(id)}
          onMove={(item) => setMoveTarget({ kind: 'file', id: item.id })}
          analysisProgress={analysisProgress[file.id]}
          analysisCompleted={file.phrase_analyzed}
          retrying={retrying[file.id]}
          onClick={() => handleFileClick(file.id)}
        />
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
        <nav className="flex min-w-0 items-center gap-1.5 text-sm" aria-label={t('files.breadcrumbAria')}>
          <button
            onClick={() => setCurrentFolder(null)}
            className={`flex shrink-0 items-center gap-1 rounded px-1 py-0.5 transition-colors ${
              currentFolderId === null
                ? 'font-medium text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Home size={14} />
            <span className="hidden sm:inline">{t('files.root')}</span>
          </button>
          {path.map((folder) => (
            <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
              <ChevronRight size={14} className="shrink-0 text-gray-300" />
              <button
                onClick={() => setCurrentFolder(folder.id)}
                className={`truncate rounded px-1 py-0.5 transition-colors ${
                  folder.id === currentFolderId
                    ? 'font-medium text-blue-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setPromptTarget({ mode: 'create', parentId: currentFolderId })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <FolderPlus size={16} />
            {t('files.newFolder')}
          </button>
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

      {moveTarget && (
        <MoveToFolderDialog
          title={
            moveTarget.kind === 'file'
              ? t('files.moveFileTitle')
              : t('files.moveFolderTitle')
          }
          folders={folders}
          excludeFolderId={moveTarget.kind === 'folder' ? moveTarget.id : null}
          onSelect={(targetId) => {
            const target = moveTarget;
            setMoveTarget(null);
            if (target.kind === 'file') {
              void moveFile(target.id, targetId);
            } else {
              void moveFolder(target.id, targetId);
            }
          }}
          onCancel={() => setMoveTarget(null)}
        />
      )}

      {promptTarget && (
        <PromptDialog
          title={promptTarget.mode === 'create' ? t('folders.newTitle') : t('folders.renameTitle')}
          placeholder={t('folders.namePlaceholder')}
          initial={promptTarget.folder?.name ?? ''}
          confirmLabel={t(promptTarget.mode === 'create' ? 'folders.create' : 'folders.rename')}
          onConfirm={(value) => {
            const target = promptTarget;
            setPromptTarget(null);
            if (target.mode === 'create') {
              void createFolder(value, target.parentId);
            } else if (target.folder) {
              void renameFolder(target.folder.id, value);
            }
          }}
          onCancel={() => setPromptTarget(null)}
        />
      )}

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
          targetFolder={currentFolderId === null ? t('files.root') : path.map((item) => item.name).join(' / ') || t('files.root')}
          preview={pendingImport.parsed.segments.slice(0, 8).map((segment) => ({
            en: segment.en_text,
            zh: segment.zh_text,
          }))}
          busy={confirming}
          onConfirm={confirmImport}
          onCancel={cancelImport}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`hidden shrink-0 border-r border-gray-100 sm:flex ${treeOpen ? 'w-52' : 'w-9'}`}
        >
          {treeOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {t('files.folders')}
                </span>
                <button
                  onClick={() => setTreeOpen(false)}
                  aria-label={t('files.collapseTree')}
                  className="p-1 text-gray-400 transition-colors hover:text-gray-700"
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <FolderTree
                  folders={folders}
                  currentFolderId={currentFolderId}
                  drag={drag}
                  descendantIds={descendantIds}
                  onSelect={(folderId) => setCurrentFolder(folderId)}
                  onDragStart={handleDragStart}
                  onDragEnd={() => setDrag(null)}
                  onDrop={handleDrop}
                  onNewSubfolder={(parentId) => setPromptTarget({ mode: 'create', parentId })}
                  onRename={(folder) => setPromptTarget({ mode: 'rename', parentId: null, folder })}
                  onMove={(folder) => setMoveTarget({ kind: 'folder', id: folder.id })}
                  onDelete={(folder) => void handleDeleteFolder(folder)}
                />
              </div>
            </div>
          ) : (
            <div className="flex w-9 justify-center pt-2">
              <button
                onClick={() => setTreeOpen(true)}
                aria-label={t('files.expandTree')}
                className="p-1 text-gray-400 transition-colors hover:text-gray-700"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
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
          ) : subfolders.length === 0 && files.length === 0 ? (
            currentFolderId === null ? (
              <EmptyState
                icon="📂"
                title={t('files.emptyTitle')}
                description={t('files.emptyDescription')}
                action={{ label: t('files.emptyAction'), onClick: importFile }}
              />
            ) : (
              <EmptyState
                icon="📂"
                title={t('files.emptyFolderTitle')}
                description={t('files.emptyFolderDescription')}
                action={{ label: t('files.newFolder'), onClick: () => setPromptTarget({ mode: 'create', parentId: currentFolderId }) }}
              />
            )
          ) : (
            <div className="space-y-8">
              {subfolders.length > 0 && (
                <section>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {subfolders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        drag={drag}
                        descendantIds={descendantIds}
                        onSelect={(folderId) => setCurrentFolder(folderId)}
                        onDragStart={handleDragStart}
                        onDragEnd={() => setDrag(null)}
                        onDrop={handleDrop}
                        onNewSubfolder={(parentId) => setPromptTarget({ mode: 'create', parentId })}
                        onRename={(item) => setPromptTarget({ mode: 'rename', parentId: null, folder: item })}
                        onMove={(item) => setMoveTarget({ kind: 'folder', id: item.id })}
                        onDelete={(item) => void handleDeleteFolder(item)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {files.length > 0 && (
                <section>
                  <div className="mb-3 flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-gray-700">
                      {currentFolderId === null ? t('files.rootFiles') : t('files.folderFiles')}
                    </h2>
                    <span className="text-xs text-gray-400">
                      {t('files.categoryCount', { count: files.length })}
                    </span>
                  </div>
                  {renderFileGrid(files)}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
