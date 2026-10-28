import { useEffect } from 'react';
import { LoaderCircle, RotateCcw, Square, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SpeechKind } from '../lib/speechPreferences';
import { useSpeechStore } from '../stores/speechStore';

/** Every reading action shares one player, including the settings preview. */
export default function SpeechButton({ text, speechKey, kind, label, language = 'en', className = '', showLabel = false, disabled = false }: {
  text: string; speechKey: string; kind: SpeechKind; label: string; language?: string; className?: string; showLabel?: boolean; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const speech = useSpeechStore();
  const active = speech.key === speechKey && (speech.status === 'loading' || speech.status === 'playing');
  const loading = active && speech.status === 'loading';
  const failed = speech.error && speech.errorKey === speechKey;
  const action = loading ? t('speech.cancelLoading') : active ? t('speech.stop') : failed ? t('speech.retry') : label;
  useEffect(() => () => {
    const current = useSpeechStore.getState();
    if (current.key === speechKey || current.errorKey === speechKey) current.stop();
  }, [speechKey, text]);
  return <button type="button" className={`ui-button ${showLabel ? '' : 'ui-button--icon'} speech-button ${className}`}
    disabled={disabled || language !== 'en' || !text.trim()} aria-label={action} title={action}
    aria-pressed={active} aria-busy={loading} data-speech-key={speechKey} data-speech-state={active ? speech.status : failed ? 'error' : 'idle'}
    onClick={event => { event.stopPropagation(); if (active) speech.stop(); else void speech.speak(text, speechKey, { kind }); }}>
    {loading ? <LoaderCircle className="speech-spinner" size={18} aria-hidden="true"/> : active ? <Square size={18} aria-hidden="true"/> : failed ? <RotateCcw size={18} aria-hidden="true"/> : <Volume2 size={18} aria-hidden="true"/>}
    {showLabel && <span>{action}</span>}
  </button>;
}

export function SpeechFeedback({ speechKeys, prefix }: { speechKeys?: string[]; prefix?: string }) {
  const { t } = useTranslation();
  const speech = useSpeechStore();
  const matches = (key: string | null) => !!key && (speechKeys?.includes(key) || !!prefix && key.startsWith(prefix));
  if (speech.source === 'device' && speech.status === 'playing' && matches(speech.key))
    return <p className="speech-feedback" role="status">{t('speech.deviceActive')}</p>;
  if (!speech.error || !matches(speech.errorKey)) return null;
  const code = speech.errorCode?.toLowerCase() ?? '';
  const message = code.includes('too_long') || code.includes('length') ? 'speech.tooLong'
    : code.includes('autoplay') || code.includes('playback_blocked') ? 'speech.playbackBlocked'
    : code.includes('offline') || code.includes('disabled') ? 'speech.offlineMissing'
    : 'speech.failed';
  return <p className="speech-feedback speech-feedback--error" role="status">{t(message)}</p>;
}
