/** Windows ARM64/x64 native integration: actual WebView2, IPC, SQLite and dialogs.
 * Requires a freshly built disposable QA copy; never starts the normal identifier.
 * No browser fixtures or command overrides are installed. Run on Windows only.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
if(process.platform!=='win32')throw Error('Run this integration test inside Windows.');
const task=process.env.LEXICUE_WINDOWS_QA_ROOT;
assert.match(task||'',/\\Temp\\lexicue-v31-windows-[^\\]+$/,'A disposable Windows task root is required');
const repo=join(task,'repo'),app=join(repo,'src-tauri','target','debug','lexicue-qa.exe');
const config=JSON.parse(await readFile(join(repo,'src-tauri','tauri.conf.json'),'utf8'));
assert.match(config.identifier,/^com\.lexicue\.qa\.v31\.windows/,'Refusing real application identifier');
const output=join(task,'native-evidence');await mkdir(output,{recursive:true});
const helper=join(dirname(fileURLToPath(import.meta.url)),'windows-native-ui.ps1');
const reportPath=join(output,'report.json');
const fresh=process.env.LEXICUE_WINDOWS_FRESH==='1';
const resume=process.env.LEXICUE_WINDOWS_RESUME==='1'&&!fresh;
let report=resume?JSON.parse(await readFile(reportPath,'utf8')):{startedAt:new Date().toISOString(),identifier:config.identifier,appSha256:createHash('sha256').update(await readFile(app)).digest('hex'),scope:'Windows EXE → native WebView2 → actual Tauri IPC/SQLite, actual Windows file dialogs; only synthetic QA learning data',checks:[],stages:[],themes:['ocean','midnight']};
assert.equal(report.appSha256,createHash('sha256').update(await readFile(app)).digest('hex'),'Resume must use the same native binary');
const checkpoint=()=>writeFile(reportPath,JSON.stringify(report,null,2));
const ok=(v,label)=>{assert.ok(v,label);report.checks.push(label);};
const eq=(v,e,label)=>{assert.deepEqual(v,e,label);report.checks.push(label);};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>r(port));});});
const port=await freePort(),debugPort=await freePort();
const webviewProfile=join(task,'webview2-native-profile');
report.webviewProfile={path:webviewProfile,method:'explicit persistent QA folder; launch native EXE then attach EdgeDriver',debugPort};
let appProcess;
const driver=spawn(join(task,'driver','msedgedriver.exe'),[`--port=${port}`,`--log-path=${join(output,'webdriver.txt')}`],{env:{...process.env,MSEDGEDRIVER_TELEMETRY_OPTOUT:'1'},windowsHide:true});
let driverLog='';driver.stdout.on('data',d=>{driverLog+=d;});driver.stderr.on('data',d=>{driverLog+=d;});
let session,baseUrl;
async function req(path,method='GET',body){const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const json=await response.json();if(json.value?.error)throw Error(`${json.value.error}: ${json.value.message}`);return json.value;}
const wd=(path,method,body)=>req(`/session/${session}${path}`,method,body);
const exec=(fn,...args)=>wd('/execute/sync','POST',{script:`return (${fn.toString()})(...arguments);`,args});
async function asyncExec(fn,...args){return wd('/execute/async','POST',{script:`const done=arguments[arguments.length-1];Promise.resolve((${fn.toString()})(...Array.from(arguments).slice(0,-1))).then(value=>done({ok:true,value}),error=>done({ok:false,error:String(error)}));`,args}).then(r=>{if(!r.ok)throw Error(r.error);return r.value;});}
const call=(command,args={})=>asyncExec((command,args)=>window.__TAURI_INTERNALS__.invoke(command,args),command,args);
async function wait(fn,label,timeout=30000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{const v=await fn();if(v)return v;}catch(e){last=e;}await delay(40);}throw Error(`Timed out: ${label}${last?': '+last.message:''}`);}
const count=css=>exec(css=>document.querySelectorAll(css).length,css);
const text=css=>exec(css=>document.querySelector(css)?.innerText??'',css);
const exists=css=>wait(()=>count(css),css);
const absent=css=>wait(async()=>!(await count(css)),`absent ${css}`);
async function element(css,{text:label,aria,index=0}={}){return wait(()=>exec((css,label,aria,index)=>[...document.querySelectorAll(css)].filter(n=>n.getClientRects().length&&(!label||n.textContent.trim()===label)&&(!aria||n.getAttribute('aria-label')===aria))[index]??null,css,label,aria,index),`element ${css} ${label||aria||index}`);}
const elementId=e=>e['element-6066-11e4-a52e-4f735466cecf'];
async function click(css,options){
 await settle();const e=await element(css,options);
 await exec(node=>node.scrollIntoView({block:'nearest',inline:'nearest'}),e);
 await wait(()=>exec(node=>{if(!node.isConnected||node.disabled)return false;const r=node.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));const hit=document.elementFromPoint(x,y);return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight&&(node===hit||node.contains(hit));},e),`actionable ${css}`);
 return wd(`/element/${elementId(e)}/click`,'POST',{});
}
const button=(label,css='button')=>click(css,{text:label});
async function fill(css,value){const id=elementId(await element(css));await wd(`/element/${id}/clear`,'POST',{});await wd(`/element/${id}/value`,'POST',{text:value});}
const key=key=>wd('/actions','POST',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:key},{type:'keyUp',value:key}]}]});
async function close(){await key('\uE00C');await absent('.context-panel');}
async function settle(){await asyncExec(()=>Promise.allSettled([...document.querySelectorAll('.context-panel,.workspace-paper')].flatMap(n=>n.getAnimations().map(a=>a.finished))));await asyncExec(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function shot(name){await settle();await writeFile(join(output,`${name}.png`),Buffer.from(await wd('/screenshot'),'base64'));}
async function go(path){await wd('/url','POST',{url:baseUrl+path});}
async function ready(){await exists('.reading-paper[data-recall-state="ready"]');}
async function start(){
 appProcess=spawn(app,[],{env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:webviewProfile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`},stdio:'ignore',windowsHide:false});
 appProcess.on('error',error=>{report.appLaunchError=String(error);});
 await wait(async()=>{if(appProcess.exitCode!==null)throw Error(`QA app exited: ${appProcess.exitCode}`);const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();return pages.some(page=>page.type==='page'&&page.url.includes('tauri.localhost'));},'native WebView2 debugging target',60000);
 const info=await req('/session','POST',{capabilities:{alwaysMatch:{browserName:'webview2','ms:edgeOptions':{debuggerAddress:`127.0.0.1:${debugPort}`}}}});
 session=info.sessionId;report.capabilities=info.capabilities;
 await wd('/timeouts','POST',{script:180000,pageLoad:30000,implicit:0});
 await wait(()=>exec(()=>!!window.__TAURI_INTERNALS__&&!!document.querySelector('.b-shell')),'native shell',60000);
 eq(await call('plugin:app|identifier'),config.identifier,'native IPC identifier protects real data');
 baseUrl=new URL(await exec(()=>location.href)).origin;
}
async function restart(){
 const before=await exec(()=>({preferences:localStorage.getItem('lexicue-preferences'),onboarding:localStorage.getItem('lexicue-onboarding-v1')}));
 await native({action:'close'});await wd('','DELETE').catch(()=>{});session=null;await start();
 const after=await exec(()=>({preferences:localStorage.getItem('lexicue-preferences'),onboarding:localStorage.getItem('lexicue-onboarding-v1')}));
 (report.restarts??=[]).push({method:'normal Windows WM_CLOSE, followed by WebDriver session cleanup',before,after});
}
let psSequence=0;
async function native(request){const path=join(task,`ui-request-${++psSequence}.json`);await writeFile(path,JSON.stringify({appPath:app,...request}));const script=`& ([ScriptBlock]::Create([IO.File]::ReadAllText('${helper.replaceAll("'","''")}'))) -RequestPath '${path.replaceAll("'","''")}'`;return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let log='';child.stdout.on('data',d=>{log+=d;});child.stderr.on('data',d=>{log+=d;});child.on('error',reject);child.on('exit',code=>code===0?resolve(log):reject(Error(`Native dialog helper (${code}): ${log}`)));});}
async function dialogClick(trigger,request){const pending=native({...request,evidence:join(output,`dialog-${psSequence+1}.json`)}).then(value=>({ok:true,value}),error=>({ok:false,error}));await trigger();const result=await pending;if(!result.ok)throw result.error;return result.value;}
async function resize(width,height=900){await native({action:'resize',width,height});await wait(()=>exec((w,h)=>Math.abs(innerWidth-w)<=1&&Math.abs(innerHeight-h)<=1,width,height),`native viewport ${width}x${height}`);await settle();}
async function theme(value){await go('/settings');await exists('.system-settings');const hasZh=await exec(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='中文'));if(hasZh)await button('中文');await button(value==='ocean'?'海湾蓝':'深夜墨色');await wait(()=>exec(v=>document.documentElement.dataset.theme===v,value),'theme');}
async function stage(name,fn){
 if(resume&&report.stages.includes(name)){console.log(`RESUME ${name}`);return;}
 const path=join(output,`before-${name}.json`);let before;
 if(resume){try{before=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(before){await call('restore_all',{backup:before.backup});await exec(storage=>{localStorage.clear();for(const [key,value]of Object.entries(storage))localStorage.setItem(key,value);},before.storage);report.checks.length=before.checkCount;await go('/');}
 else await writeFile(path,JSON.stringify({backup:await call('export_all'),storage:await exec(()=>({...localStorage})),checkCount:report.checks.length}));
 console.log(`START ${name}`);await fn();report.stages.push(name);await checkpoint();console.log(`PASS ${name}; ${report.checks.length} checks`);
}
async function fingerprint(){return asyncExec(async()=>{const data=(await window.__TAURI_INTERNALS__.invoke('export_all')).data;const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));return {hash:[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join(''),counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length]))};});}
const canonicalSaved=rows=>rows.map(({id:_id,...record})=>record).sort((a,b)=>a.record_id.localeCompare(b.record_id));
const records=()=>call('list_saved_records',{query:'',limit:200,offset:0});
async function replay(){await go('/settings');await button('重新体验','a');await exists('.example-intro');}
async function lookup(css){
 const expected=await exec(node=>(node.dataset.recall||node.textContent).trim().replace(/\s+/g,' ').toLowerCase(),await element(css));
 await click(css);
 await wait(async()=>(await text('.lookup-heading h2')).trim().replace(/\s+/g,' ').toLowerCase()===expected,'current lookup heading');
 await wait(async()=>!!(await text('.lookup-meaning'))||!(await text('.lookup-body')).includes('加载'),'current lookup result');
}
async function save(){await button('保存','.lookup-footer button');await exists('.lookup-saved');}
async function choose(paths){
 if(await count('.lc-import-footer'))await button('继续导入');
 await dialogClick(()=>button('导入文件'),{action:'file',paths});
 await exists('.lc-import-summary');
 const names=paths.map(path=>path.split(/[\\/]/).at(-1)).sort();
 await wait(()=>exec(names=>{const actual=[...document.querySelectorAll('.lc-import-items strong')].map(n=>n.textContent).sort();return names.length===1?!!document.querySelector('.lc-import-preview'):JSON.stringify(actual)===JSON.stringify(names);},names),'selected files enter preview');
}
async function confirmImport(){await click('.lc-import-footer .lc-import-primary');}
async function importDone(){await wait(()=>exec(()=>document.querySelector('.lc-import-header h2')?.textContent==='导入结果'),'import queue completed',120000);}
const srt=rows=>rows.map((text,i)=>`${i+1}\n00:00:01,000 --> 00:00:03,000\n${text}\n`).join('\n');
async function importCore(name,rows){return call('import_reading_material',{input:{operation_id:randomUUID(),name,content:srt(rows),segments:rows.map((en_text,index)=>({index,en_text,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}))}});}
async function saveCore(segment,expression,explanation=null){const start=segment.en_text.toLowerCase().indexOf(expression.toLowerCase());assert.ok(start>=0,`${expression} in source`);return call('mutate_saved_record',{operationId:randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression,start_offset:start,end_offset:start+expression.length,explanation,explanation_source:explanation?'personal':'unknown'}}});}
async function noOverflow(label){await settle();ok(await exec(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: no horizontal overflow`);ok(await exec(()=>{const r=document.querySelector('.context-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),`${label}: context inside viewport`);}
async function contrast(css){return exec(css=>{const node=document.querySelector(css);const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);let n=node,bg;do{bg=rgb(getComputedStyle(n).backgroundColor);n=n.parentElement;}while(n&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);},css);}
try{
 await wait(()=>req('/status'),'signed EdgeDriver');await start();
 await wait(async()=>{const s=await call('dictionary_init_status');if(s.state==='failed')throw Error(JSON.stringify(s));return s.state==='ready';},'actual dictionary initialization',180000);
 report.dictionary=await call('dictionary_init_status');
 if(fresh){
  const before=await call('export_all');await writeFile(join(output,'qa-before-fresh.json'),JSON.stringify(before));
  const empty=structuredClone(before);for(const key of Object.keys(empty.data))if(!['dictionary_sources','product_migrations'].includes(key))empty.data[key]=[];
  await call('restore_all',{backup:empty});await go('/settings');await exists('.system-settings');await exec(()=>localStorage.clear());await go('/');await exists('.example-intro');eq(await exec(()=>location.pathname),'/example','clean isolated launch opens English guide');
 }
 await stage('onboarding',async()=>{
  for(const mode of ['ocean','midnight']){
   await theme(mode);const before=await fingerprint();await replay();
   eq(await count('.reading-sentence'),3,`${mode}: three actual example sentences`);
   ok((await text('.example-intro')).includes('不计入'),`${mode}: example is explicitly separate`);
   await lookup('[data-sentence="0"] .reading-word');ok((await text('.lookup-meaning')).includes('好奇'),`${mode}: example uses actual ECDICT lookup`);
   await save();await button('撤销','.lookup-footer button');await exists('.lookup-footer .saved-primary');await save();await close();
   eq(await exec(()=>JSON.parse(localStorage.getItem('lexicue-onboarding-v1')).status),'completed',`${mode}: completion persisted`);
   eq(await fingerprint(),before,`${mode}: example query/save/undo never changes real backup tables`);
   await restart();await go('/');await exists('.materials-paper');eq(await count('.example-intro'),0,`${mode}: restart does not repeat completed guide`);
   for(const step of [1,2,3]){await replay();if(step>1)await lookup('[data-sentence="0"] .reading-word');if(step===3)await save();await button('跳过引导');await exists('.materials-paper');eq(await exec(()=>JSON.parse(localStorage.getItem('lexicue-onboarding-v1')).status),'skipped',`${mode}: skip step ${step} persisted`);}
   await restart();await go('/');await exists('.materials-paper');eq(await count('.example-intro'),0,`${mode}: skipped guide stays skipped`);
   await replay();await exec(()=>document.querySelector('[data-sentence="1"] .reading-word').focus());
   await wd('/actions','POST',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:'\uE008'},{type:'keyDown',value:'\uE014'},{type:'keyUp',value:'\uE014'},{type:'keyUp',value:'\uE008'}]}]});
   await exists('.lookup-heading h2');ok((await text('.lookup-heading h2')).split(' ').length===2,`${mode}: native Shift+Arrow selects continuous phrase`);await save();await close();
   eq(await fingerprint(),before,`${mode}: phrase example remains isolated`);await shot(`${mode}-onboarding-completed`);
  }
 });
 await stage('native-dictionary-50-20',async()=>{
  const words=[['book','书'],['water','水'],['friend','朋|友'],['family','家'],['school','学'],['work','工作|劳动|工'],['time','时间|时'],['day','日|天'],['food','食物|食品|食'],['house','房|住宅'],['home','家|住所'],['child','孩|儿童'],['city','城|市'],['country','国家|乡'],['language','语言|言语'],['learn','学'],['read','读'],['write','写|书写'],['speak','说|讲|言'],['listen','听'],['music','音乐'],['light','光|轻|灯'],['change','改变|变化|变更'],['understand','理解|懂'],['question','问题|疑问|问'],['answer','回答|答案'],['important','重要'],['different','不同|差|各'],['possible','可能'],['simple','简单|简易'],['idea','想法|主意|观念'],['story','故事|小说'],['journey','旅行|行程'],['travel','旅行|行'],['morning','早晨|上午|早上'],['evening','晚上|傍晚'],['today','今天|今日'],['tomorrow','明天|明日'],['yesterday','昨天|昨日'],['money','钱|货币|金钱'],['bank','银行|岸'],['river','河'],['mountain','山'],['ocean','海|洋'],['garden','花园|园'],['knowledge','知识'],['science','科学'],['curiosity','好奇'],['habit','习惯'],['remember','记|想起']];
  const phrases=[['take off','脱下|起飞'],['look up','查|仰望'],['give up','放弃'],['work out','解决|算出|锻炼'],['make sense','意义|道理|讲得通'],['find out','查明|发现'],['get along','相处|进展'],['by the way','顺便'],['at first','首先|起先|最初'],['in fact','事实|实际'],['as soon as','一|尽快'],['a little','一点|一些|少许'],['a lot of','许多|很多'],['look forward to','盼望|期待'],['take care of','照顾|照料'],['come from','来自|出身'],['turn off','关'],['put on','穿|戴|上演'],['pick up','拾|捡|接|学'],['check in','登记|入住|报到']];
  const probe=async rows=>{const answers=[];for(const [expression,expected]of rows){let answer,error;try{answer=await call('lookup_reading_expression',{expression});}catch(e){error=e.message;}answers.push({expression,expected,answer,error,passed:!!answer?.meaning&&new RegExp(expected).test(answer.meaning)});}return answers;};
  report.dictionaryProbe={method:'fixed common expressions; actual native offline dictionary; expected Chinese keyword sanity checks, not a target-user usefulness study',words:await probe(words),phrases:await probe(phrases)};await checkpoint();
  report.dictionaryProbe.wordPass=report.dictionaryProbe.words.filter(r=>r.passed).length;report.dictionaryProbe.phrasePass=report.dictionaryProbe.phrases.filter(r=>r.passed).length;
  ok(report.dictionaryProbe.wordPass>=45,'native clean dictionary: at least 45/50 common words pass Chinese meaning sanity check');ok(report.dictionaryProbe.phrasePass>=16,'native clean dictionary: at least 16/20 common phrases pass Chinese meaning sanity check');
  const unknown=await call('lookup_reading_expression',{expression:'zzxqv opaque phrase'}).catch(error=>({error:error.message}));ok(!unknown.meaning,'unknown native phrase never receives an invented definition');
 });
 await stage('native-import',async()=>{
  await theme('ocean');await go('/files');await click('.b-dock button');await exists('.lc-import-sources');
  const fixtures=join(task,'fixtures');await mkdir(fixtures,{recursive:true});
  const names=['英语 示例一.srt','Context notes.srt','empty.srt','invalid.srt','日本語.srt'];
  const contents=[await readFile(join(repo,'docs','implementation','fixtures','v31-reading.srt'),'utf8'),srt(['A small habit can change the day.','We take off before sunrise.']),'','This is not an SRT subtitle.',srt(['これは日本語の字幕です。'])];
  for(let i=0;i<names.length;i++)await writeFile(join(fixtures,names[i]),contents[i]);
  const before=(await fingerprint()).counts.files;await choose(names.map(n=>join(fixtures,n)));
  eq((await fingerprint()).counts.files,before,'native picker prepares without writes');
  eq(await count('.lc-import-items [role="alert"]'),3,'invalid files stay outside confirmation');await shot('ocean-native-import-preview');
  await confirmImport();await importDone();eq((await fingerprint()).counts.files,before+2,'confirmation commits only valid English SRTs');await shot('ocean-native-import-partial');
  for(let i=2;i<names.length;i++)await writeFile(join(fixtures,names[i]),srt([`This repaired English subtitle is number ${i}.`]));
  await choose(names.slice(2).map(n=>join(fixtures,n)));eq((await fingerprint()).counts.files,before+2,'repaired files need new preview');await confirmImport();await importDone();eq((await fingerprint()).counts.files,before+5,'repaired files import on confirmation');
  await choose([join(fixtures,names[0])]);await confirmImport();await importDone();ok((await text('.lc-import-items')).includes('已存在'),'duplicate shown without reimport');eq((await fingerprint()).counts.files,before+5,'duplicate keeps file count');
  await button('继续导入');const unchanged=await fingerprint();await dialogClick(()=>button('导入文件'),{action:'button',name:'^(取消|Cancel)'});eq(await fingerprint(),unchanged,'native file-dialog cancel leaves all tables unchanged');
  await button('返回');await choose([join(fixtures,names[0])]);await key('\uE00C');await wait(()=>count('.lc-import-modal').then(n=>n===0),'preview dismissed');eq(await fingerprint(),unchanged,'closing a preview writes nothing');
  report.import={initial:5,valid:2,failed:3,repaired:3,previewBeforeConfirmation:true};
  await exists('.materials-paper');await click('.material-view-switch button',{aria:'列表'});await exists('.material-collection--list');await shot('ocean-material-list');await click('.material-view-switch button',{aria:'画廊'});await exists('.material-collection--gallery');await shot('ocean-material-gallery');
 });
 await stage('saved-flow-themes',async()=>{
  const words=['Curiosity','Language','Science','Music','Family','Garden','Travel','Friend','Story','Water','Future','Change','Light','School','Knowledge','Morning','Ocean','Mountain','Book','Journey'];
  report.savedFlows=[];
  for(const mode of ['ocean','midnight']){
   await theme(mode);await resize(1440);const source=await importCore(`${mode}-native-flow.srt`,words.map((word,i)=>`${word} helps us understand a new idea in ${mode} sentence ${i+1}.`));
   const opened=await call('open_reading_material',{fileId:source.file_id});const before=(await records()).length;
   await go(`/files/${source.file_id}`);await ready();
   const geometry=()=>exec(()=>{const n=document.querySelector('.reading-original'),r=n.getBoundingClientRect(),s=getComputedStyle(n);return{width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight};});
   const layout=await geometry();
   for(let i=0;i<20;i++){
    await lookup(`[data-sentence="${i}"] .reading-word`);await settle();if(i===0)eq(await geometry(),layout,`${mode}: opening explanation preserves body width, line height and wrapping`);
    await save();if(i===0){ok(await contrast('.lookup-saved strong')>=4.5,`${mode}: saved state contrast`);await shot(`${mode}-native-saved`);}
    await close();
   }
   const saved=await records(),own=saved.filter(r=>r.source?.content_hash===opened.material.content_hash);
   eq(own.length,20,`${mode}: twenty UI saves retain independent positions`);
   ok(own.every(r=>r.sentence&&r.source.file_name===`${mode}-native-flow.srt`&&Number.isInteger(r.source.start_offset)&&Number.isInteger(r.source.end_offset)),`${mode}: every UI save includes original sentence, file and offsets`);
   const selection=opened.segments[0];const repeated=await Promise.all(Array.from({length:10},()=>saveCore(selection,'Curiosity')));eq(new Set(repeated.map(r=>r.record.record_id)).size,1,`${mode}: ten native duplicate requests keep one position`);eq((await records()).length,before+20,`${mode}: duplicate save does not increase count`);
   const unknown=await importCore(`${mode}-unknown.srt`,[`Zzxqvopaque remains a complete English token in ${mode} mode.`]);const unknownData=await call('open_reading_material',{fileId:unknown.file_id});await go(`/files/${unknown.file_id}`);await ready();await lookup('[data-sentence="0"] .reading-word');await save();const missing=await call('saved_for_selection',{input:{segment_id:unknownData.segments[0].id,expression:'Zzxqvopaque',start_offset:0,end_offset:'Zzxqvopaque'.length,explanation:null,explanation_source:'unknown'}});eq(missing.explanation,null,`${mode}: missing dictionary answer can be saved honestly through UI`);await close();
   await go('/saved');await exists('.saved-record-row');await fill('.saved-search input','Curiosity');await wait(()=>count('.saved-record-row').then(n=>n>0&&n<=2),'saved search');
   await click('.saved-record-open');await button('修改解释');await fill('#saved-explanation',`Windows ${mode} 个人解释：好奇心`);
   ok(await contrast('.saved-detail-footer button')>=4.5,`${mode}: disabled return action contrast`);
   await button('保存修改');await absent('#saved-explanation');eq(await text('.saved-detail-meaning'),`Windows ${mode} 个人解释：好奇心`,`${mode}: actual personal edit persisted`);await close();
   const edited=(await call('list_saved_records',{query:`Windows ${mode} 个人解释`,limit:200,offset:0}))[0];ok(edited&&edited.explanation_source==='personal',`${mode}: personal edit has correct provenance`);
   await fill('.saved-search input',`Windows ${mode} 个人解释`);await wait(()=>count('.saved-record-row').then(n=>n===1),'unique personal result');
   await click('.saved-row-actions button');await button('移除');await absent('.saved-record-row');await button('撤销','.saved-undo button');await exists('.saved-record-row');eq(await text('.saved-record-meaning'),edited.explanation,`${mode}: remove/undo restores exact edited snapshot`);
   await click('.saved-record-open');await button('返回原文');await ready();eq(await exec(()=>Number(location.pathname.split('/').at(-1))),source.file_id,`${mode}: return opens actual source`);
   await go('/files');await exists(`.material-card[data-material="${source.file_id}"]`);await click(`.material-card[data-material="${source.file_id}"] .material-row-menu > button`);
   await dialogClick(()=>button('删除材料'),{action:'button',name:'^删除$'});await wait(async()=>!(await call('list_materials')).some(f=>f.id===source.file_id),'source deletion completes',60000);
   eq(await call('saved_record_source',{recordId:edited.record_id}),null,`${mode}: deleted source reported honestly`);
   await go('/saved');await fill('.saved-search input',edited.explanation);await exists('.saved-record-row');await click('.saved-record-open');eq(await text('.saved-context-copy p[lang=en]'),edited.sentence,`${mode}: source deletion preserves sentence copy`);await button('返回原文');await wait(async()=>(await text('.saved-detail-body')).includes('原材料已不存在'),'missing source feedback');await shot(`${mode}-deleted-source-copy`);await close();
   const b=(await fingerprint()).counts;eq(b.reviews,0,`${mode}: no word reviews added`);eq(b.phrase_reviews,0,`${mode}: no phrase reviews added`);report.savedFlows.push({theme:mode,uiSaves:20,duplicateRequests:10,records:(await records()).length});
  }
  const realBeforeExample=await fingerprint(),lastReading=await exec(()=>localStorage.getItem('lexicue-last-reading'));await replay();await lookup('[data-sentence="0"] .reading-word');await save();await close();eq(await fingerprint(),realBeforeExample,'replaying guide leaves existing real QA saved records unchanged');eq(await exec(()=>localStorage.getItem('lexicue-last-reading')),lastReading,'replayed example preserves actual continue-reading position');
  const before=await fingerprint();await restart();await go('/saved');await exists('.saved-record-row');eq(await fingerprint(),before,'native app restart retains materials, saved snapshots and edits');
 });
 await stage('native-backup-restore',async()=>{
  await go('/settings');await exists('.system-settings');const backupPath=join(task,`native-backup-${randomUUID()}.json`);
  await dialogClick(()=>button('导出完整备份'),{action:'file',paths:[backupPath]});
  await wait(async()=>{try{return JSON.parse(await readFile(backupPath,'utf8')).schema_version===9;}catch{return false;}},'native backup file written');
  const backup=JSON.parse(await readFile(backupPath,'utf8'));ok(backup.data.saved_records.length>=40,'native backup contains actual saved snapshots');
  const record=(await records())[0];await call('mutate_saved_record',{operationId:randomUUID(),mutation:{kind:'remove',record_id:record.record_id,expected_revision:record.revision}});
  await dialogClick(()=>button('恢复备份'),{action:'file',paths:[backupPath]});await native({action:'button',name:'^恢复数据$',evidence:join(output,'restore-confirm.json')});
  await wait(async()=>JSON.stringify(canonicalSaved((await call('export_all')).data.saved_records))===JSON.stringify(canonicalSaved(backup.data.saved_records)),'native restore matches saved snapshots',120000);
  const restored=(await call('export_all')).data;
  for(const table of ['files','segments','words','reviews','phrase_reviews','saved_records','saved_actions'])eq(table==='saved_records'?canonicalSaved(restored[table]):restored[table],table==='saved_records'?canonicalSaved(backup.data[table]):backup.data[table],`native backup/restore round-trip: ${table}`);
  await restart();eq(canonicalSaved((await call('export_all')).data.saved_records),canonicalSaved(backup.data.saved_records),'restored canonical snapshots survive native restart');report.backup={schema:backup.schema_version,files:backup.data.files.length,savedRecords:backup.data.saved_records.length,bytes:(await readFile(backupPath)).length};
 });
 await stage('recall-10000',async()=>{
  const corpus=JSON.parse(await readFile(join(repo,'docs','implementation','fixtures','v31-recall.json'),'utf8'));
  const fixed=[];const seen=new Set();
  for(const row of [...corpus.polysemy,...corpus.positive,...corpus.negative])if(!seen.has(row.expression)){seen.add(row.expression);fixed.push({expression:row.expression,sentence:row.oldSentence||`${row.expression} is in this earlier English sentence.`,explanation:`旧句：${row.oldExplanation||row.expression}`});}
  for(let i=1;i<13;i++)fixed.push({expression:'take off',sentence:`We take off from runway ${i}.`,explanation:`旧句记忆 ${i}`});
  const active=await asyncExec(async()=>{const b=await window.__TAURI_INTERNALS__.invoke('export_all');return b.data.saved_records.filter(r=>r.deleted_at===null).length;});
  const raw=gunzipSync(await readFile(join(repo,'src-tauri','resources','ecdict.tsv.gz'))).toString();
  const vocabulary=[...new Set(raw.split('\n').map(line=>line.split('\t')[0]).filter(word=>/^[a-z]{3,18}$/.test(word)&&!seen.has(word)))];
  const seed=[...fixed];for(let i=0;seed.length<10000-active;i++){const word=vocabulary[i];assert.ok(word,'public dictionary has enough filler terms');const expression=i%2?`remember ${word}`:word;seed.push({expression,sentence:`An earlier English sentence includes ${expression}.`,explanation:null});}
  const primary=seed.findIndex(row=>row.expression==='take off'&&row.explanation==='旧句：起飞');seed.push(seed.splice(primary,1)[0]);
  const source=await importCore('native-10000-earlier.srt',seed.map(r=>r.sentence));const opened=await call('open_reading_material',{fileId:source.file_id});
  // Actual production Save commands, not direct SQLite insertion or a test-only IPC.
  for(let start=0;start<seed.length;start+=100){const batch=seed.slice(start,start+100);await asyncExec(async(rows,segments)=>{const invoke=window.__TAURI_INTERNALS__.invoke;let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<rows.length){const i=next++,row=rows[i],segment=segments[i],start=segment.en_text.toLowerCase().indexOf(row.expression.toLowerCase());await invoke('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression:row.expression,start_offset:start,end_offset:start+row.expression.length,explanation:row.explanation,explanation_source:row.explanation?'personal':'unknown'}}});}}));},batch,opened.segments.slice(start,start+100));if(start%1000===0)console.log(`Native saved seed ${active+start+batch.length}/10000`);}
  const actualActive=await asyncExec(async()=>{const b=await window.__TAURI_INTERNALS__.invoke('export_all');return b.data.saved_records.filter(r=>r.deleted_at===null).length;});eq(actualActive,10000,'10,000 active saved records created with actual native Save commands');
  const index=await call('saved_recall_index');ok(index.length>9900,'10k set contains over 9,900 distinct expressions');
  const current=await importCore('native-reencounter.srt',[...corpus.positive,...corpus.negative,...corpus.polysemy].map(r=>r.text));report.recallMaterial=current.file_id;report.seed={activeRecords:actualActive,expressions:index.length,method:'actual import_reading_material and mutate_saved_record IPC, public ECDICT filler vocabulary',sourceFile:source.file_id};await checkpoint();
  const match=(i,expression)=>exec((i,expression)=>[...document.querySelectorAll(`[data-sentence="${i}"] .reading-word--recalled`)].some(n=>n.dataset.recall===expression),i,expression);
  const clickMatch=(i,expression)=>click(`[data-sentence="${i}"] .reading-word--recalled[data-recall="${expression.replaceAll('"','\\"')}"]`);
  report.recall={positive:20,negative:20,polysemy:10,themes:[]};
  for(const mode of ['ocean','midnight']){
   await theme(mode);await resize(1440);await go(`/files/${current.file_id}`);await ready();eq(await count('.context-panel'),0,`${mode}: re-encounter never opens a card before click`);eq(await count('.recall-section'),0,`${mode}: old contexts absent before click`);
   for(let i=0;i<20;i++)ok(await match(i,corpus.positive[i].expression),`${mode}: positive corpus ${i}`);
   for(let i=0;i<20;i++)eq(await match(i+20,corpus.negative[i].expression),false,`${mode}: complete-word/phrase boundary corpus ${i}`);
   for(let i=0;i<10;i++){const row=corpus.polysemy[i];ok(await match(i+40,row.expression),`${mode}: polysemy corpus ${i}`);await clickMatch(i+40,row.expression);await exists('.recall-meaning');eq(await text('.recall-meaning'),`旧句：${row.oldExplanation}`,`${mode}: old meaning belongs to labeled old context ${i}`);eq(await text('.lookup-current-heading'),'本句查询',`${mode}: current lookup separately labeled ${i}`);eq(await text('.lookup-context p[lang=en]'),row.text,`${mode}: current original sentence remains current ${i}`);await close();}
   await clickMatch(40,'take off');await exists('.recall-context');eq(await exec(()=>[...document.querySelectorAll('.recall-context')].filter(n=>n.checkVisibility({checkVisibilityCSS:true})&&!n.closest('details:not([open])')).length),1,`${mode}: one old sentence initially visible`);await click('.recall-others summary');eq(await count('.recall-context'),10,`${mode}: old sentences expand in bounded page`);await button('显示更多','.recall-others button');await wait(()=>count('.recall-context').then(n=>n===13),'all thirteen old contexts');eq(new Set(await exec(()=>[...document.querySelectorAll('.recall-context')].map(n=>n.dataset.record))).size,13,`${mode}: thirteen old contexts remain distinct`);await shot(`${mode}-native-recall-expanded`);await close();
   const before=(await call('saved_recall_contexts',{expression:'take off',offset:0,limit:50})).total;
   await clickMatch(40,'take off');await exists('.lookup-meaning');const meaning=await text('.lookup-meaning');await save();const contexts=await call('saved_recall_contexts',{expression:'take off',offset:0,limit:50});eq(contexts.total,before+1,`${mode}: same spelling in new sentence has independent identity`);
   eq(contexts.records[0].sentence,corpus.polysemy[0].text,`${mode}: new save has current sentence`);eq(contexts.records[0].explanation,meaning,`${mode}: current dictionary answer saved instead of old personal meaning`);await button('撤销','.lookup-footer button');await exists('.lookup-footer .saved-primary');await close();
   await click('.reader-tools button');await click('.recall-display-setting input');await key('\uE00C');await exists('.reading-paper[data-recall-state="off"]');eq(await count('.reading-word--recalled'),0,`${mode}: hints off clears marks`);eq((await call('saved_recall_contexts',{expression:'take off',offset:0,limit:50})).total,before,`${mode}: hints off retains records`);await restart();await go(`/files/${current.file_id}`);await exists('.reading-paper[data-recall-state="off"]');await click('.reader-tools button');await click('.recall-display-setting input');await key('\uE00C');await ready();report.recall.themes.push(mode);
  }
 });
 await stage('native-layout-accessibility-speech',async()=>{
  const current=report.recallMaterial;assert.ok(current,'recall stage precedes layout checks');report.layouts=[];report.speech=[];
  for(const mode of ['ocean','midnight']){
   await theme(mode);await go(`/files/${current}`);await ready();
   for(const width of [360,390,430,768,1024,1280,1440]){
    await resize(width);await lookup('[data-sentence="40"] .reading-word--recalled');await exists('.recall-meaning');await noOverflow(`${mode} ${width}`);
    ok(await contrast('.recall-note')>=4.5,`${mode} ${width}: old/current note text contrast`);
    ok(await exec(()=>![...document.querySelectorAll('.context-panel button')].some(n=>/^(close|关闭|×)$/i.test(n.getAttribute('aria-label')||n.textContent.trim()))),`${mode} ${width}: unified card has no close cross`);
    await shot(`${mode}-${width}-native-recall`);await close();report.layouts.push({theme:mode,width,height:900});
   }
   await resize(1440);await lookup('[data-sentence="40"] .reading-word--recalled');await settle();
   const css='[data-sentence="40"] .reading-word--recalled';
   for(const state of ['selected','hover','focus']){
    const e=await element(css);if(state==='hover')await wd('/actions','POST',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',origin:e,x:0,y:0,duration:50}]}]});
    if(state==='focus'){await key('\uE004');await exec(css=>document.querySelector(css).focus({preventScroll:true}),css);eq(await exec(css=>getComputedStyle(document.querySelector(css)).outlineStyle,css),'solid',`${mode}: native keyboard focus visible`);}
    ok(await contrast(css)>=4.5,`${mode}: ${state} word text contrast`);
   }
   await close();ok(await contrast(css)>=4.5,`${mode}: default word text contrast`);ok(await exec(css=>document.activeElement===document.querySelector(css),css),`${mode}: Escape restores triggering word focus`);
   await lookup(css);await click('[data-sentence="40"] .sentence-side small');await absent('.context-panel');ok(await exec(css=>document.activeElement===document.querySelector(css),css),`${mode}: non-interactive sentence gutter closes and restores focus`);
   await lookup(css);await click('.lookup-edit');await fill('#reader-meaning','很长的中文个人解释。'.repeat(60));eq(await count('.context-panel'),1,`${mode}: internal editing never accidentally closes card`);await resize(390,320);await noOverflow(`${mode} short-height editor`);ok(await exec(()=>document.querySelector('.lookup-footer').getBoundingClientRect().bottom<=innerHeight),`${mode}: short-height save footer reachable`);await shot(`${mode}-390-short-editor`);await close();
   await resize(390,900);await click('.reader-tools button');const large=await exec(()=>[...document.querySelectorAll('.display-settings-controls button')].filter(n=>n.textContent.trim()==='大'));for(const e of large)await wd(`/element/${elementId(e)}/click`,'POST',{});await key('\uE00C');await lookup(css);await noOverflow(`${mode} large fonts`);await shot(`${mode}-390-large-fonts`);await close();
   await wd('/ms/cdp/execute','POST',{cmd:'Emulation.setEmulatedMedia',params:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}});await lookup(css);eq(await exec(()=>getComputedStyle(document.querySelector('.context-panel')).animationName),'none',`${mode}: reduced-motion preference honored`);await close();await wd('/ms/cdp/execute','POST',{cmd:'Emulation.setEmulatedMedia',params:{features:[]}});
   await resize(1440);await lookup('[data-sentence="41"] .reading-word--recalled');
   await exec(()=>{window.__qaSpeechEvents=[];const synth=window.speechSynthesis,realSpeak=synth.speak.bind(synth),realCancel=synth.cancel.bind(synth);synth.speak=utterance=>{for(const kind of ['start','end','error'])utterance.addEventListener(kind,event=>window.__qaSpeechEvents.push({kind,text:utterance.text,error:event.error||null,at:performance.now()}));window.__qaSpeechEvents.push({kind:'request',text:utterance.text,at:performance.now()});return realSpeak(utterance);};synth.cancel=()=>{window.__qaSpeechEvents.push({kind:'cancel',at:performance.now()});return realCancel();};});
   const voices=await exec(()=>speechSynthesis.getVoices().map(v=>({name:v.name,lang:v.lang,local:v.localService})));const english=voices.filter(v=>/^en(?:[-_]|$)/i.test(v.lang));ok(english.length>0,`${mode}: installed English voices visible to native WebView2`);
   await click('.lookup-heading button');await delay(100);const normal=await exec(()=>({speaking:speechSynthesis.speaking,pending:speechSynthesis.pending,note:document.querySelector('.lookup-note')?.innerText||'',button:document.querySelector('.lookup-heading button').getAttribute('aria-label')}));
   if(english.length){await wait(()=>exec(()=>window.__qaSpeechEvents.some(e=>e.kind==='start'&&e.text==='bank')),'actual English word speech start');ok(true,`${mode}: real Windows English word synthesis starts`);if(normal.button==='停止朗读')await click('.lookup-heading button');}
   else ok(normal.note.length>0,`${mode}: native lack of English voices has readable fallback`);
   for(let i=0;i<10;i++)await click('.lookup-heading button');if(await exec(()=>document.querySelector('.lookup-heading button').getAttribute('aria-label')==='停止朗读'))await click('.lookup-heading button');
   await exec(()=>speechSynthesis.cancel());eq(await exec(()=>speechSynthesis.pending),false,`${mode}: ten speech actions do not leave a queued overlap`);
   await close();await lookup('[data-sentence="40"] .reading-word--recalled');await click('.lookup-heading button');await wait(()=>exec(()=>window.__qaSpeechEvents.some(e=>e.kind==='start'&&e.text==='take off')),'actual English phrase speech start');ok(true,`${mode}: real Windows phrase synthesis starts`);if(await exec(()=>document.querySelector('.lookup-heading button').getAttribute('aria-label')==='停止朗读'))await click('.lookup-heading button');
   await click('.lookup-context button');await wait(()=>exec(()=>window.__qaSpeechEvents.some(e=>e.kind==='start'&&e.text==='Please take off your coat.')),'actual English sentence speech start');ok(true,`${mode}: real Windows sentence synthesis starts`);await delay(80);if(await exec(()=>document.querySelector('.lookup-context button').getAttribute('aria-label')==='停止朗读'))await click('.lookup-context button');await close();
   // Only this fault-injection assertion simulates an unavailable voice API.
   await exec(()=>{window.__qaRealSpeech=window.speechSynthesis;Object.defineProperty(window,'speechSynthesis',{configurable:true,value:undefined});});await lookup(css);await click('.lookup-heading button');await exists('.lookup-note');ok((await text('.lookup-note')).length>0,`${mode}: injected unavailable voice does not block lookup/save`);await exec(()=>{Object.defineProperty(window,'speechSynthesis',{configurable:true,value:window.__qaRealSpeech});delete window.__qaRealSpeech;});await close();
   report.speech.push({theme:mode,voices,normal,actualLifecycleEvents:await exec(()=>window.__qaSpeechEvents),audibleOutput:'not human-confirmed',unavailableVoice:'fault injection only'});
   await wd('/ms/cdp/execute','POST',{cmd:'Network.enable',params:{}});await wd('/ms/cdp/execute','POST',{cmd:'Network.emulateNetworkConditions',params:{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0}});await lookup(css);await exists('.lookup-meaning');ok((await text('.lookup-meaning')).length>0,`${mode}: offline dictionary and reading stay usable`);await close();await wd('/ms/cdp/execute','POST',{cmd:'Network.emulateNetworkConditions',params:{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}});
  }
 });
 await stage('native-10000-performance',async()=>{
  const cold=[],cached=[],tasks=[];const source=`(()=>{window.__qaPerf={};window.__qaTasks=[];new MutationObserver(()=>{const p=window.__qaPerf;if(!p.text&&document.querySelector('.reading-original'))p.text=performance.now();if(p.text&&!p.pending&&document.querySelector('.reading-paper[data-recall-state="ready"]')&&document.querySelector('.reading-word--recalled')){p.pending=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{p.mark=performance.now();}));}}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class','data-recall-state']});if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>window.__qaTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});document.addEventListener('click',e=>{if(e.target.closest('.reading-word'))window.__qaActivation=performance.now();},true);})();`;
  for(const mode of ['ocean','midnight']){
   await theme(mode);await resize(1440);await go(`/files/${report.recallMaterial}`);await ready();await click('.reader-tools button');const medium=await exec(()=>[...document.querySelectorAll('.display-settings-controls button')].filter(n=>n.textContent.trim()==='中'));for(const e of medium)await wd(`/element/${elementId(e)}/click`,'POST',{});await key('\uE00C');await wd('/ms/cdp/execute','POST',{cmd:'Page.addScriptToEvaluateOnNewDocument',params:{source}});
   for(let i=0;i<20;i++){await go(`/files/${report.recallMaterial}`);await ready();await wait(()=>exec(()=>window.__qaPerf?.mark),'native cold marking timer');const sample=await exec(()=>({ms:window.__qaPerf.mark-window.__qaPerf.text,tasks:window.__qaTasks.filter(t=>t.start>=window.__qaPerf.text&&t.start<=window.__qaPerf.mark)}));cold.push({theme:mode,ms:sample.ms});tasks.push(...sample.tasks);}
   // Warm both dictionary entries before measuring the defined cached path.
   await call('lookup_reading_expression',{expression:'bank'});await call('lookup_reading_expression',{expression:'light'});
   for(let i=0;i<50;i++){const row=i%2?41:43;await lookup(`[data-sentence="${row}"] .reading-word--recalled`);const ms=await asyncExec(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now()-window.__qaActivation)))));cached.push({theme:mode,ms});}await close();
   await go('/saved');await exists('.saved-record-row');ok(await count('.saved-record-row')<=200,`${mode}: 10k saved list keeps first render bounded`);await fill('.saved-search input','curiosity');await wait(async()=>{const values=await exec(()=>[...document.querySelectorAll('.saved-record-term')].map(n=>n.textContent));return values.length&&values.every(v=>v.toLowerCase()==='curiosity');},'10k native saved search');
  }
  const stats=rows=>{const values=rows.map(r=>r.ms).sort((a,b)=>a-b);return{samples:values.length,p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1)};};
  report.performance={coldMarks:stats(cold),cachedLookup:stats(cached),longTasks:tasks,coldSamples:cold,lookupSamples:cached,definitions:{cold:'full navigation: first original-text DOM → real index IPC and matching Worker → ready marked DOM + two animation frames',cached:'native word click event → current dictionary meaning DOM exists + two animation frames; panel entrance animation is not included'}};
  ok(report.performance.coldMarks.p95<=500,'native 10k cold marking p95 <= 500ms');ok(report.performance.cachedLookup.p95<=500,'native 10k cached lookup p95 <= 500ms');eq(tasks.length,0,'no main-thread long task starts during cold matching interval');
 });
 await stage('native-legacy-backup-migration',async()=>{
  await go('/settings');const originalBackup=await call('export_all');
  const file=(id,name,language)=>({id,name,type:'srt',content:srt(['The plane will take off soon.']),content_hash:`legacy-${language}`,imported_at:123,language});
  const old={schema_version:6,exported_at:123,app_version:'0.4.4',data:{files:[file(1,'legacy-en.srt','en'),file(2,'legacy-ja.srt','ja'),file(3,'legacy-de.srt','de')],segments:[{id:1,file_id:1,index_num:0,en_text:'The plane will take off soon.'},{id:2,file_id:1,index_num:1,en_text:'We take off before dawn.'},{id:3,file_id:2,index_num:0,en_text:'昔の日本語'}],words:[{id:1,language:'en',lemma:'take',status:'learning'},{id:2,language:'en',lemma:'plane',status:'known'},{id:3,language:'en',lemma:'note',status:'known',definition:'个人注释保留'},{id:4,language:'ja',lemma:'昔',status:'learning',definition:'昔のメモ'},{id:5,language:'de',lemma:'Wort',status:'learning',definition:'alte Notiz'}],occurrences:[{id:1,word_id:1,segment_id:1,original_form:'take',position:3,meaning_zh:'拿'},{id:2,word_id:1,segment_id:2,original_form:'take',position:1,meaning_zh:'拿'},{id:3,word_id:2,segment_id:1,original_form:'plane',position:1,meaning_zh:'飞机'}],reviews:[{word_id:1,due_at:123}],review_logs:[{id:1,word_id:1,rating:3,reviewed_at:123}],phrases:[{id:1,language:'en',text:'keep going',source:'manual'},{id:2,language:'en',text:'take off',source:'detected'}],phrase_occurrences:[{id:1,phrase_id:2,segment_id:1,position:3,meaning_zh:'我的起飞',meaning_edited:1,meaning_en:'my meaning',meaning_en_edited:1,hidden:1,token_positions_json:'[3,4]'}],tags:[{id:1,name:'旧标签',name_key:'旧标签',created_at:123}],file_tags:[{file_id:1,tag_id:1}],frequency_baseline_profiles:[{language:'ja',tier:2,enabled:1,updated_at:123}],frequency_baseline_marks:[{word_id:4,language:'ja',tier:2,pack_id:'old',pack_version:'v1',verification:'corrected',marked_at:123,last_sampled_day:'2026-10-01'}],frequency_baseline_daily_checks:[{language:'ja',checked_on:'2026-10-01',count:3}]}};
  // Missing v9 saved fields and retired optional fields exercise the real deserializer.
  try{
   await call('restore_all',{backup:old});const first=await records();eq(first.length,5,'old backup migrates only explicit English records and preserves each context');ok(first.every(r=>r.saved_at===null),'old save time remains unknown');eq(first.filter(r=>!r.source).length,2,'missing old sources are not invented');ok(first.some(r=>r.explanation==='我的起飞'&&r.legacy.occurrence.meaning_en==='my meaning'),'both old Chinese and English personal phrase edits preserved');
   ok(!first.some(r=>['plane','昔','Wort'].includes(r.expression)),'automatic-only and non-English records stay out of new learning');
   await call('restore_all',{backup:old});eq((await records()).map(r=>r.record_id).sort(),first.map(r=>r.record_id).sort(),'old migration repeats without new identities');
   const portable=(await call('export_all')).data;eq(portable.words.length,5,'all old language records remain exportable');eq(portable.reviews.length,1,'old review remains retained');eq(portable.review_logs.length,1,'old review log retained');eq(portable.tags.length,1,'old tags retained');eq(portable.frequency_baseline_profiles.length,1,'retired frequency preferences retained');
   eq((await call('list_legacy_records',{kind:'words',query:'昔',offset:0})).rows.length,1,'native read-only history exposes Japanese old record');
   for(const mode of ['ocean','midnight']){await theme(mode);await go('/legacy?kind=words');await exists('.legacy-list');await fill('.legacy-search','昔');await wait(async()=>await count('.legacy-list button')===1&&(await text('.legacy-list')).includes('昔'),'filtered Japanese legacy row');await click('.legacy-list button');await exists('.legacy-fields');ok((await text('.legacy-fields')).includes('昔のメモ'),`${mode}: legacy UI keeps personal content readable`);await shot(`${mode}-native-legacy`);await close();await go('/files');await exists('.materials-paper');eq(await count('.material-card'),1,`${mode}: only English legacy material enters new material gallery`);}
   report.migration={schema:6,newSavedRecords:5,missingSources:2,retainedWords:5,retainedReviews:1,retainedReviewLogs:1,retainedTags:1,repeatStable:true};
  }finally{await call('restore_all',{backup:originalBackup});await exec(()=>window.dispatchEvent(new Event('lexicue-sync-applied')));}
  eq(await asyncExec(async()=>{const b=await window.__TAURI_INTERNALS__.invoke('export_all');return b.data.saved_records.filter(r=>r.deleted_at===null).length;}),10000,'legacy regression restores full isolated 10k QA dataset');
 });
 report.completedAt=new Date().toISOString();delete report.failure;
 await checkpoint();
 console.log(`Completed ${report.stages.join(', ')}; ${report.checks.length} checks`);
}catch(error){report.failure={message:error.message,stack:error.stack,at:new Date().toISOString()};if(session){await shot('failure').catch(()=>{});await writeFile(join(output,'failure-state.json'),JSON.stringify(await exec(()=>({url:location.href,text:document.body.innerText,viewport:[innerWidth,innerHeight],preferences:localStorage.getItem('lexicue-preferences'),onboarding:localStorage.getItem('lexicue-onboarding-v1')})),null,2)).catch(()=>{});}await checkpoint();throw error;}finally{if(appProcess&&appProcess.exitCode===null)await native({action:'close'}).catch(()=>{appProcess.kill();});if(session)await wd('','DELETE').catch(()=>{});driver.kill();await writeFile(join(output,'driver-start.txt'),driverLog);}
