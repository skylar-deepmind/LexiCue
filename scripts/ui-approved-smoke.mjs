/** Approved two-platform UI against actual Rust commands and disposable SQLite. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_APPROVED_UI_OUTPUT||'/tmp/lexicue-approved-ui';await mkdir(output,{recursive:true});
const harness=await createReadingHarness(output);const {browser,url,call,fixture,errors}=harness;
let checks=0,current;const ok=(v,s)=>{assert.ok(v,s);checks++;},eq=(a,b,s)=>{assert.deepEqual(a,b,s);checks++;};
try{
 await call('test_reset');
 const tag=await call('create_tag',{name:'Coast'});
 for(let i=0;i<14;i++){
  const lines=['I stood at the edge of the water and waited.','The air smelled of salt near the old pier.','We finally had time to catch up on the night train.',`I will take this path again tomorrow. Material ${i+1}.`];
  if(i%2)lines.push(...Array.from({length:8},(_,n)=>`A longer paragraph number ${n+1} gives us time to read and reflect on the day.`));
  const value=await call('import_reading_material',{input:{operation_id:`approved-fixture-${i}`,name:`${['After the Tide','Night Walk','Market Day','Shore Notes'][i%4]} ${i+1}.txt`,content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:'我们沿着海边阅读，记下句子里的想法。',start_time:null,end_time:null})),normalized_kind:'txt',tag_ids:[tag]}});
  if(i<3){const data=await call('open_reading_material',{fileId:value.file_id});for(const [segmentIndex,expression] of [[1,'air'],[2,'catch up']]){const segment=data.segments[segmentIndex],start=segment.en_text.indexOf(expression);await call('mutate_saved_record',{operationId:`approved-save-${i}-${segmentIndex}`,mutation:{kind:'save',input:{segment_id:segment.id,expression,start_offset:start,end_offset:start+expression.length,explanation:'保留真实原句的个人解释。',explanation_source:'personal'}}});}}
 }
 for(const theme of ['sage','midnight'])for(const width of [1360,390,320,430]){
  const height=width===1360?880:width===320?668:width===430?932:844;
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<768});const page=await context.newPage();current=page;await fixture(page,theme);
  await page.goto(`${url}/files`);await page.evaluate(async()=>{const {useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const {useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files.slice(0,5).reverse())d.getState().keepAndOpen(file);});await page.locator('.approved-card[data-desk-active="true"]').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const rect=await page.locator('.approved-card[data-desk-active="true"]').boundingBox();ok(rect.x>=0&&rect.x+rect.width<=width,'home card stays within viewport');
  eq(Math.round(rect.width),width===1360?560:Math.round(Math.min(width*.79,370)),'approved card width');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal document overflow');
  await page.screenshot({path:`${output}/${theme}-${width}-home.png`});
  await page.getByRole('button',{name:'材料库',exact:true}).click();await page.locator('.approved-tag-panel').waitFor();
  await page.getByRole('button',{name:'Coast · 14',exact:true}).click();await page.locator('.approved-poster').first().waitFor();
  if(width<768){eq(await page.locator('.approved-phone-column').count(),2,'two vertical poster columns');await page.locator('.approved-wall-viewport').evaluate(node=>{node.scrollTop=420;});}
  await page.screenshot({path:`${output}/${theme}-${width}-wall.png`});
  const wallPosition=await page.locator('.approved-wall-viewport').evaluate(n=>({x:n.scrollLeft,y:n.scrollTop}));
  const visibleId=await page.locator('.approved-poster').evaluateAll(nodes=>nodes.find(n=>{const r=n.getBoundingClientRect();return r.top>=90&&r.bottom<=innerHeight-50;})?.getAttribute('data-motion-file'));
  const poster=visibleId?page.locator(`[data-motion-file="${visibleId}"]`):page.locator('.approved-poster').first(),fileId=Number(await poster.getAttribute('data-motion-file'));
  await poster.locator('button').click();await page.waitForURL(/\/files\/\d+/);
  await page.locator('.approved-handoff').waitFor();ok(await page.locator('.approved-handoff').evaluate(n=>n.getAnimations({subtree:true}).some(a=>a.effect.getTiming().duration===1320)),'wall transition uses its 1320 ms timeline');
  await page.waitForFunction(()=>!document.querySelector('.approved-handoff'));await page.locator('.reading-original').first().waitFor();
  eq(await page.locator('.reading-title').count(),1,'one material title');
  const word=page.locator('.reading-word').filter({hasText:/^air$/}).first();
  const prose=await page.locator('.reading-original').first().evaluate(n=>({width:n.getBoundingClientRect().width,font:getComputedStyle(n).fontSize,line:getComputedStyle(n).lineHeight}));
  await word.click();await page.locator('.context-panel').waitFor();await page.waitForFunction(()=>!document.querySelector('.reading-layout[data-lookup-moving]'));
  if(width<768){const after=await page.locator('.reading-original').first().evaluate(n=>({width:n.getBoundingClientRect().width,font:getComputedStyle(n).fontSize,line:getComputedStyle(n).lineHeight}));eq(after,prose,'opening dictionary preserves prose geometry');}
  await page.screenshot({path:`${output}/${theme}-${width}-lookup.png`});
  await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});
  if(width<768)await page.evaluate(()=>{const focus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(options){focus.call(this,options);const view=this.closest('.approved-wall-viewport');if(view&&options?.preventScroll)requestAnimationFrame(()=>view.scrollTop+=65);};});
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-wall').waitFor();await page.waitForFunction(()=>!document.querySelector('.approved-handoff'));
  ok(await page.locator(`[data-motion-file="${fileId}"]`).count(),'return retains source poster');
  const restored=await page.locator('.approved-wall-viewport').evaluate(n=>({x:n.scrollLeft,y:n.scrollTop}));ok(Math.abs(restored.x-wallPosition.x)<2&&Math.abs(restored.y-wallPosition.y)<2,'wall returns to exact scroll position');
  await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.approved-tag-panel').waitFor();await page.keyboard.press('Escape');await page.locator('.approved-tag-panel').waitFor({state:'detached'});
  await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.approved-saved-folio').waitFor();await page.waitForFunction(()=>!document.documentElement.dataset.dissolve&&!document.querySelector('.approved-saved-flight'));
  eq(await page.locator('.approved-saved-folio').count(),1,'only current sentence is presented');
  ok((await page.locator('.approved-folio-translation').textContent()).length>0,'translation is visible by default');
  await page.screenshot({path:`${output}/${theme}-${width}-saved.png`});
  const selected=await page.locator('.approved-saved-word[aria-pressed="true"]').getAttribute('data-group');
  const source=page.locator('.approved-source-title');await source.click();await page.waitForURL(/\/files\/\d+/);await page.locator('[data-source-highlight="true"]').waitFor();
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-saved-folio').waitFor();eq(await page.locator('.approved-saved-word[aria-pressed="true"]').getAttribute('data-group'),selected,'source return restores selected entry');
  await page.locator('.approved-saved-header').getByRole('button',{name:'返回',exact:true}).click();await page.locator('.approved-desk').waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-settings').waitFor();
  await page.locator('[data-entry="lookup"]').click();await page.locator('.approved-dictionary-book').first().waitFor();eq(await page.locator('.approved-dictionary-book').count(),3,'three real dictionary books');
  await page.screenshot({path:`${output}/${theme}-${width}-books.png`});
  await context.close();
 }
 eq(errors,[],'no browser exceptions');
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks,themes:['sage','midnight'],widths:[1360,390,320,430],scope:'Chromium browser emulation with real Rust/SQLite command cores; not physical-device acceptance'},null,2));
 console.log(`Approved UI: ${checks} checks passed. ${output}`);
}catch(error){if(current&&!current.isClosed()){await current.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await current.locator('body').innerText(),url:current.url()},null,2));}throw error;}finally{await harness.dispose();}
