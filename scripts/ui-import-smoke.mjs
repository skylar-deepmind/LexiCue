/** Import UI: real SRT Worker + Rust commands + disposable SQLite.
 * File pickers/drag IPC and YouTube network responses are controlled at the native boundary.
 * Physical OS picker/drop are verified separately, never claimed by this harness. */
import assert from 'node:assert/strict';
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
async function youtube(info,prepared){await page.evaluate(({info,prepared})=>{window.__youtube={info,prepared};},{info,prepared});await open();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByLabel('链接',{exact:true}).fill('https://www.youtube.com/watch?v=test');await page.getByRole('button',{name:'查找英语字幕',exact:true}).click();}
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
    if(command==='plugin:fs|read_text_file'&&window.__holdRead){await new Promise(done=>window.__releaseRead=done);}
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
  ok(!(await page.locator('.lc-import-modal').innerText()).includes('YouTube'),'entry is source-neutral');
  ok(await page.locator('.lc-import-modal').evaluate(n=>{const r=n.getBoundingClientRect();return r.width<=356&&r.height<170;}),'symmetric compact entry dimensions');
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
  ok((await page.locator('.lc-import-preview').innerText()).includes('take off'),'real English excerpt');ok(await page.locator('.lc-import-excerpts [lang=zh]').count()>0,'real Chinese excerpt');
  await contrast(page.locator('.lc-import-preview-source'),`${theme} source metadata`);await contrast(page.getByRole('button',{name:/^确认导入/}),`${theme} primary default`);await page.getByRole('button',{name:/^确认导入/}).hover();await contrast(page.getByRole('button',{name:/^确认导入/}),`${theme} primary hover`);
  await page.screenshot({path:`${output}/${theme}-preview.png`});
  // A cancelled picker preserves the already prepared content.
  const beforeDraft=await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;});
  await page.evaluate(async()=>{window.__uiFiles={};const{useImportStore}=await window.__uiStoreModule('importStore');await useImportStore.getState().choose();});await preview();
  eq(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;}),beforeDraft,'cancelled picker retains preview');
  await page.getByRole('button',{name:/^确认导入/}).evaluate(n=>{n.click();n.click();});await page.waitForURL(/\/files\/\d+$/);await page.locator('.reading-word').first().waitFor();
  eq((await writes()).length,1,'double confirmation invokes write once');eq((await writes())[0].args.input.content,flight,'submitted original exactly matches preview');eq((await call('test_counts')).files,1,'one material committed');
  const readingBounds=await page.locator('.reading-original').first().boundingBox();eq(await page.getByRole('button',{name:'导入',exact:true}).count(),0,'reading has no import button');await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');useImportStore.getState().show();});await settle();eq(await page.locator('.reading-original').first().boundingBox(),readingBounds,'reader dimensions unchanged while import open');await close();
  await drop([['duplicate.srt',flight],['empty.srt',''],['second.srt',srt('A second material is ready.','第二份材料已经准备好了。')]]);await preview();
  eq((await writes()).length,1,'browser drop prepares without writing');eq((await call('test_counts')).files,1,'browser drop does not mutate database');
  await page.locator('.lc-import-item-select').last().click();ok((await page.locator('.lc-import-preview').innerText()).includes('A second material is ready.'),'each valid file has its own real preview');
  await contrast(page.locator('.lc-import-item-select[aria-pressed=true] small'),`${theme} selected`);await page.locator('.lc-import-item-select[aria-pressed=true]').hover();await contrast(page.locator('.lc-import-item-select[aria-pressed=true] small'),`${theme} selected hover`);
  await settle();await page.screenshot({path:`${output}/${theme}-batch-preview.png`});await confirm();await page.getByText('已导入 1 份材料',{exact:true}).waitFor();
  eq(await page.locator('.lc-import-items small').allTextContents(),['内容已存在，未覆盖','未完成，可重试','已导入'],'partial results isolated');eq((await call('test_counts')).files,2,'only valid new content is created');await close();
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
   window.Worker=class extends OriginalWorker{constructor(...args){super(...args);if(String(args[0]).includes('srtWorker'))started();}terminate(){terminated++;super.terminate();}};
   try{const{useImportStore}=await window.__uiStoreModule('importStore');const work=useImportStore.getState().start([{name:'worker-cancel.srt',read:async()=>content}]);await created;useImportStore.getState().hide();await work;return {terminated,open:useImportStore.getState().open,items:useImportStore.getState().items.length};}
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
  await open();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByLabel('链接',{exact:true}).fill('https://www.youtube.com/watch?v=late');await page.evaluate(value=>window.__youtube={info:value,hold:true},info);await page.getByRole('button',{name:'查找英语字幕'}).click();await close();await open();await page.evaluate(()=>window.__releaseYouTube());await page.waitForTimeout(80);await page.locator('.lc-import-sources').waitFor();eq(await page.locator('.lc-import-tracks').count(),0,'late query never revives its closed source');await close();
  // Explicit clipboard action: one native read and one lookup, no import before confirmation.
  await page.evaluate(info=>{window.__clipboardText='https://youtu.be/abcdefghijk';window.__youtube={info};},info);
  const clipBefore=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length);
  const listBefore=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length);
  await open();await page.getByRole('button',{name:'粘贴链接',exact:true}).evaluate(n=>{n.click();n.click();});await page.locator('.lc-import-tracks').waitFor();
  eq(await page.getByLabel('链接',{exact:true}).inputValue(),'https://youtu.be/abcdefghijk','clipboard link is used automatically');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length),clipBefore+1,'double paste reads once');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length),listBefore+1,'valid clipboard starts one lookup');
  await close();
  for(const [text,fail,message]of [['https://example.org/private',false,'暂不支持此链接。'],[null,false,'剪贴板里没有链接，请输入。'],[null,true,'无法读取剪贴板，请粘贴链接。']]){
   await page.evaluate(({text,fail})=>{window.__clipboardText=text;window.__clipboardFail=fail;},{text,fail});
   const before=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length);
   await open();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByText(message,{exact:true}).waitFor();
   eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length),before,'invalid or unavailable clipboard stays local');
   ok(await page.getByLabel('链接',{exact:true}).isVisible(),'manual fallback remains available');await close();
  }
  await page.evaluate(()=>{window.__clipboardFail=false;window.__clipboardHold=true;window.__clipboardText='https://youtu.be/abcdefghijk';});
  await open();await page.getByRole('button',{name:'粘贴链接',exact:true}).click();await page.getByRole('button',{name:'读取中…',exact:true}).waitFor();await contrast(page.getByRole('button',{name:'读取中…',exact:true}),`${theme} clipboard disabled`);
  await close();await open();await page.evaluate(()=>{window.__clipboardHold=false;window.__releaseClipboard();});await page.waitForTimeout(70);
  eq(await page.locator('.lc-import-sources').count(),1,'late clipboard result cannot replace a reopened entry');await close();
  // Plain-text source, sentence translation, retry and cancel share the same preview boundary.
  await drop([['book.txt','Dr. Smith bought a book. She read it yesterday.']]);await preview();
  eq(await page.locator('.lc-import-excerpts [lang=en]').allTextContents(),['Dr. Smith bought a book.','She read it yesterday.'],'TXT is split into sentences');
  eq(await page.locator('.lc-import-excerpts [lang=zh]').allTextContents(),['测试译文 1。','测试译文 2。'],'translations appear directly under each sentence');
  await confirm();await page.waitForURL(/\/files\/\d+$/);eq((await call('test_counts')).files,7,'TXT commits through real SQLite');await page.locator('.reading-word').first().waitFor();
  await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');window.__importTrace=[];useImportStore.subscribe(s=>window.__importTrace.push({open:s.open,phase:s.phase,running:s.running,items:s.items.map(i=>({name:i.name,stage:i.stage,error:i.error}))}));window.__translationFail=true;});await drop([['failure.txt','The source survives a translation failure.']]);
  await page.getByRole('button',{name:'保留已获取内容，继续预览'}).waitFor();
  const requests=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length);
  await page.evaluate(()=>window.__translationFail=false);await page.getByRole('button',{name:'重试未完成项'}).click();await preview();
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),requests+1,'translation retry succeeds');await close();
  await page.evaluate(()=>window.__translationHold=true);await drop([['cancel.txt','A cancelled translation must not reopen.']]);await page.getByText('逐句补充中文翻译',{exact:true}).waitFor();
  await contrast(page.locator('.lc-import-loading-copy small'),`${theme} translation status`);await page.screenshot({path:`${output}/${theme}-translating.png`});await close();
  await page.evaluate(()=>{window.__translationHold=false;window.__releaseTranslation();});
  await page.waitForTimeout(80);eq(await page.locator('.lc-import-modal').count(),0,'cancel discards late translation');
  ok(await page.evaluate(()=>window.__uiCalls.some(c=>c.command==='cancel_import_translation')),'cancel reaches native translation');
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
 eq(errors,[],'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({checks,themes:['ocean','midnight'],contrasts,errors,nativeBoundary:'simulated OS picker/drop IPC and YouTube network; real SRT Worker, Rust transactions and temporary SQLite'},null,2));console.log(`Import UI: ${checks} checks passed. Evidence: ${output}`);
}catch(error){if(page){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');const s=useImportStore.getState();return {text:document.body.innerText,calls:window.__uiCalls,trace:window.__importTrace,state:{open:s.open,phase:s.phase,running:s.running,items:s.items.map(i=>({name:i.name,stage:i.stage,error:i.error}))}};}),null,2)).catch(()=>{});}throw error;}finally{await h.dispose();}
