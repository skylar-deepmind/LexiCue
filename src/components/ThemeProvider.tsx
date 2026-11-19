import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { THEMES, type ThemeId } from '../lib/themes';
import { ThemeContext } from './themeContext';
import { STAGE_THEME_COLORS } from '../lib/stageColors';
import './theme-transition.css';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<ThemeId>(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('lexicue-theme'); } catch { /* Storage restrictions must not prevent opening a material. */ }
    return THEMES.some((item) => item.id === saved) ? saved as ThemeId : 'ocean';
  });
  const requested = useRef(theme), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setTheme = useCallback((value: ThemeId | ((current: ThemeId) => ThemeId)) => {
    const next = typeof value === 'function' ? value(requested.current) : value;
    if (requested.current === next) return;
    requested.current = next;
    clearTimeout(timer.current);
    const root = document.documentElement;
    const clear = () => { delete root.dataset.themeTransition; delete root.dataset.themeFallback; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); updateTheme(next); return; }
    // Interpolate inherited color tokens. No full-page snapshot can swallow a
    // second click, and reversing a CSS transition starts at its current color.
    void getComputedStyle(root).getPropertyValue('--approved-desk');
    root.dataset.themeTransition = 'true';
    if (!CSS.registerProperty) root.dataset.themeFallback = 'true';
    flushSync(() => updateTheme(next));
    timer.current = setTimeout(clear, 1000);
  }, []);
  useLayoutEffect(() => () => { clearTimeout(timer.current); delete document.documentElement.dataset.themeTransition; delete document.documentElement.dataset.themeFallback; }, []);

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
