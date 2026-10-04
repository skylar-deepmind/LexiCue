import Overlay from './Overlay';
import { X, BookOpen, RefreshCw, EyeOff, Eye, Pencil, Plus, Trash2, Volume2 } from 'lucide-react';
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
import { speakText } from '../lib/tts';

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
  const [otherSensesEn, setOtherSensesEn] = useState<{ meaning_en: string; example_en: string }[]>([]);
  const [otherSensesZh, setOtherSensesZh] = useState<{ meaning_zh: string; example_en: string }[]>([]);
  const [editingOccurrence, setEditingOccurrence] = useState<number | null>(null);
  const [editingChineseOccurrence, setEditingChineseOccurrence] = useState<number | null>(null);
  const [meaningDraft, setMeaningDraft] = useState('');
  const [usageDraft, setUsageDraft] = useState('');
  const [meaningZhDraft, setMeaningZhDraft] = useState('');
  const [usageZhDraft, setUsageZhDraft] = useState('');
  const [editingSenses, setEditingSenses] = useState(false);
  const [editingSensesZh, setEditingSensesZh] = useState(false);
  const [savingExplanation, setSavingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState(false);
  const [statusSaving, setStatusSaving] = useState<WordStatus | null>(null);
  const [definitionSaved, setDefinitionSaved] = useState(false);
  const [definitionError, setDefinitionError] = useState(false);
  const [definitionSaving, setDefinitionSaving] = useState(false);
  const closingDetail = useRef(false);
  const savingDefinition = useRef<Promise<boolean> | null>(null);
  const savedDefinition = useRef(detail.phrase.definition ?? '');
  const [occurrences, setOccurrences] = useState<OccurrenceDetail[]>(detail.occurrences);
  const [showHidden, setShowHidden] = useState(false);
  const [hideSaving, setHideSaving] = useState(false);
  const [page, setPage] = useState(1);
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    setDefinition(detail.phrase.definition ?? '');
    savedDefinition.current = detail.phrase.definition ?? '';
    setDefinitionError(false);
  }, [detail.phrase.definition, detail.phrase.id]);

  useEffect(() => {
    setOccurrences(detail.occurrences);
    setShowHidden(false);
    setPage(1);
  }, [detail.phrase.id, detail.occurrences]);


  const handleStatusChange = async (status: WordStatus) => {
    if (statusSaving) return;
    setStatusSaving(status);
    try {
      await onStatusChange(detail.phrase.id, status);
    } finally {
      setStatusSaving(null);
    }
  };

  const handleDefinitionSave = async (): Promise<boolean> => {
    if (savingDefinition.current) {
      if (!await savingDefinition.current) return false;
    }
    if (definition === savedDefinition.current) return true;
    const value = definition;
    setDefinitionSaving(true);
    const save = (async () => {
      try {
        await onDefinitionSave(detail.phrase.id, value);
        savedDefinition.current = value;
        setDefinitionSaved(true); setDefinitionError(false);
        if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
        savedTimerRef.current = window.setTimeout(() => setDefinitionSaved(false), 2000);
        return true;
      } catch { setDefinitionSaved(false); setDefinitionError(true); return false; }
    })();
    savingDefinition.current = save;
    try { return await save; } finally { if (savingDefinition.current === save) { savingDefinition.current = null; setDefinitionSaving(false); } }
  };
  const requestClose = async () => {
    if (closingDetail.current) return false;
    closingDetail.current = true;
    try {
      if (statusSaving || hideSaving || savingExplanation) return false;
      if (!await handleDefinitionSave()) return false;
      if (editingOccurrence !== null && !await saveOccurrenceMeaning(editingOccurrence)) return false;
      if (editingChineseOccurrence !== null && !await saveOccurrenceMeaningZh(editingChineseOccurrence)) return false;
      if (editingSenses && !await saveOtherSenses()) return false;
      if (editingSensesZh && !await saveOtherSensesZh()) return false;
      onClose(); return true;
    } finally { closingDetail.current = false; }
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
    setOtherSensesEn([]);
    setOtherSensesZh([]);
    setExplanationError(false);
    setDictionaryLoading(true);
    invoke<PhraseDictionaryEntry>('lookup_phrase_dictionary', { text: detail.phrase.text, language: detail.phrase.language })
      .then((entry) => { setDictionary(entry); setOtherSensesEn(entry.other_senses_en ?? []); setOtherSensesZh(entry.other_senses ?? []); })
      .catch(() => {})
      .finally(() => setDictionaryLoading(false));
  }, [detail.phrase.id, detail.phrase.text, detail.phrase.language]);

  const saveOccurrenceMeaning = async (occurrenceId: number) => {
    if (!meaningDraft.trim()) { setExplanationError(true); return false; }
    setSavingExplanation(true);
    setExplanationError(false);
    try {
      await invoke('update_phrase_occurrence_meaning_en', { occurrenceId, meaningEn: meaningDraft, usageEn: usageDraft });
      setOccurrences((current) => current.map((occ) => occ.id === occurrenceId ? { ...occ, meaning_en: meaningDraft.trim(), usage_en: usageDraft.trim(), meaning_en_edited: true, collins_sense_id: null } : occ));
      setEditingOccurrence(null);
      return true;
    } catch (error) {
      console.error('Failed to save phrase meaning:', error);
      setExplanationError(true);
      return false;
    } finally { setSavingExplanation(false); }
  };

  const saveOccurrenceMeaningZh = async (occurrenceId: number) => {
    if (!meaningZhDraft.trim()) { setExplanationError(true); return false; }
    setSavingExplanation(true);
    setExplanationError(false);
    try {
      await invoke('update_phrase_occurrence_meaning', { occurrenceId, meaningZh: meaningZhDraft, usageZh: usageZhDraft });
      setOccurrences((current) => current.map((occ) => occ.id === occurrenceId ? { ...occ, meaning_zh: meaningZhDraft.trim(), usage_zh: usageZhDraft.trim(), meaning_edited: true } : occ));
      setEditingChineseOccurrence(null);
      return true;
    } catch (error) {
      console.error('Failed to save Chinese phrase meaning:', error);
      setExplanationError(true);
      return false;
    } finally { setSavingExplanation(false); }
  };

  const saveOtherSensesZh = async () => {
    if (otherSensesZh.some(sense => !sense.meaning_zh.trim() || !sense.example_en.trim())) { setExplanationError(true); return false; }
    setSavingExplanation(true);
    setExplanationError(false);
    try {
      await invoke('update_phrase_other_senses', { text: detail.phrase.text, language: detail.phrase.language, otherSenses: otherSensesZh });
      setDictionary((current) => current ? { ...current, other_senses: otherSensesZh, other_senses_edited: true } : current);
      setEditingSensesZh(false);
      return true;
    } catch (error) {
      console.error('Failed to save other Chinese phrase meanings:', error);
      setExplanationError(true);
      return false;
    } finally { setSavingExplanation(false); }
  };

  const saveOtherSenses = async () => {
    if (otherSensesEn.some(sense => !sense.meaning_en.trim() || !sense.example_en.trim())) { setExplanationError(true); return false; }
    setSavingExplanation(true);
    setExplanationError(false);
    try {
      await invoke('update_phrase_other_senses_en', { text: detail.phrase.text, otherSenses: otherSensesEn });
      setDictionary((current) => current ? { ...current, other_senses_en: otherSensesEn, other_senses_en_edited: true } : current);
      setEditingSenses(false);
      return true;
    } catch (error) {
      console.error('Failed to save other senses:', error);
      setExplanationError(true);
      return false;
    } finally { setSavingExplanation(false); }
  };

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
      case 'fixed_expression':
        return t('phraseDetail.categoryFixedExpression');
      default:
        return category;
    }
  };

  return (
    <Overlay variant="detail" label={detail.phrase.text} onClose={requestClose} className="detail-panel">
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <h2 className={`min-w-0 break-words font-semibold text-gray-900 ${CONTENT_FONT_CLASS.learning[learningTextFontSize]}`}>{detail.phrase.text}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => speakText(detail.phrase.text, detail.phrase.language)}
            disabled={typeof window === 'undefined' || !('speechSynthesis' in window)}
            aria-label={t('phraseDetail.playAria', { phrase: detail.phrase.text })}
            title={t('wordDetail.systemVoiceTitle')}
            className="phrase-audio-action flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          >
            <Volume2 size={18} aria-hidden="true" />
          </button>
          <DisplaySettingsMenu />
          <button onClick={() => void requestClose()} aria-label={t('common.close')} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
        </div>
      </div>

      <div className="detail-panel__body p-4 space-y-4">
        {definitionError && <p role="alert" className="annotation-error">{t('shell.saveFailed')}</p>}
        {explanationError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{t('phraseDetail.saveFailed')}</p>}
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
              {detail.phrase.language !== 'en' && <p className={`text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{dictionary.translation}</p>}
              {detail.phrase.language !== 'en' && dictionary.usage_zh && (
                <p className={`leading-relaxed text-gray-500 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{t('phraseDetail.usage', { usage: dictionary.usage_zh })}</p>
              )}
              {detail.phrase.language !== 'en' && <p className="text-[11px] text-gray-400">{t('phraseDetail.source', { provider: dictionary.provider })}</p>}
              {detail.phrase.language === 'en' && (
                <div className="mt-3 space-y-3">
                  <div className="dictionary-evidence">
                    <p className="dictionary-evidence__label">Collins COBUILD V3 · {t('phraseDetail.dictionaryOriginal')}</p>
                    {!!dictionary.collins_senses.length && !occurrences.some((occ) => dictionary.collins_senses.some((sense) => sense.id === occ.collins_sense_id)) && <p className="dictionary-evidence__muted">{t('phraseDetail.referenceOnly')}</p>}
                    {dictionary.collins_senses.length ? dictionary.collins_senses.map((sense) => (
                      <div key={sense.id} className="dictionary-evidence__sense">
                        <p className="dictionary-evidence__muted">{sense.headword} · {sense.grammar}{occurrences.some((occ) => occ.collins_sense_id === sense.id) && <span className="dictionary-evidence__badge">{t('phraseDetail.collinsMatched')}</span>}</p>
                        <p className={CONTENT_FONT_CLASS.definition[definitionFontSize]}>{sense.definition}</p>
                        {sense.example && <p className="dictionary-evidence__example">{sense.example}</p>}
                      </div>
                    )) : <p className="dictionary-evidence__muted">{dictionary.collins_available ? t('phraseDetail.noCollinsEntry') : t('phraseDetail.collinsUnavailable')}</p>}
                  </div>
                  <details className="dictionary-evidence" open={dictionary.other_senses.length > 0 || editingSensesZh}>
                    <summary className="dictionary-evidence__summary">{t(!dictionary.other_senses.length || dictionary.other_senses_edited ? 'phraseDetail.manualChineseSenses' : 'phraseDetail.otherChineseSenses')}</summary>
                    <div className="flex items-center justify-between gap-2">
                      <p className="dictionary-evidence__label">{t(!dictionary.other_senses.length || dictionary.other_senses_edited ? 'phraseDetail.manualChineseSenses' : 'phraseDetail.otherChineseSenses')}</p>
                      <button type="button" onClick={() => setEditingSensesZh((value) => !value)} aria-label={t('phraseDetail.editOtherChineseSenses')} className="dictionary-evidence__button"><Pencil size={14} /></button>
                    </div>
                    {!editingSensesZh && dictionary.other_senses.map((sense, index) => <div key={index} className="dictionary-evidence__sense"><p>{sense.meaning_zh}</p><p className="dictionary-evidence__example">{t(dictionary.other_senses_edited ? 'phraseDetail.manualExample' : 'phraseDetail.aiExample')} · {sense.example_en}</p></div>)}
                    {!editingSensesZh && !dictionary.other_senses.length && <p className="dictionary-evidence__muted">{t('phraseDetail.noOtherSenses')}</p>}
                    {editingSensesZh && <div className="space-y-2">{otherSensesZh.map((sense, index) => <div key={index} className="flex gap-2"><div className="flex-1 space-y-1">
                      <input aria-label={`${t('phraseDetail.chineseMeaning')} ${index + 1}`} value={sense.meaning_zh} onChange={(e) => setOtherSensesZh((current) => current.map((item, i) => i === index ? { ...item, meaning_zh: e.target.value } : item))} className="dictionary-evidence__input" />
                      <input aria-label={`${t('phraseDetail.englishExample')} ${index + 1}`} value={sense.example_en} onChange={(e) => setOtherSensesZh((current) => current.map((item, i) => i === index ? { ...item, example_en: e.target.value } : item))} className="dictionary-evidence__input" />
                    </div><button type="button" onClick={() => setOtherSensesZh((current) => current.filter((_, i) => i !== index))} aria-label={t('phraseDetail.removeOtherSense')} className="dictionary-evidence__button"><Trash2 size={14} /></button></div>)}
                    <div className="flex gap-2">{otherSensesZh.length < 2 && <button type="button" onClick={() => setOtherSensesZh((current) => [...current, { meaning_zh: '', example_en: '' }])} className="dictionary-evidence__button"><Plus size={14} /> {t('phraseDetail.addOtherSense')}</button>}
                      <button type="button" disabled={savingExplanation || otherSensesZh.some((sense) => !sense.meaning_zh.trim() || !sense.example_en.trim())} onClick={() => void saveOtherSensesZh()} className="dictionary-evidence__button">{t('common.save')}</button></div></div>}
                  </details>
                  <details className="dictionary-evidence" open={dictionary.other_senses_en.length > 0 || editingSenses}>
                    <summary className="dictionary-evidence__summary">{t(!dictionary.other_senses_en.length || dictionary.other_senses_en_edited ? 'phraseDetail.manualEnglishSenses' : 'phraseDetail.otherEnglishSenses')}</summary>
                    <div className="flex items-center justify-between gap-2"><p className="dictionary-evidence__label">{t(!dictionary.other_senses_en.length || dictionary.other_senses_en_edited ? 'phraseDetail.manualEnglishSenses' : 'phraseDetail.otherEnglishSenses')}</p>
                      <button type="button" onClick={() => setEditingSenses((value) => !value)} aria-label={t('phraseDetail.editOtherEnglishSenses')} className="dictionary-evidence__button"><Pencil size={14} /></button>
                    </div>
                    {!editingSenses && dictionary.other_senses_en.map((sense, index) => <div key={index} className="dictionary-evidence__sense"><p>{sense.meaning_en}</p><p className="dictionary-evidence__example">{t(dictionary.other_senses_en_edited ? 'phraseDetail.manualExample' : 'phraseDetail.aiExample')} · {sense.example_en}</p></div>)}
                    {!editingSenses && !dictionary.other_senses_en.length && <p className="dictionary-evidence__muted">{t('phraseDetail.noOtherSenses')}</p>}
                    {editingSenses && <div className="space-y-2">{otherSensesEn.map((sense, index) => <div key={index} className="flex gap-2"><div className="flex-1 space-y-1">
                      <input aria-label={`${t('phraseDetail.englishMeaning')} ${index + 1}`} value={sense.meaning_en} onChange={(e) => setOtherSensesEn((current) => current.map((item, i) => i === index ? { ...item, meaning_en: e.target.value } : item))} className="dictionary-evidence__input" />
                      <input aria-label={`${t('phraseDetail.englishExample')} ${index + 1}`} value={sense.example_en} onChange={(e) => setOtherSensesEn((current) => current.map((item, i) => i === index ? { ...item, example_en: e.target.value } : item))} className="dictionary-evidence__input" />
                    </div><button type="button" onClick={() => setOtherSensesEn((current) => current.filter((_, i) => i !== index))} aria-label={t('phraseDetail.removeOtherSense')} className="dictionary-evidence__button"><Trash2 size={14} /></button></div>)}
                    <div className="flex gap-2">{otherSensesEn.length < 2 && <button type="button" onClick={() => setOtherSensesEn((current) => [...current, { meaning_en: '', example_en: '' }])} className="dictionary-evidence__button"><Plus size={14} /> {t('phraseDetail.addOtherSense')}</button>}
                      <button type="button" disabled={savingExplanation || otherSensesEn.some((sense) => !sense.meaning_en.trim() || !sense.example_en.trim())} onClick={() => void saveOtherSenses()} className="dictionary-evidence__button">{t('common.save')}</button></div></div>}
                  </details>
                </div>
              )}
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
            <label className="block text-xs font-medium text-gray-500">{detail.phrase.language === 'en' ? t('phraseDetail.englishNoteLabel') : t('phraseDetail.definitionLabel')}</label>
            <div className="flex items-center gap-2">
              {definitionSaved && <span className="text-xs text-green-600">{t('common.saved')}</span>}
              <button
                onClick={() => void handleDefinitionSave()}
                disabled={definitionSaving || definition === (detail.phrase.definition ?? '')}
                className="rounded-lg bg-purple-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
          <textarea
            disabled={definitionSaving}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            onBlur={() => void handleDefinitionSave()}
            placeholder={detail.phrase.language === 'en' ? t('phraseDetail.englishNotePlaceholder') : t('phraseDetail.definitionPlaceholder')}
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
                onClick={() => { if (onOccurrenceOpen) void requestClose().then(ok => { if (ok) onOccurrenceOpen(occ); }); }}
                className={`bg-gray-50 rounded-lg p-3 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-purple-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-gray-700 leading-relaxed">
                    <OccurrenceText
                      text={occ.en_text}
                      surface={occ.surface_text ?? detail.phrase.text}
                      language={detail.phrase.language}
                      mode="phrase"
                      tokenPositions={occ.token_positions}
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
                {detail.phrase.language === 'en' && occ.meaning_zh && <div className="dictionary-evidence mt-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="dictionary-evidence__label">{t('phraseDetail.contextChineseMeaning')} · {occ.meaning_edited ? t('phraseDetail.edited') : 'AI'}</span>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setEditingChineseOccurrence(occ.id); setMeaningZhDraft(occ.meaning_zh ?? ''); setUsageZhDraft(occ.usage_zh ?? ''); }} aria-label={t('phraseDetail.editContextChineseMeaning')} className="dictionary-evidence__button"><Pencil size={14} /></button>
                  </div>
                  {editingChineseOccurrence === occ.id ? <div className="mt-1 space-y-2" onClick={(event) => event.stopPropagation()}>
                    <textarea aria-label={t('phraseDetail.contextChineseMeaning')} value={meaningZhDraft} onChange={(event) => setMeaningZhDraft(event.target.value)} className="dictionary-evidence__input" rows={2} />
                    <textarea aria-label={t('phraseDetail.chineseUsage')} value={usageZhDraft} onChange={(event) => setUsageZhDraft(event.target.value)} className="dictionary-evidence__input" rows={2} />
                    <button type="button" disabled={savingExplanation || !meaningZhDraft.trim()} onClick={() => void saveOccurrenceMeaningZh(occ.id)} className="dictionary-evidence__button">{t('common.save')}</button>
                  </div> : <><p>{occ.meaning_zh}</p>{occ.usage_zh && <p className="dictionary-evidence__muted">{occ.usage_zh}</p>}</>}
                </div>}
                {detail.phrase.language === 'en' && occ.meaning_en && <div className="dictionary-evidence mt-2 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="dictionary-evidence__label">{t('phraseDetail.contextEnglishMeaning')} · {occ.meaning_en_edited ? t('phraseDetail.edited') : 'AI'} · {dictionary?.collins_senses.some((sense) => sense.id === occ.collins_sense_id) ? t('phraseDetail.collinsMatched') : t('phraseDetail.notCollinsVerified')}</span>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setEditingOccurrence(occ.id); setMeaningDraft(occ.meaning_en ?? ''); setUsageDraft(occ.usage_en ?? ''); }} aria-label={t('phraseDetail.editContextEnglishMeaning')} className="dictionary-evidence__button"><Pencil size={14} /></button></div>
                  {editingOccurrence === occ.id ? <div className="mt-1 space-y-2" onClick={(event) => event.stopPropagation()}>
                    <textarea aria-label={t('phraseDetail.contextEnglishMeaning')} value={meaningDraft} onChange={(event) => setMeaningDraft(event.target.value)} className="dictionary-evidence__input" rows={2} />
                    <textarea aria-label={t('phraseDetail.englishUsage')} value={usageDraft} onChange={(event) => setUsageDraft(event.target.value)} className="dictionary-evidence__input" rows={2} />
                    <button type="button" disabled={savingExplanation || !meaningDraft.trim()} onClick={() => void saveOccurrenceMeaning(occ.id)} className="dictionary-evidence__button">{t('common.save')}</button>
                  </div> : <><p>{occ.meaning_en}</p>{occ.usage_en && <p className="dictionary-evidence__muted">{occ.usage_en}</p>}</>}
                </div>}
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
                    <div key={occ.id} onClick={() => { if (onOccurrenceOpen) void requestClose().then(ok => { if (ok) onOccurrenceOpen(occ); }); }} className={`bg-gray-50 rounded-lg p-3 opacity-70 ${onOccurrenceOpen ? 'cursor-pointer hover:bg-purple-50' : ''} ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-gray-700 leading-relaxed line-through decoration-gray-300">
                          <OccurrenceText
                            text={occ.en_text}
                            surface={occ.surface_text ?? detail.phrase.text}
                            language={detail.phrase.language}
                            mode="phrase"
                            tokenPositions={occ.token_positions}
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
    </Overlay>
  );
}
