import { beforeEach, describe, expect, it, vi } from 'vitest';
const values = vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  return data;
});
import { usePreferencesStore } from '../preferencesStore';
import { DEFAULT_SPEECH_PREFERENCES, normalizeSpeechPreferences } from '../../lib/speechPreferences';
const prefs = () => usePreferencesStore.getState();
beforeEach(() => { values.clear(); usePreferencesStore.setState({ speech: normalizeSpeechPreferences(null) }); });

describe('English speech preference compatibility', () => {
  it('gives old and corrupt values usable defaults while preserving unrelated settings', () => {
    const merge = usePreferencesStore.persist.getOptions().merge!;
    const old = merge({ language: 'ja', uiLanguage: 'zh', learningTextFontSize: 'lg', annotationModes: { phrase: 'single' } }, prefs());
    expect(old.speech).toEqual(DEFAULT_SPEECH_PREFERENCES);
    expect(old).toMatchObject({ language: 'ja', uiLanguage: 'zh', learningTextFontSize: 'lg', annotationModes: { phrase: 'single' } });
    for (const broken of [null, false, 123, 'bad', [], { accent: 'jp', voices: { us: 'en-GB-RyanNeural', gb: 'missing' }, speed: 0, onlineEnabled: 'false', allowDeviceFallback: null }]) {
      expect(merge({ speech: broken }, prefs()).speech).toEqual(DEFAULT_SPEECH_PREFERENCES);
    }
  });

  it('remembers one voice per accent and rehydrates it without a network catalog', async () => {
    prefs().setSpeechVoice('us', 'en-US-GuyNeural');
    prefs().setSpeech({ accent: 'gb' });
    prefs().setSpeechVoice('gb', 'en-GB-RyanNeural');
    prefs().setSpeech({ speed: 'slow', onlineEnabled: false, allowDeviceFallback: false });
    const expected = { accent: 'gb', voices: { us: 'en-US-GuyNeural', gb: 'en-GB-RyanNeural' }, speed: 'slow', onlineEnabled: false, allowDeviceFallback: false };
    expect(prefs().speech).toEqual(expected);
    const saved = values.get('lexicue-preferences')!;
    usePreferencesStore.setState({ speech: normalizeSpeechPreferences(null) });
    values.set('lexicue-preferences', saved);
    await usePreferencesStore.persist.rehydrate();
    expect(prefs().speech).toEqual(expected);
    prefs().setSpeech({ accent: 'us' });
    expect(prefs().speech.voices.us).toBe('en-US-GuyNeural');
    expect(prefs().speech.voices.gb).toBe('en-GB-RyanNeural');
  });

  it('recovers invalid fields independently and refuses cross-accent voices', () => {
    expect(normalizeSpeechPreferences({ accent: 'gb', onlineEnabled: false, voices: { us: 'en-US-AriaNeural', gb: 'en-US-GuyNeural' }, speed: 'slow' }))
      .toEqual({ ...DEFAULT_SPEECH_PREFERENCES, accent: 'gb', onlineEnabled: false, speed: 'slow', voices: { us: 'en-US-AriaNeural', gb: 'en-GB-SoniaNeural' } });
    prefs().setSpeechVoice('us', 'en-GB-RyanNeural');
    expect(prefs().speech.voices.us).toBe('en-US-JennyNeural');
  });

  it('keeps usable defaults and current unrelated settings when stored JSON is damaged', async () => {
    usePreferencesStore.setState({ learningTextFontSize: 'lg' });
    values.set('lexicue-preferences', '{broken-json');
    await usePreferencesStore.persist.rehydrate();
    expect(prefs().speech).toEqual(DEFAULT_SPEECH_PREFERENCES);
    expect(prefs().learningTextFontSize).toBe('lg');
    prefs().setSpeech({ speed: 'slow' });
    expect(JSON.parse(values.get('lexicue-preferences')!).state.speech.speed).toBe('slow');
  });
});
