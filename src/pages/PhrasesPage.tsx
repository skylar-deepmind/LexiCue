import Overlay from '../components/Overlay';
import { blocksPageShortcut } from '../lib/backNavigation';
import VocabularyToolbar from '../components/VocabularyToolbar';
import AnnotationWorkspace from '../components/AnnotationWorkspace';
import { annotationItems, type AnnotationMode } from '../lib/annotation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePhraseStore } from '../stores/phraseStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import type { WordStatus } from '../lib/types';
import StatusBadge from '../components/StatusBadge';
import PhraseDetailPanel from '../components/PhraseDetail';
import ContextMenu from '../components/ContextMenu';
import type { ContextMenuItem } from '../components/ContextMenu';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CONTENT_FONT_CLASS } from '../lib/contentTypography';
import { useNavigate } from 'react-router-dom';
import { occurrenceRoute } from '../lib/fileProgress';
import { useShallow } from 'zustand/react/shallow';

const PAGE_SIZE = 50;

const STATUS_CYCLE: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];

export default function PhrasesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const store = usePhraseStore(useShallow((state) => ({
    loadPhrases: state.loadPhrases,
    loadDetail: state.loadDetail,
    closeDetail: state.closeDetail,
    setFilter: state.setFilter,
    setSortBy: state.setSortBy,
    setIncludeUnverified: state.setIncludeUnverified,
    updateStatus: state.updateStatus,
    updateDefinition: state.updateDefinition,
    batchUpdateStatus: state.batchUpdateStatus,
    undoBatchUpdate: state.undoBatchUpdate,
    toggleSelected: state.toggleSelected,
    selectAll: state.selectAll,
    clearSelection: state.clearSelection,
  })));
  const { loadPhrases } = store;
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);
  const selectedLanguage = usePreferencesStore((state) => state.language);
  const mode = usePreferencesStore(state => state.annotationModes.phrase);
  const changeMode = (value: AnnotationMode) => {
    store.clearSelection(); store.closeDetail(); setContextMenu(null);
    usePreferencesStore.getState().setAnnotationMode('phrase', value);
  };
  const {
    phrases,
    filter,
    sortBy,
    includeUnverified,
    selected,
    loading,
    loadedKey,
    batchUpdating,
    lastBatchAction,
    detail,
    detailLoading,
    detailError,
    detailErrorId,
  } = usePhraseStore(useShallow((state) => ({
    phrases: state.phrases,
    filter: state.filter,
    sortBy: state.sortBy,
    includeUnverified: state.includeUnverified,
    selected: state.selected,
    loadedKey: state.loadedKey,
    loading: state.loading,
    batchUpdating: state.batchUpdating,
    lastBatchAction: state.lastBatchAction,
    detail: state.detail,
    detailLoading: state.detailLoading,
    detailError: state.detailError,
    detailErrorId: state.detailErrorId,
  })));
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    phraseId: number;
    text: string;
    status: WordStatus;
  } | null>(null);

  useEffect(() => {
    store.clearSelection();
    store.closeDetail();
    void loadPhrases();
  }, [loadPhrases, selectedLanguage, store]);

  const getContextItems = (phraseId: number, status: WordStatus): ContextMenuItem[] => {
    return STATUS_CYCLE.map(s => ({
      label: t(`status.${s}`),
      status: s,
      active: s === status,
      onClick: async () => {
        try {
          await store.updateStatus(phraseId, s);
          useFeedbackStore.getState().show(t(`statusAction.${s}`), 'success');
        } catch (e) {
          console.error('Failed to update phrase:', e);
          useFeedbackStore.getState().show(t('errors.statusUpdateFailed'), 'error');
        }
      },
    }));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visiblePhrases = useMemo(() => phrases.filter((phrase) =>
    phrase.text.toLowerCase().includes(normalizedQuery),
  ), [phrases, normalizedQuery]);
  const totalPages = Math.max(1, Math.ceil(visiblePhrases.length / PAGE_SIZE));
  const pagePhrases = useMemo(
    () => visiblePhrases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visiblePhrases, page],
  );
  const allVisibleSelected = pagePhrases.length > 0 && pagePhrases.every((phrase) => selected.has(phrase.id));
  const someVisibleSelected = pagePhrases.some((phrase) => selected.has(phrase.id));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, filter, sortBy, includeUnverified]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const applyBatchStatus = async (status: WordStatus) => {
    try {
      const count = await store.batchUpdateStatus(status);
      useFeedbackStore.getState().show(t('phrases.updated', { count }), 'success', 1500);
    } catch (e) {
      console.error('Failed to batch update phrases:', e);
      useFeedbackStore.getState().show(t('errors.batchUpdateFailed'), 'error');
    }
  };

  const undoBatchStatus = async () => {
    try {
      await store.undoBatchUpdate();
      useFeedbackStore.getState().show(t('phrases.undone'), 'success');
    } catch (e) {
      console.error('Failed to undo batch update:', e);
      useFeedbackStore.getState().show(t('errors.undoFailed'), 'error');
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (blocksPageShortcut(e)) return;
      if (mode !== 'batch') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        store.selectAll(pagePhrases.map((phrase) => phrase.id));
        return;
      }

      if (!selected.size) return;

      const keys: Record<string, WordStatus> = {
        '1': 'learning',
        '2': 'known',
        '3': 'ignored',
        '0': 'unprocessed',
      };

      const status = keys[e.key];
      if (status) {
        e.preventDefault();
        store.batchUpdateStatus(status);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, store, pagePhrases, mode]);

  const toolbar = <VocabularyToolbar kind="phrase" query={query} onQuery={value => { setQuery(value); store.clearSelection(); }} filter={filter} onFilter={store.setFilter} sort={sortBy} onSort={store.setSortBy} mode={mode} onMode={changeMode} disabled={batchUpdating} extra={(selectedLanguage === 'en' || selectedLanguage === 'all') ? { value: includeUnverified, onChange: store.setIncludeUnverified, label: t('phrases.showUnverified') } : undefined} />;

  if (mode === 'single') return <AnnotationWorkspace
    key={selectedLanguage}
    toolbar={toolbar}
    scope={{ kind: 'phrase', language: selectedLanguage, filter, sortBy, query, includeUnverified }}
    items={annotationItems(visiblePhrases)}
    loading={loading || loadedKey !== JSON.stringify([selectedLanguage, filter, sortBy, includeUnverified])}
    onModeChange={changeMode}
  />;

  return (
    <div className="h-full flex flex-col relative">
      {toolbar}

      {(selected.size > 0 || lastBatchAction) && (
        <div className="px-6 py-2 bg-purple-50 border-b border-purple-100 flex flex-wrap items-center gap-2">
          <span className="text-sm text-purple-700 mr-2">
            {selected.size > 0 ? t('phrases.batchSelected', { count: selected.size }) : t('phrases.undoAvailable')}
          </span>
          {selected.size > 0 && STATUS_CYCLE.map(s => (
            <button
              key={s}
              onClick={() => applyBatchStatus(s)}
              disabled={selected.size === 0 || batchUpdating}
              className={`px-2.5 py-1 rounded text-xs font-medium text-white ${
                s === 'learning' ? 'bg-purple-600 hover:bg-purple-700' :
                s === 'known' ? 'bg-green-600 hover:bg-green-700' :
                s === 'ignored' ? 'bg-gray-500 hover:bg-gray-600' :
                'bg-gray-400 hover:bg-gray-500'
              } disabled:opacity-40`}
            >
              {t(`status.${s}`)}
            </button>
          ))}
          {selected.size > 0 && (
            <button
              onClick={store.clearSelection}
              disabled={batchUpdating}
              className="px-3 py-1 rounded text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              {t('phrases.clearSelection')}
            </button>
          )}
          {lastBatchAction && selected.size === 0 && (
            <button
              onClick={undoBatchStatus}
              disabled={batchUpdating}
              className="ml-auto px-3 py-1 rounded text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-40"
            >
              {batchUpdating ? t('phrases.processing') : t('phrases.undo')}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 w-4" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="ml-auto h-3 w-10" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-10 rounded" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : phrases.length === 0 ? (
          <EmptyState icon="📚" title={t('phrases.emptyTitle')} description={t('phrases.emptyDescription')} />
        ) : visiblePhrases.length === 0 ? (
          <EmptyState icon="🔎" title={t('phrases.noMatchTitle')} description={t('phrases.noMatchDescription')} />
        ) : (
          <div>
            <div className="flex items-center gap-3 px-4 sm:px-6 py-2 bg-gray-50 text-xs text-gray-500">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => allVisibleSelected
                  ? store.clearSelection()
                  : store.selectAll(pagePhrases.map((phrase) => phrase.id))}
                aria-label={t('phrases.selectAllAria')}
                className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <span>{t('phrases.currentResults', { count: visiblePhrases.length })}</span>
              {someVisibleSelected && <span>{t('phrases.selectedCount', { count: selected.size })}</span>}
            </div>
            <div className="grid grid-cols-1 gap-x-8 px-4 sm:px-6 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {pagePhrases.map((phrase) => (
              <div
                key={phrase.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    phraseId: phrase.id,
                    text: phrase.text,
                    status: phrase.status as WordStatus,
                  });
                }}
                className="vocabulary-row flex items-start gap-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={selected.has(phrase.id)}
                  onChange={() => store.toggleSelected(phrase.id)}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 shrink-0 mt-0.5"
                />
                <div className="vocabulary-row__main flex-1 min-w-0">
                  <div className="vocabulary-row__heading flex items-center gap-2">
                    <button
                      onClick={() => store.loadDetail(phrase.id)}
                      className={`font-medium text-gray-900 hover:text-purple-600 transition-colors truncate ${CONTENT_FONT_CLASS.learning[learningTextFontSize]}`}
                    >
                      {phrase.text}
                    </button>
                    <span className={`${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]} text-gray-400 shrink-0`}>×{phrase.frequency}</span>
                    {includeUnverified && phrase.unverified && <span className="phrase-candidate-badge shrink-0 rounded px-1.5 py-0.5 text-[10px]">{t('phrases.unverifiedBadge')}</span>}
                  </div>
                  <div className="vocabulary-row__status mt-1 flex items-center gap-2">
                    <StatusBadge
                      status={phrase.status}
                      onClick={(e) => setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        phraseId: phrase.id,
                        text: phrase.text,
                        status: phrase.status as WordStatus,
                      })}
                    />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      phrase.source === 'manual' ? 'bg-purple-50 text-purple-600' : 'bg-teal-50 text-teal-600'
                    }`}>
                      {phrase.source === 'manual' ? t('phrases.sourceManual') : t('phrases.sourceAuto')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      {visiblePhrases.length > PAGE_SIZE && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={visiblePhrases.length} onPageChange={setPage} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextItems(contextMenu.phraseId, contextMenu.status)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {(detail || detailLoading || detailError) && (
        <>
          {detail ? (
            <PhraseDetailPanel
              detail={detail}
              onClose={store.closeDetail}
              onStatusChange={store.updateStatus}
              onDefinitionSave={store.updateDefinition}
              onOccurrenceOpen={(occurrence) => {
                store.closeDetail();
                navigate(occurrenceRoute(occurrence, 'phrase', detail.phrase.id));
              }}
            />
          ) : detailLoading ? (
            <Overlay variant="detail" label={t('shell.vocabulary')} onClose={store.closeDetail} className="detail-panel detail-placeholder">
              <button className="ui-button detail-placeholder__close" onClick={store.closeDetail}>{t('common.close')}</button>
              {t('common.loading')}
            </Overlay>
          ) : detailError ? (
            <Overlay variant="detail" label={t('shell.vocabulary')} onClose={store.closeDetail} className="detail-panel detail-placeholder">
              <button className="ui-button detail-placeholder__close" onClick={store.closeDetail}>{t('common.close')}</button>
              <p className="text-sm text-gray-500">{t('errors.detailLoadFailed')}</p>
              <button
                onClick={() => {
                  if (detailErrorId != null) void store.loadDetail(detailErrorId);
                  else store.closeDetail();
                }}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
              >
                {t('common.retry')}
              </button>
            </Overlay>
          ) : null}
        </>
      )}
    </div>
  );
}
