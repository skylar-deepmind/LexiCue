import {chapterIds} from './experience-copy.mjs';
export function routeInfo(){const path=location.pathname,requested=path.match(/\/(zh|ja|de)(?:\/|$)/)?.[1]||new URLSearchParams(location.search).get('lang'),explicitLocale=['en','zh','ja','de'].includes(requested);const locale=explicitLocale?requested:'en';const chapter=path.match(/\/guide\/([^/]+)/)?.[1]||new URLSearchParams(location.search).get('chapter');const base=path.replace(/(?:(?:zh|ja|de)\/)?guide\/.*$/,'').replace(/(?:zh|ja|de)\/(?:index\.html)?$|index\.html$/,'');return {locale,explicitLocale,chapter:chapterIds.includes(chapter)?chapter:null,base:base.endsWith('/')?base:base+'/'};}
export function homeUrl(locale:string){if(import.meta.env.DEV)return '/?lang='+locale;return routeInfo().base+(locale==='en'?'':locale+'/');}
export function guideUrl(locale:string,chapter='quick-start'){return import.meta.env.DEV?'/?lang='+locale+'&chapter='+chapter:homeUrl(locale)+'guide/'+chapter+'/';}
export function localizedUrl(locale:string){const route=routeInfo();return (route.chapter?guideUrl(locale,route.chapter):homeUrl(locale))+location.hash;}
export function assetUrl(path:string){return (import.meta.env.DEV?'/':routeInfo().base)+path;}

export function experienceUrl(locale:string,module:string){const home=homeUrl(locale);return home+(home.includes('?')?'&':'?')+'demo='+module+'#experience';}
