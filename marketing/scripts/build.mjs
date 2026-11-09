import {build} from 'vite';
import {writeSampleSubtitles} from './sample-subtitles.mjs';
import {readFile,writeFile,mkdir,cp,readdir,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {screenshotPath,currentCopy} from '../src/current-copy.mjs';
import {copy,locales,siteUrl,repoUrl} from '../src/catalogue.mjs';
import {experienceCopy,guides} from '../src/experience-copy.mjs';
import {manualCopy} from '../src/manual-copy.mjs';
import {manualContent,manualLabels} from '../src/manual-content.mjs';
import {renderManualSections,renderManualToc} from '../src/manual-render.mjs';
const root=resolve(import.meta.dirname,'..'),docs=resolve(root,'../docs');
const version=JSON.parse(await readFile(resolve(root,'../package.json'),'utf8')).version;
await build({root,configFile:resolve(root,'vite.config.mjs')});
await mkdir(resolve(root,'generated'),{recursive:true});
const cssFile=(await readdir(resolve(root,'dist/_marketing'))).find(f=>f.endsWith('.css'));
await cp(resolve(root,'dist/_marketing',cssFile),resolve(root,'generated/scene.css'));
// The outer site uses system fonts. The separate demo build owns product fonts.
const cssPath=resolve(root,'dist/_marketing',cssFile);
await writeFile(cssPath,(await readFile(cssPath,'utf8')).replace(/@font-face\s*\{[^}]*\}/g,''));
if(cssFile!=='style.css')await rename(cssPath,resolve(root,'dist/_marketing/style.css'));
await cp(resolve(root,'public/lexicue-icon.png'),resolve(docs,'lexicue-icon.png'));
await rm(resolve(docs,'_marketing'),{recursive:true,force:true});
await cp(resolve(root,'dist/_marketing'),resolve(docs,'_marketing'),{recursive:true});
await writeSampleSubtitles();
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const pages=[];
for(const locale of locales){
 const c=copy[locale],u=experienceCopy[locale],v=currentCopy[locale],prefix=locale==='en'?'':locale+'/',home=siteUrl+prefix,folder=locale==='en'?docs:resolve(docs,locale);
 for(const item of [{kind:'workspace'},...guides[locale].map(chapter=>({kind:'guide',chapter})),{kind:'download'},{kind:'support'}]){
  const {kind,chapter}=item,tail=chapter?'guide/'+chapter.id+'/':kind==='workspace'?'':kind+'/';
  const depth=(chapter?2:kind==='workspace'?0:1)+(locale==='en'?0:1),base='../'.repeat(depth)||'./',linkHome=base+prefix,url=home+tail;
  const navLinks=`<a href="${linkHome}"${kind==='workspace'?' aria-current="page"':''}>${v.workspace}</a><a href="${linkHome}guide/quick-start/"${chapter?' aria-current="page"':''}>${u.manual}</a><a href="${linkHome}download/"${kind==='download'?' aria-current="page"':''}>${v.download}</a><a href="${linkHome}support/"${kind==='support'?' aria-current="page"':''}>${v.support}</a>`;
  const header=`<header class="site-nav"><a class="brand" href="${linkHome}"><img src="${base}lexicue-icon.png" width="34" height="34" alt="">LexiCue</a><nav aria-label="LexiCue">${navLinks}</nav><div class="nav-tools"><div class="language-switch">${locales.map(l=>`<a href="${base}${l==='en'?'':l+'/'}${tail}" lang="${l}">${l.toUpperCase()}</a>`).join('')}</div><details class="site-nav-mobile"><summary>${manualLabels[locale].menu}</summary><nav aria-label="LexiCue">${navLinks}</nav></details></div></header>`;
  const chapterNav=chapter?`<nav>${guides[locale].map((g,i)=>`<span>${[0,1,6].includes(i)?`<strong class="doc-nav-group">${manualLabels[locale].groups[i===0?0:i===1?1:2]}</strong>`:''}<a href="${linkHome}guide/${g.id}/"${g.id===chapter.id?' aria-current="page"':''}>${g.title}</a></span>`).join('')}</nav>`:'';
  const manual=chapter?`<main id="main" class="manual-layout"><aside class="manual-sidebar"><h2>${u.manual}</h2>${chapterNav}</aside><article class="manual-article"><details class="manual-mobile-menu"><summary>${u.chapters}</summary>${chapterNav}</details><h1>${chapter.title}</h1><p class="manual-intro">${manualContent[locale][chapter.id].intro}</p><details class="doc-mobile-toc"><summary>${manualLabels[locale].toc}</summary><nav>${renderManualToc(locale,chapter.id)}</nav></details><div class="doc-body">${renderManualSections(locale,chapter.id,linkHome,base)}</div><nav class="manual-chapter-links">${guides[locale].filter((g,i)=>Math.abs(i-guides[locale].findIndex(g=>g.id===chapter.id))===1).map(g=>`<a href="${linkHome}guide/${g.id}/">${g.title}</a>`).join('')}</nav></article><aside class="doc-toc"><h2>${manualLabels[locale].toc}</h2><nav>${renderManualToc(locale,chapter.id)}</nav></aside></main>`:'';
  const workspace=`<main id="main" class="workspace-main"><h1 class="sr-only">${v.workspace}</h1><section id="experience" class="live-workspace" aria-label="${v.workspace}"><iframe class="live-app-frame" src="${base}_demo/index.html?locale=${locale}&amp;theme=ocean" title="${v.onlineApp}" allow="clipboard-read; clipboard-write"></iframe></section><noscript><style>.live-workspace{display:none}</style><p class="workspace-noscript">${v.javascript} <a href="${linkHome}guide/quick-start/">${u.manual}</a></p></noscript><section id="download" class="workspace-download"><p>${v.downloadSummary}</p><div class="workspace-actions"><a href="${linkHome}download/">${v.download}</a></div></section></main>`;
  const download=`<main id="main" class="site-page download-page"><h1>${v.download}</h1><p>${c.installBody}</p><div class="download-grid">${['macOS','Windows','Android'].map((platform,i)=>`<a href="${repoUrl}/releases/latest"><h3>${platform}</h3><p>${['DMG / app.tar.gz','x64 · EXE','arm64 · APK'][i]}</p><span>${c.download}</span></a>`).join('')}</div><p class="release-note">${c.releaseNote}</p><p><a class="current-source" href="${repoUrl}/tree/main">${v.source}</a></p><p class="install-note">${c.installNote} <a href="${repoUrl}/blob/main/DISTRIBUTION.md">${c.installGuide}</a></p></main>`;
  const support=`<main id="main" class="site-page support-page"><h1>${v.support}</h1><p>${v.supportBody}</p><div class="support-links">${locale==='zh'?'':`<a href="https://www.patreon.com/16942122/join" target="_blank" rel="noopener noreferrer">Patreon</a>`}<a href="https://www.ifdian.net/a/skylar-lexicue" target="_blank" rel="noopener noreferrer">爱发电 / Aifadian</a><a href="${repoUrl}" target="_blank" rel="noopener noreferrer">GitHub</a></div></main>`;
  const staticContent=header+(chapter?manual:kind==='download'?download:kind==='support'?support:workspace);
  const structured=chapter?{'@context':'https://schema.org','@type':'TechArticle',headline:chapter.title,description:manualCopy[locale].descriptions[chapter.id],inLanguage:locale==='zh'?'zh-CN':locale,url,isPartOf:{'@type':'WebSite',name:'LexiCue',url:home}}:{'@context':'https://schema.org','@type':'SoftwareApplication',name:'LexiCue',url,applicationCategory:'EducationApplication',operatingSystem:'macOS, Windows, Android',softwareVersion:version+' (main, unreleased)',offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},license:repoUrl+'/blob/main/LICENSE',inLanguage:['en','zh-CN','ja','de'],featureList:c.titles};
  const title=(chapter?chapter.title:kind==='workspace'?v.workspace:kind==='download'?v.download:v.support)+' — LexiCue';
  const description=chapter?manualCopy[locale].descriptions[chapter.id]:kind==='workspace'?v.demoNote:kind==='download'?c.installBody:v.supportBody;
  const html=`<!doctype html><html lang="${locale==='zh'?'zh-CN':locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#235ce0"><link rel="canonical" href="${url}">${locales.map(l=>`<link rel="alternate" hreflang="${l==='zh'?'zh-CN':l}" href="${base}${l==='en'?'':l+'/'}${tail}">`).join('')}<link rel="alternate" hreflang="x-default" href="${siteUrl}${tail}"><link rel="icon" href="${base}lexicue-icon.png"><meta property="og:type" content="${chapter?'article':'website'}"><meta property="og:site_name" content="LexiCue"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${siteUrl}${screenshotPath(locale,'reading','ocean')}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="850"><meta property="og:locale" content="${{en:'en_US',zh:'zh_CN',ja:'ja_JP',de:'de_DE'}[locale]}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(structured)}</script><script>try{document.documentElement.dataset.theme=localStorage.getItem('lexicue-marketing-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'midnight':'ocean')}catch(e){document.documentElement.dataset.theme='ocean'}</script><link rel="stylesheet" href="${base}_marketing/style.css"><script type="module" src="${base}_marketing/site.js"></script></head><body><div id="root">${staticContent}</div></body></html>`;
  const target=chapter?resolve(folder,'guide',chapter.id):kind==='workspace'?folder:resolve(folder,kind);await mkdir(target,{recursive:true});await writeFile(resolve(target,'index.html'),html);pages.push(url);
 }
 const index=resolve(folder,'guide');await mkdir(index,{recursive:true});await writeFile(resolve(index,'index.html'),`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=quick-start/"><title>${u.manual} — LexiCue</title><a href="quick-start/">${u.manual}</a></html>`);
}
await writeFile(resolve(docs,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(url=>`<url><loc>${url}</loc></url>`).join('')}</urlset>\n`);
await import('./build-demo.mjs');
console.log(`Built ${pages.length} workspace/download/support/manual pages and the live app demo; technical documents preserved.`);
