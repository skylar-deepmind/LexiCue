/** Empty/long-term library UI regression; controlled data, no real user DB. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {collectionFixture} from './ui-collection-fixture.mjs';
const {chromium}=await import(process.env.LEXICUE_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.LEXICUE_UI_BROWSER_CHANNEL||'chrome',headless:true});
const url=process.env.LEXICUE_UI_URL||'http://127.0.0.1:5173';
const output=process.env.LEXICUE_COLLECTION_UI_OUTPUT||'/tmp/lexicue-collection-ui';
await mkdir(output,{recursive:true});
const checks=[],errors=[];let current;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const settle=page=>page.waitForFunction(()=>!document.querySelector('[data-page-moving], [data-motion-moving]')&&document.getAnimations().every(a=>a.playState!=='running'));
const rows=page=>page.locator('.page-live .saved-record-row');
async function jump(scope,number){const input=scope.getByRole('textbox',{name:'跳转到页码',exact:true});await input.fill(String(number));await input.press('Enter');}
async function savedReady(page,first){await page.waitForFunction(first=>document.querySelector('.page-live .saved-record-term')?.textContent===first&&!document.querySelector('.page-live .saved-record-list[aria-busy="true"]'),first);await settle(page);}
async function overflow(page,label){eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);}
try {
 for(const theme of ['ocean','midnight'])for(const viewport of [{width:1440,height:900},{width:375,height:812},{width:812,height:375},{width:768,height:1024}]){
  const phone=viewport.width===375;
  const context=await browser.newContext({viewport,...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile'}:{})});
  const page=await context.newPage();current=page;page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(collectionFixture,{theme});
  await page.goto(`${url}/files?view=library`);await page.locator('.library-row').first().waitFor();await settle(page);
  const library=page.getByRole('dialog',{name:'材料库',exact:true});
  eq(await library.locator('.library-row').count(),20,`${theme}/${viewport.width}: 10,003 materials render only twenty rows`);
  await jump(library,501);await page.waitForFunction(()=>document.querySelectorAll('.library-list .library-row').length===3);await settle(page);
  eq(await library.locator('.library-row').count(),3,'partial last page');
  await library.getByRole('searchbox').fill('Material 00024');await page.waitForFunction(()=>document.querySelectorAll('.library-list .library-row').length===1);await settle(page);
  eq(await library.locator('.library-row').count(),1,'search finds a distant long title without paging');
  await library.getByRole('searchbox').fill('no matching material');await library.getByRole('button',{name:'清除筛选'}).waitFor();
  await library.getByRole('button',{name:'清除筛选'}).click();await page.waitForFunction(()=>document.querySelectorAll('.library-list .library-row').length===20);
  await library.getByRole('combobox',{name:'材料排序'}).click();await page.getByRole('option',{name:'标题 A–Z',exact:true}).click();await settle(page);
  eq(await library.locator('.library-row h3').first().textContent(),'Material 00001.txt','title sorting covers the complete library');
  await jump(library,2);await page.waitForFunction(()=>document.querySelector('.library-row h3')?.textContent==='Material 00021.txt');await settle(page);
  await overflow(page,'library fits viewport');
  await page.screenshot({path:`${output}/${theme}-${viewport.width}-library.png`});
  await library.getByRole('button',{name:'返回桌面',exact:true}).click();await library.waitFor({state:'detached'});
  const nav=page.locator(phone?'.b-mobile-nav':'.b-dock');await nav.locator('a[href="/saved"]').click();await savedReady(page,'word 00001');
  eq(await rows(page).count(),20,'10,003 saved expressions render twenty groups');
  const workspace=page.locator('.page-live .saved-workspace');
  await jump(workspace,501);await savedReady(page,'word 10001');eq(await rows(page).count(),3,'saved jumps directly to the last partial page');
  await page.evaluate(()=>window.__collection.delay=250);
  await workspace.getByRole('searchbox').fill('00024');await savedReady(page,'word 00024');eq(await rows(page).count(),1,'saved search across all pages');
  await page.evaluate(()=>window.__collection.delay=0);
  await workspace.getByRole('searchbox').fill('');await savedReady(page,'word 00001');
  await rows(page).first().getByRole('button',{expanded:false}).click();await page.locator('.saved-sentence').first().waitFor();
  eq(await page.locator('.page-live .saved-sentence:visible').count(),1,'a thousand contexts start with one sentence');
  await page.getByRole('button',{name:'还有 1002 句',exact:true}).click();
  eq(await page.locator('.page-live .saved-sentence:visible').count(),20,'opening contexts is bounded to twenty');
  const details=page.locator('.page-live .saved-disclosure[data-open=true]');await jump(details,51);await page.waitForFunction(()=>document.querySelectorAll('.page-live .saved-sentence').length===3);await settle(page);
  eq(await details.locator('.saved-sentence').count(),3,'a thousand contexts support direct paging');
  await rows(page).first().getByRole('button',{expanded:true}).click();await settle(page);
  await jump(workspace,2);await savedReady(page,'word 00021');
  // Sticky controls stay reachable even at the end of the page.
  await page.locator('.saved-scroll').evaluate(n=>n.scrollTop=n.scrollHeight);await overflow(page,'saved page fits viewport');
  eq(await workspace.getByRole('searchbox').isVisible(),true,'saved search remains available at the bottom');
  await page.screenshot({path:`${output}/${theme}-${viewport.width}-saved.png`});
  await nav.locator('a[href="/files"]').click();await page.locator('.page-live .desk-paper[data-desk-active=true]').waitFor();
  await nav.locator('a[href="/saved"]').click();await savedReady(page,'word 00021');eq(await workspace.getByRole('textbox',{name:'跳转到页码'}).inputValue(),'2','tab return retains the page');
  await page.evaluate(()=>{window.__collection.savedCount=20;window.dispatchEvent(new Event('lexicue-saved-changed'));});await savedReady(page,'word 00001');eq(await rows(page).count(),20,'sync/deletion shrinks last page safely');
  await page.evaluate(()=>{window.__collection.savedCount=0;window.dispatchEvent(new Event('lexicue-saved-changed'));});await page.locator('.saved-empty').waitFor();
  eq(await page.locator('.saved-empty button').textContent(),'材料','empty saved records have a next action');
  await page.locator('.saved-empty button').click();await page.locator('.page-live .materials-page').waitFor();await settle(page);
  // Resize and reduced motion must release all transient animation surfaces.
  await page.emulateMedia({reducedMotion:'reduce'});await nav.locator('a[href="/saved"]').click();await page.locator('.saved-empty').waitFor();
  eq(await page.locator('.page-ghost > *').count(),0,'reduced motion has no ghost');
  eq(await page.evaluate(()=>window.__collection.calls.filter(c=>c.command==='list_saved_groups').every(c=>c.args.limit>0&&c.args.limit<=20)),true,'saved reads remain bounded');
  await context.close();
 }
 for(const theme of ['ocean','midnight']){
  const context=await browser.newContext({viewport:{width:375,height:667},reducedMotion:'reduce'}),page=await context.newPage();current=page;
  await page.addInitScript(collectionFixture,{theme,count:0});await page.goto(`${url}/files`);await page.locator('.desk-empty').waitFor();
  const button=page.locator('.desk-empty .desk-primary');eq(await button.isVisible(),true,'zero materials expose an import action');
  eq(await button.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'empty action fits a small phone');
  await page.evaluate(()=>document.documentElement.style.fontSize='24px');await overflow(page,'large text empty state fits');
  await page.screenshot({path:`${output}/${theme}-empty.png`});
  await page.goto(`${url}/files?view=library`);const library=page.getByRole('dialog',{name:'材料库',exact:true});
  await library.getByRole('button',{name:'导入',exact:true}).waitFor();
  await library.getByRole('button',{name:'导入',exact:true}).click();
  await page.locator('.lc-import-modal').waitFor();eq(await page.locator('.lc-import-modal').isVisible(),true,'deleting the final material leaves a working import path in the library');
  await context.close();
 }
 eq(errors,[],'no application errors');
 await writeFile(`${output}/report.json`,JSON.stringify({checks,errors,scope:'Chromium desktop and responsive/touch emulation; UI fixtures with 10,003 materials/groups and 1,003 contexts. No physical-device acceptance.'},null,2));
 console.log(`Collection boundaries: ${checks.length} checks passed; ${output}`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await browser.close();}
