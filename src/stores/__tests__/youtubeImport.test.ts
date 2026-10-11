import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('navigator', { language: 'en' });
  return { invoke: vi.fn(), ask: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), translate: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: mocks.ask, open: vi.fn(), save: vi.fn(), message: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('../../lib/hash', () => ({ computeHash: async () => 'hash' }));
vi.mock('../../lib/parser', () => ({ parseFile: () => ({ segments: [{ index: 0, en_text: 'Hello', zh_text: null }], lemmas: [], occurrences: [] }) }));
vi.mock('../youtubeStore', () => ({ useYoutubeStore: { getState: () => ({ prepareSubtitles: mocks.prepare, translateSegments: mocks.translate, cancelJob: mocks.cancel, cancelTranslate: mocks.cancel }) } }));
import { useFileStore } from '../fileStore';
import { usePreferencesStore } from '../preferencesStore';
import { useFeedbackStore } from '../feedbackStore';
import { normalizeYouTubePreferences } from '../../lib/youtubeSelection';
const store = () => useFileStore.getState();
const input = { url: 'https://www.youtube.com/watch?v=test', title: 'Test', primary: { lang: 'en', is_auto: false }, secondary: { lang: 'zh-Hans', is_auto: true }, language: 'en' as const, aiTranslate: false, config: { provider: 'gemma' as const, baseUrl: 'http://localhost:11434', model: 'test' } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(useFeedbackStore.getState(), 'show').mockImplementation(() => 0);
  usePreferencesStore.setState({ language: 'all', youtube: normalizeYouTubePreferences(null) });
  usePreferencesStore.getState().recordYouTubeImport({ primary: 'ja', secondary: 'zh-Hant' });
  useFileStore.setState({ pendingImport: null, confirming: false, importingYouTube: false, youtubePhase: null, youtubeRecovery: null, youtubeFailure: null, youtubeCooldownUntil: 0, youtubeActiveJobId: null });
  mocks.invoke.mockImplementation(async command => command === 'tokenize_english_batch' ? [[]] : null);
  mocks.ask.mockResolvedValue(true);
  mocks.prepare.mockResolvedValue({ status: 'complete', subtitle: { name: 'test.srt', content: 'bilingual' } });
  mocks.translate.mockResolvedValue([{ index: 0, translation: '你好' }]);
});
const previous = () => expect(usePreferencesStore.getState().youtube.lastSelection).toEqual({ primary: 'ja', secondary: 'zh-Hant' });

describe('YouTube import preference lifecycle', () => {
  const partial = () => ({ status: 'partial', primary: { name: 'original.srt', content: 'original' }, error: {
    code: 'rate_limited', stage: 'download', role: 'secondary', language: 'zh-Hans', source: 'translated', retryable: true, cooldown_seconds: 60,
  } });
  it('retains the original after a translation failure and imports it without another download', async () => {
    mocks.prepare.mockResolvedValueOnce(partial());
    expect(await store().importFromYouTube(input)).toBe(false);
    expect(store().youtubeRecovery?.primary.content).toBe('original');
    expect(store().youtubeFailure?.role).toBe('secondary');
    expect(store().youtubeCooldownUntil).toBeGreaterThan(Date.now());
    previous();
    await store().importFromYouTube({ ...input, fallback: 'original' });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(store().pendingImport?.youtubeSelection).toEqual({ primary: 'en', secondary: 'zh-Hans' });
    await store().confirmImport();
    expect(usePreferencesStore.getState().youtube.lastSelection).toEqual({ primary: 'en', secondary: 'zh-Hans' });
  });
  it('retains the original when AI fails, then retries AI without requesting YouTube', async () => {
    mocks.prepare.mockResolvedValueOnce(partial());
    await store().importFromYouTube(input);
    mocks.translate.mockRejectedValueOnce(new Error('AI offline'));
    await expect(store().importFromYouTube({ ...input, fallback: 'ai' })).rejects.toMatchObject({ code: 'translation_failed' });
    expect(store().youtubeRecovery?.primary.content).toBe('original');
    previous();
    await store().importFromYouTube({ ...input, fallback: 'ai' });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenCalledTimes(2);
    expect(store().pendingImport?.parsed?.segments[0].zh_text).toBe('你好');
    expect(store().pendingImport?.youtubeSelection?.secondary).toBe('zh-Hans');
  });
  it('ignores a successful download arriving after cancellation and suppresses duplicate submissions', async () => {
    let complete!: (value: unknown) => void;
    mocks.prepare.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = store().importFromYouTube(input);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(await store().importFromYouTube(input)).toBe(false);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    await store().cancelYouTubeImport();
    expect(mocks.cancel).toHaveBeenCalledWith(expect.any(Number));
    complete({ status: 'complete', subtitle: { name: 'late.srt', content: 'late' } });
    await rejection;
    expect(store().pendingImport).toBeNull(); previous();
  });
  it('uses target language rather than yt-dlp source identifiers for remembered preferences', async () => {
    await store().importFromYouTube({ ...input, primary: { lang: 'en-orig', language: 'en', is_auto: true } });
    expect(store().pendingImport?.youtubeSelection?.primary).toBe('en');
  });
  it('keeps the old combination until the import is committed, then records the ordered pair', async () => {
    expect(await store().importFromYouTube(input)).toBe(true);
    previous();
    expect(store().pendingImport?.youtubeSelection).toEqual({ primary: 'en', secondary: 'zh-Hans' });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.any(Number), input.url, input.primary, input.secondary, { enabled: false, browser: 'chrome', profile: '' });
    await store().confirmImport();
    expect(usePreferencesStore.getState().youtube.lastSelection).toEqual({ primary: 'en', secondary: 'zh-Hans' });
    expect(store().pendingImport).toBeNull();
  });
  it('does not change preferences when the preview is cancelled or saving fails', async () => {
    await store().importFromYouTube(input); store().cancelImport(); previous();
    await store().importFromYouTube(input);
    mocks.invoke.mockRejectedValueOnce(new Error('database busy'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await store().confirmImport(); previous();
    expect(store().pendingImport).not.toBeNull();
    errorLog.mockRestore();
  });
  it('does not change preferences after a failed or cancelled download or a declined duplicate', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const message of ['network failed', 'ERR_CANCELLED']) {
      mocks.prepare.mockRejectedValueOnce(new Error(message));
      await expect(store().importFromYouTube(input)).rejects.toMatchObject({ code: message === 'ERR_CANCELLED' ? 'cancelled' : 'download_failed' }); previous();
      expect(store().pendingImport).toBeNull();
    }
    errorLog.mockRestore();
    mocks.invoke.mockImplementation(async command => command === 'tokenize_english_batch' ? [[]] : { file_id: 1, name: 'existing' });
    mocks.ask.mockResolvedValueOnce(false);
    expect(await store().importFromYouTube(input)).toBe(false); previous();
    expect(store().pendingImport).toBeNull();
  });
  it('preserves the single-track AI translation path and records a single-track combination', async () => {
    await store().importFromYouTube({ ...input, secondary: null, aiTranslate: true });
    expect(mocks.prepare).toHaveBeenCalledWith(expect.any(Number), input.url, input.primary, null, expect.any(Object));
    expect(mocks.translate).toHaveBeenCalled();
    expect(store().pendingImport?.parsed?.segments[0].zh_text).toBe('你好');
    await store().confirmImport();
    expect(usePreferencesStore.getState().youtube.lastSelection).toEqual({ primary: 'en', secondary: null });
  });
  it('leaves YouTube preferences unchanged when committing an ordinary file import', async () => {
    await store().importFromYouTube(input);
    const pending = { ...store().pendingImport! };
    delete pending.youtubeSelection;
    useFileStore.setState({ pendingImport: pending });
    await store().confirmImport(); previous();
  });
});
