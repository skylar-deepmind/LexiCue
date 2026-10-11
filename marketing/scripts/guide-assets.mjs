import {chromium} from 'playwright';
import sharp from 'sharp';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {locales} from '../src/catalogue.mjs';
const root=resolve(import.meta.dirname,'..'),base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/';
const sizes=JSON.parse(await readFile(resolve(root,'src/guide-image-sizes.json'),'utf8'));
const requested=process.env.LEXICUE_GUIDE_CHAPTERS?.split(',')||['files','reading','vocabulary','review','insights','settings'];
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];
try{for(const locale of locales){
 sizes[locale]??={};const page=await browser.newPage({viewport:{width:1100,height:850},deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
 for(const theme of ['ocean','midnight'])for(const chapter of requested){
  await page.goto(base+'?doc-capture='+chapter+'&lang='+locale+'&theme='+theme,{waitUntil:'networkidle'});
  await page.locator('.product-capture,.sandbox').waitFor();await page.evaluate(()=>document.fonts.ready);
  // Synthetic clicks act only on the inert, memory-only screenshot fixture.
  if(chapter==='reading')await page.locator('.sample-segments span').filter({hasText:/^meaningful$/}).first().evaluate(el=>el.click());
  if(chapter==='review')await page.locator('[data-task="answer"]').evaluate(el=>el.click());
  if(chapter==='vocabulary')await page.locator('[data-term-id="3"]').first().evaluate(el=>el.click());
  await page.waitForTimeout(350);
  const target=page.locator('.product-capture,.sample-main'),png=await target.screenshot(),dimensions=await sharp(png).metadata();
  sizes[locale][chapter]={width:dimensions.width,height:dimensions.height};await mkdir(resolve(root,'../docs/media',locale),{recursive:true});
  await sharp(png).webp({quality:86}).toFile(resolve(root,'../docs/media',locale,'guide-'+chapter+(theme==='midnight'?'-midnight':'')+'.webp'));
  if(chapter==='settings'&&await page.locator('.product-capture nav button').count()!==9)throw Error('Installed settings screenshot must show nine categories');
 }
 await page.close();console.log(`Captured product screenshots: ${locale} · ocean/midnight`);
}if(errors.length)throw Error(errors.join('\n'));await writeFile(resolve(root,'src/guide-image-sizes.json'),JSON.stringify(sizes,null,2)+'\n');}finally{await browser.close();}
