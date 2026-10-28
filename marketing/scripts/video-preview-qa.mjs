import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {horizontalRevision,verticalRevision,author,videoThemes,closingBoundary,videoDuration,videoFps} from '../src/video-revision.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-preview'),base='http://127.0.0.1:4190/output/marketing/video-preview/';
await mkdir(resolve(out,'stills'),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],checks=[];
const assert=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
try{
 const page=await browser.newPage({viewport:{width:1984,height:2300}});
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4190')&&!r.url().startsWith('data:'))errors.push('Unexpected remote request: '+r.url());});
 await page.goto(base,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__lexicueVideoPreview);await page.evaluate(()=>document.fonts.ready);
 assert(await page.locator('.preview-chapters button').filter({hasText:'内容来源'}).count()===1,'source scene is directly selectable from storyboard');
 await page.addStyleTag({content:'.video-preview-page{max-width:none;padding:0}.preview-player{width:1920px;border:0;border-radius:0}.preview-player-portrait{width:1080px;max-width:none;margin:0}'});
 for(const portrait of [false,true]){
  if(portrait){await page.evaluate(()=>window.__lexicueVideoPreview.format(true));await page.waitForTimeout(100);}
  const timeline=portrait?verticalRevision:horizontalRevision,label=portrait?'vertical':'horizontal';
  assert(timeline[0].start===0&&timeline.at(-1).end===videoDuration(portrait),label+' duration');
  assert(timeline.every((s,i)=>!i||s.start===timeline[i-1].end),label+' contiguous timeline');
  assert(timeline.at(-2).id==='languages',label+' language/theme montage is penultimate');
  for(let i=1;i<timeline.length;i++){
   const scene=timeline[i],boundary=Math.round(scene.start*videoFps);
   for(const offset of [-12,-6,0,6,11]){
    await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),boundary+offset);await page.waitForTimeout(80);
    assert(await page.locator('.video-transition-stage').count()===1,label+' '+scene.id+' boundary has a transition layer');
    const layers=await page.locator('.video-transition-layer').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {opacity:Number(getComputedStyle(el).opacity),left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
    const seam=portrait?Math.abs(layers[0].bottom-layers[1].top):Math.abs(layers[0].right-layers[1].left);
    assert(layers.length===2&&layers.every(layer=>layer.opacity===1)&&seam<2,label+' '+scene.id+' push transition stays opaque with no gap between scenes');
    if(offset===0&&(i===1||i===timeline.length-1))await page.locator('.video-transition-stage').screenshot({path:resolve(out,'stills',label+'-transition-'+timeline[i-1].id+'-'+scene.id+'.png')});
   }
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),boundary+12);await page.waitForTimeout(80);
   assert(await page.locator('.video-transition-stage').count()===0,label+' '+scene.id+' crossfade settles without a hard-cut gap');
  }
  for(const scene of timeline){
   const at=scene.start+(scene.end-scene.start)*(scene.id==='sources'?.9:.64);
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.floor(at*videoFps));await page.waitForTimeout(70);
   assert(await page.locator('.revised-video').count()===1,label+' '+scene.id+' renders');
   if(scene.id==='sources'){
    const panels=page.locator('.video-source-card');assert(await panels.count()===2,label+' two source panels');
    assert((await panels.nth(0).innerText()).includes('YouTube')&&(await panels.nth(1).innerText()).includes('SRT'),label+' YouTube and personal SRT are clear');
    assert(await panels.nth(0).locator('.video-source-address').innerText().then(text=>text.includes('youtube.com'))&&await panels.nth(0).locator('.video-source-caption-row').count()===2&&await panels.nth(0).locator('.video-source-download-flow').count()===1,label+' source demo shows a sample video, subtitle choices and learning-library flow');
    assert(await panels.nth(1).locator('.video-source-series').count()===3&&await panels.nth(1).locator('.video-source-original-note').count()===1,label+' personal SRT demo uses original series illustrations');
    assert(await panels.nth(1).locator('.video-source-imported').evaluate(el=>el.getBoundingClientRect().width)<160,label+' local SRT action reads as a compact import badge');
    assert(await panels.nth(0).locator('.video-source-added').evaluate(el=>Number(getComputedStyle(el).opacity))>.8,label+' subtitle download ends with a visible library result');
    const fill=await page.locator('.video-source-youtube-demo,.video-source-srt-demo').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),children=[...el.children],last=children.at(-1).getBoundingClientRect();return r.bottom-last.bottom;}));
    assert(fill.every(bottom=>bottom<18),label+' source details fill both panels without a large blank area');
    const boxes=await panels.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    if(portrait)assert(Math.abs(boxes[0].height-boxes[1].height)<35&&boxes[1].y>boxes[0].y,label+' source panels split portrait screen evenly');
    else assert(Math.abs(boxes[0].width-boxes[1].width)<35&&boxes[1].x>boxes[0].x,label+' source panels split landscape screen evenly');
   }
   if(scene.id==='sync'){
    assert(await page.locator('.video-transfer').getAttribute('data-flow-direction')===(portrait?'down':'right'),label+' encrypted sync flow follows the device layout');
    const [computer,phone]=await page.locator('.video-sync-device').allInnerTexts();assert(computer.includes('电脑')&&phone.includes('手机'),label+' encrypted sync orders computer before phone');
    if(portrait){const r=await page.locator('.video-transfer>div').boundingBox();assert(r&&r.height>r.width*4,label+' encrypted sync packet travels vertically');}
   }
   assert(await page.locator('.scene-track').count()===0,label+' '+scene.id+' no animation progress strip');
   const bad=await page.locator('.revised-video').evaluate(el=>/\bTXT\b|\bVTT\b/.test(el.textContent));assert(!bad,label+' '+scene.id+' SRT-only');
   if(await page.locator('.sample-sidebar-nav').count())assert(await page.locator('.sample-sidebar-nav button').count()===5,label+' '+scene.id+' five-item navigation');
   if(!['languages','outro'].includes(scene.id))assert(await page.locator('.revised-video [data-theme="midnight"]').count()===0&&await page.locator('.revised-video').getAttribute('data-theme')==='ocean',label+' '+scene.id+' stays light');
   await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-'+scene.id+'.png')});
  }
  const lookup=timeline.find(s=>s.id==='lookup');await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((lookup.start+(lookup.end-lookup.start)*.42)*videoFps));await page.waitForTimeout(60);
  const dimensions=await page.locator('.sample-detail-panel').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,transform:getComputedStyle(el).transform};});
  assert(portrait?dimensions.width>900:dimensions.width<500,label+' correct drawer axis/layout');
  await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((lookup.start+(lookup.end-lookup.start)*.25)*videoFps));await page.waitForTimeout(60);
  assert(await page.locator('.video-pointer').count()===1,label+' pointer locates meaningful target');
  const pointer=await page.locator('.video-product').evaluate(root=>{const word=[...root.querySelectorAll('[role=button]')].find(el=>el.textContent==='meaningful'),r=word.getBoundingClientRect(),p=root.querySelector('.video-pointer').getBoundingClientRect();return {distance:Math.hypot(p.x-(r.x+r.width/2),p.y-(r.y+r.height/2))};});assert(pointer.distance<90,label+' pointer approaches actual word');
  const outro=timeline.at(-1);await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((outro.start+2)*videoFps));await page.waitForTimeout(90);
  assert(await page.locator('.video-author-avatar').first().evaluate(el=>el.complete&&el.naturalWidth>0),label+' author avatar loaded');
  assert(await page.locator('.video-author-link').first().getAttribute('href')===author.url,label+' verified author link');
  assert(await page.locator('.video-outro h1').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>80),label+' outro heading readable at export size');
  const overflow=await page.locator('.video-author').first().evaluate(el=>{const card=el.getBoundingClientRect(),video=el.closest('.revised-video').getBoundingClientRect();return card.right>video.right||card.bottom>video.bottom;});assert(!overflow,label+' author card fits');
  await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-outro.png')});
  const montage=timeline.at(-2);
  for(const [i,theme] of videoThemes.entries()){
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.floor((montage.start+(montage.end-montage.start)*(i===4?.9:i*.16+.08))*videoFps));await page.waitForTimeout(60);
   assert(await page.locator('.revised-video').getAttribute('data-theme')===theme,label+' theme montage '+theme);
   assert(await page.locator('.video-theme-ribbon [data-selected=true]').getAttribute('data-video-theme')===theme,label+' selected swatch '+theme);
   await page.locator('.revised-video').screenshot({path:resolve(out,'stills',label+'-theme-'+theme+'.png')});
  }
  for(const [name,offset] of [['white',0],['split',1],['settled',2],['last',outro.end-outro.start-1/videoFps]]){
   await page.evaluate(f=>window.__lexicueVideoPreview.seek(f),Math.round((outro.start+offset)*videoFps));await page.waitForTimeout(60);
   assert(await page.locator('[data-ending-layer=ocean]').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(255, 255, 255)',label+' ending has pure white base '+name);
   const clip=await page.locator('[data-ending-layer=midnight]').evaluate(el=>getComputedStyle(el).clipPath);assert(clip.startsWith('polygon('),label+' ending uses a moving clip '+name);
   await page.locator('.video-ending').screenshot({path:resolve(out,'stills',label+'-outro-'+name+'.png')});
  }
  assert(closingBoundary(0,portrait).center>1&&Math.abs(closingBoundary(2*videoFps,portrait).center-.5)<.02,label+' white transitions to balanced split');
  assert(closingBoundary(2*videoFps,portrait).clip!==closingBoundary(Math.round((outro.end-outro.start)*videoFps)-1,portrait).clip,label+' boundary keeps moving until final frame');
 }
 await page.evaluate(()=>window.__lexicueVideoPreview.format(false));await page.getByRole('button',{name:'English'}).click();await page.waitForTimeout(80);
 for(const [id,at,expected] of [['intro',1,'Learn with the'],['sources',5,'The videos you watch'],['lookup',25,'Tap a word'],['sync',62,'Encrypted transfer'],['outro',76,'MEET THE MAKER']]){
  await page.evaluate(({frame})=>window.__lexicueVideoPreview.seek(frame),{frame:Math.round(at*videoFps)});await page.waitForTimeout(80);
  const text=await page.locator('.revised-video').innerText();assert(text.includes(expected),'English '+id+' localization renders');const cjk=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);assert(!cjk,'English '+id+' has no untranslated interface or promotional copy: '+JSON.stringify(text));
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
