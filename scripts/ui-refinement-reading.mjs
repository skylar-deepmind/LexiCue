/** Actual React application + production Rust/Longman/temporary SQLite.
 * Native results are held after completion to exercise real selection races. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/ui-refinement-v2-20261027/reading`;
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output);
const checks=[],observations=[];
const check=(value,label)=>{assert.ok(value,label);checks.push(label);};
const current=page=>page.locator('.soft-refresh > .soft-refresh-current');
const word=(page,text)=>page.locator('.reading-word').filter({hasText:new RegExp(`^${text}$`)}).first();
const release=page=>page.evaluate(()=>{for(const value of window.__refreshHeld.splice(0))value.resolve();});
async function ready(page,text){
 await page.getByRole('dialog',{name:text,exact:true}).waitFor();
 await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();
 await page.waitForFunction(()=>document.querySelector('.soft-refresh')?.dataset.refreshState==='ready');
}
try {
 await h.call('test_reset');
 check((await h.call('longman_dictionary_status')).state==='ready','genuine local Longman package ready');
 const token=crypto.randomUUID();
 const material=await h.call('import_reading_material',{input:{operation_id:`refresh-v2-${token}`,name:'UI refinement reading.txt',content:'We will take off after noon. Curiosity helps us record the record.',segments:[{index:0,en_text:'We will take off after noon. Curiosity helps us record the record.',zh_text:'我们将在中午之后起飞。',start_time:null,end_time:null}]}});
 for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext({viewport:{width:1120,height:820}});
  const page=await context.newPage();await h.fixture(page,theme);
  await page.addInitScript(()=>{
   window.__refreshHeld=[];window.__refreshHold=[];window.__refreshFailed=[];
   const invoke=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='lookup_cambridge_expression'&&window.__refreshHoldCambridge)await new Promise(resolve=>window.__refreshCambridgeRelease=resolve);
    if(command==='lookup_cambridge_expression')return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'unavailable',default_entry_id:null,entries:[],notices:[]};
    if(command==='lookup_longman_expression'&&window.__refreshFailed.includes(args.expression))throw Error('explicit lookup failure');
    const value=await invoke(command,args);
    if(command==='lookup_longman_expression'&&window.__refreshHold.includes(args.expression))await new Promise(resolve=>window.__refreshHeld.push({expression:args.expression,resolve}));
    return value;
   };
  });
  await page.goto(`${h.url}/files/${material.file_id}`);await word(page,'noon').click();await ready(page,'noon');
  await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
  await page.evaluate(()=>window.__refreshPanel=document.querySelector('.context-panel'));
  const frame=await page.locator('.context-panel').boundingBox();
  await page.evaluate(()=>window.__refreshHold=['take']);await word(page,'take').click();
  await page.waitForFunction(()=>window.__refreshHeld.some(value=>value.expression==='take'));
  check(await page.locator('.soft-refresh-ghost h2').innerText()==='noon',`${theme}: completed old word remains visible during held native result`);
  check(await current(page).getAttribute('inert')==='',`${theme}: pending child cannot receive focus or edits`);
  check(await current(page).getAttribute('aria-hidden')==='true',`${theme}: pending child is absent from accessibility tree`);
  check(await page.locator('.soft-refresh-ghost').getAttribute('aria-hidden')==='true'&&await page.locator('.soft-refresh-ghost').getAttribute('inert')==='',`${theme}: visual old content is inert and hidden from assistive technology`);
  check(await page.locator('.lookup-pending').innerText()==='take · 加载中...',`${theme}: loading feedback explicitly identifies new target`);
  check(await page.locator('.soft-refresh-ghost [id]').count()===0,`${theme}: outgoing clone has no duplicate IDs`);
  check(await page.locator('.soft-refresh-ghost .lookup-footer').count()===0,`${theme}: actions are outside the outgoing visual layer`);
  check(await page.locator('.lookup-footer .saved-primary').isEnabled(),`${theme}: optional dictionary latency does not gate saving original context`);
  await page.locator('.lookup-footer .saved-primary').click();await page.locator('.lookup-footer .lookup-saved').waitFor();
  const saved=(await h.call('list_saved_records',{query:'take',limit:100,offset:0})).find(record=>record.expression==='take');
  check(saved?.source?.start_offset===8&&saved?.source?.end_offset===12,`${theme}: save while waiting targets newly selected exact span`);
  await page.locator('.lookup-footer .lookup-saved button').click();await page.locator('.lookup-footer .saved-primary').waitFor();
  const during=await page.locator('.context-panel').boundingBox();
  check(['x','y','width','height'].every(key=>Math.abs(frame[key]-during[key])<1),`${theme}: frame position and size remain stable while loading`);
  await page.locator('.lookup-footer .saved-primary').focus();await page.keyboard.press('Tab');
  check(await page.locator('.lookup-footer .saved-primary').evaluate(node=>node===document.activeElement),`${theme}: keyboard loop excludes inert outgoing and pending controls`);
  await page.screenshot({path:`${output}/${theme}-pending.png`});
  await release(page);
  await page.waitForFunction(()=>document.querySelector('.soft-refresh')?.dataset.refreshState==='revealing');
  const transition=await current(page).evaluate(node=>({mask:node.style.maskImage,webkitMask:node.style.webkitMaskImage,edge:document.querySelector('.soft-refresh-edge').getBoundingClientRect().width,blur:getComputedStyle(document.querySelector('.soft-refresh-edge')).backdropFilter}));
  check(transition.mask.includes('to right')&&transition.webkitMask.includes('to right')&&transition.edge===160&&transition.blur==='blur(2.5px)',`${theme}: real incoming content uses horizontal mask, WebKit mask and 160px feather band`);
  observations.push({theme,transition});await page.screenshot({path:`${output}/${theme}-revealing.png`});
  await ready(page,'take');
  check(await page.locator('.soft-refresh-ghost > *').count()===0&&await current(page).evaluate(node=>node.style.maskImage==='none'),`${theme}: transition cleans the single ghost and restores sharp text`);
  check(await page.evaluate(()=>window.__refreshPanel===document.querySelector('.context-panel')),`${theme}: reading panel stays mounted across word replacement`);
  // Both requests complete in the native layer; only the last selection may render.
  await page.evaluate(()=>window.__refreshHold=['record','Curiosity']);await word(page,'record').click();
  await page.waitForFunction(()=>window.__refreshHeld.some(value=>value.expression==='record'));
  await word(page,'Curiosity').click();await page.waitForFunction(()=>window.__refreshHeld.some(value=>value.expression==='Curiosity'));
  check(await page.locator('.soft-refresh-ghost > *').count()===1,`${theme}: rapid switch retains one outgoing layer without nesting`);
  await page.evaluate(()=>{window.__refreshHold=[];const held=window.__refreshHeld.find(value=>value.expression==='Curiosity');held.resolve();window.__refreshHeld=window.__refreshHeld.filter(value=>value!==held);});
  await ready(page,'Curiosity');await release(page);await page.waitForTimeout(80);
  check((await current(page).locator('h2').innerText()).toLowerCase()==='curiosity',`${theme}: late successful record response cannot overwrite last selection`);
  // Return to the last displayed identity while another request is pending.
  await page.evaluate(()=>window.__refreshHold=['record','Curiosity']);await word(page,'record').click();
  await page.waitForFunction(()=>window.__refreshHeld.some(value=>value.expression==='record'));
  await word(page,'Curiosity').click();await page.waitForFunction(()=>window.__refreshHeld.some(value=>value.expression==='Curiosity'));
  check(await current(page).getAttribute('inert')===''&&(await page.locator('.soft-refresh-ghost h2').innerText()).toLowerCase()==='curiosity',`${theme}: A→B→A still waits for fresh A child without skeleton flash`);
  await page.evaluate(()=>window.__refreshHold=[]);await release(page);await ready(page,'Curiosity');
  // A failed new lookup must replace the old content with its own failure controls.
  await page.evaluate(()=>{window.__refreshFailed=['record'];window.__refreshHoldCambridge=true;});await word(page,'record').click();
  await page.waitForFunction(()=>!!window.__refreshCambridgeRelease);
  check(await current(page).getAttribute('inert')===''&&await page.locator('.soft-refresh-ghost h2').count()===1,`${theme}: missing local result retains old content until online fallback settles`);
  await page.evaluate(()=>{window.__refreshHoldCambridge=false;window.__refreshCambridgeRelease();window.__refreshCambridgeRelease=null;});await ready(page,'record');
  check(await current(page).locator('h2').innerText()==='record'&&await current(page).locator('.longman-notice').count()>0,`${theme}: failure shows the latest target and honest failure feedback`);
  check(await page.locator('.soft-refresh-ghost > *').count()===0,`${theme}: failed request does not strand old success content`);
  await page.evaluate(()=>window.__refreshFailed=[]);await current(page).getByRole('button',{name:'重试',exact:true}).click();
  await current(page).locator('.dictionary-overview').waitFor();
  await current(page).locator('.dictionary-more > summary').click();
  const oldScroll=await current(page).locator('.lookup-body').evaluate(node=>{node.scrollTop=120;return {top:node.scrollTop,scrollable:node.scrollHeight>node.clientHeight};});
  check(oldScroll.scrollable&&oldScroll.top>0,`${theme}: long real dictionary result remains scrollable`);
  await page.evaluate(()=>window.__refreshHold=['noon']);await word(page,'noon').click();await page.waitForFunction(()=>window.__refreshHeld.length>0);
  check(await page.locator('.soft-refresh-ghost .lookup-body').evaluate(node=>node.scrollTop)===oldScroll.top,`${theme}: outgoing visual snapshot retains dictionary scroll position`);
  await page.evaluate(()=>window.__refreshHold=[]);await release(page);await ready(page,'noon');
  check(await current(page).locator('.lookup-body').evaluate(node=>node.scrollTop)===0,`${theme}: fresh word retains prior reset-to-top scroll semantics`);
  await word(page,'record').click();await ready(page,'record');
  // Existing per-query drafts survive a round trip through another word.
  await current(page).getByRole('button',{name:'补充个人解释',exact:true}).click();
  await current(page).locator('textarea').fill(`draft-${theme}`);
  await word(page,'noon').click();await ready(page,'noon');await word(page,'record').click();await ready(page,'record');
  check(await current(page).locator('textarea').inputValue()===`draft-${theme}`,`${theme}: personal draft survives content replacement`);
  await page.emulateMedia({reducedMotion:'reduce'});await word(page,'noon').click();await ready(page,'noon');
  check(await page.locator('.soft-refresh-ghost > *').count()===0&&await current(page).evaluate(node=>node.style.maskImage==='none')&&await page.locator('.soft-refresh-edge').isHidden(),`${theme}: reduced motion switches directly without feather movement`);
  for(const viewport of [{width:800,height:600},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(360);
   check(await page.locator('.context-panel').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}),`${theme}: real lookup fits ${viewport.width}x${viewport.height}`);
   check(await page.locator('.lookup-footer').evaluate(node=>{const r=node.getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0;}),`${theme}: current save action stays visible at ${viewport.width}x${viewport.height}`);
   await page.screenshot({path:`${output}/${theme}-${viewport.width}-lookup.png`});
  }
  await page.setViewportSize({width:1120,height:820});await page.waitForTimeout(360);
  // Dispose a pending request after route departure.
  await page.evaluate(()=>window.__refreshHold=['record']);await word(page,'record').click();await page.waitForFunction(()=>window.__refreshHeld.length>0);
  await page.locator('.b-dock a[href="/files"]').click();await page.locator('.materials-page').waitFor();await release(page);
  check(await page.locator('.context-panel,.soft-refresh-ghost').count()===0,`${theme}: leaving the page disposes pending content and temporary layers`);
  await context.close();
 }
 check(h.errors.length===0,`no browser exceptions: ${h.errors.join('; ')}`);
 await writeFile(`${output}/results.json`,JSON.stringify({passed:true,checks,observations,backend:'Real React + real Rust command cores and Longman package; disposable SQLite. Results held after native completion for races. Cambridge unavailable boundary used for deterministic local-error checks.',errors:h.errors},null,2));
 console.log(`Reading refinement: ${checks.length} checks passed. Evidence: ${output}`);
} finally {await h.dispose();}
