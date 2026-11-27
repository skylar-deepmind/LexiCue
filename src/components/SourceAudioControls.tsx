import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import { bindMediaTarget, type MediaRef, type MediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { useSpeechStore } from '../stores/speechStore';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

export default function SourceAudioControls({ reference, target, text, speechKey, statusOnly = false }: {
  reference?: MediaRef | null; target: MediaTarget; text: string; speechKey: string; statusOnly?: boolean;
}) {
  const { t } = useTranslation();
  const key = reference?.source.key;
  const status = useSourceMediaStore(s => key ? s.entries[key]?.status : undefined);
  const ready = status === 'ready';
  const playbackFailed = useSpeechStore(s => s.error && s.errorKey === speechKey);
  const targetKey = 'segment_id' in target ? `s:${target.segment_id}` : `r:${target.record_id}`;
  const current = useRef({ reference, target });
  current.current = { reference, target };
  useEffect(() => {
    const refresh = () => {
      const { reference, target } = current.current;
      if (reference) void useSourceMediaStore.getState().refresh(reference, target);
    };
    refresh();
    window.addEventListener('lexicue-attachments-changed', refresh);
    return () => window.removeEventListener('lexicue-attachments-changed', refresh);
  }, [key, targetKey, playbackFailed]);
  if (statusOnly) {
    if (!('segment_id' in target) || !isTauri() || !reference || !status) return null;
    return <p className="source-audio-controls">{t(ready ? 'sourceAudio.offlineReady' : 'sourceAudio.missing')}</p>;
  }
  if (!text.trim()) return null;
  const media = ready && reference ? bindMediaTarget(reference, target) : undefined;
  return <div className="source-audio-controls">
    <SpeechButton text={text} speechKey={speechKey} kind="sentence" media={media}
      label={t(media ? 'sourceAudio.playOriginal' : 'sourceAudio.playSynthetic')}
      idleIcon={media ? <Headphones size={18} aria-hidden="true"/> : undefined}/>
    <SpeechFeedback speechKeys={[speechKey]} />
  </div>;
}
