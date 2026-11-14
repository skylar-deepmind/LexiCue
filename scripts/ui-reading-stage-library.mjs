/** Reading desk + real reader, using a disposable SQLite bridge and browser storage. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_STAGE_OUTPUT||'docs/implementation/fixtures/reading-stage-library-v1';
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output,['test_delete_source','test_reset','test_reopen']);
const report={scope:'Production React + existing Rust command cores + disposable SQLite. OS clipboard/dialogs, speech state and failure injection controlled.',checks:[],geometry:[],contrasts:[],errors:h.errors};
let page,theme;
const check=(condition,name)=>{assert.ok(condition,`${theme}: ${name}`);report.checks.push({theme,name});};
const desk=()=>page.evaluate(async()=>{const {useReadingDeskStore:s}=await window.__uiStoreModule('readingDeskStore');const x=s.getState();return {desk:x.desk,undo:!!x.undo,notice:x.notice,failed:x.persistenceFailed};});
const ids=async()=>(await desk()).desk.items.map(ref=>ref.id);
const moduleAction=async(name,action,args)=>page.evaluate(async({name,action,args})=>{const mod=await window.__uiStoreModule(name);const store=Object.values(mod).find(value=>value?.getState);return store.getState()[action](...args);},{name,action,args});
const shot=async name=>{await page.evaluate(async()=>{await document.fonts.ready;await Promise.allSettled([...document.images].map(image=>image.decode()));await Promise.allSettled(document.getAnimations().filter(animation=>animation.effect.getComputedTiming().iterations!==Infinity).map(animation=>animation.finished));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});return page.screenshot({path:`${output}/${theme}-${name}.png`});};
const ready=async()=>page.locator('.reading-stage-page .material-status').waitFor({state:'detached'});
const noOverflow=async label=>{const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,main:document.querySelector('.materials-scroll')?.scrollWidth,mainWidth:document.querySelector('.materials-scroll')?.clientWidth}));report.geometry.push({theme,label,...geometry});check(geometry.document<=geometry.width && (!geometry.main || geometry.main<=geometry.mainWidth+1),`${label}: no horizontal overflow`);};
const contrast=async(locator,label)=>{
 const ratio=await locator.evaluate(n=>{const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);let p=n,bg;do{bg=rgb(getComputedStyle(p).backgroundColor);p=p.parentElement;}while(p&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(n).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
 report.contrasts.push({theme,label,ratio});check(ratio>=4.5,`${label}: text contrast ${ratio.toFixed(2)}`);
};
async function makeMaterial(name,index){
 const segments=Array.from({length:60},(_,i)=>({index:i,en_text:`We take a closer look at the world and remember the original sentence while reading its explanation. This is lesson ${index}, paragraph ${i+1}.`,zh_text:`第 ${index} 课，第 ${i+1} 段。`,start_time:`00:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')},000`,end_time:`00:01:${String(i%60).padStart(2,'0')},000`}));
 const content=segments.map((s,i)=>`${i+1}\n${s.start_time} --> ${s.end_time}\n${s.en_text}\n${s.zh_text}\n`).join('\n');
 return h.call('import_reading_material',{input:{operation_id:randomUUID(),name,content,segments}});
}
try {
 for(theme of ['ocean','midnight']) {
  await h.call('test_reset');
  page=await h.browser.newPage({viewport:{width:390,height:844}});await h.fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(()=>{const base=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(command,args)=>{if(command==='list_materials'){window.__initialListHold??=new Promise(resolve=>window.__releaseInitialList=resolve);await window.__initialListHold;}return base(command,args);};});
  await page.goto(h.url+'/files');await page.locator('.material-status').waitFor();
  check(await page.locator('.desk-empty').count()===0,'initial loading is not presented as an empty library');
  await shot('initial-loading');await page.evaluate(()=>window.__releaseInitialList());await ready();
  check(await page.getByText('从一份英文材料开始。',{exact:true}).count()===1,'zero materials has a distinct import empty state');
  check(await page.getByRole('button',{name:'导入',exact:true}).evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length>0).length)===1,'zero materials retains one visible import entry');
  check(await page.locator('.desk-library-dock').count()===0,'zero materials does not present a duplicate library action');
  await shot('zero-materials');await page.close();
  const names=['We Can’t Solve What We Don’t Understand.srt','What Has Government Done to Our Money?.srt','My 10-Minute Routine to Stop Freezing in Conversations.srt','English Podcast — A Different Perspective (完整版：新的阅读材料与讨论).srt',...Array.from({length:20},(_,i)=>`Library lesson ${String(i+5).padStart(2,'0')} — English reading.srt`)];
  for(let i=0;i<names.length;i++)await makeMaterial(names[i],i+1);
  let files=await h.call('list_materials',{tagIds:[],untagged:false});
  const byName=name=>files.find(file=>file.name===name),a=byName(names[0]),b=byName(names[1]),c=byName(names[2]),d=byName(names[3]);
  const tag=await h.call('create_tag',{name:'Reading'});await h.call('set_file_tags',{fileId:d.id,tagIds:[tag],newTagNames:[]});
  files=await h.call('list_materials',{tagIds:[],untagged:false});
  page=await h.browser.newPage({viewport:{width:1440,height:1000}});await h.fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(({a,d})=>{
   if(!sessionStorage.getItem('stage-fixture-initialized')) {localStorage.setItem('lexicue-last-reading',JSON.stringify({id:a.id,hash:a.content_hash}));localStorage.setItem(`lexicue-reader-state:${d.content_hash}`,JSON.stringify({segment:18,offset:9}));sessionStorage.setItem('stage-fixture-initialized','1');}
  },{a,d});
  await page.goto(h.url+'/files');await page.locator('.desk-paper').waitFor();
  check(JSON.stringify(await ids())===JSON.stringify([a.id]),'first full list initializes only the matching previous material');
  await moduleAction('readingDeskStore','keep',[b]);await moduleAction('readingDeskStore','keep',[c]);await moduleAction('readingDeskStore','clearNotice',[]);
  check(await page.locator('.b-header').count()===1 && await page.locator('.b-brand').count()===1,'exactly one application header and brand in the DOM');
  const before=await desk();const original=await h.call('export_all');
  const blocked=await h.browser.newPage({viewport:{width:768,height:900}});await h.fixture(blocked,theme);await blocked.routeWebSocket('**',socket=>socket.close());
  await blocked.addInitScript(()=>{Storage.prototype.getItem=function(){throw Error('storage denied');};Storage.prototype.setItem=function(){throw Error('storage denied');};});
  await blocked.goto(`${h.url}/files/${a.id}?segment=5`);await blocked.locator('.reading-word').first().waitFor();
  check(await blocked.locator('[data-sentence="5"]').evaluate(node=>Math.abs(node.getBoundingClientRect().top-document.querySelector('.reader-scroll').getBoundingClientRect().top)<2),'segment deep link works when local storage is unavailable');
  await blocked.locator('.reader-desk-toolbar > div > button').click();await blocked.locator('.desk-storage-error').waitFor();
  check(await blocked.locator('.reading-paper').count()===1,'fully unavailable local storage does not block real reading or desk controls');await blocked.close();
  for(const width of [1280,1440,1920,1024,768,390,320]){
   await page.setViewportSize({width,height:1000});await page.reload();await page.locator('.desk-paper').waitFor();await noOverflow('desk '+width);await shot('desk-'+width);
  }
  await page.setViewportSize({width:320,height:1000});
  await page.evaluate(()=>document.documentElement.style.fontSize='24px');await noOverflow('desk 320 with 150% UI font');await shot('desk-320-large-font');
  await page.locator('.desk-primary').focus();
  check(await page.locator('.desk-primary').evaluate(node=>{const action=node.getBoundingClientRect(),scroll=document.querySelector('.materials-scroll').getBoundingClientRect(),nav=document.querySelector('.b-mobile-nav').getBoundingClientRect();return action.top>=scroll.top && action.bottom<=scroll.bottom+1 && action.bottom<=nav.top+1;}),'320px large-font primary action scrolls fully into view on keyboard focus');
  await shot('desk-320-large-font-action');
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.setViewportSize({width:1440,height:1000});
  const primary=page.locator('.desk-primary');await contrast(primary,'desk primary default');await primary.hover();await contrast(primary,'desk primary hover');
  await primary.evaluate(n=>n.disabled=true);await contrast(primary,'desk primary disabled');await primary.evaluate(n=>n.disabled=false);
  await primary.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');check(await primary.evaluate(n=>getComputedStyle(n).boxShadow.includes('inset')),'desk primary visible keyboard focus');
  await page.locator('.desk-library-dock').focus();await page.keyboard.press('Enter');await page.locator('.reading-library').waitFor();
  check(await page.locator('.library-search input').evaluate(n=>document.activeElement===n),'library search receives keyboard focus');
  await page.locator(`[data-open="${b.id}"]`).click();await page.locator('.reading-word').first().waitFor();
  check(JSON.stringify((await desk()).desk)===JSON.stringify(before.desk),'ordinary library open of an existing desk member leaves exact order unchanged');
  await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.reading-library').waitFor();
  const all=page.getByRole('button',{name:/^全部 /});await contrast(all,'range selected');
  await page.getByRole('button',{name:/^已收起 /}).click();await page.getByRole('button',{name:'按标签筛选'}).click();
  await page.getByRole('button',{name:'Reading',exact:true}).click();
  await page.locator('.library-search input').fill('Different Perspective');
  check(await page.locator('.library-row').count()===1,'title, stored range and tag filters compose without touching desk');
  check(JSON.stringify((await desk()).desk)===JSON.stringify(before.desk),'library filtering leaves exact desk order unchanged');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await noOverflow('library '+width);await shot('library-'+width);}
  await page.setViewportSize({width:1440,height:1000});
  await page.locator(`[data-open="${d.id}"]`).focus();await page.keyboard.press('Enter');await page.locator('.reading-word').first().waitFor();
  check(JSON.stringify((await desk()).desk)===JSON.stringify(before.desk),'fourth material opens directly without placing or rearranging');
  check(await page.locator('.desk-membership').innerText()==='已收起','reader shows stored membership');
  check(await page.locator('[data-sentence="18"]').count()===1,'existing paragraph position restored');
  await shot('reader-stored');
  await page.evaluate(async()=>{const {usePreferencesStore:s}=await window.__uiStoreModule('preferencesStore');s.getState().setContentFontScale('learning',140);});
  await page.setViewportSize({width:390,height:1000});await noOverflow('reader 390 at 140% learning font');await shot('reader-390-large-font');
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(async()=>{const {usePreferencesStore:s}=await window.__uiStoreModule('preferencesStore');s.getState().setContentFontScale('learning',100);});
  await page.evaluate(()=>{window.__readerNode=document.querySelector('.reading-paper');window.__readingScroll=document.querySelector('.reader-scroll').scrollTop;});
  await page.locator('[data-sentence="18"] .reading-word').filter({hasText:/^take$/}).click();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();
  await page.locator('.context-panel').evaluate(n=>{window.__lookupNode=n;});
  await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');s.setState({status:'playing',key:'stage-playback-fixture',playbackMode:'single'});window.__readerScrollWithQuery=document.querySelector('.reader-scroll').scrollTop;});
  await page.getByRole('button',{name:'留在桌面',exact:true}).focus();await page.keyboard.press('Enter');
  check(JSON.stringify(await ids())===JSON.stringify([d.id,c.id,b.id]),'explicit keep prepends and evicts the deterministic oldest member');
  check((await page.locator('.notification-host').innerText()).includes(a.name),'replacement feedback names the displaced material');
  check(await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');return window.__readerNode===document.querySelector('.reading-paper')&&window.__lookupNode===document.querySelector('.context-panel')&&Math.abs(window.__readerScrollWithQuery-document.querySelector('.reader-scroll').scrollTop)<1&&s.getState().status==='playing';}),'keep preserves reader node, query node, exact scroll and playback state');
  await shot('reader-kept-undo');
  await page.getByRole('button',{name:'撤销桌面整理',exact:true}).focus();await page.keyboard.press('Enter');
  check(JSON.stringify((await desk()).desk)===JSON.stringify(before.desk),'reader undo restores exact prior members and order');
  check(await page.evaluate(()=>window.__lookupNode===document.querySelector('.context-panel')&&window.__readerNode===document.querySelector('.reading-paper')),'undo keeps the current material and query mounted');
  // Back must dismiss lookup first, then return to the original library with all conditions.
  await page.evaluate(()=>window.__lexicueBack());await page.locator('.context-panel').waitFor({state:'detached'});
  check(page.url().includes(`/files/${d.id}`),'first Back closes query without leaving reader');
  await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.reading-library').waitFor();
  check(await page.locator('.library-search input').inputValue()==='Different Perspective','return restores search');
  check(await page.getByRole('button',{name:/^已收起 /}).getAttribute('aria-pressed')==='true','return restores stored range');
  check(await page.getByRole('button',{name:'Reading',exact:true}).getAttribute('aria-pressed')==='true','return restores tag filter');
  check(await page.locator(`[data-open="${d.id}"]`).evaluate(n=>document.activeElement===n),'return restores original open button focus');
  // Clear filters and verify deep list scroll/focus restoration.
  await page.locator('.library-search input').fill('');await page.getByRole('button',{name:/^全部 /}).click();await page.getByRole('button',{name:'全部',exact:true}).click();
  const lastOpen=page.locator('.library-open').last();const lastId=Number(await lastOpen.getAttribute('data-open'));
  await lastOpen.focus();await lastOpen.scrollIntoViewIfNeeded();const libraryScroll=await page.locator('.materials-scroll').evaluate(n=>n.scrollTop);
  await lastOpen.press('Enter');await page.locator('.reading-word').first().waitFor();await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.reading-library').waitFor();
  check(Math.abs(await page.locator('.materials-scroll').evaluate(n=>n.scrollTop)-libraryScroll)<2,'library scroll restored');
  check(await page.locator(`[data-open="${lastId}"]`).evaluate(n=>document.activeElement===n),'deep list open button focus restored');
  await page.locator('.library-search input').fill('no-such-material-zzz');check(await page.locator('.library-row').count()===0,'search has an accurate no-results state');
  check((await ids()).length===3,'no search results do not clear desk');
  await page.locator('.library-search input').fill('');await page.getByRole('button',{name:'返回桌面',exact:true}).click();await page.locator('.desk-paper').waitFor();
  // Animation submits immediately; undo and navigation interrupt inert ghosts.
  await page.locator('.desk-archive').dblclick({delay:40});check((await ids()).length===2,'rapid double-click archives only one paper and commits before animation completes');
  check(await page.locator('.desk-flying').evaluate(n=>n.inert&&n.getAttribute('aria-hidden')==='true'),'flying paper is inert and hidden from accessibility');
  await page.getByRole('button',{name:'撤销桌面整理',exact:true}).click();check(await page.locator('.desk-flying').count()===0,'undo cancels flying paper');
  await page.locator('.desk-archive').click();await page.locator('.desk-library-dock').click();check(await page.locator('.desk-flying').count()===0,'library navigation cancels animation');
  await page.getByRole('button',{name:'返回桌面',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});
  while((await ids()).length){await page.waitForTimeout(310);await page.locator('.desk-archive').click();}
  check(await page.locator('.desk-flying').count()===0,'reduced motion archives immediately without ghosts');
  await page.getByText('桌面已收好。',{exact:true}).waitFor();await shot('empty-desk');
  await page.reload();await ready();check((await ids()).length===0,'refresh preserves explicitly empty desk despite last reading');
  await h.call('test_reopen');await page.reload();await ready();check((await ids()).length===0,'database reopen never refills desk');
  await page.locator('.desk-library-dock').click();await page.locator(`[data-open="${d.id}"]`).click();await page.locator('.reading-word').first().waitFor();
  check((await ids()).length===0,'empty desk stays empty while reading from library');
  await page.getByRole('button',{name:'留在桌面',exact:true}).click();check(JSON.stringify(await ids())===JSON.stringify([d.id]),'explicit keep fills one empty slot');
  await page.waitForTimeout(310);await page.getByRole('button',{name:'收起',exact:true}).dblclick({delay:40});check((await ids()).length===0,'reader double-click archive changes membership once only');check(await page.locator('.reading-word').count()>0,'reader remains usable after archive');
  await page.getByRole('button',{name:'撤销桌面整理',exact:true}).click();
  await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.reading-library').waitFor();
  // Complete-list failure must retain membership. Retry returns the same desk.
  await page.evaluate(async()=>{window.__uiFailure={command:'list_materials',remaining:1};const {useMaterialStore:s}=await window.__uiStoreModule('materialStore');await s.getState().load();});
  await page.getByRole('alert').filter({hasText:'材料'}).waitFor();check(JSON.stringify(await ids())===JSON.stringify([d.id]),'failed authoritative load leaves desk intact');await shot('load-failure');
  await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.reading-library').waitFor();
  // Fail only desk persistence, while leaving real material and reading storage untouched.
  await page.evaluate(()=>{window.__setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='lexicue-reading-desk:v1')throw Error('quota');return window.__setItem.call(this,key,value);};});
  await page.locator(`[data-open="${d.id}"]`).click();await page.locator('.reading-word').first().waitFor();await page.getByRole('button',{name:'收起',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'桌面暂未保存'}).waitFor();check((await ids()).length===0,'failed persistence is honest while current reading continues');await shot('save-failure');
  await page.evaluate(()=>{Storage.prototype.setItem=window.__setItem;});await page.getByRole('button',{name:'撤销桌面整理',exact:true}).click();
  // Real source removal followed by sync invalidates undo without recreating content.
  await page.getByRole('button',{name:'收起',exact:true}).click();await h.call('test_delete_source',{fileId:d.id});
  await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-sync-applied')));
  await page.waitForFunction(async()=>{const {useReadingDeskStore:s}=await window.__uiStoreModule('readingDeskStore');return !s.getState().undo;});
  check((await ids()).length===0,'sync removal invalidates pending undo');
  check(!(await h.call('list_materials',{tagIds:[],untagged:false})).some(file=>file.id===d.id),'removed material remains removed');
  const after=await h.call('export_all');
  check(original.data.files.filter(file=>file.id!==d.id).every(file=>after.data.files.some(next=>next.id===file.id&&next.content===file.content)),'all surviving original material bodies unchanged by organization');
  // Real single/batch/duplicate/failed import receipts and reader handoffs.
  await page.getByRole('button',{name:'返回材料库',exact:true}).click();await page.locator('.reading-library').waitFor();
  const importBody=`We read a newly imported English text for the ${theme} lesson.`;
  await page.evaluate(async text=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');await s.getState().start([{name:'New reading.txt',read:async()=>text}]);},importBody);
  await page.locator('.lc-import-primary').click();await page.locator('.reading-word').first().waitFor();
  const importedId=Number(new URL(page.url()).pathname.split('/').at(-1));
  check(JSON.stringify(await ids())===JSON.stringify([importedId]),'real new single import is placed only after successful reader open');
  check((await desk()).undo,'new import placement has persistent undo under React StrictMode');
  await page.getByRole('button',{name:'撤销桌面整理',exact:true}).click();check((await ids()).length===0,'new import placement undo leaves its reader open');
  await page.getByRole('button',{name:'返回桌面',exact:true}).click();await ready();
  await page.evaluate(async text=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');await s.getState().start([{name:'Same existing.txt',read:async()=>text}]);},importBody);
  await page.locator('.lc-import-primary').click();await page.getByRole('button',{name:'查看已有材料',exact:true}).click();await page.locator('.reading-word').first().waitFor();
  check((await ids()).length===0,'duplicate open does not place an archived material');
  await page.getByRole('button',{name:'返回材料',exact:true}).click();await ready();
  await page.evaluate(async theme=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');await s.getState().start([1,2].map(i=>({name:`Batch ${i}.txt`,read:async()=>`This is batch item ${i} for ${theme}, kept in the library.`})));},theme);
  await page.locator('.lc-import-primary').click();await page.locator('.reading-library').waitFor();
  check((await ids()).length===0,'unread batch import enters library and does not consume desk slots');
  await page.keyboard.press('Escape');await page.locator('.lc-import-modal').waitFor({state:'detached'});
  await page.evaluate(async()=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');await s.getState().start([{name:'Empty.txt',read:async()=>''}]);});
  await page.locator('.lc-import-modal').waitFor();check((await ids()).length===0,'failed empty import does not consume desk slots');
  await page.keyboard.press('Escape');await page.locator('.lc-import-modal').waitFor({state:'detached'});
  const opens=await page.evaluate(()=>window.__uiCalls.filter(call=>call.command==='open_reading_material').length);
  await page.locator('.library-search input').fill('lesson');await page.getByRole('button',{name:/^已收起 /}).click();
  check(await page.evaluate(()=>window.__uiCalls.filter(call=>call.command==='open_reading_material').length)===opens,'large library search/filter performs no per-row reader fetches');
  await page.evaluate(()=>{
   const original=window.__TAURI_INTERNALS__.invoke;
   window.__holdOpening=true;
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
    if(command==='open_reading_material'&&window.__holdOpening){window.__openHold??=new Promise(resolve=>window.__releaseOpening=resolve);await window.__openHold;}
    return original(command,args);
   };
  });
  await page.evaluate(async theme=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');await s.getState().start([{name:'Abandoned handoff.txt',read:async()=>`This newly imported reader is abandoned before it opens, for ${theme}.`}]);},theme);
  await page.locator('.lc-import-primary').click();await page.waitForURL(/\/files\/\d+$/);await page.waitForFunction(()=>typeof window.__releaseOpening==='function');
  await page.locator('.b-path a').click();await ready();
  await page.evaluate(()=>{window.__holdOpening=false;window.__releaseOpening();});
  check((await ids()).length===0,'abandoned successful import handoff cannot place a late reader result');
  await page.goBack();await page.locator('.reading-word').first().waitFor();
  check((await ids()).length===0,'history cannot replay an abandoned import intent as a new placement');
  await page.close();
 }
} catch(error) { report.errors.push(String(error));if(page)await page.screenshot({path:`${output}/failure.png`});throw error; }
finally { await writeFile(`${output}/ui-report.json`,JSON.stringify(report,null,2));await h.dispose(); }
