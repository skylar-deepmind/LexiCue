/** Approved mobile reading: actual Rust/SQLite, controlled external-provider boundary.
 * This replaces obsolete shelf/dock geometry; the historical suite is retained. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_MOBILE_OUTPUT||'/tmp/lexicue-mobile-ui';await mkdir(output,{recursive:true});
const h=await createReadingHarness(output),checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);},eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const geometry=page=>page.locator('.reading-original').first().evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),sc=document.querySelector('.reader-scroll');return {x:r.x,y:r.y,width:r.width,font:s.fontSize,line:s.lineHeight,scroll:sc.scrollTop};});
const settled=page=>page.waitForFunction(()=>!document.querySelector('.reading-layout[data-lookup-moving]'));
const drawerFrame=page=>page.locator('.context-panel').evaluate(node=>{
 const {x,y,width,height}=node.getBoundingClientRect();
 return [x,y,width,height];
});
const lookupShown=(page,term)=>page.waitForFunction(term=>{
 const heading=document.querySelector('.lookup-heading h2');
 const stage=heading?.closest('.lookup-stage');
 const content=stage?.querySelector('.soft-refresh');
 return heading?.textContent===term&&stage.dataset.lookupState==='ready'&&content.dataset.refreshState==='ready';
},term);

try{
 for(const theme of ['sage','midnight']){
  await h.call('test_reset');
  const rows=Array.from({length:45},(_,index)=>({index,en_text:`The plane will take off soon. We waited for the morning light. Paragraph ${index+1}.`,zh_text:'飞机即将起飞。我们等待清晨的阳光。',start_time:null,end_time:null}));
  const material=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'The morning journey.txt',content:rows.map(r=>r.en_text).join('\n'),segments:rows,normalized_kind:'txt'}});
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:667,height:375},{width:1120,height:820}]){
   const phone=viewport.width<768;const context=await h.browser.newContext({viewport,hasTouch:phone,isMobile:phone});page=await context.newPage();if(viewport.width===390){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:51,bottom:34,left:0,right:0}});}await h.fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());
   await page.addInitScript(()=>{localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));const base=window.__TAURI_INTERNALS__.invoke;window.__supplementMode='empty';window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{if(command==='lookup_cambridge_expression'){window.__uiCalls.push({command,args:structuredClone(args)});await new Promise(r=>setTimeout(r,800));if(window.__supplementMode==='error')throw Error('controlled online unavailable');if(window.__supplementMode==='success')return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'found',default_entry_id:'cambridge:ui-fixture',notices:[],entries:[{id:'cambridge:ui-fixture',headword:args.expression,kind:'word',origin:'headword',expression_type:null,parent_headword:null,source:{provider:'cambridge',dataset:'Controlled UI provider fixture',edition:null,release:null,adapter_version:'controlled-ui-fixture',entry_key:args.expression,locator:null,delivery:'online',entry_url:'https://dictionary.cambridge.org/dictionary/english/take',retrieved_at:'2026-11-16T00:00:00Z'},match:{type:'exact',pattern:null,note:null,sense_ids:[]},groups:[{id:'cambridge:ui-group',part_of_speech:'verb',source_part_of_speech:'verb',pronunciations:[],forms:[],labels:[],notes:[],senses:[{id:'cambridge:ui-sense',meaning:{en:'A controlled additional meaning for this lookup.',zh:'补充的独立用法。'},labels:[],patterns:[],examples:[],notes:[]}]}],notes:[],related_expressions:[]}]};return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'not_found',entries:[],default_entry_id:null,notices:[]};}return base(command,args);};});
   await page.goto(`${h.url}/files/${material.file_id}`);await page.locator('.reading-original').first().waitFor();await page.locator('.mobile-startup').waitFor({state:'detached'});
   await page.evaluate(async()=>{const {usePreferencesStore:p}=await window.__uiStoreModule('preferencesStore');p.getState().setLearningTextFontSize('lg');p.getState().setReadingLineHeight('loose');});
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await page.waitForFunction(()=>!document.querySelector('[data-reading-anchoring]'));
   ok(await page.locator('.reading-title').evaluate(n=>n.getBoundingClientRect().top>=document.querySelector('.reading-breadcrumb').getBoundingClientRect().bottom),'reading title clears the back control and safe area');
   const bar=page.locator('.mobile-reading-bar');ok(await bar.evaluate(n=>{const r=n.getBoundingClientRect();const b=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect());return Math.round(r.width)===106&&b.length===2&&b.every(b=>b.left>=r.left&&b.right<=r.right+1&&b.width>=44);}), 'floating reading controls fit their 106 px capsule');
   const take=page.locator('.reading-word').filter({hasText:/^take$/}).first();await take.scrollIntoViewIfNeeded();const clickedGeometry=await geometry(page);await take.click();await page.locator('.context-panel').waitFor();await settled(page);
   if(phone)eq(await geometry(page),clickedGeometry,`${theme}/${viewport.width}: half drawer preserves original width, type, position and scroll`);
   await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();const baseText=await page.locator('.soft-refresh-current .longman-meaning').first().innerText();
   const fixed=await drawerFrame(page);
   const details=page.locator('.soft-refresh-current .dictionary-more');
   const detailTrigger=details.locator('summary').first();
   if(phone&&viewport.width===390)await page.screenshot({path:`${output}/${theme}-dictionary-overview.png`});
   await detailTrigger.focus();await page.keyboard.press('Enter');
   eq(await details.getAttribute('open'),'','keyboard can expand the definitions');
   eq(await drawerFrame(page),fixed,'opening extra dictionary content leaves drawer geometry fixed');
   const content=page.locator('.soft-refresh-current');
   eq(await content.locator('.longman-ipa,.longman-example').count(),0,'both result sections omit phonetics and examples');
   ok(await content.evaluate(node=>{
    const ids=[...node.querySelectorAll('[data-sense-id]')].map(item=>item.dataset.senseId);
    return ids.length>3&&ids.length===new Set(ids).size;
   }),'additional definitions extend the overview without repeating any of its senses');
   if(phone&&viewport.width===390)await page.screenshot({path:`${output}/${theme}-dictionary-detail.png`});
   await content.evaluate(node=>{node.scrollTop=node.scrollHeight;});
   ok(await content.evaluate(node=>node.scrollTop>0),'long dictionary contents scroll inside the fixed drawer');
   eq(await drawerFrame(page),fixed,'scrolling the result leaves the card fixed');
   await page.evaluate(()=>{
    const panel=document.querySelector('.context-panel');
    window.__drawerFrames=[];
    const sample=()=>{const {x,y,width,height}=panel.getBoundingClientRect();window.__drawerFrames.push([x,y,width,height]);window.__drawerFrameHandle=requestAnimationFrame(sample);};
    window.__drawerFrameHandle=requestAnimationFrame(sample);
    window.__uiDelayExpression='plane';window.__uiLookupDelayMs=350;
   });
   await page.locator('.reading-word').filter({hasText:/^plane$/}).first().click();
   await page.locator('.soft-refresh[data-refresh-state=waiting]').waitFor();
   await lookupShown(page,'plane');
   await take.click();
   await lookupShown(page,'take');
   const frames=await page.evaluate(()=>{cancelAnimationFrame(window.__drawerFrameHandle);delete window.__uiDelayExpression;return window.__drawerFrames;});
   ok(frames.length>5&&frames.every(frame=>frame.every((value,index)=>Math.abs(value-fixed[index])<.25)),`${theme}/${viewport.width}: short/long lookups keep the drawer frame during loading and throughout reveal`);
   await page.locator('.lookup-tabs [data-testid=lookup-records-tab]').click();
   await page.waitForFunction(()=>document.querySelector('.lookup-tabs')?.dataset.tab==='records'&&document.querySelector('.soft-refresh')?.dataset.refreshState==='ready');
   eq(await drawerFrame(page),fixed,'switching to records keeps the same drawer size');
   await page.locator('.lookup-tabs [data-testid=lookup-meaning-tab]').click();
   await lookupShown(page,'take');
   const map=page.locator('.approved-lookup-map button');eq(await map.getAttribute('data-state'),'idle','supplement starts idle');await map.click();await page.waitForFunction(()=>document.querySelector('.approved-lookup-map button')?.dataset.state==='loading');eq(await map.getAttribute('aria-busy'),'true','supplement exposes real pending state');
   await page.locator('.approved-lookup-map button[data-state="missing"]').waitFor();eq(await page.locator('.soft-refresh-current .longman-meaning').first().innerText(),baseText,'no-new reply retains the original dictionary meaning');
   const beforeSizeControls=await geometry(page);
   if(phone){
    await page.locator('.context-sheet-expand').click();await page.locator('.context-panel[data-expanded="true"]').waitFor();await settled(page);eq(await geometry(page),beforeSizeControls,'expanded drawer preserves original geometry and scroll');
    await page.locator('.context-sheet-expand').click();await page.locator('.context-panel[data-expanded="false"]').waitFor();await settled(page);eq(await geometry(page),beforeSizeControls,'return to half drawer preserves original geometry and scroll');
   }
   await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await settled(page);if(phone)eq(await geometry(page),beforeSizeControls,'closed drawer preserves original geometry and scroll');
   await page.emulateMedia({reducedMotion:'reduce'});await take.click();await page.locator('.context-panel').waitFor();await settled(page);eq(await geometry(page),clickedGeometry,'reduced-motion drawer preserves original geometry');
   await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await settled(page);
   await page.evaluate(()=>window.__supplementMode='error');await take.click();await page.locator('.approved-lookup-map button').click();await page.locator('.approved-lookup-map button[data-state=error]').waitFor();eq(await page.locator('.soft-refresh-current .longman-meaning').first().innerText(),baseText,'supplement transport failure retains local meaning');await page.evaluate(()=>window.__supplementMode='success');await page.locator('.approved-lookup-map button').click();await page.locator('.approved-lookup-map button[data-state=ready]').waitFor();ok((await page.locator('.approved-supplement').innerText()).includes('补充的独立用法'),'success appends the additional meaning inside the same card');eq(await drawerFrame(page),fixed,'online content is added within the fixed frame');eq(await page.locator('.soft-refresh-current .longman-meaning').first().innerText(),baseText,'successful supplement also retains the original local meaning');await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${viewport.width}: no horizontal overflow with largest reading size`);
   if(viewport.width===390)await page.screenshot({path:`${output}/${theme}-large-reading.png`});
   await context.close();
  }
 }
 eq(h.errors,[],'no application errors');await writeFile(`${output}/report.json`,JSON.stringify({passed:true,checks,scope:'Chromium desktop and mobile emulation, real Rust command cores/disposable SQLite; not device acceptance'},null,2));console.log(`Mobile reading: ${checks.length} checks passed`);
}catch(e){await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw e;}finally{await h.dispose();}
