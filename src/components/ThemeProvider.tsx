import { useEffect, useState, type ReactNode } from 'react';
import { THEMES, type ThemeId } from '../lib/themes';
import { ThemeContext } from './themeContext';
import { STAGE_THEME_COLORS } from '../lib/stageColors';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('lexicue-theme');
    return THEMES.some((item) => item.id === saved) ? saved as ThemeId : 'ocean';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    for (const [stage, color] of Object.entries(STAGE_THEME_COLORS[theme])) {
      document.documentElement.style.setProperty(`--stage-${stage}`, color);
    }
    localStorage.setItem('lexicue-theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
