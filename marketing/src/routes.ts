import {chapterIds} from './experience-copy.mjs';
export function routeInfo(){
 const path=location.pathname.replace(/index\.html$/,''),params=new URLSearchParams(location.search);
 const chapterMatch=path.match(/\/guide\/([^/]+)\/?$/),pageMatch=path.match(/\/(download|support)\/?$/);
 const marker=chapterMatch?.index??pageMatch?.index;
 const prefix=marker===undefined?path:path.slice(0,marker+1);
 const pathLocale=prefix.match(/\/(zh|ja|de)\/?$/)?.[1];
 const requested=pathLocale||params.get('lang'),explicitLocale=['en','zh','ja','de'].includes(requested);
 const locale=explicitLocale?requested:'en',requestedChapter=chapterMatch?.[1]||params.get('chapter');
 const chapter=chapterIds.includes(requestedChapter)?requestedChapter:null;
 const requestedPage=pageMatch?.[1]||params.get('page');
 const page=chapter?'guide':['download','support'].includes(requestedPage)?requestedPage:'workspace';
 const base=prefix.replace(/(?:zh|ja|de)\/?$/,'');
 return {locale,explicitLocale,chapter,page,base:base.endsWith('/')?base:base+'/'};
}
export function homeUrl(locale:string){return import.meta.env.DEV?'/?lang='+locale:routeInfo().base+(locale==='en'?'':locale+'/');}
export function guideUrl(locale:string,chapter='quick-start'){return import.meta.env.DEV?'/?lang='+locale+'&chapter='+chapter:homeUrl(locale)+'guide/'+chapter+'/';}
export function pageUrl(locale:string,page='workspace'){return page==='workspace'?homeUrl(locale):import.meta.env.DEV?'/?lang='+locale+'&page='+page:homeUrl(locale)+page+'/';}
export function localizedUrl(locale:string){const route=routeInfo();return (route.chapter?guideUrl(locale,route.chapter):pageUrl(locale,route.page))+location.hash;}
export function assetUrl(path:string){return (import.meta.env.DEV?'/':routeInfo().base)+path;}
export function experienceUrl(locale:string,_module?:string){return homeUrl(locale)+'#experience';}
