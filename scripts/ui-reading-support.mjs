/** Shared isolated browser/native-boundary harness; command cores use temporary SQLite. */
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../',import.meta.url));
export async function createReadingHarness(output) {
await mkdir(output,{recursive:true});
let bridge=process.env.LEXICUE_READING_BRIDGE_URL,server,log='';
if(!bridge){
 const temp=await mkdtemp(`/tmp/lexicue-reading-ui-`);const info=`${temp}/bridge.json`;
 server=spawn('cargo',['test','serve_reading_bridge','--','--ignored','--nocapture'],{cwd:`${root}/src-tauri`,env:{...process.env,LEXICUE_READING_BRIDGE_INFO:info}});
 server.stdout.on('data',chunk=>{log+=chunk;});server.stderr.on('data',chunk=>{log+=chunk;});
 const deadline=Date.now()+180000;
 while(!bridge&&Date.now()<deadline){try{bridge=`http://127.0.0.1:${JSON.parse(await readFile(info,'utf8')).port}`;}catch{if(server.exitCode!==null)throw Error(log);await new Promise(done=>setTimeout(done,100));}}
 if(!bridge){server.kill('SIGTERM');throw Error(`Bridge startup timed out: ${log}`);}
}
const call=async(command,args={})=>{const r=await(await fetch(bridge,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})})).json();if(r.error)throw Error(r.error);return r.value;};
const {chromium}=await import(process.env.LEXICUE_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.LEXICUE_UI_BROWSER_CHANNEL||'chrome',headless:true});
const url=process.env.LEXICUE_UI_URL||'http://127.0.0.1:5173';
const errors=[];
async function fixture(page,theme){
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({bridge,theme})=>{
  localStorage.setItem('lexicue-theme',theme);const previous=JSON.parse(localStorage.getItem('lexicue-preferences')||'{"state":{},"version":0}');localStorage.setItem('lexicue-preferences',JSON.stringify({...previous,state:{...previous.state,uiLanguage:'zh'}}));
  window.__uiCalls=[];window.__uiFiles={};window.__uiFailure=null;window.__uiDelayLookup=false;window.__uiDelayContexts=false;
  window.__uiStoreModule=name=>{const path=`/src/stores/${name}.ts`;const resource=performance.getEntriesByType('resource').findLast(entry=>new URL(entry.name).pathname===path);return import(resource?.name||path);};
  const core=new Set(['begin_example_session','end_example_session','example_saved_for_selection','mutate_example_saved_record','undo_example_saved_mutation','saved_recall_index','saved_recall_contexts','import_reading_material','list_materials','open_reading_material','lookup_reading_expression','saved_for_selection','mutate_saved_record','undo_saved_mutation','list_saved_records','saved_record_source','saved_migration_report','saved_record_conflicts','export_all','restore_all','list_tags','create_tag','rename_tag','delete_tag','set_file_tags','list_legacy_records','legacy_record_detail']);
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback(){},convertFileSrc:path=>path,invoke:async(command,args={})=>{
   window.__uiCalls.push({command,args:structuredClone(args)});
   const fail=window.__uiFailure?.command===command&&window.__uiFailure.remaining>0;
   if(fail&&!window.__uiFailure.afterCommit){window.__uiFailure.remaining--;throw Error('fixture failure before write');}
   if(core.has(command)){
    const result=await(await fetch(bridge,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})})).json();if(result.error)throw Error(result.error);
    if(fail){window.__uiFailure.remaining--;throw Error('fixture lost receipt after real commit');}
    if(command==='mutate_example_saved_record'&&window.__uiDelayExampleSave)await new Promise(done=>setTimeout(done,450));
    if(command==='begin_example_session'&&window.__uiDelayExampleBegin)await new Promise(done=>setTimeout(done,450));
    if(command==='lookup_reading_expression'&&window.__uiDelayLookup&&args.expression==='take')await new Promise(done=>setTimeout(done,400));
    if(command==='saved_recall_contexts'&&window.__uiDelayContexts&&args.expression==='take off')await new Promise(done=>setTimeout(done,400));
    return result.value;
   }
   if(command==='dictionary_init_status')return {runId:1,sequence:1,state:'ready',currentSource:null,sources:[{name:'ECDICT',language:'en',state:'ready',processedRows:1,error:null},{name:'PhraseDict',language:'en',state:'ready',processedRows:1,error:null}]};
   if(command==='plugin:event|listen')return 1;
   if(command==='plugin:app|version')return '0.4.5';
   if(command==='plugin:dialog|open')return Object.keys(window.__uiFiles);
   if(command==='plugin:dialog|ask')return true;
   if(command==='plugin:dialog|save')return '/fixture/export.json';
   if(command==='plugin:fs|read_text_file')return Array.from(new TextEncoder().encode(window.__uiFiles[args.path]));
   if(command==='plugin:fs|write_text_file')return null;
   if(command==='youtube_ytdlp_status')return {available:false,path:'',version:null};
   if(command==='plugin:updater|check')return null;
   if(command==='list_files')return [];
   if(command.startsWith('plugin:')||command.startsWith('sync_'))return null;
   throw Error(`Unimplemented native fixture command: ${command}`);
  }};
 },{bridge,theme});
}
return {browser,url,call,fixture,errors,dispose:async()=>{await browser.close();if(server){await call('test_stop').catch(()=>{});await writeFile(`${output}/bridge.log`,log);}}};
}
