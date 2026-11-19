import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Trash2 } from 'lucide-react';
import { SPEECH_PREVIEW_TEXT, SPEECH_VOICES, type SpeechAccent, type SpeechPreferences, type SpeechSpeed } from '../lib/speechPreferences';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useFeedbackStore } from '../stores/feedbackStore';
import { useSpeechStore } from '../stores/speechStore';
import { SpeechFeedback } from './SpeechButton';
import { BusyRing } from './LoadingFeedback';
const voices = [SPEECH_VOICES.us[0], SPEECH_VOICES.us[2], SPEECH_VOICES.us[1], SPEECH_VOICES.gb[1], SPEECH_VOICES.gb[0]];
const voiceIndex = (speech: SpeechPreferences) => Math.max(0, voices.findIndex(voice => voice.id === speech.voices[speech.accent]));
export default function SpeechSettings() {
  const { t } = useTranslation(), { speech, setSpeech, setSpeechVoice } = usePreferencesStore();
  const [clearing, setClearing] = useState(false);
  const owner = useRef(`voice-settings:${crypto.randomUUID()}`), press = useRef<{ x: number; y: number } | null>(null), suppressed = useRef(0);
  const carousel = useRef<HTMLDivElement>(null);
  useEffect(() => () => useSpeechStore.getState().stopOwned(owner.current), []);
  const index = voiceIndex(speech);
  const select = useCallback((next: number) => {
    const voice = voices[(next + voices.length) % voices.length];
    const accent: SpeechAccent = voice.id.startsWith('en-GB') ? 'gb' : 'us';
    setSpeech({ accent }); setSpeechVoice(accent, voice.id);
    void useSpeechStore.getState().speak(SPEECH_PREVIEW_TEXT, 'settings:speech-preview', { kind: 'preview', owner: owner.current, restart: true });
  }, [setSpeech, setSpeechVoice]);
  useEffect(() => {
    const node = carousel.current;
    if (!node || clearing) return;
    let previous = -Infinity, distance = 0, changed = false;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      // One selection per trackpad gesture, including its momentum tail.
      if (event.timeStamp - previous > 180) { distance = 0; changed = false; }
      previous = event.timeStamp;
      if (changed) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? node.clientWidth : 1;
      distance += event.deltaX * unit;
      if (Math.abs(distance) < 34) return;
      changed = true;
      select(voiceIndex(usePreferencesStore.getState().speech) + Math.sign(distance));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [clearing, select]);
  const clear = async () => {
    useSpeechStore.getState().stop();
    setClearing(true);
    const { show } = useFeedbackStore.getState();
    try {
      await invoke('clear_tts_cache');
      show(t('speech.cacheCleared'), 'success', 2200, undefined, 'top', { passive:true });
    } catch {
      show(t('speech.cacheFailed'), 'error', 4200, undefined, 'top', { passive:true });
    } finally {
      setClearing(false);
    }
  };
  return <section className="speech-settings approved-voices" aria-label={t('speech.title')}>
    <button className="approved-icon approved-clear-voice" aria-label={t('speech.clearCache')} title={t('speech.clearCache')} disabled={clearing} aria-busy={clearing} onClick={() => void clear()}>{clearing ? <BusyRing/> : <Trash2 size={21}/>}</button>
    <div ref={carousel} className="approved-voice-carousel" tabIndex={0} onKeyDown={event => { if (!clearing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); select(index + (event.key === 'ArrowRight' ? 1 : -1)); } }} onPointerDown={event => { if (!clearing && event.isPrimary && event.button === 0) { suppressed.current = 0; press.current = { x: event.clientX, y: event.clientY }; } }} onPointerCancel={() => { press.current = null; }} onPointerUp={event => { const p = press.current; press.current = null; if (!p || clearing) return; const x = event.clientX - p.x, y = event.clientY - p.y; if (Math.abs(x) > 34 && Math.abs(x) > Math.abs(y) * 1.25) { suppressed.current = performance.now() + 350; select(index + (x < 0 ? 1 : -1)); } }}>
      {voices.map((voice, i) => { let slot = i - index; if (slot > 2) slot -= 5; if (slot < -2) slot += 5; return <button key={voice.id} data-voice-slot={slot} aria-label={`${voice.name} · ${t('speech.preview')}`} aria-pressed={i === index} disabled={clearing} onClick={event => { if (event.detail === 0 || performance.now() >= suppressed.current) select(i); }}><img draggable={false} src={`/design/voice/${voice.name}.jpg`} alt=""/><strong>{voice.name}</strong></button>; })}
    </div>
    <div className="approved-voice-speed" role="group" aria-label={t('speech.speed')}>{(['normal','slow'] as SpeechSpeed[]).map(speed => <button key={speed} aria-pressed={speech.speed === speed} onClick={() => setSpeech({ speed })}>{t(`speech.speeds.${speed}`)}</button>)}</div>
    <SpeechFeedback prefix="settings:speech-preview"/>
  </section>;
}
