import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones } from 'lucide-react';
import { bindMediaTarget, type MediaRef, type MediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { useSpeechStore } from '../stores/speechStore';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

export default function SourceAudioControls({ reference, target, text, speechKey, statusOnly = false }: {
  reference?: MediaRef | null; target: MediaTarget; text: string; speechKey: string; statusOnly?: boolean;
}) {
  const { t } = useTranslation();
  const key = reference?.source.key;
  const ready = useSourceMediaStore(s => !!key && s.entries[key]?.status === 'ready');
  const playbackFailed = useSpeechStore(s => s.error && s.errorKey === speechKey);
  const targetKey = 'segment_id' in target ? `s:${target.segment_id}` : `r:${target.record_id}`;
  const current = useRef({ reference, target });
  current.current = { reference, target };
  useEffect(() => {
    const { reference, target } = current.current;
    if (reference) void useSourceMediaStore.getState().refresh(reference, target);
  }, [key, targetKey, playbackFailed]);
  if (statusOnly || !text.trim()) return null;
  const media = ready && reference ? bindMediaTarget(reference, target) : undefined;
  return <div className="source-audio-controls">
    <SpeechButton text={text} speechKey={speechKey} kind="sentence" media={media}
      label={t(media ? 'sourceAudio.playOriginal' : 'sourceAudio.playSynthetic')}
      idleIcon={media ? <Headphones size={18} aria-hidden="true"/> : undefined}/>
    <SpeechFeedback speechKeys={[speechKey]} />
  </div>;
}
