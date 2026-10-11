import {chromium} from 'playwright';
import sharp from 'sharp';
import {resolve} from 'node:path';
const base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/';
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[];
try{const page=await browser.newPage({viewport:{width:1100,height:660}});page.on('pageerror',e=>errors.push(e.message));for(const locale of ['en','zh','ja','de']){await page.goto(base+'?capture=1&scene=import&lang='+locale+'&frame=165',{waitUntil:'networkidle'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);if(await page.locator('.source-types span').allTextContents().then(types=>types.join(',')!=='SRT'))throw Error('Import scene must show SRT only');await sharp(await page.screenshot()).webp({quality:85}).toFile(resolve(import.meta.dirname,'../../docs/media',locale,'import.webp'));}if(errors.length)throw Error(errors.join('\n'));console.log('Refreshed four SRT-only import images; other showcase assets preserved.');}finally{await browser.close();}
