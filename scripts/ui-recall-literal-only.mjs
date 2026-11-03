/** Missing dictionary: genuine Rust catalog and SQLite, real matching Worker.
 * Run with LEXICUE_LONGMAN_PACKAGE_ROOT set to an absent /tmp fixture path. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/dictionary-inflection-v1/ui-literal-only`;
const h=await createReadingHarness(output);
const checks=[],network=[];
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);console.log(label);};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);console.log(label);};
const rows=['It may rain.','May is a month.','MAY is printed.','US and us.','Go go.',"I'M here."];
let page;
const word=(row,text)=>page.locator(`[data-sentence="${row}"] .reading-word`).filter({hasText:new RegExp(`^${text}$`)}).first();
const marked=async(row,text)=>(await word(row,text).getAttribute('data-recall'))!==null;
const ready=()=>page.locator('.reading-paper[data-recall-state="ready"]').waitFor();
try{
 eq((await h.call('longman_dictionary_status')).state,'unavailable','source package deliberately absent in isolated bridge');
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');
  const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`${theme}-literal-only.srt`,content:rows.map((row,i)=>`${i+1}\n00:00:0${i+1},000 --> 00:00:0${i+2},000\n${row}\n`).join('\n'),segments:rows.map((en_text,index)=>({index,en_text,zh_text:null,start_time:`00:00:0${index+1}.000`,end_time:`00:00:0${index+2}.000`}))}});
  const material=await h.call('open_reading_material',{fileId:imported.file_id});
  for(const [row,expression] of [[0,'may'],[3,'us'],[4,'go'],[5,"I'M"]]){
   const segment=material.segments[row],start=segment.en_text.indexOf(expression);
   await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression,start_offset:start,end_offset:start+expression.length,explanation:null,explanation_source:'unknown'}}});
  }
  const catalog=await h.call('saved_recall_catalog');eq(catalog.literal_only,true,`${theme}: actual native catalog requires literal mode`);
  const context=await h.browser.newContext({viewport:{width:1100,height:750}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();network.push(u.href);return route.abort();});
  // Only the optional public fallback is injected as unavailable. Catalog,
  // source absence, saving, archive and Worker behavior remain genuine.
  await page.addInitScript(()=>{window.__uiFailure={command:'lookup_cambridge_expression',remaining:100,afterCommit:false};});
  await page.goto(`${h.url}/files/${material.material.id}`);await ready();
  eq(await marked(1,'May'),false,`${theme}: lower may cannot mark May without source evidence`);eq(await marked(2,'MAY'),false,`${theme}: lower may cannot mark MAY without source evidence`);eq(await marked(3,'US'),false,`${theme}: lower us cannot mark US without source evidence`);eq(await marked(4,'Go'),false,`${theme}: literal mode keeps exact case`);
  ok(await marked(0,'may')&&await marked(3,'us')&&await marked(4,'go'),`${theme}: explicit lowercase originals still mark`);ok(await marked(5,"I'M"),`${theme}: explicit all-caps contraction still marks`);
  await word(1,'May').click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await ready();ok(await marked(1,'May'),`${theme}: explicit May can be saved and marked`);eq(await marked(2,'MAY'),false,`${theme}: May save does not invent uppercase MAY history`);
  const groups=await h.call('list_saved_groups',{query:'',limit:50,offset:0});eq(groups.groups.filter(group=>['May','may'].includes(group.expression)).map(group=>group.expression).sort(),['May','may'],`${theme}: raw case cards remain separate`);
  const contexts=await h.call('saved_recall_contexts',{expression:'May',offset:0,limit:20});eq(contexts.records.map(record=>record.expression),['May'],`${theme}: exact May context excludes lower may`);
  await page.screenshot({path:`${output}/${theme}-literal-marks.png`});
  const calls=await page.evaluate(()=>window.__uiCalls);eq(calls.filter(call=>/clipboard|analyze_word_occurrence|translate|align/.test(call.command)),[],`${theme}: no clipboard, AI, or alignment calls`);
  ok(calls.filter(call=>call.command==='saved_recall_catalog').every(call=>Object.keys(call.args).length===0),`${theme}: one catalog IPC per refresh without per-word input`);
  await context.close();page=null;
 }
 eq(network,[],'no external browser requests');eq(h.errors,[],'no browser exceptions');
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,kind:'controlled Chromium; genuine Rust absent package catalog + isolated SQLite + real Worker; optional Cambridge fallback fails in harness before IPC',checks,network},null,2));console.log(`PASS: ${checks.length} missing-package assertions`);
}catch(error){if(page){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await page.locator('body').innerText()},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
