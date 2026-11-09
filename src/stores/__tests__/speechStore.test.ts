import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('navigator', { language: 'en-US' });
  return { invoke: vi.fn(), storage: values, nativeEvent: { handler: null as null | ((event: {payload: {id:string,index:number,status:string}}) => void) } };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn((_event, handler) => { mocks.nativeEvent.handler = handler; return Promise.resolve(() => {}); }) }));
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
  static get played() { return TestAudio.all.filter(player => player.play.mock.calls.length > 0); }
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
    expect(TestAudio.played).toHaveLength(1);
    TestAudio.played[0].onended!();
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
    expect(TestAudio.played).toHaveLength(1);
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
    expect(TestAudio.played).toHaveLength(0);
    expect(speech().status).toBe('idle');
    await speech().speak('first', 'first');
    const oldEnd = TestAudio.played[0].onended!, oldError = TestAudio.played[0].onerror!;
    await speech().speak('second', 'second');
    oldEnd(); oldError();
    expect(speech()).toMatchObject({ key: 'second', status: 'playing', error: false });
    expect(TestAudio.played[0].pause).toHaveBeenCalled();
  });

  it('stops pending generation when preferences change without automatically generating or speaking', async () => {
    const response = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementationOnce(() => response.promise);
    const request = speech().speak('Hello', 'one');
    usePreferencesStore.getState().setSpeech({ accent: 'gb', speed: 'slow' });
    response.resolve(edge()); await request;
    expect(TestAudio.played).toHaveLength(0);
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
    expect(TestAudio.played[0].pause).toHaveBeenCalled();
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
    expect(TestAudio.played).toHaveLength(0);
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
    expect(TestAudio.played).toHaveLength(0);
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
    const failure = TestAudio.played[0].onerror!;
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
    expect(resolvedRequests()).toHaveLength(2);
    await settlePlayback();
    expect(resolvedRequests()).toHaveLength(2);
    expect(TestAudio.played).toHaveLength(1);
    for (let index = 0; index < material.length; index++) {
      expect(speech().key).toBe(material[index].key);
      expect(resolvedRequests()[index][1].request.text).toBe(material[index].text);
      TestAudio.played[index].onended!();
      await settlePlayback();
    }
    expect(resolvedRequests()).toHaveLength(75);
    expect(TestAudio.played).toHaveLength(75);
    expect(speech()).toMatchObject({ key: null, queueActive: false, queueIndex: null, status: 'idle' });
  });

  it('jumps immediately to a chosen sentence and restarts even the currently active sentence', async () => {
    const material = items(80);
    await speech().startQueue(material);
    const oldEnd = TestAudio.played[0].onended!;
    await speech().startQueue(material, 64);
    expect(speech()).toMatchObject({ key: 'row:64', queueActive: true, queueIndex: 64 });
    expect(TestAudio.played[0].pause).toHaveBeenCalled();
    const chosenEnd = TestAudio.played[1].onended!;
    await speech().startQueue(material, 64);
    oldEnd(); chosenEnd();
    await settlePlayback();
    expect(resolvedRequests().map(call => call[1].request.text)).toEqual(['Sentence 1.', 'Sentence 2.', 'Sentence 65.', 'Sentence 66.', 'Sentence 65.', 'Sentence 66.']);
    expect(speech().key).toBe('row:64');
    TestAudio.played[2].onended!();
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
    expect(TestAudio.played).toHaveLength(0);
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(speech()).toMatchObject({ queueActive: false, queueIndex: null, key: null, status: 'idle' });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cancel_tts')).toHaveLength(3);
  });

  it('stops the queue on failure, preserves the failed sentence, and permits an explicit retry', async () => {
    usePreferencesStore.getState().setSpeech({ allowDeviceFallback: false });
    const material = items(3);
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' && args.request?.text === 'Sentence 2.' ? Promise.reject({ code: 'offline_missing' }) : Promise.resolve(edge()));
    await speech().startQueue(material);
    TestAudio.played[0].onended!();
    await settlePlayback();
    expect(speech()).toMatchObject({ status: 'error', queueActive: true, queueIndex: 1, errorKey: 'row:1', errorCode: 'offline_missing', reading: { status: 'error', index: 1 } });
    expect(resolvedRequests()).toHaveLength(2);
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? Promise.resolve(edge()) : Promise.resolve());
    await speech().startQueue(material, 1);
    expect(speech()).toMatchObject({ status: 'playing', queueActive: true, queueIndex: 1, key: 'row:1', error: false });
    expect(resolvedRequests()).toHaveLength(4);
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
    const staleEnd = TestAudio.played[0].onended!;
    TestAudio.played[0].onerror!();
    await settlePlayback();
    expect(speech()).toMatchObject({ source: 'device', queueIndex: 0 });
    staleEnd();
    expect(resolvedRequests()).toHaveLength(2);
    utterances[0].onend!.call(utterances[0], null!);
    await settlePlayback();
    expect(speech()).toMatchObject({ queueIndex: 1, key: 'row:1' });
    expect(resolvedRequests()).toHaveLength(4);
  });
});

describe('one-sentence reading prefetch', () => {
  const material = [
    { text: 'First sentence.', key: 'prefetch:0' },
    { text: 'Second sentence.', key: 'prefetch:1' },
    { text: 'Third sentence.', key: 'prefetch:2' },
  ];
  const requests = () => mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio');
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  it('does no speculative work before explicit reading and starts only after current playback begins', async () => {
    const first = pending<ReturnType<typeof edge>>(), playing = pending<void>();
    class PendingPlayAudio extends TestAudio { play = vi.fn(() => playing.promise); }
    vi.stubGlobal('Audio', PendingPlayAudio);
    expect(requests()).toHaveLength(0);
    mocks.invoke.mockImplementationOnce(() => first.promise);
    const started = speech().startQueue(material);
    expect(requests()).toHaveLength(1);
    first.resolve(edge()); await settle();
    expect(TestAudio.played).toHaveLength(1);
    expect(requests()).toHaveLength(1);
    TestAudio.played[0].onplaying!();
    expect(requests()).toHaveLength(2);
    playing.resolve(); await started;
    // Repeated playing events and play() completion share a single next request.
    TestAudio.played[0].onplaying!();
    expect(requests()).toHaveLength(2);
    expect(speech()).toMatchObject({ key: 'prefetch:0', queueIndex: 0, status: 'playing' });
    expect(TestAudio.played).toHaveLength(1);
  });

  it('promotes an in-flight next request without cancelling or requesting it twice', async () => {
    const next = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' && args.request?.text === material[1].text ? next.promise : Promise.resolve(edge()));
    await speech().startQueue(material);
    const id = requests()[1][1].request.requestId;
    TestAudio.played[0].onended!(); await settle();
    expect(speech()).toMatchObject({ queueIndex: 1, status: 'loading' });
    expect(requests()).toHaveLength(2);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'cancel_tts')).toHaveLength(0);
    next.resolve(edge({ source: 'edge-cache' })); await settle();
    expect(speech()).toMatchObject({ queueIndex: 1, status: 'playing', source: 'edge-cache' });
    expect(requests()).toHaveLength(3);
    expect(requests()[1][1].request.requestId).toBe(id);
    expect(TestAudio.played).toHaveLength(2);
    TestAudio.played[1].onended!(); await settle();
    TestAudio.played[2].onended!(); await settle();
    expect(requests()).toHaveLength(3);
    expect(speech()).toMatchObject({ status: 'idle', reading: null });
  });

  it('plays adjacent identical text as distinct sentences with one request for each', async () => {
    await speech().startQueue([{ text: 'Again.', key: 'same:0' }, { text: 'Again.', key: 'same:1' }]);
    expect(requests()).toHaveLength(2);
    expect(new Set(requests().map(call => call[1].request.requestId)).size).toBe(2);
    TestAudio.played[0].onended!(); await settle();
    expect(speech()).toMatchObject({ key: 'same:1', queueIndex: 1, status: 'playing' });
    expect(requests()).toHaveLength(2);
    expect(TestAudio.played).toHaveLength(2);
  });

  it.each(['stop', 'pause', 'preferences', 'jump', 'clear-cache'] as const)('cancels pending prefetch on %s and drops a late result', async action => {
    const next = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' && args.request?.text === material[1].text ? next.promise : Promise.resolve(edge()));
    await speech().startQueue(material);
    const id = requests()[1][1].request.requestId;
    const staleEnd = TestAudio.played[0].onended!;
    if (action === 'stop') speech().stop();
    else if (action === 'pause') speech().pause();
    else if (action === 'preferences') usePreferencesStore.getState().setSpeech({ accent: 'gb' });
    else if (action === 'jump') await speech().startQueue(material, 2);
    else await speech().clearCache();
    expect(mocks.invoke).toHaveBeenCalledWith('cancel_tts', { requestId: id });
    next.resolve(edge()); staleEnd(); await settle();
    expect(TestAudio.played).toHaveLength(action === 'jump' ? 2 : 1);
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(speech().queueIndex).toBe(action === 'pause' ? 0 : action === 'jump' ? 2 : null);
    expect(requests()).toHaveLength(action === 'jump' ? 3 : 2);
  });

  it('cancels a promoted pending request when the user stops between sentences', async () => {
    const next = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' && args.request?.text === material[1].text ? next.promise : Promise.resolve(edge()));
    await speech().startQueue(material);
    const id = requests()[1][1].request.requestId;
    TestAudio.played[0].onended!(); await settle();
    speech().stop();
    expect(mocks.invoke).toHaveBeenCalledWith('cancel_tts', { requestId: id });
    next.reject({ code: 'network' }); await settle();
    expect(TestAudio.played).toHaveLength(1);
    expect(deviceSpeak).not.toHaveBeenCalled();
    expect(speech()).toMatchObject({ status: 'idle', reading: null });
    expect(requests()).toHaveLength(2);
  });

  it('cancels speculation for lookup and resumes the retained player with a fresh next request', async () => {
    const discarded = pending<ReturnType<typeof edge>>();
    let nextAttempts = 0;
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => {
      if (command !== 'resolve_tts_audio') return Promise.resolve();
      if (args.request?.text === material[1].text && ++nextAttempts === 1) return discarded.promise;
      return Promise.resolve(edge());
    });
    await speech().startQueue(material.slice(0, 2));
    const reader = TestAudio.played[0];
    const id = requests()[1][1].request.requestId;
    await speech().speak('word', 'lookup:prefetch', { kind: 'word' });
    expect(mocks.invoke).toHaveBeenCalledWith('cancel_tts', { requestId: id });
    expect(speech().reading).toMatchObject({ status: 'paused', index: 0 });
    await speech().resume();
    expect(reader.play).toHaveBeenCalledTimes(2);
    expect(requests()).toHaveLength(4);
    expect(requests()[3][1].request.requestId).not.toBe(id);
    discarded.reject({ code: 'network' }); await settle();
    expect(speech()).toMatchObject({ key: 'prefetch:0', status: 'playing' });
    reader.onended!(); await settle();
    expect(speech()).toMatchObject({ key: 'prefetch:1', status: 'playing' });
    expect(requests()).toHaveLength(4);
    expect(deviceSpeak).not.toHaveBeenCalled();
  });

  it('keeps a failed prefetch silent until the next sentence, then falls back once', async () => {
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' && args.request?.text === material[1].text ? Promise.reject({ code: 'network' }) : Promise.resolve(edge()));
    await speech().startQueue(material); await settle();
    expect(speech()).toMatchObject({ queueIndex: 0, status: 'playing', error: false });
    expect(deviceSpeak).not.toHaveBeenCalled();
    TestAudio.played[0].onended!(); await settle();
    expect(speech()).toMatchObject({ key: 'prefetch:1', source: 'device', status: 'playing' });
    expect(utterances[0].text).toBe(material[1].text);
    expect(deviceSpeak).toHaveBeenCalledTimes(1);
    expect(requests()).toHaveLength(2);
    utterances[0].onend!.call(utterances[0], null!); await settle();
    expect(speech()).toMatchObject({ queueIndex: 2, source: 'edge-network', status: 'playing' });
    expect(requests()).toHaveLength(3);
  });

  it('rejects a prefetched result in the wrong voice before playing it', async () => {
    mocks.invoke.mockImplementation((command: string, args: { request?: { text: string } }) => command === 'resolve_tts_audio' ? Promise.resolve(edge(args.request?.text === material[1].text ? { voice: 'en-GB-SoniaNeural' } : {})) : Promise.resolve());
    await speech().startQueue(material);
    TestAudio.played[0].onended!(); await settle();
    expect(TestAudio.played).toHaveLength(1);
    expect(speech()).toMatchObject({ queueIndex: 1, source: 'device', status: 'playing' });
    expect(requests()).toHaveLength(2);
  });

  it('skips speculation when online speech is disabled while preserving cached sentence playback', async () => {
    usePreferencesStore.getState().setSpeech({ onlineEnabled: false });
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' ? Promise.resolve(edge({ source: 'edge-cache' })) : Promise.resolve());
    await speech().startQueue(material);
    expect(requests()).toHaveLength(1);
    TestAudio.played[0].onended!(); await settle();
    expect(speech()).toMatchObject({ queueIndex: 1, source: 'edge-cache', status: 'playing' });
    expect(requests()).toHaveLength(2);
    expect(requests().every(call => call[1].request.onlineEnabled === false)).toBe(true);
  });
});

describe('prepared sentence handoff and padding', () => {
  const items = [{ text: 'First sentence.', key: 'trim:0' }, { text: 'Next sentence.', key: 'trim:1' }];
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  it('loads the next player silently, reuses it at handoff and releases it on cancellation', async () => {
    await speech().startQueue(items); await settle();
    expect(TestAudio.all).toHaveLength(2);
    const prepared = TestAudio.all[1];
    expect(prepared.load).toHaveBeenCalledOnce();
    expect(prepared.play).not.toHaveBeenCalled();
    TestAudio.played[0].onended!(); await settle();
    expect(TestAudio.played[1]).toBe(prepared);
    expect(TestAudio.all).toHaveLength(2);
    speech().stop();
    expect(prepared.removeAttribute).toHaveBeenCalledWith('src');
    await speech().startQueue(items); await settle();
    const cancelled = TestAudio.all.at(-1)!;
    speech().pause();
    expect(cancelled.play).not.toHaveBeenCalled();
    expect(cancelled.removeAttribute).toHaveBeenCalledWith('src');
  });
  it('seeks only reading audio past validated leading silence and keeps single pronunciation complete', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'resolve_tts_audio' ? edge({ speech_start_ms: 140, speech_end_ms: 850 }) : undefined));
    await speech().startQueue(items); await settle();
    const first = TestAudio.played[0] as TestAudio & { duration: number; currentTime: number; onloadedmetadata: () => void };
    first.duration = 1; first.onloadedmetadata(); expect(first.currentTime).toBe(.14);
    const next = TestAudio.all[1] as typeof first;
    next.duration = 1; next.onloadedmetadata(); expect(next.currentTime).toBe(.14);
    speech().stop();
    await speech().speak('A quiet word.', 'single-onset');
    expect((TestAudio.played.at(-1) as unknown as HTMLAudioElement).onloadedmetadata).toBeUndefined();
  });
  it('advances after the final word plus 120ms, keeps the final clip intact and ignores a stale clock', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++sequence, cb); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'resolve_tts_audio' ? edge({ duration_ms: 3816, speech_end_ms: 2950 }) : undefined));
    await speech().startQueue(items); await settle();
    const first = TestAudio.played[0] as TestAudio & { currentTime: number };
    const tick = () => { const entry = [...frames.entries()].at(-1)!; frames.delete(entry[0]); entry[1](0); };
    first.currentTime = 3.069; tick(); expect(speech().queueIndex).toBe(0);
    const stale = [...frames.values()].at(-1)!;
    first.currentTime = 3.07; tick(); await settle();
    expect(speech()).toMatchObject({ queueIndex: 1, status: 'playing' });
    expect(first.pause).toHaveBeenCalled();
    stale(0); expect(speech().queueIndex).toBe(1);
    expect(frames.size).toBe(0);
    TestAudio.played[1].onended!(); expect(speech().status).toBe('idle');
  });
  it.each([undefined, NaN, -1, 9000])('keeps natural EOF when endpoint is invalid: %s', async speech_end_ms => {
    const clock = vi.fn(); vi.stubGlobal('requestAnimationFrame', clock);
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'resolve_tts_audio' ? edge({ speech_end_ms }) : undefined));
    await speech().startQueue(items); await settle();
    expect(clock).not.toHaveBeenCalled(); expect(speech().queueIndex).toBe(0);
    TestAudio.played[0].onended!(); await settle(); expect(speech().queueIndex).toBe(1);
  });
});

describe('retained reading session', () => {
  const items = [{ text: 'First sentence.', key: 'reader:doc:0' }, { text: 'Second sentence.', key: 'reader:doc:1' }];
  it('pauses during loading, drops late audio, and resumes the same sentence', async () => {
    const first = pending<ReturnType<typeof edge>>();
    mocks.invoke.mockImplementation((command: string) => command === 'resolve_tts_audio' && mocks.invoke.mock.calls.filter(([name]) => name === command).length === 1 ? first.promise : Promise.resolve(edge()));
    const started = speech().startQueue(items);
    speech().pause('selection');
    first.resolve(edge()); await started;
    expect(TestAudio.played).toHaveLength(0);
    expect(speech().reading).toMatchObject({ status: 'paused', index: 0, pauseReason: 'selection' });
    await speech().resume();
    expect(speech().reading).toMatchObject({ status: 'playing', index: 0 });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio')).toHaveLength(3);
  });

  it('ignores a rejected play promise after pausing the reading channel', async () => {
    const firstPlay = pending<void>();
    class PendingPlayAudio extends TestAudio {
      calls = 0;
      play = vi.fn(() => this.calls++ === 0 ? firstPlay.promise : Promise.resolve());
    }
    vi.stubGlobal('Audio', PendingPlayAudio);
    const started = speech().startQueue(items);
    for (let attempt = 0; attempt < 4 && TestAudio.played.length === 0; attempt++) await Promise.resolve();
    expect(TestAudio.played).toHaveLength(1);
    speech().pause('selection');
    TestAudio.played[0].onplaying?.();
    expect(TestAudio.played[0].pause).toHaveBeenCalledTimes(2);
    firstPlay.reject({ name: 'NotAllowedError' }); await started;
    expect(speech()).toMatchObject({ status: 'paused', error: false, reading: { status: 'paused', index: 0 } });
    await speech().resume();
    expect(speech().reading?.status).toBe('playing');
  });

  it('retains the paused player and cursor while a word takes the channel, then resumes explicitly', async () => {
    await speech().startQueue(items);
    const reader = TestAudio.played[0] as TestAudio & { currentTime: number; playbackRate: number };
    reader.currentTime = .42;
    speech().pause('lookup');
    await speech().speak('word', 'word:1', { kind: 'word' });
    expect(speech()).toMatchObject({ status: 'playing', playbackMode: 'single', reading: { status: 'paused', index: 0, pauseReason: 'lookup' } });
    TestAudio.played[1].onended!();
    expect(speech()).toMatchObject({ status: 'paused', reading: { status: 'paused', index: 0 } });
    expect(reader.currentTime).toBe(.42);
    await speech().resume();
    expect(reader.play).toHaveBeenCalledTimes(2);
    expect(TestAudio.played).toHaveLength(2);
    reader.onended!(); await Promise.resolve(); await Promise.resolve();
    expect(speech().reading).toMatchObject({ index: 1, status: 'playing' });
  });

  it('closing an owned pronunciation leaves the reading session paused and the original player intact', async () => {
    await speech().startQueue(items);
    const reader = TestAudio.played[0];
    speech().pause('lookup');
    await speech().speak('word', 'lookup:word', { kind: 'word', owner: 'button', ownerScope: 'card' });
    speech().stopScope('card');
    expect(speech()).toMatchObject({ status: 'paused', reading: { status: 'paused', index: 0 } });
    expect(reader.removeAttribute).not.toHaveBeenCalled();
    await speech().resume();
    expect(reader.play).toHaveBeenCalledTimes(2);
  });

  it('a second click on the same word only stops that pronunciation', async () => {
    await speech().startQueue(items);
    const reader = TestAudio.played[0];
    speech().pause('lookup');
    await speech().speak('word', 'lookup:word', { kind: 'word', ownerScope: 'card' });
    await speech().speak('word', 'lookup:word', { kind: 'word', ownerScope: 'card' });
    expect(speech().reading).toMatchObject({ status: 'paused', index: 0 });
    expect(reader.removeAttribute).not.toHaveBeenCalled();
    await speech().resume();
    expect(reader.play).toHaveBeenCalledTimes(2);
  });

  it('owner-scoped stop preserves reading and an older same-key button cannot stop a newer owner', async () => {
    await speech().startQueue(items);
    const reader = TestAudio.played[0];
    speech().pause('lookup');
    await speech().speak('word', 'lookup:word', { kind: 'word', owner: 'old' });
    await speech().speak('word', 'lookup:word', { kind: 'word', owner: 'new' });
    const newer = TestAudio.played[2];
    speech().stopOwned('old');
    expect(speech()).toMatchObject({ owner: 'new', status: 'playing', reading: { status: 'paused' } });
    expect(newer.pause).not.toHaveBeenCalled();
    speech().stopOwned('new');
    expect(speech()).toMatchObject({ status: 'paused', reading: { status: 'paused', index: 0 } });
    expect(reader.removeAttribute).not.toHaveBeenCalled();
  });

  it('single failure retains the paused reading player for explicit recovery', async () => {
    usePreferencesStore.getState().setSpeech({ allowDeviceFallback: false });
    await speech().startQueue(items);
    const reader = TestAudio.played[0];
    speech().pause('lookup');
    mocks.invoke.mockRejectedValueOnce({ code: 'offline_missing' });
    await speech().speak('word', 'lookup:word', { kind: 'word', ownerScope: 'card' });
    expect(speech()).toMatchObject({ status: 'error', errorCode: 'offline_missing', reading: { status: 'paused' } });
    speech().stopScope('card');
    expect(speech().reading).toMatchObject({ status: 'paused', index: 0 });
    await speech().resume();
    expect(speech()).toMatchObject({ status: 'playing', error: false, errorCode: null, reading: { status: 'playing' } });
    expect(reader.pause).toHaveBeenCalled();
  });

  it('exits reading without stopping an unrelated pronunciation channel', async () => {
    await speech().startQueue(items);
    speech().pause('lookup');
    await speech().speak('word', 'lookup:word', { kind: 'word', ownerScope: 'card' });
    const word = TestAudio.played[1];
    speech().exitReading();
    expect(speech()).toMatchObject({ status: 'playing', reading: null, queueActive: false, key: 'lookup:word' });
    expect(word.pause).not.toHaveBeenCalled();
    word.onended!();
    expect(speech().status).toBe('idle');
  });

  it('pauses reading on background without automatic resume when visible again', async () => {
    const listeners = new Map<string, () => void>();
    const lifecycle = { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
    vi.stubGlobal('document', lifecycle);
    await speech().startQueue(items);
    lifecycle.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
    expect(speech().reading).toMatchObject({ status: 'paused', pauseReason: 'hidden', index: 0 });
    lifecycle.visibilityState = 'visible'; listeners.get('visibilitychange')!();
    expect(speech().reading?.status).toBe('paused');
  });

  it('owns an iOS queue across background, ignores stale events, and retains user pause/resume', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', maxTouchPoints: 5 });
    const listeners = new Map<string, () => void>();
    const lifecycle = { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
    vi.stubGlobal('document', lifecycle);
    mocks.invoke.mockImplementation((command: string, args: {id?:string}) => command === 'ios_reading_control' ? Promise.resolve({id:args.id,index:0,status:'playing'}) : Promise.resolve());
    await speech().startQueue(items);
    const request = mocks.invoke.mock.calls.find(([name]) => name === 'ios_reading_start')![1].request;
    expect(request.texts).toEqual(items.map(item => item.text));
    expect(request).toMatchObject({voice:'en-US-JennyNeural',onlineEnabled:true,allowDeviceFallback:true});
    expect(speech().reading).toMatchObject({status:'playing',index:0});
    lifecycle.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
    expect(speech().reading?.status).toBe('playing');
    expect(TestAudio.played).toHaveLength(0);
    mocks.nativeEvent.handler!({payload:{id:'old-session',index:1,status:'playing'}});
    expect(speech().reading?.index).toBe(0);
    mocks.nativeEvent.handler!({payload:{id:request.id,index:1,status:'playing'}});
    expect(speech().reading?.index).toBe(1);
    speech().pause();
    expect(mocks.invoke).toHaveBeenCalledWith('ios_reading_control',{id:request.id,action:'pause'});
    expect(speech().reading).toMatchObject({status:'paused',pauseReason:'user'});
    await speech().resume();
    expect(mocks.invoke).toHaveBeenCalledWith('ios_reading_control',{id:request.id,action:'resume'});
    speech().setRate(1.25);
    await vi.waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('ios_reading_start',{request:expect.objectContaining({rate:1.25,voice:'en-US-JennyNeural'})}));
    const latest = mocks.invoke.mock.calls.filter(([name])=>name==='ios_reading_start').at(-1)![1].request;
    speech().stop();
    expect(mocks.invoke).toHaveBeenCalledWith('ios_reading_control',{id:latest.id,action:'stop'});
    mocks.nativeEvent.handler!({payload:{id:request.id,index:1,status:'playing'}});
    expect(speech().reading).toBeNull();
  });

  it('backgrounding stops an active word while retaining its paused reading session', async () => {
    const listeners = new Map<string, () => void>();
    const lifecycle = { visibilityState: 'visible', addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) };
    vi.stubGlobal('document', lifecycle);
    await speech().startQueue(items);
    speech().pause('lookup');
    await speech().speak('word', 'lookup:word', { kind: 'word' });
    const word = TestAudio.played[1];
    lifecycle.visibilityState = 'hidden'; listeners.get('visibilitychange')!();
    expect(word.pause).toHaveBeenCalled();
    expect(speech()).toMatchObject({ status: 'paused', reading: { status: 'paused', pauseReason: 'hidden' } });
  });

  it('uses normal synthesis once and changes only the reading audio clock', async () => {
    usePreferencesStore.getState().setSpeech({ speed: 'slow' });
    await speech().startQueue(items);
    const player = TestAudio.played[0] as TestAudio & { playbackRate: number };
    expect(mocks.invoke).toHaveBeenCalledWith('resolve_tts_audio', { request: expect.objectContaining({ speed: 'normal' }) });
    speech().setRate(1.5);
    expect(player.playbackRate).toBe(1.5);
    expect(speech().reading).toMatchObject({ rate: 1.5, status: 'playing' });
    speech().pause();
    await speech().replayCurrent();
    expect(TestAudio.played).toHaveLength(2);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio')).toHaveLength(4);
    expect(speech().reading).toMatchObject({ index: 0, status: 'playing', rate: 1.5 });
  });

  it('states that device fallback resumes by restarting the sentence', async () => {
    mocks.invoke.mockRejectedValueOnce({ code: 'network' });
    await speech().startQueue(items);
    expect(speech().reading).toMatchObject({ resumeMode: 'restart-sentence', status: 'playing' });
    speech().pause();
    expect(cancel).toHaveBeenCalledTimes(1);
    await speech().resume();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'resolve_tts_audio')).toHaveLength(3);
    expect(speech().reading).toMatchObject({ index: 0, status: 'playing' });
  });
});
