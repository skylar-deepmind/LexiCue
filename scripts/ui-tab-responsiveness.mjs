/** Visible tab commits and initial list paint with deliberately delayed native replies. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output='/tmp/lexicue-tab-responsiveness';const h=await createReadingHarness(output);let checks=0,page;
const ok=(v,label)=>{assert.ok(v,label);checks++;};
try{
 await h.call('test_reset');const sentence='The first train will arrive soon.';
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'Tab responsiveness.txt',content:sentence,segments:[{index:0,en_text:sentence,zh_text:null,start_time:null,end_time:null}]}});
 const data=await h.call('open_reading_material',{fileId:imported.file_id});await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:data.segments[0].id,expression:'train',start_offset:10,end_offset:15,explanation:null,explanation_source:'unknown'}}});
 for(const platform of ['desktop','mobile'])for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext(platform==='desktop'?{viewport:{width:1280,height:800}}:{viewport:{width:375,height:812},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'});page=await context.newPage();await h.fixture(page,theme);await page.routeWebSocket('**',s=>s.close());await page.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));await page.goto(`${h.url}/files`);await page.locator('.mobile-startup').waitFor({state:'detached'});
  const nav=platform==='desktop'?'.b-dock':'.b-mobile-nav';
  await page.evaluate(()=>{
   window.__savedListAnimations=[];
   const animate=Element.prototype.animate;
   Element.prototype.animate=function(frames,options){if(this.matches('.saved-workspace .motion-change'))window.__savedListAnimations.push(frames);return animate.call(this,frames,options);};
   const original=window.__TAURI_INTERNALS__.invoke;
   window.__slowTabReads=0;
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
    if(['list_saved_groups','list_materials','list_tags'].includes(command)){window.__slowTabReads++;await new Promise(resolve=>setTimeout(resolve,900));try{return await original(command,args);}finally{window.__slowTabReads--;}}
    return original(command,args);
   };
  });
  await page.locator(`${nav} a[href="/saved"]`).click();await page.locator('.saved-page').waitFor();
  ok(await page.evaluate(()=>window.__slowTabReads>0),'Saved page commits while native reply is pending');
  ok(await page.locator('.saved-page .loading-skeleton--list .loading-skeleton__shape').isVisible(),'visible loading feedback while first index is read');
  await page.locator('.saved-record-list li').first().waitFor();
  ok(await page.evaluate(()=>window.__savedListAnimations.length===0),'first index never starts a zero-height list animation');
  ok(await page.locator('.saved-record-list').evaluate(n=>{const r=n.getBoundingClientRect();return r.height>40&&!n.closest('[data-motion-moving]');}),'first populated list appears at full height without an empty snapshot animation');
  await page.screenshot({path:`${output}/${platform}-${theme}-first-saved.png`});
  await page.locator(`${nav} a[href="/files"]`).click();await page.locator('.materials-page').waitFor();ok(await page.evaluate(()=>window.__slowTabReads>0),'Materials page commits while metadata reads are pending');
  await page.locator(`${nav} a[href="/saved"]`).click();await page.locator('.saved-page').waitFor();ok(await page.evaluate(nav=>location.pathname==='/saved'&&document.querySelector(`${nav} [aria-current=page]`).getAttribute('href')==='/saved',nav),'rapid return has matching route and navigation selection');
  await page.locator('.saved-record-list li').first().waitFor();ok(await page.locator('.saved-record-list').innerText().then(t=>t.includes('train')),'latest native result renders after interrupted navigation');await context.close();
 }
 ok(h.errors.length===0,'no browser exceptions');await writeFile(`${output}/report.json`,JSON.stringify({checks,errors:h.errors},null,2));console.log(`Tab responsiveness: ${checks} checks passed`);
}catch(error){await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
