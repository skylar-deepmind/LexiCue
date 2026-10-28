import { create } from 'zustand';
import { persist, createJSONStorage, subscribeWithSelector } from 'zustand/middleware';
import { normalizeBrowserSession, type BrowserSession } from '../lib/youtubeDownload';
import type { AnnotationKind, AnnotationMode } from '../lib/annotation';
import type { Language, UILanguage } from '../lib/languages';
import { isLanguage, detectSystemLanguage, isUILanguage } from '../lib/languages';
import { languageKey, normalizeYouTubePreferences, rememberYouTubeImport, type YouTubeLanguagePair, type YouTubePreferences } from '../lib/youtubeSelection';
import { normalizeSpeechPreferences, type SpeechPreferences, type SpeechAccent } from '../lib/speechPreferences';
import { normalizeContentFontScale, type ContentFontCategory, type ContentFontScale } from '../lib/contentFontScale';

export type ContentFontSize = 'sm' | 'md' | 'lg';
export type ReadingLineHeight = 'compact' | 'normal' | 'loose';

const FONT_SIZES: ContentFontSize[] = ['sm', 'md', 'lg'];
const LINE_HEIGHTS: ReadingLineHeight[] = ['compact', 'normal', 'loose'];

interface PreferencesState {
  contentFontScale: ContentFontScale;
  setContentFontScale: (category: ContentFontCategory, scale: number) => void;
  speech: SpeechPreferences;
  setSpeech: (patch: Partial<SpeechPreferences>) => void;
  setSpeechVoice: (accent: SpeechAccent, voice: string) => void;
  reencounterHints: boolean;
  setReencounterHints: (enabled: boolean) => void;
  vocabularyKind: 'word' | 'phrase';
  setVocabularyKind: (kind: 'word' | 'phrase') => void;
  youtube: YouTubePreferences;
  toggleYouTubeFavorite: (language: string) => void;
  setYouTubeBrowserSession: (session: BrowserSession) => void;
  recordYouTubeImport: (pair: YouTubeLanguagePair) => void;
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
        contentFontScale: normalizeContentFontScale(null),
        setContentFontScale: (category, scale) => set(state => ({ contentFontScale: normalizeContentFontScale({ ...state.contentFontScale, [category]: scale }) })),
        speech: normalizeSpeechPreferences(null),
        setSpeech: patch => set(state => ({ speech: normalizeSpeechPreferences({ ...state.speech, ...patch, voices: { ...state.speech.voices, ...patch.voices } }) })),
        setSpeechVoice: (accent, voice) => set(state => ({ speech: normalizeSpeechPreferences({ ...state.speech, voices: { ...state.speech.voices, [accent]: voice } }) })),
        reencounterHints: true,
        setReencounterHints: reencounterHints => set({reencounterHints}),
        vocabularyKind: 'word',
        setVocabularyKind: vocabularyKind => set({ vocabularyKind }),
        youtube: normalizeYouTubePreferences(null),
        toggleYouTubeFavorite: (language) => set(state => {
          const key = languageKey(language);
          if (!key) return {};
          const favorites = state.youtube.favoriteLanguages;
          return { youtube: { ...state.youtube, favoriteLanguages: favorites.some(code => languageKey(code) === key)
            ? favorites.filter(code => languageKey(code) !== key) : [...favorites, language.trim()] } };
        }),
        setYouTubeBrowserSession: session => set(state => ({ youtube: { ...state.youtube, browserSession: normalizeBrowserSession(session) } })),
        recordYouTubeImport: (pair) => set(state => ({ youtube: rememberYouTubeImport(state.youtube, pair) })),
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
            speech?: unknown;
            contentFontScale?: unknown;
            reencounterHints?: unknown;
            vocabularyKind?: unknown;
            youtube?: unknown;
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
          return { ...current, contentFontScale: normalizeContentFontScale(saved.contentFontScale), speech: normalizeSpeechPreferences(saved.speech), reencounterHints: typeof saved.reencounterHints==='boolean'?saved.reencounterHints:current.reencounterHints, vocabularyKind: saved.vocabularyKind === 'phrase' ? 'phrase' : 'word', youtube: normalizeYouTubePreferences(saved.youtube), annotationModes, language, uiLanguage, learningTextFontSize, definitionFontSize, auxiliaryFontSize, readingLineHeight };
        },
      },
    ),
  ),
);
