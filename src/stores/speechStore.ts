import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { MediaTarget } from '../lib/sourceMedia';
import { readingGroups, readingIndexAt, type ReadingAnchor, type ReadingPlayback, type ReadingSourceRequest, type ReadingSourceJump } from '../lib/sourceContinuous';
import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';
import { normalizeSpeechPreferences, type SpeechKind, type SpeechPreferences } from '../lib/speechPreferences';

export type SpeechSource = 'edge-cache' | 'edge-network' | 'device' | 'source-media';
export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'error';
export interface SpeechQueueItem { text: string; key: string; media?: MediaTarget; rangeKey?: string; }
interface TtsAudio {
    data_base64: string;
    mime: string;
    cache_key: string;
    source: 'edge-cache' | 'edge-network';
    voice: string;
    speed: string;
    duration_ms: number;
}
interface SpeechState {
    owner: string | null;
    ownerScope: string | null;
    stopOwned: (owner: string) => void;
    stopScope: (scope: string) => void;
    key: string | null;
    status: SpeechStatus;
    loading: boolean;
    source: SpeechSource | null;
    error: boolean;
    errorCode: string | null;
    errorKey: string | null;
    queueActive: boolean;
    queueIndex: number | null;
    playbackMode: 'single' | 'tts-queue' | 'source-continuous' | null;
    continuousFileId: number | null;
    continuousSourceKey: string | null;
    continuousAssetId: string | null;
    startSourceContinuous: (request: ReadingSourceRequest) => Promise<void>;
    jumpSourceContinuous: (request: ReadingSourceJump) => boolean;
    startQueue: (items: readonly SpeechQueueItem[], startIndex?: number) => Promise<void>;
    speak: (text: string, key: string, options?: { kind?: SpeechKind; media?: MediaTarget; owner?: string; ownerScope?: string | null }) => Promise<void>;
    stop: () => void;
    clearCache: () => Promise<void>;
}

interface ContinuousSession {
    request: ReadingSourceRequest;
    player: HTMLAudioElement | null;
    anchors: readonly ReadingAnchor[];
    pendingSegmentId: number;
    loaded: boolean;
    active: () => boolean;
}
let continuousSession: ContinuousSession | null = null;
let generation = 0;
let requestId: string | null = null;
let audio: HTMLAudioElement | null = null;
let mediaCleanup: (() => void) | null = null;
let deviceUtterance: SpeechSynthesisUtterance | null = null;
let deviceStartTimer: ReturnType<typeof setTimeout> | undefined;
let lifecycleWindow: Window | undefined;
let lifecycleDocument: Document | undefined;

function ignoreCommand(command: string, args: Record<string, unknown>) {
    void invoke(command, args).catch(() => { /* Cancellation/invalidation is best effort; never log text. */ });
}
function detachAudio() {
    mediaCleanup?.(); mediaCleanup = null;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
}
function clearDeviceStartTimer() {
    if (deviceStartTimer !== undefined) clearTimeout(deviceStartTimer);
    deviceStartTimer = undefined;
}
function nativeErrorCode(error: unknown): string {
    let value = error;
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return 'network'; }
    }
    return value && typeof value === 'object' && 'code' in value && typeof value.code === 'string'
        ? value.code : 'network';
}
function isAutoplayBlocked(error: unknown) {
    return error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError';
}

/** Also called by the legacy preparation entry point; this never generates audio. */
export function prepareSpeech() {
    if (typeof window !== 'undefined' && lifecycleWindow !== window) {
        window.addEventListener?.('pagehide', () => useSpeechStore.getState().stop());
        lifecycleWindow = window;
    }
    if (typeof document !== 'undefined' && lifecycleDocument !== document) {
        document.addEventListener?.('visibilitychange', () => {
            if (document.visibilityState === 'hidden') useSpeechStore.getState().stop();
        });
        lifecycleDocument = document;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.getVoices();
}

async function matchingDeviceVoice(preferences: SpeechPreferences): Promise<SpeechSynthesisVoice | undefined> {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return undefined;
    const locale = preferences.accent === 'gb' ? 'en-gb' : 'en-us';
    const find = () => synth.getVoices().find(voice => voice.localService && voice.lang.replaceAll('_', '-').toLowerCase() === locale);
    const available = find();
    if (available) return available;
    // Some WebViews populate device voices just after the first user gesture.
    // Keep this bounded, and recheck the generation before any speech begins.
    if (!synth.addEventListener) return undefined;
    await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); synth.removeEventListener?.('voiceschanged', done); resolve(); };
        const timer = setTimeout(done, 300);
        synth.addEventListener('voiceschanged', done, { once: true });
    });
    return find();
}

export const useSpeechStore = create<SpeechState>((set, get) => {
    // Playback ownership is separate from visible state so moving to the next
    // sentence never briefly exits the queue or permits an old callback to run.
    const cancelPlayback = () => {
        generation++;
        continuousSession = null;
        clearDeviceStartTimer();
        if (requestId) ignoreCommand('cancel_tts', { requestId });
        requestId = null;
        detachAudio();
        if (deviceUtterance) {
            deviceUtterance.onstart = null;
            deviceUtterance.onend = null;
            deviceUtterance.onerror = null;
            deviceUtterance = null;
            if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
        }
    };
    const play = async (text: string, key: string, kind: SpeechKind, queue?: { index: number; next: () => void }, media?: MediaTarget, owner?: string, ownerScope?: string | null) => {
        cancelPlayback();
        prepareSpeech();
        const current = ++generation;
        const preferences = normalizeSpeechPreferences(usePreferencesStore.getState().speech);
        const active = () => current === generation;
        const fail = (code: string) => {
            if (!active()) return;
            cancelPlayback();
            set({ key: null, status: 'error', loading: false, error: true, errorCode: code, errorKey: key, queueActive: false, queueIndex: null });
        };
        const end = () => {
            if (!active()) return;
            cancelPlayback();
            if (queue) queue.next();
            else set({ key: null, status: 'idle', loading: false, owner:null, ownerScope:null });
        };
        const fallback = async (code: string) => {
            if (!active()) return;
            // Bad input, intentional cancellation and playback permissions are
            // never retried as another voice source.
            if (!preferences.allowDeviceFallback || ['cancelled', 'invalid_input', 'too_long', 'playback_blocked'].includes(code)) {
                fail(code);
                return;
            }
            const voice = await matchingDeviceVoice(preferences);
            if (!active()) return;
            const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
            if (!voice || !synth || typeof SpeechSynthesisUtterance === 'undefined') {
                fail('no_device_voice');
                return;
            }
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.voice = voice;
            utterance.lang = preferences.accent === 'gb' ? 'en-GB' : 'en-US';
            utterance.rate = preferences.speed === 'slow' ? 0.75 : 1;
            utterance.onstart = () => { if (active()) { clearDeviceStartTimer(); set({ status: 'playing', loading: false }); } };
            utterance.onend = () => { if (deviceUtterance === utterance) end(); };
            utterance.onerror = () => fail('device_failed');
            deviceUtterance = utterance;
            set({ source: 'device', status: 'loading', loading: true });
            deviceStartTimer = setTimeout(() => {
                if (!active()) return;
                utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
                synth.cancel();
                deviceUtterance = null;
                fail('device_failed');
            }, 4000);
            try { synth.speak(utterance); } catch { fail('device_failed'); }
        };
        set({ key, status: 'loading', loading: true, error: false, errorCode: null, errorKey: null, source: null, queueActive: !!queue, queueIndex: queue?.index ?? null, playbackMode: queue ? 'tts-queue' : 'single', continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:owner??null, ownerScope:ownerScope??null });
        if (media) {
            set({ source: 'source-media' });
            try {
                const result = await invoke<{ path: string; start_ms: number; end_ms: number; duration_ms: number }>('resolve_source_media', { target: media });
                if (!active()) return;
                if (![result.start_ms,result.end_ms,result.duration_ms].every(Number.isSafeInteger) || result.start_ms < 0 || result.start_ms >= result.end_ms || result.end_ms > result.duration_ms) { fail('media_invalid_range'); return; }
                const player = new Audio(); audio = player;
                player.preload = 'auto';
                const playbackRate = preferences.speed === 'slow' ? 0.75 : 1;
                // src/load reset playbackRate to this default in native media elements.
                player.defaultPlaybackRate = playbackRate;
                let raf = 0, stopped = false;
                const cleanups: (() => void)[] = [];
                const wait = (event: string) => new Promise<void>((resolve, reject) => {
                    const done = () => { cleanup(); resolve(); };
                    const error = () => { cleanup(); reject(new Error('media_decode_failed')); };
                    const timer = setTimeout(error, 10000);
                    const cleanup = () => { clearTimeout(timer); player.removeEventListener(event, done); player.removeEventListener('error', error); };
                    cleanups.push(() => { cleanup(); reject(new Error('media_cancelled')); });
                    player.addEventListener(event, done, { once: true }); player.addEventListener('error', error, { once: true });
                });
                mediaCleanup = () => { stopped = true; cancelAnimationFrame(raf); cleanups.splice(0).forEach(fn => fn()); };
                player.onerror = () => { if (active()) fail('media_decode_failed'); };
                player.onended = end;
                const metadata = wait('loadedmetadata');
                player.src = convertFileSrc(result.path); player.load(); await metadata;
                if (!active() || stopped) return;
                // AAC container padding can differ by one frame between
                // ffprobe and WebKit. Never seek past the native EOF or extend
                // a saved clip; reject larger discrepancies.
                if (!Number.isFinite(player.duration) || result.end_ms > player.duration * 1000 + 100) { fail('media_invalid_range'); return; }
                const playbackEnd=Math.min(result.end_ms,player.duration*1000);
                if(result.start_ms>=playbackEnd){fail('media_invalid_range');return;}
                if (result.start_ms > 0) { const seek = wait('seeked'); player.currentTime = result.start_ms / 1000; await seek; }
                if (!active() || stopped) return;
                // Apply after metadata/seek as well, before any audio can start.
                player.playbackRate = playbackRate;
                const tick = () => {
                    if (!active() || stopped) return;
                    // Media-clock polling follows seek/rate and stops on every animation frame.
                    if (player.currentTime * 1000 >= playbackEnd) { player.pause(); end(); return; }
                    raf = requestAnimationFrame(tick);
                };
                player.onplaying = () => { if (active()) { set({ status: 'playing', loading: false }); cancelAnimationFrame(raf); tick(); } };
                await player.play();
            } catch (error) { if (active()) fail(isAutoplayBlocked(error) ? 'playback_blocked' : 'media_playback_failed'); }
            return;
        }
        // Preserve spelling, case, punctuation and selected inflection. Native
        // validation independently enforces length, plain text and voice IDs.
        if (!text.trim()) { fail('invalid_input'); return; }
        if (Array.from(text).length > 1000) { fail('too_long'); return; }
        const id = `tts-${Date.now().toString(36)}-${current}`;
        requestId = id;
        let result: TtsAudio;
        try {
            result = await invoke<TtsAudio>('resolve_tts_audio', { request: {
                requestId: id, text, kind,
                accent: preferences.accent, voice: preferences.voices[preferences.accent],
                speed: preferences.speed, onlineEnabled: preferences.onlineEnabled,
            } });
        } catch (error) {
            if (active()) await fallback(nativeErrorCode(error));
            return;
        }
        if (!active()) return;
        requestId = null;
        if (result.mime !== 'audio/mpeg' || !result.data_base64 || !['edge-cache', 'edge-network'].includes(result.source)
            || result.voice !== preferences.voices[preferences.accent] || result.speed !== preferences.speed) {
            await fallback('invalid_audio');
            return;
        }
        try {
            const player = new Audio();
            audio = player;
            player.preload = 'auto';
            player.onended = () => { if (audio === player) end(); };
            player.onplaying = () => { if (audio === player && active()) set({ status: 'playing', loading: false }); };
            let playbackFailed = false;
            const decodingFailed = () => {
                if (!active() || playbackFailed || audio !== player) return;
                playbackFailed = true;
                ignoreCommand('invalidate_tts_cache', { cacheKey: result.cache_key });
                detachAudio();
                void fallback('invalid_audio');
            };
            player.onerror = decodingFailed;
            player.src = `data:${result.mime};base64,${result.data_base64}`;
            set({ source: result.source });
            try {
                await player.play();
                if (active() && !playbackFailed) set({ status: 'playing', loading: false });
            } catch (error) {
                if (!active() || playbackFailed) return;
                if (isAutoplayBlocked(error)) {
                    detachAudio();
                    fail('playback_blocked');
                } else decodingFailed();
            }
        } catch {
            if (active()) await fallback('playback_failed');
        }
    };
    const startSourceContinuous = async (request: ReadingSourceRequest) => {
        cancelPlayback();
        prepareSpeech();
        const current = ++generation;
        const preferences = normalizeSpeechPreferences(usePreferencesStore.getState().speech);
        const session: ContinuousSession = { request: { ...request }, player: null, anchors: [], pendingSegmentId: request.segmentId, loaded: false,
            active: () => current === generation && continuousSession === session };
        continuousSession = session;
        const active = session.active;
        const cleared = { queueActive: false, queueIndex: null, playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:null,ownerScope:null };
        const fail = (code: string) => {
            if (!active()) return;
            cancelPlayback();
            set({ ...cleared, key: null, status: 'error', loading: false, error: true, errorCode: code, errorKey: request.key });
        };
        const ended = () => {
            if (!active()) return;
            cancelPlayback();
            set({ ...cleared, key: null, status: 'idle', loading: false });
        };
        set({ key: request.key, status: 'loading', loading: true, error: false, errorCode: null, errorKey: null, source: 'source-media',
            queueActive: true, queueIndex: request.index, playbackMode: 'source-continuous', continuousFileId: request.fileId, continuousSourceKey: request.sourceKey, continuousAssetId: null, owner:null,ownerScope:null });
        try {
            const result = await invoke<ReadingPlayback>('resolve_reading_media', { request: { file_id: request.fileId, segment_id: request.segmentId, source_key: request.sourceKey } });
            if (!active()) return;
            if (result.file_id !== request.fileId || result.source_key !== request.sourceKey || !/^[a-f0-9]{64}$/.test(result.asset_id)
                || !Number.isSafeInteger(result.duration_ms) || result.duration_ms <= 0 || !Array.isArray(result.anchors)
                || result.anchors.some(a => ![a.index,a.segment_id,a.start_ms,a.end_ms].every(Number.isSafeInteger) || a.index < 0 || a.start_ms < 0 || a.start_ms >= a.end_ms || a.end_ms > result.duration_ms)) {
                fail('media_invalid_reading_source'); return;
            }
            session.anchors = Object.freeze(result.anchors.map(anchor => Object.freeze({ ...anchor })));
            const groups = readingGroups(session.anchors);
            const pendingAnchor = () => session.anchors.find(anchor => anchor.segment_id === session.pendingSegmentId);
            if (!pendingAnchor()) { fail('media_no_reading_start'); return; }
            const player = new Audio(); audio = player; session.player = player;
            const rate = preferences.speed === 'slow' ? .75 : 1;
            player.preload = 'auto'; player.defaultPlaybackRate = rate;
            let raf = 0, disposed = false;
            const cleanups: (() => void)[] = [];
            const wait = (event: string, predicate = () => true) => new Promise<void>((resolve, reject) => {
                const done = () => { if (!predicate()) return; cleanup(); resolve(); };
                const failed = () => { cleanup(); reject(new Error('media_decode_failed')); };
                const timer = setTimeout(failed, 10000);
                const cleanup = () => { clearTimeout(timer); player.removeEventListener(event, done); player.removeEventListener('error', failed); };
                cleanups.push(() => { cleanup(); reject(new Error('media_cancelled')); });
                player.addEventListener(event, done); player.addEventListener('error', failed, { once: true });
            });
            mediaCleanup = () => { disposed = true; cancelAnimationFrame(raf); cleanups.splice(0).forEach(cleanup => cleanup()); };
            const position = () => {
                if (!active() || disposed || player.seeking) return;
                const index = readingIndexAt(groups, player.currentTime * 1000);
                if (get().queueIndex !== index) set({ queueIndex: index });
            };
            const tick = () => {
                if (!active() || disposed) return;
                position();
                // Text boundaries never pause, seek, reload or terminate this track.
                raf = requestAnimationFrame(tick);
            };
            const seeked = () => {
                if (!active() || disposed || player.seeking) return;
                position();
                if (!player.paused) set({ status: 'playing', loading: false });
            };
            player.addEventListener('seeked', seeked);
            cleanups.push(() => player.removeEventListener('seeked', seeked));
            player.onended = ended;
            player.onerror = () => fail('media_decode_failed');
            player.onplaying = () => { if (active() && !disposed) { set({ status: 'playing', loading: false }); cancelAnimationFrame(raf); tick(); } };
            set({ continuousAssetId: result.asset_id });
            const metadata = wait('loadedmetadata');
            player.src = convertFileSrc(result.path); player.load(); await metadata;
            if (!active() || disposed) return;
            // WKWebView can report a different container duration from ffprobe.
            // The native resolver already validates the
            // full asset; only its natural ended event defines the playback end.
            if (!Number.isFinite(player.duration) || player.duration <= 0) { fail('media_invalid_reading_source'); return; }
            session.loaded = true;
            const target = pendingAnchor()!;
            if (target.start_ms > 0 || player.currentTime !== 0) {
                const seek = wait('seeked', () => !player.seeking && Math.abs(player.currentTime * 1000 - (pendingAnchor()?.start_ms ?? -1000)) < 250);
                player.currentTime = target.start_ms / 1000; await seek;
            }
            if (!active() || disposed) return;
            player.playbackRate = rate;
            position();
            await player.play();
        } catch (error) { if (active()) fail(isAutoplayBlocked(error) ? 'playback_blocked' : 'media_continuous_failed'); }
    };
    const jumpSourceContinuous = (request: ReadingSourceJump) => {
        const session = continuousSession;
        if (!session?.active() || session.request.fileId !== request.fileId || session.request.sourceKey !== request.sourceKey) return false;
        const anchor = session.anchors.find(anchor => anchor.segment_id === request.segmentId);
        if (session.anchors.length && !anchor) return false;
        session.pendingSegmentId = request.segmentId;
        set({ queueIndex: anchor?.index ?? request.index });
        if (session.loaded && session.player && anchor) {
            try { session.player.currentTime = anchor.start_ms / 1000; }
            catch { get().stop(); return false; }
        }
        return true;
    };
    return {
        owner:null,ownerScope:null,
        stopOwned: owner=>{if(get().owner===owner)get().stop();},
        stopScope: scope=>{if(get().ownerScope===scope)get().stop();},
        key: null, status: 'idle', loading: false, source: null, error: false, errorCode: null, errorKey: null,
        queueActive: false, queueIndex: null, playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null,
        startSourceContinuous, jumpSourceContinuous,
        stop: () => {
            cancelPlayback();
            set({ key: null, status: 'idle', loading: false, source: null, error: false, errorCode: null, errorKey: null, queueActive: false, queueIndex: null, playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:null,ownerScope:null });
        },
        clearCache: async () => {
            get().stop();
            await invoke('clear_tts_cache');
        },
        speak: async (text, key, options) => {
            if (get().key === key && (get().status === 'loading' || get().status === 'playing')) {
                get().stop();
                return;
            }
            await play(text, key, options?.kind ?? 'sentence', undefined, options?.media, options?.owner, options?.ownerScope);
        },
        startQueue: async (items, startIndex = 0) => {
            get().stop();
            // Own a snapshot of the whole material, independent of the reader's
            // rendered window. Clicking the current row deliberately restarts it.
            const queue = items.map(({ text, key }) => ({ text, key }));
            const next = (index: number): Promise<void> => {
                if (index >= queue.length) {
                    set({ key: null, status: 'idle', loading: false, queueActive: false, queueIndex: null });
                    return Promise.resolve();
                }
                const item = queue[index];
                return play(item.text, item.key, 'sentence', { index, next: () => { void next(index + 1); } });
            };
            if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= queue.length) return;
            await next(startIndex);
        },
    };
});

// Changing a preference applies to the next deliberate click. It cannot let an
// old network response or device fallback start in the newly selected voice.
usePreferencesStore.subscribe(state => JSON.stringify(state.speech), () => useSpeechStore.getState().stop());
