import type { ThemeId } from './themes';

export const STAGE_COLOR_KEYS = ['not-started', 'starting', 'progressing', 'flowing', 'nearly-done', 'complete'] as const;
export type StageColorKey = (typeof STAGE_COLOR_KEYS)[number];

export const STAGE_THEME_COLORS: Record<ThemeId, Record<StageColorKey, string>> = {
  ocean: {
    'not-started': '#7b8492', starting: '#a95f3f', progressing: '#97701f',
    flowing: '#347c72', 'nearly-done': '#4b6fa9', complete: '#44785a',
  },
  sage: {
    'not-started': '#79847e', starting: '#a56249', progressing: '#8b7027',
    flowing: '#3f7b70', 'nearly-done': '#56729a', complete: '#47765b',
  },
  twilight: {
    'not-started': '#7f7b89', starting: '#a45f55', progressing: '#927025',
    flowing: '#3f7975', 'nearly-done': '#626ca8', complete: '#4c765f',
  },
  amber: {
    'not-started': '#817e76', starting: '#a55d40', progressing: '#8e6a19',
    flowing: '#3e776c', 'nearly-done': '#536f9f', complete: '#4c7656',
  },
  midnight: {
    'not-started': '#929baa', starting: '#d09578', progressing: '#cfad66',
    flowing: '#79b9ae', 'nearly-done': '#91a6dc', complete: '#82ba96',
  },
};
