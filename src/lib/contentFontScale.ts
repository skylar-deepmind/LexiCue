import type { CSSProperties } from 'react';

export const CONTENT_FONT_CATEGORIES = ['learning', 'definition', 'auxiliary'] as const;
export type ContentFontCategory = typeof CONTENT_FONT_CATEGORIES[number];
export type ContentFontScale = Record<ContentFontCategory, number>;
export const DEFAULT_CONTENT_FONT_SCALE: ContentFontScale = { learning: 100, definition: 100, auxiliary: 100 };
export const MIN_CONTENT_FONT_SCALE = 80;
export const MAX_CONTENT_FONT_SCALE = 140;

/** Extra precision leaves existing sm/md/lg choices and their initial rendering intact. */
export function normalizeContentFontScale(value: unknown): ContentFontScale {
  const input = value && typeof value === 'object' ? value as Partial<Record<ContentFontCategory, unknown>> : {};
  const normalize = (category: ContentFontCategory) => {
    const scale = input[category];
    return typeof scale === 'number' && Number.isFinite(scale)
      ? Math.min(MAX_CONTENT_FONT_SCALE, Math.max(MIN_CONTENT_FONT_SCALE, Math.round(scale))) : 100;
  };
  return { learning: normalize('learning'), definition: normalize('definition'), auxiliary: normalize('auxiliary') };
}

export function contentFontScaleStyle(scale: ContentFontScale): CSSProperties {
  return {
    '--learning-font-scale': scale.learning / 100,
    '--definition-font-scale': scale.definition / 100,
    '--auxiliary-font-scale': scale.auxiliary / 100,
  } as CSSProperties;
}
