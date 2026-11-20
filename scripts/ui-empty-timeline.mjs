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
  await h.call('test_reset');const c=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768,timezoneId:'UTC'}),page=await c.newPage();current=page;await h.fixture(page,theme);await page.goto(h.url+'/saved');await page.locator('.saved-growing-timeline[data-phase=empty]').waitFor({state:'attached'});
  ok(!(await page.locator('.saved-growing-timeline').isVisible()),'an empty timeline takes no space');
  eq(await page.locator('.saved-timeline-plot').count(),0,'zero data has no plot');
  await seed([2],[null]);await refresh('empty',0);eq(await page.locator('.saved-timeline-date').count(),0,'undated legacy records do not invent dates');
  await seed([1]);await refresh('seed',1);eq(await page.locator('.saved-timeline-date').getAttribute('datetime'),'2026-10-07','one date shows the actual saved date');eq(await page.locator('.saved-timeline-plot').count(),0,'one date does not need a plot');await screen(`${theme}-${width}-single-record`);
  const compact=(await page.locator('.saved-growing-timeline').boundingBox()).height;
  await seed([100]);await refresh('seed',100);eq((await page.locator('.saved-growing-timeline').boundingBox()).height,compact,'the single-date row stays compact');
  eq(await page.locator('.saved-growing-timeline').innerText(),'2026年10月7日','single-date view shows just the date');
  await seed([1,1,1],[0,4,9]);await refresh('dots',3);let x=await page.locator('.saved-timeline-mark').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return b.x+b.width/2;}));ok(Math.abs((x[1]-x[0])/(x[2]-x[0])-4/9)<.01,'date gaps remain chronological and proportional');eq(await page.locator('.saved-timeline-mark').count(),3,'empty days do not appear as false saved records');
  const sparse=await page.locator('.saved-timeline-scroll').boundingBox(), workspace=await page.locator('.saved-growing-timeline').boundingBox();
  ok(sparse.width<workspace.width/2&&Math.abs(sparse.x+sparse.width/2-workspace.x-workspace.width/2)<1,'sparse dates stay compact and centered');await screen(`${theme}-${width}-dots`);
  await seed([1,2,3,4,5,6,7]);await refresh('stems',28);const stemHeights=await page.locator('.saved-timeline-mark').evaluateAll(nodes=>nodes.map(n=>n.getBBox().height));ok(stemHeights[6]>stemHeights[0]&&stemHeights[6]<48,'dates grow into short stems before dense bars');
  const total=await seed(Array.from({length:20},(_,i)=>i%7+1));await refresh('band',total);eq(await page.locator('.saved-timeline-mark').count(),20,'dense dates form a band of the same marks');ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dense dates fit the viewport');await screen(`${theme}-${width}-band`);
  eq(await page.locator('input[type=date]').count(),0,'range selection exposes no precise date form');
  const plot=await page.locator('.saved-timeline-plot').boundingBox();
  await page.mouse.move(plot.x+22+(plot.width-44)*10/19,plot.y+30);await page.mouse.down();await page.mouse.move(plot.x+plot.width-22,plot.y+30,{steps:12});await page.mouse.up();
  await page.locator('.saved-timeline-reset').waitFor();
  await page.waitForFunction(()=>window.__uiCalls.some(c=>c.command==='list_saved_groups'&&c.args.startMs===Date.UTC(2026,9,17)));
  ok((await h.call('list_saved_groups',{query:'',limit:200,offset:0,startMs:Date.UTC(2026,9,17)})).total_records===43,'drag range agrees with actual native counts');
  await page.locator('.saved-timeline-reset').click();await page.locator('.saved-timeline-reset').waitFor({state:'detached'});
  const graphHeight=(await page.locator('.saved-growing-timeline').boundingBox()).height;
  ok(graphHeight>compact&&graphHeight<=92,'only the interactive plot needs a taller overview');
  await page.locator('[data-range-handle=start]').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(()=>window.__uiCalls.some(c=>c.command==='list_saved_groups'&&c.args.startMs===Date.UTC(2026,9,14)));
  await page.locator('.saved-timeline-reset').click();
  // Exercise the real request's retry path without changing the test database.
  await page.evaluate(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__histFailure=true;window.__TAURI_INTERNALS__.invoke=(cmd,args)=>cmd==='saved_date_histogram'&&window.__histFailure?Promise.reject(Error('controlled histogram failure')):invoke(cmd,args);window.dispatchEvent(new Event('lexicue-saved-changed'));});await page.locator('.saved-timeline-status[data-state=error]').waitFor();await page.evaluate(()=>window.__histFailure=false);await page.locator('.saved-timeline-status').getByRole('button',{name:'重试'}).click();await page.locator('.saved-growing-timeline[data-phase=band]').waitFor();
  if(width===375){
   const dense=await seed(Array.from({length:64},(_,i)=>i%4+1));
   await refresh('band',dense);
   const scroll=page.locator('.saved-timeline-scroll');
   const sizing=await scroll.evaluate(n=>({width:n.clientWidth,full:n.scrollWidth,left:n.scrollLeft}));
   ok(sizing.full>sizing.width&&sizing.left>0,'a dense timeline scrolls and starts centered');
   const period=await page.locator('.saved-timeline-period').boundingBox();
   const px=period.x+period.width/2,py=period.y+period.height/2;
   await page.mouse.move(px,py);await page.mouse.down();await page.mouse.move(px-78,py,{steps:8});await page.mouse.up();
   ok(await scroll.evaluate((n,left)=>n.scrollLeft>=left+70,sizing.left),'dragging the date band browses the timeline');
   const barViewport=await scroll.boundingBox();
   await page.mouse.move(barViewport.x+80,barViewport.y+26);await page.mouse.down();
   await page.mouse.move(barViewport.x+150,barViewport.y+26,{steps:8});await page.mouse.up();
   await page.locator('.saved-timeline-reset').waitFor();
   ok(await scroll.evaluate((n,left)=>n.scrollLeft>=left+70,sizing.left),'dragging the bars selects a range without moving the viewport');
   await page.locator('.saved-timeline-reset').click();
   const touch=await c.newCDPSession(page);
   const touchDrag=async (x,y,dx)=>{
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=6;step++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/6,y}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   };
   const beforeTouch=await scroll.evaluate(n=>n.scrollLeft);
   const dateBand=await page.locator('.saved-timeline-period').boundingBox();
   await touchDrag(dateBand.x+dateBand.width/2,dateBand.y+dateBand.height/2,72);
   ok(await scroll.evaluate((n,left)=>n.scrollLeft<left-60,beforeTouch),'a touch drag on the dates pans the timeline');
   await touchDrag(barViewport.x+90,barViewport.y+24,78);
   await page.locator('.saved-timeline-reset').waitFor();
   ok(true,'a touch drag on the bars selects a date range');
   await page.locator('.saved-timeline-reset').click();
   await touch.detach();
  }
  await c.close();
 }
 // Verify the drag interaction with native search results on small touch screens.
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
  const toggle=page.locator('.saved-rail-word[aria-pressed=true]');
  await page.waitForFunction(()=>document.querySelectorAll('.approved-saved-word').length===14);
  await toggle.waitFor();
  eq(await page.locator('.approved-index-toggle').count(),0,'the word rail has no extra drag handle');
  ok((await toggle.boundingBox()).height>=48,'result action has a mobile touch target');
  eq(await page.locator('.saved-workspace :is(select,summary)').count(),0,'result browsing uses an app button');
  const visible=page.locator('.approved-saved-columns[data-expanded=true]');
  await screen(`${theme}-${width}-filtered`);
  const strip=page.locator('.saved-index-strip');
  const blank=await page.locator('.saved-pull-space').boundingBox();
  const x=Math.round(blank.x+blank.width/3),y=Math.round(blank.y+Math.min(20,blank.height/2));
  if(height>400)ok(blank.height>75,'the space below the sentence offers a large pull area');
  if(theme==='sage'){
   const rail=await strip.boundingBox(),ry=rail.y+rail.height/2;
   const word=await toggle.innerText();
   await page.mouse.move(rail.x+140,ry);await page.mouse.down();await page.mouse.move(rail.x+32,ry,{steps:8});await page.mouse.up();
   ok(await strip.evaluate(n=>n.scrollLeft>50),'dragging horizontally scrolls the word rail');
   eq(await toggle.innerText(),word,'scrolling the rail does not select a different word');
  }
  if(theme==='sage'){
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+28,{steps:5});
   eq(await page.locator('.approved-saved-columns').evaluate(n=>n.style.getPropertyValue('--saved-pull')),'28px','the panel follows a short mouse drag');
   await page.mouse.up();
   await page.locator('.approved-saved-index').waitFor({state:'hidden'});
   eq(await visible.count(),0,'releasing a short drag springs back');
  }
  const touch=await c.newCDPSession(page);
  if(height<400){
   await toggle.press('Enter');
  }else for(const [type,touchPoints] of [['touchStart',[{x,y}]],['touchMove',[{x,y:y+38}]],['touchMove',[{x,y:y+78}]],['touchEnd',[]]]){
   await touch.send('Input.dispatchTouchEvent',{type,touchPoints});
  }
  await visible.waitFor();
  if(theme==='sage')ok(await visible.locator('.approved-saved-index').evaluate(n=>n.getAnimations().some(a=>a.transitionProperty==='clip-path')),'releasing a long drag animates the reveal');
  await touch.detach();
  eq(await visible.locator('.approved-saved-word').count(),14,'full list contains only the matching words');
  if(height<400)ok(await visible.locator('.approved-saved-index').evaluate(n=>n.scrollHeight>n.clientHeight),'the landscape grid can scroll through the results');
  await visible.locator('.approved-saved-detail').waitFor({state:'hidden'});
  ok(await page.locator('.approved-timeline').isVisible(),'the date chart keeps its position while pulling');
  eq(await page.evaluate(()=>document.activeElement?.textContent),'词条','opening the grid focuses its heading without a count');
  ok(await page.getByRole('button',{name:'返回',exact:true}).isVisible(),'the result grid keeps a visible back button');
  await screen(`${theme}-${width}-all-results`);
  if(theme==='sage'){
   const heading=await visible.getByRole('heading',{name:'词条'}).boundingBox();
   const fromX=heading.x+40,fromY=heading.y+22;
   await page.mouse.move(fromX,fromY);await page.mouse.down();await page.mouse.move(fromX,fromY-72,{steps:8});await page.mouse.up();
   await visible.waitFor({state:'detached'});
   eq(await toggle.getAttribute('aria-expanded'),'false','pulling the strip upward closes the list');
   await toggle.press('Enter');await visible.waitFor();
  }
  const word=visible.getByRole('button',{name:'ripple',exact:true});
  await word.focus();await page.keyboard.press('ArrowUp');
  ok(await visible.isVisible(),'keyboard navigation keeps the list open');
  await page.keyboard.press('Escape');await visible.waitFor({state:'detached'});
  eq(await page.evaluate(()=>document.activeElement?.getAttribute('aria-controls')),'saved-word-index','closing the list restores focus to its entry');
  await toggle.tap();await word.tap();await visible.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.approved-folio-sentence')?.textContent?.includes('ripple'));
  eq(await toggle.innerText(),'ripple','the compact rail shows the selected word');
  await toggle.tap();await search.fill('no match 987654');
  await visible.locator('.approved-saved-index').getByText('没有符合筛选的词条。').waitFor();
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
 await current.locator('.saved-rail-word[aria-pressed=true]').tap();
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
