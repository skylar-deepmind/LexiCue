import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { MediaTarget } from '../lib/sourceMedia';
import { readingGroups, readingIndexAt, type ReadingAnchor, type ReadingPlayback, type ReadingSourceRequest, type ReadingSourceJump } from '../lib/sourceContinuous';
import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';
import { normalizeSpeechPreferences, type SpeechKind, type SpeechPreferences } from '../lib/speechPreferences';
import { READING_RATES, type ReadingPauseReason, type ReadingRate, type ReadingSessionSnapshot } from '../lib/readingSession';
export type { ReadingSessionSnapshot } from '../lib/readingSession';

export type SpeechSource = 'edge-cache' | 'edge-network' | 'device' | 'source-media';
export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type PlaybackRate = ReadingRate;
export type PauseReason = ReadingPauseReason;
export interface SpeechQueueItem { text: string; key: string; media?: MediaTarget; rangeKey?: string; }
interface TtsAudio {
    data_base64: string;
    mime: string;
    cache_key: string;
    source: 'edge-cache' | 'edge-network';
    voice: string;
    speed: string;
    duration_ms: number;
    speech_end_ms?: number;
    speech_start_ms?: number;
}
interface SpeechState {
    owner: string | null;
    ownerScope: string | null;
    stopOwned: (owner: string) => void;
    stopScope: (scope: string) => void;
    key: string | null;
    status: SpeechStatus;
    pauseReason: PauseReason | null;
    rate: PlaybackRate;
    currentSegment: { key: string; index: number } | null;
    resumeMode: 'exact' | 'restart-sentence' | null;
    reading: ReadingSessionSnapshot | null;
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
    pause: (reason?: PauseReason) => void;
    resume: () => Promise<void>;
    replayCurrent: () => Promise<void>;
    setRate: (rate: PlaybackRate) => void;
    exitReading: () => void;
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
type ReadingSession =
    | { mode: 'tts-queue'; items: readonly SpeechQueueItem[]; index: number; paused: boolean; pending: boolean; status: ReadingSessionSnapshot['status']; pauseReason: PauseReason | null; resumeMode: ReadingSessionSnapshot['resumeMode']; errorCode: string | null; source: SpeechSource | null; reactivate?: () => void }
    | { mode: 'source-continuous'; request: ReadingSourceRequest; paused: boolean; pending: boolean; status: ReadingSessionSnapshot['status']; pauseReason: PauseReason | null; resumeMode: ReadingSessionSnapshot['resumeMode']; errorCode: string | null; source: SpeechSource | null; assetId: string | null; reactivate?: () => void };
interface QueuePrefetch {
    session: ReadingSession;
    index: number;
    requestId: string;
    settled: boolean;
    player?: HTMLAudioElement;
    promise: Promise<{ audio: TtsAudio } | { error: unknown }>;
}
let queuePrefetch: QueuePrefetch | null = null;
let requestSequence = 0;
let readingSession: ReadingSession | null = null;
let continuousSession: ContinuousSession | null = null;
let retainedAudio: HTMLAudioElement | null = null;
let retainedCleanup: (() => void) | null = null;
let retainedContinuousSession: ContinuousSession | null = null;
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
function nextRequestId() {
    return `tts-${Date.now().toString(36)}-${++requestSequence}`;
}
function cancelPrefetch() {
    if (queuePrefetch && !queuePrefetch.settled) ignoreCommand('cancel_tts', { requestId: queuePrefetch.requestId });
    if (queuePrefetch?.player) releasePlayer(queuePrefetch.player);
    queuePrefetch = null;
}
function releasePlayer(player: HTMLAudioElement) {
    player.onended = null; player.onerror = null; player.onplaying = null; player.onloadedmetadata = null;
    player.pause(); player.removeAttribute('src'); player.load();
}
function validTtsAudio(result: TtsAudio, preferences: SpeechPreferences, reading: boolean) {
    return result.mime === 'audio/mpeg' && !!result.data_base64 && ['edge-cache', 'edge-network'].includes(result.source)
        && result.voice === preferences.voices[preferences.accent] && result.speed === (reading ? 'normal' : preferences.speed);
}
function setTtsSource(player: HTMLAudioElement, result: TtsAudio, reading: boolean) {
    const start = result.speech_start_ms;
    if (reading && typeof start === 'number' && Number.isFinite(start) && start > 0 && start < (result.speech_end_ms ?? 0)) {
        player.onloadedmetadata = () => {
            player.onloadedmetadata = null;
            // Native PCM analysis retains 60ms before even the quietest onset.
            if (start / 1000 < player.duration) player.currentTime = start / 1000;
        };
    }
    player.src = `data:${result.mime};base64,${result.data_base64}`;
}
function resolveAudio(text: string, kind: SpeechKind, preferences: SpeechPreferences, id: string, reading: boolean) {
    return invoke<TtsAudio>('resolve_tts_audio', { request: {
        requestId: id, text, kind,
        accent: preferences.accent, voice: preferences.voices[preferences.accent],
        speed: reading ? 'normal' : preferences.speed, onlineEnabled: preferences.onlineEnabled,
    } });
}
function detachAudio() {
    mediaCleanup?.(); mediaCleanup = null;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.onplaying = null;
    audio.onloadedmetadata = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio = null;
}
function disposeRetainedAudio() {
    retainedCleanup?.(); retainedCleanup = null;
    if (retainedAudio) {
        retainedAudio.onended = null; retainedAudio.onerror = null; retainedAudio.onplaying = null; retainedAudio.onloadedmetadata = null;
        retainedAudio.pause(); retainedAudio.removeAttribute('src'); retainedAudio.load();
    }
    retainedAudio = null; retainedContinuousSession = null;
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
            if (document.visibilityState === 'hidden') {
                const speech = useSpeechStore.getState();
                if (speech.reading) speech.pause('hidden');
                else speech.stop();
            }
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
    const cancelPlayback = (preservePrefetch = false) => {
        if (!preservePrefetch) cancelPrefetch();
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
    const readingFields = () => ({
        queueActive: readingSession !== null,
        queueIndex: readingSession?.mode === 'tts-queue' ? readingSession.index : readingSession?.request.index ?? null,
        currentSegment: readingSession?.mode === 'tts-queue'
            ? { key: readingSession.items[readingSession.index].key, index: readingSession.index }
            : readingSession ? { key: readingSession.request.key, index: readingSession.request.index } : null,
        reading: readingSession ? {
            key: readingSession.mode === 'tts-queue' ? readingSession.items[readingSession.index].key : readingSession.request.key,
            index: readingSession.mode === 'tts-queue' ? readingSession.index : readingSession.request.index,
            mode: readingSession.mode, status: readingSession.status, rate: get().rate,
            pauseReason: readingSession.pauseReason, resumeMode: readingSession.resumeMode, errorCode: readingSession.errorCode,
        } satisfies ReadingSessionSnapshot : null,
    });
    const setReading = (changes: Partial<Pick<ReadingSession, 'status' | 'pauseReason' | 'resumeMode' | 'errorCode' | 'paused' | 'pending'>>) => {
        if (!readingSession) return;
        Object.assign(readingSession, changes);
        set(readingFields());
    };
    const prefetchNext = (session: ReadingSession, index: number, preferences: SpeechPreferences) => {
        // Native TTS resolves only the latest request. Begin speculation only
        // after the current result is playing, never alongside its resolution.
        if (session !== readingSession || session.mode !== 'tts-queue' || session.paused || !preferences.onlineEnabled
            || get().playbackMode !== 'tts-queue' || session.index !== index || queuePrefetch) return;
        const next = session.items[index + 1];
        if (!next?.text.trim() || Array.from(next.text).length > 1000) return;
        const id = nextRequestId();
        // Retain failures too: speculative work never changes current playback
        // or starts a device voice. The next sentence consumes this once.
        const prefetch: QueuePrefetch = {
            session, index: index + 1, requestId: id, settled: false,
            promise: resolveAudio(next.text, 'sentence', preferences, id, true).then(
                result => {
                    prefetch.settled = true;
                    if (queuePrefetch === prefetch && validTtsAudio(result, preferences, true)) {
                        const player = new Audio();
                        player.preload = 'auto';
                        setTtsSource(player, result, true);
                        player.load();
                        prefetch.player = player;
                    }
                    return { audio: result };
                },
                error => { prefetch.settled = true; return { error }; },
            ),
        };
        queuePrefetch = prefetch;
    };
    const play = async (text: string, key: string, kind: SpeechKind, queue?: { index: number; next: () => void }, media?: MediaTarget, owner?: string, ownerScope?: string | null) => {
        const prefetched = queue && queuePrefetch?.session === readingSession && queuePrefetch.index === queue.index ? queuePrefetch : null;
        if (prefetched) queuePrefetch = null;
        cancelPlayback();
        prepareSpeech();
        let current = ++generation;
        const preferences = normalizeSpeechPreferences(usePreferencesStore.getState().speech);
        const reading = !!queue;
        const session = queue ? readingSession : null;
        const active = () => current === generation;
        const prepareNext = () => { if (active() && session && queue) prefetchNext(session, queue.index, preferences); };
        if (readingSession && queue) readingSession.reactivate = () => { current = generation; };
        const fail = (code: string) => {
            if (!active()) return;
            cancelPlayback();
            if (reading) setReading({ status: 'error', errorCode: code, paused: true });
            set({ key: null, status: 'error', loading: false, error: true, errorCode: code, errorKey: key, ...readingFields(), playbackMode: null });
        };
        const end = () => {
            if (!active() || (reading && readingSession?.paused)) return;
            cancelPlayback(!!queue);
            if (queue) queue.next();
            else set({ key: null, status: readingSession ? 'paused' : 'idle', loading: false, owner:null, ownerScope:null, playbackMode: readingSession?.mode ?? null, ...readingFields() });
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
            utterance.rate = reading ? get().rate : preferences.speed === 'slow' ? 0.75 : 1;
            utterance.onstart = () => { if (active() && (!reading || !readingSession?.paused)) { clearDeviceStartTimer(); if (reading) setReading({ status: 'playing' }); set({ status: 'playing', loading: false }); } };
            utterance.onend = () => { if (deviceUtterance === utterance) end(); };
            utterance.onerror = () => fail('device_failed');
            deviceUtterance = utterance;
            if (reading) { readingSession!.source = 'device'; setReading({ resumeMode: 'restart-sentence' }); }
            set({ source: 'device', status: 'loading', loading: true, resumeMode: reading ? 'restart-sentence' : null });
            deviceStartTimer = setTimeout(() => {
                if (!active()) return;
                utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
                synth.cancel();
                deviceUtterance = null;
                fail('device_failed');
            }, 4000);
            try { synth.speak(utterance); } catch { fail('device_failed'); }
        };
        if (reading) setReading({ status: 'loading', pauseReason: null, errorCode: null, paused: false, pending: true, resumeMode: 'continue' });
        set({ key, status: 'loading', loading: true, pauseReason: null, resumeMode: reading ? 'exact' : null, error: false, errorCode: null, errorKey: null, source: null, ...readingFields(), playbackMode: queue ? 'tts-queue' : 'single', continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:owner??null, ownerScope:ownerScope??null });
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
        const id = prefetched?.requestId ?? nextRequestId();
        requestId = id;
        let result: TtsAudio;
        try {
            if (prefetched) {
                const outcome = await prefetched.promise;
                if ('error' in outcome) throw outcome.error;
                result = outcome.audio;
            } else result = await resolveAudio(text, kind, preferences, id, reading);
        } catch (error) {
            if (active()) await fallback(nativeErrorCode(error));
            return;
        }
        if (!active()) { if (prefetched?.player) releasePlayer(prefetched.player); return; }
        requestId = null;
        if (!validTtsAudio(result, preferences, reading)) {
            await fallback('invalid_audio');
            return;
        }
        try {
            const player = prefetched?.player ?? new Audio();
            audio = player;
            player.preload = 'auto';
            if (reading) { player.defaultPlaybackRate = get().rate; player.playbackRate = get().rate; }
            // Edge MP3s include roughly 0.9s of padding after the final word.
            // Keep 120ms beyond its validated endpoint; preserve pauses *within*
            // the sentence and all original/source-media timing.
            let frame = 0;
            const speechEnd = result.speech_end_ms;
            const boundary = reading && queue && queue.index + 1 < (session?.mode === 'tts-queue' ? session.items.length : 0)
                && typeof speechEnd === 'number' && Number.isFinite(speechEnd) && speechEnd > 0
                && speechEnd <= result.duration_ms + 120
                ? Math.min(result.duration_ms, speechEnd + 120) / 1000 : null;
            const tick = () => {
                if (!active() || audio !== player || readingSession?.paused || player.paused) return;
                if (boundary !== null && !player.seeking && player.currentTime >= boundary) { end(); return; }
                frame = requestAnimationFrame(tick);
            };
            mediaCleanup = () => { if (frame) cancelAnimationFrame(frame); };
            const startBoundaryClock = () => {
                if (boundary === null) return;
                cancelAnimationFrame(frame); frame = requestAnimationFrame(tick);
            };
            player.onended = () => { if (audio === player) end(); };
            player.onplaying = () => {
                if (!active()) { player.pause(); return; }
                if (reading && readingSession?.paused && (audio === player || retainedAudio === player)) { player.pause(); return; }
                if (audio === player) { if (reading) setReading({ status: 'playing' }); set({ status: 'playing', loading: false }); prepareNext(); startBoundaryClock(); }
            };
            let playbackFailed = false;
            const decodingFailed = () => {
                if (!active() || playbackFailed || audio !== player) return;
                playbackFailed = true;
                cancelPrefetch();
                ignoreCommand('invalidate_tts_cache', { cacheKey: result.cache_key });
                detachAudio();
                void fallback('invalid_audio');
            };
            player.onerror = decodingFailed;
            if (!prefetched?.player) setTtsSource(player, result, reading);
            if (reading && readingSession) readingSession.source = result.source;
            set({ source: result.source });
            if (reading) setReading({ pending: false });
            if (reading && readingSession?.paused) { set({ status: 'paused', loading: false }); return; }
            try {
                await player.play();
                if (!active() || (reading && readingSession?.paused)) player.pause();
                if (active() && !playbackFailed && (!reading || !readingSession?.paused)) { if (reading) setReading({ status: 'playing' }); set({ status: 'playing', loading: false }); prepareNext(); startBoundaryClock(); }
            } catch (error) {
                if (!active() || playbackFailed || (reading && readingSession?.paused)) return;
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
        disposeRetainedAudio();
        prepareSpeech();
        readingSession = { mode: 'source-continuous', request: { ...request }, paused: false, pending: true,
            status: 'loading', pauseReason: null, resumeMode: 'continue', errorCode: null, source: 'source-media', assetId: null };
        let current = ++generation;
        const session: ContinuousSession = { request: { ...request }, player: null, anchors: [], pendingSegmentId: request.segmentId, loaded: false,
            active: () => current === generation && continuousSession === session };
        continuousSession = session;
        if (readingSession) readingSession.reactivate = () => { current = generation; };
        const active = session.active;
        const cleared = { queueActive: false, queueIndex: null, playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:null,ownerScope:null };
        const fail = (code: string) => {
            if (!active()) return;
            cancelPlayback();
            setReading({ status: 'error', errorCode: code, paused: true });
            set({ ...cleared, ...readingFields(), key: null, status: 'error', loading: false, error: true, errorCode: code, errorKey: request.key });
        };
        const ended = () => {
            if (!active() || readingSession?.paused) return;
            cancelPlayback();
            readingSession = null;
            set({ ...cleared, ...readingFields(), key: null, status: 'idle', loading: false });
        };
        set({ key: request.key, status: 'loading', loading: true, pauseReason: null, resumeMode: 'exact', error: false, errorCode: null, errorKey: null, source: 'source-media',
            ...readingFields(), playbackMode: 'source-continuous', continuousFileId: request.fileId, continuousSourceKey: request.sourceKey, continuousAssetId: null, owner:null,ownerScope:null });
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
            const rate = get().rate;
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
                if (!active() || disposed || player.seeking || readingSession?.paused) return;
                const index = readingIndexAt(groups, player.currentTime * 1000);
                if (get().queueIndex !== index) {
                    const anchor = session.anchors.find(item => item.index === index);
                    if (readingSession?.mode === 'source-continuous' && anchor) {
                        readingSession.request.index = anchor.index;
                        readingSession.request.segmentId = anchor.segment_id;
                    }
                    set({ ...readingFields(), queueIndex: index });
                }
            };
            const tick = () => {
                if (!active() || disposed || readingSession?.paused) return;
                position();
                // Text boundaries never pause, seek, reload or terminate this track.
                raf = requestAnimationFrame(tick);
            };
            const seeked = () => {
                if (!active() || disposed || player.seeking) return;
                position();
                if (!player.paused && !readingSession?.paused) set({ status: 'playing', loading: false });
            };
            player.addEventListener('seeked', seeked);
            cleanups.push(() => player.removeEventListener('seeked', seeked));
            player.onended = ended;
            player.onerror = () => fail('media_decode_failed');
            player.onplaying = () => {
                if (!active() || disposed) { player.pause(); return; }
                if (readingSession?.paused && session.player === player) { player.pause(); return; }
                setReading({ status: 'playing' }); set({ status: 'playing', loading: false }); cancelAnimationFrame(raf); tick();
            };
            if (readingSession?.mode === 'source-continuous') readingSession.assetId = result.asset_id;
            set({ continuousAssetId: result.asset_id });
            const metadata = wait('loadedmetadata');
            player.src = convertFileSrc(result.path); player.load(); await metadata;
            if (!active() || disposed) return;
            // WKWebView can report a different container duration from ffprobe.
            // The native resolver already validates the
            // full asset; only its natural ended event defines the playback end.
            if (!Number.isFinite(player.duration) || player.duration <= 0) { fail('media_invalid_reading_source'); return; }
            session.loaded = true;
            setReading({ pending: false });
            const target = pendingAnchor()!;
            if (target.start_ms > 0 || player.currentTime !== 0) {
                const seek = wait('seeked', () => !player.seeking && Math.abs(player.currentTime * 1000 - (pendingAnchor()?.start_ms ?? -1000)) < 250);
                player.currentTime = target.start_ms / 1000; await seek;
            }
            if (!active() || disposed) return;
            player.playbackRate = rate;
            position();
            if (readingSession?.paused) { set({ status: 'paused', loading: false }); return; }
            await player.play();
            if (!active() || readingSession?.paused) player.pause();
        } catch (error) { if (active() && !readingSession?.paused) fail(isAutoplayBlocked(error) ? 'playback_blocked' : 'media_continuous_failed'); }
    };
    const jumpSourceContinuous = (request: ReadingSourceJump) => {
        const session = continuousSession;
        if (!session?.active() || session.request.fileId !== request.fileId || session.request.sourceKey !== request.sourceKey) return false;
        const anchor = session.anchors.find(anchor => anchor.segment_id === request.segmentId);
        if (session.anchors.length && !anchor) return false;
        session.pendingSegmentId = request.segmentId;
        if (readingSession?.mode === 'source-continuous') readingSession.request = { ...readingSession.request, segmentId: request.segmentId, index: request.index };
        set({ ...readingFields(), queueIndex: anchor?.index ?? request.index });
        if (session.loaded && session.player && anchor) {
            try { session.player.currentTime = anchor.start_ms / 1000; }
            catch { get().stop(); return false; }
        }
        return true;
    };
    const advanceQueue = (index: number): Promise<void> => {
        const session = readingSession;
        if (!session || session.mode !== 'tts-queue' || session.paused) return Promise.resolve();
        if (index >= session.items.length) {
            readingSession = null;
            set({ key: null, status: 'idle', loading: false, playbackMode: null, ...readingFields() });
            return Promise.resolve();
        }
        session.index = index;
        const item = session.items[index];
        return play(item.text, item.key, 'sentence', { index, next: () => { void advanceQueue(index + 1); } });
    };
    const stopOwnedChannel = () => {
        if (!readingSession) { get().stop(); return; }
        cancelPlayback();
        set({ key: readingSession.mode === 'tts-queue' ? readingSession.items[readingSession.index].key : readingSession.request.key,
            status: 'paused', loading: false, source: readingSession.source, playbackMode: readingSession.mode,
            owner: null, ownerScope: null, ...readingFields() });
    };
    return {
        owner:null,ownerScope:null,
        stopOwned: owner=>{if(get().owner===owner)stopOwnedChannel();},
        stopScope: scope=>{if(get().ownerScope===scope)stopOwnedChannel();},
        key: null, status: 'idle', pauseReason: null, rate: 1, currentSegment: null, resumeMode: null, reading: null,
        loading: false, source: null, error: false, errorCode: null, errorKey: null,
        queueActive: false, queueIndex: null, playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null,
        startSourceContinuous, jumpSourceContinuous,
        stop: () => {
            cancelPlayback();
            disposeRetainedAudio();
            readingSession = null;
            set({ key: null, status: 'idle', pauseReason: null, resumeMode: null, loading: false, source: null, error: false, errorCode: null, errorKey: null, ...readingFields(), playbackMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null, owner:null,ownerScope:null });
        },
        exitReading: () => {
            if (!readingSession) return;
            const singleChannel = get().playbackMode === 'single';
            readingSession = null;
            disposeRetainedAudio();
            if (!singleChannel) { cancelPlayback(); set({ key: null, status: 'idle', loading: false, source: null, playbackMode: null, pauseReason: null, resumeMode: null, continuousFileId: null, continuousSourceKey: null, continuousAssetId: null }); }
            set(readingFields());
        },
        pause: (reason = 'user') => {
            if (!readingSession) return;
            cancelPrefetch();
            const readingChannel = get().playbackMode !== 'single';
            const canHoldAudio = readingChannel && !!audio && !readingSession.pending && get().source !== 'device';
            if (canHoldAudio) audio!.pause();
            else if (readingChannel || get().playbackMode === 'single') cancelPlayback();
            setReading({ paused: true, status: 'paused', pauseReason: reason,
                resumeMode: readingSession.source === 'device' ? 'restart-sentence' : 'continue' });
            set({ key: readingSession.mode === 'tts-queue' ? readingSession.items[readingSession.index].key : readingSession.request.key,
                status: 'paused', pauseReason: reason, loading: false, playbackMode: readingSession.mode,
                owner: null, ownerScope: null, ...readingFields() });
        },
        resume: async () => {
            const session = readingSession;
            if (!session || !session.paused) return;
            if (get().playbackMode === 'single') cancelPlayback();
            if (retainedAudio) {
                audio = retainedAudio; mediaCleanup = retainedCleanup; continuousSession = retainedContinuousSession;
                retainedAudio = null; retainedCleanup = null; retainedContinuousSession = null;
                generation++; session.reactivate?.();
            }
            setReading({ paused: false, status: 'loading', pauseReason: null, errorCode: null });
            set({ key: session.mode === 'tts-queue' ? session.items[session.index].key : session.request.key,
                pauseReason: null, status: 'loading', loading: true, error: false, errorCode: null, errorKey: null,
                playbackMode: session.mode, source: session.source, owner: null, ownerScope: null,
                continuousFileId: session.mode === 'source-continuous' ? session.request.fileId : null,
                continuousSourceKey: session.mode === 'source-continuous' ? session.request.sourceKey : null,
                continuousAssetId: session.mode === 'source-continuous' ? session.assetId : null,
                ...readingFields() });
            if (audio && !session.pending && session.source !== 'device') {
                const player = audio;
                player.defaultPlaybackRate = get().rate; player.playbackRate = get().rate;
                try {
                    await player.play();
                    if (audio === player && readingSession === session && !session.paused) {
                        setReading({ status: 'playing' }); set({ status: 'playing', loading: false });
                        if (session.mode === 'tts-queue') prefetchNext(session, session.index, normalizeSpeechPreferences(usePreferencesStore.getState().speech));
                    }
                } catch (error) {
                    if (audio === player && readingSession === session && !session.paused) {
                        cancelPlayback(); setReading({ status: 'error', errorCode: isAutoplayBlocked(error) ? 'playback_blocked' : 'media_playback_failed' });
                        set({ status: 'error', loading: false, error: true, errorCode: session.errorCode, errorKey: get().key });
                    }
                }
                return;
            }
            if (session.mode === 'source-continuous') await startSourceContinuous(session.request);
            else {
                const index = session.index;
                await play(session.items[index].text, session.items[index].key, 'sentence', { index, next: () => { void advanceQueue(index + 1); } });
            }
        },
        replayCurrent: async () => {
            const session = readingSession;
            if (!session) return;
            if (session.mode === 'source-continuous') {
                if (retainedAudio && retainedContinuousSession) {
                    const anchor = retainedContinuousSession.anchors.find(item => item.segment_id === session.request.segmentId);
                    if (anchor) retainedAudio.currentTime = anchor.start_ms / 1000;
                    await get().resume(); return;
                }
                if (continuousSession?.active() && continuousSession.loaded) {
                    jumpSourceContinuous({ fileId: session.request.fileId, sourceKey: session.request.sourceKey,
                        segmentId: session.request.segmentId, index: session.request.index });
                    if (session.paused) await get().resume();
                } else await startSourceContinuous(session.request);
            } else {
                const index = session.index;
                setReading({ paused: false, status: 'loading', pauseReason: null });
                disposeRetainedAudio();
                await play(session.items[index].text, session.items[index].key, 'sentence', { index, next: () => { void advanceQueue(index + 1); } });
            }
        },
        setRate: rate => {
            if (!READING_RATES.includes(rate)) return;
            set({ rate });
            if (readingSession) set(readingFields());
            if (readingSession && get().playbackMode !== 'single' && audio) {
                audio.defaultPlaybackRate = rate; audio.playbackRate = rate;
            } else if (readingSession && get().playbackMode !== 'single' && readingSession.source === 'device' && get().status === 'playing') void get().replayCurrent();
        },
        clearCache: async () => {
            get().stop();
            await invoke('clear_tts_cache');
        },
        speak: async (text, key, options) => {
            if (get().key === key && get().owner === (options?.owner ?? null) && (get().status === 'loading' || get().status === 'playing')) {
                stopOwnedChannel();
                return;
            }
            if (readingSession && !readingSession.paused) get().pause('lookup');
            if (readingSession && audio && get().playbackMode !== 'single') {
                disposeRetainedAudio();
                retainedAudio = audio; retainedCleanup = mediaCleanup; retainedContinuousSession = continuousSession;
                audio = null; mediaCleanup = null; continuousSession = null;
            }
            await play(text, key, options?.kind ?? 'sentence', undefined, options?.media, options?.owner, options?.ownerScope);
        },
        startQueue: async (items, startIndex = 0) => {
            get().stop();
            // Own a snapshot of the whole material, independent of the reader's
            // rendered window. Clicking the current row deliberately restarts it.
            const queue = items.map(({ text, key }) => ({ text, key }));
            if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= queue.length) return;
            readingSession = { mode: 'tts-queue', items: queue, index: startIndex, paused: false, pending: true,
                status: 'loading', pauseReason: null, resumeMode: 'continue', errorCode: null, source: null };
            await advanceQueue(startIndex);
        },
    };
});

// Changing a preference applies to the next deliberate click. It cannot let an
// old network response or device fallback start in the newly selected voice.
usePreferencesStore.subscribe(state => JSON.stringify(state.speech), () => useSpeechStore.getState().stop());
