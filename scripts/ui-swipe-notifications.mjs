/** Actual production UI + disposable SQLite: no painted mockups or user DB. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_FOLLOWUP_UI_OUTPUT||'/tmp/lexicue-swipe-notices';
const h=await createReadingHarness(output);const checks=[];let current;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const settle=async p=>{await p.locator('.mobile-startup').waitFor({state:'detached'});await p.evaluate(async()=>{await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));await Promise.allSettled(document.getAnimations().map(a=>a.finished));});};
const list=()=>h.call('list_saved_records',{query:'',limit:200,offset:0});
async function contrast(locator){return locator.evaluate(node=>{
 const rgb=value=>value.match(/[\d.]+/g).map(Number),lum=values=>values.slice(0,3).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
 let target=node,bg;do{bg=rgb(getComputedStyle(target).backgroundColor);target=target.parentElement;}while(target&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});}
async function seed(){
 const lines=['A quiet morning gives us time to read.','We found a quiet place near the river.','Learning starts with a question.'];
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'A quiet morning.txt',content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:['宁静的早晨让我们有时间阅读。','我们在河边找到了一个安静的地方。','学习从一个问题开始。'][index],start_time:null,end_time:null}))}});
 const material=await h.call('open_reading_material',{fileId:imported.file_id});
 for(const [index,segment] of material.segments.entries()){
  const expression=index===2?'Learning':'quiet',start=lines[index].indexOf(expression);
  await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression,start_offset:start,end_offset:start+expression.length,explanation:`My personal note ${index+1}`,explanation_source:'personal'}}});
 }
 return material;
}
async function swipe(page,row,vertical=false){
 const rect=await row.locator('.saved-record-open').boundingBox(),cdp=await page.context().newCDPSession(page);
 const x=rect.x+Math.min(rect.width-24,230),y=rect.y+25;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-(vertical?5:84)*i/8,y:y+(vertical?90:2)*i/8}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await settle(page);
}
try{
 for(const theme of ['ocean','midnight'])for(const phone of [true,false]){
  await h.call('test_reset');
  const context=await h.browser.newContext({viewport:phone?{width:375,height:812}:{width:1140,height:800},hasTouch:phone,isMobile:phone,reducedMotion:'reduce',...(phone?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile'}:{})});
  const p=await context.newPage();current=p;await h.fixture(p,theme);
  await p.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));
  await p.goto(`${h.url}/files`);await p.locator('.desk-empty .desk-primary').waitFor();await p.locator('.mobile-startup').waitFor({state:'detached'});await settle(p);
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-empty-library.png`});
  await p.goto(`${h.url}/saved`);await p.locator('.saved-empty').waitFor();await settle(p);
  if(phone)await p.screenshot({path:`${output}/${theme}-phone-empty-saved.png`});
  const material=await seed();const before=await list();
  await p.goto(`${h.url}/files?view=library`);const library=p.getByRole('dialog',{name:'材料库',exact:true});await library.locator('.library-row').waitFor();
  const sort=library.getByRole('combobox',{name:'材料排序'});
  eq(await sort.evaluate(n=>!!n.closest('.library-heading')),true,`${theme}/${phone}: sort lives in the heading`);
  await library.getByRole('button',{name:'按标签筛选',exact:true}).click();
  eq(await library.locator('.tag-manage svg').getAttribute('class').then(v=>v.includes('lucide-plus')),true,'tag manager uses a plus');
  await library.getByRole('searchbox').fill('找不到这份材料');await library.locator('.library-no-results').waitFor();await settle(p);
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-material-no-results.png`});
  await library.getByRole('button',{name:'清除筛选',exact:true}).click();await library.locator('.library-row').waitFor();
  await library.locator('.library-menu > button').click();await library.getByRole('button',{name:'删除材料',exact:true}).click();
  const confirmation=p.getByRole('dialog',{name:'删除材料',exact:true});await confirmation.waitFor();
  eq(await confirmation.evaluate(n=>{const r=n.getBoundingClientRect();return r.width<=340&&r.width<innerWidth-40;}),true,'material confirmation is a compact popup');
  assert.match(await confirmation.innerText(),/已保存的原句、释义和笔记会保留/);
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-delete-material-confirm.png`});
  await confirmation.getByRole('button',{name:'取消',exact:true}).click();eq((await h.call('list_materials')).length,1,'cancel preserves the material');
  await p.goto(`${h.url}/saved`);await p.locator('.saved-record-open').first().waitFor();
  const quiet=p.locator('.page-live .saved-record-row').filter({has:p.locator('.saved-record-term',{hasText:/^quiet$/})});
  await quiet.waitFor();await settle(p);
  if(phone){await swipe(p,quiet,true);eq(await quiet.getAttribute('data-swipe-open'),null,'vertical scroll never reveals delete');await swipe(p,quiet);}
  else{await quiet.locator('.saved-record-open').focus();await p.keyboard.press('Delete');}
  eq(await quiet.getAttribute('data-swipe-open'),'true','swipe/keyboard reveals an explicit trash action');eq((await list()).length,3,'swiping alone never deletes');
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-swipe-delete.png`});
  const trash=quiet.getByRole('button',{name:'删除“quiet”及全部 2 句',exact:true});
  eq(await contrast(trash)>=4.5,true,'delete icon contrast works in this theme');
  await quiet.locator('.saved-record-open').focus();await p.keyboard.press('Shift+Tab');
  eq(await trash.evaluate(n=>{const style=getComputedStyle(n);return document.activeElement===n&&n.matches(':focus-visible')&&(style.outlineStyle!=='none'||style.boxShadow!=='none');}),true,'revealed delete has a keyboard focus indicator');
  await trash.click();await quiet.waitFor({state:'detached'});
  eq((await list()).length,1,'one click deletes all contexts of exactly one expression');
  eq((await h.call('list_materials')).length,1,'deleting saved contexts preserves the source material');
  const undo=p.getByRole('button',{name:'撤销',exact:true});await undo.waitFor();
  const toast=p.locator('.toast-card').filter({has:undo});
  eq(await toast.evaluate(n=>{const r=n.getBoundingClientRect();return r.width<=360&&r.width<innerWidth-40;}),true,'undo is a floating compact notice');
  eq(await contrast(toast.locator('.toast-message'))>=4.5,true,'floating notification text contrast');
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-undo-notice.png`});
  await undo.click();await quiet.waitFor();const restored=await list();
  eq(restored.map(r=>[r.record_id,r.sentence,r.explanation,r.source]).sort(),before.map(r=>[r.record_id,r.sentence,r.explanation,r.source]).sort(),'group undo restores every note, original and source snapshot');
  // A lost receipt retries the same native operation, without partial writes.
  await quiet.locator('.saved-record-open').focus();await p.keyboard.press('Delete');
  await p.evaluate(()=>{window.__uiFailure={command:'remove_saved_group',afterCommit:true,remaining:1};});
  await quiet.getByRole('button',{name:'删除“quiet”及全部 2 句',exact:true}).click();await p.getByRole('button',{name:'复制报错信息',exact:true}).waitFor();
  eq((await list()).length,1,'lost receipt still committed the complete group');
  await quiet.getByRole('button',{name:'删除“quiet”及全部 2 句',exact:true}).click();await quiet.waitFor({state:'detached'});
  eq(await p.evaluate(()=>{const calls=window.__uiCalls.filter(c=>c.command==='remove_saved_group');return calls.at(-1).args.operationId===calls.at(-2).args.operationId;}),true,'lost receipt retry reuses the operation ID');
  await p.getByRole('button',{name:'撤销',exact:true}).click();await quiet.waitFor();
  await p.locator('.saved-search input').fill('不匹配的记录');await p.locator('.saved-empty').waitFor();await settle(p);
  await p.screenshot({path:`${output}/${theme}-${phone?'phone':'desktop'}-saved-no-results.png`});
  eq((await h.call('open_reading_material',{fileId:material.material.id})).segments.length,3,'saved removal never changes original reading content');
  await context.close();
 }
 eq(h.errors,[],'no application exceptions');await writeFile(`${output}/report.json`,JSON.stringify({checks,scope:'Screenshots of the running React UI using production Rust cores and disposable real SQLite, Chromium desktop/touch emulation. No generated mockups; no personal learning database or physical-device acceptance.'},null,2));console.log(`Swipe and notices: ${checks.length} checks passed; ${output}`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
