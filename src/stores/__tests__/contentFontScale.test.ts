import { beforeEach, describe, expect, it, vi } from 'vitest';
const values = vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  return data;
});
import { usePreferencesStore } from '../preferencesStore';
import { contentFontScaleStyle, DEFAULT_CONTENT_FONT_SCALE, normalizeContentFontScale } from '../../lib/contentFontScale';
const prefs = () => usePreferencesStore.getState();
beforeEach(() => {
  values.clear();
  usePreferencesStore.setState({ contentFontScale: { ...DEFAULT_CONTENT_FONT_SCALE }, learningTextFontSize: 'md', definitionFontSize: 'md', auxiliaryFontSize: 'md' });
});

describe('continuous content font preferences', () => {
  it('preserves all old size choices and the pre-0.3 reading choice without changing initial rendering', () => {
    const merge = usePreferencesStore.persist.getOptions().merge!;
    for (const size of ['sm', 'md', 'lg']) {
      const restored = merge({ learningTextFontSize: size, definitionFontSize: size, auxiliaryFontSize: size }, prefs());
      expect(restored).toMatchObject({ learningTextFontSize: size, definitionFontSize: size, auxiliaryFontSize: size, contentFontScale: DEFAULT_CONTENT_FONT_SCALE });
      expect(merge({ readingFontSize: size }, prefs()).learningTextFontSize).toBe(size);
    }
    expect(contentFontScaleStyle(DEFAULT_CONTENT_FONT_SCALE)).toEqual({ '--learning-font-scale': 1, '--definition-font-scale': 1, '--auxiliary-font-scale': 1 });
  });

  it('updates the three dimensions independently and restores the final slider values', async () => {
    prefs().setContentFontScale('learning', 119);
    expect(prefs().contentFontScale).toEqual({ learning: 119, definition: 100, auxiliary: 100 });
    prefs().setContentFontScale('definition', 112);
    prefs().setContentFontScale('auxiliary', 106);
    expect(prefs().learningTextFontSize).toBe('md');
    const saved = values.get('lexicue-preferences')!;
    expect(JSON.parse(saved).state.contentFontScale).toEqual({ learning: 119, definition: 112, auxiliary: 106 });
    usePreferencesStore.setState({ contentFontScale: { ...DEFAULT_CONTENT_FONT_SCALE } });
    values.set('lexicue-preferences', saved);
    await usePreferencesStore.persist.rehydrate();
    expect(prefs().contentFontScale).toEqual({ learning: 119, definition: 112, auxiliary: 106 });
  });

  it('recovers invalid stored dimensions independently and clamps finite out of range input', () => {
    expect(normalizeContentFontScale({ learning: 999, definition: -9, auxiliary: 111.7 })).toEqual({ learning: 140, definition: 80, auxiliary: 112 });
    expect(normalizeContentFontScale({ learning: '125', definition: Number.NaN, auxiliary: Number.POSITIVE_INFINITY })).toEqual(DEFAULT_CONTENT_FONT_SCALE);
    for (const broken of [null, [], 'broken', 120, true]) expect(normalizeContentFontScale(broken)).toEqual(DEFAULT_CONTENT_FONT_SCALE);
    const merge = usePreferencesStore.persist.getOptions().merge!;
    expect(merge({ contentFontScale: { learning: 120, definition: false }, reencounterHints: false, auxiliaryFontSize: 'lg' }, prefs())).toMatchObject({
      contentFontScale: { learning: 120, definition: 100, auxiliary: 100 }, reencounterHints: false, auxiliaryFontSize: 'lg',
    });
  });
});
