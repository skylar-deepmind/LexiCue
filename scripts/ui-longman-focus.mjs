/** Stable keyboard-focus screenshots with the genuine package and Rust bridge. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_LONGMAN_UI_OUTPUT||`${root}/docs/implementation/evidence/longman-reading-v1`;
const h=await createReadingHarness(`${output}/focus`);
try{
 const text='Please record the record.';const imported=await h.call('import_reading_material',{input:{operation_id:'focus-ui',name:'focus.srt',content:`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,segments:[{index:0,en_text:text,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});const outcomes=[];
 for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext({viewport:{width:1100,height:750}});const page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').filter({hasText:/^record$/}).first().click();await page.locator('.dictionary-overview').waitFor();await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
  await page.locator('.dictionary-more > summary').focus();await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement.matches(':focus-visible')));assert.ok(await page.locator('.context-panel').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await page.screenshot({path:`${output}/${theme}-focus.png`});outcomes.push({theme,focused:await page.evaluate(()=>({tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outline})),cardFits:true});await context.close();
 }
 await writeFile(`${output}/focus-ui.json`,JSON.stringify({passed:true,outcomes},null,2));console.log('Stable focus screenshots: both themes passed.');
}finally{await h.dispose();}
