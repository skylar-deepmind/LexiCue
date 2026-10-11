import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],results=[];
try{
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1100},colorScheme:theme});page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  await page.goto('http://127.0.0.1:4190/output/marketing/video-final/',{waitUntil:'networkidle'});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))throw Error('Delivery page overflow');
  for(const video of await page.locator('video').all()){
   await video.evaluate(async v=>{v.muted=true;await new Promise((resolve,reject)=>{if(v.readyState>=1)return resolve();v.addEventListener('loadedmetadata',resolve,{once:true});v.addEventListener('error',reject,{once:true});});v.currentTime=v.duration-2;await v.play();});await page.waitForTimeout(250);
   const metadata=await video.evaluate(v=>{v.pause();return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,played:v.currentTime,error:v.error?.message||null};});if(metadata.error||!metadata.width||metadata.played<metadata.duration-2)throw Error('Native video playback failed: '+JSON.stringify(metadata));results.push({viewport:width,theme,...metadata});
  }
  if(await page.locator('a[download]').count()!==8)throw Error('Missing delivery download links');await page.close();
 }
 if(errors.length)throw Error(errors.join('\n'));await writeFile(resolve(import.meta.dirname,'../../output/marketing/video-final/qa/page-check.json'),JSON.stringify({errors,results},null,2));console.log('Final page: native playback, metadata, links and responsive light/dark checks passed.');
}finally{await browser.close();}
