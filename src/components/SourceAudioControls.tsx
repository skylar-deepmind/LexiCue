import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { confirmAction as ask } from '../lib/confirmAction';
import { bindMediaTarget, type MediaRef, type MediaTarget } from '../lib/sourceMedia';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { useSpeechStore } from '../stores/speechStore';
import SpeechButton, { SpeechFeedback } from './SpeechButton';

export default function SourceAudioControls({ reference, target, text, speechKey, fileId, statusOnly = false }: {
  reference?: MediaRef | null; target: MediaTarget; text: string; speechKey: string; fileId?: number; statusOnly?: boolean;
}) {
  const { t } = useTranslation();
  const key = reference?.source.key;
  const status = useSourceMediaStore(s => key ? s.entries[key]?.status : undefined);
  const ready = status === 'ready';
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
    if (!isTauri() || !reference || fileId === undefined || !status) return null;
    const deleted = status === 'deleted';
    const change = async () => {
      setBusy(true);
      setFailed(false);
      try {
        if (!deleted && !await ask(t('sourceAudio.deleteEffect'), { title: t('sourceAudio.delete'), kind: 'warning' })) return;
        await invoke('set_library_audio_deleted', { fileId, deleted: !deleted });
        window.dispatchEvent(new Event('lexicue-attachments-changed'));
      } catch { setFailed(true); }
      finally { setBusy(false); }
    };
    return <details className="source-audio-controls">
      <summary>{t(ready ? 'sourceAudio.offlineReady' : deleted ? 'sourceAudio.deleted' : 'sourceAudio.missing')}</summary>
      <button type="button" className="ui-button" disabled={busy} onClick={() => void change()}>
        {t(deleted ? 'sourceAudio.restore' : 'sourceAudio.delete')}
      </button>
      {failed && <div role="alert">{t('sourceAudio.changeFailed')}</div>}
    </details>;
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
