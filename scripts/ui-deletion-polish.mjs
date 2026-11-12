/** Browser interaction checks with real temporary SQLite; only OS confirmation
 * and the delete-job transport are controlled. Native job batching is covered
 * by files.rs and each platform's installed candidate acceptance. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_READING_UI_OUTPUT||'/tmp/lexicue-deletion-polish';
const h=await createReadingHarness(output,['test_delete_source']);
const checks=[];
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);};
try {
 for(const theme of ['ocean','midnight']) for(const phone of [false,true]) {
  await h.call('test_reset');
  const sentence='A compass helps us find our way.';
  const result=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'remove-me.txt',content:sentence,segments:[{index:0,en_text:sentence,zh_text:null,start_time:null,end_time:null}]}});
  const material=await h.call('open_reading_material',{fileId:result.file_id});
  const saved=await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:material.segments[0].id,expression:'compass',start_offset:2,end_offset:9,explanation:'My compass note',explanation_source:'personal'}}});
  const context=await h.browser.newContext({viewport:phone?{width:375,height:812}:{width:1140,height:714},...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile'}:{}),reducedMotion:'reduce'});
  const page=await context.newPage();await h.fixture(page,theme);
  await page.addInitScript(()=>{
   window.__confirmDelete=false;window.__deleteFail=false;window.__deleteAsks=[];
   const base=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='plugin:dialog|message'){window.__deleteAsks.push(args);return args.buttons.OkCancelCustom[window.__confirmDelete?0:1];}
    if(command==='delete_file_start'){
     if(window.__deleteFail) throw Error('local_delete_failed');
     await base('test_delete_source',args);return {job_id:'controlled',file_id:args.fileId,phase:'done'};
    }
    return base(command,args);
   };
  });
  await page.goto(`${h.url}/files/${result.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^compass$/}).click();
  await page.locator('.context-panel').waitFor();
  eq(await page.locator('.context-mobile-return').textContent(),'',`${theme}/${phone}: collapse has no duplicate visible copy`);
  eq(await page.locator('.context-mobile-return').getAttribute('aria-label'),'收起，继续',`${theme}/${phone}: collapse retains its accessible name`);
  if(phone) await page.getByRole('button',{name:'收起，继续',exact:true}).click(); else await page.keyboard.press('Escape');
  await page.locator('.context-panel').waitFor({state:'detached'});
  await page.goto(`${h.url}/files?view=library`);await page.locator('.library-row').waitFor();
  const more=page.locator('.library-menu > button');
  await more.click();await page.getByRole('button',{name:'删除材料',exact:true}).click();
  eq((await h.call('list_materials')).length,1,`${theme}/${phone}: cancel keeps material`);
  assert.match(JSON.stringify(await page.evaluate(()=>window.__deleteAsks)),/remove-me.txt/);
  eq(await more.evaluate(node=>node===document.activeElement),true,`${theme}/${phone}: cancel restores the menu trigger focus`);
  await page.evaluate(()=>{window.__confirmDelete=true;window.__deleteFail=true;});
  await more.click();await page.getByRole('button',{name:'删除材料',exact:true}).click();
  await page.getByRole('button',{name:'复制报错信息',exact:true}).waitFor();
  eq((await h.call('list_materials')).length,1,`${theme}/${phone}: failure keeps material and allows retry`);
  await page.evaluate(()=>window.__deleteFail=false);
  await more.click();await page.getByRole('button',{name:'删除材料',exact:true}).click();
  await page.locator('.library-row').waitFor({state:'detached'});
  eq((await h.call('list_materials')).length,0,`${theme}/${phone}: success refreshes library`);
  eq((await h.call('list_saved_records',{query:'',limit:10,offset:0}))[0],saved.record,`${theme}/${phone}: saved sentence and personal meaning remain exact`);
  await page.goto(`${h.url}/saved`);await page.locator('.saved-record-open').click();
  const remove=page.getByRole('button',{name:'移除这句',exact:true});await remove.waitFor();
  eq(await remove.innerText(),'',`${theme}/${phone}: sentence removal uses an icon with an accessible name`);
  if(phone) {
   await page.setViewportSize({width:812,height:375});
   await page.locator('html').evaluate(node=>node.style.fontSize='125%');
   eq(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${theme}: landscape enlarged text does not overflow`);
   await page.setViewportSize({width:375,height:812});
  }
  await remove.click();await page.locator('.saved-record-row').waitFor({state:'detached'});
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.saved-record-row').waitFor();
  eq((await h.call('list_saved_records',{query:'',limit:10,offset:0}))[0].explanation,'My compass note',`${theme}/${phone}: final-context undo keeps note after source deletion`);
  await context.close();
 }
 eq(h.errors,[],'no uncaught browser errors');await writeFile(`${output}/deletion-polish.json`,JSON.stringify({checks},null,2));console.log(`Deletion polish: ${checks.length} checks passed`);
} finally {await h.dispose();}
