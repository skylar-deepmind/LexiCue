import { normalizeBrowserSession, type BrowserSession } from './youtubeDownload';
import type { Language } from './languages';
import type { SubtitleTrack, TrackSelection, VideoSubInfo } from '../stores/youtubeStore';

export interface YouTubeLanguagePair {
  primary: string;
  secondary: string | null;
}

export interface YouTubePreferences {
  browserSession?: BrowserSession;
  favoriteLanguages: string[];
  recentLanguages: string[];
  lastSelection: YouTubeLanguagePair | null;
}

export interface YouTubeSelection {
  primary: TrackSelection | null;
  secondary: TrackSelection | null;
}

export function trackLanguage(track: TrackSelection): string { return track.language ?? track.lang.replace(/-orig$/i, ''); }

export function languageKey(code: string): string {
  return code.trim().toLowerCase();
}

function uniqueLanguages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((code): code is string => {
    if (typeof code !== 'string' || !code.trim()) return false;
    const key = languageKey(code.replace(/-orig$/i, ''));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(code => code.trim().replace(/-orig$/i, ''));
}

export function normalizeYouTubePreferences(value: unknown): YouTubePreferences {
  const saved = value && typeof value === 'object' ? value as Partial<YouTubePreferences> : {};
  const pair = saved.lastSelection;
  return {
    browserSession: normalizeBrowserSession(saved.browserSession),
    favoriteLanguages: uniqueLanguages(saved.favoriteLanguages),
    recentLanguages: uniqueLanguages(saved.recentLanguages).slice(0, 6),
    lastSelection: pair && typeof pair.primary === 'string' && pair.primary.trim()
      ? { primary: pair.primary.trim().replace(/-orig$/i, ''), secondary: typeof pair.secondary === 'string' && pair.secondary.trim() ? pair.secondary.trim().replace(/-orig$/i, '') : null }
      : null,
  };
}

export function rememberYouTubeImport(preferences: YouTubePreferences, pair: YouTubeLanguagePair): YouTubePreferences {
  return {
    ...preferences,
    lastSelection: { ...pair },
    recentLanguages: uniqueLanguages([pair.primary, pair.secondary, ...preferences.recentLanguages]).slice(0, 6),
  };
}

export function sameTrack(a: TrackSelection | null, b: TrackSelection | null): boolean {
  return a === b || !!a && !!b && languageKey(a.lang) === languageKey(b.lang) && a.is_auto === b.is_auto;
}

/** Match the entire code: a missing script or region must never change the requested language. */
export function preferredTrack(info: VideoSubInfo, code: string, exclude: TrackSelection | null = null): SubtitleTrack | null {
  const priority = { manual: 0, original: 1, translated: 2, unknown: 3 };
  const tracks = [...info.manual, ...info.automatic];
  const target = tracks.find(track => languageKey(track.lang) === languageKey(code))?.language ?? code.replace(/-orig$/i, '');
  return tracks.filter(track => languageKey(trackLanguage(track)) === languageKey(target) && !sameTrack(track, exclude))
    .sort((a, b) => priority[a.source ?? (a.is_auto ? 'unknown' : 'manual')] - priority[b.source ?? (b.is_auto ? 'unknown' : 'manual')])[0] ?? null;
}

export function restoreYouTubeSelection(info: VideoSubInfo, pair: YouTubeLanguagePair | null): {
  selection: YouTubeSelection;
  missing: Array<{ role: keyof YouTubeSelection; lang: string }>;
} {
  const selection: YouTubeSelection = { primary: null, secondary: null };
  const missing: Array<{ role: keyof YouTubeSelection; lang: string }> = [];
  if (pair) {
    selection.primary = preferredTrack(info, pair.primary);
    if (!selection.primary) missing.push({ role: 'primary', lang: pair.primary });
    if (pair.secondary) {
      selection.secondary = preferredTrack(info, pair.secondary, selection.primary);
      if (!selection.secondary) missing.push({ role: 'secondary', lang: pair.secondary });
    }
  }
  return { selection, missing };
}

export function toggleYouTubeTrack(selection: YouTubeSelection, track: TrackSelection): {
  selection: YouTubeSelection;
  limitReached: boolean;
} {
  if (sameTrack(selection.primary, track)) return { selection: { ...selection, primary: null }, limitReached: false };
  if (sameTrack(selection.secondary, track)) return { selection: { ...selection, secondary: null }, limitReached: false };
  if (!selection.primary) return { selection: { ...selection, primary: track }, limitReached: false };
  if (!selection.secondary) return { selection: { ...selection, secondary: track }, limitReached: false };
  return { selection, limitReached: true };
}

export function suggestLearningLanguage(code: string): Language | '' {
  const base = languageKey(code).split('-')[0];
  if (base === 'jp') return 'ja';
  return base === 'en' || base === 'ja' || base === 'de' || base === 'zh' ? base : '';
}

export function subtitleLanguageLabel(code: string, locale: string): string {
  try {
    // yt-dlp's original-track suffix is not a language subtag; keep it visible separately.
    const original = code.toLowerCase().endsWith('-orig');
    const language = original ? code.slice(0, -5) : code;
    const label = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(language) ?? language;
    return original ? `${label} (${code})` : label;
  } catch {
    return code;
  }
}

export function filterSubtitleTracks(tracks: SubtitleTrack[], query: string, locale: string): SubtitleTrack[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return tracks;
  return tracks.filter(track => [track.lang, trackLanguage(track), subtitleLanguageLabel(trackLanguage(track), locale), subtitleLanguageLabel(trackLanguage(track), 'en')]
    .some(label => label.toLocaleLowerCase(locale).includes(needle)));
}

export function quickLanguages(info: VideoSubInfo, preferences: YouTubePreferences): {
  favorites: Array<{ lang: string; track: SubtitleTrack | null }>;
  recent: Array<{ lang: string; track: SubtitleTrack }>;
} {
  const favoriteKeys = new Set(preferences.favoriteLanguages.map(languageKey));
  return {
    favorites: preferences.favoriteLanguages.map(lang => ({ lang, track: preferredTrack(info, lang) })),
    recent: preferences.recentLanguages.flatMap(lang => {
      const track = preferredTrack(info, lang);
      return track && !favoriteKeys.has(languageKey(lang)) ? [{ lang, track }] : [];
    }),
  };
}
