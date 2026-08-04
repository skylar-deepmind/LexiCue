import { useEffect, useState, type ReactNode } from 'react';
import { THEMES, type ThemeId } from '../lib/themes';
import { ThemeContext } from './themeContext';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('lexicue-theme');
    return THEMES.some((item) => item.id === saved) ? saved as ThemeId : 'ocean';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('lexicue-theme', theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
