/** Cold browser documents + production UI/native cores; physical iPhone checked separately. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output='/tmp/lexicue-mobile-startup';
const h=await createReadingHarness(output),{browser,fixture,url,call,errors}=h;
const userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
let checks=0,current;const timings=[];
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
async function seed(page,theme){await fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());await page.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));}
async function tab(page,path){
 const start=performance.now();await page.locator(`.b-mobile-nav a[href="${path}"]`).click();
 await page.waitForFunction(path=>location.pathname===path&&document.querySelector('.b-mobile-nav [aria-current=page]')?.getAttribute('href')===path&&!!document.querySelector(path==='/saved'?'.page-live .saved-page':'.page-live .materials-page'),path,{timeout:1500});
 timings.push(performance.now()-start);
 eq(await page.locator('.page-ghost > *').count(),0,'phone commits the new page without a cloned old page');
 eq(await page.locator('.mobile-startup').count(),0,'tab changes do not replay launch');
}
try{
 await call('test_reset');
 for(const theme of ['ocean','midnight']){
  const context=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true});const page=await context.newPage();current=page;await seed(page,theme);
  await page.goto(url);await page.locator('.mobile-startup').waitFor();
  ok(await page.locator('.mobile-startup').evaluate(n=>{const r=n.getBoundingClientRect();return r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight;}),'launch covers the actual phone viewport');
  eq(await page.locator('.desktop-launch--mobile').getAttribute('data-contraction'),'inset','chosen mobile B contraction');
  ok(await page.locator('.app-startup-content').evaluate(n=>n.inert),'underlying controls cannot receive early cold-start taps');
  const rates=await page.locator('.desktop-launch').evaluate(n=>n.getAnimations({subtree:true}).map(a=>a.playbackRate));ok(rates.length>5&&rates.every(rate=>rate===1.7),'all launch animations use chosen 1.7 speed');
  eq(await page.locator('html').getAttribute('data-theme'),theme,'saved theme applies before launch display');
  await page.screenshot({path:`${output}/${theme}-launch.png`});
  await page.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});
  ok(await page.locator('.app-startup-content').evaluate(n=>!n.inert&&!n.hasAttribute('aria-hidden')),'launch removes all interaction/accessibility blocking');
  for(let i=0;i<8;i++){await tab(page,'/saved');await page.locator('.saved-empty,.saved-list').first().waitFor();await tab(page,'/files');}
  await page.screenshot({path:`${output}/${theme}-home.png`});
  await tab(page,'/saved');await page.screenshot({path:`${output}/${theme}-saved.png`});
  // Fresh document replays once; cancelled Web Animations cannot trap the cover.
  await page.reload();await page.locator('.mobile-startup').waitFor();
  await page.evaluate(()=>document.querySelector('.desktop-launch').getAnimations({subtree:true}).forEach(a=>a.pause()));
  await page.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});await tab(page,'/files');
  await page.reload();await page.locator('.mobile-startup').waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.mobile-startup').waitFor({state:'detached',timeout:1000});
  ok(await page.locator('.app-startup-content').evaluate(n=>!n.inert),'changing reduced motion immediately releases the launch cover');
  await tab(page,'/saved');
  // A cold reduced-motion launch still exposes the static brand briefly.
  await page.reload();await page.locator('.mobile-startup').waitFor({state:'detached',timeout:1200});await tab(page,'/files');
  await context.close();
 }
 const firstUse=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true});
 const firstPage=await firstUse.newPage();current=firstPage;await fixture(firstPage,'ocean');await firstPage.routeWebSocket('**',socket=>socket.close());await firstPage.goto(url);
 await firstPage.locator('.mobile-startup').waitFor();eq(await firstPage.locator('.app-guide').count(),0,'onboarding never paints or captures focus above the launch');
 await firstPage.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});await firstPage.locator('.app-guide[data-stage=import]').waitFor();
 ok(await firstPage.locator('.app-guide__next').isEnabled(),'onboarding is interactive after launch removal');await firstUse.close();
 const desktop=await browser.newContext({viewport:{width:1280,height:800}}),page=await desktop.newPage();current=page;await seed(page,'ocean');await page.goto(url);await page.locator('.materials-page').waitFor();eq(await page.locator('.mobile-startup').count(),0,'desktop startup unchanged');await desktop.close();
 eq(errors,[],'no application errors');await writeFile(`${output}/report.json`,JSON.stringify({checks,errors,navigationMs:{max:Math.max(...timings),samples:timings},scope:'Cold document React application using real Rust cores and temporary SQLite; Chrome mobile emulation, not physical WebKit'},null,2));console.log(`Mobile startup: ${checks} checks passed; max navigation ${Math.round(Math.max(...timings))}ms; ${output}`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
