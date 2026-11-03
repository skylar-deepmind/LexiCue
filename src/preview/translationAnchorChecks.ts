/** Real WKWebView disclosure geometry with controlled audio progress, only in
 * the isolated QA application. No generated audio or translation service. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useSpeechStore, type ReadingSessionSnapshot, type SpeechQueueItem } from '../stores/speechStore';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useReadingToolsStore } from '../stores/readingToolsStore';
import { DESK_KEY } from '../lib/readingDesk';
import type { MaterialImportResult } from '../lib/materials';

export async function runTranslationAnchorChecks() {
  await assertSlicePreview(); if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { checks: [] as string[], errors: [] as string[], samples: [] as unknown[], completed: false };
  const check = (yes: unknown, label: string) => (yes ? report.checks : report.errors).push(label);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(n => n.getClientRects().length && !n.closest('[inert],[aria-hidden="true"]'));
  const until = async <T,>(fn: () => T, label: string) => { const end = performance.now() + 12000; while (performance.now() < end) { const v = fn(); if (v) return v; await wait(20); } throw Error(`Timeout ${label}`); };
  const theme = document.documentElement.dataset.theme, oldDesk = localStorage.getItem(DESK_KEY), speech = useSpeechStore.getState(); speech.stop();
  const match = window.matchMedia; let reduced = false;
  const preference = new EventTarget() as MediaQueryList; Object.defineProperty(preference, 'matches', { get: () => reduced });
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? preference : match.call(window, query);
  const style = document.createElement('style');
  let items: readonly SpeechQueueItem[] = [];
  const progress = (index: number, status: ReadingSessionSnapshot['status'] = 'playing', mode: ReadingSessionSnapshot['mode'] = 'tts-queue') => {
    const key = items[index].key;
    useSpeechStore.setState({ reading: { key, index, mode, status, rate: 1, pauseReason: status === 'paused' ? 'user' : null, resumeMode: 'continue', errorCode: null }, status: status === 'paused' ? 'paused' : 'playing', queueIndex:index, playbackMode:mode, key, loading:false });
  };
  useSpeechStore.setState({
    startQueue: async (next,index=0) => {items=next;progress(index);},
    pause: () => {const s=useSpeechStore.getState().reading;if(s)progress(s.index,'paused',s.mode);},
    resume: async () => {const s=useSpeechStore.getState().reading;if(s)progress(s.index,'playing',s.mode);},
    exitReading: () => useSpeechStore.setState({reading:null,status:'idle',queueIndex:null,playbackMode:null}),
  });
  try {
    const lines = Array.from({length:130},(_,i)=> i===47 ? 'This long English paragraph keeps the beginning of the passage visible. '.repeat(38) : `Sentence ${i+1} gives us a quiet moment to think about the day ahead.`);
    const fixture = await invoke<MaterialImportResult>('import_reading_material',{input:{operation_id:'translation-anchor-qa-v1',name:'Translation position QA.txt',normalized_kind:'txt',content:lines.join('\n'),segments:lines.map((text,index)=>({index,en_text:text,zh_text:('这是第'+(index+1)+'句的中文说明，我们继续观察正在阅读的原文位置。').repeat(index%3===0?5:2),start_time:null,end_time:null}))}});
    const nav = async () => {live<HTMLAnchorElement>('.b-dock a[href="/files"]')!.click();await wait(500);};
    const open = async (id:number) => {await nav();await useMaterialStore.getState().load();const f=useMaterialStore.getState().files.find(f=>f.id===id)!;localStorage.removeItem(`lexicue-reader-state:${f.content_hash}`);useReadingDeskStore.getState().keep(f);useReadingDeskStore.getState().select(f);await wait(60);live<HTMLButtonElement>('.desk-paper[data-desk-active="true"] .desk-primary')!.click();await until(()=>live('.reading-original'),'reader');await document.fonts.ready;await wait(650);};
    await open(fixture.file_id);
    let viewport=live('.reader-scroll')!;
    const original=(index:number)=>viewport.querySelector<HTMLElement>(`[data-sentence="${index}"] .reading-original`)!;
    const offset=(node:HTMLElement)=>node.getBoundingClientRect().top-viewport.getBoundingClientRect().top;
    const visibleWord=()=>[...viewport.querySelectorAll<HTMLElement>('.reading-word')].find(n=>{const r=n.getBoundingClientRect(),v=viewport.getBoundingClientRect();return r.bottom>v.top&&r.top<v.bottom-100;})!;
    const translation=()=>live<HTMLButtonElement>('.dock-reading-tools > button:nth-of-type(2)')!;
    const setTranslation=async(enabled:boolean)=>{if(useReadingToolsStore.getState().translation!==enabled){translation().click();await wait(550);}};
    const listen=async()=>{if(!useReadingToolsStore.getState().listening){live<HTMLButtonElement>('.dock-reading-tools > button')!.click();await until(()=>items.length>0,'queue');}};
    const pause=()=>live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click();
    const align=async(index:number)=>{progress(index,'paused');await wait(35);pause();await wait(1050);};
    const centerError=(index:number)=>{const r=original(index).getBoundingClientRect(),v=viewport.getBoundingClientRect(),c=live('.reading-playback')!.getBoundingClientRect();return r.top+r.height/2-(v.top+Math.min(v.bottom,c.top-20))/2;};
    const sample=async(label:string,node:HTMLElement,action:()=>void,length=600)=>{
      const before=offset(node),height=viewport.scrollHeight,frames:Array<{time:number;offset:number}>=[],start=performance.now();let raf=0,active=true;
      const tick=()=>{if(!active)return;setTimeout(()=>{if(active&&node.isConnected)frames.push({time:performance.now()-start,offset:offset(node)});},0);raf=requestAnimationFrame(tick);};
      action();raf=requestAnimationFrame(tick);await wait(length);active=false;cancelAnimationFrame(raf);
      const max=Math.max(0,...frames.map(f=>Math.abs(f.offset-before))),after=offset(node);
      report.samples.push({label,before,after,maxDeviation:max,heightChange:viewport.scrollHeight-height,frames});
      check(max<2&&Math.abs(after-before)<2,`${label}: the same original stays within 2px throughout the disclosure`);
      check(!viewport.hasAttribute('data-reading-anchoring'),`${label}: anchoring releases after the layout settles`);
      return {max,before,after};
    };
    for(const appearance of ['ocean','sage','midnight']) {
      document.documentElement.dataset.theme=appearance;
      await setTranslation(false);await listen();await align(21);pause();await wait(80);
      translation().focus({preventScroll:true});
      await sample(`${appearance}/paused-open`,original(21),()=>translation().click());
      await sample(`${appearance}/paused-close`,original(21),()=>translation().click());
      check(useSpeechStore.getState().reading?.status==='paused'&&useSpeechStore.getState().reading?.index===21,`${appearance}: toggles never resume or change paused playback`);
      check(document.activeElement===translation(),`${appearance}: translation toggle keeps keyboard focus`);
      await sample(`${appearance}/rapid-reversal`,original(21),()=>{translation().click();setTimeout(()=>translation().click(),90);setTimeout(()=>translation().click(),180);},850);
      await setTranslation(false);
      // The paused progress is elsewhere: keep what the user is actually viewing.
      viewport.scrollTop+=offset(original(55))-100;await wait(80);
      await sample(`${appearance}/browsing-away-from-progress`,visibleWord(),()=>translation().click());
      check(original(21).getBoundingClientRect().bottom<viewport.getBoundingClientRect().top,`${appearance}: translation does not pull manually browsed content back to an offscreen paused sentence`);
      await setTranslation(false);await align(47);pause();await wait(40);
      await sample(`${appearance}/long-paragraph`,original(47),()=>translation().click());
      await setTranslation(false);await align(129);pause();await wait(40);
      await sample(`${appearance}/last-open`,original(129),()=>translation().click());
      await sample(`${appearance}/last-close`,original(129),()=>translation().click());
      await align(0);pause();await wait(40);
      await sample(`${appearance}/opening`,original(0),()=>translation().click());
      await setTranslation(false);
      // Without listening mode, preserve the first visible English word.
      live<HTMLButtonElement>('.reading-playback button:last-of-type')!.click();await wait(200);
      viewport.scrollTop+=offset(original(35))-100;await wait(80);
      await sample(`${appearance}/ordinary-reading-open`,visibleWord(),()=>translation().click());
      await sample(`${appearance}/ordinary-reading-close`,visibleWord(),()=>translation().click());
      await listen();await align(21);
      translation().click();await wait(120);progress(22,'playing','source-continuous');await wait(1300);
      check(Math.abs(centerError(22))<3&&useSpeechStore.getState().reading?.status==='playing',`${appearance}: progress advancing during a disclosure resumes smooth follow at the latest sentence`);
      await setTranslation(false);pause();await wait(30);
      translation().click();await wait(90);viewport.dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true}));viewport.scrollTop+=100;
      check(!viewport.hasAttribute('data-reading-anchoring'),`${appearance}: deliberate scrolling immediately interrupts the anchor lock`);
      await wait(550);await setTranslation(false);
      reduced=true;preference.dispatchEvent(new Event('change'));style.textContent='.reading-translation-disclosure,.reading-translation-clip > .reading-translation {transition:none!important}';document.head.append(style);
      await align(21);pause();await wait(30);
      await sample(`${appearance}/reduced-motion`,original(21),()=>translation().click(),180);
      style.remove();reduced=false;preference.dispatchEvent(new Event('change'));await setTranslation(false);
    }
    translation().click();await wait(50);live<HTMLAnchorElement>('.b-dock a[href="/files"]')!.click();await wait(700);
    check(!document.querySelector('[data-reading-anchoring]'),'navigation during disclosure leaves no anchor lock or late scroll frame');
  } catch(error) {report.errors.push(String(error));}
  finally {
    style.remove();window.matchMedia=match;preference.dispatchEvent(new Event('change'));
    useSpeechStore.setState({startQueue:speech.startQueue,pause:speech.pause,resume:speech.resume,exitReading:speech.exitReading});useSpeechStore.getState().stop();
    document.documentElement.dataset.theme=theme??'ocean';await useMaterialStore.getState().load();if(oldDesk===null)localStorage.removeItem(DESK_KEY);else localStorage.setItem(DESK_KEY,oldDesk);useReadingDeskStore.getState().acceptExternal(oldDesk);
    report.completed=true;await writeTextFile('mac-release-translation-anchor.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});
    const status=document.createElement('p');status.textContent=`翻译位置验收：${report.checks.length} 通过，${report.errors.length} 问题`;status.style.cssText='position:fixed;right:24px;top:40px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)';document.body.append(status);
  }
  return report;
}
