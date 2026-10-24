import { create } from 'zustand';
let generation = 0;
export const useSpeechStore = create<{
    key: string | null;
    error: boolean;
    speak: (text: string, key: string) => void;
    stop: () => void;
}>((set, get) => ({
    key: null, error: false,
    stop: () => { generation++; window.speechSynthesis?.cancel(); set({ key: null }); },
    speak: (text, key) => {
        get().stop();
        const current = ++generation;
        const synth = window.speechSynthesis;
        const voices = synth?.getVoices().filter(voice => /^en(?:[-_]|$)/i.test(voice.lang)) ?? [];
        if (!synth || !voices.length || typeof SpeechSynthesisUtterance === 'undefined') {
            set({ key: null, error: true });
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.voice = voices.find(voice => voice.localService) ?? voices[0];
        utterance.rate = 1;
        utterance.onend = () => { if (current === generation)
            set({ key: null }); };
        utterance.onerror = () => { if (current === generation)
            set({ key: null, error: true }); };
        set({ key, error: false });
        try {
            synth.speak(utterance);
        }
        catch {
            if (current === generation)
                set({ key: null, error: true });
        }
    },
}));
