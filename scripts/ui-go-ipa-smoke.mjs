/** Final lightweight go IPA regression, genuine Rust dictionary and temporary DB. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/dictionary-inflection-v1/ui-go-ipa`;
const h=await createReadingHarness(output),checks=[];
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log(label);};
let page;
try{
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');const sentence='We go home together.';
  const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`${theme}-go-ipa.srt`,content:`1\n00:00:01,000 --> 00:00:03,000\n${sentence}\n`,segments:[{index:0,en_text:sentence,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});
  const context=await h.browser.newContext({viewport:{width:1100,height:750}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);
  await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').filter({hasText:/^go$/}).click();await page.locator('.dictionary-overview').waitFor();
  await page.evaluate(async()=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setSpeech({accent:'us'});});
  const overview=await page.locator('.dictionary-overview-ipa .longman-ipa').allTextContents();
  ok(overview.length>0&&overview.every(ipa=>ipa==='/ɡoʊ/'),`${theme}: overview shows only go headword US IPA`);
  await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));await page.screenshot({path:`${output}/${theme}-go-overview.png`});
  await page.locator('.dictionary-more > summary').click();const details=await page.locator('.dictionary-more').innerText();
  ok(details.includes('/ɡɒːn/')&&details.includes('past participle: gone'),`${theme}: gone IPA retains its form label in complete details`);
  ok(details.includes('/ɡoʊz/')&&details.includes('third person singular: goes'),`${theme}: goes IPA retains its form label in complete details`);
  await context.close();page=null;
 }
 ok(h.errors.length===0,'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,kind:'lightweight controlled Chromium to real Rust after final compact-IPA fix; no new performance run',checks},null,2));
}catch(error){if(page)await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await h.dispose();}
