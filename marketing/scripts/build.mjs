import {build} from 'vite';
import {writeSampleSubtitles} from './sample-subtitles.mjs';
import {readFile,writeFile,mkdir,cp,readdir,rename,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
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
if(cssFile!=='style.css')await rename(resolve(root,'dist/_marketing',cssFile),resolve(root,'dist/_marketing/style.css'));
await rm(resolve(docs,'_marketing/index.css'),{force:true});
await cp(resolve(root,'public/lexicue-icon.png'),resolve(docs,'lexicue-icon.png'));
// Only the generated marketing asset directory is replaced; technical docs and media stay intact.
await rm(resolve(docs,'_marketing'),{recursive:true,force:true});
await cp(resolve(root,'dist/_marketing'),resolve(docs,'_marketing'),{recursive:true});
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
await writeSampleSubtitles();
const pages=[];
for(const locale of locales){
 const c=copy[locale],u=experienceCopy[locale],prefix=locale==='en'?'':locale+'/',home=siteUrl+prefix,folder=locale==='en'?docs:resolve(docs,locale);
 for(const chapter of [null,...guides[locale]]){
 const base=chapter?(locale==='en'?'../../':'../../../'):locale==='en'?'./':'../';
 const linkHome=base+prefix;
 const route=prefix+(chapter?'guide/'+chapter.id+'/':''),url=siteUrl+route;
 const navLinks=`<a href="${linkHome}#experience">${u.experience}</a><a href="${linkHome}guide/quick-start/">${u.manual}</a><a href="${linkHome}#download">${c.download}</a><a href="https://www.ifdian.net/a/skylar-lexicue" target="_blank" rel="noopener noreferrer">${c.support}</a>`;
 const header=`<header class="site-nav"><a class="brand" href="${linkHome}"><img src="${base}lexicue-icon.png" width="34" height="34" alt="">LexiCue</a><nav aria-label="LexiCue">${navLinks}</nav><div class="nav-tools"><div class="language-switch">${locales.map(l=>`<a href="${base}${l==='en'?'':l+'/'}${chapter?'guide/'+chapter.id+'/':''}" lang="${l}">${l.toUpperCase()}</a>`).join('')}</div><details class="site-nav-mobile"><summary>${manualLabels[locale].menu}</summary><nav aria-label="LexiCue">${navLinks}</nav></details></div></header>`;
 const image=(name,alt)=>`<img src="${base}media/${locale}/guide-${name}.webp" width="${guides[locale].find(g=>g.id===name)?.imageSize.width||1100}" height="${guides[locale].find(g=>g.id===name)?.imageSize.height||780}" alt="${esc(alt)}" style="width:100%;height:auto" loading="lazy">`;
 const downloads=`<section class="download-block" id="download"><h2>${c.installTitle}</h2><p>${c.installBody}</p><div class="cta-row"><a href="${repoUrl}/releases/latest" class="primary-link">${c.download}</a></div><p>${c.installNote}</p><a href="${repoUrl}/blob/main/DISTRIBUTION.md">${c.installGuide}</a></section>`;
 const chapterNav=chapter?`<nav>${guides[locale].map((g,i)=>`<span>${[0,1,6].includes(i)?`<strong class="doc-nav-group">${manualLabels[locale].groups[i===0?0:i===1?1:2]}</strong>`:''}<a href="${linkHome}guide/${g.id}/"${g.id===chapter.id?' aria-current="page"':''}>${g.title}</a></span>`).join('')}</nav>`:'';
 const manualPage=chapter?`<main id="main" class="manual-layout"><aside class="manual-sidebar"><h2>${u.manual}</h2>${chapterNav}</aside><article class="manual-article"><details class="manual-mobile-menu"><summary>${u.chapters}</summary>${chapterNav}</details><h1>${chapter.title}</h1><p class="manual-intro">${manualContent[locale][chapter.id].intro}</p><details class="doc-mobile-toc"><summary>${manualLabels[locale].toc}</summary><nav>${renderManualToc(locale,chapter.id)}</nav></details><div class="doc-body">${renderManualSections(locale,chapter.id,linkHome,base)}</div><nav class="manual-chapter-links">${guides[locale].filter((g,i)=>Math.abs(i-guides[locale].findIndex(item=>item.id===chapter.id))===1).map(g=>`<a href="${linkHome}guide/${g.id}/">${g.title}</a>`).join('')}</nav></article><aside class="doc-toc"><h2>${manualLabels[locale].toc}</h2><nav>${renderManualToc(locale,chapter.id)}</nav></aside></main>`:'';
 const staticContent=header+(chapter?manualPage:`<main id="main"><section class="hero" id="top"><p class="eyebrow">${c.eyebrow}</p><h1>${c.hero[0]}<br>${c.hero[1]}</h1><p class="hero-intro">${c.intro}</p><div class="cta-row"><a class="primary-link" href="${repoUrl}/releases/latest">${c.download}</a><a class="secondary-link" href="${linkHome}guide/quick-start/">${u.manual}</a></div><div id="experience">${image('files',u.files+' — '+u.sample)}<p class="manual-note">${u.websiteVsApp}</p></div></section>${downloads}</main>`);
 const structured=chapter?{'@context':'https://schema.org','@type':'TechArticle',headline:chapter.title,description:manualCopy[locale].descriptions[chapter.id],inLanguage:locale==='zh'?'zh-CN':locale,url,isPartOf:{'@type':'WebSite',name:'LexiCue',url:home}}:{'@context':'https://schema.org','@type':'SoftwareApplication',name:'LexiCue',url,applicationCategory:'EducationApplication',operatingSystem:'macOS, Windows, Android',softwareVersion:version,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},license:repoUrl+'/blob/main/LICENSE',inLanguage:['en','zh-CN','ja','de'],featureList:c.titles};
 const title=chapter?chapter.title+' — LexiCue': 'LexiCue — '+c.tag,description=chapter?manualCopy[locale].descriptions[chapter.id]:c.intro;
 const html=`<!doctype html><html lang="${locale==='zh'?'zh-CN':locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#235ce0"><link rel="canonical" href="${url}">${locales.map(l=>`<link rel="alternate" hreflang="${l==='zh'?'zh-CN':l}" href="${base}${l==='en'?'':l+'/'}${chapter?'guide/'+chapter.id+'/':''}">`).join('')}<link rel="alternate" hreflang="x-default" href="${siteUrl}${chapter?'guide/'+chapter.id+'/':''}"><link rel="icon" href="${base}lexicue-icon.png"><meta property="og:type" content="${chapter?'article':'website'}"><meta property="og:site_name" content="LexiCue"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${siteUrl}media/${locale}/social.png"><meta property="og:locale" content="${{en:'en_US',zh:'zh_CN',ja:'ja_JP',de:'de_DE'}[locale]}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(structured)}</script><script>try{document.documentElement.dataset.theme=localStorage.getItem('lexicue-marketing-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'midnight':'ocean')}catch(e){document.documentElement.dataset.theme='ocean'}</script><link rel="stylesheet" href="${base}_marketing/style.css"><script type="module" src="${base}_marketing/site.js"></script></head><body><div id="root">${staticContent}</div></body></html>`;
 const target=chapter?resolve(folder,'guide',chapter.id):folder;await mkdir(target,{recursive:true});await writeFile(resolve(target,'index.html'),html);pages.push(url);
 }
 // Convenient manual entry without an SPA server fallback.
 const index=resolve(folder,'guide');await mkdir(index,{recursive:true});await writeFile(resolve(index,'index.html'),`<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=quick-start/"><title>${u.manual} — LexiCue</title><a href="quick-start/">${u.manual}</a></html>`);
}
await writeFile(resolve(docs,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(url=>`<url><loc>${url}</loc></url>`).join('')}</urlset>\n`);
console.log(`Built ${pages.length} static homepage/manual pages; technical documents preserved.`);
