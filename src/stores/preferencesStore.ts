import { normalizeLibraryNames, type LibraryNames, type LibraryNameKey } from '../lib/libraryNames';
import { create } from 'zustand';
import { persist, createJSONStorage, subscribeWithSelector } from 'zustand/middleware';
import type { AnnotationKind, AnnotationMode } from '../lib/annotation';
import type { Language, UILanguage } from '../lib/languages';
import { isLanguage, detectSystemLanguage, isUILanguage } from '../lib/languages';
import { DEFAULT_SPEECH_PREFERENCES, normalizeSpeechPreferences, type SpeechPreferences, type SpeechAccent } from '../lib/speechPreferences';
import { normalizeContentFontScale, type ContentFontCategory, type ContentFontScale } from '../lib/contentFontScale';
import {normalizeTagColors,type TagColors} from '../lib/tagAppearance';

export type ContentFontSize = 'sm' | 'md' | 'lg';
export type ReadingLineHeight = 'compact' | 'normal' | 'loose';

const FONT_SIZES: ContentFontSize[] = ['sm', 'md', 'lg'];
const LINE_HEIGHTS: ReadingLineHeight[] = ['compact', 'normal', 'loose'];

interface PreferencesState {
  libraryNames: LibraryNames;
  setLibraryName: (key: LibraryNameKey, name: string) => void;
  onlineDictionary: 'cambridge' | 'wiktionary';
  setOnlineDictionary: (provider: 'cambridge' | 'wiktionary') => void;
  tagColors: TagColors;
  setTagColors: (colors: TagColors) => void;
  contentFontScale: ContentFontScale;
  setContentFontScale: (category: ContentFontCategory, scale: number) => void;
  speech: SpeechPreferences;
  setSpeech: (patch: Partial<SpeechPreferences>) => void;
  setSpeechVoice: (accent: SpeechAccent, voice: string) => void;
  reencounterHints: boolean;
  setReencounterHints: (enabled: boolean) => void;
  vocabularyKind: 'word' | 'phrase';
  setVocabularyKind: (kind: 'word' | 'phrase') => void;
  annotationModes: Record<AnnotationKind, AnnotationMode>;
  setAnnotationMode: (kind: AnnotationKind, mode: AnnotationMode) => void;
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
        libraryNames: {},
        setLibraryName: (key, name) => set(state => ({ libraryNames: normalizeLibraryNames({ ...state.libraryNames, [key]: name }) })),
        onlineDictionary: 'cambridge',
        setOnlineDictionary: onlineDictionary => set({ onlineDictionary }),
        tagColors: {},
        setTagColors: colors => set(state=>({tagColors:{...state.tagColors,...normalizeTagColors(colors)}})),
        contentFontScale: normalizeContentFontScale(null),
        setContentFontScale: (category, scale) => set(state => ({ contentFontScale: normalizeContentFontScale({ ...state.contentFontScale, [category]: scale }) })),
        speech: normalizeSpeechPreferences(null),
        setSpeech: patch => set(state => ({ speech: normalizeSpeechPreferences({ ...state.speech, ...patch, voices: { ...state.speech.voices, ...patch.voices } }) })),
        setSpeechVoice: (accent, voice) => set(state => ({ speech: normalizeSpeechPreferences({ ...state.speech, voices: { ...state.speech.voices, [accent]: voice } }) })),
        reencounterHints: true,
        setReencounterHints: reencounterHints => set({reencounterHints}),
        vocabularyKind: 'word',
        setVocabularyKind: vocabularyKind => set({ vocabularyKind }),
        annotationModes: { word: 'batch', phrase: 'batch' },
        setAnnotationMode: (kind, mode) => set(state => ({ annotationModes: { ...state.annotationModes, [kind]: mode } })),
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
            onlineDictionary?: unknown;
            libraryNames?: unknown;
            tagColors?: unknown;
            speech?: unknown;
            contentFontScale?: unknown;
            reencounterHints?: unknown;
            vocabularyKind?: unknown;
            annotationModes?: Partial<Record<AnnotationKind, unknown>>;
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
          const annotationModes: Record<AnnotationKind, AnnotationMode> = {
            word: saved.annotationModes?.word === 'single' ? 'single' : 'batch',
            phrase: saved.annotationModes?.phrase === 'single' ? 'single' : 'batch',
          };
          // Connection switches are no longer user preferences. Restore the
          // app defaults while keeping the user's accent, voices and speed.
          const { accent, voices, speed } = normalizeSpeechPreferences(saved.speech);
          const speech = { ...DEFAULT_SPEECH_PREFERENCES, accent, voices, speed };
          return { ...current, libraryNames: normalizeLibraryNames(saved.libraryNames), onlineDictionary: saved.onlineDictionary === 'wiktionary' ? 'wiktionary' : 'cambridge', tagColors:normalizeTagColors(saved.tagColors), contentFontScale: normalizeContentFontScale(saved.contentFontScale), speech, reencounterHints: typeof saved.reencounterHints==='boolean'?saved.reencounterHints:current.reencounterHints, vocabularyKind: saved.vocabularyKind === 'phrase' ? 'phrase' : 'word', annotationModes, language, uiLanguage, learningTextFontSize, definitionFontSize, auxiliaryFontSize, readingLineHeight };
        },
      },
    ),
  ),
);
