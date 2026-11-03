/** Native WKWebView frame measurements against real local dictionary results. */
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
export async function runLookupMotionChecks() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report={checks:[] as string[],errors:[] as string[],samples:[] as unknown[],completed:false};
  const check=(yes:unknown,label:string)=>(yes?report.checks:report.errors).push(label);
  const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const until=async<T,>(fn:()=>T,label:string)=>{const end=performance.now()+10000;while(performance.now()<end){const v=fn();if(v)return v;await sleep(20);}throw Error(`Timeout ${label}`);};
  const live=<T extends HTMLElement=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)].find(n=>n.getClientRects().length&&!n.closest('[inert],[aria-hidden="true"]'));
  const word=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(n=>n.textContent===text)!;
  const stage=()=>live('.soft-refresh');
  const ready=async(text:string)=>{await until(()=>stage()?.dataset.refreshState==='ready'&&stage()?.querySelector('.soft-refresh-current h2')?.textContent===text,`ready ${text}`);await sleep(80);};
  const selected=()=>stage()?.querySelector('.soft-refresh-current h2')?.textContent;
  const originalTheme=document.documentElement.dataset.theme;
  const sample=async(text:string,label:string,rapid?:string[],spacing=60)=>{
    const frames=[] as {t:number;height:number;bottom:number;footerBottom:number;opacity:string;phase:string;ghost:boolean;thumb:string;bodyWidth:number;contentWidth:number;nativeHidden:boolean}[];
    const start=performance.now();word(text).click();let sequence=0;
    await new Promise<void>(resolve=>{const tick=()=>{const t=performance.now()-start;
      if(rapid&&sequence<rapid.length&&t>spacing*(sequence+1)){word(rapid[sequence++]).click();}
      const panel=live('.context-panel')!,footer=live('.lookup-footer')!,s=stage()!;
      const body=s.querySelector<HTMLElement>('.soft-refresh-current .lookup-body')!;
      frames.push({t,height:panel.getBoundingClientRect().height,bottom:panel.getBoundingClientRect().bottom,footerBottom:footer.getBoundingClientRect().bottom,
        opacity:getComputedStyle(s.querySelector('.soft-refresh-current')!).opacity,phase:s.dataset.refreshState??'initial',ghost:!!s.querySelector('.soft-refresh-ghost > *'),
        thumb:getComputedStyle(body,'::-webkit-scrollbar-thumb').backgroundColor,bodyWidth:body.getBoundingClientRect().width,contentWidth:body.clientWidth-parseFloat(getComputedStyle(body).paddingLeft)-parseFloat(getComputedStyle(body).paddingRight),nativeHidden:getComputedStyle(body).scrollbarWidth==='none'&&getComputedStyle(live('.reader-scroll')!).scrollbarWidth==='none'});
      if(t<900)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
    const moving=frames.filter(f=>f.phase==='waiting'||f.phase==='revealing');
    const maxFooterGap=Math.max(...frames.map(f=>Math.abs(f.bottom-f.footerBottom-1)));
    const widthRange=Math.max(...frames.map(f=>f.bodyWidth))-Math.min(...frames.map(f=>f.bodyWidth));
    const contentWidthRange=Math.max(...frames.map(f=>f.contentWidth))-Math.min(...frames.map(f=>f.contentWidth));
    const reveal=frames.find(f=>f.phase==='revealing');
    check(maxFooterGap<1,`${label}: footer stays attached to card edge throughout`);
    check(contentWidthRange<1,`${label}: text measure stays stable when native scrollbars are hidden`);
    check(moving.every(f=>f.nativeHidden),`${label}: native scrollbars are removed during replacement`);
    check(widthRange<1,`${label}: content width does not shift`);
    check(moving.every(f=>/rgba\(.*[, /]0\)|transparent/.test(f.thumb)||f.thumb===''),`${label}: no thumb during replacement`);
    check(frames.every(f=>f.phase==='ready'||f.ghost||Number(f.opacity)>0),`${label}: no empty replacement frame`);
    check(!reveal||reveal.t>=125,`${label}: rapid results have a calm minimum hold`);
    check(moving.filter(f=>f.phase==='revealing'&&Number(f.opacity)>0&&Number(f.opacity)<1).length>=4,`${label}: content blends across multiple frames`);
    await until(()=>stage()?.dataset.refreshState==='ready',`${label} completion`);
    check(stage()?.dataset.refreshState==='ready'&&!stage()?.querySelector('.soft-refresh-ghost > *'),`${label}: final snapshot is cleaned`);
    report.samples.push({label,maxFooterGap,widthRange,contentWidthRange,frames});
  };
  try{
    (await until(()=>live<HTMLAnchorElement>('.b-dock a[href="/files"]'),'files nav')).click();await sleep(600);
    await useMaterialStore.getState().load();const material=useMaterialStore.getState().files.find(f=>f.name==='A quiet morning.txt')!;useReadingDeskStore.getState().keep(material);await sleep(100);
    (await until(()=>live<HTMLButtonElement>('.desk-primary'),'read material')).click();await until(()=>word('quiet'),'reader');await sleep(600);
    for(const theme of ['ocean','midnight']){
      document.documentElement.dataset.theme=theme;
      word('quiet').click();await ready('quiet');await sleep(450);
      const oldHeading=selected();word('plans').click();await sleep(60);
      check(stage()?.dataset.refreshState==='waiting'&&stage()?.querySelector('.soft-refresh-ghost h2')?.textContent===oldHeading,`${theme}: held result keeps the previous heading and definitions`);
      const pending=stage()?.querySelector<HTMLElement>('.lookup-pending');check(!pending||getComputedStyle(pending).clipPath==='inset(50%)',`${theme}: loading status is announced without a visual badge`);
      check(!live<HTMLButtonElement>('.lookup-footer .saved-primary')?.disabled,`${theme}: save remains usable while dictionary waits`);
      await ready('plans');
      await sample('quiet',`${theme}/natural-long-to-short`);await ready('quiet');
      await sample('plans',`${theme}/short-to-long`);await ready('plans');
      const more=stage()?.querySelector<HTMLElement>('.soft-refresh-current .dictionary-more > summary');more?.click();await sleep(100);
      const body=stage()!.querySelector<HTMLElement>('.soft-refresh-current .lookup-body')!;
      body.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:160}));body.scrollTop=80;await sleep(60);
      check(body.scrollHeight>body.clientHeight&&body.hasAttribute('data-user-scrolling'),`${theme}: actual user scrolling can still reveal its thumb`);

      await sample('ready',`${theme}/expanded-long-to-short`);await ready('ready');
      await sample('quiet',`${theme}/rapid-reversal`,['plans','ready','quiet']);await ready('quiet');
      await sample('plans',`${theme}/interrupt-visible-blend`,['ready','quiet'],210);await ready('quiet');
      check(selected()==='quiet',`${theme}: rapid switches leave only the final target`);
      // A late native result may finish after a more recent successful query.
      word('plans').click();await sleep(50);word('ready').click();await ready('ready');await sleep(500);
      check(selected()==='ready',`${theme}: stale completion cannot replace the latest query`);

    }
  }catch(error){report.errors.push(String(error));}
  finally{document.documentElement.dataset.theme=originalTheme??'ocean';report.completed=true;await writeTextFile('mac-release-lookup-motion.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});const status=document.createElement('p');status.textContent=`查词验收：${report.checks.length} 通过，${report.errors.length} 问题`;status.style.cssText='position:fixed;right:20px;top:40px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)';document.body.append(status);}
  return report;
}
