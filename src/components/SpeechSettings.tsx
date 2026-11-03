import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { SPEECH_PREVIEW_TEXT, SPEECH_VOICES, type SpeechAccent, type SpeechSpeed } from '../lib/speechPreferences';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useSpeechStore } from '../stores/speechStore';
import AppSelect from './AppSelect';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

const PREVIEW_KEY = 'settings:speech-preview';
export default function SpeechSettings() {
  const { t } = useTranslation();
  const { speech, setSpeech, setSpeechVoice } = usePreferencesStore();
  const [clearing, setClearing] = useState(false);
  const [cacheState, setCacheState] = useState<'idle' | 'cleared' | 'error'>('idle');
  const clearCache = async () => {
    useSpeechStore.getState().stop(); setClearing(true); setCacheState('idle');
    try { await invoke('clear_tts_cache'); setCacheState('cleared'); }
    catch { setCacheState('error'); }
    finally { setClearing(false); }
  };
  return <section className="speech-settings" aria-labelledby="speech-settings-title">
    <h2 id="speech-settings-title">{t('speech.title')}</h2>
    <p>{t('speech.description')}</p>
    <div className="speech-settings__fields">
      <div><label htmlFor="speech-accent">{t('speech.accent')}</label><AppSelect id="speech-accent" value={speech.accent}
        options={(['us', 'gb'] as SpeechAccent[]).map(value => ({ value, label: t(`speech.accents.${value}`) }))}
        onChange={value => setSpeech({ accent: value as SpeechAccent })}/></div>
      <div><label htmlFor="speech-voice">{t('speech.voice')}</label><AppSelect id="speech-voice" value={speech.voices[speech.accent]}
        options={SPEECH_VOICES[speech.accent].map(voice => ({ value: voice.id, label: `${voice.name} · ${t(`speech.${voice.gender}`)}` }))}
        onChange={voice => setSpeechVoice(speech.accent, voice)}/></div>
      <div><label htmlFor="speech-speed">{t('speech.speed')}</label><AppSelect id="speech-speed" value={speech.speed}
        options={(['normal', 'slow'] as SpeechSpeed[]).map(value => ({ value, label: t(`speech.speeds.${value}`) }))}
        onChange={value => setSpeech({ speed: value as SpeechSpeed })}/></div>
    </div>
    <div className="speech-settings__preview"><SpeechButton text={SPEECH_PREVIEW_TEXT} speechKey={PREVIEW_KEY} kind="preview" label={t('speech.preview')} showLabel disabled={clearing}/></div>
    <SpeechFeedback speechKeys={[PREVIEW_KEY]}/>
    <p>{t('speech.accuracy')}</p>
    <details><summary>{t('speech.connection')}</summary>
      <label className="speech-settings__toggle"><input type="checkbox" checked={speech.onlineEnabled} onChange={event => setSpeech({ onlineEnabled: event.target.checked })}/><span>{t('speech.onlineEnabled')}</span></label>
      <p>{t('speech.privacy')}</p>
      <label className="speech-settings__toggle"><input type="checkbox" checked={speech.allowDeviceFallback} onChange={event => setSpeech({ allowDeviceFallback: event.target.checked })}/><span>{t('speech.allowDeviceFallback')}</span></label>
      <p>{t('speech.fallbackDescription')}</p>
      <button type="button" className="ui-button" disabled={clearing} aria-busy={clearing} onClick={() => void clearCache()}>{t(clearing ? 'speech.clearingCache' : 'speech.clearCache')}</button>
      {cacheState !== 'idle' && <p role="status">{t(cacheState === 'cleared' ? 'speech.cacheCleared' : 'speech.cacheFailed')}</p>}
    </details>
  </section>;
}
