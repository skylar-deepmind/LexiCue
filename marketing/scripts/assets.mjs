import {chromium} from 'playwright';
import {mkdir,readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {locales,features,copy} from '../src/catalogue.mjs';
const root=resolve(import.meta.dirname,'..'),media=resolve(root,'../docs/media');
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1100,height:660},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.LEXICUE_MARKETING_URL||'http://127.0.0.1:4180/';
try {
 for(const locale of locales){
  const dir=resolve(media,locale);await mkdir(dir,{recursive:true});
  for(const feature of features){
   if(process.env.LEXICUE_ASSET_FEATURES&&!process.env.LEXICUE_ASSET_FEATURES.split(',').includes(feature.id))continue;
   if(process.env.LEXICUE_ASSET_SMOKE&&!['lookup','phrases'].includes(feature.id))continue;
   await page.goto(`${base}?capture=1&scene=${feature.id}&lang=${locale}&frame=165`,{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(140);
   const png=resolve(dir,feature.id+'.png');await page.screenshot({path:png});
   await sharp(png).webp({quality:85}).toFile(resolve(dir,feature.id+'.webp'));
   await unlink(png);
  }
  await page.goto(`${base}?capture=1&scene=review&lang=${locale}&theme=midnight&frame=125`,{waitUntil:'networkidle'});await page.waitForTimeout(140);await page.screenshot({path:resolve(dir,'midnight.png')});
  if(process.env.LEXICUE_ASSET_SMOKE)continue;
  const heroData=(await readFile(resolve(dir,'lookup.webp'))).toString('base64'),logoData=(await readFile(resolve(root,'public/lexicue-icon.png'))).toString('base64'),c=copy[locale];
  await page.setViewportSize({width:1200,height:630});
  await page.setContent(`<html><body style="margin:0;font-family:-apple-system,'PingFang SC',sans-serif;background:#f5f8fc;color:#102348"><div style="width:1200px;height:630px;box-sizing:border-box;display:flex;align-items:center;gap:40px;padding:50px"><div style="width:330px;flex-shrink:0"><div style="display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700"><img width="52" height="52" style="border-radius:12px" src="data:image/png;base64,${logoData}">LexiCue</div><h1 style="font-size:46px;line-height:1.2;letter-spacing:-1px;margin:35px 0">${c.hero[0]}<br><span style="color:#235ce0">${c.hero[1]}</span></h1><p style="font-size:15px;line-height:1.9;color:#526177">${c.eyebrow}<br>macOS · Windows · Android</p></div><img style="width:730px;border:1px solid #dce5f0;border-radius:14px;box-shadow:0 25px 60px #10234818" src="data:image/webp;base64,${heroData}"></div></body></html>`);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:resolve(dir,'social.png')});await page.setViewportSize({width:1100,height:660});
  if(process.env.LEXICUE_ASSET_POSTERS_ONLY)continue;
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Rendered deterministic product-component assets for all locales.');
}finally{await browser.close();}
