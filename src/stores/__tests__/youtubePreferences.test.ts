import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  return values;
});
import { usePreferencesStore } from '../preferencesStore';
import { normalizeYouTubePreferences } from '../../lib/youtubeSelection';
const store = () => usePreferencesStore.getState();
beforeEach(() => { storage.clear(); usePreferencesStore.setState({ youtube: normalizeYouTubePreferences(null) }); });

describe('YouTube preferences persistence', () => {
  it('preserves the vocabulary category while retaining old language and font preferences', () => {
    const merge = usePreferencesStore.persist.getOptions().merge!;
    const old = merge({ language: 'ja', learningTextFontSize: 'lg' }, store());
    expect(old.vocabularyKind).toBe('word');
    expect(old.language).toBe('ja'); expect(old.learningTextFontSize).toBe('lg');
    expect(merge({ vocabularyKind: 'phrase' }, store()).vocabularyKind).toBe('phrase');
    expect(merge({ vocabularyKind: 'invalid' }, store()).vocabularyKind).toBe('word');
  });
  it('persists explicitly enabled browser assistance while old preferences remain anonymous', async () => {
    expect(store().youtube.browserSession?.enabled).toBe(false);
    store().setYouTubeBrowserSession({ enabled: true, browser: 'firefox', profile: 'default-release' });
    const saved = storage.get('lexicue-preferences')!;
    usePreferencesStore.setState({ youtube: normalizeYouTubePreferences(null) });
    storage.set('lexicue-preferences', saved);
    await usePreferencesStore.persist.rehydrate();
    expect(store().youtube.browserSession).toEqual({ enabled: true, browser: 'firefox', profile: 'default-release' });
  });
  it('saves favorite additions and removals immediately and keeps insertion order', () => {
    store().toggleYouTubeFavorite('zh-Hans'); store().toggleYouTubeFavorite('en'); store().toggleYouTubeFavorite('ja');
    store().toggleYouTubeFavorite('EN');
    expect(store().youtube.favoriteLanguages).toEqual(['zh-Hans', 'ja']);
    expect(JSON.parse(storage.get('lexicue-preferences')!).state.youtube.favoriteLanguages).toEqual(['zh-Hans', 'ja']);
  });
  it('rehydrates the successful combination, favorites and recents after restart', async () => {
    store().toggleYouTubeFavorite('ja');
    store().recordYouTubeImport({ primary: 'de', secondary: 'zh-Hant' });
    const persisted = storage.get('lexicue-preferences')!;
    usePreferencesStore.setState({ youtube: normalizeYouTubePreferences(null) });
    storage.set('lexicue-preferences', persisted);
    await usePreferencesStore.persist.rehydrate();
    expect(store().youtube).toEqual({ browserSession: { enabled: false, browser: 'chrome', profile: '' }, favoriteLanguages: ['ja'], recentLanguages: ['de', 'zh-Hant'], lastSelection: { primary: 'de', secondary: 'zh-Hant' } });
  });
  it('merges old preferences without losing existing modes or font settings', () => {
    const merged = usePreferencesStore.persist.getOptions().merge!({ annotationModes: { word: 'single' }, learningTextFontSize: 'lg', language: 'ja' }, store());
    expect(merged.youtube).toEqual(normalizeYouTubePreferences(null));
    expect(merged.annotationModes).toEqual({ word: 'single', phrase: 'batch' });
    expect(merged.learningTextFontSize).toBe('lg'); expect(merged.language).toBe('ja');
  });
});
