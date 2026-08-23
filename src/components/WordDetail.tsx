import { X } from 'lucide-react';
import { Volume2, RefreshCw, Download, EyeOff, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { speakText } from '../lib/tts';
import type { DictionaryEntry, OccurrenceDetail, WordDetail, WordStatus } from '../lib/types';
import StatusBadge from './StatusBadge';
import OccurrenceText from './OccurrenceText';
import Pagination from './Pagination';
import DisplaySettingsMenu from './DisplaySettingsMenu';
import { usePreferencesStore } from '../stores/preferencesStore';
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
}

export default function WordDetailPanel({ detail, onClose, onStatusChange, onDefinitionSave, onOccurrenceOpen }: WordDetailProps) {
  const { t } = useTranslation();
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const definitionFontSize = usePreferencesStore((state) => state.definitionFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);
  const [definition, setDefinition] = useState(detail.word.definition ?? '');
  const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState<WordStatus | null>(null);
  const [definitionSaved, setDefinitionSaved] = useState(false);
  const [occurrences, setOccurrences] = useState<OccurrenceDetail[]>(detail.occurrences);
  const [showHidden, setShowHidden] = useState(false);
  const [hideSaving, setHideSaving] = useState(false);
  const [page, setPage] = useState(1);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
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
    try {
      const entry = await invoke<DictionaryEntry>('lookup_dictionary', {
        lemma: detail.word.lemma,
         language: detail.word.language,
        refresh,
      });
      setDictionary(entry);
    } catch (error) {
      console.error('Failed to load dictionary entry:', error);
      setDictionaryError(true);
    } finally {
      setDictionaryLoading(false);
    }
  };

  const playAudio = async () => {
    if (!dictionary) return;
    setAudioLoading(true);
    try {
      if (dictionary.local_audio_path) {
        const bytes = await invoke<number[]>('read_dictionary_audio', { lemma: detail.word.lemma, language: detail.word.language });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }));
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
      } else if (dictionary.audio_url) {
        await new Audio(dictionary.audio_url).play();
      } else {
        const text =
          detail.word.language === 'ja' && detail.word.reading
            ? detail.word.reading
            : detail.word.lemma;
        speakText(text, detail.word.language);
      }
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
      setDictionary(entry);
    } catch (error) {
      console.error('Failed to cache pronunciation:', error);
      setDictionaryError(true);
    } finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    setDictionary(null);
    setDictionaryLoading(true);
    setDictionaryError(false);
    invoke<DictionaryEntry>('lookup_dictionary', { lemma: detail.word.lemma, language: detail.word.language, refresh: false })
      .then(setDictionary)
      .catch((error) => {
        console.error('Failed to load dictionary entry:', error);
        setDictionaryError(true);
      })
      .finally(() => setDictionaryLoading(false));
  }, [detail.word.id, detail.word.lemma, detail.word.language]);

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
    <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 className={`font-semibold text-gray-900 ${CONTENT_FONT_CLASS.learning[learningTextFontSize]}`}>{detail.word.lemma}</h2>
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
              {dictionary?.phonetic && <p className={`mt-1 text-blue-700 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{dictionary.phonetic}</p>}
            </div>
            <div className="flex items-center gap-1">
              {dictionary && (
                <button
                  onClick={() => void playAudio()}
                  disabled={audioLoading}
                  aria-label={t('wordDetail.playAria')}
                  title={dictionary.audio_url ? t('wordDetail.playTitle') : t('wordDetail.systemVoiceTitle')}
                  className="rounded-md p-1.5 text-blue-600 hover:bg-blue-100 disabled:opacity-40"
                >
                  <Volume2 size={16} />
                </button>
              )}
              {dictionary?.audio_url && !dictionary.local_audio_path && (
                <button
                  onClick={() => void cacheAudio()}
                  disabled={audioLoading}
                  aria-label={t('wordDetail.cacheAria')}
                  title={t('wordDetail.cacheTitle')}
                  className="rounded-md p-1.5 text-blue-600 hover:bg-blue-100 disabled:opacity-40"
                >
                  <Download size={16} />
                </button>
              )}
              <button
                onClick={() => void loadDictionary(true)}
                disabled={dictionaryLoading}
                aria-label={t('wordDetail.refreshAria')}
                className="rounded-md p-1.5 text-gray-500 hover:bg-blue-100 disabled:opacity-40"
              >
                <RefreshCw size={15} className={dictionaryLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {dictionaryLoading && <p className="mt-2 text-xs text-gray-400">{t('wordDetail.loading')}</p>}
          {!dictionaryLoading && dictionaryError && (
            <p className="mt-2 text-xs text-gray-500">{t('wordDetail.loadError')}</p>
          )}
          {!dictionaryLoading && dictionary && (
            <div className="mt-2 space-y-2">
              {dictionary.definitions.slice(0, 5).map((item, index) => (
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
            <label className="block text-xs font-medium text-gray-500">{t('wordDetail.definitionLabel')}</label>
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
            placeholder={t('wordDetail.definitionPlaceholder')}
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
                className={`bg-gray-50 rounded-lg p-3 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-blue-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}
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
                      className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
                    >
                      <EyeOff size={14} />
                    </button>
                  )}
                </div>
                {occ.zh_text && (
                  <p className={`mt-1 text-gray-400 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{occ.zh_text}</p>
                )}
                <p className={`mt-1 text-gray-400 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
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
                    <div key={occ.id} onClick={() => onOccurrenceOpen?.(occ)} className={`bg-gray-50 rounded-lg p-3 opacity-70 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-blue-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-gray-700 leading-relaxed line-through decoration-gray-300">
                          <OccurrenceText text={occ.en_text} surface={occ.original_form} language={detail.word.language} />
                        </p>
                        <button
                          onClick={(event) => { event.stopPropagation(); void handleSetHidden(occ.id, false); }}
                          disabled={hideSaving}
                          aria-label={t('wordDetail.restoreOccurrenceAria')}
                          title={t('wordDetail.restoreOccurrence')}
                          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                      {occ.zh_text && (
                        <p className={`mt-1 text-gray-400 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{occ.zh_text}</p>
                      )}
                      <p className={`mt-1 text-gray-400 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
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
