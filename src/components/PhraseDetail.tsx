import { X, BookOpen, RefreshCw, EyeOff, Eye } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import type { OccurrenceDetail, PhraseDetail, PhraseDictionaryEntry, WordStatus } from '../lib/types';
import StatusBadge from './StatusBadge';
import OccurrenceText from './OccurrenceText';
import Pagination from './Pagination';
import DisplaySettingsMenu from './DisplaySettingsMenu';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CONTENT_FONT_CLASS } from '../lib/contentTypography';

const OCCURRENCE_PAGE_SIZE = 5;

interface PhraseDetailProps {
  detail: PhraseDetail;
  onClose: () => void;
  onStatusChange: (phraseId: number, status: WordStatus) => Promise<void>;
  onDefinitionSave: (phraseId: number, definition: string) => Promise<void>;
  onOccurrenceOpen?: (occurrence: OccurrenceDetail) => void;
}

export default function PhraseDetailPanel({ detail, onClose, onStatusChange, onDefinitionSave, onOccurrenceOpen }: PhraseDetailProps) {
  const { t } = useTranslation();
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const definitionFontSize = usePreferencesStore((state) => state.definitionFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);
  const [definition, setDefinition] = useState(detail.phrase.definition ?? '');
  const [dictionary, setDictionary] = useState<PhraseDictionaryEntry | null>(null);
  const [dictionaryLoading, setDictionaryLoading] = useState(false);
  const [statusSaving, setStatusSaving] = useState<WordStatus | null>(null);
  const [definitionSaved, setDefinitionSaved] = useState(false);
  const [occurrences, setOccurrences] = useState<OccurrenceDetail[]>(detail.occurrences);
  const [showHidden, setShowHidden] = useState(false);
  const [hideSaving, setHideSaving] = useState(false);
  const [page, setPage] = useState(1);
  const savedTimerRef = useRef<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeButtonRef.current?.focus(); }, []);

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    setDefinition(detail.phrase.definition ?? '');
  }, [detail.phrase.definition, detail.phrase.id]);

  useEffect(() => {
    setOccurrences(detail.occurrences);
    setShowHidden(false);
    setPage(1);
  }, [detail.phrase.id, detail.occurrences]);

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
      await onStatusChange(detail.phrase.id, status);
    } finally {
      setStatusSaving(null);
    }
  };

  const handleDefinitionSave = async () => {
    if (definition === (detail.phrase.definition ?? '')) return;
    try {
      await onDefinitionSave(detail.phrase.id, definition);
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
      await invoke('set_phrase_occurrence_hidden', { occurrenceId, hidden });
      setOccurrences((current) => current.map((occ) => (occ.id === occurrenceId ? { ...occ, hidden } : occ)));
    } catch (error) {
      console.error('Failed to update occurrence visibility:', error);
    } finally {
      setHideSaving(false);
    }
  };

  useEffect(() => {
    setDictionary(null);
    setDictionaryLoading(true);
    invoke<PhraseDictionaryEntry>('lookup_phrase_dictionary', { text: detail.phrase.text, language: detail.phrase.language })
      .then(setDictionary)
      .catch(() => {})
      .finally(() => setDictionaryLoading(false));
  }, [detail.phrase.id, detail.phrase.text, detail.phrase.language]);

  const statuses: WordStatus[] = ['unprocessed', 'learning', 'known', 'ignored'];
  const visibleOccurrences = occurrences.filter((occ) => !occ.hidden);
  const hiddenOccurrences = occurrences.filter((occ) => occ.hidden);
  const totalPages = Math.max(1, Math.ceil(visibleOccurrences.length / OCCURRENCE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedOccurrences = visibleOccurrences.slice(
    (currentPage - 1) * OCCURRENCE_PAGE_SIZE,
    currentPage * OCCURRENCE_PAGE_SIZE,
  );

  const sourceLabel = detail.phrase.source === 'manual' ? t('phraseDetail.sourceManual') : t('phraseDetail.sourceAuto');
  const sourceColor = detail.phrase.source === 'manual' ? 'text-purple-600 bg-purple-50' : 'text-teal-600 bg-teal-50';

  const categoryLabel = (category: string): string => {
    switch (category) {
      case 'phrasal_verb':
        return t('phraseDetail.categoryPhrasalVerb');
      case 'idiom':
        return t('phraseDetail.categoryIdiom');
      case 'collocation':
        return t('phraseDetail.categoryCollocation');
      default:
        return category;
    }
  };

  return (
    <aside role="dialog" aria-modal="true" aria-labelledby="phrase-detail-title" className="ui-sheet fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l sm:w-96">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 id="phrase-detail-title" className={`font-semibold text-gray-900 ${CONTENT_FONT_CLASS.learning[learningTextFontSize]}`}>{detail.phrase.text}</h2>
        <div className="flex items-center gap-1">
          <DisplaySettingsMenu />
          <button ref={closeButtonRef} onClick={onClose} aria-label={t('common.close')} className="ui-icon-button"><X size={20} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={detail.phrase.status} />
          <span className={`${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]} text-gray-500`}>{t('phraseDetail.frequency', { count: detail.phrase.frequency })}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceColor}`}>
            {sourceLabel}
          </span>
        </div>

        <section className="rounded-xl border border-purple-100 bg-purple-50/40 p-3">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-purple-500" />
            <h3 className={`font-medium text-gray-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{t('phraseDetail.dictionaryTitle')}</h3>
          </div>
          {dictionaryLoading && <p className="mt-2 text-xs text-gray-400">{t('phraseDetail.loading')}</p>}
          {!dictionaryLoading && dictionary && (
            <div className="mt-2 space-y-1">
              {dictionary.category && (
                <span className="inline-block text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">
                  {categoryLabel(dictionary.category)}
                </span>
              )}
              {dictionary.pinyin && (
                <p className={`text-purple-600 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{dictionary.pinyin}</p>
              )}
              <p className={`text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{dictionary.translation}</p>
              {dictionary.usage_zh && (
                <p className={`leading-relaxed text-gray-500 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{t('phraseDetail.usage', { usage: dictionary.usage_zh })}</p>
              )}
              <p className="text-[11px] text-gray-400">{t('phraseDetail.source', { provider: dictionary.provider })}</p>
            </div>
          )}
          {!dictionaryLoading && !dictionary && (
            <p className="mt-2 text-xs text-gray-400">{t('phraseDetail.noDictionary')}</p>
          )}
        </section>

        <div className="flex gap-1 flex-wrap">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => void handleStatusChange(s)}
              disabled={statusSaving !== null}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                detail.phrase.status === s
                  ? 'bg-purple-600 text-white'
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
            <label className="block text-xs font-medium text-gray-500">{t('phraseDetail.definitionLabel')}</label>
            <div className="flex items-center gap-2">
              {definitionSaved && <span className="text-xs text-green-600">{t('common.saved')}</span>}
              <button
                onClick={() => void handleDefinitionSave()}
                disabled={definition === (detail.phrase.definition ?? '')}
                className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            onBlur={() => void handleDefinitionSave()}
            placeholder={t('phraseDetail.definitionPlaceholder')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
            rows={2}
          />
        </div>

        <div>
          <h3 className={`mb-2 font-medium text-gray-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{t('phraseDetail.occurrences', { count: visibleOccurrences.length })}</h3>
          <div className="space-y-2">
            {pagedOccurrences.map((occ) => (
              <div
                key={occ.id}
                onClick={() => onOccurrenceOpen?.(occ)}
                className={`bg-gray-50 rounded-lg p-3 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-purple-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-gray-700 leading-relaxed">
                    <OccurrenceText
                      text={occ.en_text}
                      surface={detail.phrase.text}
                      language={detail.phrase.language}
                      mode="phrase"
                      highlightClassName="rounded-sm bg-purple-50/60 font-medium text-purple-700"
                    />
                  </p>
                  {visibleOccurrences.length >= 2 && (
                    <button
                      onClick={(event) => { event.stopPropagation(); void handleSetHidden(occ.id, true); }}
                      disabled={hideSaving}
                      aria-label={t('phraseDetail.hideOccurrenceAria')}
                      title={t('phraseDetail.hideOccurrence')}
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
                {t('phraseDetail.hiddenOccurrences', { count: hiddenOccurrences.length })}
              </button>
              {showHidden && (
                <div className="mt-2 space-y-2">
                  {hiddenOccurrences.map((occ) => (
                    <div key={occ.id} onClick={() => onOccurrenceOpen?.(occ)} className={`bg-gray-50 rounded-lg p-3 opacity-70 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-purple-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-gray-700 leading-relaxed line-through decoration-gray-300">
                          <OccurrenceText
                            text={occ.en_text}
                            surface={detail.phrase.text}
                            language={detail.phrase.language}
                            mode="phrase"
                            highlightClassName="rounded-sm bg-purple-50/60 font-medium text-purple-700"
                          />
                        </p>
                        <button
                          onClick={(event) => { event.stopPropagation(); void handleSetHidden(occ.id, false); }}
                          disabled={hideSaving}
                          aria-label={t('phraseDetail.restoreOccurrenceAria')}
                          title={t('phraseDetail.restoreOccurrence')}
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
    </aside>
  );
}
