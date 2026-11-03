import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
  vi.stubGlobal('navigator', { language: 'en' });
  return { invoke: vi.fn() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => `asset://${path}` }));
import { useSpeechStore } from '../speechStore';
import { usePreferencesStore } from '../preferencesStore';
import { normalizeSpeechPreferences } from '../../lib/speechPreferences';
class Player extends EventTarget {
  static all: Player[] = []; static metadataDuration=8;
  src = ''; preload = ''; duration = Player.metadataDuration; defaultPlaybackRate = 1; playbackRate = 1; paused = true;
  onended: (() => void) | null = null; onerror: (() => void) | null = null; onplaying: (() => void) | null = null;
  time = 0;
  set currentTime(v: number) { this.time = v; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
  get currentTime() { return this.time; }
  // HTML media load resets playbackRate to defaultPlaybackRate, including reloads.
  load() { this.playbackRate = this.defaultPlaybackRate; if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
  rateAtPlay: number | null = null;
  play = vi.fn(async () => { this.rateAtPlay = this.playbackRate; this.paused = false; this.onplaying?.(); });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute() { this.src = ''; }
  constructor() { super(); Player.all.push(this); }
}
let frames: Map<number, FrameRequestCallback>, sequence = 0;
const speech = () => useSpeechStore.getState();
const result = { path: '/managed/hash.m4a', start_ms: 1000, end_ms: 2000, duration_ms: 8000 };
beforeEach(() => {
  Player.metadataDuration=8;
  frames = new Map();
  vi.stubGlobal('Audio', Player); vi.stubGlobal('window', { addEventListener: vi.fn(), speechSynthesis: { getVoices: () => [] } });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Player.all = []; usePreferencesStore.setState({ speech: normalizeSpeechPreferences(null) }); speech().stop();
  mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue(result);
});
afterEach(() => { speech().stop(); vi.unstubAllGlobals(); });
describe('single owner for original clips and synthetic speech', () => {
  it('waits for native resolution, metadata and seek, then stops by the media clock at slow speed', async () => {
    usePreferencesStore.setState({ speech: { ...normalizeSpeechPreferences(null), speed: 'slow' } });
    await speech().speak('First tone.', 'first', { media: { segment_id: 1 } });
    const p = Player.all[0]; expect(p.currentTime).toBe(1); expect(p.playbackRate).toBe(.75); expect(p.defaultPlaybackRate).toBe(.75); expect(p.rateAtPlay).toBe(.75); expect(p.src).toBe('asset:///managed/hash.m4a');
    expect(speech()).toMatchObject({ source: 'source-media', status: 'playing' });
    p.time = 1.99; const tick = [...frames.values()][0]; tick(0); expect(speech().status).toBe('playing');
    p.time = 2.001; tick(0); expect(p.pause).toHaveBeenCalled(); expect(speech().status).toBe('idle');
  });
  it.each([{ speed: 'normal' as const, rate: 1 }, { speed: 'slow' as const, rate: .75 }])('keeps $speed through load and a zero-start clip without a seek event', async ({ speed, rate }) => {
    usePreferencesStore.setState({ speech: { ...normalizeSpeechPreferences(null), speed } });
    mocks.invoke.mockResolvedValue({ ...result, start_ms: 0 });
    await speech().speak('First tone.', 'zero-start', { media: { segment_id: 1 } });
    const p = Player.all[0];
    expect(p.currentTime).toBe(0);
    expect(p.rateAtPlay).toBe(rate);
    expect(p.playbackRate).toBe(rate);
    expect(p.defaultPlaybackRate).toBe(rate);
    // A subsequent HTML media load has the same default, rather than resetting slow to 1.
    p.load();
    expect(p.playbackRate).toBe(rate);
    p.time = 2.001; [...frames.values()][0](0);
    expect(speech().status).toBe('idle');
    expect(p.pause).toHaveBeenCalled();
  });
  it('stale source resolutions never interrupt a later TTS request or create an audio player', async () => {
    let resolve!: (r: unknown) => void;
    mocks.invoke.mockImplementation((cmd: string) => cmd === 'resolve_source_media' ? new Promise(done => { resolve = done; }) : Promise.reject('offline'));
    const first = speech().speak('First.', 'first', { media: { segment_id: 1 } });
    await speech().speak('Second.', 'second'); resolve(result); await first;
    expect(Player.all).toHaveLength(0); expect(speech().source).not.toBe('source-media');
  });
  it('rapidly switching clips and stopping cannot leave a player or a scheduled frame active', async () => {
    await speech().speak('First.', 'a', { media: { segment_id: 1 } }); const a = Player.all[0];
    await speech().speak('Second.', 'b', { media: { record_id: 'saved-b' } }); expect(a.paused).toBe(true);
    speech().stop(); expect(frames.size).toBe(0); expect(Player.all.every(p => p.paused)).toBe(true);
  });
  it('rejects invalid native ranges without playing or silently synthesizing', async () => {
    mocks.invoke.mockResolvedValue({ ...result, end_ms: 9000 }); await speech().speak('First.', 'a', { media: { segment_id: 1 } });
    expect(Player.all).toHaveLength(0); expect(speech().errorCode).toBe('media_invalid_range'); expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('clamps a verified EOF clip to native AAC frame padding without expanding its saved range', async()=>{
    Player.metadataDuration=7.977333;mocks.invoke.mockResolvedValue({...result,start_ms:6800,end_ms:8000});
    await speech().speak('Tail.','tail',{media:{segment_id:1}});const p=Player.all[0];expect(speech().status).toBe('playing');p.time=7.978;
    const [id,fn]=[...frames.entries()][0];frames.delete(id);fn(0);expect(speech().status).toBe('idle');
  });
  it('keeps the synthetic queue source fixed even when old callers pass media metadata', async () => {
    mocks.invoke.mockRejectedValue('offline');
    await speech().startQueue([{ text: 'First.', key: 'a', media: { segment_id: 1 }, rangeKey: 'cue-1' }]);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'resolve_source_media')).toBe(false);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'resolve_tts_audio')).toBe(true);
  });
});
