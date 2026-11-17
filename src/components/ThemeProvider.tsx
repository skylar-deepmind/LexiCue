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
  const requested = useRef(theme), transition = useRef<ViewTransition | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setTheme = useCallback((next: ThemeId) => {
    if (requested.current === next) return;
    requested.current = next;
    transition.current?.skipTransition(); clearTimeout(timer.current);
    const root = document.documentElement;
    const clear = () => { delete root.dataset.themeTransition; delete root.dataset.themeFallback; };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); updateTheme(next); return; }
    root.dataset.themeTransition = 'true';
    const fallback = () => { root.dataset.themeFallback = 'true'; updateTheme(next); timer.current = setTimeout(clear, 850); };
    if (document.startViewTransition) {
      try {
      const current = document.startViewTransition(() => { flushSync(() => updateTheme(next)); });
      transition.current = current;
      void current.finished.catch(() => {}).then(() => { if (transition.current === current) { transition.current = null; clear(); } });
      } catch { fallback(); }
    } else { fallback(); }
  }, []);
  useLayoutEffect(() => () => { clearTimeout(timer.current); transition.current?.skipTransition(); delete document.documentElement.dataset.themeTransition; delete document.documentElement.dataset.themeFallback; }, []);

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
