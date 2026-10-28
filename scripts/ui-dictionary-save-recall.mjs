/** Browser -> production Rust commands -> disposable SQLite. No save/result mocks. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/dictionary-reading-save-recall-v1`;
const h=await createReadingHarness(output);
const checks=[],observations=[],network=[];
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log(label);};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);console.log(label);};
let page;
const sentences=["An important decision can change a person's life.",'Keep the change.','The weather can change quickly.','They will take off soon.','We will take off tomorrow.','A zzyyunknownword appears here.','Please record the record.','The US welcomed us warmly.'];
const importText=async(name,rows)=>{
 const content=rows.map((text,i)=>`${i+1}\n00:00:${String(i+1).padStart(2,'0')},000 --> 00:00:${String(i+2).padStart(2,'0')},000\n${text}\n`).join('\n');
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name,content,segments:rows.map((en_text,index)=>({index,en_text,zh_text:null,start_time:`00:00:${String(index+1).padStart(2,'0')}.000`,end_time:`00:00:${String(index+2).padStart(2,'0')}.000`}))}});
 return h.call('open_reading_material',{fileId:imported.file_id});
};
const groups=(query='')=>h.call('list_saved_groups',{query,limit:50,offset:0});
const records=(query='')=>h.call('list_saved_records',{query,limit:200,offset:0});
const word=(row,text)=>page.locator(`[data-sentence="${row}"] .reading-word`).filter({hasText:new RegExp(`^${text}$`)}).first();
const close=async()=>{await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});};
const open=async(row,text,wait=true)=>{await word(row,text).click();await page.locator('.lookup-heading h2').waitFor();if(wait)await page.locator('.dictionary-overview').waitFor();};
const save=async()=>{await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();};
const contrast=locator=>locator.evaluate(node=>{
 const rgba=v=>v.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 let bg=[255,255,255];const stack=[];for(let e=node;e;e=e.parentElement)stack.unshift(rgba(getComputedStyle(e).backgroundColor));
 for(const c of stack){const a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}
 const fg=rgba(getComputedStyle(node).color),a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});
async function capture(name){if(/overview|full|record-ipa/.test(name))await page.locator('.lookup-body').evaluate(n=>{n.scrollTop=0;}).catch(()=>{});await page.locator('.context-panel').evaluate(n=>Promise.allSettled(n.getAnimations().map(a=>a.finished))).catch(()=>{});await page.screenshot({path:`${output}/${name}.png`});}
async function readable(locator,label){const ratio=await contrast(locator);ok(ratio>=4.5,`${label}: text contrast ${ratio.toFixed(2)}`);observations.push({label,contrast:ratio});}
try {
 const status=await h.call('longman_dictionary_status');eq(status.state,'ready','genuine Longman text package ready');
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');const material=await importText(`${theme}-change.srt`,sentences);
  const context=await h.browser.newContext({viewport:{width:1100,height:750}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();network.push(u.href);return route.abort();});
  await page.goto(`${h.url}/files/${material.material.id}`);await word(0,'change').waitFor();
  eq(await page.locator('html').getAttribute('data-theme'),theme,`${theme}: real theme applied`);
  await open(0,'change');eq(await page.locator('input[type="radio"]').count(),0,`${theme}: no sense selection step`);
  eq(await page.locator('.dictionary-overview-line').count(),3,`${theme}: three overview meanings`);
  ok(await page.locator('.dictionary-more').getAttribute('open')===null,`${theme}: full dictionary starts collapsed`);
  ok(await page.locator('.recall-history').count()===0,`${theme}: lookup alone creates no history`);
  const primary=page.locator('.lookup-footer > button');await readable(primary,`${theme}: save default`);await primary.hover();await readable(primary,`${theme}: save hover`);
  await primary.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');ok(await primary.evaluate(n=>n.matches(':focus-visible')&&parseFloat(getComputedStyle(n).outlineWidth)>=2),`${theme}: save keyboard focus`);
  await capture(`${theme}-1100-overview`);
  await page.locator('.dictionary-more > summary').click();ok(await page.locator('[data-sense-id]').count()>3,`${theme}: complete later meanings retained`);await capture(`${theme}-1100-full`);await page.locator('.dictionary-more > summary').click();
  await save();let current=await records('change');eq(current.length,1,`${theme}: actual first save`);eq(current[0].explanation,null,`${theme}: no automatic context meaning`);eq(current[0].explanation_source,'unknown',`${theme}: no false meaning attribution`);ok(!current[0].dictionary_snapshot,`${theme}: no automatically chosen sense snapshot`);eq(current[0].dictionary_reference.senses.length,3,`${theme}: freezes only visible reference excerpt`);const frozen=structuredClone(current[0]);
  await close();await open(1,'change');await page.locator('.recall-history > summary').waitFor();ok((await page.locator('.recall-history > summary').innerText()).includes('1 处原句'),`${theme}: other sentence history, current save remains available`);ok(await page.locator('.lookup-footer > button').isEnabled(),`${theme}: old word can save new context`);ok(await page.locator('.recall-history').getAttribute('open')===null,`${theme}: history starts collapsed after current dictionary`);
  await save();eq((await groups('change')).groups.map(g=>[g.expression,g.context_count]),[['change',2]],`${theme}: one change card, two sentences`);
  await close();await open(2,'change');await save();eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,3,`${theme}: third sentence accumulated`);await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer > button').waitFor();eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,2,`${theme}: undo only third sentence`);ok((await h.call('saved_recall_index')).includes('change'),`${theme}: first two preserve recall`);
  await close();await open(0,'change');await page.locator('.lookup-saved').waitFor();ok((await page.locator('.lookup-saved').innerText()).includes('本句已记下'),`${theme}: reopened current sentence state`);eq(await page.locator('.lookup-footer').getByRole('button',{name:'撤销'}).count(),0,`${theme}: old record has no new undo receipt`);eq((await records('change')).length,2,`${theme}: reopening never duplicates`);
  // Retry the exact real source identity with a different operation ID.
  const s=material.segments[0],start=s.en_text.indexOf('change');const duplicate=await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:s.id,expression:'change',start_offset:start,end_offset:start+6,explanation:null,explanation_source:'unknown'}}});eq(duplicate.changed,false,`${theme}: repeated native save is a no-op`);
  await close();const other=await importText(`${theme}-other-source.srt`,[sentences[0],'Different source content.']);await page.goto(`${h.url}/files/${other.material.id}`);await open(0,'change');await save();eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,3,`${theme}: same sentence in different material retained`);await page.getByRole('button',{name:'撤销',exact:true}).click();await close();
  await page.goto(`${h.url}/files/${material.material.id}`);await word(0,'change').waitFor();
  await page.evaluate(()=>{window.__uiDelayExpression='take';window.__uiLookupDelayMs=2500;});await open(3,'take',false);await page.locator('.lookup-footer > button').click();await page.locator('.lookup-saved').waitFor();let take=(await records('take')).find(r=>r.expression==='take');ok(take&&!take.dictionary_reference,`${theme}: save during real lookup retains original only`);await page.waitForFunction(()=>!!document.querySelector('.dictionary-overview'));take=(await records('take')).find(r=>r.expression==='take');ok(!take.dictionary_reference,`${theme}: late dictionary never rewrites saved snapshot`);await close();await page.evaluate(()=>window.__uiDelayExpression=null);
  // Complete-expression keyboard selection uses existing reading gesture.
  await word(3,'take').focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.lookup-heading h2').filter({hasText:/^take off$/}).waitFor();await page.locator('.dictionary-overview').waitFor();await save();await close();
  await word(4,'take').focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.lookup-heading h2').filter({hasText:/^take off$/}).waitFor();await page.locator('.dictionary-overview').waitFor();await save();eq((await groups('take off')).groups.filter(g=>g.expression==='take off').map(g=>[g.expression,g.context_count]),[['take off',2]],`${theme}: phrase archived independently with two contexts`);await close();
  // Offline/failure path never fabricates a definition or requires an AI setting.
  for(const enabled of [false,true]){
   await page.evaluate(async enabled=>{const {useAiStore}=await window.__uiStoreModule('aiStore');useAiStore.setState({enabled});window.__uiFailure={command:'lookup_longman_expression',remaining:10,afterCommit:false};},enabled);
   await open(5,'zzyyunknownword',false);await page.locator('.lookup-footer > button').waitFor();ok(await page.locator('.lookup-footer > button').isEnabled(),`${theme}: AI ${enabled} unavailable lookup can save`);
   if(!enabled){await save();eq((await records('zzyyunknownword'))[0].explanation,null,`${theme}: unknown word persists without meaning`);await capture(`${theme}-failure-saved`);await page.getByRole('button',{name:'撤销',exact:true}).click();}
   await close();
  }
  await page.evaluate(()=>{window.__uiFailure=null;});
  await open(6,'record');await page.evaluate(async()=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setSpeech({accent:'us'});});const us=await page.locator('.dictionary-overview-ipa').allTextContents();await page.evaluate(async()=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setSpeech({accent:'gb'});});const gb=await page.locator('.dictionary-overview-ipa').allTextContents();ok(gb.length>=2&&us.every(ipa=>!/^\s*\/[-…]/.test(ipa)),`${theme}: noun/verb IPA stays separate; unavailable complete US IPA omitted`);observations.push({theme,recordIPA:{us,gb}});await capture(`${theme}-record-ipa`);await close();
  // Real archive view, independent sentence removal and undo.
  await page.goto(`${h.url}/saved`);const changeCard=page.locator('.saved-record-open').filter({has:page.locator('.saved-record-term',{hasText:/^change$/})});await changeCard.waitFor();eq(await changeCard.count(),1,`${theme}: only one visible change card`);await changeCard.click();await page.locator('.saved-context-entry').first().waitFor();eq(await page.locator('.saved-context-entry').count(),2,`${theme}: card exposes both original sources`);
  const first=page.locator('.saved-context-entry').first();await first.getByRole('button',{name:'更多操作：change',exact:true}).count().then(async n=>{if(n)await first.getByRole('button',{name:'更多操作：change',exact:true}).click();else await first.locator('.ui-button--icon').click();});await first.getByRole('button',{name:'移除这句',exact:true}).click();await page.locator('.saved-undo').waitFor();eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,1,`${theme}: remove one sentence keeps word`);await page.locator('.saved-undo').getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.saved-context-entry').length===2);eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,2,`${theme}: undo restores both originals`);
  await capture(`${theme}-1100-saved-contexts`);await page.setViewportSize({width:800,height:600});await capture(`${theme}-800-saved-contexts`);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: archive 800x600 no overflow`);await close();
  await page.goto(`${h.url}/files/${material.material.id}`);await open(1,'change');await capture(`${theme}-800-overview`);ok(await page.locator('.lookup-footer').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),`${theme}: 800x600 save footer visible`);await page.locator('.dictionary-more > summary').click();await capture(`${theme}-800-full`);await close();await page.setViewportSize({width:1100,height:750});
  // Durable reference & operation receipt roundtrip; detached sources stay readable.
  const backup=await h.call('export_all');await h.call('test_reopen');await h.call('restore_all',{backup});eq((await groups('change')).groups.find(g=>g.expression==='change').context_count,2,`${theme}: reopen and backup restore persist grouped contexts`);const after=(await records('change')).find(r=>r.record_id===frozen.record_id);eq(after.dictionary_reference,frozen.dictionary_reference,`${theme}: portable excerpt roundtrip exact`);
  await h.call('test_delete_source',{fileId:material.material.id});eq(await h.call('saved_record_source',{recordId:frozen.record_id}),null,`${theme}: deleted source cannot falsely locate`);ok((await records('change')).every(r=>r.sentence),`${theme}: deleted source originals remain readable`);
  await page.goto(`${h.url}/saved`);await changeCard.click();await page.locator('.saved-context-entry').first().waitFor();await page.locator('.saved-context-entry').first().getByRole('button',{name:'返回原文',exact:true}).click();await page.getByText('原材料已不存在或已变更，仍可阅读此副本。',{exact:true}).waitFor();ok(true,`${theme}: missing-source feedback explicit`);await readable(page.locator('.saved-context-entry').first().getByRole('button',{name:'返回原文',exact:true}),`${theme}: disabled source action`);await close();
  const calls=await page.evaluate(()=>window.__uiCalls);eq(calls.filter(c=>/analyze_word_occurrence|align|translate/.test(c.command)),[],`${theme}: no AI judgment or alignment requests`);eq(calls.filter(c=>/dictionary.*audio|longman.*audio/.test(c.command)),[],`${theme}: no dictionary recordings`);await context.close();
 }
 eq(network,[],'browser made no external request');eq(h.errors,[],'no browser runtime exceptions');
 await writeFile(`${output}/ui-core-validation.json`,JSON.stringify({passed:true,kind:'Chromium to real Rust/temporary SQLite bridge; not native Tauri window',checks,observations,network,errors:h.errors},null,2));console.log(`Dictionary/save/recall: ${checks.length} checks passed.`);
} catch(error){if(page){await page.screenshot({path:`${output}/core-failure.png`}).catch(()=>{});await writeFile(`${output}/core-failure.json`,JSON.stringify({error:String(error),text:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally {await h.dispose();}
