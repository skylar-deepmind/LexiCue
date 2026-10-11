import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {guides} from '../src/experience-copy.mjs';
import {manualContent,manualLabels} from '../src/manual-content.mjs';
import {initialSession,SESSION_KEY} from '../src/demo-model.mjs';
const base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/',out=resolve(import.meta.dirname,'../../output/marketing/qa/manual');await mkdir(out,{recursive:true});
let checks=0;const errors=[],missing=[],remote=[];const check=(v,m)=>{assert.ok(v,m);checks++;};
const browser=await chromium.launch({channel:'chrome',headless:true});
const observe=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:')&&!r.url().startsWith('data:'))remote.push(r.url());});};
const contrast=locator=>locator.evaluate(el=>{const rgb=s=>s.match(/[\d.]+/g)?.slice(0,3).map(Number);const luminance=s=>rgb(s).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);let node=el,bg;while(node){bg=getComputedStyle(node).backgroundColor;if(bg!=='transparent'&&bg!=='rgba(0, 0, 0, 0)')break;node=node.parentElement;}const a=luminance(getComputedStyle(el).color),b=luminance(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
try{
 for(const locale of ['en','zh','ja','de'])for(const theme of ['ocean','midnight'])for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});observe(page);await page.addInitScript(t=>localStorage.setItem('lexicue-marketing-theme',t),theme);
  for(const chapter of guides[locale]){
   const url=base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/';await page.goto(url,{waitUntil:'networkidle'});const data=manualContent[locale][chapter.id];
   check(await page.locator('h1').textContent()===chapter.title,'localized chapter title');check(await page.locator('.doc-section').count()===data.sections.length,'all task sections rendered');check(await page.locator('.sandbox,.manual-animation,.manual-demo-controls').count()===0,'no repeated online demo');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
   check(await page.locator(width<=650?'.manual-mobile-menu':'.manual-sidebar').isVisible(),'responsive chapter navigation');
   const toc=page.locator(width<=1200?'.doc-mobile-toc':'.doc-toc');check(await toc.isVisible(),'responsive page contents');if(width<=1200)await toc.locator('summary').click();
   await toc.locator('a').last().click();check(await page.locator('.doc-section').last().evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.site-nav').getBoundingClientRect().bottom-1),'anchor clears fixed navigation');
   check(await contrast(page.locator('.manual-intro'))>=4.5,'intro contrast');check(await contrast(page.locator('.doc-section h2').first())>=4.5,'heading contrast');
   const selected=page.locator(width<=650?'.manual-mobile-menu [aria-current=page]':'.manual-sidebar [aria-current=page]');if(width<=650)await page.locator('.manual-mobile-menu summary').click();check(await contrast(selected)>=4.5,'selected chapter contrast');await page.keyboard.press('Tab');await selected.focus();check(await selected.evaluate(el=>el.matches(':focus-visible')&&parseFloat(getComputedStyle(el).outlineWidth)>=2),'keyboard focus');
   if(width<=1000)await page.locator('.site-nav-mobile summary').click();const nav=page.locator(width<=1000?'.site-nav-mobile nav':'.site-nav>nav');check(await nav.locator('a').count()===4,'four public navigation links');check(await nav.locator('a[href$="#experience"]').count()===1,'online experience available');check(await nav.locator('a[href="https://www.ifdian.net/a/skylar-lexicue"]').getAttribute('target')==='_blank','author support opens new tab');
   if(width<=1000){await page.keyboard.press('Escape');check(await page.locator('.site-nav-mobile').getAttribute('open')===null,'menu escape');}
   if(data.sections.some(s=>s.image)){
    const figure=page.locator('[data-doc-image]').first();await figure.scrollIntoViewIfNeeded();const displayed=figure.locator(theme==='midnight'?'.doc-image-dark':'.doc-image-light');check(await displayed.evaluate(img=>img.complete&&img.naturalWidth>0),'screenshot loads in correct theme');await figure.click();check(await page.locator('.doc-lightbox').evaluate(el=>el.open&&el.matches(':modal')),'image opens as modal');check(await page.locator('.doc-lightbox img').getAttribute('src').then(src=>src.includes(theme==='midnight'?'-midnight.webp':'.webp')),'enlarged image theme');await page.keyboard.press('Escape');check(await page.locator('.doc-lightbox').count()===0,'image closes with escape');await page.waitForFunction(()=>document.activeElement?.matches('[data-doc-image]'));check(await figure.evaluate(el=>el===document.activeElement),'image focus restored');
   }
   if(chapter.id==='files'&&(width===390||width===1440)&&locale==='zh')await page.screenshot({path:resolve(out,`docs-${locale}-${theme}-${width}.png`),fullPage:true});
   if(chapter.id==='settings')check(await page.locator('.doc-section').count()===9,'all nine installed settings');
  }
  await page.close();console.log(`Documentation verified: ${locale}/${theme}/${width}`);
 }
 // Every static page remains useful without JavaScript.
 for(const locale of ['en','zh','ja','de']){const page=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:1000}});observe(page);for(const chapter of guides[locale]){await page.goto(base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/');check(await page.locator('.doc-section').count()===manualContent[locale][chapter.id].sections.length,'no-script complete body');check(await page.locator('h1').textContent()===chapter.title,'no-script title');await page.locator('.site-nav-mobile summary').click();check(await page.locator('.site-nav-mobile nav a').count()===4,'no-script mobile navigation');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no-script width');}await page.close();}
 const page=await browser.newPage({viewport:{width:1440,height:1000}});observe(page);await page.goto(base+'zh/guide/settings/#ai',{waitUntil:'networkidle'});await page.locator('.language-switch a[lang=de]').click();check(page.url().includes('/de/guide/settings/#ai'),'language preserves chapter and section');await page.reload();check(page.url().endsWith('/settings/#ai'),'direct route refresh');
 const sample=initialSession();sample.module='vocabulary';sample.tags[0]={id:1,name:'Saved tag'};sample.statuses[3]='known';sample.uiLocale='ja';sample.theme='sage';await page.evaluate(({key,value})=>sessionStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:sample});await page.goto(base+'zh/guide/files/',{waitUntil:'networkidle'});check(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).statuses[3],SESSION_KEY)==='known','documentation preserves sample records');await page.locator('.site-nav>nav a[href$="#experience"]').click();await page.locator('.sandbox').waitFor();check(await page.locator('.sandbox').getAttribute('data-module')==='vocabulary','return retains selected module');check(await page.locator('.sandbox').getAttribute('data-theme')==='sage','return retains product theme');check(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).tags[0].name,SESSION_KEY)==='Saved tag','return retains tag edits');await page.close();
 check(errors.length===0,JSON.stringify(errors));check(missing.length===0,JSON.stringify(missing));check(remote.length===0,JSON.stringify(remote));
 await writeFile(resolve(out,'report.json'),JSON.stringify({checks,errors,missing,remote},null,2));console.log(`${checks} product-documentation browser checks passed.`);
}finally{await browser.close();}
