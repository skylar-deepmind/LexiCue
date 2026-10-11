import { describe, expect, it } from 'vitest';
import {
  filterSubtitleTracks, normalizeYouTubePreferences, preferredTrack, quickLanguages, rememberYouTubeImport,
  restoreYouTubeSelection, subtitleLanguageLabel, suggestLearningLanguage, toggleYouTubeTrack,
} from '../youtubeSelection';
import type { VideoSubInfo } from '../../stores/youtubeStore';

const en = { lang: 'en', is_auto: false };
const autoEn = { lang: 'en', is_auto: true };
const hans = { lang: 'zh-Hans', is_auto: true };
const hant = { lang: 'zh-Hant', is_auto: false };
const info: VideoSubInfo = { title: 'Test', thumbnail: null, duration: null, manual: [en, hant], automatic: [autoEn, hans] };

describe('YouTube language selection', () => {
  it('starts empty and restores exact language codes with manual priority', () => {
    expect(restoreYouTubeSelection(info, null).selection).toEqual({ primary: null, secondary: null });
    expect(restoreYouTubeSelection(info, { primary: 'EN', secondary: 'zh-Hans' })).toEqual({ selection: { primary: en, secondary: hans }, missing: [] });
    expect(preferredTrack({ ...info, manual: [] }, 'en')).toEqual(autoEn);
    expect(preferredTrack(info, 'zh')).toBeNull();
    expect(preferredTrack(info, 'en-orig')).toEqual(en);
  });
  it('leaves missing original and translation roles empty without promoting the remaining track', () => {
    expect(restoreYouTubeSelection(info, { primary: 'ja', secondary: 'zh-Hans' })).toEqual({
      selection: { primary: null, secondary: hans }, missing: [{ role: 'primary', lang: 'ja' }],
    });
    expect(restoreYouTubeSelection(info, { primary: 'en', secondary: 'zh-CN' })).toEqual({
      selection: { primary: en, secondary: null }, missing: [{ role: 'secondary', lang: 'zh-CN' }],
    });
    expect(restoreYouTubeSelection({ ...info, manual: [], automatic: [] }, { primary: 'en', secondary: 'zh-Hans' }).missing).toHaveLength(2);
  });
  it('assigns roles in order, preserves the translation when removing original, and rejects a third track', () => {
    let selection = toggleYouTubeTrack({ primary: null, secondary: null }, en).selection;
    selection = toggleYouTubeTrack(selection, hans).selection;
    expect(toggleYouTubeTrack(selection, hant)).toEqual({ selection, limitReached: true });
    selection = toggleYouTubeTrack(selection, en).selection;
    expect(selection).toEqual({ primary: null, secondary: hans });
    expect(toggleYouTubeTrack(selection, hant).selection).toEqual({ primary: hant, secondary: hans });
    expect(toggleYouTubeTrack(selection, hans).selection).toEqual({ primary: null, secondary: null });
  });
  it('does not restore the same physical track into both slots', () => {
    expect(restoreYouTubeSelection(info, { primary: 'en', secondary: 'en' }).selection).toEqual({ primary: en, secondary: autoEn });
  });
  it('finds localized names, English names and full codes in a large subtitle list', () => {
    const tracks = [en, hans, hant, ...Array.from({ length: 150 }, (_, i) => ({ lang: `x-${i}`, is_auto: true }))];
    expect(filterSubtitleTracks(tracks, '英语', 'zh')).toEqual([en]);
    expect(filterSubtitleTracks(tracks, ' English ', 'zh')).toEqual([en]);
    expect(filterSubtitleTracks(tracks, '简体', 'zh')).toEqual([hans]);
    expect(filterSubtitleTracks(tracks, '繁體', 'zh-TW')).toEqual([hant]);
    expect(filterSubtitleTracks(tracks, 'ZH-HANS', 'de')).toEqual([hans]);
    expect(filterSubtitleTracks(tracks, 'no matching language', 'ja')).toEqual([]);
    expect(filterSubtitleTracks(tracks, '', 'en')).toBe(tracks);
  });
  it('distinguishes scripts and regions, retains original markers and falls back to unknown codes', () => {
    expect(subtitleLanguageLabel('zh-Hans', 'zh')).not.toBe(subtitleLanguageLabel('zh-Hant', 'zh'));
    expect(subtitleLanguageLabel('en-US', 'en')).not.toBe(subtitleLanguageLabel('en-GB', 'en'));
    expect(subtitleLanguageLabel('en-orig', 'zh')).toContain('en-orig');
    expect(subtitleLanguageLabel('not_a_language', 'zh')).toBe('not_a_language');
    expect(suggestLearningLanguage('ja-JP')).toBe('ja');
    expect(suggestLearningLanguage('en-orig')).toBe('en');
    expect(suggestLearningLanguage('fr')).toBe('');
  });
  it('keeps favorite order, includes unavailable favorites, and hides unavailable or favorited recent languages', () => {
    const preferences = { favoriteLanguages: ['ja', 'ZH-hans'], recentLanguages: ['en', 'zh-Hans', 'de'], lastSelection: null };
    expect(quickLanguages(info, preferences)).toEqual({
      favorites: [{ lang: 'ja', track: null }, { lang: 'ZH-hans', track: hans }], recent: [{ lang: 'en', track: en }],
    });
  });
  it('repairs legacy or malformed preferences and limits recents to six distinct languages', () => {
    expect(normalizeYouTubePreferences(undefined)).toEqual({ favoriteLanguages: [], recentLanguages: [], lastSelection: null, browserSession: { enabled: false, browser: 'chrome', profile: '' } });
    const saved = normalizeYouTubePreferences({ favoriteLanguages: ['en', 'EN', null, ' ja ', ''], recentLanguages: ['en', 'de', 'ja', 'zh', 'fr', 'it', 'es'], lastSelection: { primary: 4, secondary: 'zh' } });
    expect(saved.favoriteLanguages).toEqual(['en', 'ja']);
    expect(saved.lastSelection).toBeNull();
    expect(saved.recentLanguages).toHaveLength(6);
    const updated = rememberYouTubeImport(saved, { primary: 'ja', secondary: 'zh-Hans' });
    expect(updated.recentLanguages).toEqual(['ja', 'zh-Hans', 'en', 'de', 'zh', 'fr']);
    expect(updated.favoriteLanguages).toEqual(['en', 'ja']);
  });
});
