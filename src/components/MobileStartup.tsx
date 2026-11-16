import { useMaterialStore } from '../stores/materialStore';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import MobileLaunch from './MobileLaunch';
import { DESKTOP_LAUNCH_SPEED } from './DesktopLaunch';
import { isMobilePlatform } from '../lib/platform';
import { StartupContext } from './StartupContext';
import './mobile-startup.css';

/** One short opening per WebView. Data readiness, not animation length, owns access. */
export default function MobileStartup({children}:{children:ReactNode}) {
  const {t}=useTranslation();
  const [starting,setStarting]=useState(isMobilePlatform),[leaving,setLeaving]=useState(false);
  const stage=useRef<HTMLDivElement>(null),began=useRef(performance.now());
  const ready=useMaterialStore(state=>state.hasLoaded||state.error);
  useEffect(()=>{
    if(!starting||!ready)return;
    const timer=window.setTimeout(()=>setLeaving(true),Math.max(0,220-(performance.now()-began.current)));
    return()=>clearTimeout(timer);
  },[starting,ready]);
  useEffect(()=>{
    if(!leaving)return;
    const timer=window.setTimeout(()=>setStarting(false),matchMedia('(prefers-reduced-motion: reduce)').matches?0:150);
    return()=>clearTimeout(timer);
  },[leaving]);
  useLayoutEffect(()=>{
    if(!starting)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const deadline=began.current+(reduced.matches?180:750);
    const animations=stage.current?.querySelector('.desktop-launch')?.getAnimations({subtree:true})??[];
    const start=document.timeline.currentTime;
    for(const animation of animations){animation.playbackRate=DESKTOP_LAUNCH_SPEED;if(start!==null)animation.startTime=start;}
    // A slow database reveals the real loading/error state, never an extended
    // decorative cover. Background WebViews also release it on foregrounding.
    const finish=()=>setLeaving(true),timer=window.setTimeout(finish,Math.max(0,deadline-performance.now()));
    const foreground=()=>{if(document.visibilityState==='visible'&&performance.now()>=deadline)finish();};
    const reduce=()=>{if(reduced.matches)finish();};
    window.addEventListener('pageshow',foreground);document.addEventListener('visibilitychange',foreground);reduced.addEventListener('change',reduce);
    return()=>{clearTimeout(timer);window.removeEventListener('pageshow',foreground);document.removeEventListener('visibilitychange',foreground);reduced.removeEventListener('change',reduce);};
  },[starting]);
  return <StartupContext.Provider value={starting}>
    <div className="app-startup-content" inert={starting} aria-hidden={starting||undefined}>{children}</div>
    {starting&&<div ref={stage} className="mobile-startup" data-exiting={leaving||undefined} role="status" aria-label={`LexiCue · ${t('common.loading')}`}><MobileLaunch/></div>}
  </StartupContext.Provider>;
}
