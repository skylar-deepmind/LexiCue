import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWordStore } from '../stores/wordStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import type { WordStatus, WordInfo } from '../lib/types';
import StatusBadge from '../components/StatusBadge';
import WordDetailPanel from '../components/WordDetail';
import ContextMenu from '../components/ContextMenu';
import type { ContextMenuItem } from '../components/ContextMenu';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import Skeleton from '../components/Skeleton';

const PAGE_SIZE = 50;

const FILTER_TABS: { key: WordStatus | 'all'; labelKey: string }[] = [
  { key: 'unprocessed', labelKey: 'status.unprocessed' },
  { key: 'learning', labelKey: 'status.learning' },
  { key: 'known', labelKey: 'status.known' },
  { key: 'ignored', labelKey: 'status.ignored' },
  { key: 'all', labelKey: 'common.all' },
];

const SORT_OPTIONS: { key: 'frequency' | 'alpha' | 'recent'; labelKey: string }[] = [
  { key: 'frequency', labelKey: 'sort.frequency' },
  { key: 'alpha', labelKey: 'sort.alpha' },
  { key: 'recent', labelKey: 'sort.recent' },
];

const STATUS_CYCLE: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];

export default function WordsPage() {
  const { t } = useTranslation();
  const store = useWordStore();
  const loadWords = useWordStore((state) => state.loadWords);
  const {
    words,
    filter,
    sortBy,
    selected,
    loading,
    batchUpdating,
    lastBatchAction,
    detail,
    detailLoading,
    detailError,
    detailErrorId,
    refreshKey,
  } = store;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageIds, setPageIds] = useState<number[] | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    wordId: number;
    lemma: string;
    status: WordStatus;
  } | null>(null);

  useEffect(() => {
    void loadWords();
  }, [loadWords]);

  const getContextItems = (wordId: number, status: WordStatus): ContextMenuItem[] => {
    return STATUS_CYCLE.map(s => ({
      label: t(`status.${s}`),
      status: s,
      active: s === status,
      onClick: async () => {
        try {
          await store.updateStatus(wordId, s);
          useFeedbackStore.getState().show(t(`statusAction.${s}`), 'success');
        } catch (e) {
          console.error('Failed to update word:', e);
          useFeedbackStore.getState().show(t('errors.statusUpdateFailed'), 'error');
        }
      },
    }));
  };

  const visibleWords = words.filter((word) =>
    word.lemma.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(visibleWords.length / PAGE_SIZE));
  const wordById = useMemo(() => new Map(words.map((w) => [w.id, w])), [words]);
  const pageWords = useMemo(
    () => (pageIds ? pageIds.map((id) => wordById.get(id)).filter((w): w is WordInfo => !!w) : []),
    [pageIds, wordById],
  );
  const allVisibleSelected = pageWords.length > 0 && pageWords.every((word) => selected.has(word.id));
  const someVisibleSelected = pageWords.some((word) => selected.has(word.id));

  useEffect(() => {
    const all = useWordStore.getState().words;
    const visible = all.filter((word) => word.lemma.toLowerCase().includes(query.trim().toLowerCase()));
    setPageIds(visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((w) => w.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, refreshKey]);

  useEffect(() => {
    if (pageIds !== null && pageWords.length === 0 && visibleWords.length > 0) {
      const target = Math.min(page, totalPages);
      const all = useWordStore.getState().words;
      const visible = all.filter((word) =>
        word.lemma.toLowerCase().includes(query.trim().toLowerCase()),
      );
      setPageIds(visible.slice((target - 1) * PAGE_SIZE, target * PAGE_SIZE).map((w) => w.id));
      if (target !== page) setPage(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIds, pageWords.length, visibleWords.length, totalPages, page, query]);

  useEffect(() => {
    setPage(1);
  }, [query, filter, sortBy]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const applyBatchStatus = async (status: WordStatus) => {
    try {
      const count = await store.batchUpdateStatus(status);
      useFeedbackStore.getState().show(t('words.updated', { count }), 'success', 1500);
    } catch (e) {
      console.error('Failed to batch update words:', e);
      useFeedbackStore.getState().show(t('errors.batchUpdateFailed'), 'error');
    }
  };

  const undoBatchStatus = async () => {
    try {
      await store.undoBatchUpdate();
      useFeedbackStore.getState().show(t('words.undone'), 'success');
    } catch (e) {
      console.error('Failed to undo batch update:', e);
      useFeedbackStore.getState().show(t('errors.undoFailed'), 'error');
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        store.selectAll(pageWords.map((word) => word.id));
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
  }, [selected, store, pageWords]);

  return (
    <div className="h-full flex flex-col relative">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-900">{t('words.title')}</h1>
        </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => store.setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filter === tab.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">{t('common.sort')}</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => store.setSortBy(opt.key)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  sortBy === opt.key
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            store.clearSelection();
          }}
          placeholder={t('words.searchPlaceholder')}
          aria-label={t('words.searchAria')}
          className="mt-3 w-full max-w-sm px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {(selected.size > 0 || lastBatchAction) && (
        <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex flex-wrap items-center gap-2">
          <span className="text-sm text-blue-700 mr-2">
            {selected.size > 0 ? t('words.batchSelected', { count: selected.size }) : t('words.undoAvailable')}
          </span>
          {selected.size > 0 && STATUS_CYCLE.map(s => (
            <button
              key={s}
              onClick={() => applyBatchStatus(s)}
              disabled={selected.size === 0 || batchUpdating}
              className={`px-2.5 py-1 rounded text-xs font-medium text-white ${
                s === 'learning' ? 'bg-blue-600 hover:bg-blue-700' :
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
              {t('words.clearSelection')}
            </button>
          )}
          {lastBatchAction && selected.size === 0 && (
            <button
              onClick={undoBatchStatus}
              disabled={batchUpdating}
              className="ml-auto px-3 py-1 rounded text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
            >
              {batchUpdating ? t('words.processing') : t('words.undo')}
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
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="ml-auto h-3 w-10" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : words.length === 0 ? (
          <EmptyState icon="📖" title={t('words.emptyTitle')} description={t('words.emptyDescription')} />
        ) : visibleWords.length === 0 ? (
          <EmptyState icon="🔎" title={t('words.noMatchTitle')} description={t('words.noMatchDescription')} />
        ) : (
          <div>
            <div className="flex items-center gap-3 px-4 sm:px-6 py-2 bg-gray-50 text-xs text-gray-500">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => allVisibleSelected
                  ? store.clearSelection()
                  : store.selectAll(pageWords.map((word) => word.id))}
                aria-label={t('words.selectAllAria')}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t('words.currentResults', { count: visibleWords.length })}</span>
              {someVisibleSelected && <span>{t('words.selectedCount', { count: selected.size })}</span>}
            </div>
            <div className="grid grid-cols-1 gap-x-8 px-4 sm:px-6 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {pageWords.map((word) => (
              <div
                key={word.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    wordId: word.id,
                    lemma: word.lemma,
                    status: word.status as WordStatus,
                  });
                }}
                className="flex items-start gap-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={selected.has(word.id)}
                  onChange={() => store.toggleSelected(word.id)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => store.loadDetail(word.id)}
                      className="font-medium text-gray-900 text-sm hover:text-blue-600 transition-colors truncate"
                    >
                      {word.lemma}
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">×{word.frequency}</span>
                  </div>
                  <div className="mt-1">
                    <StatusBadge
                      status={word.status}
                      onClick={(e) => setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        wordId: word.id,
                        lemma: word.lemma,
                        status: word.status as WordStatus,
                      })}
                    />
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      {visibleWords.length > PAGE_SIZE && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={visibleWords.length} onPageChange={setPage} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextItems(contextMenu.wordId, contextMenu.status)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {(detail || detailLoading || detailError) && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={store.closeDetail} />
          {detail ? (
            <WordDetailPanel
              detail={detail}
              onClose={store.closeDetail}
              onStatusChange={store.updateStatus}
              onDefinitionSave={store.updateDefinition}
            />
          ) : detailLoading ? (
            <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex items-center justify-center text-gray-400">
              {t('common.loading')}
            </div>
          ) : detailError ? (
            <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-gray-500">{t('errors.detailLoadFailed')}</p>
              <button
                onClick={() => {
                  if (detailErrorId != null) void store.loadDetail(detailErrorId);
                  else store.closeDetail();
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
