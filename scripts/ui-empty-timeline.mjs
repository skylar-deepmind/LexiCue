/** Accepted empty-state artwork and date-density statistics, with disposable SQLite. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_EMPTY_TIMELINE_OUTPUT||'/tmp/lexicue-empty-timeline';
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output);let current,checks=0;
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const finish=()=>current.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>a.finish()));
const screen=async name=>{await finish();await current.screenshot({path:`${output}/${name}.png`});};
const base=Date.UTC(2026,9,7,12);
async function seed(counts,days=counts.map((_,i)=>i)){
 await h.call('test_reset');const records=[];
 counts.forEach((count,i)=>{for(let j=0;j<count;j++)records.push({expression:'air',sentence:`The air smelled of salt near the old pier, memory ${i}-${j}.`,explanation:'海边空气的原句。',saved_at:days[i]===null?null:base+days[i]*86400000});});
 await h.call('test_seed_recall',{count:records.length,records});
 return records.length;
}
async function refresh(phase,total){
 await current.evaluate(()=>window.dispatchEvent(new Event('lexicue-saved-changed')));
 await current.waitForFunction(({phase,total})=>{const n=document.querySelector('.saved-growing-timeline');return n?.dataset.phase===phase&&Number(n.dataset.records)===total;},{phase,total});
 await finish();
}
try{
 const receipt=JSON.parse(await readFile(new URL('../public/design/empty-material/asset.json',import.meta.url),'utf8'));
 const gif=await readFile(new URL('../public/design/empty-material/greeting-once.gif',import.meta.url));
 ok(!gif.includes(Buffer.from('NETSCAPE2.0'))&&!gif.includes(Buffer.from('ANIMEXTS1.0')),'shipping GIF has no repeat extension');eq(receipt.durationMs,6160,'one-shot playback uses the approved duration');
 for(const theme of ['sage','midnight'])for(const [width,height]of [[1360,880],[375,812],[320,568],[812,375]]){
  await h.call('test_reset');const context=await h.browser.newContext({viewport:{width,height},hasTouch:width<1024,timezoneId:'UTC'});const page=await context.newPage();current=page;await h.fixture(page,theme);
  await page.goto(h.url+'/files');const empty=page.locator('.approved-empty-material');await empty.waitFor();
  eq(await empty.getAttribute('data-playback'),'playing','new empty episode plays the greeting');ok((await empty.locator('img').getAttribute('src')).endsWith('greeting-once.gif'),'approved GIF is used, not an improvised puppet');
  await empty.locator('img').evaluate(n=>n.decode());const bounds=await empty.locator('img').boundingBox(),head=await page.locator('.approved-home-header').boundingBox();
  ok(bounds.x>=0&&bounds.x+bounds.width<=width,'empty art fits the viewport');ok(bounds.y>=head.y+head.height-1,'empty art stays below the import controls');ok(bounds.y+bounds.height<height-40,'empty art clears the bottom safe area');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'empty screen has no horizontal overflow');
  if(theme==='sage'&&width===1360){await page.waitForFunction(()=>document.querySelector('.approved-empty-material')?.dataset.playback==='waiting',{},{timeout:8500});ok((await empty.locator('img').getAttribute('src')).endsWith('waiting.png'),'completed GIF becomes the identical static final frame');}
  await screen(`${theme}-${width}-empty`);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-settings').waitFor();await page.getByRole('button',{name:'返回',exact:true}).first().click();await empty.waitFor();eq(await empty.getAttribute('data-playback'),'waiting','SPA return does not restart the greeting');
  await page.locator('.approved-brand').click();eq(await empty.getAttribute('data-playback'),'waiting','theme change does not restart the GIF');
  if(width===375){const n=await seed([1]);eq(n,1,'rearm fixture contains real material');await page.evaluate(async()=>{const{useMaterialStore}=await window.__uiStoreModule('materialStore');await useMaterialStore.getState().load();const{useReadingDeskStore}=await window.__uiStoreModule('readingDeskStore');useReadingDeskStore.getState().keepAndOpen(useMaterialStore.getState().files[0]);});await empty.waitFor({state:'detached'});const material=(await h.call('list_materials'))[0];await h.call('test_delete_source',{fileId:material.id});await page.evaluate(async()=>{const{useMaterialStore}=await window.__uiStoreModule('materialStore');useMaterialStore.getState().changed();});await empty.waitFor();eq(await empty.getAttribute('data-playback'),'playing','a later genuinely empty library can greet once again');}
  await context.close();
 }
 // Respect system motion settings on the very first render; no GIF is requested.
 await h.call('test_reset');{
  const c=await h.browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'}),page=await c.newPage();current=page;await h.fixture(page,'midnight');const gifs=[];page.on('request',r=>{if(r.url().endsWith('greeting-once.gif'))gifs.push(r.url());});await page.goto(h.url+'/files');await page.locator('.approved-empty-material[data-playback=waiting]').waitFor();eq(gifs,[],'reduced motion skips the animated asset entirely');await c.close();
 }
 for(const theme of ['sage','midnight'])for(const width of [1360,375]){
  await h.call('test_reset');const c=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768,timezoneId:'UTC'}),page=await c.newPage();current=page;await h.fixture(page,theme);await page.goto(h.url+'/saved');await page.locator('.saved-growing-timeline[data-phase=empty]').waitFor();
  const count=async value=>{await page.waitForFunction(value=>document.querySelector('.saved-timeline-count')?.textContent===`${value} 条记录`,value);};
  await count(0);eq(await page.locator('.saved-timeline-date').count(),0,'zero data invents no calendar date');eq(await page.locator('.saved-timeline-plot').count(),0,'zero data has no plot');
  const compact=(await page.locator('.saved-growing-timeline').boundingBox()).height;
  await seed([2],[null]);await refresh('empty',0);await count(2);eq(await page.locator('.saved-timeline-date').count(),0,'undated legacy records retain their visible count without fake dates');
  await seed([1]);await refresh('seed',1);await count(1);eq(await page.locator('.saved-timeline-date').getAttribute('datetime'),'2026-10-07','one date shows the actual saved date');eq(await page.locator('.saved-timeline-plot').count(),0,'one date uses a summary instead of a plot');await screen(`${theme}-${width}-single-record`);
  await seed([100]);await refresh('seed',100);await count(100);eq((await page.locator('.saved-growing-timeline').boundingBox()).height,compact,'the same-day count stays compact as it grows');
  await seed([1,1,1],[0,4,9]);await refresh('dots',3);let x=await page.locator('.saved-timeline-mark').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return b.x+b.width/2;}));ok(Math.abs((x[1]-x[0])/(x[2]-x[0])-4/9)<.01,'date gaps remain chronological and proportional');eq(await page.locator('.saved-timeline-mark').count(),3,'empty days do not appear as false saved records');await screen(`${theme}-${width}-dots`);
  await seed([1,2,3,4,5,6,7]);await refresh('stems',28);const stemHeights=await page.locator('.saved-timeline-mark').evaluateAll(nodes=>nodes.map(n=>n.getBBox().height));ok(stemHeights[6]>stemHeights[0]&&stemHeights[6]<48,'dates grow into short stems before dense bars');
  const total=await seed(Array.from({length:28},(_,i)=>i%7+1));await refresh('band',total);eq(await page.locator('.saved-timeline-mark').count(),28,'dense dates form a band of the same marks');ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dense dates fit the viewport');await screen(`${theme}-${width}-band`);
  eq(await page.locator('input[type=date]').count(),0,'range selection exposes no precise date form');
  const plot=await page.locator('.saved-timeline-plot').boundingBox();
  await page.mouse.move(plot.x+22+(plot.width-44)*14/27,plot.y+30);await page.mouse.down();await page.mouse.move(plot.x+plot.width-22,plot.y+30,{steps:12});await page.mouse.up();
  await page.locator('.saved-timeline-reset').waitFor();await count(56);
  await page.waitForFunction(()=>window.__uiCalls.some(c=>c.command==='list_saved_groups'&&c.args.startMs===Date.UTC(2026,9,21)));
  ok((await h.call('list_saved_groups',{query:'',limit:200,offset:0,startMs:Date.UTC(2026,9,21)})).total_records===56,'drag range agrees with actual native counts');
  await page.locator('.saved-timeline-reset').click();await page.locator('.saved-timeline-reset').waitFor({state:'detached'});
  await count(total);
  const graphHeight=(await page.locator('.saved-growing-timeline').boundingBox()).height;
  ok(graphHeight>compact&&graphHeight<=92,'only the interactive plot needs a taller overview');
  await page.locator('[data-range-handle=start]').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await count(84);
  await page.locator('.saved-timeline-reset').click();await count(total);
  // Exercise the real request's retry path without changing the test database.
  await page.evaluate(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__histFailure=true;window.__TAURI_INTERNALS__.invoke=(cmd,args)=>cmd==='saved_date_histogram'&&window.__histFailure?Promise.reject(Error('controlled histogram failure')):invoke(cmd,args);window.dispatchEvent(new Event('lexicue-saved-changed'));});await page.locator('.saved-timeline-status[data-state=error]').waitFor();await page.evaluate(()=>window.__histFailure=false);await page.locator('.saved-timeline-status').getByRole('button',{name:'重试'}).click();await page.locator('.saved-growing-timeline[data-phase=band]').waitFor();
  await c.close();
 }
 // Verify the count and expanded list against native search results on small touch screens.
 const words=['harbor','anchor','drift','current','pier','sail','wake','shore','tide','voyage','buoy','stern','horizon','dock','ripple'];
 for(const [theme,width,height] of [['sage',375,812],['midnight',320,568],['midnight',667,375]]){
  await h.call('test_reset');
  const records=words.map((expression,i)=>({expression,sentence:`I wrote ${expression} in my notebook.`,explanation:i===0?'notes':'coast',saved_at:base-(i%3)*86400000}));
  await h.call('test_seed_recall',{count:records.length,records});
  const c=await h.browser.newContext({viewport:{width,height},hasTouch:true,timezoneId:'UTC',reducedMotion:theme==='midnight'?'reduce':'no-preference'});
  const page=await c.newPage();current=page;await h.fixture(page,theme);await page.goto(h.url+'/saved');
  await page.locator('.approved-saved-search button').tap();
  const search=page.getByRole('searchbox');
  await search.fill('coast');
  const toggle=page.getByRole('button',{name:'查看全部词条'});
  await toggle.filter({hasText:'14 个词条'}).waitFor();
  ok(await page.locator('.saved-timeline-count strong').evaluate(n=>n.clientHeight<=parseFloat(getComputedStyle(n).lineHeight)+1),'short totals stay on one line on a small phone');
  ok((await toggle.boundingBox()).height>=48,'result action has a mobile touch target');
  eq(await page.locator('.saved-workspace :is(select,summary)').count(),0,'result browsing uses an app button');
  const visible=page.locator('.approved-saved-columns[data-expanded=true]');
  await screen(`${theme}-${width}-filtered`);
  await toggle.tap();await visible.waitFor();
  eq(await visible.locator('.approved-saved-word').count(),14,'full list contains only the matching words');
  if(height<400)ok(await visible.locator('.approved-saved-index').evaluate(n=>n.scrollHeight>n.clientHeight),'the landscape grid can scroll through the results');
  ok(!(await visible.locator('.approved-saved-detail').isVisible()),'the list can use the available reading area');
  ok(!(await page.locator('.approved-timeline').isVisible()),'the date chart leaves room for browsing words');
  eq(await page.evaluate(()=>document.activeElement?.textContent),'14 个词条','opening the grid focuses its heading');
  ok(await page.getByRole('button',{name:'返回',exact:true}).isVisible(),'the result grid keeps a visible back button');
  await screen(`${theme}-${width}-all-results`);
  const word=visible.getByRole('button',{name:'ripple',exact:true});
  await word.focus();await page.keyboard.press('ArrowUp');
  ok(await visible.isVisible(),'keyboard navigation keeps the list open');
  await page.keyboard.press('Escape');await visible.waitFor({state:'detached'});
  eq(await page.evaluate(()=>document.activeElement?.getAttribute('aria-controls')),'saved-word-index','closing the list restores focus to its entry');
  await toggle.tap();await word.tap();await visible.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.approved-folio-sentence')?.textContent?.includes('ripple'));
  ok(await page.locator('.approved-saved-word[aria-pressed=true]').evaluate(n=>{
   const row=n.parentElement.getBoundingClientRect(), word=n.getBoundingClientRect();
   return word.left>=row.left-1&&word.right<=row.right+1;
  }),'selected word stays visible in the compact index');
  await toggle.tap();await search.fill('no match 987654');
  await visible.getByRole('status').waitFor();
  await page.getByRole('button',{name:'返回',exact:true}).tap();
  await visible.waitFor({state:'detached'});
  ok(page.url().endsWith('/saved'),'back closes an empty result list before leaving the page');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'results fit the viewport');
  await c.close();
 }
 await h.call('test_reset');
 const c=await h.browser.newContext({viewport:{width:375,height:812},hasTouch:true,timezoneId:'UTC'});
 current=await c.newPage();await h.fixture(current,'sage');
 await h.call('test_seed_recall',{count:208,records:[{expression:'harbor',sentence:'The harbor is quiet.',saved_at:base}]});
 const expected=await h.call('list_saved_groups',{query:'临时性能样本',limit:200,offset:0});
 ok(expected.total_groups>200,'pagination fixture exceeds the native page size');
 await current.goto(h.url+'/saved');
 await current.locator('.approved-saved-search button').tap();
 await current.getByRole('searchbox').fill('临时性能样本');
 await current.getByRole('button',{name:'查看全部词条'}).filter({hasText:`${expected.total_groups} 个词条`}).tap();
 const index=current.locator('.approved-saved-index');
 const more=index.locator('.saved-index-more button');
 await current.evaluate(()=>window.__uiFailure={command:'list_saved_groups',remaining:1,afterCommit:false});
 await more.tap();await index.getByRole('alert').waitFor();
 eq(await index.locator('.approved-saved-word').count(),200,'a failed page keeps the previously loaded matches');
 const before=await index.evaluate(n=>n.scrollTop);
 await more.tap();await more.waitFor({state:'detached'});
 eq(await index.locator('.approved-saved-word').count(),expected.total_groups,'retry makes the rest of the filtered words available');
 ok(await index.evaluate((n,before)=>n.scrollTop>=before-64,before),'loading the next page preserves the list position');
 await c.close();
 eq(h.errors,[],'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks,source:'approved GIF, native histogram, search and pagination with disposable SQLite',themes:['sage','midnight'],viewports:[[1360,880],[375,812],[320,568],[812,375],[667,375]],nativeDevice:false},null,2));console.log(`Empty material, saved timeline and word results: ${checks} checks passed. ${output}`);
}catch(error){if(current&&!current.isClosed()){await current.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await current.locator('body').innerText(),url:current.url()},null,2));}throw error;}finally{await h.dispose();}
