/** Cold browser documents + production UI/native cores; physical iPhone checked separately. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_MOBILE_STARTUP_OUTPUT||'/tmp/lexicue-mobile-startup';
const h=await createReadingHarness(output),{browser,fixture,url,call,errors}=h;
const userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
let checks=0,current,material,record;const timings=[],coldLaunch=[];
const ok=(v,label)=>{assert.ok(v,label);checks++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const opening='The morning air is cool by the harbor.';
const continuation='The quiet harbor opens across the bay.';
async function seed(page,theme){
 await fixture(page,theme);
 await page.routeWebSocket('**',socket=>socket.close());
 await page.addInitScript(file=>{
   localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}');
   const ref={id:file.id,identity:`content:${file.content_hash}`,hash:file.content_hash};
   localStorage.setItem('lexicue-reading-desk:v2',JSON.stringify({version:2,initialized:true,items:[ref],selected:ref,opened:[ref]}));
 },material);
}
const calls=page=>page.evaluate(()=>window.__uiCalls.map(call=>call.command));
async function homeReady(page){
 await page.getByTestId('desk-continue').waitFor({timeout:1500});
 await page.locator('.approved-card[data-desk-active="true"] .approved-card-quote').filter({hasText:continuation}).waitFor({timeout:1500});
 await page.locator(`[data-pocket-record="${record.record_id}"] .pocket-preview-sentence`).filter({hasText:continuation}).waitFor({timeout:1500});
 await page.waitForFunction(()=>!document.querySelector('.app-startup-content').inert);
 ok(await page.getByTestId('desk-continue').isEnabled(),'reading entry is interactive with real home content');
}
async function readerReady(page){
 const sentence=page.locator(`.reading-page[data-reading-material="${material.id}"] .reading-word`).filter({hasText:/^quiet$/}).first();
 await sentence.waitFor({timeout:1500});
 await page.waitForFunction(()=>!document.querySelector('.app-startup-content').inert);
 ok(await sentence.isEnabled(),'restored passage is interactive');
}
async function tab(page,phase,path,from='home'){
 const start=performance.now();
 if(path==='/saved')await page.getByRole('button',{name:'已保存',exact:true}).click();
 else if(path==='/reader')await page.getByTestId('desk-continue').click();
 else if(from==='reader')await page.locator('.reading-breadcrumb .page-back').click();
 else await page.locator('.approved-saved-header').getByRole('button',{name:'返回',exact:true}).click();
 if(path==='/saved'){
   await page.locator('.approved-folio-sentence').filter({hasText:continuation}).waitFor({timeout:1500});
   ok(await page.locator('.approved-source-title').isEnabled(),'the real saved context can open its source');
   timings.push({phase,path:'/saved-context',ms:performance.now()-start});
   await page.locator('.approved-saved-word[aria-pressed="true"]:enabled').waitFor({timeout:1500});
   ok(await page.locator('.approved-saved-word[aria-pressed="true"]').isEnabled(),'saved index with real content is interactive');
 }else if(path==='/reader')await readerReady(page);
 else await homeReady(page);
 timings.push({phase,path,ms:performance.now()-start});
 eq(await page.locator('.page-ghost > *').count(),0,'phone commits the page without a cloned old page');
 ok(await page.locator('.app-startup-content').evaluate(node=>!node.inert),'navigation stays interactive after launch');
}
try{
 await call('test_reset');
 const imported=await call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'Harbor reading.txt',content:`${opening}
${continuation}`,normalized_kind:'txt',segments:[{index:0,en_text:opening},{index:1,en_text:continuation}]}});
 const opened=await call('open_reading_material',{fileId:imported.file_id});material=opened.material;
 await call('remember_reading_position',{fileId:material.id,contentHash:material.content_hash,segment:1});
 ({record}=await call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:opened.segments[1].id,expression:'quiet',start_offset:4,end_offset:9,explanation:'测试保存句',explanation_source:'personal'}}}));
 for(const theme of ['sage','midnight']){
  const context=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true});const page=await context.newPage();current=page;await seed(page,theme);
  // Collect one coherent first-frame sample. Separate automation round trips
  // can run after the real 220 ms handoff, especially in the full suite.
  await page.addInitScript(({recordId,excerpt})=>{
    const observer=new MutationObserver(()=>{
      const cover=document.querySelector('.mobile-startup:not([data-exiting])');
      const launch=cover?.querySelector('.desktop-launch--mobile');
      const content=document.querySelector('.app-startup-content');
      if(!window.__launchFrame&&cover&&launch){
        const r=cover.getBoundingClientRect();
        window.__launchFrame={
          at:performance.now(),
          fillsViewport:r.x===0&&r.y===0&&r.width===innerWidth&&r.height===innerHeight,
          contraction:launch.dataset.contraction,
          inert:content.inert,
          rates:launch.getAnimations({subtree:true}).map(a=>a.playbackRate),
          theme:document.documentElement.dataset.theme,
        };
      }
      const card=document.querySelector('.approved-card[data-desk-active="true"] .approved-card-quote');
      const pocket=document.querySelector(`[data-pocket-record="${recordId}"] .pocket-preview-sentence`);
      if(window.__launchFrame&&content&&!content.inert&&document.querySelector('[data-testid="desk-continue"]:enabled')
          &&card?.textContent.includes(excerpt)&&pocket?.textContent.includes(excerpt)){
        window.__homeReadyFrame=performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['inert','disabled','data-desk-active']});
  },{recordId:record.record_id,excerpt:continuation});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const sample=await (await page.waitForFunction(()=>window.__launchFrame)).jsonValue();
  const observed=sample.at;
  ok(sample.fillsViewport,'launch covers the actual phone viewport');
  eq(sample.contraction,'inset','chosen mobile B contraction');
  ok(sample.inert,'underlying controls cannot receive early cold-start taps');
  ok(sample.rates.length>5&&sample.rates.every(rate=>rate===1.7),'all launch animations use chosen 1.7 speed');
  eq(sample.theme,theme,'saved theme applies before launch display');
  await page.screenshot({path:`${output}/${theme}-launch.png`});
  await homeReady(page);
  const ready=await (await page.waitForFunction(()=>window.__homeReadyFrame)).jsonValue();
  await page.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});
  const released=await page.evaluate(()=>performance.now());coldLaunch.push({theme,observedMs:observed,contentInteractiveMs:ready,overlayDetachedMs:released});
  ok(ready-observed<1000,`ready library controls are available promptly on a fresh document (${Math.round(ready-observed)} ms)`);
  const startupCalls=await calls(page);
  ok(startupCalls.includes('latest_saved_preview')&&startupCalls.includes('reading_material_preview'),'home fetches its independent saved and reading previews');
  ok(!startupCalls.includes('list_saved_groups')&&!startupCalls.includes('open_reading_material'),'home never opens the full archive or article');
  for(let i=0;i<4;i++){
   await tab(page,`${theme} ${i?'repeat':'first'}`,'/saved');await tab(page,`${theme} return from saved`,'/files');
   await tab(page,`${theme} ${i?'repeat':'first'}`,'/reader');await tab(page,`${theme} return from reader`,'/files','reader');
  }
  const visited=await calls(page);
  for(const command of ['list_materials','reading_material_preview','list_saved_groups','saved_group_contexts'])
   eq(visited.filter(item=>item===command).length,1,`navigation reuses the prepared ${command} result`);
  await page.screenshot({path:`${output}/${theme}-home.png`});
  await tab(page,theme,'/saved');await page.screenshot({path:`${output}/${theme}-saved.png`});
  // Fresh document replays once; cancelled Web Animations cannot trap the cover.
  await page.reload();await page.locator('.mobile-startup').waitFor();
  await page.evaluate(()=>document.querySelector('.desktop-launch').getAnimations({subtree:true}).forEach(a=>a.pause()));
  await page.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});await tab(page,theme,'/files');
  await page.reload();await page.locator('.mobile-startup').waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.mobile-startup').waitFor({state:'detached',timeout:1000});
  ok(await page.locator('.app-startup-content').evaluate(n=>!n.inert),'changing reduced motion immediately releases the launch cover');
  await tab(page,theme,'/saved');
  // A cold reduced-motion launch still exposes the static brand briefly.
  await page.reload();await page.locator('.mobile-startup').waitFor({state:'detached',timeout:1200});await tab(page,theme,'/files');
  await context.close();
 }
 // The first full saved context is usable even when native grouping is still pending.
 const held=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true});
 const heldPage=await held.newPage();current=heldPage;await seed(heldPage,'sage');
 await heldPage.addInitScript(()=>{
   const base=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
     if(command==='list_saved_groups')await new Promise(done=>{window.__releaseArchive=done;});
     return base(command,args);
   };
 });
 await heldPage.goto(url);await homeReady(heldPage);
 await heldPage.getByRole('button',{name:'已保存',exact:true}).click();
 await heldPage.waitForFunction(()=>typeof window.__releaseArchive==='function');
 await heldPage.locator('.approved-folio-sentence').filter({hasText:continuation}).waitFor({timeout:1000});
 eq(await heldPage.locator('.approved-saved-word').count(),0,'the grouping request is still pending');
 eq(await heldPage.locator('.approved-folio-note').innerText(),'测试保存句','early folio includes the saved explanation');
 await heldPage.evaluate(()=>window.__releaseArchive());
 await heldPage.locator('.approved-saved-word[aria-pressed="true"]:enabled').waitFor({timeout:1500});
 await held.close();

 await call('test_reset');
 const firstUse=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true});
 const firstPage=await firstUse.newPage();current=firstPage;await fixture(firstPage,'ocean');await firstPage.routeWebSocket('**',socket=>socket.close());await firstPage.goto(url);
 await firstPage.locator('.mobile-startup').waitFor();eq(await firstPage.locator('.app-guide').count(),0,'onboarding never paints or captures focus above the launch');
 await firstPage.locator('.mobile-startup').waitFor({state:'detached',timeout:4000});await firstPage.locator('.approved-desk').waitFor();
 eq(await firstPage.locator('.app-guide').count(),0,'fresh installation opens the desk without the retired guide');ok(!new URL(firstPage.url()).searchParams.has('guide'),'first launch has no guide route');await firstUse.close();
 const slow=await browser.newContext({userAgent,viewport:{width:375,height:812},isMobile:true,hasTouch:true}),slowPage=await slow.newPage();current=slowPage;await seed(slowPage,'sage');
 await slowPage.addInitScript(()=>{const base=window.__TAURI_INTERNALS__.invoke;window.__releaseLibrary=[];window.__TAURI_INTERNALS__.invoke=async(c,a)=>{if(c==='list_materials')await new Promise(done=>window.__releaseLibrary.push(done));return base(c,a);};});
 await slowPage.goto(url);await slowPage.locator('.mobile-startup').waitFor();await slowPage.locator('.mobile-startup').waitFor({state:'detached',timeout:1300});
 ok(await slowPage.locator('.approved-desk-status').isVisible(),'slow material reads expose the real loading state');ok(await slowPage.locator('.app-startup-content').evaluate(n=>!n.inert),'slow native work cannot keep the decorative launch in control');await slowPage.evaluate(()=>window.__releaseLibrary.forEach(done=>done()));await slowPage.locator('.approved-desk-status').waitFor({state:'detached'});await slow.close();
 const desktop=await browser.newContext({viewport:{width:1280,height:800}}),page=await desktop.newPage();current=page;await seed(page,'ocean');await page.goto(url);await page.locator('.approved-desk').waitFor();eq(await page.locator('.mobile-startup').count(),0,'desktop startup unchanged');await desktop.close();
 eq(errors,[],'no application errors');await writeFile(`${output}/report.json`,JSON.stringify({checks,errors,coldLaunch,navigationMs:{max:Math.max(...timings.map(sample=>sample.ms)),samples:timings},scope:'Cold browser documents and populated content readiness using real Rust cores and temporary SQLite in Chrome mobile emulation. Native startup and WKWebView require device QA.'},null,2));console.log(`Mobile startup: ${checks} checks passed; max navigation ${Math.round(Math.max(...timings.map(sample=>sample.ms)))}ms; ${output}`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
