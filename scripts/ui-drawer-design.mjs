/** Final reading-drawer design against real isolated SQLite; no user library. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_READING_UI_OUTPUT||'/tmp/lexicue-drawer-design';
const h=await createReadingHarness(output);
const checks=[];
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks.push(label);}
try {
 for(const theme of ['ocean','midnight']) for(const viewport of [{width:375,height:812},{width:1140,height:800}]) {
  await h.call('test_reset');
  const sentences=['Ichthyology studies fish in rivers and oceans.','We found a quiet room in the library.','The river runs through the city.'];
  const translations=['鱼类学研究河流和海洋中的鱼类。','我们在图书馆里找到了一间安静的房间。','河流穿过城市。'];
  const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'Drawer design.txt',content:sentences.join('\n'),segments:sentences.map((en_text,index)=>({index,en_text,zh_text:translations[index],start_time:null,end_time:null}))}});
  const material=await h.call('open_reading_material',{fileId:imported.file_id});
  const saved=[];
  for(const index of [1,0]) saved[index]=(await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:material.segments[index].id,expression:'in',start_offset:sentences[index].indexOf(' in ')+1,end_offset:sentences[index].indexOf(' in ')+3,explanation:index===0?'My original note':null,explanation_source:index===0?'personal':'unknown'}}})).record;
  const phone=viewport.width===375;
  const context=await h.browser.newContext({viewport,reducedMotion:'reduce',...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile'}:{})});
  const page=await context.newPage();await h.fixture(page,theme);
  await page.goto(`${h.url}/files/${imported.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^in$/}).first().click();
  await page.locator('[data-testid="lookup-records-tab"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('.lookup-record-count')?.textContent==='2');
  const centered = async label => {
    const geometry=await page.locator('.context-panel').evaluate(node=>{const r=node.getBoundingClientRect();return {center:(r.top+r.bottom)/2,top:r.top,bottom:r.bottom,viewport:innerHeight};});
    equal(Math.abs(geometry.center-geometry.viewport/2)<1,true,`${theme}: ${label} stays on the window centerline`);
    equal(geometry.top>=23 && geometry.bottom<=geometry.viewport-23,true,`${theme}: ${label} retains 24px vertical safety margins`);
  };
  if(!phone)await centered('meaning card');
  equal(await page.locator('.lookup-fixed-header').evaluate(n=>Math.round(n.getBoundingClientRect().height)),148,`${theme}/${phone}: 148px header with source controls`);
  equal(await page.locator('.context-sheet-expand').isVisible(),phone,`${theme}/${phone}: expand is shown only where it changes sheet size`);
  equal(await page.locator('.lookup-source-switch button[aria-pressed="true"] > span').textContent(),'本地',`${theme}/${phone}: explicit current source button`);
  equal(await page.locator('.lookup-context').count(),0,`${theme}/${phone}: no duplicate current-context section`);
  equal(await page.locator('.reading-recall-ink').first().evaluate(n=>getComputedStyle(n,'::before').content),'none',`${theme}/${phone}: saved marker has no expanded paint box`);
  equal(await page.locator('.reading-recall-ink').first().evaluate(n=>getComputedStyle(n).textDecorationThickness),'2px',`${theme}/${phone}: saved underline is 2px`);
  await page.locator('[data-testid="lookup-records-tab"]').click();
  const panel=page.locator('.context-panel .soft-refresh-current');
  await panel.locator('.saved-sentence').first().waitFor();
  if(!phone){
    await centered('records card');
    for(const size of [{width:1100,height:750},{width:1100,height:600},{width:900,height:520}]){
      await page.setViewportSize(size);
      await centered(`records card at ${size.width}x${size.height}`);
      const box=await page.locator('.context-panel').boundingBox();
      equal(box.height<=size.height-47,true,`${theme}: long content is constrained to the usable height`);
    }
    await page.setViewportSize(viewport);await centered('resized-back records card');
  }
  equal(await panel.locator('.saved-sentence-actions').count(),1,`${theme}/${phone}: only one toolbar`);
  equal(await panel.locator('.saved-sentence-actions button').count(),5,`${theme}/${phone}: five icon actions`);
  equal(await panel.locator('.saved-sentence-actions button').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width===48&&r.height===48;})),true,`${theme}/${phone}: 48px action targets`);
  equal(await panel.locator('.saved-sentence-actions button').evaluateAll(nodes=>nodes.every((node,index,all)=>Math.abs(node.getBoundingClientRect().y-all[0].getBoundingClientRect().y)<.5)),true,`${theme}/${phone}: all five actions share a vertical baseline`);
  equal(await panel.locator('.saved-sentence-actions').evaluate(node=>node.getBoundingClientRect().height),48,`${theme}/${phone}: legacy button margins do not enlarge the action row`);
  equal(await panel.locator('.saved-sentence-translation').count(),0,`${theme}/${phone}: translations initially folded`);
  await panel.getByRole('button',{name:'显示或隐藏译文',exact:true}).click();
  await panel.locator('.saved-sentence-translation').waitFor();
  await panel.locator('.saved-sentence-original').nth(1).click();
  equal(await panel.locator('.saved-sentence[data-active="true"]').getAttribute('data-record'),saved[1].record_id,`${theme}/${phone}: toolbar follows second sentence`);
  equal(await panel.locator('.saved-sentence-actions').count(),1,`${theme}/${phone}: switching never duplicates toolbar`);
  equal(await panel.locator('.saved-sentence-translation').textContent(),translations[0],`${theme}/${phone}: switching retains expanded translation`);
  equal(await panel.locator('.lookup-footer').count(),0,`${theme}/${phone}: records have no fixed save footer`);
  await page.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-records.png`});
  await page.locator('[data-testid="lookup-close"]').click();
  await page.locator('.context-panel').waitFor({state:'detached'});
  await page.goto(`${h.url}/saved`);await page.locator('.saved-record-open').click();
  await page.locator('.saved-sentence').first().waitFor();
  equal(await page.locator('.saved-sentence:visible').count(),1,`${theme}/${phone}: saved opens the latest sentence only`);
  await page.getByRole('button',{name:'还有 1 句',exact:true}).click();
  equal(await page.locator('.saved-sentence:visible').count(),2,`${theme}/${phone}: other sentence opens on demand`);
  await page.evaluate(()=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
      if(command==='saved_record_source') { window.__drawerSourcePending=true; await new Promise(resolve=>setTimeout(resolve,350)); }
      try { return await invoke(command,args); }
      finally { if(command==='saved_record_source') window.__drawerSourcePending=false; }
    };
  });
  await page.getByRole('button',{name:'返回原文',exact:true}).click();
  await page.waitForFunction(()=>window.__drawerSourcePending);
  await page.locator('.saved-sentence-original').nth(1).click();
  await page.waitForFunction(()=>window.__drawerSourcePending===false);
  await page.waitForTimeout(150);
  equal(new URL(page.url()).pathname,'/saved',`${theme}/${phone}: switching records cancels an older source visit`);
  await page.getByRole('button',{name:'补充个人解释',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'个人解释',exact:true});
  await dialog.locator('textarea').fill('A note for the second sentence');
  await dialog.getByRole('button',{name:'保存解释',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  const afterEdit=await h.call('list_saved_records',{query:'in',limit:10,offset:0});
  equal(afterEdit.find(r=>r.record_id===saved[0].record_id).explanation,'My original note',`${theme}/${phone}: editing second sentence preserves first note`);
  equal(afterEdit.find(r=>r.record_id===saved[1].record_id).explanation,'A note for the second sentence',`${theme}/${phone}: edit changes only the active record`);
  await page.getByRole('button',{name:'移除这句',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.saved-context-count')?.textContent?.includes('1'));
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.saved-context-count')?.textContent?.includes('2'));
  const afterUndo=await h.call('list_saved_records',{query:'in',limit:10,offset:0});
  equal(afterUndo.find(r=>r.record_id===saved[1].record_id).explanation,'A note for the second sentence',`${theme}/${phone}: delete undo restores its edited note`);
  await page.goto(`${h.url}/files/${imported.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^river$/}).click();
  await page.locator('[data-testid="lookup-save"]').click();
  await page.locator('.lookup-save-toast').waitFor();
  equal(await page.locator('.lookup-save-toast').evaluate(n=>n.getBoundingClientRect().height),48,`${theme}/${phone}: save receipt is a compact pill`);
  await page.locator('[data-testid="lookup-undo"]').click();
  await page.locator('[data-testid="lookup-save"]').waitFor();
  equal((await h.call('list_saved_records',{query:'river',limit:10,offset:0})).filter(r=>r.expression==='river').length,0,`${theme}/${phone}: transient undo reverses the save`);
  await page.locator('[data-testid="lookup-save"]').click();
  await page.locator('.lookup-save-toast').waitFor();
  await page.locator('.lookup-save-toast').waitFor({state:'detached',timeout:3500});
  equal(await page.locator('.lookup-footer:visible').count(),0,`${theme}/${phone}: saved feedback disappears without a fixed footer`);
  equal((await h.call('list_saved_records',{query:'river',limit:10,offset:0})).filter(r=>r.expression==='river').length,1,`${theme}/${phone}: hiding feedback preserves saved data`);
  equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme}/${phone}: no horizontal overflow`);
  await context.close();
 }
 equal(h.errors,[],'no uncaught browser errors');
 await writeFile(`${output}/drawer-design.json`,JSON.stringify({checks},null,2));
 console.log(`Reading drawer: ${checks.length} checks passed`);
} finally { await h.dispose(); }
