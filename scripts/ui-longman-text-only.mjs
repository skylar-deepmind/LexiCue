/** Retired recordings: real text/IPA lookup and saving work without audio notices. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_LONGMAN_UI_OUTPUT||`${root}/docs/implementation/evidence/longman-reading-v1`;
assert.ok(process.env.LEXICUE_LONGMAN_PACKAGE_ROOT,'Set an explicit reviewed package root');
const h=await createReadingHarness(`${output}/text-only`);const {browser,url,call,fixture}=h;
try{
 const status=await call('longman_dictionary_status');assert.equal(status.state,'ready');assert.equal(status.audio_available,false);
 const text='Curiosity helped us record the US visit.';const imported=await call('import_reading_material',{input:{operation_id:'text-only-ui',name:'text-only.srt',content:`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,segments:[{index:0,en_text:text,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});
 const outcomes=[];
 for(const theme of ['ocean','midnight']){
  const context=await browser.newContext({viewport:{width:1100,height:750}});const page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);await page.goto(`${url}/files/${imported.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^Curiosity$/}).click();await page.locator('.longman-result[data-result-status="found"]').waitFor();assert.ok((await page.locator('.longman-entry-heading').allTextContents()).join(' ').includes('curiosity'));assert.equal(await page.locator('.longman-audio').count(),0);
  await page.locator('.reading-word').filter({hasText:/^record$/}).click();await page.locator('.lookup-heading h2').filter({hasText:/^record$/}).waitFor();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();await page.locator('.dictionary-overview').waitFor();assert.equal(await page.locator('.longman-audio').count(),0);assert.ok(await page.locator('[data-sense-id]').count()>=2);const notices=(await page.locator('.longman-notice').allTextContents()).join(' ');assert.doesNotMatch(notices,/录音|发音包/);assert.equal(await page.locator('.dictionary-overview .longman-ipa').count(),0);assert.ok(await page.locator('.longman-pronunciations .longman-ipa').count()>=2);assert.equal(await page.locator('.lookup-heading button').count(),1);assert.equal(await page.locator('.lookup-context button').count(),1);
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();const saved=(await call('list_saved_records',{query:'record',limit:100,offset:0}))[0];assert.equal(saved.dictionary_reference.headword,'record');
  await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));await page.screenshot({path:`${output}/${theme}-text-only.png`});await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).waitFor();outcomes.push({theme,titleCaseQuery:'Curiosity → curiosity',textStatus:'found',dictionaryAudioButtons:0,notices,ipaRetained:true,systemSpeechControlsRetained:true,save:true});await context.close();
 }
 const upper=await call('lookup_longman_expression',{expression:'US'}),lower=await call('lookup_longman_expression',{expression:'us'});assert.equal(upper.status,'partial');assert.equal(lower.status,'found');assert.notEqual(upper.entries[0].id,lower.entries[0].id);
 await writeFile(`${output}/text-only-ui.json`,JSON.stringify({passed:true,backend:'actual Rust + real reviewed package; recordings ignored even when installed; no lookup fixture',status,outcomes,caseBoundary:{US:upper.status,us:lower.status,distinctEntry:true}},null,2));console.log('Text-only and title-case real UI: both themes passed.');
}finally{await h.dispose();}
