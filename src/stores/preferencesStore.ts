import { create } from 'zustand';
import { persist, createJSONStorage, subscribeWithSelector } from 'zustand/middleware';
import type { Language, UILanguage } from '../lib/languages';
import { isLanguage, detectSystemLanguage, isUILanguage } from '../lib/languages';

export type ContentFontSize = 'sm' | 'md' | 'lg';
export type ReadingLineHeight = 'compact' | 'normal' | 'loose';

const FONT_SIZES: ContentFontSize[] = ['sm', 'md', 'lg'];
const LINE_HEIGHTS: ReadingLineHeight[] = ['compact', 'normal', 'loose'];

interface PreferencesState {
  language: Language | 'all';
  setLanguage: (language: Language | 'all') => void;
  uiLanguage: UILanguage;
  setUiLanguage: (language: UILanguage) => void;
  learningTextFontSize: ContentFontSize;
  setLearningTextFontSize: (size: ContentFontSize) => void;
  definitionFontSize: ContentFontSize;
  setDefinitionFontSize: (size: ContentFontSize) => void;
  auxiliaryFontSize: ContentFontSize;
  setAuxiliaryFontSize: (size: ContentFontSize) => void;
  readingLineHeight: ReadingLineHeight;
  setReadingLineHeight: (lineHeight: ReadingLineHeight) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        language: 'all',
        setLanguage: (language) => set({ language }),
        uiLanguage: detectSystemLanguage(),
        setUiLanguage: (language) => set({ uiLanguage: language }),
        learningTextFontSize: 'md',
        setLearningTextFontSize: (size) => set({ learningTextFontSize: size }),
        definitionFontSize: 'md',
        setDefinitionFontSize: (size) => set({ definitionFontSize: size }),
        auxiliaryFontSize: 'md',
        setAuxiliaryFontSize: (size) => set({ auxiliaryFontSize: size }),
        readingLineHeight: 'normal',
        setReadingLineHeight: (lineHeight) => set({ readingLineHeight: lineHeight }),
      }),
      {
        name: 'lexicue-preferences',
        storage: createJSONStorage(() => localStorage),
        merge: (persisted, current) => {
          const saved = (persisted ?? {}) as {
            language?: unknown;
            uiLanguage?: unknown;
            readingFontSize?: unknown;
            learningTextFontSize?: unknown;
            definitionFontSize?: unknown;
            auxiliaryFontSize?: unknown;
            readingLineHeight?: unknown;
          };
          const language = typeof saved.language === 'string' && isLanguage(saved.language)
            ? saved.language
            : current.language;
          const uiLanguage = isUILanguage(saved.uiLanguage)
            ? saved.uiLanguage
            : current.uiLanguage;
          // readingFontSize was the pre-0.3 reading-only setting. Preserve it as
          // the initial value for the new primary learning-text preference.
          const learningTextFontSize = FONT_SIZES.includes(saved.learningTextFontSize as ContentFontSize)
            ? saved.learningTextFontSize as ContentFontSize
            : FONT_SIZES.includes(saved.readingFontSize as ContentFontSize)
              ? saved.readingFontSize as ContentFontSize
              : current.learningTextFontSize;
          const definitionFontSize = FONT_SIZES.includes(saved.definitionFontSize as ContentFontSize)
            ? saved.definitionFontSize as ContentFontSize
            : current.definitionFontSize;
          const auxiliaryFontSize = FONT_SIZES.includes(saved.auxiliaryFontSize as ContentFontSize)
            ? saved.auxiliaryFontSize as ContentFontSize
            : current.auxiliaryFontSize;
          const readingLineHeight = LINE_HEIGHTS.includes(saved.readingLineHeight as ReadingLineHeight)
            ? saved.readingLineHeight as ReadingLineHeight
            : current.readingLineHeight;
          return { ...current, language, uiLanguage, learningTextFontSize, definitionFontSize, auxiliaryFontSize, readingLineHeight };
        },
      },
    ),
  ),
);
