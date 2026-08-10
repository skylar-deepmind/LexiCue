import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Search, X, MoreHorizontal } from 'lucide-react';
import { useReaderStore } from '../stores/readerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import type { FileRecord, WordStatus } from '../lib/types';
import type { WordDetail } from '../lib/types';
import type { ContextMenuItem } from '../components/ContextMenu';
import ContextMenu from '../components/ContextMenu';
import SegmentCard from '../components/SegmentCard';
import EmptyState from '../components/EmptyState';
import WordDetailPanel from '../components/WordDetail';
import PhraseDetailPanel from '../components/PhraseDetail';
import type { PhraseDetail as PhraseDetailType } from '../lib/types';

const STATUS_CYCLE: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];

export default function ReadingPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    currentFileId,
    currentLanguage,
    segments,
    wordStatusMap,
    phraseMap,
    segmentTokens,
    activeSegmentIndex,
    loading,
    setFile,
    setActiveSegmentIndex,
  } = useReaderStore();
  const globalLanguage = usePreferencesStore((state) => state.language);
  const readingFontSize = usePreferencesStore((state) => state.readingFontSize);
  const setReadingFontSize = usePreferencesStore((state) => state.setReadingFontSize);
  const readingLineHeight = usePreferencesStore((state) => state.readingLineHeight);
  const setReadingLineHeight = usePreferencesStore((state) => state.setReadingLineHeight);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [phraseDetail, setPhraseDetail] = useState<PhraseDetailType | null>(null);
  const [phraseDetailLoading, setPhraseDetailLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const [quickMode, setQuickMode] = useState(false);
  const [quickSelected, setQuickSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const toolsRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!toolsOpen) return;
    const handler = (event: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [toolsOpen]);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    lemma: string;
    wordId: number | null;
    status: WordStatus;
  } | null>(null);

  useEffect(() => {
    invoke<FileRecord[]>('list_files').then(setFiles);
  }, []);

  const visibleFiles = globalLanguage === 'all'
    ? files
    : files.filter((file) => file.language === globalLanguage);

  useEffect(() => {
    if (globalLanguage === 'all' || currentFileId === null) return;
    const current = files.find((file) => file.id === currentFileId);
    if (current && current.language !== globalLanguage) {
      setSearchParams({}, { replace: true });
      useReaderStore.setState({
        currentFileId: null,
        segments: [],
        wordStatusMap: new Map(),
        phraseMap: new Map(),
        segmentTokens: new Map(),
        activeSegmentIndex: 0,
      });
    }
  }, [globalLanguage, files, currentFileId, setSearchParams]);

  useEffect(() => {
    const fileId = searchParams.get('fileId');
    if (fileId) {
      setFile(Number(fileId));
    }
  }, [searchParams, setFile]);

  useEffect(() => {
    if (currentFileId === null || segments.length === 0) return;
    const saved = Number(localStorage.getItem(`lexicue-reading-position-${currentFileId}`));
    const nextIndex = Number.isInteger(saved) && saved >= 0 && saved < segments.length ? saved : 0;
    setActiveSegmentIndex(nextIndex);
  }, [currentFileId, segments.length, setActiveSegmentIndex]);

  useEffect(() => {
    if (currentFileId !== null && segments.length > 0) {
      localStorage.setItem(`lexicue-reading-position-${currentFileId}`, String(activeSegmentIndex));
    }
    segmentRefs.current[activeSegmentIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSegmentIndex, currentFileId, segments.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveSegmentIndex(activeSegmentIndex - 1);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveSegmentIndex(activeSegmentIndex + 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSegmentIndex, setActiveSegmentIndex]);

  const updateLocalStatus = (lemma: string, id: number, status: string) => {
    useReaderStore.setState((state) => {
      const wm = new Map(state.wordStatusMap);
      wm.set(lemma, { id, lemma, status });
      return { wordStatusMap: wm };
    });
  };

  const handleWordClick = async (lemma: string, wordId: number | null) => {
    try {
      setDetailLoading(true);
      let id = wordId;
      if (id === null) {
        const allWords: { id: number; lemma: string }[] = await invoke('list_words', {
          statusFilter: null,
          sortBy: 'alpha',
          language: currentLanguage,
        });
        id = allWords.find((word) => word.lemma === lemma)?.id ?? null;
      }
      if (id !== null) {
        setDetail(await invoke<WordDetail>('word_detail', { wordId: id }));
      }
    } catch (e) {
      console.error('Failed to load word detail:', e);
      useFeedbackStore.getState().show(t('reading.cannotLoadWord'), 'error');
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePhraseClick = async (phraseId: number) => {
    try {
      setPhraseDetailLoading(true);
      const detail: PhraseDetailType = await invoke('phrase_detail', { phraseId });
      setPhraseDetail(detail);
    } catch (e) {
      console.error('Failed to load phrase detail:', e);
      useFeedbackStore.getState().show(t('reading.cannotLoadPhrase'), 'error');
    } finally {
      setPhraseDetailLoading(false);
    }
  };

  const updateStatus = async (wordId: number, lemma: string, status: WordStatus) => {
    try {
      await invoke('update_word_status', { wordId, status });
      if (status === 'learning') {
        await invoke('create_review_card', { wordId });
      }
      updateLocalStatus(lemma, wordId, status);
      setDetail((current) => current
        ? { ...current, word: { ...current.word, status } }
        : current);
      useFeedbackStore.getState().show(t(`statusAction.${status}`), 'success');
    } catch (e) {
      console.error('Failed to update word:', e);
      useFeedbackStore.getState().show(t('errors.statusUpdateFailed'), 'error');
    }
  };

  const handleWordContextMenu = async (lemma: string, wordId: number | null, x: number, y: number) => {
    const status = wordId !== null
      ? ((wordStatusMap.get(lemma)?.status ?? 'unprocessed') as WordStatus)
      : 'unprocessed' as WordStatus;
    setContextMenu({ x, y, lemma, wordId, status });
  };

  const handleContextAction = async (status: WordStatus) => {
    if (!contextMenu) return;
    const { lemma, wordId } = contextMenu;

    if (wordId !== null) {
      await updateStatus(Number(wordId), lemma, status);
    } else {
      try {
        const allWords: { id: number; lemma: string; status: string }[] = await invoke('list_words', {
          statusFilter: null,
          sortBy: 'alpha',
        });
        const found = allWords.find((w) => w.lemma === lemma);
        if (found) {
          await updateStatus(found.id, lemma, status);
        }
      } catch (e) {
        console.error('Failed to update word:', e);
      }
    }
    setContextMenu(null);
  };

  const contextItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    return STATUS_CYCLE.map(s => ({
      label: t(`status.${s}`),
      status: s,
      active: s === contextMenu.status,
      onClick: () => handleContextAction(s),
    }));
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchingSegmentIndexes = normalizedQuery
    ? segments.reduce<number[]>((matches, segment, index) => {
      if (`${segment.en_text} ${segment.zh_text ?? ''}`.toLowerCase().includes(normalizedQuery)) {
        matches.push(index);
      }
      return matches;
    }, [])
    : [];

  const moveSegment = (offset: number) => {
    if (segments.length === 0) return;
    const next = Math.min(segments.length - 1, Math.max(0, activeSegmentIndex + offset));
    setActiveSegmentIndex(next);
  };

  const moveSearchMatch = (offset: number) => {
    if (matchingSegmentIndexes.length === 0) return;
    const next = (activeMatchIndex + offset + matchingSegmentIndexes.length) % matchingSegmentIndexes.length;
    setActiveMatchIndex(next);
    setActiveSegmentIndex(matchingSegmentIndexes[next]);
  };

  const fileWordCounts = new Map<string, number>();
  for (const tokens of segmentTokens.values()) {
    for (const t of tokens) {
      fileWordCounts.set(t.lemma, (fileWordCounts.get(t.lemma) ?? 0) + 1);
    }
  }
  const fileWordItems = Array.from(fileWordCounts.entries())
    .map(([lemma, frequency]) => ({ lemma, frequency, info: wordStatusMap.get(lemma) }))
    .sort((a, b) => b.frequency - a.frequency || a.lemma.localeCompare(b.lemma));

  useEffect(() => {
    setQuickSelected(new Set());
  }, [currentFileId]);

  const applyQuickStatus = async (status: WordStatus, targetItems = fileWordItems.filter((item) => quickSelected.has(item.lemma))) => {
    const items = targetItems.filter((item) => item.info?.id !== undefined);
    if (items.length === 0) return;
    try {
      const wordIds = items.map((item) => item.info!.id);
      await invoke('batch_update_status', { wordIds, status });
      if (status === 'learning') {
        await Promise.all(wordIds.map((wordId) => invoke('create_review_card', { wordId })));
      }
      items.forEach((item) => updateLocalStatus(item.lemma, item.info!.id, status));
      setQuickSelected(new Set());
      useFeedbackStore.getState().show(t('reading.markedStatus', { count: items.length, status: t(`status.${status}`) }), 'success');
    } catch (e) {
      console.error('Failed to update current file words:', e);
      useFeedbackStore.getState().show(t('errors.batchUpdateFailed'), 'error');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
        <h1 className="text-xl font-semibold text-gray-900 shrink-0">{t('reading.title')}</h1>
        <select
          value={currentFileId ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              setSearchParams({ fileId: id });
            }
          }}
          className="flex-1 max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t('reading.selectFile')}</option>
          {visibleFiles.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.type.toUpperCase()})
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setShowTranslation((visible) => !visible)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
          >
            {showTranslation ? t('reading.hideTranslation') : t('reading.showTranslation')}
          </button>
          <div ref={toolsRef} className="relative">
            <button
              onClick={() => setToolsOpen((open) => !open)}
              aria-expanded={toolsOpen}
              aria-haspopup="menu"
              aria-label={t('reading.toolsAria')}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
            >
              <MoreHorizontal size={15} />
              <span className="hidden sm:inline">{t('reading.tools')}</span>
            </button>
            {toolsOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
              >
                <button
                  role="menuitem"
                  onClick={() => {
                    setQuickMode((enabled) => !enabled);
                    setToolsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${quickMode ? 'text-blue-700' : 'text-gray-700'}`}
                >
                  {quickMode ? t('reading.exitQuickMode') : t('reading.quickMode')}
                </button>
                <div className="border-t border-gray-100 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-gray-500">{t('reading.fontSize')}</span>
                    <div className="flex gap-1">
                      {(['sm', 'md', 'lg'] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => setReadingFontSize(size)}
                          aria-pressed={readingFontSize === size}
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            readingFontSize === size ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {t(`reading.font.${size}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <span className="text-gray-500">{t('reading.lineHeight')}</span>
                    <div className="flex gap-1">
                      {(['compact', 'normal', 'loose'] as const).map((lh) => (
                        <button
                          key={lh}
                          onClick={() => setReadingLineHeight(lh)}
                          aria-pressed={readingLineHeight === lh}
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            readingLineHeight === lh ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {t(`reading.line.${lh}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setShowHint((visible) => !visible);
                    setToolsOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${showHint ? 'text-gray-900' : 'text-gray-500'}`}
                >
                  <span className="flex-1">{t('reading.showHint')}</span>
                  {showHint && <span className="text-blue-500 text-xs">✓</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showHint && currentFileId !== null && segments.length > 0 && (
        <p className="px-4 sm:px-6 py-1.5 border-b border-gray-100 bg-gray-50/70 text-xs text-gray-400">
          {t('reading.hint')}
        </p>
      )}

      {currentFileId !== null && segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2 border-b border-gray-100 bg-gray-50/70">
          <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setActiveMatchIndex(0);
              }}
              placeholder={t('reading.searchPlaceholder')}
              aria-label={t('reading.searchAria')}
              className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-8 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {normalizedQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActiveMatchIndex(0);
                }}
                aria-label={t('reading.clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {normalizedQuery && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span>{matchingSegmentIndexes.length ? `${activeMatchIndex + 1} / ${matchingSegmentIndexes.length}` : t('reading.noResults')}</span>
              <button onClick={() => moveSearchMatch(-1)} disabled={!matchingSegmentIndexes.length} aria-label={t('reading.prevMatchAria')} className="rounded px-1 hover:bg-gray-200 disabled:opacity-40">↑</button>
              <button onClick={() => moveSearchMatch(1)} disabled={!matchingSegmentIndexes.length} aria-label={t('reading.nextMatchAria')} className="rounded px-1 hover:bg-gray-200 disabled:opacity-40">↓</button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => moveSegment(-1)} disabled={activeSegmentIndex === 0} className="px-2 py-1 rounded border border-gray-200 text-xs disabled:opacity-40">{t('reading.prevSegment')}</button>
            <button onClick={() => moveSegment(1)} disabled={activeSegmentIndex >= segments.length - 1} className="px-2 py-1 rounded border border-gray-200 text-xs disabled:opacity-40">{t('reading.nextSegment')}</button>
            <span className="text-xs text-gray-500">{t('reading.segmentPosition', { current: activeSegmentIndex + 1, total: segments.length })}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${((activeSegmentIndex + 1) / segments.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {quickMode && currentFileId !== null && segments.length > 0 && (
        <div className="border-b border-blue-100 bg-blue-50/50 px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-800">{t('reading.quickTitle')}</span>
              <span className="text-xs text-gray-500">{t('reading.uniqueWords', { count: fileWordItems.length })}</span>
              <button
                onClick={() => applyQuickStatus('known', fileWordItems.filter((item) => item.info?.status === 'unprocessed'))}
                className="ml-auto rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700"
              >
                {t('reading.markAllKnown')}
              </button>
              <button
                onClick={() => applyQuickStatus('learning', fileWordItems.filter((item) => item.info?.status === 'unprocessed'))}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                {t('reading.markAllLearning')}
              </button>
            </div>
            <div className="mb-2 flex items-center gap-2 text-xs text-gray-600">
              <button
                onClick={() => setQuickSelected(new Set(fileWordItems.map((item) => item.lemma)))}
                className="hover:text-blue-700"
              >
                {t('reading.selectAll')}
              </button>
              <button onClick={() => setQuickSelected(new Set())} className="hover:text-blue-700">{t('reading.clear')}</button>
              <span>{t('reading.selectedCount', { count: quickSelected.size })}</span>
              {quickSelected.size > 0 && (
                <>
                  <button onClick={() => applyQuickStatus('known')} className="rounded bg-green-100 px-2 py-1 text-green-700">{t('reading.markKnown')}</button>
                  <button onClick={() => applyQuickStatus('learning')} className="rounded bg-blue-100 px-2 py-1 text-blue-700">{t('reading.addLearning')}</button>
                </>
              )}
            </div>
            <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-3">
              {fileWordItems.map((item) => (
                <label key={item.lemma} className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-white">
                  <input
                    type="checkbox"
                    checked={quickSelected.has(item.lemma)}
                    onChange={() => setQuickSelected((current) => {
                      const next = new Set(current);
                      if (next.has(item.lemma)) next.delete(item.lemma);
                      else next.add(item.lemma);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600"
                  />
                  <span className={`truncate ${item.info?.status === 'known' ? 'text-green-700' : item.info?.status === 'learning' ? 'text-blue-700' : item.info?.status === 'ignored' ? 'text-gray-400' : 'text-gray-700'}`}>
                    {item.lemma}
                  </span>
                  <span className="ml-auto text-xs text-gray-400">×{item.frequency}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">{t('common.loading')}</div>
        ) : !currentFileId ? (
          <EmptyState icon="📖" title={t('reading.emptyTitle')} description={t('reading.emptyDescription')} />
        ) : segments.length === 0 ? (
          <EmptyState icon="📭" title={t('reading.emptyContent')} />
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {segments.map((seg, index) => (
              <div key={seg.id} ref={(element) => { segmentRefs.current[index] = element; }}>
                <SegmentCard
                  segment={seg}
                  wordStatusMap={wordStatusMap}
                  phrases={phraseMap.get(seg.index_num) ?? []}
                  segmentTokens={segmentTokens.get(seg.index_num)}
                  onWordClick={handleWordClick}
                  onWordContextMenu={handleWordContextMenu}
                  onPhraseClick={(phraseId) => handlePhraseClick(phraseId)}
                   showTranslation={showTranslation}
                  highlightQuery={searchQuery}
                  isActive={index === activeSegmentIndex || index === matchingSegmentIndexes[activeMatchIndex]}
                  fontSize={readingFontSize}
                  lineHeight={readingLineHeight}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {(detail || detailLoading) && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={() => setDetail(null)} />
          {detailLoading ? (
            <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex items-center justify-center text-gray-400">
              {t('common.loading')}
            </div>
          ) : detail ? (
            <WordDetailPanel
              detail={detail}
              onClose={() => setDetail(null)}
              onStatusChange={(wordId, status) => updateStatus(wordId, detail.word.lemma, status)}
              onDefinitionSave={async (wordId, definition) => {
                await invoke('update_word_definition', { wordId, definition });
                setDetail((current) => current
                  ? { ...current, word: { ...current.word, definition } }
                  : current);
                useFeedbackStore.getState().show(t('reading.definitionSaved'), 'success');
              }}
            />
          ) : null}
        </>
      )}

      {(phraseDetail || phraseDetailLoading) && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={() => setPhraseDetail(null)} />
          {phraseDetailLoading ? (
            <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex items-center justify-center text-gray-400">
              {t('common.loading')}
            </div>
          ) : phraseDetail ? (
            <PhraseDetailPanel
              detail={phraseDetail}
              onClose={() => setPhraseDetail(null)}
              onStatusChange={async (phraseId, status) => {
                await invoke('update_phrase_status', { phraseId, status });
                if (status === 'learning') {
                  await invoke('create_phrase_review_card', { phraseId });
                }
                setPhraseDetail((current) => current
                  ? { ...current, phrase: { ...current.phrase, status } }
                  : current);
              }}
              onDefinitionSave={async (phraseId, definition) => {
                await invoke('update_phrase_definition', { phraseId, definition });
                setPhraseDetail((current) => current
                  ? { ...current, phrase: { ...current.phrase, definition } }
                  : current);
                useFeedbackStore.getState().show(t('reading.definitionSaved'), 'success');
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
