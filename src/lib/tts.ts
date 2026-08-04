import type { Language } from './languages';

const VOICE_LANG: Record<Language, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  de: 'de-DE',
  zh: 'zh-CN',
};

const RATE: Record<Language, number> = {
  en: 1,
  ja: 0.95,
  de: 0.9,
  zh: 1,
};

const HIGH_QUALITY_HINTS = [
  'google',
  'premium',
  'neural',
  'natural',
  'enhanced',
  'improved',
];

const PREFERRED_VOICES: Partial<Record<Language, string[]>> = {
  zh: ['sinji', 'eddy', 'xiaoxiao', 'yunxi', 'flo', 'tingting enhanced', 'meijia'],
};

const LOW_QUALITY_HINTS = ['compact', 'ting-ting'];

let cachedVoices: SpeechSynthesisVoice[] | null = null;

function loadVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (voices.length > 0) cachedVoices = voices;
  return voices;
}

function registerVoicesChanged() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoices = window.speechSynthesis?.getVoices() ?? null;
  });
}

function qualityScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const hint = HIGH_QUALITY_HINTS.find((hint) => name.includes(hint));
  return hint ? 10 - HIGH_QUALITY_HINTS.indexOf(hint) : 0;
}

function preferredScore(voice: SpeechSynthesisVoice, language: Language): number {
  const names = PREFERRED_VOICES[language] ?? [];
  const name = voice.name.toLowerCase();
  const index = names.findIndex((preferred) => name.includes(preferred));
  return index === -1 ? 0 : names.length - index;
}

function lowQualityPenalty(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  return LOW_QUALITY_HINTS.some((hint) => name.includes(hint)) ? -10 : 0;
}

function pickVoice(
  lang: string,
  language: Language,
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const prefix = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  if (matching.length === 0) return undefined;

  const scored = matching
    .map((voice) => ({
      voice,
      score:
        qualityScore(voice) +
        preferredScore(voice, language) +
        lowQualityPenalty(voice),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.voice.localService) - Number(a.voice.localService) ||
        (b.voice.lang.toLowerCase() === lang ? 1 : 0) - (a.voice.lang.toLowerCase() === lang ? 1 : 0)
    );
  return scored[0].voice;
}

export function speakText(text: string, language: Language) {
  if (!text || !('speechSynthesis' in window)) return;
  registerVoicesChanged();
  const synth = window.speechSynthesis;
  const lang = VOICE_LANG[language] ?? 'en-US';

  const speak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = RATE[language] ?? 1;
    const voices = loadVoices();
    if (voices.length > 0) {
      const voice = pickVoice(lang, language, voices);
      if (voice) utterance.voice = voice;
    }
    synth.cancel();
    synth.speak(utterance);
  };

  if (loadVoices().length > 0) {
    speak();
    return;
  }

  window.speechSynthesis.onvoiceschanged = () => {
    const ready = loadVoices();
    if (ready.length === 0) return;
    window.speechSynthesis.onvoiceschanged = null;
    speak();
  };
}
