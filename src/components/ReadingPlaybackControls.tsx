import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Gauge, Pause, Play, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  visible: boolean;
  playing: boolean;
  loading: boolean;
  paused: boolean;
  restartSentence: boolean;
  disabled: boolean;
  rate: number;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onRate: () => void;
  onExit: () => void;
}

export default function ReadingPlaybackControls(props: Props) {
  const { visible } = props;
  const lastVisible = useRef(props);
  useLayoutEffect(() => { if (visible) lastVisible.current = props; });
  const { playing, loading, paused, restartSentence, disabled, rate, onPlay, onPause, onReplay, onRate, onExit } = visible ? props : lastVisible.current;
  const { t } = useTranslation();
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) { setPresent(true); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), 160);
    return () => window.clearTimeout(timer);
  }, [visible]);
  if (!visible && !present) return null;
  const button = (label: string, action: () => void, icon: React.ReactNode, unavailable = false) =>
    <button type="button" aria-label={label} title={label} onClick={action} disabled={unavailable}>{icon}</button>;
  return <div className="reading-playback" data-closing={!visible || undefined} inert={!visible} aria-hidden={!visible || undefined} role="group" aria-label={t('reader.playbackControls')}>
    {button(t('reader.replay'), onReplay, <RotateCcw size={21} aria-hidden="true"/>, disabled)}
    {button(t(playing ? 'reader.pause' : restartSentence ? 'reader.restartSentence' : 'reader.play'), playing ? onPause : onPlay, playing ? <Pause size={21} aria-hidden="true"/> : <Play size={21} aria-hidden="true"/>, disabled)}
    <button type="button" className="reading-playback-rate" aria-label={t('reader.changeRate', { rate })} title={t('reader.changeRate', { rate })} onClick={onRate}><Gauge size={21} aria-hidden="true"/><span>{rate}×</span></button>
    {button(t('reader.exitListening'), onExit, <X size={21} aria-hidden="true"/>)}
    <span className="sr-only" role="status">{loading ? t('common.loading') : paused ? t('reader.paused') : ''}</span>
  </div>;
}
