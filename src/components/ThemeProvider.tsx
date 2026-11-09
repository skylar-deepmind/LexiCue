import { useLayoutEffect, useState, type ReactNode } from 'react';
import { THEMES, type ThemeId } from '../lib/themes';
import { ThemeContext } from './themeContext';
import { STAGE_THEME_COLORS } from '../lib/stageColors';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('lexicue-theme'); } catch { /* Storage restrictions must not prevent opening a material. */ }
    return THEMES.some((item) => item.id === saved) ? saved as ThemeId : 'ocean';
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const systemUi = (window as Window & { LexiCueSystemUi?: { setDarkTheme: (dark: boolean) => void } }).LexiCueSystemUi;
    if (systemUi) {
      document.documentElement.dataset.nativeInsets = 'true';
      systemUi.setDarkTheme(theme === 'midnight');
    }
    for (const [stage, color] of Object.entries(STAGE_THEME_COLORS[theme])) {
      document.documentElement.style.setProperty(`--stage-${stage}`, color);
    }
    try { localStorage.setItem('lexicue-theme', theme); } catch { /* Keep the active theme for this session. */ }
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
