/** Chromium UI -> real Rust queries/save/archive/recall -> disposable SQLite.
 * No result/save mocks, AI, clipboard access, or user profile writes. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';

const output=`${root}/docs/implementation/evidence/dictionary-inflection-v1`;
const h=await createReadingHarness(output);
const checks=[],observations=[],network=[],querySamples=[];
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log(label);};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);console.log(label);};
let page;
const seedRows=['We go home together.','I see the trees.','The children are reading.','They are running fast.','She studied the map.','They changed their plans.','There are books here.','They came with us.','It may rain.'];
const encounterRows=['We went home yesterday.','I saw a bird.','We go home again.','They saw the old tool.','The US sent us a note.','May may be warm in MAY.','Go where Went is written.'];
async function material(name,rows){
 const content=rows.map((text,i)=>`${i+1}\n00:00:${String(i+1).padStart(2,'0')},000 --> 00:00:${String(i+2).padStart(2,'0')},000\n${text}\n`).join('\n');
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name,content,segments:rows.map((en_text,index)=>({index,en_text,zh_text:null,start_time:`00:00:${String(index+1).padStart(2,'0')}.000`,end_time:`00:00:${String(index+2).padStart(2,'0')}.000`}))}});
 return h.call('open_reading_material',{fileId:imported.file_id});
}
const groups=()=>h.call('list_saved_groups',{query:'',limit:50,offset:0});
const records=()=>h.call('list_saved_records',{query:'',limit:200,offset:0});
const contexts=expression=>h.call('saved_recall_contexts',{expression,offset:0,limit:50});
const word=(row,text)=>page.locator(`[data-sentence="${row}"] .reading-word`).filter({hasText:new RegExp(`^${text}$`)}).first();
const ready=()=>page.locator('.reading-paper[data-recall-state="ready"]').waitFor();
const close=async()=>{await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});};
const open=async(row,text)=>{await word(row,text).click();await page.locator('.dictionary-overview').waitFor();};
const save=async()=>{await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();};
const refresh=async(event='lexicue-saved-changed')=>{await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);await ready();};
const marked=async(row,text)=>(await word(row,text).getAttribute('data-recall'))!==null;
const contrast=locator=>locator.evaluate(node=>{
 const rgba=value=>value.match(/[\d.]+/g)?.map(Number)??[0,0,0,0];
 const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 let bg=[255,255,255];const stack=[];for(let e=node;e;e=e.parentElement)stack.unshift(rgba(getComputedStyle(e).backgroundColor));
 for(const c of stack){const a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}
 const fg=rgba(getComputedStyle(node).color);const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});
async function readable(locator,label){const ratio=await contrast(locator);ok(ratio>=4.5,`${label}: contrast ${ratio.toFixed(2)}`);observations.push({label,contrast:ratio});}
async function capture(name){if(await page.locator('.lookup-body').count())await page.locator('.lookup-body').evaluate(n=>{n.scrollTop=0;});if(await page.locator('.context-panel').count())await page.locator('.context-panel').evaluate(n=>Promise.allSettled(n.getAnimations().map(a=>a.finished)));await page.screenshot({path:`${output}/ui-${name}.png`});}
async function removeNative(record){return h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'remove',record_id:record.record_id,expected_revision:record.revision}});}

try {
 eq((await h.call('longman_dictionary_status')).state,'ready','real packaged Longman is ready');
 // Candidate/content checks use the same Rust command as the UI, never Python.
 const cases=[['children',['child']],['women',['woman']],['mice',['mouse']],['went',['go']],['bought',['buy']],['studies',['study']],['books',['books','book']],['running',['running','run']],['studied',['studied','study']],['changed',['changed','change']],['saw',['saw','see']],['left',['left','leave']],['found',['found','find']],['leaves',['leaf','leave']],['axes',['axe','axis']],['better',['better','good','well']]];
 for(const [expression,expected] of cases){
  const start=performance.now(),result=await h.call('lookup_longman_expression',{expression,context:null});
  const heads=[...new Set(result.entries.map(entry=>entry.headword))];
  for(const head of expected)ok(heads.includes(head),`${expression}: retains ${head} candidate`);
  for(const head of expected.filter(head=>head!==expression)){
   const base=await h.call('lookup_longman_expression',{expression:head,context:null});
   const groups=result.entries.filter(entry=>entry.headword===head).flatMap(entry=>entry.groups);
   const baseGroups=base.entries.filter(entry=>entry.headword===head).flatMap(entry=>entry.groups);
   ok(groups.length>0&&groups.every(group=>{const original=baseGroups.find(other=>other.id===group.id);return original&&JSON.stringify(group.senses)===JSON.stringify(original.senses);}),`${expression}: complete ${head} meanings/examples match direct Rust query`);
  }
  querySamples.push({expression,status:result.status,default:result.entries.find(entry=>entry.id===result.default_entry_id)?.headword,ms:performance.now()-start,notices:result.notices,entries:result.entries.map(entry=>({headword:entry.headword,match:entry.match,groups:entry.groups.map(group=>({pos:group.part_of_speech,senses:group.senses.length,examples:group.senses.reduce((sum,sense)=>sum+sense.examples.length,0),firstMeanings:group.senses.slice(0,2).map(sense=>sense.meaning)}))}))});
 }
 for(const expression of ['news','business','glass','series','species','US','us','happiness','action','run-in','takeoff']){
  const result=await h.call('lookup_longman_expression',{expression,context:null});
  const unrelated={news:'new',business:'bus',happiness:'happy',action:'act','run-in':'run in',takeoff:'take off'}[expression];
  if(unrelated)ok(!result.entries.some(entry=>entry.headword===unrelated&&entry.match.type==='inflection'),`${expression}: no guessed ${unrelated} inflection`);
  querySamples.push({expression,status:result.status,heads:result.entries.map(entry=>[entry.headword,entry.match.type])});
 }
 await writeFile(`${output}/ui-real-rust-candidate-samples.json`,JSON.stringify(querySamples,null,2));
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');
  const seed=await material(`${theme}-inflection-source.srt`,seedRows),encounter=await material(`${theme}-new-encounter.srt`,encounterRows);
  const context=await h.browser.newContext({viewport:{width:1100,height:750}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();network.push(u.href);return route.abort();});
  await page.goto(`${h.url}/files/${seed.material.id}`);await ready();eq(await page.locator('html').getAttribute('data-theme'),theme,`${theme}: applied`);
  await open(0,'go');eq(await page.locator('input[type=radio]').count(),0,`${theme}: one-click save needs no sense selection`);
  const primary=page.locator('.lookup-footer > button');await readable(primary,`${theme}: save default`);await primary.hover();await readable(primary,`${theme}: save hover`);
  await primary.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');ok(await primary.evaluate(n=>n.matches(':focus-visible')&&parseFloat(getComputedStyle(n).outlineWidth)>=2),`${theme}: primary keyboard focus`);
  await readable(word(0,'go'),`${theme}: selected word`);await capture(`${theme}-go-default`);await save();await close();
  await open(1,'see');await save();await close();
  await open(7,'us');await save();await close();await open(8,'may');await save();await close();
  await page.goto(`${h.url}/files/${encounter.material.id}`);await ready();ok(await marked(0,'went'),`${theme}: unsaved safe went is marked from go`);eq(await marked(1,'saw'),false,`${theme}: see never unconditionally marks saw`);
  eq(await marked(4,'US'),false,`${theme}: lowercase us never marks source US`);ok(await marked(4,'us'),`${theme}: lowercase us still marks literal us`);eq(await marked(5,'May'),false,`${theme}: lowercase may never marks source May`);eq(await marked(5,'MAY'),false,`${theme}: lowercase may never marks uppercase MAY`);ok(await marked(5,'may'),`${theme}: lowercase may still marks may`);ok(await marked(6,'Go')&&await marked(6,'Went'),`${theme}: ordinary sentence capitals retain safe forms`);
  eq((await contexts('US')).total,0,`${theme}: native uppercase US has no lower history`);eq((await contexts('May')).total,0,`${theme}: native May has no lower history`);eq((await contexts('MAY')).total,0,`${theme}: native MAY has no lower history`);
  await open(4,'US');await save();await close();await ready();ok(await marked(4,'US'),`${theme}: explicitly saved US remains marked`);eq((await contexts('US')).records.map(record=>record.expression),['US'],`${theme}: uppercase saved context stays separate from us`);
  await open(5,'May');await save();await close();await ready();ok(await marked(5,'May'),`${theme}: explicitly saved May remains marked`);eq(await marked(5,'MAY'),false,`${theme}: unsaved uppercase MAY stays conservative`);eq((await contexts('May')).records.map(record=>record.expression),['May'],`${theme}: month context stays separate from modal may`);
  await open(0,'went');eq(await page.locator('.lookup-heading h2').innerText(),'go',`${theme}: went immediately shows complete go`);ok((await page.locator('.lookup-heading').innerText()).includes('went → go'),`${theme}: original form relation visible`);
  await page.locator('.recall-history > summary').waitFor();await page.locator('.recall-history > summary').click();eq(await page.locator('.recall-sentence').first().innerText(),seedRows[0],`${theme}: went history belongs to go`);
  const summary=page.locator('.dictionary-more > summary');await summary.focus();await page.keyboard.press('Enter');ok(await page.locator('.dictionary-more').getAttribute('open')!==null,`${theme}: dictionary keyboard expansion`);ok(await page.locator('[data-sense-id]').count()>3,`${theme}: full meanings remain available`);await summary.focus();await page.keyboard.press('Enter');
  await readable(page.locator('.dictionary-overview .longman-meaning').first(),`${theme}: meaning`);await readable(page.locator('.lookup-heading small[lang="en"]').first(),`${theme}: relation`);await capture(`${theme}-went-history`);
  await save();eq((await groups()).groups.filter(group=>group.expression==='go').map(group=>group.context_count),[2],`${theme}: go and went one card with two contexts`);
  const goRecords=(await contexts('went')).records;eq(new Set(goRecords.map(record=>record.expression)),new Set(['go','went']),`${theme}: raw surfaces preserved`);
  const went=goRecords.find(record=>record.expression==='went');const frozen=structuredClone(went);
  const segment=encounter.segments[0],start=segment.en_text.indexOf('went');const duplicate=await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression:'went',start_offset:start,end_offset:start+4,explanation:null,explanation_source:'unknown'}}});eq(duplicate.changed,false,`${theme}: repeated source selection is idempotent`);await close();
  await open(1,'saw');eq(await page.locator('.lookup-heading h2').innerText(),'saw',`${theme}: ambiguous title keeps selected spelling`);ok(await page.locator('[data-overview-headword="saw"]').count()>0&&await page.locator('[data-overview-headword="see"]').count()>0,`${theme}: saw/see labels distinguish candidate meanings`);eq(await page.locator('.recall-history').count(),0,`${theme}: saw has no see history`);await capture(`${theme}-saw-candidates`);await save();await close();
  await ready();ok(await marked(3,'saw'),`${theme}: literal saw is marked after explicitly saving saw`);eq((await contexts('saw')).records.map(record=>record.expression),['saw'],`${theme}: saw history stays literal`);eq((await contexts('see')).records.map(record=>record.expression),['see'],`${theme}: see history stays separate`);
  await page.goto(`${h.url}/files/${seed.material.id}`);await open(2,'children');ok(await page.locator('[data-overview-headword="child"]').count()>0,`${theme}: children main overview contains child meaning`);await capture(`${theme}-children`);await close();
  for(const [row,expression,parent] of [[3,'running','run'],[4,'studied','study'],[5,'changed','change'],[6,'books','book']]){
   await open(row,expression);ok(await page.locator(`[data-overview-headword="${expression}"]`).count()>0&&await page.locator(`[data-overview-headword="${parent}"]`).count()>0,`${theme}: ${expression} direct and parent both visible`);
   if(expression==='running'){await capture(`${theme}-running-candidates`);await save();eq((await groups()).groups.find(group=>group.expression==='running')?.context_count,1,`${theme}: ambiguous running saved literally`);ok(!(await contexts('run')).records.some(record=>record.expression==='running'),`${theme}: running context not assigned to run`);}
   await close();
  }
  await page.goto(`${h.url}/saved`);const goCard=page.locator('.saved-record-open').filter({has:page.locator('.saved-record-term',{hasText:/^go$/})});await goCard.waitFor();eq(await goCard.count(),1,`${theme}: archive shows one reliable group`);await goCard.hover();await readable(goCard.locator('.saved-record-term'),`${theme}: archive hover`);await goCard.click();await page.locator('.saved-context-entry').first().waitFor();eq(await page.locator('.saved-context-entry').count(),2,`${theme}: archive exposes both source sentences`);await readable(goCard.locator('.saved-record-term'),`${theme}: selected archive card`);
  await capture(`${theme}-archive-two-contexts`);await page.setViewportSize({width:800,height:600});await capture(`${theme}-800-archive`);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: narrow archive has no overflow`);await close();
  await page.goto(`${h.url}/files/${encounter.material.id}`);await open(0,'went');await capture(`${theme}-800-went`);ok(await page.locator('.lookup-footer').evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight+1),`${theme}: narrow save feedback remains visible`);await close();await page.setViewportSize({width:390,height:750});await open(1,'saw');await capture(`${theme}-390-saw`);ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: 390px candidate content does not overflow`);await close();await page.setViewportSize({width:1100,height:750});
  const removed=await removeNative(went);await refresh();eq((await contexts('go')).total,1,`${theme}: removing one surface retains group`);await h.call('undo_saved_mutation',{operationId:removed.operation_id});await refresh();eq((await contexts('went')).total,2,`${theme}: undo restores original context`);
  const backup=await h.call('export_all');await h.call('test_reopen');await h.call('restore_all',{backup});await refresh('lexicue-sync-applied');eq((await contexts('went')).total,2,`${theme}: reopen and portable restore preserve grouping`);const restored=(await records()).find(record=>record.record_id===frozen.record_id);eq(restored.dictionary_reference,frozen.dictionary_reference,`${theme}: reference snapshot unchanged through restore`);
  // Remove all reliable go contexts: the broader safe-form hints must vanish.
  for(const record of (await contexts('go')).records)await removeNative(record);await refresh();eq(await marked(0,'went'),false,`${theme}: last-context removal clears went hint`);eq(await marked(2,'go'),false,`${theme}: last-context removal clears lemma hint`);
  await h.call('test_delete_source',{fileId:seed.material.id});await page.goto(`${h.url}/saved`);const seeCard=page.locator('.saved-record-open').filter({has:page.locator('.saved-record-term',{hasText:/^see$/})});await seeCard.click();await page.locator('.saved-context-entry').first().waitFor();const source=page.locator('.saved-context-entry').first().getByRole('button',{name:'返回原文',exact:true});await source.click();await page.getByText('原材料已不存在或已变更，仍可阅读此副本。',{exact:true}).waitFor();ok(await source.isDisabled(),`${theme}: unavailable source has disabled semantics`);await readable(source,`${theme}: disabled source button`);await capture(`${theme}-disabled-source`);await close();
  await page.goto(`${h.url}/files/${encounter.material.id}`);await ready();await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-dictionary-changed')));await ready();eq(await marked(1,'saw'),true,`${theme}: dictionary-change refresh retains explicit literal saw`);
  const calls=await page.evaluate(()=>window.__uiCalls);eq(calls.filter(call=>/analyze_word_occurrence|align|translate/.test(call.command)),[],`${theme}: no AI or alignment requests`);eq(calls.filter(call=>/clipboard/.test(call.command)),[],`${theme}: no clipboard requests`);eq(calls.filter(call=>/dictionary.*audio|longman.*audio/.test(call.command)),[],`${theme}: no dictionary recording requests`);await context.close();page=null;
 }
 eq(network,[],'no browser external requests');eq(h.errors,[],'no browser exceptions');
 await writeFile(`${output}/ui-validation.json`,JSON.stringify({passed:true,kind:'controlled Chromium with real Rust production commands and disposable SQLite; not native macOS window',checks,observations,network,errors:h.errors},null,2));
 console.log(`PASS: ${checks.length} inflection UI assertions`);
}catch(error){if(page){await page.screenshot({path:`${output}/ui-failure.png`}).catch(()=>{});await writeFile(`${output}/ui-failure.json`,JSON.stringify({error:String(error),text:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
