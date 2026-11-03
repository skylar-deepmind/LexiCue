/** Disposable, isolated WKWebView acceptance. DOM input is synthetic; frames are real layout. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { assertSlicePreview } from './slicePreview';
import { THEMES } from '../lib/themes';
import type { MaterialImportResult, ReadingMaterial } from '../lib/materials';
export async function runMacRefinementChecks() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1' || import.meta.env.VITE_SLICE_MAC_REFINEMENT !== '1') throw Error('Refinement QA identity required');
  const report = { method:'Production native IPC and real WKWebView requestAnimationFrame geometry; synthetic DOM input; no VoiceOver/sync/updater',checks:[] as string[],errors:[] as string[],themes:[] as unknown[],motion:[] as unknown[],completed:false };
  const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const check=(yes:unknown,label:string)=>{(yes?report.checks:report.errors).push(label);};
  const until=async<T,>(fn:()=>T,label:string)=>{const end=Date.now()+15000;while(Date.now()<end){const v=fn();if(v)return v;await delay(40);}throw Error(`Timeout ${label}`);};
  const live=<T extends HTMLElement=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)].find(n=>!n.closest('[inert],[aria-hidden="true"]')&&n.getClientRects().length);
  const settle=async()=>{await delay(550);await until(()=>!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity),'finite motion');};
  const query=async(text:string,groups:number)=>{const input=await until(()=>live<HTMLInputElement>('.saved-search input'),'search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,text);input.dispatchEvent(new Event('input',{bubbles:true}));await until(()=>document.querySelectorAll('.page-live .saved-group-row').length===groups,'filtered groups');await settle();};
  const original={theme:document.documentElement.dataset.theme,width:innerWidth,height:innerHeight};
  const measure=()=>{const scroll=live('.saved-scroll')!,work=live('.saved-workspace')!,head=live('.saved-heading h1')!,row=live('.saved-group-row')!;const a=work.getBoundingClientRect(),b=head.getBoundingClientRect(),c=row.getBoundingClientRect();return {x:a.x,width:a.width,headX:b.x,rowX:c.x,rowWidth:c.width,clientWidth:scroll.clientWidth,offsetWidth:scroll.offsetWidth,overflow:scroll.scrollHeight>scroll.clientHeight,scrollTop:scroll.scrollTop};};
  const sample=async(label:string,button:HTMLButtonElement,rapid=false)=>{const frames=[{t:0,...measure()}];let clicked=false,reversed=false,again=false;const start=performance.now();await new Promise<void>(resolve=>{const tick=()=>{const t=performance.now()-start;if(!clicked){button.click();clicked=true;}if(rapid&&t>80&&!reversed){button.click();reversed=true;}if(rapid&&t>160&&!again){button.click();again=true;}frames.push({t,...measure()});if(t<800)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});const span=(key:'x'|'width'|'headX'|'rowX'|'rowWidth'|'clientWidth')=>Math.max(...frames.map(f=>f[key]))-Math.min(...frames.map(f=>f[key]));const changes={x:span('x'),width:span('width'),headX:span('headX'),rowX:span('rowX'),rowWidth:span('rowWidth'),clientWidth:span('clientWidth')};report.motion.push({label,changes,frames});check(Object.values(changes).every(n=>n<=.6),`${label}: horizontal geometry stays within 0.6px throughout animation`);await settle();};
  try {
    const expressions=['beacon','harbor','meadow','cedar','marble','garden','lantern','river','island','bridge','valley','forest'];
    const lines=expressions.map(x=>`${x} helps us keep the original reading context. ${'The gentle evening light moves across the quiet path. '.repeat(30)}`);
    const imported=await invoke<MaterialImportResult>('import_reading_material',{input:{operation_id:'mac-refine-qa-fixture-v1',name:'macOS refinement QA context fixture.txt',normalized_kind:'txt',content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:null,start_time:null,end_time:null}))}});
    const data=await invoke<ReadingMaterial>('open_reading_material',{fileId:imported.file_id});
    for(let i=0;i<expressions.length;i++)await invoke('mutate_saved_record',{operationId:`mac-refine-qa-save-v1-${i}`,mutation:{kind:'save',input:{segment_id:data.segments[i].id,expression:expressions[i],start_offset:0,end_offset:expressions[i].length,explanation:`refine-qa-all ${i===0?'refine-qa-solo':''}`,explanation_source:'personal'}}});
    window.dispatchEvent(new Event('lexicue-saved-changed'));(await until(()=>live<HTMLAnchorElement>('.b-dock a[href="/saved"]'),'saved nav')).click();await until(()=>live('.saved-scroll'),'saved screen');await settle();
    (await until(()=>live<HTMLAnchorElement>('.b-dock a[href="/settings"]'),'settings nav')).click();await until(()=>live('.theme-choice'),'theme settings');await settle();
    for(const theme of THEMES){const preview=document.querySelector<HTMLElement>(`.theme-preview--${theme.id}`)!;preview.closest<HTMLButtonElement>('button')!.click();await settle();const css=getComputedStyle(document.documentElement),actual=css.getPropertyValue('--accent-600').trim(),bg=css.getPropertyValue('--app-bg').trim(),card=getComputedStyle(preview).getPropertyValue('--preview-accent').trim();report.themes.push({theme:theme.id,preview:card,registry:theme.color,actual,background:bg});check(actual.toLowerCase()===card.toLowerCase(),`${theme.id}: actual settings preview accent matches actual accent`);check(document.documentElement.dataset.theme===theme.id&&localStorage.getItem('lexicue-theme')===theme.id,`${theme.id}: switch persists selected theme`);}
    (await until(()=>live<HTMLAnchorElement>('.b-dock a[href="/saved"]'),'return saved')).click();await until(()=>live('.saved-scroll'),'saved returns');await settle();
    for(const theme of ['ocean','midnight'])for(const width of [800,920,1280])for(const mode of ['short','long']){
      document.documentElement.dataset.theme=theme;await getCurrentWindow().setSize(new LogicalSize(width,800));await settle();await query(mode==='short'?'refine-qa-solo':'refine-qa-all',mode==='short'?1:12);
      const button=await until(()=>live<HTMLButtonElement>('.saved-record-open'),'group');if(button.getAttribute('aria-expanded')==='true'){button.click();await settle();}
      const before=measure();check(mode==='short'?!before.overflow:before.overflow,`${theme}/${width}/${mode}: expected initial overflow boundary`);
      const label=`${theme}/${width}/${mode}`;await sample(`${label}/open`,button);check(measure().overflow,`${label}: expanded context is scrollable`);await sample(`${label}/close`,button);await sample(`${label}/reverse`,button,true);
      const accordion=live('.saved-group-row')!.querySelector<HTMLElement>('.saved-accordion')!;check(button.getAttribute('aria-expanded')==='true'&&!accordion.inert,`${label}: rapid reversal leaves exactly one accessible expanded region`);button.click();await settle();check(accordion.inert&&accordion.getAttribute('aria-hidden')==='true',`${label}: collapsed context is inert`);
    }
  }catch(error){report.errors.push(String(error));}
  finally{document.documentElement.dataset.theme=original.theme??'ocean';await getCurrentWindow().setSize(new LogicalSize(original.width,original.height+28));localStorage.setItem('lexicue-theme',original.theme??'ocean');report.completed=true;await writeTextFile('mac-release-refinement-native.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});}
  return report;
}
