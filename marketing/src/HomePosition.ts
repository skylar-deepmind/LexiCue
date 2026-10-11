import {useLayoutEffect,useRef,useEffect} from 'react';
import {copy,siteUrl,locales} from './catalogue.mjs';
import {homeUrl,routeInfo} from './routes';
const KEY='lexicue-home-position-v1';
const regions=['top','experience','benefits','manual-entry','privacy','download','home-footer'];
export type HomePosition={region:string;offset:number;inner:number};
export function capturePosition():HomePosition{
 let region='top';for(const id of regions){const node=document.getElementById(id);if(node&&node.getBoundingClientRect().top<=innerHeight*.35)region=id;}
 const node=document.getElementById(region);return {region,offset:scrollY-(node?.getBoundingClientRect().top+scrollY||0),inner:document.querySelector('.sample-content')?.scrollTop||0};
}
function valid(p:any):p is HomePosition{return p&&regions.includes(p.region)&&Number.isFinite(p.offset)&&Number.isFinite(p.inner);}
function restore(p:HomePosition){const node=document.getElementById(p.region)||(['manual-entry','privacy'].includes(p.region)?document.getElementById('download'):null);if(!node)return;const inner=document.querySelector('.sample-content');if(inner)inner.scrollTop=p.inner;window.scrollTo({top:node.getBoundingClientRect().top+scrollY+p.offset,behavior:'instant'});}
function remember(p:HomePosition){history.replaceState({...history.state,lexicueHome:p},'');try{sessionStorage.setItem(KEY,JSON.stringify({url:location.pathname+location.search+location.hash,position:p}));}catch{}}
export function useHomePosition(enabled:boolean,locale:string,onLocale:(locale:string)=>void){
 const pending=useRef<HomePosition|null>(null),restoring=useRef(false),initialized=useRef(false),currentLocale=useRef(locale);currentLocale.current=locale;
 useLayoutEffect(()=>{
  if(!enabled)return;const previous=history.scrollRestoration;history.scrollRestoration='manual';restoring.current=true;
  let position=history.state?.lexicueHome;const type=(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type;
  if(!valid(position)&&type!=='navigate'){try{const record=JSON.parse(sessionStorage.getItem(KEY));if(record?.url===location.pathname+location.search+location.hash)position=record.position;}catch{}}
  const frame=requestAnimationFrame(()=>{if(valid(position))restore(position);else if(location.hash&&!location.hash.startsWith('#feature-'))document.getElementById(location.hash.slice(1))?.scrollIntoView({behavior:'instant'});remember(capturePosition());initialized.current=true;restoring.current=false;});
  const save=()=>{if(initialized.current&&!restoring.current)remember(capturePosition());};
  const pop=()=>{pending.current=valid(history.state?.lexicueHome)?history.state.lexicueHome:null;restoring.current=true;const next=routeInfo().locale;if(next!==currentLocale.current)onLocale(next);requestAnimationFrame(()=>{if(pending.current){restore(pending.current);pending.current=null;}else if(location.hash)document.getElementById(location.hash.slice(1))?.scrollIntoView({behavior:'instant'});restoring.current=false;save();});};
  document.addEventListener('scroll',save,true);addEventListener('pagehide',save);addEventListener('popstate',pop);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('scroll',save,true);removeEventListener('pagehide',save);removeEventListener('popstate',pop);history.scrollRestoration=previous;};
 },[enabled,onLocale]);
 useLayoutEffect(()=>{if(!enabled||!pending.current)return;const position=pending.current;pending.current=null;restore(position);requestAnimationFrame(()=>{restore(position);restoring.current=false;remember(capturePosition());});},[enabled,locale]);
 useEffect(()=>{if(!enabled)return;const c=copy[locale],url=siteUrl+(locale==='en'?'':locale+'/');document.title='LexiCue — '+c.tag;for(const selector of ['meta[name=description]','meta[property="og:description"]'])document.querySelector(selector)?.setAttribute('content',c.intro);for(const selector of ['meta[property="og:title"]'])document.querySelector(selector)?.setAttribute('content',document.title);document.querySelector('link[rel=canonical]')?.setAttribute('href',url);document.querySelector('meta[property="og:url"]')?.setAttribute('content',url);document.querySelector('meta[property="og:image"]')?.setAttribute('content',siteUrl+'media/'+locale+'/social.png');document.querySelector('meta[property="og:locale"]')?.setAttribute('content',({en:'en_US',zh:'zh_CN',ja:'ja_JP',de:'de_DE'})[locale]);const schema=document.querySelector('script[type="application/ld+json"]');if(schema){try{const data=JSON.parse(schema.textContent);data.url=url;data.featureList=c.titles;schema.textContent=JSON.stringify(data);}catch{}}},[enabled,locale]);
 const switchLocale=(next:string)=>{if(!locales.includes(next))return;if(next===locale){history.replaceState({...history.state,lexicueLocale:next},'');onLocale(next);return;}const position=capturePosition();remember(position);pending.current=position;restoring.current=true;const url=new URL(homeUrl(next),location.href);const params=new URLSearchParams(location.search);params.delete('lang');params.delete('demo');for(const [k,v] of params)url.searchParams.set(k,v);url.hash=location.hash;history.pushState({lexicueHome:position,lexicueLocale:next},'',url.pathname+url.search+url.hash);onLocale(next);};
 const anchor=(event:any,id:string)=>{if(!enabled||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();remember(capturePosition());history.pushState({},'',location.pathname+location.search+'#'+id);document.getElementById(id)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});};
 return {switchLocale,anchor};
}
