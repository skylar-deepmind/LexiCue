import { BookOpen, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { speakText } from '../lib/tts';
import type { DictionaryEntry, DueCard, DuePhraseCard, PhraseDictionaryEntry } from '../lib/types';
import OccurrenceText from './OccurrenceText';
import { usePreferencesStore } from '../stores/preferencesStore';
import { CONTENT_FONT_CLASS, FLASHCARD_DEFINITION_FONT_CLASS, FLASHCARD_TERM_FONT_CLASS } from '../lib/contentTypography';

interface FlashCardProps {
  card: DueCard | DuePhraseCard;
  revealed: boolean;
  onReveal: () => void;
}

function isWordCard(card: DueCard | DuePhraseCard): card is DueCard {
  return 'word_id' in card;
}

function isPhraseCard(card: DueCard | DuePhraseCard): card is DuePhraseCard {
  return 'phrase_id' in card;
}

function getWordText(card: DueCard | DuePhraseCard): string {
  if (isWordCard(card)) return card.lemma;
  if (isPhraseCard(card)) return card.text;
  return '';
}

export default function FlashCard({ card, revealed, onReveal }: FlashCardProps) {
  const { t } = useTranslation();
  const occ = card.occurrences[0];
  const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null);
  const [phraseDictionary, setPhraseDictionary] = useState<PhraseDictionaryEntry | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const wordText = getWordText(card);
  const phraseMode = isPhraseCard(card);
  const learningTextFontSize = usePreferencesStore((state) => state.learningTextFontSize);
  const definitionFontSize = usePreferencesStore((state) => state.definitionFontSize);
  const auxiliaryFontSize = usePreferencesStore((state) => state.auxiliaryFontSize);

  const playAudio = async () => {
    setAudioLoading(true);
    try {
      if (!phraseMode && dictionary?.local_audio_path) {
        const bytes = await invoke<number[]>('read_dictionary_audio', { lemma: wordText, language: card.language });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }));
        const audio = new Audio(url);
        audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
      } else if (!phraseMode && dictionary?.audio_url) {
        await new Audio(dictionary.audio_url).play();
      } else {
        const text =
          isWordCard(card) && card.language === 'ja' && card.reading
            ? card.reading
            : wordText;
        speakText(text, card.language);
      }
    } catch (error) {
      console.error('Failed to play pronunciation:', error);
    } finally {
      setAudioLoading(false);
    }
  };

  useEffect(() => {
    if (!revealed) return;
    if (phraseMode) {
      setPhraseDictionary(null);
       void invoke<PhraseDictionaryEntry>('lookup_phrase_dictionary', { text: wordText, language: card.language })
        .then(setPhraseDictionary)
        .catch(() => {});
    } else {
      setDictionary(null);
      const lookup = card.language === 'de'
        ? invoke<DictionaryEntry>('lookup_dictionary', { lemma: wordText, language: card.language, refresh: false })
        : invoke<DictionaryEntry>('get_cached_dictionary', { lemma: wordText, language: card.language });
      void lookup.then(setDictionary).catch(() => {});
    }
  }, [wordText, revealed, phraseMode, card.language]);

  return (
    <div className="w-full max-w-lg mx-auto break-words">
      <div
        onClick={() => {
          if (!revealed) onReveal();
        }}
        className={`w-full rounded-2xl border-2 bg-white p-8 transition-all duration-300 ${
          revealed ? 'border-green-200 shadow-sm' : 'cursor-pointer border-gray-200 hover:border-blue-200 hover:shadow-sm'
        }`}
      >
        <div className="flex min-h-[190px] flex-col items-center justify-center">
          <span className={`font-bold text-gray-900 ${FLASHCARD_TERM_FONT_CLASS[phraseMode ? 'phrase' : 'word'][learningTextFontSize]}`}>{wordText}</span>
        </div>

        {!revealed ? (
          <p className={`mt-4 text-center text-gray-400 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{t('flashcard.clickToReveal')}</p>
        ) : (
          <div className="mt-6 border-t border-gray-100 pt-6">
            <div className={`flex items-center gap-2 font-medium text-green-700 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
              <BookOpen size={14} />
              <span>{t('flashcard.answer')}</span>
            </div>

            {card.definition && (
              <p className={`mt-3 font-semibold text-gray-900 ${FLASHCARD_DEFINITION_FONT_CLASS[learningTextFontSize]}`}>{card.definition}</p>
            )}
            {isWordCard(card) && (card.reading || card.part_of_speech) && (
              <p className={`mt-2 text-gray-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
                {card.reading && t('flashcard.reading', { reading: card.reading })}
                {card.reading && card.part_of_speech && ' · '}
                {card.part_of_speech && t('flashcard.partOfSpeech', { pos: card.part_of_speech })}
              </p>
            )}

            {phraseMode && phraseDictionary && (
              <div className="mt-3 space-y-2 rounded-xl bg-purple-50/60 p-3">
                <div className="flex items-center gap-2">
                  <p className={`text-purple-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{phraseDictionary.translation}</p>
                  <button
                    onClick={() => void playAudio()}
                    disabled={audioLoading}
                    aria-label={t('flashcard.playAria')}
                    title={t('flashcard.playAria')}
                    className="rounded-md p-1 text-purple-600 hover:bg-purple-100 disabled:opacity-40"
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
                {phraseDictionary.category && (
                  <p className={`text-purple-500 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{phraseDictionary.category}</p>
                )}
              </div>
            )}

            {!phraseMode && dictionary && (
              <div className="mt-3 space-y-2 rounded-xl bg-blue-50/60 p-3">
                <div className="flex items-center gap-2">
                  {dictionary.phonetic && <p className={`text-blue-700 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{dictionary.phonetic}</p>}
                  <button
                    onClick={() => void playAudio()}
                    disabled={audioLoading}
                    aria-label={t('flashcard.playAria')}
                    title={t('flashcard.playAria')}
                    className="rounded-md p-1 text-blue-600 hover:bg-blue-100 disabled:opacity-40"
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
                {dictionary.definitions.slice(0, 4).map((definition, index) => (
                  <div key={`${definition.definition}-${index}`} className={`text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                    {definition.part_of_speech && <span className={`mr-1 text-blue-600 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>{definition.part_of_speech}</span>}
                    {definition.definition}
                    {definition.translation && <p className={`mt-0.5 text-gray-600 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{definition.translation}</p>}
                  </div>
                ))}
              </div>
            )}

            {!card.definition && !phraseMode && !dictionary && !phraseDictionary && (
              <p className={`mt-3 italic text-gray-400 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{t('flashcard.noDefinition')}</p>
            )}

            {occ && (
              <div className="mt-5 rounded-xl bg-gray-50 p-3">
                <p className={`leading-relaxed text-gray-700 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>
                  <OccurrenceText
                    text={occ.en_text}
                    surface={occ.original_form ?? wordText}
                    language={card.language}
                    mode={phraseMode ? 'phrase' : 'word'}
                  />
                </p>
                {occ.zh_text && <p className={`mt-1 text-gray-500 ${CONTENT_FONT_CLASS.definition[definitionFontSize]}`}>{occ.zh_text}</p>}
                <p className={`mt-2 text-gray-400 ${CONTENT_FONT_CLASS.auxiliary[auxiliaryFontSize]}`}>
                  {occ.file_name}
                  {occ.start_time && ` [${occ.start_time}]`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
