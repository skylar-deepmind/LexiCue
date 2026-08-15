import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePhraseStore } from '../stores/phraseStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import type { WordStatus, PhraseInfo } from '../lib/types';
import StatusBadge from '../components/StatusBadge';
import PhraseDetailPanel from '../components/PhraseDetail';
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

export default function PhrasesPage() {
  const { t } = useTranslation();
  const store = usePhraseStore();
  const loadPhrases = usePhraseStore((state) => state.loadPhrases);
  const {
    phrases,
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
    phraseId: number;
    text: string;
    status: WordStatus;
  } | null>(null);

  useEffect(() => {
    void loadPhrases();
  }, [loadPhrases]);

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

  const visiblePhrases = phrases.filter((phrase) =>
    phrase.text.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(visiblePhrases.length / PAGE_SIZE));
  const phraseById = useMemo(() => new Map(phrases.map((p) => [p.id, p])), [phrases]);
  const pagePhrases = useMemo(
    () => (pageIds ? pageIds.map((id) => phraseById.get(id)).filter((p): p is PhraseInfo => !!p) : []),
    [pageIds, phraseById],
  );
  const allVisibleSelected = pagePhrases.length > 0 && pagePhrases.every((phrase) => selected.has(phrase.id));
  const someVisibleSelected = pagePhrases.some((phrase) => selected.has(phrase.id));

  useEffect(() => {
    const all = usePhraseStore.getState().phrases;
    const visible = all.filter((phrase) => phrase.text.toLowerCase().includes(query.trim().toLowerCase()));
    setPageIds(visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, query, refreshKey]);

  useEffect(() => {
    if (pageIds !== null && pagePhrases.length === 0 && visiblePhrases.length > 0) {
      const target = Math.min(page, totalPages);
      const all = usePhraseStore.getState().phrases;
      const visible = all.filter((phrase) =>
        phrase.text.toLowerCase().includes(query.trim().toLowerCase()),
      );
      setPageIds(visible.slice((target - 1) * PAGE_SIZE, target * PAGE_SIZE).map((p) => p.id));
      if (target !== page) setPage(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIds, pagePhrases.length, visiblePhrases.length, totalPages, page, query]);

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
  }, [selected, store, pagePhrases]);

  return (
    <div className="h-full flex flex-col relative">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-900">{t('phrases.title')}</h1>
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
                    ? 'bg-purple-50 text-purple-600'
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
          placeholder={t('phrases.searchPlaceholder')}
          aria-label={t('phrases.searchAria')}
          className="mt-3 w-full max-w-sm px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>

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
                className="flex items-start gap-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={selected.has(phrase.id)}
                  onChange={() => store.toggleSelected(phrase.id)}
                  className="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => store.loadDetail(phrase.id)}
                      className="font-medium text-gray-900 text-sm hover:text-purple-600 transition-colors truncate"
                    >
                      {phrase.text}
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">×{phrase.frequency}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
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
          <div className="fixed inset-0 bg-black/20 z-30" onClick={store.closeDetail} />
          {detail ? (
            <PhraseDetailPanel
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
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
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
