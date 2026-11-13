/** Real SavedPage: only IPC data is isolated. Covers gesture intent, not just CSS values. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {collectionFixture} from './ui-collection-fixture.mjs';
const {chromium}=await import(process.env.LEXICUE_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.LEXICUE_UI_BROWSER_CHANNEL||'chrome'});
const output=process.env.LEXICUE_SAVED_FEEDBACK_OUTPUT||'/tmp/lexicue-saved-feedback';
const checks=[];await mkdir(output,{recursive:true});
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const geometry=button=>button.evaluate(n=>{
 const box=selector=>{const r=n.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 return {word:box('.saved-record-term'),count:box('.saved-context-count'),arrow:box('.saved-chevron'),background:getComputedStyle(n).backgroundColor};
});
async function pan(page,button,dx,dy){
 const r=await button.boundingBox(),x=r.x+Math.min(r.width-30,210),y=r.y+r.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 for(let i=1;i<=10;i++)await page.mouse.move(x+dx*i/10,y+dy*i/10);
 await page.mouse.up();
}
try{
 for(const theme of ['ocean','midnight'])for(const [phone,motion] of [[false,'no-preference'],[true,'no-preference'],[true,'reduce']]){
  const context=await browser.newContext({viewport:phone?{width:375,height:812}:{width:1140,height:800},isMobile:phone,hasTouch:phone,reducedMotion:motion});
  const page=await context.newPage();await page.addInitScript(collectionFixture,{theme});
  await page.goto(new URL('/saved',process.env.LEXICUE_UI_URL||'http://127.0.0.1:5173').href);
  const row=page.locator('.page-live .saved-group-row').first(),button=row.locator('.saved-record-open');
  await button.waitFor();await page.locator('.mobile-startup').waitFor({state:'detached'});
  await page.evaluate(()=>document.fonts.ready);
  const before=await geometry(button),r=await button.boundingBox();
  await page.mouse.move(r.x+80,r.y+r.height/2);await page.mouse.down();
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.page-live .saved-record-term')).opacity)<.85);
  const held=await geometry(button);
  eq(held.background,'rgba(0, 0, 0, 0)',`${theme}/${phone}/${motion}: press has no row overlay`);
  eq(held.arrow,before.arrow,'the right chevron never participates in word press movement');
  eq(held.count,before.count,'the context count stays still');
  eq(motion==='reduce'?Math.abs(held.word.y-before.word.y)<.01:held.word.y>before.word.y+.5,true,'only the expression moves, and reduced motion suppresses that movement');
  await page.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-${motion}-press.png`});
  await page.mouse.up();await button.getAttribute('aria-expanded').then(value=>eq(value,'true','ordinary release opens the contexts'));
  eq((await geometry(button)).background,'rgba(0, 0, 0, 0)','expanded/hovered row remains unpainted');
  await button.click();await page.waitForFunction(()=>document.querySelector('.page-live .saved-record-open').getAttribute('aria-expanded')==='false');
  await pan(page,button,3,70);
  eq(await button.getAttribute('aria-expanded'),'false','a vertical drag cannot activate the row');
  eq(await button.getAttribute('data-press'),null,'a vertical drag clears the word press');
  await pan(page,button,-84,0);
  eq(await row.getAttribute('data-swipe-open'),'true','left swipe reveals the separate trash button');
  eq(await button.getAttribute('aria-expanded'),'false','swipe release does not open contexts');
  eq(await button.getAttribute('data-press'),null,'horizontal dragging does not pulse the word');
  await pan(page,button,84,0);
  eq(await row.getAttribute('data-swipe-open'),null,'right swipe closes the delete action');
  await button.click();eq(await button.getAttribute('aria-expanded'),'true','an immediate fresh tap after a swipe still works');
  await button.click();await button.focus();await page.keyboard.press('Enter');
  eq(await button.getAttribute('aria-expanded'),'true','keyboard activation remains available');
  await page.waitForFunction(()=>!document.querySelector('.page-live .saved-record-open[data-press]'));
  await context.close();
 }
 await writeFile(`${output}/report.json`,JSON.stringify({checks,scope:'Production React in Chromium desktop/touch emulation; isolated IPC fixture, not physical-device acceptance'},null,2));
 console.log(`Saved feedback: ${checks.length} checks passed; ${output}`);
}finally{await browser.close();}
