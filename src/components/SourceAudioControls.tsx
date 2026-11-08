import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Headphones, RotateCcw } from 'lucide-react';
import InlineProgress from './InlineProgress';
import { bindMediaTarget, type MediaRef, type MediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { useSpeechStore } from '../stores/speechStore';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

/** One original-context player with an explicit, separate synthetic-voice recovery. */
export default function SourceAudioControls({ reference, target, text, speechKey, statusOnly = false }: {
  reference?: MediaRef | null; target: MediaTarget; text: string; speechKey: string; statusOnly?: boolean;
}) {
  const { t } = useTranslation();
  const key = reference?.source.key;
  const media = useSourceMediaStore();
  const state = key ? media.entries[key] : undefined;
  const playbackFailed = useSpeechStore(s => s.error && s.errorKey === speechKey);
  const targetKey = 'segment_id' in target ? `s:${target.segment_id}` : `r:${target.record_id}`;
  const current = useRef({ reference, target }); current.current = { reference, target };
  useEffect(() => { const { reference, target } = current.current; if (reference) void useSourceMediaStore.getState().refresh(reference, target); }, [key, targetKey, playbackFailed]);
  if (!text.trim()) return null;
  const synthetic = (key: string) => <SpeechButton text={text} speechKey={key} kind="sentence" label={t('sourceAudio.playSynthetic')} displayLabel={t('sourceAudio.read')} showLabel={!!reference?.source.audio}/>;
  if (!reference) return statusOnly ? null : <div className="source-audio-controls">{synthetic(speechKey)}<SpeechFeedback speechKeys={[speechKey]} /></div>;
  if (!reference.source.audio) return statusOnly ? null : <div className="source-audio-controls">{synthetic(`${speechKey}:synthetic`)}<SpeechFeedback speechKeys={[`${speechKey}:synthetic`]} /></div>;
  const ready = state?.status === 'ready', preparing = state?.status === 'preparing';
  const code = state?.error ?? '';
  const errorKey = /missing_tool|missing_ffmpeg|missing_ffprobe/.test(code) ? 'sourceAudio.missingTools' : /storage|budget|disk/.test(code) ? 'sourceAudio.storageFull' : /version|mismatch/.test(code) ? 'sourceAudio.versionChanged' : 'sourceAudio.failed';
  if (statusOnly && ready) return null;
  const originalAction = preparing ? t('sourceAudio.cancelPreparation') : t(state?.status === 'failed' ? 'sourceAudio.retry' : 'sourceAudio.download');
  return <div className="source-audio-controls" data-media-state={state?.status ?? 'missing'}>
    {ready ? <SpeechButton text={text} speechKey={speechKey} kind="sentence" media={bindMediaTarget(reference, target)} label={t('sourceAudio.playOriginal')}
      displayLabel={t('sourceAudio.original')} idleIcon={<Headphones size={18} aria-hidden="true"/>} showLabel/>
      : <button type="button" className="ui-button speech-button" aria-label={originalAction} title={originalAction} aria-busy={preparing} onClick={() => preparing ? media.cancel(reference.source.key) : void media.prepare(reference, target)}>
        {preparing ? <InlineProgress label={t('sourceAudio.preparing')}/> : state?.status === 'failed' ? <RotateCcw size={18} aria-hidden="true"/> : <Download size={18} aria-hidden="true"/>}<span>{t('sourceAudio.original')}</span>
      </button>}
    {!statusOnly && synthetic(`${speechKey}:synthetic`)}
    {state?.status === 'failed' && <small className="source-audio-status" role="status">{t(errorKey)}</small>}
    {reference.source.audio?.language === 'und' && <small className="source-audio-status">{t('sourceAudio.languageUnconfirmed')}</small>}
    <SpeechFeedback speechKeys={[speechKey, `${speechKey}:synthetic`]} />
  </div>;
}
