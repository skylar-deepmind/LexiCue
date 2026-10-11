import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Volume2, BookOpen, ExternalLink } from 'lucide-react';
import type { DictionaryEntry, OccurrenceDetail, PhraseDetail, PhraseDictionaryEntry, WordDetail } from '../lib/types';
import { CONTENT_FONT_CLASS, FLASHCARD_TERM_FONT_CLASS } from '../lib/contentTypography';
import { usePreferencesStore } from '../stores/preferencesStore';
import { dictionaryLanguageState, useDictionaryStore } from '../stores/dictionaryStore';
import { playPronunciation, speakText } from '../lib/tts';
import OccurrenceText from './OccurrenceText';
import StatusBadge from './StatusBadge';

export default function AnnotationCard({ detail, onDetail, onOccurrence }: {
  detail: WordDetail | PhraseDetail;
  onDetail: () => void;
  onOccurrence: (occurrence: OccurrenceDetail) => void;
}) {
  const { t } = useTranslation();
  const word = 'word' in detail ? detail.word : null;
  const item = 'word' in detail ? detail.word : detail.phrase;
  const term = 'lemma' in item ? item.lemma : item.text;
  const kind = word ? 'word' : 'phrase';
  const [onlineTarget, setOnlineTarget] = useState<WordDetail | PhraseDetail | null>(null);
  const mode = onlineTarget === detail ? 'online' : 'local';
  const dictionaryReady = useDictionaryStore(state => dictionaryLanguageState(state, item.language));
  const learningSize = usePreferencesStore(state => state.learningTextFontSize);
  const definitionSize = usePreferencesStore(state => state.definitionFontSize);
  const auxiliarySize = usePreferencesStore(state => state.auxiliaryFontSize);
  const [lookup, setLookup] = useState<{
    source: WordDetail | PhraseDetail; mode: string; revision: number; ready: string;
    dictionary: DictionaryEntry | null; phraseDictionary: PhraseDictionaryEntry | null; failed: boolean;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const validLookup = lookup?.source === detail && lookup.revision === revision && lookup.mode === mode && lookup.ready === (mode === 'local' ? dictionaryReady : '');
  const dictionary = validLookup ? lookup.dictionary : null;
  const phraseDictionary = validLookup ? lookup.phraseDictionary : null;
  const loading = !validLookup;
  const failed = validLookup && lookup.failed;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const localSourceState = mode === 'local' ? dictionaryReady : '';
  useEffect(() => {
    let active = true;
    void (async () => {
      let dictionary: DictionaryEntry | null = null;
      let phraseDictionary: PhraseDictionaryEntry | null = null;
      let failed = false;
      try {
        if (kind === 'phrase') {
          const entry = await invoke<PhraseDictionaryEntry>('lookup_phrase_dictionary', { text: term, language: item.language });
          phraseDictionary = entry;
        } else {
          const entry = await invoke<DictionaryEntry>('lookup_dictionary', { lemma: term, language: item.language, mode, refresh: mode === 'online' });
          dictionary = entry;
        }
      } catch { failed = true; }
      if (active) setLookup({ source: detail, revision, mode, ready: localSourceState, dictionary, phraseDictionary, failed });
    })();
    return () => { active = false; };
  }, [item.id, term, item.language, kind, localSourceState, mode, revision, detail]);

  const play = async () => {
    if (audioLoading) return;
    setAudioLoading(true);
    try {
      if (word) await playPronunciation(word.language === 'ja' && word.reading ? word.reading : term, item.language, dictionary, entry => { if (alive.current) setLookup(current => current?.source === detail ? { ...current, dictionary: entry } : current); });
      else speakText(term, item.language);
    } finally { if (alive.current) setAudioLoading(false); }
  };
  const occurrences = detail.occurrences.filter(occ => !occ.hidden);
  const first = occurrences[0];
  const contextMeaning = first?.meaning_zh || first?.meaning_en;
  const hasPhraseMeaning = phraseDictionary && (phraseDictionary.translation || phraseDictionary.meaning_en
    || phraseDictionary.other_senses.length || phraseDictionary.other_senses_en.length || phraseDictionary.collins_senses.length);
  const font = CONTENT_FONT_CLASS.definition[definitionSize];
  return <article className="annotation-card">
    <div className="annotation-card__top">
      <div className="annotation-card__term">
        <h2 className={FLASHCARD_TERM_FONT_CLASS[kind][learningSize]}>{term}</h2>
        <button type="button" className="ui-button ui-button--icon" disabled={audioLoading || !('speechSynthesis' in window) && !dictionary?.local_audio_path && !dictionary?.audio_url}
          onClick={() => void play()} aria-label={t('annotation.play')} title={t('annotation.play')}><Volume2 size={20} aria-hidden="true" /></button>
      </div>
      <div className={`annotation-card__meta ${CONTENT_FONT_CLASS.auxiliary[auxiliarySize]}`}>
        <StatusBadge status={item.status} label={item.status === 'ignored' ? t('annotation.ignore') : undefined} /><span>{item.language.toUpperCase()}</span><span>{t('wordDetail.frequency', { count: item.frequency })}</span>
        {word?.word_kind === 'ambiguous' && <span>{t('words.ambiguousForm')}</span>}
        {word?.word_kind === 'proper_noun' && <span>{t('words.properNoun')}</span>}
        {'unverified' in item && item.unverified && <span>{t('phrases.unverifiedBadge')}</span>}
      </div>
      {word && (word.reading || word.part_of_speech) && <p className="annotation-muted">{[word.reading, word.part_of_speech].filter(Boolean).join(' · ')}</p>}
    </div>
    <section className={`annotation-card__section ${font}`} aria-label={t('annotation.meaning')}>
      <h3><BookOpen size={16} aria-hidden="true" />{t('annotation.meaning')}</h3>
      {item.definition && <p className="annotation-card__definition">{item.definition}</p>}
      {contextMeaning && <p>{contextMeaning}</p>}
      {first?.meaning_zh && first.meaning_en && <p className="annotation-muted">{first.meaning_en}</p>}
      {(first?.usage_zh || first?.usage_en) && <p className="annotation-muted">{first.usage_zh || first.usage_en}</p>}
      {dictionary?.phonetic && <p className="annotation-muted">{dictionary.phonetic}</p>}
      {dictionary?.match_kind === 'spelling_variant' && dictionary.matched_headword !== term && <p className="dictionary-match-note">{t('wordDetail.spellingVariantMatch', { headword: dictionary.matched_headword })}</p>}
      {dictionary?.definitions.map((meaning, index) => <div className="annotation-sense" key={index}>
        {meaning.part_of_speech && <span className="annotation-muted">{meaning.part_of_speech} · </span>}{meaning.definition}
        {meaning.translation && <p>{meaning.translation}</p>}{meaning.example && <p className="annotation-muted">{meaning.example}</p>}
      </div>)}
      {phraseDictionary && <div className="annotation-sense">
        {phraseDictionary.translation && <p>{phraseDictionary.translation}</p>}
        {phraseDictionary.meaning_en && <p>{phraseDictionary.meaning_en}</p>}
        {phraseDictionary.pinyin && <p className="annotation-muted">{phraseDictionary.pinyin}</p>}
        {(phraseDictionary.usage_zh || phraseDictionary.usage_en) && <p className="annotation-muted">{phraseDictionary.usage_zh || phraseDictionary.usage_en}</p>}
        {phraseDictionary.other_senses.map((sense, index) => <div className="annotation-sense" key={`zh-${index}`}><p>{sense.meaning_zh}</p><p className="annotation-muted">{sense.example_en}</p></div>)}
        {phraseDictionary.other_senses_en.map((sense, index) => <div className="annotation-sense" key={`en-${index}`}><p>{sense.meaning_en}</p><p className="annotation-muted">{sense.example_en}</p></div>)}
        {phraseDictionary.collins_senses.length > 0 && <p className="annotation-muted">Collins · {t('phraseDetail.referenceOnly')}</p>}
        {phraseDictionary.collins_senses.map(sense => <div className="annotation-sense" key={sense.id}><p className="annotation-muted">{sense.headword} · {sense.grammar}</p><p>{sense.definition}</p>{sense.example && <p className="annotation-muted">{sense.example}</p>}</div>)}
      </div>}
      {loading && <p className="annotation-muted" role="status">{t('common.loading')}</p>}
      {word && <button className="ui-button" disabled={loading} onClick={() => { setOnlineTarget(detail); setRevision(v => v + 1); }}>{t('lookup.online')}</button>}
      {!loading && failed && <div className="annotation-dictionary-error"><p className="annotation-muted">{t('annotation.dictionaryUnavailable')}</p><button type="button" className="ui-button" onClick={() => setRevision(value => value + 1)}>{t('common.retry')}</button></div>}
      {!loading && !failed && !item.definition && !contextMeaning && !dictionary?.definitions.length && !hasPhraseMeaning && <p className="annotation-muted">{t('flashcard.noDefinition')}</p>}
    </section>
    <section className={`annotation-card__section ${font}`} aria-label={t('annotation.context')}>
      <h3>{t('annotation.context')}</h3>
      {occurrences.slice(0, expanded ? undefined : 1).map(occ => <div className="annotation-occurrence" key={occ.id}>
        <p><OccurrenceText text={occ.en_text} surface={occ.surface_text ?? occ.original_form ?? term} language={item.language} mode={kind} tokenPositions={occ.token_positions} /></p>
        {occ.zh_text && <p className="annotation-muted">{occ.zh_text}</p>}
        <button type="button" className="annotation-source" onClick={() => onOccurrence(occ)}><ExternalLink size={14} aria-hidden="true" />{occ.file_name}{occ.start_time ? ` · ${occ.start_time}` : ''}<span className="sr-only">{t('annotation.openOriginal')}</span></button>
      </div>)}
      {!occurrences.length && <p className="annotation-muted">{t('annotation.noContext')}</p>}
      {occurrences.length > 1 && <button type="button" className="ui-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t(expanded ? 'annotation.lessContext' : 'annotation.moreContext', { count: occurrences.length - 1 })}</button>}
    </section>
    <button type="button" className="ui-button" onClick={onDetail}>{t('annotation.openDetail')}</button>
  </article>;
}
