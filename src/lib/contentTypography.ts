import type { ContentFontSize } from '../stores/preferencesStore';

export type ContentTextCategory = 'learning' | 'definition' | 'auxiliary';

export const CONTENT_FONT_CLASS: Record<ContentTextCategory, Record<ContentFontSize, string>> = {
  learning: { sm: 'text-sm', md: 'text-base', lg: 'text-lg' },
  definition: { sm: 'text-xs', md: 'text-sm', lg: 'text-base' },
  auxiliary: { sm: 'text-[11px]', md: 'text-xs', lg: 'text-sm' },
};

export const FLASHCARD_TERM_FONT_CLASS: Record<'word' | 'phrase', Record<ContentFontSize, string>> = {
  word: { sm: 'text-3xl', md: 'text-4xl', lg: 'text-5xl' },
  phrase: { sm: 'text-2xl', md: 'text-3xl', lg: 'text-4xl' },
};

export const FLASHCARD_DEFINITION_FONT_CLASS: Record<ContentFontSize, string> = {
  sm: 'text-lg', md: 'text-xl', lg: 'text-2xl',
};
