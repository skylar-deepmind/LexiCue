import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {horizontalRevision,videoFps} from '../src/video-revision.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-final/qa');
const previewOnly=process.argv.includes('--preview');
const base=process.env.LEXICUE_VIDEO_PREVIEW_URL||'http://127.0.0.1:4190/output/marketing/video-preview/';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];
try{
 const page=await browser.newPage({viewport:{width:1984,height:1600},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__lexicueVideoPreview);
 await page.evaluate(()=>document.fonts.ready);
 // Presentation-only snapshot overrides. Product, website and video styles stay untouched.
 await page.addStyleTag({content:`
 .video-preview-page{max-width:none;padding:0}.preview-player{width:1920px;border:0;border-radius:0}
 .video-window{width:var(--cover-width)!important;height:var(--cover-height)!important}
 .video-product-scale{transform:none!important;width:var(--cover-width)!important;height:var(--cover-height)!important}
 .video-product{width:var(--cover-width)!important;height:var(--cover-height)!important}
 .video-product .sample-sidebar,.video-product .sample-detail-scrim,.video-product .sample-notice,.video-product .video-pointer{display:none!important}
 .video-product .sample-content{width:calc(100% - var(--cover-drawer-width));padding:23px 24px!important}
 .video-product .sample-detail-panel{width:var(--cover-drawer-width)!important;box-shadow:none!important;transform:none!important;animation:none!important}
 .video-product .sample-header{padding:16px 24px;min-height:68px}
 .video-product .sample-toolbar{flex-wrap:wrap;gap:10px;margin-bottom:21px}
 .video-product .sample-toolbar .ui-button{font-size:14px;min-height:38px;padding:8px 12px}
 .video-product .sample-reader p{font-size:var(--cover-reader-font)!important;line-height:1.65;padding:0!important}
 .video-product .sample-segments p:not(:first-child){font-size:calc(var(--cover-reader-font) - 2px)!important}
 .video-product .sample-detail-heading h3{font-size:var(--cover-term-font)!important}
 .video-product .sample-definition-text{font-size:var(--cover-definition-font)!important;line-height:1.65}
 .video-product .sample-definition-body{font-size:18px!important;padding:22px}
 .video-product .sample-statuses button{font-size:14px!important;padding:9px 8px}
 `});
 const scene=horizontalRevision.find(s=>s.id==='lookup');
 for(const locale of previewOnly?['zh']:['zh','en'])for(const ratio of previewOnly?['16x9']:['16x9','4x3']){
  await page.evaluate(wide=>{
   const values=wide?{width:1000,height:668,'drawer-width':400,'reader-font':25,'term-font':32,'definition-font':24}:{width:1220,height:610,'drawer-width':460,'reader-font':29,'term-font':38,'definition-font':26};
   for(const [key,value] of Object.entries(values))document.documentElement.style.setProperty('--cover-'+key,value+'px');
  },ratio==='16x9');
  await page.getByRole('button',{name:locale==='en'?'English':'中文',exact:true}).click();
  await page.evaluate(frame=>window.__lexicueVideoPreview.seek(frame),Math.round((scene.start+(scene.end-scene.start)*.72)*videoFps));
  await page.waitForTimeout(150);
  const capture=page.locator('.video-window');
  await capture.locator('.sample-detail-panel').waitFor({state:'visible'});
  const ui=await capture.innerText();
  if(!ui.includes('meaningful')||!ui.includes('Small habits make a'))throw Error('Missing lookup and original sentence');
  if(await capture.locator('.sample-detail-scrim').isVisible())throw Error('Cover capture contains a gray scrim');
  if(await capture.locator('.scene-track').count())throw Error('Cover capture contains an animation progress bar');
  if(locale==='en'&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ui))throw Error('English cover UI has untranslated copy');
  const word=capture.locator('[role=button]').filter({hasText:/^meaningful$/}).first();
  const visible=await word.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.video-product').querySelector('.sample-detail-panel').getBoundingClientRect();return r.right<=p.left&&r.width>0;});
  if(!visible)throw Error('Selected word is covered by the lookup drawer');
  const complete=await capture.locator('.sample-segments>div').last().evaluate(el=>{const r=el.getBoundingClientRect(),window=el.closest('.video-window').getBoundingClientRect();return r.bottom<=window.bottom&&r.right<=window.right;});
  if(!complete)throw Error('Subtitle cards are cropped in '+locale+' '+ratio);
  await capture.screenshot({path:resolve(out,`cover-lookup-${locale}-${ratio}.png`)});
  checks.push({locale,ratio,selectedWordVisible:true,noScrim:true,noProgressBar:true,subtitleCardsComplete:complete});
 }
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(resolve(out,'cover-snapshot-checks.json'),JSON.stringify({checks,errors},null,2));
 console.log('Cover component snapshots saved: '+checks.map(c=>c.locale+' '+c.ratio).join(', '));
}finally{await browser.close();}
