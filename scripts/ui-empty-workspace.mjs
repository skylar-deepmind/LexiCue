/** Accepted empty-state artwork and empty collection, with disposable SQLite. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_EMPTY_WORKSPACE_OUTPUT||'/tmp/lexicue-empty-workspace';
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output);let current,checks=0;
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const finish=()=>current.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>a.finish()));
const screen=async name=>{await finish();await current.screenshot({path:`${output}/${name}.png`});};
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
  if(width===375){
   const {file_id}=await h.call('import_reading_material',{input:{
    operation_id:crypto.randomUUID(),name:'Harbor.txt',normalized_kind:'txt',content:'The air is cool near the harbor.',
    segments:[{index:0,en_text:'The air is cool near the harbor.'}],
   }});
   await page.evaluate(async()=>{
    const{useMaterialStore}=await window.__uiStoreModule('materialStore');
    await useMaterialStore.getState().load();
    const{useReadingDeskStore}=await window.__uiStoreModule('readingDeskStore');
    useReadingDeskStore.getState().keepAndOpen(useMaterialStore.getState().files[0]);
   });
   await empty.waitFor({state:'detached'});
   await h.call('test_delete_source',{fileId:file_id});
   await page.evaluate(async()=>{
    const{useMaterialStore}=await window.__uiStoreModule('materialStore');
    await useMaterialStore.getState().changed();
   });
   await empty.waitFor();
   eq(await empty.getAttribute('data-playback'),'playing','a later genuinely empty library can greet once again');
  }
  await context.close();
 }
 // Respect system motion settings on the very first render; no GIF is requested.
 await h.call('test_reset');{
  const c=await h.browser.newContext({viewport:{width:375,height:812},reducedMotion:'reduce'}),page=await c.newPage();current=page;await h.fixture(page,'midnight');const gifs=[];page.on('request',r=>{if(r.url().endsWith('greeting-once.gif'))gifs.push(r.url());});await page.goto(h.url+'/files');await page.locator('.approved-empty-material[data-playback=waiting]').waitFor();eq(gifs,[],'reduced motion skips the animated asset entirely');await c.close();
 }
 for(const theme of ['sage','midnight'])for(const width of [1360,375]){
  await h.call('test_reset');const c=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768,timezoneId:'UTC'}),page=await c.newPage();current=page;await h.fixture(page,theme);await page.goto(h.url+'/saved');
  await page.locator('.approved-saved-empty').waitFor();
  eq(await page.locator('.approved-saved-word,.approved-saved-folio').count(),0,'empty archive invents no saved items');
  eq(await page.evaluate(()=>window.__uiCalls.some(call=>call.command==='saved_date_histogram')),false,'archive requests no date histogram');
  await screen(`${theme}-${width}-saved-empty`);
  await c.close();
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks,source:'approved GIF, actual Rust saved groups, disposable SQLite',themes:['sage','midnight'],viewports:[[1360,880],[375,812],[320,568],[812,375]],nativeDevice:false},null,2));console.log(`Empty material and saved archive: ${checks} checks passed. ${output}`);
}catch(error){if(current&&!current.isClosed()){await current.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await current.locator('body').innerText(),url:current.url()},null,2));}throw error;}finally{await h.dispose();}
