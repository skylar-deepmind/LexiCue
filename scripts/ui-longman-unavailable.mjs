/** Genuine missing-package feedback via production Rust core, disposable DB. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_LONGMAN_UI_OUTPUT||`${root}/docs/implementation/evidence/longman-reading-v1`;
assert.ok(process.env.LEXICUE_LONGMAN_PACKAGE_ROOT,'Set an explicit nonexistent isolated package path for this check');
const harness=await createReadingHarness(`${output}/unavailable`);
const {browser,url,call,fixture}=harness;let page;
try{
 const status=await call('longman_dictionary_status');assert.equal(status.state,'unavailable');
 const text='We will take off after noon.';
 const imported=await call('import_reading_material',{input:{operation_id:'missing-package-ui',name:'missing-package.srt',content:`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,segments:[{index:0,en_text:text,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});
 const outcomes=[];
 for(const theme of ['ocean','midnight']){
  const context=await browser.newContext({viewport:{width:1100,height:750}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);await page.goto(`${url}/files/${imported.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^take$/}).click();await page.locator('.longman-result[data-result-status="unavailable"]').waitFor();
  assert.equal(await page.locator('[data-sense-id]').count(),0);assert.equal(await page.locator('.lookup-footer button').isEnabled(),true);
  const body=await page.locator('.lookup-body').innerText();assert.match(body,/本地朗文词典包/);assert.ok(!body.includes('未查到这个表达'));
  await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.longman-result[data-result-status="unavailable"]').waitFor();
  await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
  await page.screenshot({path:`${output}/${theme}-missing-package.png`});outcomes.push({theme,status:'unavailable',notFound:false,retry:true,emptySenses:true,saveAvailableWithoutMeaning:true});await context.close();
 }
 await writeFile(`${output}/missing-package-ui.json`,JSON.stringify({passed:true,backend:'actual Rust missing-package result; no lookup fixture',package:process.env.LEXICUE_LONGMAN_PACKAGE_ROOT,outcomes},null,2));console.log('Missing-package real UI: both themes passed.');
}finally{await harness.dispose();}
