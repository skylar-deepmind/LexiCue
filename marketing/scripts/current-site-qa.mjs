// Browser acceptance for the current screenshot gallery and installed-product guide.
// Reuse an existing Ego TaskSpace during collaborative work; standalone runs own one.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {manualContent} from '../src/manual-content.mjs';
import {guides} from '../src/experience-copy.mjs';
import {screenshotScenes,currentCopy} from '../src/current-copy.mjs';
const root=resolve(import.meta.dirname,'../..');
const config={space:process.env.LEXICUE_EGO_SPACE?Number(process.env.LEXICUE_EGO_SPACE):null,page:process.env.LEXICUE_EGO_PAGE||'p1',base:process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/',mode:process.env.LEXICUE_SITE_QA_MODE||'all',locales:(process.env.LEXICUE_QA_LOCALES||'en,zh,ja,de').split(','),themes:(process.env.LEXICUE_QA_THEMES||'ocean,midnight').split(','),widths:(process.env.LEXICUE_QA_WIDTHS||'390,768,1440').split(',').map(Number),out:resolve(root,'output/marketing/qa/current-site'),manualContent,guides,screenshotScenes,currentCopy};
const browserScript=cfg=>`
const cfg=${JSON.stringify(cfg)};
const fs=await import('node:fs/promises');await fs.mkdir(cfg.out,{recursive:true});
const task=await taskSpace(cfg.space||'LexiCue current website acceptance'),page=task.page(cfg.page);
await page.cdp('Emulation.setScriptExecutionDisabled',{value:false});
const homeFor=locale=>cfg.base+(locale==='en'?'?lang=en':locale+'/');
let checks=0,stage='start';const results=[];const check=(value,label)=>{if(!value)throw Error(label);checks++;};
const observe=async()=>page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,errors:performance.getEntriesByType('resource').filter(r=>r.responseStatus>=400).map(r=>r.name),remote:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith(location.origin)&&!r.name.startsWith('data:')).map(r=>r.name)}));
const contrast=async(selector)=>page.evaluate(selector=>{const el=document.querySelector(selector);const lum=s=>{const n=s.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return n[0]*.2126+n[1]*.7152+n[2]*.0722;};let p=el,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(bg!=='transparent'&&bg!=='rgba(0, 0, 0, 0)')break;p=p.parentElement;}const a=lum(getComputedStyle(el).color),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);},selector);
for(const locale of cfg.locales)for(const theme of cfg.themes)for(const width of cfg.widths){
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<650});
 await page.goto(homeFor(locale));await page.evaluate(theme=>localStorage.setItem('lexicue-marketing-theme',theme),theme);await page.reload();
 await page.waitForSelector('.current-scenes button');
 if(cfg.mode!=='manual'){
  check(await page.evaluate(()=>document.querySelectorAll('.sandbox').length===0),'retired sample removed');
  check(await page.evaluate(()=>document.querySelectorAll('.current-feature-grid article').length===10),'all current features visible');
  for(let i=0;i<cfg.screenshotScenes.length;i++){
   stage=locale+'/'+theme+'/'+width+'/gallery/'+cfg.screenshotScenes[i];const selector='.current-scenes button:nth-of-type('+(i+1)+')';
   await page.focus(selector);await page.keyboard.press('Space');
   const expected='media/current/'+locale+'/'+cfg.screenshotScenes[i]+'-'+theme+'-'+(width<=650?'mobile':'desktop')+'.webp';
   await page.waitForFunction(expected=>{const img=document.querySelector('.current-workspace img');return img?.complete&&img.naturalWidth>0&&img.currentSrc.endsWith(expected);},expected);
   check(await page.evaluate(({selector,expected})=>document.querySelector(selector).getAttribute('aria-pressed')==='true'&&document.querySelector('.current-workspace figure a').href.endsWith(expected),{selector,expected}),'keyboard scene and matching full-size link');
  }
  check(await contrast('.current-scenes button[aria-pressed=true]')>=4.5,'selected control contrast');
  check(await page.evaluate(()=>{const el=document.activeElement;return el.matches('.current-scenes button:focus-visible')&&parseFloat(getComputedStyle(el).outlineWidth)>=2;}),'keyboard focus visible');
  check(await contrast('.current-release')>=4.5,'version note contrast');
  await page.goto(homeFor(locale)+'#feature-sync');await page.waitForSelector('#feature-sync');await page.waitForFunction(()=>{const r=document.querySelector('#feature-sync').getBoundingClientRect(),nav=document.querySelector('.site-nav').getBoundingClientRect();return r.top>=nav.bottom-1&&r.top<innerHeight*.5;});check(true,'direct feature link clears sticky header');
  const state=await observe();check(state.width===width,'requested viewport width');check(!state.overflow,'homepage horizontal overflow');check(!state.errors.length,'homepage missing assets: '+JSON.stringify(state.errors));check(!state.remote.length,'homepage unexpected network request');
  if(locale==='zh'&&(width===390||width===1440)){await page.evaluate(()=>document.querySelector('#experience').scrollIntoView({behavior:'instant',block:'start'}));await page.screenshot({path:cfg.out+'/home-'+locale+'-'+theme+'-'+width+'.png'});}
 }
 if(cfg.mode!=='home')for(const chapter of cfg.guides[locale]){
  stage=locale+'/'+theme+'/'+width+'/manual/'+chapter.id;await page.goto(cfg.base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/');await page.waitForSelector('.doc-section');
  check(await page.evaluate(()=>document.querySelectorAll('.doc-section').length)===cfg.manualContent[locale][chapter.id].sections.length,'complete manual sections');
  const state=await observe();check(!state.overflow,'manual horizontal overflow');check(!state.errors.length,'manual missing assets');
  check(await contrast('.manual-intro')>=4.5,'manual contrast');
  if(cfg.manualContent[locale][chapter.id].sections.some(s=>s.image)){
   const picture='.doc-image-'+(theme==='midnight'?'dark':'light')+' img';
   await page.evaluate(selector=>document.querySelector(selector).scrollIntoView(),picture);
   await page.waitForFunction(selector=>{const img=document.querySelector(selector);return img.complete&&img.naturalWidth>0;},picture);
   await page.click('[data-doc-image]');await page.waitForSelector('.doc-lightbox[open]');
   check(await page.evaluate(()=>document.querySelector('.doc-lightbox img').src).then(src=>src.endsWith(theme+'-'+(width<=650?'mobile':'desktop')+'.webp')),'full-size manual picture matches theme and viewport');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.doc-lightbox'));
   await page.waitForFunction(()=>document.activeElement.matches('[data-doc-image]')).catch(e=>{throw Error('Focus restore: '+stage+'; '+e.message);});check(true,'manual lightbox restores focus');
  }
 }
 results.push({locale,theme,width});console.log('Verified '+locale+'/'+theme+'/'+width+'/'+cfg.mode);
}
// Static content remains useful without JavaScript.
await page.cdp('Emulation.setScriptExecutionDisabled',{value:true});
for(const locale of cfg.locales){await page.goto(homeFor(locale));check(await page.evaluate(()=>document.querySelectorAll('.current-feature-grid article').length===10&&document.querySelector('.current-release').textContent.includes('v0.4.5')),'no-JavaScript feature and version text');if(cfg.mode!=='home')for(const chapter of cfg.guides[locale]){await page.goto(cfg.base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/');check(await page.evaluate(()=>document.querySelectorAll('.doc-section').length)===cfg.manualContent[locale][chapter.id].sections.length,'no-JavaScript complete guide');}}
await page.cdp('Emulation.setScriptExecutionDisabled',{value:false});
await fs.writeFile(cfg.out+'/report-'+cfg.mode+'-'+cfg.locales.join('-')+'-'+cfg.widths.join('-')+'-'+cfg.themes.join('-')+'.json',JSON.stringify({checks,results,scope:'Chromium browser emulation; no native or physical-device acceptance'},null,2));console.log(checks+' current website checks passed.');
`;
function runBrowser(input){
 const result=spawnSync('ego-browser',['nodejs'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Current website browser acceptance failed.');
 return result.stdout;
}
const owned=!config.space;
if(owned){const output=runBrowser("const t=await taskSpace('LexiCue current website acceptance');console.log('QA_SPACE='+t.spaceId);");config.space=Number(output.match(/QA_SPACE=(\d+)/)?.[1]);if(!config.space)throw Error('Ego did not return a task space.');config.page='p1';}
// A complete default run is deliberately several short rounds in the same space.
// Every round re-applies its temporary viewport and verifies one locale/theme/width.
for(const locale of config.locales)for(const theme of config.themes)for(const width of config.widths){
 runBrowser(browserScript({...config,locales:[locale],themes:[theme],widths:[width]}));
}
if(owned)runBrowser(`const t=await taskSpace(${config.space});await t.finish({keep:[]});`);
