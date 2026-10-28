import type { Language } from './languages';
import { prepareSpeech, useSpeechStore } from '../stores/speechStore';

/** Compatibility entry point; all active English UI uses the shared controller. */
export function speakText(text: string, language: Language) {
  if (language !== 'en') return;
  void useSpeechStore.getState().speak(text, `legacy:${text}`, { kind: 'sentence' });
}

/** Loads only local device voice metadata; never requests or plays Edge audio. */
export function prepareSpeechVoices() {
  prepareSpeech();
}

/** Dictionary recordings remain retired. Pass the displayed English text. */
export function playPronunciation(text: string, language: Language) {
  if (language !== 'en') return;
  void useSpeechStore.getState().speak(text, `legacy:${text}`, { kind: text.trim().includes(' ') ? 'phrase' : 'word' });
}
