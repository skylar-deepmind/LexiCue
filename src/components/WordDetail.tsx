import { X, Volume2, RefreshCw, Download, EyeOff, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { playPronunciation } from '../lib/tts';
import type { DictionaryEntry, OccurrenceDetail, WordDetail, WordStatus } from '../lib/types';
import StatusBadge from './StatusBadge';
import OccurrenceText from './OccurrenceText';
import Pagination from './Pagination';
import DisplaySettingsMenu from './DisplaySettingsMenu';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useDictionaryStore } from '../stores/dictionaryStore';
import { CONTENT_FONT_CLASS } from '../lib/contentTypography';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

const OCCURRENCE_PAGE_SIZE = 5;

interface WordDetailProps {
  detail: WordDetail;
  onClose: () => void;
  onStatusChange: (wordId: number, status: WordStatus) => Promise<void>;
  onDefinitionSave: (wordId: number, definition: string) => Promise<void>;
  onOccurrenceOpen?: (occurrence: OccurrenceDetail) => void;
  onWordResolved?: () => void;
}

export default function WordDetailPanel({ detail, onClose, onStatusChange, onDefinitionSave, onOccurrenceOpen, onWordResolved }: WordDetailProps) {
  const { t } = useTranslation();
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const definitionFontSize = usePreferencesStore((state) => state.definitionFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);
  const dictionaryReady = useDictionaryStore((state) => state.ready);
  const [definition, setDefinition] = useState(detail.word.definition ?? '');
  const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null);
  const [onlineDictionary, setOnlineDictionary] = useState<DictionaryEntry | null>(null);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState(false);
  const [localDictionaryState, setLocalDictionaryState] = useState<'idle' | 'loading' | 'hit' | 'missing' | 'unavailable'>('idle');
  const [onlineDictionaryError, setOnlineDictionaryError] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState<WordStatus | null>(null);
  const [definitionSaved, setDefinitionSaved] = useState(false);
  const [occurrences, setOccurrences] = useState<OccurrenceDetail[]>(detail.occurrences);
  const [showHidden, setShowHidden] = useState(false);
  const [hideSaving, setHideSaving] = useState(false);
  const [page, setPage] = useState(1);
  const savedTimerRef = useRef<number | null>(null);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [lemmaCandidates, setLemmaCandidates] = useState<string[]>([]);
  const [selectedLemma, setSelectedLemma] = useState(detail.word.lemma);

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelTitleRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    setDefinition(detail.word.definition ?? '');
  }, [detail.word.definition, detail.word.id]);

  useEffect(() => {
    setOccurrences(detail.occurrences);
    setShowHidden(false);
    setPage(1);
  }, [detail.word.id, detail.occurrences]);

  useEffect(() => {
    setSelectedLemma(detail.word.lemma);
    if (detail.word.word_kind !== 'ambiguous') { setLemmaCandidates([]); return; }
    void invoke<string[]>('english_word_candidates', { word: detail.word.lemma }).then(setLemmaCandidates).catch(() => setLemmaCandidates([detail.word.lemma]));
  }, [detail.word.id, detail.word.lemma, detail.word.word_kind]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleStatusChange = async (status: WordStatus) => {
    if (statusSaving) return;
    setStatusSaving(status);
    try {
      await onStatusChange(detail.word.id, status);
    } finally {
      setStatusSaving(null);
    }
  };

  const handleDefinitionSave = async () => {
    if (definition === (detail.word.definition ?? '')) return;
    try {
      await onDefinitionSave(detail.word.id, definition);
      setDefinitionSaved(true);
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setDefinitionSaved(false), 2000);
    } catch {
      setDefinitionSaved(false);
    }
  };

  const handleSetHidden = async (occurrenceId: number, hidden: boolean) => {
    if (hideSaving) return;
    setHideSaving(true);
    try {
      await invoke('set_occurrence_hidden', { occurrenceId, hidden });
      setOccurrences((current) => current.map((occ) => (occ.id === occurrenceId ? { ...occ, hidden } : occ)));
    } catch (error) {
      console.error('Failed to update occurrence visibility:', error);
    } finally {
      setHideSaving(false);
    }
  };

  const loadDictionary = async (refresh = false) => {
    setDictionaryLoading(true);
    setDictionaryError(false);
    setOnlineDictionaryError(false);
    try {
      const entry = await invoke<DictionaryEntry>('lookup_dictionary', {
        lemma: detail.word.lemma,
        language: detail.word.language,
        refresh,
      });
      if (detail.word.language === 'en') {
        if (entry.provider.startsWith('dictionaryapi.dev')) setOnlineDictionary(entry);
      } else {
        setDictionary(entry);
      }
    } catch (error) {
      console.error('Failed to load dictionary entry:', error);
      setDictionaryError(true);
      if (detail.word.language === 'en' && dictionary) setOnlineDictionaryError(true);
    } finally {
      setDictionaryLoading(false);
    }
  };

  const playAudio = async () => {
    setAudioLoading(true);
    try {
      const text = detail.word.language === 'ja' && detail.word.reading ? detail.word.reading : detail.word.lemma;
      const audioEntry = onlineDictionary?.local_audio_path ? onlineDictionary : dictionary?.local_audio_path ? dictionary : onlineDictionary ?? dictionary;
      await playPronunciation(text, detail.word.language, audioEntry, (cached) => {
        if (cached.provider.startsWith('dictionaryapi.dev')) setOnlineDictionary(cached);
        else setDictionary(cached);
      });
    } catch (error) {
      console.error('Failed to play pronunciation:', error);
      setDictionaryError(true);
    } finally {
      setAudioLoading(false);
    }
  };

  const cacheAudio = async () => {
    setAudioLoading(true);
    try {
      const entry = await invoke<DictionaryEntry>('cache_dictionary_audio', { lemma: detail.word.lemma, language: detail.word.language });
      if (detail.word.language === 'en' && entry.provider.startsWith('dictionaryapi.dev')) setOnlineDictionary(entry);
      else setDictionary(entry);
    } catch (error) {
      console.error('Failed to cache pronunciation:', error);
      setDictionaryError(true);
    } finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setDictionary(null);
    setOnlineDictionary(null);
    setDictionaryLoading(true);
    setDictionaryError(false);
    setOnlineDictionaryError(false);
    setLocalDictionaryState(detail.word.language === 'en' ? 'loading' : 'idle');
    void (async () => {
      try {
        if (detail.word.language === 'en') {
          try {
            const local = await invoke<DictionaryEntry>('lookup_local_dictionary', { lemma: detail.word.lemma });
            if (active) { setDictionary(local); setLocalDictionaryState('hit'); }
            try {
              const online = await invoke<DictionaryEntry>('lookup_dictionary', { lemma: detail.word.lemma, language: 'en', refresh: true });
              if (active && online.provider.startsWith('dictionaryapi.dev')) setOnlineDictionary(online);
            } catch (onlineError) {
              console.info('Online dictionary supplement unavailable:', onlineError);
              if (active) setOnlineDictionaryError(true);
            }
            return;
          } catch (error) {
            const message = String(error);
            if (active) setLocalDictionaryState(message.includes('not installed') ? 'unavailable' : 'missing');
            if (!message.includes('Collins entry not found:') && !message.includes('Collins index is not installed')) throw error;
          }
        }
        const entry = await invoke<DictionaryEntry>('lookup_dictionary', { lemma: detail.word.lemma, language: detail.word.language, refresh: false });
        if (!active) return;
        if (detail.word.language === 'en' && entry.provider.startsWith('dictionaryapi.dev')) setOnlineDictionary(entry);
        else setDictionary(entry);
      } catch (error) {
        console.error('Failed to load dictionary entry:', error);
        if (active) setDictionaryError(true);
      } finally {
        if (active) setDictionaryLoading(false);
      }
    })();
    return () => { active = false; };
  }, [detail.word.id, detail.word.lemma, detail.word.language, dictionaryReady]);

  const statuses: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];
  const visibleOccurrences = occurrences.filter((occ) => !occ.hidden);
  const hiddenOccurrences = occurrences.filter((occ) => occ.hidden);
  const totalPages = Math.max(1, Math.ceil(visibleOccurrences.length / OCCURRENCE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedOccurrences = visibleOccurrences.slice(
    (currentPage - 1) * OCCURRENCE_PAGE_SIZE,
    currentPage * OCCURRENCE_PAGE_SIZE,
  );

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="word-detail-title">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 ref={panelTitleRef} tabIndex={-1} id="word-detail-title" className={`font-semibold text-gray-900 outline-none ${CONTENT_FONT_CLASS.learning[learningTextFontSize]}`}>{detail.word.lemma}</h2>
        <div className="flex items-center gap-1">
          <DisplaySettingsMenu />
          <button onClick={onClose} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={detail.word.status} />
          <span className={`${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]} text-gray-500`}>{t('wordDetail.frequency', { count: detail.word.frequency })}</span>
        </div>
        {detail.word.baseline_pending && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">此词由高频词基线预先跳过，尚待确认。它会自然出现在每日单词复习中；也可在这里直接改为“学习中”。</p>
        )}
        {detail.word.word_kind === 'ambiguous' && (
          <div className="word-context-box">
            <p className="mb-2 text-xs font-medium">{t('wordDetail.confirmBaseForm')}</p>
            <div className="flex gap-2">
              <select className="dictionary-evidence__input" value={selectedLemma} onChange={(event) => setSelectedLemma(event.target.value)}>
                {lemmaCandidates.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
              </select>
              <button className="word-context-action shrink-0" onClick={async () => { await invoke('resolve_word_lemma', { wordId: detail.word.id, lemma: selectedLemma }); onWordResolved?.(); }}>{t('wordDetail.confirmBaseFormAction')}</button>
            </div>
            <p className="mt-1 text-[11px] opacity-70">{t('wordDetail.keepCurrentFormHint')}</p>
          </div>
        )}
        {(detail.word.reading || detail.word.part_of_speech) && (
          <div className={`rounded-lg bg-gray-50 px-3 py-2 text-gray-600 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
            {detail.word.reading && <span className="mr-3">{t('wordDetail.reading', { reading: detail.word.reading })}</span>}
            {detail.word.part_of_speech && <span>{t('wordDetail.partOfSpeech', { pos: detail.word.part_of_speech })}</span>}
          </div>
        )}

        <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className={`font-medium text-gray-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{t('wordDetail.dictionaryTitle')}</h3>
              {(dictionary?.phonetic ?? onlineDictionary?.phonetic) && <p className={`mt-1 text-blue-700 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{dictionary?.phonetic ?? onlineDictionary?.phonetic}</p>}
            </div>
            <div className="flex items-center gap-1">
              {(dictionary || onlineDictionary || detail.word.language === 'en') && (
                <button
                  onClick={() => void playAudio()}
                  disabled={audioLoading}
                  aria-label={t('wordDetail.playAria')}
                  title={onlineDictionary?.local_audio_path || dictionary?.local_audio_path ? t('wordDetail.playTitle') : t('wordDetail.systemVoiceTitle')}
                  className="word-audio-action rounded-md p-1.5 text-blue-600 hover:bg-blue-100"
                >
                  <Volume2 size={16} />
                </button>
              )}
              {(onlineDictionary ?? dictionary)?.audio_url && !(onlineDictionary ?? dictionary)?.local_audio_path && (
                <button
                  onClick={() => void cacheAudio()}
                  disabled={audioLoading}
                  aria-label={t('wordDetail.cacheAria')}
                  title={t('wordDetail.cacheTitle')}
                  className="word-audio-action rounded-md p-1.5 text-blue-600 hover:bg-blue-100"
                >
                  <Download size={16} />
                </button>
              )}
              <button
                onClick={() => void loadDictionary(true)}
                disabled={dictionaryLoading}
                aria-label={t('wordDetail.refreshAria')}
                className="word-audio-action rounded-md p-1.5 text-gray-500 hover:bg-blue-100"
              >
                <RefreshCw size={15} className={dictionaryLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {dictionaryLoading && <p className="mt-2 text-xs text-gray-400">{dictionary ? t('wordDetail.onlineLoading') : t('wordDetail.loading')}</p>}
          {!dictionaryLoading && dictionaryError && !dictionary && (
            <p className="mt-2 text-xs text-gray-500">{localDictionaryState === 'missing' ? t('wordDetail.noResults') : localDictionaryState === 'unavailable' ? t('wordDetail.localUnavailable') : t('wordDetail.loadError')}</p>
          )}
          {localDictionaryState === 'missing' && (dictionaryLoading || onlineDictionary) && <p className="mt-2 text-xs text-gray-500">{t('wordDetail.localNoEntry')}</p>}
          {onlineDictionaryError && dictionary && <p className="mt-2 text-xs text-gray-500">{t('wordDetail.onlineFailedLocalKept')}</p>}
          {!dictionaryLoading && !dictionaryError && localDictionaryState === 'missing' && !dictionary && !onlineDictionary && <p className="mt-2 text-xs text-gray-500">{t('wordDetail.localNoEntry')}</p>}
          {dictionary && (
            <div className="mt-2 space-y-2">
              {detail.word.language === 'en' && <p className="text-xs font-medium text-blue-700">{t('wordDetail.offlineMeaning')}</p>}
              {dictionary.match_kind === 'spelling_variant' && dictionary.matched_headword !== detail.word.lemma && (
                <p className="dictionary-match-note">{t('wordDetail.spellingVariantMatch', { headword: dictionary.matched_headword })}</p>
              )}
              {(dictionary.provider === 'Collins COBUILD V3' ? dictionary.definitions : dictionary.definitions.slice(0, 5)).map((item, index) => (
                <div key={`${item.definition}-${index}`} className={`text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                  {item.part_of_speech && <span className={`mr-1 text-blue-600 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{item.part_of_speech}</span>}
                  {item.definition}
                  {item.translation && <p className={`mt-0.5 text-gray-600 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{item.translation}</p>}
                  {item.example && <p className={`mt-0.5 italic text-gray-500 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>“{item.example}”</p>}
                </div>
              ))}
              <p className="text-[11px] text-gray-400">{t('wordDetail.source', { provider: dictionary.provider })}</p>
            </div>
          )}
          {onlineDictionary && detail.word.language === 'en' && (
            <div className="mt-3 space-y-2 border-t border-blue-100 pt-3">
              <p className="text-xs font-medium text-blue-700">{t('wordDetail.onlineMeanings')}</p>
              {onlineDictionary.definitions.slice(0, 5).map((item, index) => (
                <div key={`${item.definition}-${index}`} className={`text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                  {item.part_of_speech && <span className={`mr-1 text-blue-600 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{item.part_of_speech}</span>}
                  {item.definition}
                  {item.example && <p className={`mt-0.5 italic text-gray-500 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>“{item.example}”</p>}
                </div>
              ))}
              <p className="text-[11px] text-gray-400">{t('wordDetail.source', { provider: onlineDictionary.provider })}</p>
            </div>
          )}
        </section>

        <div className="flex gap-1 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => void handleStatusChange(s)}
              disabled={statusSaving !== null}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                detail.word.status === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } ${statusSaving === s ? 'opacity-60' : ''} disabled:cursor-not-allowed`}
            >
              {statusSaving === s && <RefreshCw size={12} className="animate-spin" />}
              {t(`status.${s}`)}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-500">{detail.word.language === 'en' ? '英文释义笔记' : t('wordDetail.definitionLabel')}</label>
            <div className="flex items-center gap-2">
              {definitionSaved && <span className="text-xs text-green-600">{t('common.saved')}</span>}
              <button
                onClick={() => void handleDefinitionSave()}
                disabled={definition === (detail.word.definition ?? '')}
                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            onBlur={() => void handleDefinitionSave()}
            placeholder={detail.word.language === 'en' ? '记录自己的英文理解…' : t('wordDetail.definitionPlaceholder')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={2}
          />
        </div>

        <div>
          <h3 className={`mb-2 font-medium text-gray-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{t('wordDetail.occurrences', { count: visibleOccurrences.length })}</h3>
          <div className="space-y-2">
            {pagedOccurrences.map((occ) => (
              <div
                key={occ.id}
                onClick={() => onOccurrenceOpen?.(occ)}
                className={`word-occurrence bg-gray-50 rounded-lg p-3 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-blue-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-gray-700 leading-relaxed">
                    <OccurrenceText text={occ.en_text} surface={occ.original_form} language={detail.word.language} />
                  </p>
                  {visibleOccurrences.length >= 2 && (
                    <button
                      onClick={(event) => { event.stopPropagation(); void handleSetHidden(occ.id, true); }}
                      disabled={hideSaving}
                      aria-label={t('wordDetail.hideOccurrenceAria')}
                      title={t('wordDetail.hideOccurrence')}
                      className="word-occurrence__visibility shrink-0 rounded-md p-1.5"
                    >
                      <EyeOff size={14} />
                    </button>
                  )}
                </div>
                {occ.zh_text && (
                  <p className={`word-occurrence__secondary mt-1 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{occ.zh_text}</p>
                )}
                <p className={`word-occurrence__secondary mt-1 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
                  {occ.file_name}
                  {occ.start_time && <span className="ml-2">[{occ.start_time}]</span>}
                </p>
              </div>
            ))}
          </div>

          {visibleOccurrences.length > OCCURRENCE_PAGE_SIZE && (
            <Pagination
              page={currentPage}
              pageSize={OCCURRENCE_PAGE_SIZE}
              total={visibleOccurrences.length}
              onPageChange={setPage}
            />
          )}

          {hiddenOccurrences.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowHidden((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <Eye size={14} />
                {t('wordDetail.hiddenOccurrences', { count: hiddenOccurrences.length })}
              </button>
              {showHidden && (
                <div className="mt-2 space-y-2">
                  {hiddenOccurrences.map((occ) => (
                    <div key={occ.id} onClick={() => onOccurrenceOpen?.(occ)} className={`word-occurrence bg-gray-50 rounded-lg p-3 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-blue-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-gray-700 leading-relaxed line-through decoration-gray-300">
                          <OccurrenceText text={occ.en_text} surface={occ.original_form} language={detail.word.language} />
                        </p>
                        <button
                          onClick={(event) => { event.stopPropagation(); void handleSetHidden(occ.id, false); }}
                          disabled={hideSaving}
                          aria-label={t('wordDetail.restoreOccurrenceAria')}
                          title={t('wordDetail.restoreOccurrence')}
                          className="word-occurrence__visibility shrink-0 rounded-md p-1.5"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                      {occ.zh_text && (
                        <p className={`word-occurrence__secondary mt-1 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{occ.zh_text}</p>
                      )}
                      <p className={`word-occurrence__secondary mt-1 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
                        {occ.file_name}
                        {occ.start_time && <span className="ml-2">[{occ.start_time}]</span>}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
