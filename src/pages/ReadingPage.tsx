import AdaptiveMenu from '../components/AdaptiveMenu';
import Overlay from '../components/Overlay';
import { backNavigation, blocksPageShortcut } from '../lib/backNavigation';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Search, X, MoreHorizontal } from 'lucide-react';
import LookupPanel from '../components/LookupPanel';
import { useReaderStore, type ReaderToken } from '../stores/readerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import type { WordStatus } from '../lib/types';
import type { WordDetail } from '../lib/types';
import type { ContextMenuItem } from '../components/ContextMenu';
import ContextMenu from '../components/ContextMenu';
import SegmentCard from '../components/SegmentCard';
import { DisplaySettingsControls } from '../components/DisplaySettingsMenu';
import EmptyState from '../components/EmptyState';
import WordDetailPanel from '../components/WordDetail';
import PhraseDetailPanel from '../components/PhraseDetail';
import type { PhraseDetail as PhraseDetailType } from '../lib/types';
import { occurrenceRoute } from '../lib/fileProgress';
import { invalidateCaches } from '../lib/cacheInvalidation';

const STATUS_CYCLE: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];

export default function ReadingPage({ fileId }: { fileId: number }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    currentFileId,
    segments,
    wordStatusMap,
    phraseMap,
    segmentTokens,
    readerTokens,
    error: readerError,
    activeSegmentIndex,
    loading,
    setFile,
    setActiveSegmentIndex,
  } = useReaderStore();
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const definitionFontSize = usePreferencesStore((state) => state.definitionFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);
  const readingLineHeight = usePreferencesStore((state) => state.readingLineHeight);
  const setReadingLineHeight = usePreferencesStore((state) => state.setReadingLineHeight);
  const detailGeneration = useRef(0);
  const phraseGeneration = useRef(0);
  const [lookup, setLookup] = useState<{ token: ReaderToken; sentence: string } | null>(null);
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [phraseDetail, setPhraseDetail] = useState<PhraseDetailType | null>(null);
  const [phraseDetailLoading, setPhraseDetailLoading] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusQuery, setFocusQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus({ preventScroll: true });
    return backNavigation.setPage(() => { setSearchOpen(false); searchTriggerRef.current?.focus({ preventScroll: true }); return true; }, 20);
  }, [searchOpen]);
  const toolsRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Counter refs deliberately invalidate requests on cleanup; they do not hold DOM nodes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDetail(null); setPhraseDetail(null); setLookup(null); setContextMenu(null); setDetailLoading(false); setPhraseDetailLoading(false); return () => { detailGeneration.current++; phraseGeneration.current++; }; }, [fileId]);


  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number;
    lemma: string;
    wordId: number | null;
    status: WordStatus;
    token?: ReaderToken;
  } | null>(null);

  useEffect(() => {
    setFile(fileId);
  }, [fileId, setFile]);

  useEffect(() => {
    const focusType = searchParams.get('focusType');
    const rawFocusId = searchParams.get('focusId');
    if (!rawFocusId) return;
    const focusId = Number(rawFocusId);
    if (!Number.isInteger(focusId)) return;
    let timer: number | undefined;
    let active = true;
    const showFocus = (text: string) => {
      if (!active) return;
      setFocusQuery(text);
      timer = window.setTimeout(() => setFocusQuery(''), 3000);
    };
    if (focusType === 'word') {
      void invoke<WordDetail>('word_detail', { wordId: focusId }).then((value) => {
        const segmentIndex = Number(searchParams.get('segment'));
        const occurrence = value.occurrences.find((item) => item.file_id === currentFileId && item.segment_index === segmentIndex);
        showFocus(occurrence?.original_form ?? value.word.lemma);
      });
    } else if (focusType === 'phrase') {
      void invoke<PhraseDetailType>('phrase_detail', { phraseId: focusId }).then((value) => showFocus(value.phrase.text));
    }
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [currentFileId, searchParams]);

  useEffect(() => {
    if (currentFileId === null || segments.length === 0) return;
    const rawRequested = searchParams.get('segment');
    if (rawRequested !== null) {
      const requested = Number(rawRequested);
      const requestedIndex = segments.findIndex((segment) => segment.index_num === requested);
      if (requestedIndex >= 0) {
        setActiveSegmentIndex(requestedIndex);
        return;
      }
    }
    const saved = Number(localStorage.getItem(`lexicue-reading-position-${currentFileId}`));
    const nextIndex = Number.isInteger(saved) && saved >= 0 && saved < segments.length ? saved : 0;
    setActiveSegmentIndex(nextIndex);
  }, [currentFileId, searchParams, segments, setActiveSegmentIndex]);

  useEffect(() => {
    if (currentFileId !== null && segments.length > 0) {
      localStorage.setItem(`lexicue-reading-position-${currentFileId}`, String(activeSegmentIndex));
    }
    segmentRefs.current[activeSegmentIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeSegmentIndex, currentFileId, segments.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (blocksPageShortcut(event)) return;
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

  const handleWordClick = async (_lemma: string, wordId: number | null) => {
    const request = ++detailGeneration.current;
    phraseGeneration.current++; setPhraseDetailLoading(false); setPhraseDetail(null); setLookup(null); setDetail(null);
    try {
      setDetailLoading(true);
      const id = wordId;
      if (id !== null) {
        const next = await invoke<WordDetail>('word_detail', { wordId: id });
        if (request === detailGeneration.current) setDetail(next);
      }
    } catch (e) {
      if (request !== detailGeneration.current) return;
      console.error('Failed to load word detail:', e);
      useFeedbackStore.getState().show(t('reading.cannotLoadWord'), 'error');
    } finally {
      if (request === detailGeneration.current) setDetailLoading(false);
    }
  };

  const handlePhraseClick = async (phraseId: number) => {
    const request = ++phraseGeneration.current;
    detailGeneration.current++; setDetail(null); setDetailLoading(false); setLookup(null); setPhraseDetail(null);
    try {
      setPhraseDetailLoading(true);
      const detail: PhraseDetailType = await invoke('phrase_detail', { phraseId });
      if (request === phraseGeneration.current) setPhraseDetail(detail);
    } catch (e) {
      if (request !== phraseGeneration.current) return;
      console.error('Failed to load phrase detail:', e);
      useFeedbackStore.getState().show(t('reading.cannotLoadPhrase'), 'error');
    } finally {
      if (request === phraseGeneration.current) setPhraseDetailLoading(false);
    }
  };

  const updateStatus = async (wordId: number, lemma: string, status: WordStatus) => {
    try {
      await invoke('update_word_status', { wordId, status });
      if (status === 'learning') {
        await invoke('create_review_card', { wordId });
      }
      invalidateCaches('words', 'files', 'review', 'insights');
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

  const handleWordContextMenu = async (lemma: string, wordId: number | null, x: number, y: number, token?: ReaderToken) => {
    const status = wordId !== null
      ? ((wordStatusMap.get(lemma)?.status ?? 'unprocessed') as WordStatus)
      : 'unprocessed' as WordStatus;
    setContextMenu({ x, y, lemma, wordId, status, token });
  };

  const handleContextAction = async (status: WordStatus) => {
    if (!contextMenu) return;
    const { lemma, wordId } = contextMenu;

    if (wordId !== null) {
      await updateStatus(Number(wordId), lemma, status);
    }
    setContextMenu(null);
  };

  const contextItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    if (contextMenu.wordId === null) return [{ label: t('lookup.open'), onClick: () => {
      const token = contextMenu.token ?? [...readerTokens.values()].flat().find(t => t.lemma === contextMenu.lemma);
      if (token) setLookup({ token, sentence: segments.find(s => s.index_num === token.segment_index)?.en_text ?? '' });
      setContextMenu(null);
    } }];
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

  return (
    <div className="h-full flex flex-col">
      <div className="reader-tools-bar flex flex-wrap items-center gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2 ml-auto">
          <button ref={searchTriggerRef} className="ui-button reader-compact-search-trigger" aria-expanded={searchOpen} aria-label={t('reading.searchAria')} onClick={() => setSearchOpen(v => !v)}><Search size={18} /></button>
          <button
            onClick={() => setShowTranslation((visible) => !visible)}
            className="reader-desktop-control rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
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
              <AdaptiveMenu anchorRef={toolsRef} label={t('reading.tools')} onClose={() => setToolsOpen(false)}>
                <DisplaySettingsControls />
                <button className="ui-button" onClick={() => setShowTranslation(v => !v)}>{t(showTranslation ? 'reading.hideTranslation' : 'reading.showTranslation')}</button>
                <div className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-xs">
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
              </AdaptiveMenu>
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
        <div className={`reader-search-bar ${searchOpen ? 'is-open' : ''} flex flex-wrap items-center gap-2 px-4 sm:px-6 py-2 border-b border-gray-100 bg-gray-50/70`}>
          <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
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
          <div className="reader-progress ml-auto flex items-center gap-2">
            <button onClick={() => moveSegment(-1)} disabled={activeSegmentIndex === 0} className="px-2 py-1 rounded border border-gray-200 text-xs disabled:opacity-40">{t('reading.prevSegment')}</button>
            <button onClick={() => moveSegment(1)} disabled={activeSegmentIndex >= segments.length - 1} className="px-2 py-1 rounded border border-gray-200 text-xs disabled:opacity-40">{t('reading.nextSegment')}</button>
            <span className="text-xs text-gray-500">{t('reading.segmentPosition', { current: activeSegmentIndex + 1, total: segments.length })}</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${((activeSegmentIndex + 1) / segments.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="reader-content flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">{t('common.loading')}</div>
        ) : readerError ? (
          <div className="reader-load-error" role="alert"><p>{t('reading.cannotLoadFile')}</p><button className="ui-button" onClick={() => { void setFile(fileId); }}>{t('common.retry')}</button></div>
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
                  readerTokens={readerTokens.get(seg.index_num)}
                  onLookup={token => { detailGeneration.current++; phraseGeneration.current++; setDetail(null); setDetailLoading(false); setPhraseDetail(null); setPhraseDetailLoading(false); setLookup({ token, sentence: seg.en_text }); }}
                  onWordClick={handleWordClick}
                  onWordContextMenu={handleWordContextMenu}
                  onPhraseClick={(phraseId) => handlePhraseClick(phraseId)}
                   showTranslation={showTranslation}
                  highlightQuery={focusQuery || searchQuery}
                  isActive={index === activeSegmentIndex || index === matchingSegmentIndexes[activeMatchIndex]}
                  learningFontSize={learningTextFontSize}
                  definitionFontSize={definitionFontSize}
                  auxiliaryFontSize={auxiliaryFontSize}
                  lineHeight={readingLineHeight}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {lookup && <LookupPanel key={`${fileId}:${lookup.token.segment_index}:${lookup.token.start}`} token={lookup.token} sentence={lookup.sentence} onClose={() => setLookup(null)} />}
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
          {detailLoading ? (
            <Overlay variant="detail" label={t('common.loading')} onClose={() => { detailGeneration.current++; setDetail(null); setDetailLoading(false); }} className="detail-panel detail-placeholder">
              <button className="ui-button detail-placeholder__close" onClick={() => { detailGeneration.current++; setDetail(null); setDetailLoading(false); }}>{t('common.close')}</button>
              {t('common.loading')}
            </Overlay>
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
              onOccurrenceOpen={(occurrence) => {
                setDetail(null);
                navigate(occurrenceRoute(occurrence, 'word', detail.word.id));
              }}
            />
          ) : null}
        </>
      )}

      {(phraseDetail || phraseDetailLoading) && (
        <>
          {phraseDetailLoading ? (
            <Overlay variant="detail" label={t('common.loading')} onClose={() => { phraseGeneration.current++; setPhraseDetailLoading(false); setPhraseDetail(null); }} className="detail-panel detail-placeholder">
              <button className="ui-button detail-placeholder__close" onClick={() => { phraseGeneration.current++; setPhraseDetailLoading(false); setPhraseDetail(null); }}>{t('common.close')}</button>
              {t('common.loading')}
            </Overlay>
          ) : phraseDetail ? (
            <PhraseDetailPanel
              detail={phraseDetail}
              onClose={() => setPhraseDetail(null)}
              onStatusChange={async (phraseId, status) => {
                await invoke('update_phrase_status', { phraseId, status });
                if (status === 'learning') {
                  await invoke('create_phrase_review_card', { phraseId });
                }
                invalidateCaches('phrases', 'files', 'review', 'insights');
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
              onOccurrenceOpen={(occurrence) => {
                setPhraseDetail(null);
                navigate(occurrenceRoute(occurrence, 'phrase', phraseDetail.phrase.id));
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
