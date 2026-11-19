/** November polish: real disposable SQLite, controlled OS/service boundaries. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const out=process.env.LEXICUE_POLISH_OUTPUT||'/tmp/lexicue-polish';await mkdir(out,{recursive:true});
const h=await createReadingHarness(out);const checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);};
const settle=()=>page.waitForFunction(()=>!document.querySelector('.approved-handoff,.approved-reading-hold,.approved-saved-flight,.approved-tag-flight'));
try{
 for(const theme of ['sage','midnight'])for(const width of [1360,375]){
  await h.call('test_reset');await h.call('test_seed_recall',{count:1,records:[{expression:'air',sentence:'The air smelled of salt near the old pier. We waited for the next train.',explanation:'原有个人解释。',saved_at:Date.now()}]});
  const c=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768});page=await c.newPage();await h.fixture(page,theme);
  await page.goto(h.url+'/files');await page.evaluate(async()=>{const{useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const{useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files)d.getState().keepAndOpen(file);});await page.locator('.approved-card[data-desk-active=true]').waitFor();
  await page.locator('.approved-brand').click();await page.waitForFunction(()=>!document.documentElement.dataset.themeTransition);await page.locator('.approved-brand').click();await page.waitForFunction(()=>!document.documentElement.dataset.themeTransition);
  ok(await page.locator('.approved-card[data-desk-active=true]').isVisible(),'theme crossfade cleans up and preserves desk');
  await page.locator('.approved-card[data-desk-active=true] .approved-card-open').click();await page.locator('.reading-word').first().waitFor();await settle();
  await page.evaluate(async()=>{const{useReadingToolsStore}=await window.__uiStoreModule('readingToolsStore');useReadingToolsStore.setState({listening:true});});
  for(const rate of [.75,1,1.25,1.5]){await page.evaluate(async rate=>{const{useReadingToolsStore}=await window.__uiStoreModule('readingToolsStore');useReadingToolsStore.setState({listening:true,rate});},rate);ok(await page.locator('.playback-gauge-needle').evaluate(n=>{const point=new DOMPoint(12,13).matrixTransform(n.getScreenCTM()),center=new DOMPoint(12,13).matrixTransform(n.ownerSVGElement.getScreenCTM());return Math.abs(point.x-center.x)<.01&&Math.abs(point.y-center.y)<.01;}),'all speed positions keep the physical gauge pivot fixed');}
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-handoff').waitFor();
  await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().duration===580).forEach(a=>a.pause()));
  for(const time of [0,80,180,290,430,570]){
   await page.evaluate(time=>document.getAnimations().filter(a=>a.effect?.getTiming().duration===580).forEach(a=>a.currentTime=time),time);
   ok(await page.locator('.approved-handoff [data-motion-piece=title],.approved-handoff [data-motion-piece=quote]').count()===0,'return has no independently reflowing text layers');
   ok(await page.locator('.approved-handoff .approved-card-copy').evaluate(n=>{const title=n.querySelector('.approved-card-title').getBoundingClientRect(),quote=n.querySelector('.approved-card-quote').getBoundingClientRect();return title.bottom<=quote.top+1;}),`return text does not overlap at ${time}ms`);
   if(time===430)await page.screenshot({path:`${out}/${theme}-${width}-return.png`});
  }
  await page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().duration===580).forEach(a=>a.finish()));await settle();
  await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.approved-folio-note').waitFor();await settle();
  const sentence=page.locator('.approved-folio-sentence'),before=await sentence.boundingBox();
  await page.locator('.approved-folio-note').click();await page.locator('.approved-inline-note textarea').waitFor();
  ok(await sentence.evaluate(n=>!n.closest('.approved-inline-note')),'inline explanation remains outside the sentence typography');
  const after=await sentence.boundingBox();ok(Math.abs(before.width-after.width)<1&&Math.abs(before.height-after.height)<1,'opening explanation leaves sentence geometry stable');
  if(width<768){await page.setViewportSize({width:375,height:360});await page.waitForFunction(()=>document.querySelector('.approved-inline-note')?.getBoundingClientRect().bottom<=360);ok(await page.locator('.approved-inline-note').evaluate(n=>n.getBoundingClientRect().bottom<=360),'note controls fit the keyboard visual viewport');}
  await page.locator('.approved-inline-note').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:`${out}/${theme}-${width}-note.png`});await page.locator('.approved-inline-note textarea').fill('新的个人解释，保留原句。');await page.getByRole('button',{name:'保存解释',exact:true}).click();await page.locator('.approved-inline-note').waitFor({state:'detached'});
  ok((await h.call('list_saved_records',{query:'',limit:10,offset:0})).some(r=>r.explanation==='新的个人解释，保留原句。'),'note persists through actual Rust transaction');
  if(width<768)await page.setViewportSize({width:375,height:812});
  ok(await page.locator('input[type=date]').count()===0,'no precise date form');
  ok(await page.locator('.saved-timeline-period').count()===0,'single day has no date caption');
  if(width<768){
   const indexToggle=page.locator('.approved-index-toggle');
   const neutralIndex=()=>indexToggle.evaluate(n=>getComputedStyle(n).backgroundColor===getComputedStyle(n.closest('.approved-saved')).backgroundColor);
   await indexToggle.hover();ok(await neutralIndex(),'index arrow hover keeps the page background in both themes');
   await indexToggle.click();ok(await neutralIndex(),'expanded index arrow has no selected background');
   ok(await indexToggle.getAttribute('aria-expanded')==='true','index arrow expands without a selected surface');
   await indexToggle.click();ok(await neutralIndex(),'collapsed index arrow has no sticky touch-hover surface');
  }
  const halo=await page.locator('.approved-folio-speech').evaluate(n=>({overflow:getComputedStyle(n).overflow,inset:getComputedStyle(n,'::before').inset,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height}));
  ok(halo.overflow==='visible'&&halo.width===halo.height,'speech button provides a complete square wave canvas');
  await page.goto(h.url+'/settings?section=lookup');await page.locator('.approved-dictionary-book').first().waitFor();
  ok(await page.getByRole('checkbox',{name:'再遇提示',exact:true}).count()===0,'retired online hint control absent');
  ok(await page.locator('.approved-dictionary-menu').count()===0,'dictionary covers have no ellipsis menu');
  const status=await h.call('dictionary_pack_status');await page.evaluate(status=>{const base=window.__TAURI_INTERNALS__.invoke;window.__packFixture={...status,busy:true,operation:{id:'specialist',phase:'downloading',completed:50,total:100}};window.__TAURI_INTERNALS__.invoke=(cmd,args)=>cmd==='dictionary_pack_status'?Promise.resolve(window.__packFixture):base(cmd,args);document.dispatchEvent(new Event('visibilitychange'));},status);
  await page.locator('[data-pack=specialist] [role=progressbar][aria-valuenow="50"]').waitFor();await page.screenshot({path:`${out}/${theme}-${width}-dictionary.png`});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dictionary progress fits viewport');
  await page.goto(h.url+'/files');await page.evaluate(async()=>{const{useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const{useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files)d.getState().keepAndOpen(file);});await page.locator('.approved-card[data-desk-active=true]').waitFor();await page.evaluate(async()=>{const{useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');const{useMaterialStore:m}=await window.__uiStoreModule('materialStore');for(const file of m.getState().files)d.getState().archive(file);});
  await page.locator('.approved-empty-material').waitFor();ok((await h.call('test_counts')).files>0,'approved greeting appears on empty desk while archived library remains intact');await c.close();
 }
 assert.deepEqual(h.errors,[]);await writeFile(`${out}/evidence.json`,JSON.stringify({passed:true,checks,scope:'Chromium desktop/mobile, real Rust/SQLite; native viewport and dictionary progress boundaries controlled'},null,2));console.log(`Polish: ${checks.length} checks passed`);
}catch(e){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e;}finally{await h.dispose();}
