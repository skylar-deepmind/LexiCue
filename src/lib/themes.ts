export const THEMES = [
  { id: 'ocean', color: '#2563eb' },
  { id: 'sage', color: '#4f7663' },
  { id: 'twilight', color: '#7657a8' },
  { id: 'amber', color: '#b7791f' },
  { id: 'midnight', color: '#8b9cf6' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
