/** Mobile rail, inline home classification, and saved-sentence sizing in the real workspace. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const out = process.env.LEXICUE_READING_POLISH_OUTPUT || '/tmp/lexicue-reading-polish';
const h = await createReadingHarness(out), checks = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
const categoryGeometry = rail => rail.evaluate(node=>({
  offset:node.scrollLeft,
  widths:[...node.querySelectorAll('.approved-tag-stack')].map(card=>card.getBoundingClientRect().width),
  scales:[...node.querySelectorAll('.approved-tag-stack')].map(card=>getComputedStyle(card).transform),
}));
const examples = [
  ['We take off our coats.', '我们脱下外套。'],
  ['As soon as we reach the cabin, we take off our wet coats and sit by the fire.', '我们一到小屋就脱下湿外套，坐到火炉边。'],
  ['After walking through the steady rain for nearly an hour, we take off our coats at the door and hang them beside the stove before anyone sits down.', '我们在雨中走了近一个小时，到门口脱下外套，挂在火炉旁。'],
  ['When we finally reach the cabin, we take off our coats at the door and hang them beside the stove, careful to leave enough space between them so the warm air can reach every fold, while the keeper brings in an old wooden box filled with dry kindling that he gathered the week before, along with a basket of bread that his sister baked early that morning and wrapped in a cloth to keep it warm on her long walk over the hill, a walk she has made every winter since they first began opening the cabin to travelers caught by the rain on the road between the lighthouse and the harbor.', '我们终于走到小屋，在门口脱下外套，挂在火炉旁。守屋人搬来一箱引火柴，也带来姐姐一早烤的面包。'],
];
let page;
try {
  for (const theme of ['sage','midnight']) {
    await h.call('test_reset');
    const original = await h.call('create_tag', { name:'随笔' });
    await h.call('create_tag', { name:'日常' });
    await h.call('create_tag', { name:'旅行' });
    const file = await h.call('import_reading_material', { input: {
      operation_id:crypto.randomUUID(), name:'Rain at the Cabin.txt', normalized_kind:'txt',
      content:examples.map(([s])=>s).join('\n'), tag_ids:[original],
      segments:examples.map(([en_text,zh_text],index)=>({index,en_text,zh_text})),
    } });
    const material = await h.call('open_reading_material', { fileId:file.file_id });
    for (const segment of material.segments) {
      const at=segment.en_text.indexOf('take off');
      await h.call('mutate_saved_record', { operationId:crypto.randomUUID(), mutation:{kind:'save',input:{
        segment_id:segment.id,expression:'take off',start_offset:at,end_offset:at+8,
        explanation:'脱下外套。',explanation_source:'personal',
      }} });
    }
    const phone = await h.browser.newContext({ viewport:{width:393,height:852},isMobile:true,hasTouch:true });
    page = await phone.newPage();
    await h.fixture(page,theme);
    await page.goto(h.url+'/files');
    await page.evaluate(async fileId => {
      const { useMaterialStore } = await window.__uiStoreModule('materialStore');
      const { useReadingDeskStore } = await window.__uiStoreModule('readingDeskStore');
      await useMaterialStore.getState().load();
      const file = useMaterialStore.getState().files.find(entry=>entry.id===fileId);
      useReadingDeskStore.getState().keepAndOpen(file);
    }, file.file_id);
    const tag = page.locator('.approved-card[data-desk-active=true] .approved-tag-edit');
    await tag.waitFor();
    await page.locator('.approved-library-entry').tap();
    await page.locator('.approved-tag-rail').waitFor();
    await page.waitForFunction(()=>!document.querySelector('.approved-tag-flight'));
    const rail = page.locator('.approved-tag-rail');
    const before = await categoryGeometry(rail);
    const cdp = await phone.newCDPSession(page);
    const frame = await rail.boundingBox(), y = frame.y+frame.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:320,y}]});
    for (let step=1;step<=7;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:320-step*23,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(old=>Math.abs(document.querySelector('.approved-tag-rail').scrollLeft-old)>45,before.offset);
    const after = await categoryGeometry(rail);
    check(before.widths.length >= 4 && before.widths.every((value,index)=>Math.abs(value-after.widths[index])<.5)
      && after.scales.every(value=>value==='none'), `${theme} category sizes remain fixed through a real horizontal touch gesture`);
    await page.screenshot({path:`${out}/${theme}-category.png`});
    await page.locator('.approved-rail-back').tap();
    await rail.waitFor({state:'detached'});
    await tag.tap();
    const add = page.locator('.home-create-tag-action');
    await add.waitFor();
    await add.scrollIntoViewIfNeeded();
    const plus = await add.boundingBox();
    check(await add.evaluate(node=>getComputedStyle(node).backgroundColor!=='rgb(251, 250, 245)'),`${theme} add chip uses its green surface`);
    await add.tap();
    const field = page.getByRole('textbox',{name:'输入标签名称'});
    await field.waitFor();
    const entry = page.locator('.home-create-tag-entry'), edit = await entry.boundingBox();
    check(await add.count()===0 && Math.abs(plus.y-edit.y)<2 && Math.abs(plus.height-edit.height)<2
      && await field.evaluate(node=>node===document.activeElement), `${theme} the same chip becomes a focused inline editor`);
    await field.fill('未提交 QA');
    await page.keyboard.press('Escape');
    await entry.waitFor({state:'detached'});
    check(!(await h.call('list_tags')).some(tag=>tag.name==='未提交 QA'), `${theme} leaving the editor discards the draft`);
    await tag.tap();
    await add.scrollIntoViewIfNeeded();
    await add.tap();
    await field.fill('海岸 QA');
    await page.screenshot({path:`${out}/${theme}-add.png`});
    await entry.getByRole('button',{name:'保存'}).tap();
    await entry.waitFor({state:'detached'});
    await page.waitForFunction(()=>document.querySelector('.approved-card[data-desk-active=true] .approved-tag-edit')?.textContent==='海岸 QA');
    const persisted = (await h.call('list_materials')).find(item=>item.id===file.file_id);
    check(persisted.tags.map(tag=>tag.name).join()==='海岸 QA' && (await h.call('list_tags')).some(tag=>tag.name==='海岸 QA'),
      `${theme} confirm creates exactly one category and applies it to the current card`);

    for (const mobile of [true,false]) {
      const context = mobile ? phone : await h.browser.newContext({viewport:{width:1280,height:800}});
      if (!mobile) { page = await context.newPage(); await h.fixture(page,theme); }
      await page.goto(h.url+'/saved');
      const sentence = page.locator('.approved-folio-sentence');
      await sentence.waitFor();
      await page.evaluate(()=>document.fonts.ready);
      const reads = new Map();
      const next = page.locator('.approved-context-pager button').last();
      for(let i=0;i<examples.length;i++){
        if(i>0){
          const previous=await sentence.innerText();
          await next.click();
          await page.waitForFunction(old=>document.querySelector('.approved-folio-sentence')?.textContent!==old,previous);
        }
        const result=await sentence.evaluate(node=>{
          const viewport=node.closest('.approved-folio-scroll');
          return {example:node.textContent,size:parseFloat(getComputedStyle(node).fontSize),extra:viewport.scrollHeight-viewport.clientHeight};
        });
        const sample=examples.findIndex(([text])=>text===result.example);
        reads.set(sample,result);
        await page.screenshot({path:`${out}/${theme}-${mobile?'phone':'desktop'}-saved-${sample}.png`});
      }
      const sizes=[...reads.entries()].sort(([a],[b])=>a-b).map(([,row])=>row.size);
      check(reads.size===4 && sizes.join()===(mobile?'34,30,26,24':'46,38,32,28'), `${theme} ${mobile?'phone':'desktop'} bounded font sizes across four lengths`);
      check([0,1,2].every(i=>reads.get(i).extra<=1) && reads.get(3).extra>20, `${theme} ${mobile?'phone':'desktop'} only the extra-long fixture needs page scroll`);
      if (!mobile) {
        const rail = page.locator('.approved-tag-rail');
        const tag = page.locator('.approved-card[data-desk-active=true] .approved-tag-edit');
        const add = page.locator('.home-create-tag-action');
        const entry = page.locator('.home-create-tag-entry');
        const field = page.getByRole('textbox',{name:'输入标签名称'});
        for (let index=0;index<8;index++) await h.call('create_tag',{name:`桌面分类 ${index+1}`});
        await page.goto(h.url+'/files');
        await page.evaluate(async fileId => {
          const { useMaterialStore } = await window.__uiStoreModule('materialStore');
          const { useReadingDeskStore } = await window.__uiStoreModule('readingDeskStore');
          await useMaterialStore.getState().load();
          useReadingDeskStore.getState().keepAndOpen(useMaterialStore.getState().files.find(file=>file.id===fileId));
        },file.file_id);
        await page.locator('.approved-library-entry').click();
        await rail.waitFor();
        await page.waitForFunction(()=>!document.querySelector('.approved-tag-flight'));
        const start = await categoryGeometry(rail);
        const frame = await rail.boundingBox();
        await page.mouse.move(frame.x+frame.width*.6,frame.y+frame.height/2);
        await page.mouse.wheel(240,0);
        await page.waitForFunction(offset=>document.querySelector('.approved-tag-rail').scrollLeft>offset+150,start.offset);
        const moved = await categoryGeometry(rail);
        check(moved.widths.every((width,index)=>width===start.widths[index]) && moved.scales.every(scale=>scale==='none'),
          `${theme} desktop horizontal scrolling with a stationary pointer keeps category sizes fixed`);
        await page.locator('.approved-rail-back').click();
        await rail.waitFor({state:'detached'});
        await tag.click();
        await add.scrollIntoViewIfNeeded();
        const plus = await add.boundingBox();
        await add.click();
        const name = '一段用于桌面验收的中文长分类标签';
        await field.fill(name);
        const expanded = await entry.boundingBox();
        const save = entry.getByRole('button',{name:'保存'});
        const button = await save.boundingBox();
        check(Math.abs(plus.y-expanded.y)<2 && button.x+button.width<=1280 && await save.isEnabled(),
          `${theme} desktop long tag stays in the same row with a reachable checkmark`);
        await page.locator('.approved-home-header').click();
        await entry.waitFor({state:'detached'});
        check(!(await h.call('list_tags')).some(tag=>tag.name===name),`${theme} clicking outside discards the desktop draft`);
        await tag.click();
        await add.scrollIntoViewIfNeeded();
        await add.click();
        await field.fill(name);
        await save.click();
        await entry.waitFor({state:'detached'});
        check((await h.call('list_materials')).find(item=>item.id===file.file_id).tags[0]?.name===name,
          `${theme} desktop checkmark creates and applies the long tag`);
      }
      await context.close();
    }
  }
  assert.deepEqual(h.errors,[]);
  await writeFile(`${out}/report.json`,JSON.stringify({checks},null,2));
  console.log(`Reading interaction polish: ${checks.length} checks passed`);
} catch (error) {
  await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});
  throw error;
} finally { await h.dispose(); }
