import { invoke } from '@tauri-apps/api/core';
import { useMaterialStore } from '../stores/materialStore';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import MobileLaunch from './MobileLaunch';
import { DESKTOP_LAUNCH_DURATION, DESKTOP_LAUNCH_SPEED } from './DesktopLaunch';
import { isMobilePlatform } from '../lib/platform';
import { StartupContext } from './StartupContext';
import './mobile-startup.css';

/** One launch per WebView lifetime. The actual app warms up beneath the cover. */
export default function MobileStartup({children}:{children:ReactNode}) {
  const [starting,setStarting]=useState(isMobilePlatform);
  const stage=useRef<HTMLDivElement>(null);
  const materialReady=useMaterialStore(state=>state.hasLoaded);
  const warmed=useRef(false);
  useEffect(()=>{
    // Let the primary material list acquire the DB first, then warm the native
    // archive while the existing launch plays. A real Saved visit still rereads
    // current data, so saves/removals are never replaced by a prefetched snapshot.
    if(!starting||!materialReady||warmed.current)return;
    warmed.current=true;
    void invoke('list_saved_groups',{query:'',limit:1,offset:0}).catch(()=>{});
  },[starting,materialReady]);
  useLayoutEffect(()=>{
    if(!starting)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const duration=reduced.matches?250:DESKTOP_LAUNCH_DURATION/DESKTOP_LAUNCH_SPEED;
    const deadline=performance.now()+duration+180;
    const root=stage.current;
    const animations=root?.querySelector('.desktop-launch')?.getAnimations({subtree:true})??[];
    const start=document.timeline.currentTime;
    for(const animation of animations){animation.playbackRate=DESKTOP_LAUNCH_SPEED;if(start!==null)animation.startTime=start;}
    root?.style.setProperty('--startup-hold',`${duration}ms`);
    const finish=()=>setStarting(false);
    // Do not depend on Animation.finished: WKWebView can suspend its timeline.
    const timer=window.setTimeout(finish,duration+180);
    const foreground=()=>{if(document.visibilityState==='visible'&&performance.now()>=deadline)finish();};
    const reduce=()=>{if(reduced.matches)finish();};
    window.addEventListener('pageshow',foreground);document.addEventListener('visibilitychange',foreground);reduced.addEventListener('change',reduce);
    return()=>{clearTimeout(timer);window.removeEventListener('pageshow',foreground);document.removeEventListener('visibilitychange',foreground);reduced.removeEventListener('change',reduce);};
  },[starting]);
  return <StartupContext.Provider value={starting}>
    <div className="app-startup-content" inert={starting} aria-hidden={starting||undefined}>{children}</div>
    {starting&&<div ref={stage} className="mobile-startup" role="status" aria-label="LexiCue 正在启动"><MobileLaunch/></div>}
  </StartupContext.Provider>;
}
