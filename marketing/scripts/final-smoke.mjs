import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/';
const out=resolve(import.meta.dirname,'../../output/marketing/qa/experience');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
let checks=0;const errors=[];
const check=(value,message)=>{assert.ok(value,message);checks++;};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>sessionStorage.setItem('lexicue-home-guide-v1',JSON.stringify(['files','reading','words','phrases','review','insights','settings'])));
 await page.goto(base+'?demo=insights',{waitUntil:'networkidle'});
 const rings=()=>page.locator('.sample-stats [role=progressbar]').evaluateAll(nodes=>nodes.map(node=>Number(node.getAttribute('aria-valuenow'))));
 check(JSON.stringify(await rings())==='[16,50]','initial progress uses weighted word and phrase states');
 await page.locator('.sample-sidebar-nav button').first().click();
 await page.locator('.sample-file-open').first().click();
 await page.locator('.sample-segments [role=button]').filter({hasText:'meaningful'}).click();
 await page.locator('.sample-statuses button').nth(2).click();await page.keyboard.press('Escape');await page.locator('.sample-detail-overlay').waitFor({state:'hidden'});
 await page.locator('.sample-sidebar-nav button').nth(3).click();
 check(JSON.stringify(await rings())==='[19,50]','reading status updates weighted statistics');
 await page.goto(base+'guide/reading/',{waitUntil:'networkidle'});
 check(await page.locator('.doc-section').count()===3,'standard reading documentation');
 check(await page.locator('.sandbox,.manual-animation,.player-controls').count()===0,'documentation has no repeated demo');
 await page.locator('[data-doc-image]').click();check(await page.locator('.doc-lightbox').evaluate(el=>el.open),'screenshot enlargement');await page.keyboard.press('Escape');
 await page.screenshot({path:resolve(out,'manual-final.png')});
 await page.goto(base+'?capture=1&scene=lookup&frame=165',{waitUntil:'networkidle'});
 check(await page.locator('.scene-track').count()===1,'legacy media capture keeps playback track default');
 check(await page.locator('.demo-scene').getAttribute('inert')===null,'legacy scene interaction default unchanged');
 check(errors.length===0,'no browser exceptions: '+errors.join('; '));
 await writeFile(resolve(out,'final-smoke.json'),JSON.stringify({checks,errors},null,2));
 console.log(`${checks} final smoke checks passed.`);
}finally{await browser.close();}
