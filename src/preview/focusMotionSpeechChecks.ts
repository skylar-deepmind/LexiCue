/** Isolated WKWebView checks for focus, library motion and real cached MP3 handoff. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useSpeechStore } from '../stores/speechStore';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { usePreferencesStore } from '../stores/preferencesStore';
export async function runFocusMotionSpeechChecks() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { method:'Isolated macOS WKWebView + real native TTS/cache; media clock measurements', checks:[] as string[], errors:[] as string[], focus:[] as unknown[], motion:[] as unknown[], audio:[] as unknown[], completed:false };
  const check=(yes:unknown,label:string)=>(yes?report.checks:report.errors).push(label);
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const until=async<T,>(fn:()=>T,label:string,timeout=15000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await wait(30);}throw Error(`Timeout: ${label}`);};
  const live=<T extends HTMLElement=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)].find(n=>!n.closest('[inert],[aria-hidden="true"]')&&n.getClientRects().length);
  const settle=()=>wait(650);
  const nav=async(path:string)=>{(await until(()=>live<HTMLAnchorElement>(`.b-dock a[href="${path}"]`),path)).click();await settle();};
  const focusAudit=(label:string)=>{
    const controls=[...document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex="0"]')].filter(n=>n.getClientRects().length&&!n.closest('[inert],[aria-hidden="true"]')&&!(n as HTMLButtonElement).disabled);
    const bad=[] as unknown[];
    for(const n of controls){n.focus({preventScroll:true});const css=getComputedStyle(n);if(css.outlineStyle!=='none'||css.boxShadow.split(/,(?![^()]*\))/).some(x=>x.trim()!=='none'&&!x.includes('inset')&&/ 0px 0px [1-9]/.test(x)))bad.push({tag:n.tagName,class:n.className,outline:css.outline,shadow:css.boxShadow});}
    report.focus.push({label,count:controls.length,bad});check(!bad.length,`${label}: no extra surrounding focus frame`);
  };
  const originalTheme=document.documentElement.dataset.theme;
  const NativeAudio=window.Audio;
  try {
    await useMaterialStore.getState().load();
    const material=useMaterialStore.getState().files.find(f=>f.name==='A quiet morning.txt')!;
    useReadingDeskStore.getState().keep(material);
    await nav('/files');
    for(const theme of ['ocean','midnight']){
      document.documentElement.dataset.theme=theme;
      focusAudit(`${theme}/desk`);
      (await until(()=>live<HTMLButtonElement>('.desk-library-dock'),'library dock')).click();await until(()=>live('.library-search input'),'library');await settle();
      const input=live<HTMLInputElement>('.library-search input')!;input.focus();
      check(getComputedStyle(input).outlineStyle==='none'&&getComputedStyle(input).boxShadow==='none',`${theme}: search focuses without an inner frame`);
      focusAudit(`${theme}/library`);
      const frames=[] as {t:number;y:number;opacity:string}[];const start=performance.now();
      const closed=new Promise<void>(resolve=>{const tick=()=>{const p=live('.library-overlay-panel');if(p)frames.push({t:performance.now()-start,y:p.getBoundingClientRect().y,opacity:getComputedStyle(p).opacity});if(performance.now()-start<600)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await closed;
      const travel=frames.length?frames.at(-1)!.y-frames[0].y:0;
      const velocity=(from:number,to:number)=>{const span=frames.filter(f=>f.t>=from&&f.t<=to);return span.length>1?(span.at(-1)!.y-span[0].y)/(span.at(-1)!.t-span[0].t):0;};
      const earlyVelocity=velocity(20,160),lateVelocity=velocity(240,400);
      report.motion.push({theme,travel,earlyVelocity,lateVelocity,frames});
      check(earlyVelocity>lateVelocity*3&&lateVelocity>=0,`${theme}: library dismissal starts fast and decelerates`);
      check(travel>300&&frames.every((f,i)=>!i||f.y>=frames[i-1].y-.5),`${theme}: library exits downward across its full height`);
      check(!live('.library-overlay-panel')&&document.activeElement?.classList.contains('desk-library-dock'),`${theme}: close removes panel and restores dock focus`);
      await nav('/saved');focusAudit(`${theme}/saved`);
      live<HTMLButtonElement>('.saved-record-open')?.click();await settle();focusAudit(`${theme}/saved-expanded`);
      const button=live<HTMLButtonElement>('.saved-record-actions .speech-button');
      if(button){button.click();await until(()=>useSpeechStore.getState().status==='playing'||useSpeechStore.getState().error,'saved playback');check(useSpeechStore.getState().status==='playing',`${theme}: saved sentence plays`);check(!live('.speech-feedback:not(.speech-feedback--error)'),`${theme}: no normal-playback text beside button`);check(button.dataset.speechState==='playing',`${theme}: playback state stays in button`);useSpeechStore.getState().stop();}
      await nav('/settings');focusAudit(`${theme}/settings`);
      await nav('/files');
      const imp=live<HTMLButtonElement>('.dock-import-slot button');
      if(imp){imp.click();await settle();focusAudit(`${theme}/import`);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();}
      const read=live<HTMLButtonElement>('.desk-primary');
      if(read){read.click();await until(()=>live('.reading-word'),'reader');await settle();focusAudit(`${theme}/reader`);live<HTMLElement>('.reading-word')?.click();await until(()=>live('.context-panel'),'lookup');await settle();focusAudit(`${theme}/lookup`);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();}
      await nav('/files');
    }
    document.documentElement.dataset.theme='ocean';
    usePreferencesStore.getState().setSpeech({accent:'us',voices:{us:'en-US-JennyNeural',gb:'en-GB-SoniaNeural'},onlineEnabled:true,speed:'normal',allowDeviceFallback:false});
    const lines=['The morning light fell softly across the kitchen table.','She opened the window and listened to the birds outside.','I put on my coat and stepped into the quiet street.'];
    const timing=[] as unknown[];
    for(const [i,text] of lines.entries()){
      const result=await invoke<{cache_key:string;duration_ms:number;speech_end_ms:number;speech_start_ms:number}>('resolve_tts_audio',{request:{requestId:`handoff-qa-${i}`,text,kind:'sentence',accent:'us',voice:'en-US-JennyNeural',speed:'normal',onlineEnabled:true}});
      timing.push({cache_key:result.cache_key,duration_ms:result.duration_ms,speech_end_ms:result.speech_end_ms,speech_start_ms:result.speech_start_ms});
    }
    const events=[] as {id:number;event:string;t:number;cursor:number;duration:number}[];let id=0;
    window.Audio=function(src?:string){const player=new NativeAudio(src);const current=++id;const log=(event:string)=>events.push({id:current,event,t:performance.now(),cursor:player.currentTime,duration:player.duration});const pause=player.pause.bind(player);player.pause=()=>{if(player.currentTime>0)log('pause-call');pause();};for(const event of ['playing','ended','error'])player.addEventListener(event,()=>log(event));return player;} as unknown as typeof Audio;
    const queue=lines.map((text,i)=>({text,key:`handoff-qa:${i}`}));
    await useSpeechStore.getState().startQueue(queue);
    await until(()=>useSpeechStore.getState().status==='idle'||useSpeechStore.getState().error,'three sentences finish',30000);
    report.audio.push({timing,events});
    const starts=events.filter(e=>e.event==='playing');
    check(starts.length===3&&!events.some(e=>e.event==='error'), 'three real MP3s play with no decoding failures');
    for(let i=0;i<2;i++){
      const end=events.find(e=>e.id===starts[i]?.id&&e.event==='pause-call');
      const expected=(timing[i] as {speech_end_ms:number}).speech_end_ms/1000+.12;
      check(end&&Math.abs(end.cursor-expected)<.1,`sentence ${i+1}: stops at final word plus short pause`);
      const gap=end&&starts[i+1]?starts[i+1].t-end.t:null;
      report.audio.push({sentence:i+1,playerHandoffMs:gap});
      check(gap!==null&&gap>=0&&gap<300,`sentence ${i+1}: prepared-player handoff below 300ms`);
    }
  }catch(error){report.errors.push(String(error));}
  finally{useSpeechStore.getState().stop();window.Audio=NativeAudio;document.documentElement.dataset.theme=originalTheme??'ocean';report.completed=true;await writeTextFile('mac-release-focus-motion-speech.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});const status=document.createElement('p');status.textContent=`验收完成：${report.checks.length} 通过，${report.errors.length} 问题`;status.style.cssText='position:fixed;top:40px;right:40px;z-index:9999;background:var(--surface);color:var(--text-strong);padding:20px';document.body.append(status);}
  return report;
}
