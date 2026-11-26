/** Native-service-backed interaction regressions; no production user library. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const out=process.env.LEXICUE_LIBRARY_UI_OUTPUT||'/tmp/lexicue-library-inline',h=await createReadingHarness(out);let page,checks=0;
const ok=(v,s)=>{assert.ok(v,s);checks++;},eq=(v,e,s)=>{assert.deepEqual(v,e,s);checks++;};
const settle=()=>page.waitForFunction(()=>!document.querySelector('.approved-tag-flight,.approved-handoff,.approved-saved-flight'));
try {
 for(const theme of ['sage','midnight']) for(const width of [1360,375]) {
  await h.call('test_reset');await h.call('create_tag',{name:'Journey'});await h.call('create_tag',{name:'Keep'});const tag=(await h.call('list_tags')).find(t=>t.name==='Journey');
  const c=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768});page=await c.newPage();await h.fixture(page,theme);
  for(let count=1;count<=4;count++){
   await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`Collage ${count}.txt`,content:`The air is cool by the harbor. Cover ${count}.`,normalized_kind:'txt',segments:[{index:0,en_text:`The air is cool by the harbor. Cover ${count}.`}],tag_ids:[tag.id]}});
   await page.goto(h.url+'/files');await page.locator(`.approved-stock[data-count="${Math.min(count,3)}"]`).waitFor();
   const ratio=await page.locator('.approved-stock').evaluate(n=>{const boxes=[...n.querySelectorAll('img')].map(i=>i.getBoundingClientRect());const a=Math.max(...boxes.map(b=>b.right))-Math.min(...boxes.map(b=>b.left));const pocket=document.querySelector('.approved-word-pocket').getBoundingClientRect();return a/pocket.width;});
   ok(ratio>=.85&&ratio<1.7,`${count} material thumbnail retains weight beside saved pocket`);
   eq(await page.locator('.approved-stock img').count(),Math.min(count,3),'entry shows one, two, then three actual covers');
   await page.screenshot({path:`${out}/${theme}-${width}-desk-${count}.png`});
   await page.locator('.approved-library-entry').click();await settle();const group=page.locator(`[data-tag-id="${tag.id}"]`);
   eq(await page.locator('.approved-tag-panel').getByRole('button',{name:'新建标签',exact:true}).count(),0,'library has no create-tag control');
   eq(await group.locator('.library-cover-collage').getAttribute('data-count'),String(count),'category collage follows its own material count');eq(await group.locator('.library-cover-collage img').count(),count,'collage contains actual material artworks');
   await page.screenshot({path:`${out}/${theme}-${width}-collage-${count}.png`});
   if(count<4){await page.locator('.approved-rail-back').click();await page.getByRole('dialog').waitFor({state:'detached'});}
  }
  const group=page.locator(`[data-tag-id="${tag.id}"]`),caption=group.locator('.approved-tag-name');await caption.scrollIntoViewIfNeeded();
  const hold=async locator=>{
   const b=await locator.boundingBox(),p={x:b.x+b.width/2,y:b.y+b.height/2};
   if(width<768){const cd=await c.newCDPSession(page);await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});return {point:p,move:async q=>cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...q,id:1}]}),end:async()=>{await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cd.detach();}};}
   await page.mouse.move(p.x,p.y);await page.mouse.down();return {point:p,move:q=>page.mouse.move(q.x,q.y),end:()=>page.mouse.up()};
  };
  const editCaption=async locator=>{ if(width<768) await locator.tap(); else await locator.click(); };
  await editCaption(caption);await group.locator('.approved-tag-name-editor input').waitFor();
  eq(await page.locator('.trash-drag-layer').count(),0,'tapping the caption edits without lifting the category');
  await group.locator('input').fill('海边随记');await group.getByRole('button',{name:'保存',exact:true}).click();await group.locator('input').waitFor({state:'detached'});
  eq((await h.call('list_tags')).find(t=>t.id===tag.id).name,'海边随记','touch/mouse caption activation renames the existing category ID');
  eq((await h.call('list_materials')).filter(f=>f.tags.some(t=>t.id===tag.id)).length,4,'inline rename retains all material associations');
  let gesture=await hold(group.locator('.approved-tag-open'));await page.locator('.trash-drag-layer').waitFor();await gesture.end();await page.locator('.trash-drag-layer').waitFor({state:'detached'});
  ok(await group.isVisible(),'stationary category release restores the card');
  const drop=async()=>{const drag=await hold(group.locator('.approved-tag-open'));await page.locator('.trash-drop-target').waitFor();const b=await page.locator('.trash-drop-target').boundingBox();await drag.move({x:b.x+b.width/2,y:b.y+b.height/2});await page.locator('.trash-drop-target[data-open=true]').waitFor();await drag.end();await page.locator('.trash-drag-layer').waitFor({state:'detached'});};
  await page.evaluate(()=>window.__uiFailure={command:'delete_tag',remaining:1,afterCommit:false});await drop();ok(await group.isVisible(),'failed category deletion restores the original card');eq((await h.call('list_materials')).length,4,'failed category deletion preserves materials');
  await drop();await group.waitFor({state:'detached'});eq((await h.call('list_materials')).length,4,'deleting a category never deletes its materials');ok((await h.call('list_materials')).every(f=>!f.tags.some(t=>t.id===tag.id)),'removed category assignments become untagged');ok((await h.call('list_tags')).some(t=>t.name==='Keep'),'other categories are untouched');
  // Both built-in captions are editable too, without creating tags or reassigning materials.
  const renameBuiltin=async(id,name)=>{const box=page.locator(`[data-tag-id="${id}"]`);await box.locator('.approved-tag-name').scrollIntoViewIfNeeded();await editCaption(box.locator('.approved-tag-name'));await box.locator('input').waitFor();await box.locator('input').fill(name);await box.getByRole('button',{name:'保存',exact:true}).click();await box.locator('input').waitFor({state:'detached'});};
  await renameBuiltin('all','我的材料');await renameBuiltin('untagged','待整理');
  eq((await h.call('list_tags')).map(t=>t.name),['Keep'],'renaming built-in captions creates no synthetic category');
  ok((await h.call('list_materials')).every(f=>f.tags.length===0),'built-in caption changes preserve material classification');
  await page.reload();await settle();await page.locator('[data-tag-id="all"] .approved-tag-name').waitFor();
  eq(await page.locator('[data-tag-id="all"] strong').innerText(),'我的材料','default library name survives page/app rehydration');eq(await page.locator('[data-tag-id="untagged"] strong').innerText(),'待整理','default untagged name survives rehydration');
  await page.locator('.approved-rail-back').click();await page.getByRole('dialog').waitFor({state:'detached'});
  const library=page.locator('.approved-library-entry');
  for(const edge of width>=768 ? ['left','right','between'] : ['above']){
   await library.click();await settle();
   const panel=page.locator('.approved-tag-panel');
   const point=await panel.evaluate((node,edge)=>{
    const r=node.getBoundingClientRect();
    const cards=[...node.querySelectorAll('.approved-tag-stack')].map(card=>card.getBoundingClientRect());
    const x=edge==='left'?r.left+12:edge==='right'?r.right-12:edge==='between'?(cards[0].right+cards[1].left)/2:r.left+r.width/2;
    const y=edge==='above'?r.top+6:r.top+r.height/2;
    const target=document.elementFromPoint(x,y);
    return {x,y,overPanel:node.contains(target)&&!target.closest('.approved-tag-stack')};
   },edge);
   ok(point.overPanel,`${edge} hits the blurred area inside the wide panel`);
   if(width<768)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
   await panel.waitFor({state:'detached'});
   ok(await library.evaluate(n=>document.activeElement===n),`${edge} dismisses cards and restores desk focus`);
  }
  await page.evaluate(async()=>{const{useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const{useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');d.getState().keepAndOpen(m.getState().files[0]);});
  await page.locator('.approved-card[data-desk-active=true] .approved-tag-edit').waitFor();eq(await page.locator('.approved-card[data-desk-active=true] .approved-tag-edit').innerText(),'待整理','home uses the renamed untagged caption');
  await page.locator('.approved-card[data-desk-active=true] .approved-tag-edit').click();ok(await page.getByRole('button',{name:'待整理',exact:true}).isVisible(),'tag choices use the same renamed default');await page.keyboard.press('Escape');
  await page.evaluate(async()=>{const{useImportStore:i}=await window.__uiStoreModule('importStore');await i.getState().fromContent('clipboard','A new material waits near the harbor.',true);});await page.locator('.import-material-card').waitFor();eq(await page.locator('.import-edge-label').innerText(),'待整理','import preview shares the renamed default');await page.keyboard.press('Escape');
  // Four real language controls, short nav labels and full accessible names.
  await page.goto(h.url+'/settings');for(const language of ['English','Deutsch','日本語','中文']){
   await page.getByRole('radio',{name:language,exact:true}).click();await page.getByRole('radio',{name:language,exact:true}).waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('.approved-settings-tabs button span')].every(n=>n.scrollWidth<=n.clientWidth+1));
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'translated settings do not widen the viewport');
   for(const label of await page.locator('.approved-settings-tabs button').all()){ok(await label.evaluate(n=>!!n.getAttribute('aria-label')),'short navigation retains its full accessible name');}
   await page.screenshot({path:`${out}/${theme}-${width}-${language}.png`});
  }
  await c.close();console.log(`Library inline ${theme}/${width}: ${checks} assertions`);
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${out}/evidence.json`,JSON.stringify({checks,passed:true,scope:'Real disposable Rust/SQLite; Chrome mouse and CDP touch; both themes at desktop and 375px. Native devices separate.'},null,2));console.log(`Library inline: ${checks} checks passed`);
}catch(error){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});if(page&&!page.isClosed())await writeFile(`${out}/failure.json`,JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,calls:window.__uiCalls})),null,2)).catch(()=>{});throw error;}finally{await h.dispose();}
