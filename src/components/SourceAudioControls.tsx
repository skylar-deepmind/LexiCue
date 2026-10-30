import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { bindMediaTarget, type MediaRef, type MediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { useSpeechStore } from '../stores/speechStore';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

/** One original-context player with an explicit, separate synthetic-voice recovery. */
export default function SourceAudioControls({ reference, target, text, speechKey, saved = false, statusOnly = false }: {
  reference?: MediaRef | null; target: MediaTarget; text: string; speechKey: string; saved?: boolean; statusOnly?: boolean;
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
  if (!reference) return <SpeechButton text={text} speechKey={speechKey} kind="sentence" label={t('sourceAudio.synthetic')} />;
  const ready = state?.status === 'ready', preparing = state?.status === 'preparing';
  const code = state?.error ?? '';
  const errorKey = /missing_tool|missing_ffmpeg|missing_ffprobe/.test(code) ? 'sourceAudio.missingTools' : /storage|budget|disk/.test(code) ? 'sourceAudio.storageFull' : /version|mismatch/.test(code) ? 'sourceAudio.versionChanged' : 'sourceAudio.failed';
  return <div className="source-audio-controls" data-media-state={state?.status ?? 'missing'}>
    {!statusOnly && <SpeechButton text={text} speechKey={speechKey} kind="sentence" media={ready ? bindMediaTarget(reference, target) : undefined}
      label={t('sourceAudio.clip')} disabled={!ready} />}
    <small role="status">{t(preparing ? 'sourceAudio.preparing' : ready ? saved ? 'sourceAudio.saved' : 'sourceAudio.clip' : state?.status === 'failed' ? errorKey : 'sourceAudio.missing')}
      {reference.source.audio?.language === 'und' && <> · {t('sourceAudio.languageUnconfirmed')}</>}</small>
    {preparing ? <button className="ui-button" onClick={() => media.cancel(reference.source.key)}>{t('common.cancel')}</button>
      : !ready && <button className="ui-button" onClick={() => void media.prepare(reference, target)}>{t('sourceAudio.retry')}</button>}
    {!statusOnly && <SpeechButton text={text} speechKey={`${speechKey}:synthetic`} kind="sentence" label={t('sourceAudio.synthetic')} showLabel />}
    <SpeechFeedback speechKeys={[speechKey, `${speechKey}:synthetic`]} />
  </div>;
}
