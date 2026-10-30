/** Import UI: real document/SRT Workers + Rust commands + disposable SQLite.
 * File pickers/drag IPC and YouTube network responses are controlled at the native boundary.
 * Physical OS picker/drop are verified separately, never claimed by this harness. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_IMPORT_UI_OUTPUT||'/tmp/lexicue-ui-import';
const h=await createReadingHarness(output),{browser,url,call,fixture,errors}=h;
let page,checks=0;const contrasts=[];
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const flight=await readFile(`${root}/docs/implementation/fixtures/v31-reading.srt`,'utf8');
const srt=(text,zh='')=>`1\n00:00:01,000 --> 00:00:03,000\n${text}${zh?'\n'+zh:''}\n`;
const writes=()=>page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='import_reading_material'));
const drop=files=>page.evaluate(files=>{const dataTransfer=new DataTransfer();for(const[name,text]of files)dataTransfer.items.add(new File([text],name));window.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));},files);
const preview=()=>page.locator('.lc-import-preview').waitFor();
const settle=()=>page.locator('.lc-import-modal').evaluate(node=>Promise.all(node.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
const close=async()=>{await page.keyboard.press('Escape');await page.locator('.lc-import-modal').waitFor({state:'detached'});};
const open=async()=>{
 if(new URL(page.url()).pathname.replace(/\/+$/,'')!=='/files'){await page.locator('.b-dock a[href="/files"]').click();await page.locator('.materials-paper').waitFor();}
 await page.getByRole('button',{name:'导入',exact:true}).click();
};
const confirm=()=>page.getByRole('button',{name:/^确认导入/}).click();
async function contrast(locator,label){const value=await locator.evaluate(node=>{
 const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
 let p=node,bg;do{bg=rgb(getComputedStyle(p).backgroundColor);p=p.parentElement;}while(p&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});contrasts.push({label,ratio:value});ok(value>=4.5,`${label}: ${value.toFixed(2)}:1`);}
async function youtube(info,prepared){await page.evaluate(({info,prepared})=>{window.__youtube={info,prepared};window.__clipboardText='https://www.youtube.com/watch?v=abcdefghijk';},{info,prepared});await open();await page.getByRole('button',{name:'粘贴内容',exact:true}).click();}

try{
 for(const theme of ['ocean','midnight']){
  await call('test_reset');const context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();await fixture(page,theme);
  await page.addInitScript(()=>{
   window.isTauri=true;
   const base=window.__TAURI_INTERNALS__.invoke,callbacks=new Map(),listeners=new Map();let next=100;
   window.__TAURI_INTERNALS__.metadata={currentWindow:{label:'main'},currentWebview:{label:'main'}};
   window.__TAURI_INTERNALS__.transformCallback=fn=>{const id=++next;callbacks.set(id,fn);return id;};
   window.__TAURI_INTERNALS__.unregisterCallback=id=>callbacks.delete(id);
   window.__nativeDrop=paths=>{for(const {event,handler}of listeners.values())if(event==='tauri://drag-drop')callbacks.get(handler)?.({event,payload:{paths,position:{x:0,y:0}}});};
   window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='plugin:event|listen'){const id=++next;listeners.set(id,args);return id;}
    if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return;}
    if(command==='plugin:clipboard-manager|read_text'){
     window.__uiCalls.push({command,args:{}});
     if(window.__clipboardHold)await new Promise(done=>window.__releaseClipboard=done);
     if(window.__clipboardFail)throw Error('clipboard unavailable');
     return window.__clipboardText??null;
    }
    if(['plugin:fs|read_text_file','plugin:fs|read'].includes(command)&&window.__holdRead){await new Promise(done=>window.__releaseRead=done);}
    if(command==='cancel_import_translation'){window.__uiCalls.push({command,args:structuredClone(args)});return;}
    if(command==='translate_import_sentences'){
     window.__uiCalls.push({command,args:structuredClone(args)});
     if(window.__translationHold)await new Promise(done=>window.__releaseTranslation=done);
     if(window.__translationFail)return {translations:[],error:'translation_rate_limited'};
     return {translations:args.sentences.map(s=>({index:s.index,translation:`测试译文 ${s.index+1}。`})),error:null};
    }
    if(command.startsWith('youtube_')&&command!=='youtube_ytdlp_status'){
     window.__uiCalls.push({command,args:structuredClone(args)});
     if(command==='youtube_cancel_job')return;
     const data=structuredClone(window.__youtube);
     if(data.hold)await new Promise(done=>window.__releaseYouTube=done);
     if(data.fail)throw Error('controlled network failure');
     return command==='youtube_list_subs'?data.info:data.prepared;
    }
    const value=await base(command,args);
    if(command==='import_reading_material'&&window.__holdWrite){window.__holdWrite=false;await new Promise(done=>window.__releaseWrite=done);}
    return value;
   };
  });
  await page.goto(`${url}/files`);await page.locator('.materials-paper').waitFor();
  await open();await settle();eq(await page.locator('#root').evaluate(n=>n.inert),true,'modal background inert');
  eq(await page.locator('.context-panel').count(),0,'import does not use context panel');eq(await page.locator('.b-shell').getAttribute('data-context-open'),'false','import never shifts reading workspace');
  const sources=page.locator('.lc-import-source');await contrast(sources.first().locator('strong'),`${theme} source default`);await sources.first().hover();await contrast(sources.first().locator('strong'),`${theme} source hover`);
  await page.keyboard.press('Tab');await sources.first().focus();eq(await sources.first().evaluate(n=>getComputedStyle(n).outlineStyle),'solid','keyboard focus visible');
  await page.locator('.lc-import-close').focus();await page.keyboard.press('Shift+Tab');ok(await sources.last().evaluate(n=>n===document.activeElement),'reverse focus loop');await page.keyboard.press('Tab');ok(await page.locator('.lc-import-close').evaluate(n=>n===document.activeElement),'forward focus loop');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length),0,'opening never reads clipboard');
  ok(!(await page.locator('.lc-import-modal').innerText()).includes('TXT'),'compact entry has no type or marketing copy');
  ok((await page.locator('.lc-import-modal').innerText()).includes('支持英文文本、网页和 YouTube 链接'),'entry explains supported content without a type-selection flow');
  ok(await page.locator('.lc-import-modal').evaluate(n=>{const r=n.getBoundingClientRect();return r.width<=356&&r.height<230;}),'symmetric compact entry dimensions');
  ok(await page.locator('.lc-import-close').evaluate(n=>{const r=n.getBoundingClientRect();return r.width===r.height&&r.height<=36;}),'desktop close control remains compact and square');
  await page.screenshot({path:`${output}/${theme}-sources.png`});
  const exiting=await page.locator('.lc-import-close').evaluate(n=>{
   n.click();return new Promise(resolve=>requestAnimationFrame(()=>{const panel=document.querySelector('.lc-import-modal');resolve({mounted:!!panel,animated:panel?.getAnimations().some(a=>a.playState==='running'),inert:document.querySelector('#root').inert});}));
  });
  eq(exiting,{mounted:true,animated:true,inert:true},'close animates before unmount and retains focus ownership');
  await page.locator('.lc-import-modal').waitFor({state:'detached'});ok(await page.getByRole('button',{name:'导入',exact:true}).evaluate(n=>n===document.activeElement),'focus restored');
  await open();eq(await page.evaluate(()=>window.__lexicueBack()),true,'system back handled');await page.locator('.lc-import-modal').waitFor({state:'detached'});
  await page.evaluate(text=>window.__uiFiles={'/fixture/真实英语.srt':text},flight);await open();await page.getByRole('button',{name:'选择文件',exact:true}).click();await preview();await settle();
  eq((await writes()).length,0,'native picker boundary has zero writes before confirmation');eq((await call('test_counts')).files,0,'no material before confirmation');
  ok((await page.locator('.lc-import-preview').innerText()).includes('take off'),'real English excerpt');eq((await page.locator('.lc-import-excerpts').innerText()).split('飞机很快就要起飞了。').length-1,1,'existing Chinese appears once in the original source block');ok((await page.locator('.lc-import-excerpts').innerText()).includes('Curiosity helps us make sense of new ideas.'),'full local preview includes the final cue, beyond the former three-sentence excerpt');
  await contrast(page.locator('.lc-import-preview-source'),`${theme} source metadata`);await contrast(page.getByRole('button',{name:/^确认导入/}),`${theme} primary default`);await page.getByRole('button',{name:/^确认导入/}).hover();await contrast(page.getByRole('button',{name:/^确认导入/}),`${theme} primary hover`);
  await page.screenshot({path:`${output}/${theme}-preview.png`});
  // A cancelled picker preserves the already prepared content.
  const beforeDraft=await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;});
  await page.evaluate(async()=>{window.__uiFiles={};const{useImportStore}=await window.__uiStoreModule('importStore');await useImportStore.getState().choose();});await preview();
  eq(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;}),beforeDraft,'cancelled picker retains preview');
  await page.getByRole('button',{name:/^确认导入/}).evaluate(n=>{n.click();n.click();});await page.waitForURL(/\/files\/\d+$/);await page.locator('.reading-word').first().waitFor();
  eq((await writes()).length,1,'double confirmation invokes write once');eq((await writes())[0].args.input.content,beforeDraft.content,'submitted normalized content exactly matches frozen preview');eq((await writes())[0].args.input.segments,beforeDraft.segments,'submitted sentences exactly match frozen preview');eq((await writes())[0].args.input.document.source_sha256,createHash('sha256').update(flight).digest('hex'),'original file byte identity retained separately');eq((await writes())[0].args.input.document.original_format,'srt','original format retained despite normalized storage');eq((await call('test_counts')).files,1,'one material committed');
  const readingBounds=await page.locator('.reading-original').first().boundingBox();eq(await page.getByRole('button',{name:'导入',exact:true}).count(),0,'reading has no import button');await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');useImportStore.getState().show();});await settle();eq(await page.locator('.reading-original').first().boundingBox(),readingBounds,'reader dimensions unchanged while import open');await close();
  await drop([['duplicate.srt',flight],['empty.srt',''],['second.srt',srt('A second material is ready.','第二份材料已经准备好了。')]]);await preview();
  eq((await writes()).length,1,'browser drop prepares without writing');eq((await call('test_counts')).files,1,'browser drop does not mutate database');
  await page.locator('.lc-import-item-select').last().click();ok((await page.locator('.lc-import-preview').innerText()).includes('A second material is ready.'),'each valid file has its own real preview');
  await contrast(page.locator('.lc-import-item-select[aria-pressed=true] small'),`${theme} selected`);await page.locator('.lc-import-item-select[aria-pressed=true]').hover();await contrast(page.locator('.lc-import-item-select[aria-pressed=true] small'),`${theme} selected hover`);
  await settle();await page.screenshot({path:`${output}/${theme}-batch-preview.png`});await confirm();await page.getByText('已导入 1 份材料',{exact:true}).waitFor();
  eq(await page.locator('.lc-import-items small').allTextContents(),['内容已存在，未覆盖','未完成','已导入'],'partial results isolated');eq((await call('test_counts')).files,2,'only valid new content is created');await close();
  // Lost receipt after real COMMIT: same exact operation and content on retry.
  await drop([['lost.srt',srt('A lost receipt can be safely recovered.')]]);await preview();await page.evaluate(()=>window.__uiFailure={command:'import_reading_material',remaining:1,afterCommit:true});await confirm();await page.locator('.lc-import-error').waitFor();
  const lost=(await writes()).at(-1);eq((await call('test_counts')).files,3,'lost receipt really committed');await page.getByRole('button',{name:'重试未完成项'}).click();await page.waitForURL(/\/files\/\d+$/);eq((await writes()).at(-1),lost,'retry resends exact operation payload');eq((await call('test_counts')).files,3,'idempotent retry has one result');
  // Native drag event adapter routes into the same prepare/preview state.
  await page.evaluate(text=>{window.__uiFiles={'/fixture/native-drag.srt':text};window.__nativeDrop(['/fixture/native-drag.srt']);},srt('Native paths share the same preview.'));await preview();eq((await call('test_counts')).files,3,'native event adapter does not commit');await close();
  // Closing a slow read cancels promptly, even when the OS finishes later.
  await page.evaluate(text=>{window.__holdRead=true;window.__uiFiles={'/fixture/slow.srt':text};window.__nativeDrop(['/fixture/slow.srt']);},srt('This late file must never be saved.'));await page.locator('.lc-import-loading-copy').waitFor();await close();
  await drop([['new.srt',srt('A newer source owns the preview.')]]);await preview();await page.evaluate(()=>{window.__holdRead=false;window.__releaseRead();});await page.waitForTimeout(80);ok((await page.locator('.lc-import-preview').innerText()).includes('A newer source owns'),'late source cannot overwrite new one');await close();eq((await call('test_counts')).files,3,'cancelled and discarded previews do not write');
  // Exercise actual module Worker termination, not a mocked parser.
  const workerCancel=await page.evaluate(async content=>{
   const OriginalWorker=window.Worker;let started;let terminated=0;
   const created=new Promise(done=>started=done);
   window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('documentWorker'))started();}terminate(){terminated++;super.terminate();}};
   try{const{useImportStore}=await window.__uiStoreModule('importStore');const work=useImportStore.getState().start([{name:'worker-cancel.srt',read:async()=>new TextEncoder().encode(content)}]);await created;useImportStore.getState().hide();await work;return {terminated,open:useImportStore.getState().open,items:useImportStore.getState().items.length};}
   finally{window.Worker=OriginalWorker;}
  },flight);
  eq(workerCancel,{terminated:1,open:false,items:0},'closing terminates the actual parsing Worker and releases drafts');eq((await call('test_counts')).files,3,'aborted Worker has no write');
  // Stop is a boundary between transactions; a committed in-flight item stays successful.
  await drop([['background-one.srt',srt('First background transaction.')],['background-two.srt',srt('Second background transaction.')]]);await preview();await page.evaluate(()=>window.__holdWrite=true);await confirm();await page.waitForFunction(()=>typeof window.__releaseWrite==='function');await close();
  await page.locator('.b-dock a[href="/files"]').click();await page.locator('.materials-paper').waitFor();await page.getByRole('button',{name:'导入处理中，打开进度',exact:true}).click();await page.getByRole('button',{name:'取消余下导入'}).click();await contrast(page.getByRole('button',{name:'取消余下导入'}),`${theme} disabled`);await page.evaluate(()=>window.__releaseWrite());await page.getByText('已导入 1 份材料',{exact:true}).waitFor();eq(await page.locator('.lc-import-items small').allTextContents(),['已导入','未导入'],'stop waits for actual receipt');await page.getByRole('button',{name:'重试未完成项'}).click();await page.getByText('已导入 2 份材料',{exact:true}).waitFor();eq((await call('test_counts')).files,5,'retry remaining draft succeeds');await close();
  // YouTube network outcomes are deterministic, but parsing and saving remain real.
  const info={title:'A real preview from downloaded subtitles',manual:[{lang:'en',is_auto:false},{lang:'zh-Hans',is_auto:false}],automatic:[{lang:'en-orig',language:'en',is_auto:true}],duration:20,thumbnail:null};
  await youtube({...info,manual:[],automatic:[]},null);await page.getByText('这段视频没有可用的英语字幕。',{exact:true}).waitFor();eq(await page.getByRole('button',{name:'生成预览'}).count(),0,'no English cannot prepare');await close();
  await youtube(info,{status:'partial',primary:{name:'english.srt',content:srt('English remains available after translation fails.')}});await page.getByLabel('英语字幕',{exact:true}).selectOption('1');await page.getByRole('button',{name:'生成预览'}).click();await page.getByRole('button',{name:'保留已获取内容，继续预览'}).waitFor();
  eq((await call('test_counts')).files,5,'translation failure writes nothing');await page.getByRole('button',{name:'保留已获取内容，继续预览'}).click();await preview();eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_prepare_subtitles').length),1,'fallback does not redownload');eq(await page.locator('.lc-import-excerpts [lang=zh]').count(),0,'fallback shows English only');await confirm();await page.waitForURL(/\/files\/\d+$/);eq((await call('test_counts')).files,6,'YouTube confirms through actual material command');
  eq(await page.evaluate(async()=>{const{usePreferencesStore}=await window.__uiStoreModule('preferencesStore');return usePreferencesStore.getState().youtube.lastSelection;}),{primary:'en',secondary:null},'only actual successful fallback preference saved');
  await youtube(info,{status:'complete',subtitle:{name:'both.srt',content:srt('We can read both languages here.','这里可以阅读双语字幕。')}});await page.getByRole('button',{name:'生成预览'}).click();await preview();eq(await page.locator('.lc-import-excerpts [lang=zh]').innerText(),'这里可以阅读双语字幕。','YouTube bilingual preview is parsed content');eq((await call('test_counts')).files,6,'YouTube success still awaits confirmation');await close();
  await page.evaluate(value=>{window.__youtube={info:value,hold:true};window.__clipboardText='https://youtu.be/abcdefghijk';},info);await open();await page.getByRole('button',{name:'粘贴内容',exact:true}).click();await page.waitForFunction(()=>typeof window.__releaseYouTube==='function');await close();await open();await page.evaluate(()=>window.__releaseYouTube());await page.waitForTimeout(80);await page.locator('.lc-import-sources').waitFor();eq(await page.locator('.lc-import-tracks').count(),0,'late query never revives its closed source');await close();
  // Explicit clipboard action: one native read and one lookup, no import before confirmation.
  await page.evaluate(info=>{window.__clipboardText='https://youtu.be/abcdefghijk';window.__youtube={info};},info);
  const clipBefore=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length);
  const listBefore=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length);
  await open();await page.getByRole('button',{name:'粘贴内容',exact:true}).evaluate(n=>{n.click();n.click();});await page.locator('.lc-import-tracks').waitFor();
  eq(await page.getByLabel('链接',{exact:true}).inputValue(),'https://youtu.be/abcdefghijk','clipboard link is used automatically');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length),clipBefore+1,'double paste reads once');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length),listBefore+1,'valid clipboard starts one lookup');
  await close();
  for(const [text,fail,message]of [['https://',false,'链接格式不完整，请修改或重新粘贴。'],[null,false,'未读到文字，请先复制英文或链接；图片或文件请使用选择文件。'],[null,true,'无法读取剪贴板，请在下方手动粘贴。']]){
   await page.evaluate(({text,fail})=>{window.__clipboardText=text;window.__clipboardFail=fail;},{text,fail});
   const before=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length);
   await open();await page.getByRole('button',{name:'粘贴内容',exact:true}).click();await page.getByText(message,{exact:true}).waitFor();
   eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length),before,'invalid or unavailable clipboard stays local');
   if(text||fail)ok(await page.getByLabel('英文正文或链接',{exact:true}).isVisible(),'manual fallback remains available');await close();
  }
  await page.evaluate(()=>{window.__clipboardFail=false;window.__clipboardHold=true;window.__clipboardText='https://youtu.be/abcdefghijk';});
  await open();await page.getByRole('button',{name:'粘贴内容',exact:true}).click();await page.getByRole('button',{name:'读取中…',exact:true}).waitFor();await contrast(page.getByRole('button',{name:'读取中…',exact:true}),`${theme} clipboard disabled`);
  await close();await open();await page.evaluate(()=>{window.__clipboardHold=false;window.__releaseClipboard();});await page.waitForTimeout(70);
  eq(await page.locator('.lc-import-sources').count(),1,'late clipboard result cannot replace a reopened entry');await close();
  // Local files prepare without a translation dependency; reading requests are explicit.
  const translationRequestsBeforeLocal=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length);
  await drop([['book.txt','Dr. Smith bought a book. She read it yesterday.']]);await preview();
  const bookDraft=await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;});
  eq(bookDraft.segments.map(s=>s.en_text),['Dr. Smith bought a book.','She read it yesterday.'],'TXT is split into reading sentences');
  eq(await page.locator('.lc-import-excerpts [lang=en]').allTextContents(),['Dr. Smith bought a book. She read it yesterday.'],'preview preserves original paragraph structure');
  eq(bookDraft.segments.map(s=>s.zh_text),[null,null],'English-only local preview does not manufacture translation');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),translationRequestsBeforeLocal,'local import makes no translation request');
  await confirm();await page.waitForURL(/\/files\/\d+$/);eq((await call('test_counts')).files,7,'TXT commits through real SQLite');await page.locator('.reading-word').first().waitFor();
  const bookId=Number(new URL(page.url()).pathname.split('/').at(-1));
  await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');window.__importTrace=[];useImportStore.subscribe(s=>window.__importTrace.push({open:s.open,phase:s.phase,running:s.running,items:s.items.map(i=>({name:i.name,stage:i.stage,error:i.error}))}));window.__translationFail=true;});
  await drop([['failure.txt','The source survives a translation failure.']]);await preview();
  eq(await page.getByRole('button',{name:'保留已获取内容，继续预览'}).count(),0,'unavailable translation does not gate local preview');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),translationRequestsBeforeLocal,'failing service is never contacted during local preparation');await close();
  const translationToggle=()=>page.locator('.dock-reading-tools:visible button').filter({has:page.locator('svg.lucide-languages')}).first();
  await translationToggle().click();await page.getByText('部分译文未生成。英文阅读与保存不受影响。',{exact:true}).waitFor();
  ok(await page.locator('.reading-original').first().isVisible(),'reading stays available after explicit translation error');
  const failedRequests=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length);
  eq(failedRequests,translationRequestsBeforeLocal+1,'reading translation requires an explicit request');
  await page.evaluate(()=>window.__translationFail=false);await page.locator('.reading-translation-status').getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.reading-translation').length===2);
  eq(await page.locator('.reading-translation').allTextContents(),['测试译文 1。','测试译文 2。'],'explicit reading retry renders current sentence translations');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),failedRequests+1,'explicit translation retry makes one request');
  const translated=await call('open_reading_material',{fileId:bookId});eq(translated.segments.map(s=>s.zh_text),['测试译文 1。','测试译文 2。'],'reading translations persist through real Rust writeback');
  // Clear the controlled QA translations, reopen, then navigate away during a held request.
  for(const segment of translated.segments)await call('test_edit_segment',{segmentId:segment.id,zhText:null});
  await page.locator('.b-path a').click();await page.locator('.materials-paper').waitFor();await page.getByRole('button',{name:'book.txt',exact:true}).click();await page.locator('.reading-word').first().waitFor();
  await page.evaluate(()=>{window.__translationHold=true;window.__releaseTranslation=undefined;});await translationToggle().click();await page.waitForFunction(()=>typeof window.__releaseTranslation==='function');
  await contrast(page.locator('.reading-translation-status span'),`${theme} translation status`);await page.screenshot({path:`${output}/${theme}-translating.png`});
  const fillsBeforeCancel=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='fill_reading_translations').length);
  await page.locator('.b-path a').click();await page.locator('.materials-paper').waitFor();await page.evaluate(()=>{window.__translationHold=false;window.__releaseTranslation();});
  await page.waitForTimeout(80);eq(await page.locator('.reading-page,.lc-import-modal').count(),0,'late reading translation cannot reopen a departed material');
  ok(await page.evaluate(()=>window.__uiCalls.some(c=>c.command==='cancel_import_translation')),'navigation reaches native translation cancellation');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='fill_reading_translations').length),fillsBeforeCancel,'cancelled late translation cannot write back');
  eq((await call('open_reading_material',{fileId:bookId})).segments.map(s=>s.zh_text),[null,null],'cancelled translations do not change stored source');
  // Responsive, zoom, reduced motion and an IME-sized viewport.
  await drop([['responsive.srt',flight]]);await preview();
  for(const [width,height,scale]of [[375,812,1],[320,568,1],[390,320,1],[768,420,1],[390,844,2]]){
   await page.setViewportSize({width,height});await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale*100}%`,scale);await settle();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page horizontal overflow');
   ok(await page.locator('.lc-import-modal').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),'dialog inside viewport');
   ok(await page.getByRole('button',{name:/^确认导入/}).evaluate(n=>{const r=n.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;}),'confirmation reachable at zoom and keyboard height');
   ok(await page.locator('.lc-import-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'body has no horizontal overflow');
   await page.screenshot({path:`${output}/${theme}-${width}x${height}-${scale}x.png`});
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');await page.setViewportSize({width:1440,height:900});await close();await page.emulateMedia({reducedMotion:'reduce'});await open();eq(await page.locator('.lc-import-modal').evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion modal');await close();
  await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');void useImportStore.getState().start([{name:'reduced.srt',read:()=>new Promise(done=>window.__reducedRead=done)}]);});await page.locator('.lc-import-paper-character').waitFor();eq(await page.locator('.lc-import-paper-character').evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion paper');await close();await page.evaluate(()=>window.__reducedRead(''));await context.close();
 }
 eq(errors,[],'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({checks,themes:['ocean','midnight'],contrasts,errors,nativeBoundary:'simulated OS picker/drop/chunked FS IPC, YouTube and translation-service responses; actual document/SRT Workers, Rust transactions, explicit reading translation writeback and temporary SQLite'},null,2));console.log(`Import UI: ${checks} checks passed. Evidence: ${output}`);
}catch(error){if(page){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');const s=useImportStore.getState();return {text:document.body.innerText,calls:window.__uiCalls,trace:window.__importTrace,state:{open:s.open,phase:s.phase,running:s.running,items:s.items.map(i=>({name:i.name,stage:i.stage,error:i.error}))}};}),null,2)).catch(()=>{});}throw error;}finally{await h.dispose();}
