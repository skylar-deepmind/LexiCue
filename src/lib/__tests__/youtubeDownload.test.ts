import { describe, expect, it } from 'vitest';
import { cooldownRemaining, downloadError, EMPTY_BROWSER_SESSION, normalizeBrowserSession } from '../youtubeDownload';
import { preferredTrack, filterSubtitleTracks, normalizeYouTubePreferences } from '../youtubeSelection';

describe('YouTube download recovery', () => {
  it('keeps browser access off for old preferences and rejects unsupported session sources', () => {
    expect(normalizeBrowserSession(undefined)).toEqual(EMPTY_BROWSER_SESSION);
    expect(normalizeBrowserSession({ enabled: true, browser: 'script', profile: 'x' }).enabled).toBe(false);
    expect(normalizeBrowserSession({ enabled: true, browser: 'firefox', profile: ' Default ' })).toEqual({ enabled: true, browser: 'firefox', profile: 'Default' });
  });
  it('retains structured errors and calculates a nonnegative cooldown with ceiling rounding', () => {
    expect(downloadError({ code: 'rate_limited', role: 'secondary', cooldown_seconds: 60 }).role).toBe('secondary');
    expect(downloadError(new Error('ERR_CANCELLED')).code).toBe('cancelled');
    expect(cooldownRemaining(6500, 4001)).toBe(3);
    expect(cooldownRemaining(6500, 7000)).toBe(0);
  });
  it('prefers original captions over translated aliases and keeps script distinctions', () => {
    const translated = { lang: 'en-ja', language: 'en', is_auto: true, source: 'translated' as const };
    const original = { lang: 'en-orig', language: 'en', is_auto: true, source: 'original' as const };
    const info = { title: 'Test', thumbnail: null, duration: null, manual: [], automatic: [translated, original, { lang: 'zh-Hant', language: 'zh-Hant', is_auto: true }] };
    expect(preferredTrack(info, 'en')).toEqual(original);
    expect(preferredTrack(info, 'zh-Hans')).toBeNull();
    expect(filterSubtitleTracks([translated], '英语', 'zh')).toEqual([translated]);
  });
  it('migrates original-track preferences to their target language without changing scripts', () => {
    const preferences = normalizeYouTubePreferences({ favoriteLanguages: ['en-orig', 'en', 'zh-Hant'], recentLanguages: ['en-orig'], lastSelection: { primary: 'en-orig', secondary: 'zh-Hans' } });
    expect(preferences.favoriteLanguages).toEqual(['en', 'zh-Hant']);
    expect(preferences.lastSelection).toEqual({ primary: 'en', secondary: 'zh-Hans' });
  });
});
