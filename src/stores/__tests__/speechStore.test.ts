import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', { language: 'en-US' });
  return { invoke: vi.fn(), storage: values };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { useSpeechStore } from '../speechStore';
import { usePreferencesStore } from '../preferencesStore';
import { normalizeSpeechPreferences } from '../../lib/speechPreferences';
import { playPronunciation, speakText } from '../../lib/tts';

const pending = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const edge = (changes = {}) => ({ data_base64: 'a-valid-validated-mp3', mime: 'audio/mpeg', cache_key: 'key', source: 'edge-network', voice: 'en-US-JennyNeural', speed: 'normal', duration_ms: 1000, ...changes });
class TestAudio {
  static all: TestAudio[] = [];
  src = ''; preload = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null; onplaying: (() => void) | null = null;
  pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
  play = vi.fn(() => Promise.resolve());
  constructor() { TestAudio.all.push(this); }
}
const speech = () => useSpeechStore.getState();
let deviceSpeak: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let utterances: Array<SpeechSynthesisUtterance>;
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? Promise.resolve(edge()) : Promise.resolve());
  TestAudio.all = [];
  utterances = [];
  deviceSpeak = vi.fn((utterance: SpeechSynthesisUtterance) => { utterances.push(utterance); utterance.onstart?.(null!); });
  cancel = vi.fn();
  vi.stubGlobal('Audio', TestAudio);
  vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text; } });
  vi.stubGlobal('window', { addEventListener: vi.fn(), speechSynthesis: { getVoices: () => [{ lang: 'en-US', name: 'Local', localService: true }], cancel, speak: deviceSpeak } });
  usePreferencesStore.setState({ speech: normalizeSpeechPreferences(null) });
  speech().stop();
  mocks.invoke.mockClear();
});
afterEach(() => { speech().stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared Edge player and request ownership', () => {
  it('plays Edge without an installed device voice and sends only selected unmodified text and parameters', async () => {
    vi.stubGlobal('window', { speechSynthesis: undefined });
    const text = "US went: look-up — don't change this.";
    await speech().speak(text, 'selected', { kind: 'phrase' });
    expect(mocks.invoke).toHaveBeenCalledWith('resolve_tts_audio', { request: expect.objectContaining({ text, kind: 'phrase', accent: 'us', voice: 'en-US-JennyNeural', speed: 'normal', onlineEnabled: true }) });
    const request = mocks.invoke.mock.calls[0][1].request;
    expect(Object.keys(request).sort()).toEqual(['accent', 'kind', 'onlineEnabled', 'requestId', 'speed', 'text', 'voice']);
    expect(speech()).toMatchObject({ key: 'selected', status: 'playing', source: 'edge-network', loading: false, error: false });
    expect(TestAudio.all).toHaveLength(1);
    TestAudio.all[0].onended!();
    expect(speech()).toMatchObject({ key: null, status: 'idle' });
    expect(deviceSpeak).not.toHaveBeenCalled();
  });

  it('keeps only the latest of ten rapid requests and never falls back for stale failures', async () => {
    const responses = Array.from({ length: 10 }, () => pending<ReturnType<typeof edge>>());
    let index = 0;
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? responses[index++].promise : Promise.resolve());
    const requests = responses.map((_, i) => speech().speak(`English ${i}`, `word:${i}`, { kind: 'word' }));
    responses[9].resolve(edge());
    for (let i = 0; i < 9; i++) {
      if (i % 2) responses[i].resolve(edge());
      else responses[i].reject({ code: 'network' });
    }
    await Promise.all(requests);
    expect(TestAudio.all).toHaveLength(1);
    expect(speech()).toMatchObject({ key: 'word:9', source: 'edge-network', status: 'playing' });
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cancel_tts')).toHaveLength(9);
  });

  it('toggles a loading item off and isolates old audio callbacks from the next item', async () => {
    const response = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementationOnce(() => response.promise);
    const old = speech().speak('English', 'one');
    await speech().speak('English', 'one');
    response.resolve(edge()); await old;
    expect(TestAudio.all).toHaveLength(0);
    expect(speech().status).toBe('idle');
    await speech().speak('first', 'first');
    const oldEnd = TestAudio.all[0].onended!, oldError = TestAudio.all[0].onerror!;
    await speech().speak('second', 'second');
    oldEnd(); oldError();
    expect(speech()).toMatchObject({ key: 'second', status: 'playing', error: false });
    expect(TestAudio.all[0].pause).toHaveBeenCalled();
  });

  it('stops pending generation when preferences change without automatically generating or speaking', async () => {
    const response = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementationOnce(() => response.promise);
    const request = speech().speak('Hello', 'one');
    usePreferencesStore.getState().setSpeech({ accent: 'gb', speed: 'slow' });
    response.resolve(edge()); await request;
    expect(TestAudio.all).toHaveLength(0);
    expect(speech().status).toBe('idle');
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio')).toHaveLength(1);
    mocks.invoke.mockResolvedValueOnce(edge({ voice: 'en-GB-SoniaNeural', speed: 'slow' }));
    await speech().speak('Hello', 'next');
    expect(mocks.invoke).toHaveBeenLastCalledWith('resolve_tts_audio', { request: expect.objectContaining({ voice: 'en-GB-SoniaNeural', accent: 'gb', speed: 'slow' }) });
  });

  it('reads cached audio with online mode disabled and clears only via the native speech-cache command', async () => {
    usePreferencesStore.getState().setSpeech({ onlineEnabled: false, allowDeviceFallback: false });
    mocks.invoke.mockResolvedValueOnce(edge({ source: 'edge-cache' }));
    await speech().speak('Hello', 'cached');
    expect(mocks.invoke).toHaveBeenCalledWith('resolve_tts_audio', { request: expect.objectContaining({ onlineEnabled: false }) });
    expect(speech().source).toBe('edge-cache');
    await speech().clearCache();
    expect(speech().status).toBe('idle');
    expect(mocks.invoke).toHaveBeenLastCalledWith('clear_tts_cache');
    expect(TestAudio.all[0].pause).toHaveBeenCalled();
  });

  it('stops on app background and rejects a late response without device fallback', async () => {
    const listeners = new Map<string, () => void>();
    const lifecycle = { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
    vi.stubGlobal('document', lifecycle);
    const response = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementationOnce(() => response.promise);
    const request = speech().speak('Hello', 'background');
    lifecycle.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    response.reject({ code: 'network' }); await request;
    expect(speech().status).toBe('idle');
    expect(TestAudio.all).toHaveLength(0);
    expect(deviceSpeak).not.toHaveBeenCalled();
  });

  it('does not stop for an unchanged preference and ignores a stale play promise rejection', async () => {
    const playing = pending<void>();
    class PendingAudio extends TestAudio { play = vi.fn(() => playing.promise); }
    vi.stubGlobal('Audio', PendingAudio);
    const first = speech().speak('Hello', 'first');
    await Promise.resolve();
    usePreferencesStore.getState().setSpeech({ accent: 'us' });
    expect(speech()).toMatchObject({ key: 'first', status: 'loading' });
    vi.stubGlobal('Audio', TestAudio);
    await speech().speak('Next sentence.', 'next');
    playing.reject({ name: 'NotAllowedError' }); await first;
    expect(speech()).toMatchObject({ key: 'next', status: 'playing', error: false });
    expect(deviceSpeak).not.toHaveBeenCalled();
  });
});

describe('truthful failure and device fallback', () => {
  it('uses an explicitly marked matching local device voice only after Edge fails', async () => {
    mocks.invoke.mockRejectedValueOnce({ code: 'service_rejected', retryable: false });
    await speech().speak('A complete sentence.', 'sentence');
    expect(speech()).toMatchObject({ key: 'sentence', status: 'playing', source: 'device', error: false });
    expect(utterances[0]).toMatchObject({ text: 'A complete sentence.', lang: 'en-US', rate: 1 });
    expect(utterances[0].voice?.localService).toBe(true);
    expect(TestAudio.all).toHaveLength(0);
  });

  it('never falls back when disabled, for invalid input, or after a request was cancelled', async () => {
    usePreferencesStore.getState().setSpeech({ allowDeviceFallback: false });
    mocks.invoke.mockRejectedValueOnce({ code: 'rate_limited' });
    await speech().speak('Hello', 'one');
    expect(speech()).toMatchObject({ status: 'error', errorCode: 'rate_limited', errorKey: 'one' });
    usePreferencesStore.getState().setSpeech({ allowDeviceFallback: true });
    mocks.invoke.mockRejectedValueOnce({ code: 'invalid_input' });
    await speech().speak('/ipa/', 'two');
    expect(speech().errorCode).toBe('invalid_input');
    expect(deviceSpeak).not.toHaveBeenCalled();
    const count = mocks.invoke.mock.calls.length;
    await speech().speak('x'.repeat(1001), 'long');
    expect(speech().errorCode).toBe('too_long');
    expect(mocks.invoke.mock.calls).toHaveLength(count);
  });

  it('rejects wrong-accent, nonlocal, and non-English fallback voices', async () => {
    vi.stubGlobal('window', { speechSynthesis: { cancel, speak: deviceSpeak, getVoices: () => [
      { lang: 'en-GB', localService: true }, { lang: 'en-US', localService: false }, { lang: 'ja-JP', localService: true },
    ] } });
    mocks.invoke.mockRejectedValueOnce({ code: 'timeout' });
    await speech().speak('Hello', 'one');
    expect(speech()).toMatchObject({ status: 'error', errorCode: 'no_device_voice', errorKey: 'one' });
    expect(deviceSpeak).not.toHaveBeenCalled();
  });

  it('isolates device start/end/error callbacks after another reading takes ownership', async () => {
    mocks.invoke.mockRejectedValueOnce({ code: 'network' });
    await speech().speak('Device first.', 'first');
    const start = utterances[0].onstart!, end = utterances[0].onend!, error = utterances[0].onerror!;
    await speech().speak('Edge next.', 'next');
    start.call(utterances[0], null!); end.call(utterances[0], null!); error.call(utterances[0], null!);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speech()).toMatchObject({ key: 'next', status: 'playing', source: 'edge-network', error: false });
  });

  it('reports a recoverable device failure if a fallback engine never starts', async () => {
    vi.useFakeTimers();
    deviceSpeak.mockImplementation(() => {});
    mocks.invoke.mockRejectedValueOnce({ code: 'network' });
    await speech().speak('Hello', 'device-stalled');
    expect(speech()).toMatchObject({ source: 'device', status: 'loading' });
    await vi.advanceTimersByTimeAsync(4000);
    expect(speech()).toMatchObject({ status: 'error', errorCode: 'device_failed', errorKey: 'device-stalled' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid cached result when autoplay permission blocks and does not switch sources', async () => {
    class BlockedAudio extends TestAudio { play = vi.fn(() => Promise.reject({ name: 'NotAllowedError' })); }
    vi.stubGlobal('Audio', BlockedAudio);
    await speech().speak('Hello', 'one');
    expect(speech()).toMatchObject({ status: 'error', errorCode: 'playback_blocked', source: 'edge-network' });
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'invalidate_tts_cache')).toBe(false);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio')).toHaveLength(1);
  });

  it('invalidates a failed decoder cache once, then marks the device source explicitly', async () => {
    await speech().speak('Hello', 'one');
    const failure = TestAudio.all[0].onerror!;
    failure(); failure();
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'invalidate_tts_cache')).toEqual([['invalidate_tts_cache', { cacheKey: 'key' }]]);
    expect(speech().source).toBe('device');
    expect(deviceSpeak).toHaveBeenCalledTimes(1);
  });

  it('uses the same controller for old English helpers and preserves non-English records without sending them', async () => {
    playPronunciation('went', 'en'); await Promise.resolve(); await Promise.resolve();
    expect(mocks.invoke).toHaveBeenCalledWith('resolve_tts_audio', { request: expect.objectContaining({ text: 'went', kind: 'word' }) });
    const count = mocks.invoke.mock.calls.length;
    speakText('日本語', 'ja'); playPronunciation('Deutsch', 'de');
    expect(mocks.invoke.mock.calls).toHaveLength(count);
    expect(deviceSpeak).not.toHaveBeenCalled();
  });
});

describe('continuous material reading', () => {
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ text: `Sentence ${index + 1}.`, key: `row:${index}` }));
  const resolvedRequests = () => mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio');
  const settlePlayback = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('waits for actual audio completion and reads the whole material beyond the rendered window', async () => {
    const material = items(75);
    await speech().startQueue(material);
    expect(speech()).toMatchObject({ key: 'row:0', queueActive: true, queueIndex: 0, status: 'playing' });
    expect(resolvedRequests()).toHaveLength(1);
    await settlePlayback();
    expect(resolvedRequests()).toHaveLength(1);
    for (let index = 0; index < material.length; index++) {
      expect(speech().key).toBe(material[index].key);
      expect(resolvedRequests()[index][1].request.text).toBe(material[index].text);
      TestAudio.all[index].onended!();
      await settlePlayback();
    }
    expect(resolvedRequests()).toHaveLength(75);
    expect(TestAudio.all).toHaveLength(75);
    expect(speech()).toMatchObject({ key: null, queueActive: false, queueIndex: null, status: 'idle' });
  });

  it('jumps immediately to a chosen sentence and restarts even the currently active sentence', async () => {
    const material = items(80);
    await speech().startQueue(material);
    const oldEnd = TestAudio.all[0].onended!;
    await speech().startQueue(material, 64);
    expect(speech()).toMatchObject({ key: 'row:64', queueActive: true, queueIndex: 64 });
    expect(TestAudio.all[0].pause).toHaveBeenCalled();
    const chosenEnd = TestAudio.all[1].onended!;
    await speech().startQueue(material, 64);
    oldEnd(); chosenEnd();
    await settlePlayback();
    expect(resolvedRequests().map(call => call[1].request.text)).toEqual(['Sentence 1.', 'Sentence 65.', 'Sentence 65.']);
    expect(speech().key).toBe('row:64');
    TestAudio.all[2].onended!();
    await settlePlayback();
    expect(speech()).toMatchObject({ key: 'row:65', queueIndex: 65 });
  });

  it('ignores late requests after rapid jumps and after stopping the queue', async () => {
    const first = pending<ReturnType<typeof edge>>(), second = pending<ReturnType<typeof edge>>(), third = pending<ReturnType<typeof edge>>();
    const responses = [first, second, third];
    let index = 0;
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? responses[index++].promise : Promise.resolve());
    const material = items(3);
    const requests = [speech().startQueue(material), speech().startQueue(material, 1), speech().startQueue(material, 2)];
    first.resolve(edge()); second.reject({ code: 'network' });
    speech().stop();
    third.resolve(edge());
    await Promise.all(requests);
    expect(TestAudio.all).toHaveLength(0);
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(speech()).toMatchObject({ queueActive: false, queueIndex: null, key: null, status: 'idle' });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cancel_tts')).toHaveLength(3);
  });

  it('stops the queue on failure, preserves the failed sentence, and permits an explicit retry', async () => {
    usePreferencesStore.getState().setSpeech({ allowDeviceFallback: false });
    const material = items(3);
    await speech().startQueue(material);
    mocks.invoke.mockRejectedValueOnce({ code: 'offline_missing' });
    TestAudio.all[0].onended!();
    await settlePlayback();
    expect(speech()).toMatchObject({ status: 'error', queueActive: false, queueIndex: null, errorKey: 'row:1', errorCode: 'offline_missing' });
    expect(resolvedRequests()).toHaveLength(2);
    await speech().startQueue(material, 1);
    expect(speech()).toMatchObject({ status: 'playing', queueActive: true, queueIndex: 1, key: 'row:1', error: false });
    expect(resolvedRequests()).toHaveLength(3);
  });

  it('advances device fallback only on utterance end and cannot advance after cancellation', async () => {
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? Promise.reject({ code: 'network' }) : Promise.resolve());
    await speech().startQueue(items(3));
    expect(speech()).toMatchObject({ source: 'device', status: 'playing', queueIndex: 0 });
    expect(resolvedRequests()).toHaveLength(1);
    utterances[0].onend!.call(utterances[0], null!);
    await settlePlayback();
    expect(speech()).toMatchObject({ source: 'device', queueIndex: 1, key: 'row:1' });
    const lateEnd = utterances[1].onend!, lateError = utterances[1].onerror!;
    speech().stop();
    lateEnd.call(utterances[1], null!); lateError.call(utterances[1], null!);
    await settlePlayback();
    expect(resolvedRequests()).toHaveLength(2);
    expect(speech()).toMatchObject({ status: 'idle', queueActive: false });
  });

  it('does not let a failed decoder completion advance while its device fallback is still reading', async () => {
    await speech().startQueue(items(3));
    const staleEnd = TestAudio.all[0].onended!;
    TestAudio.all[0].onerror!();
    await settlePlayback();
    expect(speech()).toMatchObject({ source: 'device', queueIndex: 0 });
    staleEnd();
    expect(resolvedRequests()).toHaveLength(1);
    utterances[0].onend!.call(utterances[0], null!);
    await settlePlayback();
    expect(speech()).toMatchObject({ queueIndex: 1, key: 'row:1' });
    expect(resolvedRequests()).toHaveLength(2);
  });
});
