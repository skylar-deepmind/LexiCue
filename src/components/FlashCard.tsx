import { BookOpen, Volume2 } from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { speakText } from '../lib/tts';
import { lemmatize } from '../lib/lemmatizer';
import type { DictionaryEntry, DueCard, DuePhraseCard, PhraseDictionaryEntry } from '../lib/types';

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

interface SentencePiece {
  text: string;
  isWord: boolean;
  clean: string;
}

function splitSentence(text: string): SentencePiece[] {
  const raw = text.split(/(\s+)/).filter(Boolean);
  return raw.map((token) => {
    if (/^\s+$/.test(token)) return { text: token, isWord: false, clean: '' };
    const clean = token.replace(/[^\p{Script=Latin}'-]/gu, '').toLowerCase();
    const isWord = clean.length > 0 && (clean === 'a' || clean === 'i' || (clean.length > 1 && /^\p{Script=Latin}+$/u.test(clean)));
    return { text: token, isWord, clean };
  });
}

function renderCjkSentence(enText: string, surface: string): ReactNode {
  if (!surface) return enText;
  const parts = enText.split(surface);
  if (parts.length === 1) return enText;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && (
        <span className="rounded-sm bg-blue-50/60 font-medium text-blue-700">{surface}</span>
      )}
    </Fragment>
  ));
}

function renderOccurrenceSentence(
  enText: string,
  card: DueCard | DuePhraseCard,
  originalForm: string | null,
): ReactNode {
  if (isPhraseCard(card)) {
    const pieces = splitSentence(enText);
    const phraseWords = card.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const highlighted = new Set<number>();
    if (phraseWords.length > 0) {
      for (let i = 0; i < pieces.length; i++) {
        if (!pieces[i].isWord || pieces[i].clean !== phraseWords[0]) continue;
        const matchIndexes: number[] = [];
        let wordIndex = 0;
        for (let j = i; j < pieces.length && wordIndex < phraseWords.length; j++) {
          if (!pieces[j].isWord) continue;
          if (pieces[j].clean !== phraseWords[wordIndex]) break;
          matchIndexes.push(j);
          wordIndex++;
        }
        if (wordIndex === phraseWords.length) {
          for (const index of matchIndexes) highlighted.add(index);
          break;
        }
      }
    }
    return pieces.map((piece, index) => (
      <span key={index} className={highlighted.has(index) ? 'rounded-sm bg-blue-50/60 font-medium text-blue-700' : undefined}>
        {piece.text}
      </span>
    ));
  }

  if (card.language === 'ja' || card.language === 'zh') {
    return renderCjkSentence(enText, originalForm ?? '');
  }

  if (card.language === 'de') {
    const pieces = splitSentence(enText);
    const target = (originalForm ?? card.lemma).toLowerCase();
    return pieces.map((piece, index) => {
      const matched = piece.isWord && piece.clean === target;
      return (
        <span key={index} className={matched ? 'rounded-sm bg-blue-50/60 font-medium text-blue-700' : undefined}>
          {piece.text}
        </span>
      );
    });
  }

  const pieces = splitSentence(enText);
  const highlighted = new Set<number>();
  let matched = false;
  pieces.forEach((piece, index) => {
    if (piece.isWord && lemmatize(piece.clean) === card.lemma) {
      highlighted.add(index);
      matched = true;
    }
  });
  if (!matched && originalForm) {
    pieces.forEach((piece, index) => {
      if (piece.isWord && piece.clean === originalForm) highlighted.add(index);
    });
  }
  return pieces.map((piece, index) => (
    <span key={index} className={highlighted.has(index) ? 'rounded-sm bg-blue-50/60 font-medium text-blue-700' : undefined}>
      {piece.text}
    </span>
  ));
}

export default function FlashCard({ card, revealed, onReveal }: FlashCardProps) {
  const { t } = useTranslation();
  const occ = card.occurrences[0];
  const [dictionary, setDictionary] = useState<DictionaryEntry | null>(null);
  const [phraseDictionary, setPhraseDictionary] = useState<PhraseDictionaryEntry | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const wordText = getWordText(card);
  const phraseMode = isPhraseCard(card);

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
          <span className={`font-bold text-gray-900 ${phraseMode ? 'text-3xl' : 'text-4xl'}`}>{wordText}</span>
        </div>

        {!revealed ? (
          <p className="mt-4 text-center text-xs text-gray-400">{t('flashcard.clickToReveal')}</p>
        ) : (
          <div className="mt-6 border-t border-gray-100 pt-6">
            <div className="flex items-center gap-2 text-xs font-medium text-green-700">
              <BookOpen size={14} />
              <span>{t('flashcard.answer')}</span>
            </div>

            {card.definition && (
              <p className="mt-3 text-xl font-semibold text-gray-900">{card.definition}</p>
            )}
            {isWordCard(card) && (card.reading || card.part_of_speech) && (
              <p className="mt-2 text-sm text-gray-500">
                {card.reading && t('flashcard.reading', { reading: card.reading })}
                {card.reading && card.part_of_speech && ' · '}
                {card.part_of_speech && t('flashcard.partOfSpeech', { pos: card.part_of_speech })}
              </p>
            )}

            {phraseMode && phraseDictionary && (
              <div className="mt-3 space-y-2 rounded-xl bg-purple-50/60 p-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-purple-700">{phraseDictionary.translation}</p>
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
                  <p className="text-xs text-purple-500">{phraseDictionary.category}</p>
                )}
              </div>
            )}

            {!phraseMode && dictionary && (
              <div className="mt-3 space-y-2 rounded-xl bg-blue-50/60 p-3">
                <div className="flex items-center gap-2">
                  {dictionary.phonetic && <p className="text-sm text-blue-700">{dictionary.phonetic}</p>}
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
                  <div key={`${definition.definition}-${index}`} className="text-sm text-gray-700">
                    {definition.part_of_speech && <span className="mr-1 text-xs text-blue-600">{definition.part_of_speech}</span>}
                    {definition.definition}
                    {definition.translation && <p className="mt-0.5 text-xs text-gray-600">{definition.translation}</p>}
                  </div>
                ))}
              </div>
            )}

            {!card.definition && !phraseMode && !dictionary && !phraseDictionary && (
              <p className="mt-3 text-sm italic text-gray-400">{t('flashcard.noDefinition')}</p>
            )}

            {occ && (
              <div className="mt-5 rounded-xl bg-gray-50 p-3">
                <p className="text-sm leading-relaxed text-gray-700">
                  {renderOccurrenceSentence(occ.en_text, card, occ.original_form ?? null)}
                </p>
                {occ.zh_text && <p className="mt-1 text-xs text-gray-500">{occ.zh_text}</p>}
                <p className="mt-2 text-xs text-gray-400">
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
