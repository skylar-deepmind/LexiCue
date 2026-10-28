import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { usePreferencesStore } from './preferencesStore';
import { normalizeSpeechPreferences, type SpeechKind, type SpeechPreferences } from '../lib/speechPreferences';

export type SpeechSource = 'edge-cache' | 'edge-network' | 'device';
export type SpeechStatus = 'idle' | 'loading' | 'playing' | 'error';
export interface SpeechQueueItem { text: string; key: string; }
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
    key: string | null;
    status: SpeechStatus;
    loading: boolean;
    source: SpeechSource | null;
    error: boolean;
    errorCode: string | null;
    errorKey: string | null;
    queueActive: boolean;
    queueIndex: number | null;
    startQueue: (items: readonly SpeechQueueItem[], startIndex?: number) => Promise<void>;
    speak: (text: string, key: string, options?: { kind?: SpeechKind }) => Promise<void>;
    stop: () => void;
    clearCache: () => Promise<void>;
}

let generation = 0;
let requestId: string | null = null;
let audio: HTMLAudioElement | null = null;
let deviceUtterance: SpeechSynthesisUtterance | null = null;
let deviceStartTimer: ReturnType<typeof setTimeout> | undefined;
let lifecycleWindow: Window | undefined;
let lifecycleDocument: Document | undefined;

function ignoreCommand(command: string, args: Record<string, unknown>) {
    void invoke(command, args).catch(() => { /* Cancellation/invalidation is best effort; never log text. */ });
}
function detachAudio() {
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
    const play = async (text: string, key: string, kind: SpeechKind, queue?: { index: number; next: () => void }) => {
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
            else set({ key: null, status: 'idle', loading: false });
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
        set({ key, status: 'loading', loading: true, error: false, errorCode: null, errorKey: null, source: null, queueActive: !!queue, queueIndex: queue?.index ?? null });
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
    return {
        key: null, status: 'idle', loading: false, source: null, error: false, errorCode: null, errorKey: null,
        queueActive: false, queueIndex: null,
        stop: () => {
            cancelPlayback();
            set({ key: null, status: 'idle', loading: false, source: null, error: false, errorCode: null, errorKey: null, queueActive: false, queueIndex: null });
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
            await play(text, key, options?.kind ?? 'sentence');
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
