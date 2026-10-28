import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],results=[];
const base=process.env.LEXICUE_VIDEO_DELIVERY_URL||'http://127.0.0.1:4190/output/marketing/video-final/';
try{
 for(const width of [390,768,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1100},colorScheme:theme});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.goto(base,{waitUntil:'networkidle'});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))throw Error('Delivery page overflow');
  for(const video of await page.locator('video').all()){
   await video.evaluate(async v=>{v.muted=true;await new Promise((resolve,reject)=>{if(v.readyState>=1)return resolve();v.addEventListener('loadedmetadata',resolve,{once:true});v.addEventListener('error',reject,{once:true});});v.currentTime=v.duration-2;await v.play();});await page.waitForTimeout(250);
   const metadata=await video.evaluate(v=>{v.pause();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,played:v.currentTime,error:v.error?.message||null};});if(metadata.error||!metadata.width||metadata.played<metadata.duration-2)throw Error('Native video playback failed: '+JSON.stringify(metadata));results.push({viewport:width,theme,...metadata});
  }
  if(await page.locator('a[download]').count()!==16)throw Error('Missing video or cover download links');
  if(await page.locator('video').count()!==4)throw Error('Expected Chinese and English horizontal/vertical videos');
  const coverMetadata=await page.locator('.cover img').evaluateAll(images=>images.map(image=>({alt:image.alt,width:image.naturalWidth,height:image.naturalHeight})));
  if(coverMetadata.length!==4||coverMetadata.some(image=>!image.width||!image.height))throw Error('Promotional cover previews did not load');
  if(!coverMetadata.some(image=>image.width/image.height>1.7)||!coverMetadata.some(image=>Math.abs(image.width/image.height-4/3)<.03))throw Error('Expected 16:9 and 4:3 promotional covers');
  if(coverMetadata.filter(image=>image.width===1280&&image.height===720).length!==2||coverMetadata.filter(image=>image.width===1440&&image.height===1080).length!==2)throw Error('Incorrect cover export dimensions');
  for(const link of await page.locator('a[download]').all()){
   const url=new URL(await link.getAttribute('href'),base).href;
   if(!(await page.request.head(url)).ok())throw Error('Broken download: '+url);
  }
  await page.locator('a[download]').first().focus();
  if(await page.locator('a[download]').first().evaluate(el=>getComputedStyle(el).outlineStyle==='none'))throw Error('Missing download keyboard focus');
  await page.close();
 }
 if(errors.length)throw Error(errors.join('\n'));await writeFile(resolve(import.meta.dirname,'../../output/marketing/video-final/qa',base.includes('publishing-kit')?'page-check-publishing-kit.json':'page-check.json'),JSON.stringify({base,errors,results},null,2));console.log('Delivery page passed: '+base+' · native playback, cover dimensions, downloads, focus and responsive light/dark checks.');
}finally{await browser.close();}
