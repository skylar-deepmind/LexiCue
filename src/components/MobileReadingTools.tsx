import { useRef, type ComponentProps } from 'react';
import InlineProgress from './InlineProgress';
import { BookOpen, Headphones, Languages, LoaderCircle, Pause, Play } from 'lucide-react';
import VisitLink from './VisitLink';
import { useTranslation } from 'react-i18next';
import { useReadingToolsStore, type PlaybackTarget } from '../stores/readingToolsStore';

function PlaybackSeekButton({ onTarget, onTargetEnd, onClick, ...props }: ComponentProps<'button'> & {
  onTarget: (target: PlaybackTarget) => boolean;
  onTargetEnd: (commit: boolean) => void;
}) {
  const { t } = useTranslation();
  type Input = 'pointer' | 'touch';
  const drag = useRef<{ input: Input; id: number; x: number; y: number; seeking: boolean } | null>(null);
  const keyboard = useRef(false), moved = useRef(false);
  const begin = (input: Input, id: number, x: number, y: number) => {
    moved.current = false;
    if (keyboard.current) { keyboard.current = false; onTargetEnd(false); }
    drag.current = { input, id, x, y, seeking: false };
  };
  const move = (input: Input, id: number, x: number, y: number) => {
    const active = drag.current;
    if (!active || active.input !== input || active.id !== id) return;
    const up = active.y - y;
    if (Math.hypot(x - active.x, up) >= 10) moved.current = true;
    if (!active.seeking && up < 10) return;
    active.seeking = true;
    onTarget({ y });
  };
  const finish = (input: Input, id: number, commit: boolean, y: number) => {
    const active = drag.current;
    if (!active || active.input !== input || active.id !== id) return;
    drag.current = null;
    if (active.seeking) {
      if (commit) onTarget({ y });
      onTargetEnd(commit);
    }
  };
  return <button type="button" className="b-dock-control playback-seek-control" {...props}
    aria-description={t('reader.pickPlaybackStart')}
    onPointerDown={event => {
      if (event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary) return;
      begin('pointer', event.pointerId, event.clientX, event.clientY);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => move('pointer', event.pointerId, event.clientX, event.clientY)}
    onPointerUp={event => finish('pointer', event.pointerId, true, event.clientY)}
    onPointerCancel={event => finish('pointer', event.pointerId, false, event.clientY)}
    onLostPointerCapture={event => finish('pointer', event.pointerId, false, event.clientY)}
    onTouchStart={event => {
      const touch = event.changedTouches[0];
      if (touch && event.touches.length === 1) begin('touch', touch.identifier, touch.clientX, touch.clientY);
      else if (drag.current?.input === 'touch') finish('touch', drag.current.id, false, 0);
    }}
    onTouchMove={event => {
      const touch = Array.from(event.changedTouches).find(item => item.identifier === drag.current?.id);
      if (touch) move('touch', touch.identifier, touch.clientX, touch.clientY);
    }}
    onTouchEnd={event => {
      const touch = Array.from(event.changedTouches).find(item => item.identifier === drag.current?.id);
      if (touch) finish('touch', touch.identifier, true, touch.clientY);
    }}
    onTouchCancel={event => {
      const touch = Array.from(event.changedTouches).find(item => item.identifier === drag.current?.id);
      if (touch) finish('touch', touch.identifier, false, touch.clientY);
    }}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        keyboard.current = onTarget({ step: event.key === 'ArrowUp' ? -1 : 1 });
      } else if (keyboard.current && ['Enter', ' ', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        keyboard.current = false;
        onTargetEnd(event.key !== 'Escape');
      }
    }}
    onBlur={() => { if (keyboard.current) { keyboard.current = false; onTargetEnd(false); } }}
    onClick={event => { if (!moved.current || event.detail === 0) onClick?.(event); }}/>;
}

export default function MobileReadingTools() {
  const {t}=useTranslation(), tools=useReadingToolsStore();
  if(!tools.available)return null;
  const angle=({'0.75':-55,'1':-18,'1.25':20,'1.5':58} as Record<string,number>)[String(tools.rate)]??-18;
  return <nav className="mobile-reading-tools" aria-label={t('reader.tools')}>
    <div data-guide="tools" className="mobile-reading-bar" data-listening={tools.listening}>
      <button type="button" className="b-dock-control mobile-translation-control" aria-label={t(tools.translation?'reader.hideTranslation':'reader.showTranslation')} title={t(!tools.hasTranslation?'reader.noTranslation':tools.translation?'reader.hideTranslation':'reader.showTranslation')} aria-pressed={tools.hasTranslation&&tools.translation} disabled={!tools.hasTranslation} aria-busy={!!tools.translationProgress} onClick={tools.onTranslation}>{tools.translationProgress ? <InlineProgress label={t('reader.translationProgress', tools.translationProgress)} progress={tools.translationProgress}/> : <Languages size={22} aria-hidden="true"/>}</button>
      <div className="mobile-listen-cluster">
        <div className="mobile-headphone-mode" data-active={!tools.listening} inert={tools.listening} aria-hidden={tools.listening}>
          <PlaybackSeekButton aria-label={t('reader.startListening')} title={t('reader.startListening')} onTarget={tools.onPlaybackTarget} onTargetEnd={tools.onPlaybackTargetEnd} disabled={tools.disabled} onClick={tools.onListen}><Headphones size={22} aria-hidden="true"/></PlaybackSeekButton>
        </div>
        <div className="mobile-playback-mode" data-active={tools.listening} inert={!tools.listening} aria-hidden={!tools.listening}>
          <PlaybackSeekButton onTarget={tools.onPlaybackTarget} onTargetEnd={tools.onPlaybackTargetEnd} aria-label={t(tools.playing?'reader.pause':'reader.play')} title={t(tools.playing?'reader.pause':'reader.play')} disabled={tools.disabled} aria-busy={tools.loading} onClick={tools.playing?tools.onPause:tools.onPlay}>{tools.loading?<LoaderCircle size={22} className="speech-spinner" aria-hidden="true"/>:tools.playing?<Pause size={22} aria-hidden="true"/>:<Play size={22} aria-hidden="true"/>}</PlaybackSeekButton>
          <button type="button" className="b-dock-control mobile-rate-control" aria-label={t('reader.changeRate',{rate:tools.rate})} title={t('reader.changeRate',{rate:tools.rate})} onClick={tools.onRate}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path className="playback-gauge-needle" style={{transform:`rotate(${angle}deg)`,transformOrigin:'12px 13px',transformBox:'view-box'}} d="M12 13V6"/><circle cx="12" cy="13" r="1.25"/></svg>
          </button>
          <button type="button" className="b-dock-control" aria-label={t('reader.exitListening')} title={t('reader.exitListening')} onClick={tools.onListen}><BookOpen size={22} aria-hidden="true"/></button>
        </div>
      </div>
      <VisitLink className="b-dock-control mobile-saved-control" to="/saved" aria-label={t('savedRecords.title')} title={t('savedRecords.title')}><span className="mobile-saved-icon" aria-hidden="true"/></VisitLink>
    </div>
  </nav>;
}
