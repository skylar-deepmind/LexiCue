import InlineProgress from './InlineProgress';
import { BookOpen, Headphones, Languages, LoaderCircle, Pause, Play } from 'lucide-react';
import VisitLink from './VisitLink';
import { useTranslation } from 'react-i18next';
import { useReadingToolsStore } from '../stores/readingToolsStore';

export default function MobileReadingTools() {
  const {t}=useTranslation(), tools=useReadingToolsStore();
  if(!tools.available)return null;
  const angle=({'0.75':-55,'1':-18,'1.25':20,'1.5':58} as Record<string,number>)[String(tools.rate)]??-18;
  return <nav className="mobile-reading-tools" aria-label={t('reader.tools')}>
    <div data-guide="tools" className="mobile-reading-bar" data-listening={tools.listening}>
      <button type="button" className="b-dock-control mobile-translation-control" aria-label={t(tools.translation?'reader.hideTranslation':'reader.showTranslation')} title={t(!tools.hasTranslation?'reader.noTranslation':tools.translation?'reader.hideTranslation':'reader.showTranslation')} aria-pressed={tools.hasTranslation&&tools.translation} disabled={!tools.hasTranslation} aria-busy={!!tools.translationProgress} onClick={tools.onTranslation}>{tools.translationProgress ? <InlineProgress label={t('reader.translationProgress', tools.translationProgress)} progress={tools.translationProgress}/> : <Languages size={22} aria-hidden="true"/>}</button>
      <div className="mobile-listen-cluster">
        <div className="mobile-headphone-mode" data-active={!tools.listening} inert={tools.listening} aria-hidden={tools.listening}>
          <button type="button" className="b-dock-control" aria-label={t('reader.startListening')} title={t('reader.startListening')} onClick={tools.onListen}><Headphones size={22} aria-hidden="true"/></button>
        </div>
        <div className="mobile-playback-mode" data-active={tools.listening} inert={!tools.listening} aria-hidden={!tools.listening}>
          <button type="button" className="b-dock-control" aria-label={t(tools.playing?'reader.pause':'reader.play')} title={t(tools.playing?'reader.pause':'reader.play')} disabled={tools.disabled} aria-busy={tools.loading} onClick={tools.playing?tools.onPause:tools.onPlay}>{tools.loading?<LoaderCircle size={22} className="speech-spinner" aria-hidden="true"/>:tools.playing?<Pause size={22} aria-hidden="true"/>:<Play size={22} aria-hidden="true"/>}</button>
          <button type="button" className="b-dock-control mobile-rate-control" aria-label={t('reader.changeRate',{rate:tools.rate})} title={t('reader.changeRate',{rate:tools.rate})} onClick={tools.onRate}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path className="playback-gauge-needle" style={{transform:`rotate(${angle}deg)`}} d="M12 13V6"/><circle cx="12" cy="13" r="1.25"/></svg>
          </button>
          <button type="button" className="b-dock-control" aria-label={t('reader.exitListening')} title={t('reader.exitListening')} onClick={tools.onListen}><BookOpen size={22} aria-hidden="true"/></button>
        </div>
      </div>
      <VisitLink className="b-dock-control mobile-saved-control" to="/saved" aria-label={t('savedRecords.title')} title={t('savedRecords.title')}><span className="mobile-saved-icon" aria-hidden="true"/></VisitLink>
    </div>
  </nav>;
}
