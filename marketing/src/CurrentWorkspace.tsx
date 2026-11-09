import {useEffect,useRef,useState} from 'react';
import {currentCopy} from './current-copy.mjs';
import {assetUrl} from './routes';
export function CurrentWorkspace({locale,theme,resetRevision=0,onReady}:{locale:string;theme:string;resetRevision?:number;onReady?:(ready:boolean)=>void}){
 const frame=useRef<HTMLIFrameElement>(null);
 const preferences=useRef({locale,theme});preferences.current={locale,theme};
 // Keep the iframe and its temporary app data when outer language/theme changes.
 const [source]=useState(()=>{const url=new URL(assetUrl('_demo/index.html'),location.href);url.searchParams.set('locale',locale);url.searchParams.set('theme',theme);return url.href;});
 const send=()=>frame.current?.contentWindow?.postMessage({type:'lexicue-demo-preferences',...preferences.current},location.origin);
 useEffect(()=>{send();},[locale,theme]);
 useEffect(()=>{if(resetRevision)frame.current?.contentWindow?.postMessage({type:'lexicue-demo-reset'},location.origin);},[resetRevision]);
 useEffect(()=>{const ready=(event:MessageEvent)=>{if(event.origin===location.origin&&event.source===frame.current?.contentWindow&&event.data?.type==='lexicue-demo-ready'){onReady?.(true);send();}};addEventListener('message',ready);return()=>removeEventListener('message',ready);},[]);
 return <section className="live-workspace" id="experience" aria-label={String(currentCopy[locale].workspace)}>
  <iframe ref={frame} className="live-app-frame" src={source} title={String(currentCopy[locale].onlineApp)} allow="clipboard-read; clipboard-write" onLoad={()=>{onReady?.(false);send();}}/>
 </section>;
}
