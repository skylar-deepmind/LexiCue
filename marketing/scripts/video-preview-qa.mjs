import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {horizontalRevision,verticalRevision,author,videoThemes,closingBoundary,videoDuration} from '../src/video-revision.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-preview'),base='http://127.0.0.1:4190/output/marketing/video-preview/';
await mkdir(resolve(out,'stills'),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],checks=[];
const assert=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
try{
 const page=await browser.newPage({viewport:{width:1984,height:2300}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4190')&&!r.url().startsWith('data:'))errors.push('Unexpected remote request: '+r.url());});
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__lexicueVideoPreview);await page.evaluate(()=>document.fonts.ready);
 await page.addStyleTag({content:'.video-preview-page{max-width:none;padding:0}.preview-player{width:1920px;border:0;border-radius:0}.preview-player-portrait{width:1080px;max-width:none;margin:0}'});
 for(const portrait of [false,true]){
  if(portrait){await page.evaluate(()=>window.__lexicueVideoPreview.format(true));await page.waitForTimeout(100);}
  const timeline=portrait?verticalRevision:horizontalRevision,label=portrait?'vertical':'horizontal';
  assert(timeline[0].start===0&&timeline.at(-1).end===videoDuration(portrait),label+' duration');
  assert(timeline.every((s,i)=>!i||s.start===timeline[i-1].end),label+' contiguous timeline');
  assert(timeline.at(-2).id==='languages',label+' language/theme montage is penultimate');
  for(const scene of timeline){
   const at=scene.start+(scene.end-scene.start)*.64;
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(Math.floor(f*30)),at);await page.waitForTimeout(70);
   assert(await page.locator('.revised-video').count()===1,label+' '+scene.id+' renders');
   assert(await page.locator('.scene-track').count()===0,label+' '+scene.id+' no animation progress strip');
   const bad=await page.locator('.revised-video').evaluate(el=>/\bTXT\b|\bVTT\b/.test(el.textContent));assert(!bad,label+' '+scene.id+' SRT-only');
   if(await page.locator('.sample-sidebar-nav').count())assert(await page.locator('.sample-sidebar-nav button').count()===5,label+' '+scene.id+' five-item navigation');
   if(!['languages','outro'].includes(scene.id))assert(await page.locator('.revised-video [data-theme="midnight"]').count()===0&&await page.locator('.revised-video').getAttribute('data-theme')==='ocean',label+' '+scene.id+' stays light');
   await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-'+scene.id+'.png')});
  }
  const lookup=timeline.find(s=>s.id==='lookup');await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((lookup.start+(lookup.end-lookup.start)*.42)*30));await page.waitForTimeout(60);
  const dimensions=await page.locator('.sample-detail-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,transform:getComputedStyle(el).transform};});
  assert(portrait?dimensions.width>900:dimensions.width<500,label+' correct drawer axis/layout');
  await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((lookup.start+(lookup.end-lookup.start)*.25)*30));await page.waitForTimeout(60);
  assert(await page.locator('.video-pointer').count()===1,label+' pointer locates meaningful target');
  const pointer=await page.locator('.video-product').evaluate(root=>{const word=[...root.querySelectorAll('[role=button]')].find(el=>el.textContent==='meaningful'),r=word.getBoundingClientRect(),p=root.querySelector('.video-pointer').getBoundingClientRect();return {distance:Math.hypot(p.x-(r.x+r.width/2),p.y-(r.y+r.height/2))};});assert(pointer.distance<90,label+' pointer approaches actual word');
  const outro=timeline.at(-1);await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((outro.start+2)*30));await page.waitForTimeout(90);
  assert(await page.locator('.video-author-avatar').first().evaluate(el=>el.complete&&el.naturalWidth>0),label+' author avatar loaded');
  assert(await page.locator('.video-author-link').first().getAttribute('href')===author.url,label+' verified author link');
  assert(await page.locator('.video-outro h1').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>80),label+' outro heading readable at export size');
  const overflow=await page.locator('.video-author').first().evaluate(el=>{const card=el.getBoundingClientRect(),video=el.closest('.revised-video').getBoundingClientRect();return card.right>video.right||card.bottom>video.bottom;});assert(!overflow,label+' author card fits');
  await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-outro.png')});
  const montage=timeline.at(-2);
  for(const [i,theme] of videoThemes.entries()){
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.floor((montage.start+(montage.end-montage.start)*(i===4?.9:i*.16+.08))*30));await page.waitForTimeout(60);
   assert(await page.locator('.revised-video').getAttribute('data-theme')===theme,label+' theme montage '+theme);
   assert(await page.locator('.video-theme-ribbon [data-selected=true]').getAttribute('data-video-theme')===theme,label+' selected swatch '+theme);
   await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-theme-'+theme+'.png')});
  }
  for(const [name,offset] of [['white',0],['split',1],['settled',2],['last',outro.end-outro.start-1/30]]){
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((outro.start+offset)*30));await page.waitForTimeout(60);
   assert(await page.locator('[data-ending-layer=ocean]').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(255, 255, 255)',label+' ending has pure white base '+name);
   const clip=await page.locator('[data-ending-layer=midnight]').evaluate(el=>getComputedStyle(el).clipPath);assert(clip.startsWith('polygon('),label+' ending uses a moving clip '+name);
   await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-outro-'+name+'.png')});
  }
  assert(closingBoundary(0,portrait).center>1&&Math.abs(closingBoundary(60,portrait).center-.5)<.02,label+' white transitions to balanced split');
  assert(closingBoundary(60,portrait).clip!==closingBoundary(Math.round((outro.end-outro.start)*30)-1,portrait).clip,label+' boundary keeps moving until final frame');
 }
 for(const theme of ['ocean','midnight'])for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:1100});await page.goto(base,{waitUntil:'networkidle'});
  if(theme==='midnight')await page.getByRole('button',{name:'切换预览页亮暗模式'}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),theme+' '+width+' preview responsive');
  await page.getByRole('button',{name:'播放预览',exact:true}).click();await page.waitForTimeout(300);assert(await page.evaluate(()=>window.__lexicueVideoPreview.frame()>0),theme+' '+width+' preview plays');await page.getByRole('button',{name:'暂停',exact:true}).click();
  const before=await page.evaluate(()=>window.__lexicueVideoPreview.frame());await page.waitForTimeout(150);assert(await page.evaluate(()=>window.__lexicueVideoPreview.frame())===before,theme+' '+width+' pause holds frame');
 }
 assert(errors.length===0,'No browser errors, missing assets or external service requests');
 await writeFile(resolve(out,'qa.json'),JSON.stringify({checks:checks.length,errors,results:checks},null,2));console.log('Video preview QA passed: '+checks.length+' checks');
}finally{await browser.close();}
