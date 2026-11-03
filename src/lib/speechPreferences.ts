export type SpeechAccent = 'us' | 'gb';
export type SpeechSpeed = 'normal' | 'slow';
export type SpeechKind = 'word' | 'phrase' | 'sentence' | 'preview';

export interface SpeechPreferences {
  onlineEnabled: boolean;
  accent: SpeechAccent;
  voices: Record<SpeechAccent, string>;
  speed: SpeechSpeed;
  allowDeviceFallback: boolean;
}

// Kept locally so opening settings and ordinary point reading never depend on
// a catalog request. The native adapter validates the same small allowlist.
export const SPEECH_VOICES = {
  us: [
    { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'female' },
    { id: 'en-US-AriaNeural', name: 'Aria', gender: 'female' },
    { id: 'en-US-GuyNeural', name: 'Guy', gender: 'male' },
  ],
  gb: [
    { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'female' },
    { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'male' },
  ],
} as const;

export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  onlineEnabled: true,
  accent: 'us',
  voices: { us: 'en-US-JennyNeural', gb: 'en-GB-SoniaNeural' },
  speed: 'normal',
  allowDeviceFallback: true,
};

export const SPEECH_PREVIEW_TEXT = "Would you mind turning the music down a little? I'm trying to finish this chapter, and I keep losing my place.";

export function normalizeSpeechPreferences(value: unknown): SpeechPreferences {
  const saved = value && typeof value === 'object' ? value as Partial<SpeechPreferences> : {};
  const voices = saved.voices && typeof saved.voices === 'object' ? saved.voices : {} as Partial<Record<SpeechAccent, string>>;
  const voice = (accent: SpeechAccent) => SPEECH_VOICES[accent].some(item => item.id === voices[accent])
    ? voices[accent]! : DEFAULT_SPEECH_PREFERENCES.voices[accent];
  return {
    onlineEnabled: typeof saved.onlineEnabled === 'boolean' ? saved.onlineEnabled : true,
    accent: saved.accent === 'gb' ? 'gb' : 'us',
    voices: { us: voice('us'), gb: voice('gb') },
    speed: saved.speed === 'slow' ? 'slow' : 'normal',
    allowDeviceFallback: typeof saved.allowDeviceFallback === 'boolean' ? saved.allowDeviceFallback : true,
  };
}
