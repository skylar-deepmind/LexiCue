/** Production Rust + genuine dictionary service → browser UI.
 * This script does not fabricate dictionary responses. Use the separately labelled
 * real-page replay service for deterministic runs, or the live service for live runs.
 */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {createReadingHarness, root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_CAMBRIDGE_UI_OUTPUT||`${root}/docs/implementation/evidence/cambridge-online-v1/gap-modes`;
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output), {browser,url,call,fixture,errors}=h;
const checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);};
const eq=(v,w,label)=>{assert.deepEqual(v,w,label);checks.push(label);};
const sentences=[process.env.LEXICUE_CASE==='capitalized'?'Doomscrolling keeps us awake at night.':'Late doomscrolling keeps us awake at night.','Please record the record before dinner.','It will cost an arm and a leg.','The US welcomed us warmly.','He drove a red car yesterday.'];
const segments=sentences.map((en_text,index)=>({index,en_text,zh_text:null,start_time:`00:00:0${index+1}.000`,end_time:`00:00:0${index+2}.000`}));
const content=sentences.map((s,i)=>`${i+1}\n00:00:0${i+1},000 --> 00:00:0${i+2},000\n${s}\n`).join('\n');
const word=(row,s,n=0)=>page.locator(`[data-sentence="${row}"] .reading-word`).filter({hasText:new RegExp(`^${s}$`)}).nth(n);
async function ready(text){await page.getByRole('dialog',{name:text,exact:true}).waitFor();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();await page.waitForFunction(()=>document.querySelector('.longman-result')||document.querySelector('.lookup-body > .longman-notice'));}
async function open(row,text,n=0){await word(row,text,n).click();await ready(text);}
async function cambridge(){await page.locator('.lookup-body[data-active-dictionary="cambridge"] .dictionary-overview').waitFor({timeout:20000});}
async function shot(name){await page.locator('.context-panel').evaluate(n=>Promise.allSettled(n.getAnimations().map(a=>a.finished)));await page.screenshot({path:`${output}/${name}.png`});}
async function layout(label){await page.locator('.context-panel').evaluate(n=>Promise.allSettled(n.getAnimations().map(a=>a.finished)));ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: no horizontal overflow`);ok(await page.locator('.lookup-footer').evaluate(n=>{let r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),`${label}: save footer visible`);}
try{
 const missing=process.env.LEXICUE_CASE==='missing-package',capitalized=process.env.LEXICUE_CASE==='capitalized';console.log('gap mode started',process.env.LEXICUE_CASE||'confirmed-absence');
 eq((await call('longman_dictionary_status')).state,missing?'unavailable':'ready','expected local package state');
 for(const theme of ['ocean','midnight']){console.log('theme',theme);
  await call('test_reset');const imported=await call('import_reading_material',{input:{operation_id:`gap-mode-${theme}`,name:`gap-${theme}.srt`,content,segments}});const ctx=await browser.newContext({viewport:{width:800,height:600}});page=await ctx.newPage();await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);await page.goto(`${url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();
  if(missing||capitalized){const target=capitalized?'Doomscrolling':'doomscrolling';await open(0,target);await cambridge();eq(await page.locator('.lookup-body').getAttribute('data-active-dictionary'),'cambridge',`${theme}: gap automatically uses valid online source`);await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();const saved=(await call('list_saved_records',{query:target,limit:100,offset:0}))[0];eq(saved.dictionary_reference.senses[0].source.provider,'cambridge',`${theme}: confirmed online sense remains saveable`);if(capitalized){eq(saved.expression,'Doomscrolling',`${theme}: original capitalization saved`);eq(saved.dictionary_reference.headword,'doomscrolling',`${theme}: source canonical headword saved separately`);}}
  else{await word(4,'a').focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await ready('a red car');await page.locator('.lookup-body[data-online-state="ready"]').waitFor();eq(await page.locator('[data-sense-id]').count(),0,`${theme}: both dictionaries confirm no whole expression`);ok((await page.locator('.lookup-body').innerText()).includes('两本词典均未确认到这个表达'),`${theme}: confirmed not-found has distinct feedback`);eq(await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).isEnabled(),true,`${theme}: confirmed absence still allows original-only save`);}
  await layout(`${theme} gap 800x600`);await shot(`${theme}-${capitalized?'capitalized-online':missing?'missing-package-online':'confirmed-not-found'}`);await ctx.close();
 }
 eq(errors,[],'no browser exceptions');await writeFile(`${output}/gap-evidence.json`,JSON.stringify({passed:true,mode:process.env.LEXICUE_CAMBRIDGE_EVIDENCE_MODE||'genuine captured Cambridge HTML replay through service and production Rust bridge',case:process.env.LEXICUE_CASE||'confirmed-absence',checks:checks.length,assertions:checks,errors},null,2));console.log(`Gap mode: ${checks.length} checks passed`);
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await page.evaluate(()=>({text:document.body.innerText,calls:window.__uiCalls})),null,2)).catch(()=>{});}await writeFile(`${output}/gap-evidence.json`,JSON.stringify({passed:false,checks:checks.length,error:String(error)},null,2));throw error;}finally{await h.dispose();}
