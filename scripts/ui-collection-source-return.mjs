/** Pagination/source-return against real command cores and disposable SQLite. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_READING_UI_OUTPUT||'/tmp/lexicue-collection-source';
const h=await createReadingHarness(output);const checks=[];let current;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
try {
 await h.call('test_reset');
 const expressions=[...Array(21).fill('quiet'),'apple','book','city','door','early','friend','green','home','idea','journey','kind','light','morning','night','open','paper','question','river','story','time'];
 const lines=expressions.map((word,index)=>`${word} is part of original sentence ${index+1}.`);
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'Paged sources.txt',content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:null,start_time:null,end_time:null}))}});
 const material=await h.call('open_reading_material',{fileId:imported.file_id});
 for(const [index,segment] of material.segments.entries())await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression:expressions[index],start_offset:0,end_offset:expressions[index].length,explanation:null,explanation_source:'unknown'}}});
 for(const theme of ['ocean','midnight'])for(const width of [375,1280]) {
  const context=await h.browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();current=page;await h.fixture(page,theme);
  await page.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));
  await page.goto(`${h.url}/saved`);await page.locator('.saved-record-row').first().waitFor();
  const pager=page.locator('.collection-toolbar').getByRole('textbox',{name:'跳转到页码'});
  await pager.fill('2');await pager.press('Enter');await page.waitForFunction(()=>document.querySelector('.saved-record-term')?.textContent==='quiet');
  await page.locator('.saved-record-open').click();await page.getByRole('button',{name:'还有 20 句',exact:true}).click();
  const contextPager=page.locator('.saved-group-contexts').getByRole('textbox',{name:'跳转到页码'});
  await page.evaluate(()=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
      const result=await invoke(command,args);
      if(command==='saved_record_source'){window.__sourcePending=true;await new Promise(resolve=>setTimeout(resolve,150));window.__sourcePending=false;}
      if(command==='saved_group_contexts'&&args.offset===20)await new Promise(resolve=>setTimeout(resolve,350));
      return result;
    };
  });
  await page.getByRole('button',{name:'返回原文',exact:true}).click();
  await page.waitForFunction(()=>window.__sourcePending);
  await contextPager.fill('2');await contextPager.press('Enter');
  await page.waitForFunction(()=>window.__sourcePending===false);
  eq(new URL(page.url()).pathname,'/saved',`${theme}/${width}: context page change cancels an earlier source visit`);
  await page.waitForFunction(()=>document.querySelectorAll('.saved-sentence').length===1&&!document.querySelector('.saved-group-contexts[aria-busy=true]'));
  const record=await page.locator('.saved-sentence').getAttribute('data-record');
  await page.getByRole('button',{name:'返回原文',exact:true}).click();await page.locator('.reading-page').waitFor();
  await page.locator('.reader-return-origin').click();
  await page.waitForFunction(()=>document.querySelector('.saved-record-open[aria-expanded=true]')&&!document.querySelector('.saved-group-contexts[aria-busy=true]'));
  eq(await pager.inputValue(),'2',`${theme}/${width}: source return restores group page`);
  eq(await contextPager.inputValue(),'2',`${theme}/${width}: source return restores context page`);
  eq(await page.locator('.saved-sentence').getAttribute('data-record'),record,`${theme}/${width}: source return restores exact sentence`);
  eq(await page.locator('.saved-record-row').count(),1,`${theme}/${width}: no preceding pages were refetched into DOM`);
  await context.close();
 }
 eq(h.errors,[],'no application errors');await writeFile(`${output}/collection-source-report.json`,JSON.stringify({checks,scope:'Production Rust/SQLite cores and disposable database; Chromium desktop/mobile layout, not physical WebKit'},null,2));console.log(`Collection source return: ${checks.length} checks passed`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
