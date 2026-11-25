/** Approved two-platform UI against actual Rust commands and disposable SQLite. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createReadingHarness, openSelectedSavedExpression } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_APPROVED_UI_OUTPUT||'/tmp/lexicue-approved-ui';await mkdir(output,{recursive:true});
const harness=await createReadingHarness(output);const {browser,url,call,fixture,errors}=harness;
let checks=0,current;const ok=(v,s)=>{assert.ok(v,s);checks++;},eq=(a,b,s)=>{assert.deepEqual(a,b,s);checks++;};
try{
 await call('test_reset');
 const tag=await call('create_tag',{name:'Coast'});
 for(let i=0;i<14;i++){
  const lines=['I stood at the edge of the water and waited.','The air smelled of salt near the old pier.','We finally had time to catch up on the night train.',`I will take this path again tomorrow. Material ${i+1}.`];
  if(i%2)lines.push(...Array.from({length:8},(_,n)=>`A longer paragraph number ${n+1} gives us time to read and reflect on the day.`));
  const title=i===1 ? 'A Very Long Title About the Lighthouse and the Story of the Old Harbor Beyond the Coastal Road' : `${['After the Tide','Night Walk','Market Day','Shore Notes'][i%4]} ${i+1}`;
  const value=await call('import_reading_material',{input:{operation_id:`approved-fixture-${i}`,name:`${title}.txt`,content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:'我们沿着海边阅读，记下句子里的想法。',start_time:null,end_time:null})),normalized_kind:'txt',tag_ids:[tag]}});
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
  await page.getByRole('button',{name:'Coast · 14',exact:true}).click();
  if(width>=768){
    const deal=page.locator('.approved-poster-deal');
    await deal.waitFor();
    ok(await page.locator('.approved-wall-viewport[data-dealing]').count()===1,'entering a desktop label deals its visible posters');
    ok(await deal.evaluate(layer=>{
      const flights=layer.getAnimations({subtree:true});
      const lead=flights.find(flight=>flight.effect.getTiming().duration===410);
      const columns=flights.filter(flight=>flight.effect.getTiming().duration===510);
      return lead?.effect.getKeyframes()[0].transform.includes('rotate(')
        && columns.every(flight=>flight.effect.getKeyframes()[0].transform.startsWith('translateY('))
        && new Set(columns.map(flight=>flight.effect.getTiming().delay)).size>1;
    }),'the first poster flies out from the label and columns rise in sequence');
    await deal.waitFor({state:'detached'});
  }
  await page.locator('.approved-poster').first().waitFor();
  if(width>=768){
    eq(await page.locator('.approved-projector').count(),0,'desktop poster wall omits the projector');
    const long=page.locator('.approved-poster').filter({hasText:'A Very Long Title'});
    ok(await long.evaluate(poster=>{
      const title=poster.querySelector('strong'), cover=poster.querySelector('img');
      const text=getComputedStyle(title), bounds=poster.getBoundingClientRect();
      return text.webkitLineClamp==='2' && parseFloat(text.fontSize)<=20
        && cover.getBoundingClientRect().height>=bounds.height*.58
        && poster.querySelector('button').title===title.textContent;
    }),'long desktop titles keep the cover visible and expose the full title on hover');
    const controls=page.locator('.approved-poster-scales');
    eq(await controls.locator('button').count(),3,'desktop wall has three graphically distinct scales');
    const medium=await page.locator('.approved-poster-column').count();
    await controls.getByRole('button',{name:'大图',exact:true}).click();
    await page.locator('.approved-wall-viewport[data-reflowing]').waitFor();
    ok(await page.locator('.approved-poster').evaluateAll(posters=>posters.some(p=>p.getAnimations().some(a=>a.effect.getTiming().duration===390))),'scale changes visually move and resize existing posters');
    ok(await page.locator('.approved-poster-column').count()>medium,'large posters fit fewer materials per column');
    await controls.getByRole('button',{name:'密集',exact:true}).click();
    ok(await page.locator('.approved-poster-column').count()<medium,'compact scale fits more materials per column');
    await controls.getByRole('button',{name:'大图',exact:true}).click();
    const wall=page.locator('.approved-wall-viewport');
    await wall.hover();
    await page.mouse.wheel(0,360);
    await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector('.approved-poster-plane')).transform).m41 < -40);
    await wall.press('Home');
    await page.waitForFunction(()=>Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.approved-poster-plane')).transform).m41)<1);
    ok(true,'the mouse wheel and keyboard navigate the wall after removing the projector');
  }
  if(width<768){eq(await page.locator('.approved-poster-scales').count(),0,'phone retains its two-column browsing');eq(await page.locator('.approved-phone-column').count(),2,'two vertical poster columns');await page.locator('.approved-wall-viewport').evaluate(node=>{node.scrollTop=420;});}
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
  await page.getByRole('button',{name:'已保存',exact:true}).click();await openSelectedSavedExpression(page);await page.waitForFunction(()=>!document.documentElement.dataset.dissolve&&!document.querySelector('.approved-saved-flight'));
  ok(await page.locator('.approved-saved-folio').count()>0,'selected expression presents its saved contexts');
  ok((await page.locator('.approved-folio-translation').first().textContent()).length>0,'translation is visible by default');
  await page.screenshot({path:`${output}/${theme}-${width}-saved.png`});
  const selected=await page.locator('.approved-saved-word[aria-pressed="true"]').getAttribute('data-group');
  const source=page.locator('.approved-source-title').first();await source.click();await page.waitForURL(/\/files\/\d+/);await page.locator('[data-source-highlight="true"]').waitFor();
  await page.locator('.reading-breadcrumb .page-back').click();await openSelectedSavedExpression(page);eq(await page.locator('.approved-saved-word[aria-pressed="true"]').getAttribute('data-group'),selected,'source return restores selected entry');
  const savedBack=page.locator('.approved-saved-header .approved-back');await savedBack.click();if(width<768)await savedBack.click();await page.locator('.approved-desk').waitFor();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-settings').waitFor();
  await page.locator('[data-entry="lookup"]').click();await page.locator('.approved-dictionary-book').first().waitFor();eq(await page.locator('.approved-dictionary-book').count(),3,'three real dictionary books');
  await page.screenshot({path:`${output}/${theme}-${width}-books.png`});
  await context.close();
 }
 eq(errors,[],'no browser exceptions');
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks,themes:['sage','midnight'],widths:[1360,390,320,430],scope:'Chromium browser emulation with real Rust/SQLite command cores; not physical-device acceptance'},null,2));
 console.log(`Approved UI: ${checks} checks passed. ${output}`);
}catch(error){if(current&&!current.isClosed()){await current.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await current.locator('body').innerText(),url:current.url()},null,2));}throw error;}finally{await harness.dispose();}
