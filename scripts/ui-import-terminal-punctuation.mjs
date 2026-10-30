/** Real module Worker -> immutable preview -> production Rust -> disposable SQLite.
 * OS file picker/read and translation transport only are controlled fixtures.
 * This never opens the running native preview database or sends public requests. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_IMPORT_PUNCTUATION_OUTPUT||'/tmp/lexicue-import-punctuation-fix-v1';
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output),checks=[],observations=[],network=[];
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);};
const cue=(n,start,end,en,zh='')=>`${n}\n${start} --> ${end}\n${en}${zh?'\n'+zh:''}\n`;
const srt=(en,zh='')=>cue(1,'00:00:01,000','00:00:03,000',en,zh);
const cases=[
 {id:'english-ellipsis-fallback',name:'ellipsis.srt',content:srt('Hello...'),en:['Hello...'],fallback:true},
 {id:'bilingual-exclamation',name:'exclamation.srt',content:srt('Hi!!','你好！！'),en:['Hi!!']},
 {id:'bilingual-mixed-terminal',name:'mixed.srt',content:srt('Hey?! Are you ready??','嘿？！你准备好了吗？？'),en:['Hey?!','Are you ready??']},
 {id:'cross-cue-terminal',name:'cross-cue.srt',content:cue(1,'00:00:01,000','00:00:03,000','I will use...','我要使用……')+'\n'+cue(2,'00:00:03,000','00:00:05,000','this cream now!!','现在用这个面霜！！'),en:['I will use...','this cream now!!']},
 {id:'text-punctuation',name:'punctuation.txt',content:'Hello... Hi!! Hey?!',en:['Hello...','Hi!!','Hey?!']},
 {id:'text-quote-decimal-abbreviation',name:'quote-decimal.txt',content:'Dr. Smith said, “Use 3.5 ounces!!” It works??',en:['Dr. Smith said, “Use 3.5 ounces!!”','It works??']},
];

let page;
const getStore=()=>page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');const s=useImportStore.getState();return {phase:s.phase,items:s.items.map(({name,stage,error,draft})=>({name,stage,error,draft}))};});
const currentWrites=()=>page.evaluate(()=>window.__uiCalls.filter(call=>call.command==='import_reading_material'));
async function openFile(name,content,failTranslation=false){
 await page.goto(`${h.url}/files`);await page.locator('.materials-paper').waitFor();
 await page.evaluate(({name,content,failTranslation})=>{window.__uiFiles={[`/fixture/${name}`]:content};window.__translationFail=failTranslation;},{name,content,failTranslation});
 await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByRole('button',{name:'选择文件',exact:true}).click();
}
async function capture(name){await page.screenshot({path:`${output}/${name}.png`});}
try{
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');const ctx=await h.browser.newContext({viewport:{width:1100,height:750}});page=await ctx.newPage();await page.routeWebSocket('**',socket=>socket.close());await h.fixture(page,theme);
  await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol))return route.continue();network.push(u.href);return route.abort();});
  await page.addInitScript(()=>{
   window.__workerResults=[];const OriginalWorker=window.Worker;
   window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('documentWorker'))this.addEventListener('message',event=>window.__workerResults.push(structuredClone(event.data)));}};
   const invoke=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='cancel_import_translation')return;
    if(command==='translate_import_sentences'){
     window.__uiCalls.push({command,args:structuredClone(args)});
     return window.__translationFail?{translations:[],error:'controlled_translation_offline'}:{translations:args.sentences.map(s=>({index:s.index,translation:`测试译文 ${s.index+1}。`})),error:null};
    }
    return invoke(command,args);
   };
  });
  for(const [index,c] of cases.entries()){
   const before=(await h.call('test_counts')).files;
   await openFile(c.name,c.content,c.fallback);
   await page.locator('.lc-import-preview').waitFor();
   const prepared=await getStore(),draft=prepared.items[0].draft;
   eq(prepared.items[0].stage,'ready',`${theme}/${c.id}: actual worker prepared valid material`);
   eq(draft.document.source_sha256,createHash('sha256').update(c.content).digest('hex'),`${theme}/${c.id}: source byte identity retained`);
   eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),0,`${theme}/${c.id}: local import never waits for translation`);
   eq(draft.segments.map(s=>s.en_text),c.en,`${theme}/${c.id}: complete terminal punctuation remains attached`);
   ok(draft.segments.every(s=>/[A-Za-z]/.test(s.en_text)),`${theme}/${c.id}: no punctuation-only source segment`);
   if(c.name.endsWith('.srt'))ok(draft.segments.every(s=>s.start_time&&s.end_time),`${theme}/${c.id}: real cue timestamps remain available`);
   else ok(draft.segments.every(s=>s.start_time===null&&s.end_time===null),`${theme}/${c.id}: TXT does not fabricate timestamps`);
   eq(await currentWrites(),[],`${theme}/${c.id}: preview made zero native writes`);
   eq((await h.call('test_counts')).files,before,`${theme}/${c.id}: preview is read-only`);
   const worker=await page.evaluate(()=>window.__workerResults);
   eq(worker.length,1,`${theme}/${c.id}: one actual parsing Worker response`);
   ok(Array.isArray(worker[0].result?.segments)&&!worker[0].error,`${theme}/${c.id}: worker itself succeeded`);
   await capture(`${theme}-${c.id}-preview`);
   await page.getByRole('button',{name:/^确认导入/}).click();await page.waitForURL(/\/files\/\d+$/);await page.locator('.reading-original').first().waitFor();
   const writes=await currentWrites();eq(writes.length,1,`${theme}/${c.id}: one real production import command`);
   eq(writes[0].args.input.segments,draft.segments,`${theme}/${c.id}: native import used exact frozen preview`);
   eq((await h.call('test_counts')).files,before+1,`${theme}/${c.id}: Rust actually persisted one material`);
   const fileId=Number(new URL(page.url()).pathname.split('/').at(-1));const material=await h.call('open_reading_material',{fileId});
   eq(material.segments.map(s=>s.en_text),c.en,`${theme}/${c.id}: stored/reopened sentences preserve punctuation`);
   eq(material.segments.map(s=>[s.start_time,s.end_time]),draft.segments.map(s=>[s.start_time,s.end_time]),`${theme}/${c.id}: stored times equal worker-derived times`);
   if(c.fallback)ok(writes[0].args.input.segments.every(s=>s.zh_text===null),`${theme}/${c.id}: offline English import never fabricates Chinese`);
   observations.push({theme,id:c.id,fileId,workerResult:worker[0],draft,stored:material.segments});
   await capture(`${theme}-${c.id}-reading`);
   eq((await h.call('test_counts')).files,index+1,`${theme}/${c.id}: case count stable`);
  }
  for(const [id,content] of [['reversed-time',cue(1,'00:00:03,000','00:00:01,000','Hello!!')],['empty-cue',srt('')]]){
   const before=(await h.call('test_counts')).files;await openFile(`${id}.srt`,content);
   await page.locator('.lc-import-error').waitFor();
   const state=await getStore();eq(state.items[0].stage,'failed',`${theme}/${id}: invalid material remains rejected`);
   ok(!state.items[0].draft,`${theme}/${id}: failed input has no commit draft`);eq(await currentWrites(),[],`${theme}/${id}: rejection made zero native writes`);eq((await h.call('test_counts')).files,before,`${theme}/${id}: valid stored materials untouched`);
   await capture(`${theme}-${id}-rejected`);
  }
  await ctx.close();
 }
 eq(network,[],'zero external browser requests');eq(h.errors,[],'zero React/runtime exceptions');
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks:checks.length,assertions:checks,observations,network,errors:h.errors,scope:'real Vite module Worker + actual production Rust import and temporary SQLite; controlled file-picker/read and translation responses; not physical OS picker, not native WebView'},null,2));console.log(`PASS: ${checks.length} terminal-punctuation import checks.`);
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),text:await page.locator('body').innerText(),store:await getStore(),calls:await page.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
