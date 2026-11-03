export const THEMES = [
  { id: 'ocean', color: '#416d84' },
  { id: 'sage', color: '#4f7663' },
  { id: 'twilight', color: '#7657a8' },
  { id: 'amber', color: '#b7791f' },
  { id: 'midnight', color: '#b5ccd7' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
