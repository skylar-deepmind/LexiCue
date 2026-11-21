/** Import UI: real document/SRT Workers + Rust commands + disposable SQLite.
 * File pickers/drag IPC are controlled at the native boundary.
 * Physical OS picker/drop are verified separately, never claimed by this harness. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {strToU8, zipSync} from 'fflate';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_IMPORT_UI_OUTPUT||'/tmp/lexicue-ui-import';
const h=await createReadingHarness(output, ['upload_local_material_audio', 'import_material_with_local_audio', 'discard_local_material_audio', 'source_media_status', 'resolve_source_media']),{browser,url,call,fixture,errors}=h;
let page,checks=0;const contrasts=[];
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const documentFixtures=new URL('../src/lib/__tests__/fixtures/document-body/',import.meta.url);
const bodies=JSON.parse(await readFile(new URL('expected.json',documentFixtures),'utf8'));
const originals=Object.fromEntries(await Promise.all(Object.keys(bodies).map(async name=>[
  name, [...await readFile(new URL(name,documentFixtures))],
])));
const draft=()=>page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0]?.draft;});
const flight=await readFile(`${root}/docs/implementation/fixtures/v31-reading.srt`,'utf8');
const srt=(text,zh='')=>`1\n00:00:01,000 --> 00:00:03,000\n${text}${zh?'\n'+zh:''}\n`;
const writes=()=>page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='import_reading_material'));
const drop=files=>page.evaluate(files=>{const dataTransfer=new DataTransfer();for(const[name,text]of files)dataTransfer.items.add(new File([Array.isArray(text) ? Uint8Array.from(text) : text],name));window.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));},files);
const preview=async()=>{await page.locator('.approved-import-preview[data-ready=true]').waitFor();};
const full=async()=>{await page.locator('.import-card-cover').click();await page.locator('.import-document-sheet').waitFor();};
const closeFull=async()=>{await page.locator('.import-document-sheet').getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.import-document-sheet').waitFor({state:'detached'});};
const landed=async()=>{await page.locator('.lc-import-modal,.clipboard-scene').waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('.import-insertion-flight'));await page.locator('.approved-card[data-desk-active=true]').waitFor();};
const itemStages=()=>page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items.map(i=>i.stage);});
const settle=()=>page.locator('.lc-import-modal').evaluate(node=>Promise.all(node.getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
const close=async()=>{if(await page.locator('.import-document-sheet').count())await closeFull();if(await page.locator('.lc-import-modal,.clipboard-scene').count()){await page.keyboard.press('Escape');await page.locator('.lc-import-modal,.clipboard-scene').waitFor({state:'detached'});}};
const open=async()=>{
 if(new URL(page.url()).pathname!=='/files'){await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();}
 if(await page.locator('.approved-tag-panel').count()){await page.keyboard.press('Escape');await page.locator('.approved-tag-panel').waitFor({state:'detached'});}
};
const showChooser=async()=>{await open();await page.locator('.home-import-action').click();await page.locator('.lc-import-modal--compact').waitFor();};
const confirm=async()=>{const batch=page.locator('.import-card-batch-confirm');if(await batch.count())return batch.click();await page.locator('.import-edge-label').click();await page.locator('.import-card-stage [data-choice][aria-pressed=true]').click();};
async function contrast(locator,label){const value=await locator.evaluate(async node=>{
 // Measure the requested interaction state after its finite color transition.
 await Promise.all(node.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
 const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
 let p=node,bg;do{bg=rgb(getComputedStyle(p).backgroundColor);p=p.parentElement;}while(p&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
});contrasts.push({label,ratio:value});ok(value>=4.5,`${label}: ${value.toFixed(2)}:1`);}
const pack = zipSync({
  'lesson.en.srt': strToU8('1\n00:00:00,000 --> 00:00:01,000\nWe watched\n\n2\n00:00:01,000 --> 00:00:02,000\nthe whole story.\n'),
  'lesson.mp4': await readFile(`${root}/src-tauri/src/commands/test_data/local-import-aac.mp4`),
  'lesson.png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAA7klEQVR4nLXChVUCAABF0T+IiWABKnaggoE1gd0iKCrdnXZ3juoU756rumU/WvUrAbQaVoNoNa6F0GpaD6PVvBFBy7AZRatlK4aWcTuOlmkngVbrbhKttr0UWu37abQ6DjJodbqzaJkPc2hZPHm0rN4CWl1HRbS6j0to9fjKaNlOKmj1nlbR6jurodXvP0drIHCB1mDwEq2h0BVaw+FrtEYiN2iNRm/RGovdoWWP36M1nnhAayL5iNZk6gktR/oZLWfmBa2p7Cta07k3tGby72jNFj7QchU/0ZorfaE1X/5Ga6Hyg9Zi9Retpdof+h+hwAtq+KEfQAAAAABJRU5ErkJggg==', 'base64'),
});


try{
 for(const theme of ['sage','midnight']){
  await call('test_reset');const context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);
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
    const value=await base(command,args);
    if(command==='import_reading_material'&&window.__holdWrite){window.__holdWrite=false;await new Promise(done=>window.__releaseWrite=done);}
    return value;
   };
  });
  await page.goto(`${url}/files`);await page.locator('.approved-desk').waitFor();
  await showChooser();
  await page.getByRole('button',{name:'选择文件',exact:true}).click();
  await page.getByRole('button',{name:'选择文件',exact:true}).waitFor();
  eq(await page.locator('#root').evaluate(n=>n.inert),true,'cancelled picker returns to the source chooser');
  eq(await page.locator('.lc-import-sources button').count(),2,'files and clipboard share one source chooser');
  const chooseFiles=page.locator('.lc-import-sources').getByRole('button',{name:'选择文件',exact:true});
  const readClipboard=page.locator('.lc-import-sources').getByRole('button',{name:'读取剪贴板',exact:true});
  await contrast(chooseFiles,theme+' choose files');
  await readClipboard.hover();await contrast(readClipboard,theme+' clipboard hover');
  await chooseFiles.focus();await page.keyboard.press('Tab');
  ok(await readClipboard.evaluate(button=>document.activeElement===button&&button.matches(':focus-visible')),'keyboard reaches clipboard with visible focus');
  await page.screenshot({path:`${output}/${theme}-import-chooser.png`});

  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length),0,'file entry never reads clipboard');
  await page.evaluate(text=>window.__uiFiles={'/fixture/真实英语.srt':text},flight);await page.getByRole('button',{name:'选择文件',exact:true}).click();await preview();await settle();
  eq(await page.locator('#root').evaluate(n=>n.inert),true,'prepared-content modal owns focus');eq(await page.locator('.context-panel').count(),0,'import does not use context panel');eq(await page.locator('.b-shell').getAttribute('data-context-open'),'false','import never shifts reading workspace');
  await page.locator('.import-edge-label').focus();await page.keyboard.press('Tab');ok(await page.locator('.lc-import-modal').evaluate(n=>n.contains(document.activeElement)),'prepared-content dialog retains keyboard ownership');
  eq((await writes()).length,0,'native picker boundary has zero writes before confirmation');eq((await call('test_counts')).files,0,'no material before confirmation');
  await full();ok((await page.locator('.lc-document-preview').innerText()).includes('take off'),'real English excerpt');eq((await page.locator('.lc-document-preview').innerText()).split('飞机很快就要起飞了。').length-1,1,'existing Chinese appears once in the original source block');ok((await page.locator('.lc-document-preview').innerText()).includes('Curiosity helps us make sense of new ideas.'),'full local preview includes the final cue, beyond the former three-sentence excerpt');
  await closeFull();await contrast(page.locator('.import-edge-label'),theme+' label');await page.locator('.import-edge-label').hover();await contrast(page.locator('.import-edge-label'),theme+' label hover');
  const add=async()=>{
    await page.locator('.import-edge-label').click();
    const rail=page.locator('.import-card-stage .draw-rail');
    await rail.hover();await page.keyboard.down('Shift');await page.mouse.wheel(0,30000);await page.keyboard.up('Shift');
    await page.waitForFunction(()=>{const r=document.querySelector('.import-card-stage .draw-rail');return r.scrollLeft+r.clientWidth>=r.scrollWidth-2;});
    const outline=rail.locator('[data-add]'),a=await outline.boundingBox(),r=await rail.boundingBox();
    assert.ok(a.x>=r.x-1 && a.x+a.width<=r.x+r.width+1,'new label remains visible at the right scroll limit');
    await outline.click();
  };
  const tagName=page.locator('.write-name input');
  // A cancelled picker preserves the already prepared content.
  const beforeDraft=await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;});
  await page.evaluate(async()=>{window.__uiFiles={};const{useImportStore}=await window.__uiStoreModule('importStore');await useImportStore.getState().choose();});await preview();
  eq(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;}),beforeDraft,'cancelled picker retains preview');
  await add();await tagName.fill('  Coast notes  ');eq((await call('list_tags')).length,0,'typing creates no tag');await page.screenshot({path:`${output}/${theme}-preview.png`});await page.locator('.write-name button').evaluate(n=>{n.click();n.click();});await landed();
  eq((await writes()).length,1,'double confirmation invokes write once');eq((await writes())[0].args.input.content,beforeDraft.content,'submitted normalized content exactly matches frozen preview');eq((await writes())[0].args.input.segments,beforeDraft.segments,'submitted sentences exactly match frozen preview');eq((await writes())[0].args.input.document.source_sha256,createHash('sha256').update(flight).digest('hex'),'original file byte identity retained separately');eq((await writes())[0].args.input.document.original_format,'srt','original format retained despite normalized storage');eq((await call('test_counts')).files,1,'one material committed');
  eq((await writes())[0].args.input.new_tag_names,['Coast notes'],'material and new tag share the import transaction');
  const newMaterial=(await call('list_materials',{tagIds:[],untagged:false}))[0];
  eq(newMaterial.tags.map(tag=>tag.name),['Coast notes'],'committed tag is attached to the imported material');
  eq(await page.getByRole('button',{name:'新建标签',exact:true}).count(),0,'the normal desk has no create tag button');
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
  await page.locator('.approved-card[data-desk-active=true] .approved-card-open').click();await page.locator('.reading-word').first().waitFor();const readingBounds=await page.locator('.reading-original').first().boundingBox();eq(await page.locator('.reading-page').getByRole('button',{name:'导入',exact:true}).count(),0,'reading content has no import button');await page.evaluate(async()=>{window.dispatchEvent(new CustomEvent('lexicue-import-content',{detail:null}));const {useImportStore}=await window.__uiStoreModule('importStore');useImportStore.getState().show();});await settle();eq(await page.locator('.reading-original').first().boundingBox(),readingBounds,'reader dimensions unchanged while manual clipboard recovery is open');await close();
  await drop([['duplicate.srt',flight],['empty.srt',''],['second.srt',srt('A second material is ready.','第二份材料已经准备好了。')]]);await preview();
  eq((await writes()).length,1,'browser drop prepares without writing');eq((await call('test_counts')).files,1,'browser drop does not mutate database');
  await page.locator('.import-card-pager button').last().click();ok((await page.locator('.approved-import-preview').innerText()).includes('A second material is ready.'),'each valid file has its own real preview');
  await contrast(page.locator('.import-edge-label'),`${theme} batch tag`);
  await settle();await page.screenshot({path:`${output}/${theme}-batch-preview.png`});await confirm();await page.getByRole('button',{name:'查看已有材料',exact:true}).waitFor();
  ok(!(await page.locator('.lc-import-modal').evaluate(n=>!!n.closest('[inert]'))),'batch results retain keyboard ownership');
  eq(await itemStages(),['duplicate','failed','created'],'partial results isolated');eq((await call('test_counts')).files,2,'only valid new content is created');await close();
  // Lost receipt after real COMMIT: same exact operation and content on retry.
  await drop([['lost.srt',srt('A lost receipt can be safely recovered.')]]);await preview();await page.evaluate(()=>window.__uiFailure={command:'import_reading_material',remaining:1,afterCommit:true});await confirm();await page.getByRole('alert').filter({visible:true}).waitFor();
  const lost=(await writes()).at(-1);eq((await call('test_counts')).files,3,'lost receipt really committed');await page.getByRole('button',{name:'重试未完成项'}).click();await landed();eq((await writes()).at(-1),lost,'retry resends exact operation payload');eq((await call('test_counts')).files,3,'idempotent retry has one result');
  // Native drag event adapter routes into the same prepare/preview state.
  await page.evaluate(text=>{window.__uiFiles={'/fixture/native-drag.srt':text};window.__nativeDrop(['/fixture/native-drag.srt']);},srt('Native paths share the same preview.'));await preview();eq((await call('test_counts')).files,3,'native event adapter does not commit');
  await add();await tagName.fill('Discarded tag');await tagName.press('Escape');await close();
  eq((await call('list_tags')).map(tag=>tag.name),['Coast notes'],'closing discards an uncommitted tag');

  // Closing a slow read cancels promptly, even when the OS finishes later.
  await page.evaluate(text=>{window.__holdRead=true;window.__uiFiles={'/fixture/slow.srt':text};window.__nativeDrop(['/fixture/slow.srt']);},srt('This late file must never be saved.'));await page.locator('.lc-import-loading-copy').waitFor();await close();
  await drop([['new.srt',srt('A newer source owns the preview.')]]);await preview();await page.evaluate(()=>{window.__holdRead=false;window.__releaseRead();});await page.waitForTimeout(80);ok((await page.locator('.approved-import-preview').innerText()).includes('A newer source owns'),'late source cannot overwrite new one');await close();eq((await call('test_counts')).files,3,'cancelled and discarded previews do not write');
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
  if(new URL(page.url()).pathname!=='/files')await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();await page.getByRole('button',{name:'导入处理中，打开进度',exact:true}).click();await page.getByRole('button',{name:'取消余下导入'}).click();await contrast(page.getByRole('button',{name:'取消余下导入'}),`${theme} disabled`);await page.evaluate(()=>window.__releaseWrite());await page.waitForFunction(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().phase==='result';});ok(!(await page.locator('.lc-import-modal').evaluate(n=>!!n.closest('[inert]'))),'batch results retain keyboard ownership');
  eq(await itemStages(),['created','cancelled'],'stop waits for actual receipt');await page.getByRole('button',{name:'重试未完成项'}).click();await landed();eq((await call('test_counts')).files,5,'retry remaining draft succeeds');await close();
  // Imported media uses the real ZIP worker and native decoder, even on a store build.
  await drop([['lesson.zip', Array.from(pack)]]); await preview();
  await page.getByText('已识别原音文件',{exact:true}).waitFor();
  eq((await call('test_counts')).files,5,'ZIP preview has no write side effect');
  await contrast(page.getByText('已识别原音文件',{exact:true}),`${theme} ZIP original audio status`);
  await page.waitForFunction(()=>{const img=document.querySelector('.import-card-cover img');return img?.src.startsWith('data:image/jpeg;base64,')&&img.naturalWidth>0;});
  ok(true,'same-name cover appears in preview');
  await page.screenshot({path:`${output}/${theme}-package-preview.png`});
  await confirm(); await landed();
  eq((await call('test_counts')).files,6,'ZIP imports one material through SQLite');
  const zipId=Number(await page.locator('.approved-card[data-desk-active=true]').getAttribute('data-motion-file'));
  const imported=await call('open_reading_material',{fileId:zipId});
  eq(imported.segments.map(s=>s.en_text),['We watched the whole story.'],'spanning caption is one complete sentence');
  const clip = await call('resolve_source_media',{target:{segment_id:imported.segments[0].id}});
  eq([clip.start_ms,clip.end_ms],[0,2000],'resolved local audio uses both cue timecodes');
  ok(clip.path.endsWith('.wav')&&clip.duration_ms>=2900,'converted original has an audio-only payload');
  ok(imported.material.document.cover.startsWith('data:image/jpeg;base64,'),'cover persisted with the document');
  const saved = await call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{
    segment_id:imported.segments[0].id,expression:'watched',start_offset:3,end_offset:10,
    explanation:'看过',explanation_source:'personal',
  }}});
  eq(saved.record.source.media.source.provider,'local','saved sentence retains aligned original audio');
  eq(saved.record.source.document.identity,imported.material.document.identity,'saved sentence retains source document');
  const backup = await call('export_all');
  const backedUp = backup.data.files.find(row=>row.id===zipId);
  ok(JSON.parse(backedUp.document_source).cover.startsWith('data:image/jpeg;base64,'),'portable backup retains the cover');
  await close();

  // Removing page controls must keep long previews complete and keyboard reachable.
  await drop([['long-preview.txt',Array.from({length:95},(_,i)=>`The notebook in preview paragraph ${i+1} is on the table.`).join('\n\n')]]);await preview();
  eq(await page.locator('.import-card-actions .lc-import-primary').count(),0,'tag selection is the commit gesture');await full();
  eq(await page.locator('.lc-document-pagination').count(),0,'preview uses scrolling without page controls');
  eq(await page.locator('.lc-import-preview-meta').count(),0,'no duplicate full-preview caption');
  let shown=await page.locator('.lc-document-preview [data-block]').count();eq(shown,30,'large preview starts with a bounded chunk');
  while(shown<95){await page.locator('.lc-document-preview').evaluate(n=>{n.scrollTop=n.scrollHeight;});await page.waitForFunction(count=>document.querySelectorAll('.lc-document-preview [data-block]').length>count,shown);shown=await page.locator('.lc-document-preview [data-block]').count();}
  ok((await page.locator('.lc-document-preview').innerText()).includes('paragraph 95'),'scroll reaches final original paragraph');
  await page.locator('.lc-document-preview').focus();ok(await page.locator('.lc-document-preview').evaluate(n=>n===document.activeElement),'preview retains keyboard access');await close();
  await page.evaluate(()=>{window.__clipboardText='https://youtu.be/abcdefghijk';});
  const clipBefore=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length);
  await showChooser();await page.getByRole('button',{name:'读取剪贴板',exact:true}).evaluate(n=>{n.click();n.click();});
  await page.getByText('请导入本地字幕或素材 ZIP 来学习这段视频。',{exact:true}).waitFor();
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='plugin:clipboard-manager|read_text').length),clipBefore+1,'double paste reads once');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command.startsWith('youtube_')||c.command==='import_webpage').length),0,'video clipboard link does not make a retrieval request');
  await close();
  for(const [text,fail,message]of [['https://',false,'链接格式不完整，请修改或重新粘贴。'],[null,false,'未读到文字，请先复制英文或链接；图片或文件请使用选择文件。'],[null,true,'无法读取剪贴板，请在下方手动粘贴。']]){
   await page.evaluate(({text,fail})=>{window.__clipboardText=text;window.__clipboardFail=fail;},{text,fail});
   const before=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length);
   await showChooser();await page.getByRole('button',{name:'读取剪贴板',exact:true}).click();await page.getByText(message,{exact:true}).waitFor();
   eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='youtube_list_subs').length),before,'invalid or unavailable clipboard stays local');
   eq(await page.locator('.clipboard-scene').count(),0,'clipboard errors stay in the chooser');ok(await page.locator('.lc-import-modal [role=alert]').isVisible(),'clipboard error appears beside the import controls');await close();
  }
  await page.evaluate(()=>{window.__clipboardFail=false;window.__clipboardHold=true;window.__clipboardText='https://youtu.be/abcdefghijk';});
  await showChooser();await page.getByRole('button',{name:'读取剪贴板',exact:true}).click();await page.locator('.lc-import-sources [aria-busy=true]').waitFor();ok(await page.locator('.lc-import-sources [aria-busy=true]').isDisabled(),'pending clipboard action cannot be submitted twice');
  await close();await page.evaluate(()=>{window.__clipboardHold=false;window.__releaseClipboard();});await page.waitForTimeout(70);
  eq(await page.locator('.lc-import-modal').count(),0,'late clipboard result cannot replace a departed home entry');
  // Import finishes the entire translation before the frozen preview is ready.
  const translationRequestsBeforeLocal=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length);
  await drop([['book.txt','Dr. Smith bought a book. She read it yesterday.']]);await preview();
  const bookDraft=await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');return useImportStore.getState().items[0].draft;});
  eq(bookDraft.segments.map(s=>s.en_text),['Dr. Smith bought a book.','She read it yesterday.'],'TXT retains the English sentences');
  eq(bookDraft.segments.map(s=>s.zh_text),['测试译文 1。','测试译文 2。'],'local preparation completes translation');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),translationRequestsBeforeLocal+1,'local import translates before preview');
  await confirm();await landed();eq((await call('test_counts')).files,7,'TXT commits through real SQLite');
  const bookId=Number(await page.locator('.approved-card[data-desk-active=true]').getAttribute('data-motion-file'));
  await page.evaluate(()=>window.__translationFail=true);await drop([['failure.txt','The source survives a translation failure.']]);
  await page.getByRole('button',{name:'保留已获取内容，继续预览'}).waitFor();await page.getByRole('button',{name:'保留已获取内容，继续预览'}).click();await preview();await close();
  // Existing untranslated materials require explicit full-material confirmation.
  for(const segment of (await call('open_reading_material',{fileId:bookId})).segments)await call('test_edit_segment',{segmentId:segment.id,zhText:null});
  await page.goto(`${url}/files/${bookId}`);await page.locator('.reading-word').first().waitFor();
  const translationToggle=()=>page.locator('.mobile-reading-tools button[aria-label="显示中文译文"]');
  const callsBeforePrompt=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length);
  await translationToggle().click();await page.locator('.translation-dialog').waitFor();
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='translate_import_sentences').length),callsBeforePrompt,'opening confirmation makes no translation request');
  await page.locator('.translation-dialog').getByRole('button',{name:'取消',exact:true}).click();
  await translationToggle().click();await page.locator('.translation-dialog').waitFor();await page.evaluate(()=>window.__translationFail=true);
  await page.locator('.translation-dialog').getByRole('button',{name:'开始翻译',exact:true}).click();await page.getByText('译文暂时无法生成，请重试。英文阅读与保存不受影响。',{exact:true}).waitFor();
  ok(await page.locator('.reading-original').first().isVisible(),'reading stays available after translation error');
  await page.evaluate(()=>window.__translationFail=false);await page.locator('.reading-translation-status').getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.reading-translation').length===2);
  const translated=await call('open_reading_material',{fileId:bookId});eq(translated.segments.map(s=>s.zh_text),['测试译文 1。','测试译文 2。'],'full reading translation persists through real writeback');
  for(const segment of translated.segments)await call('test_edit_segment',{segmentId:segment.id,zhText:null});
  await page.goto(`${url}/files/${bookId}`);await page.locator('.reading-word').first().waitFor();
  await page.evaluate(()=>{window.__translationHold=true;window.__releaseTranslation=undefined;});await translationToggle().click();await page.locator('.translation-dialog').getByRole('button',{name:'开始翻译',exact:true}).click();await page.waitForFunction(()=>typeof window.__releaseTranslation==='function');
  await contrast(page.locator('.reading-translation-status span'),`${theme} translation status`);await page.screenshot({path:`${output}/${theme}-translating.png`});
  const fillsBeforeCancel=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='fill_reading_translations').length);
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();await page.evaluate(()=>{window.__translationHold=false;window.__releaseTranslation();});
  await page.waitForTimeout(80);eq(await page.locator('.reading-page:not(.page-ghost *),.lc-import-modal').count(),0,'late translation cannot reopen a departed material');
  ok(await page.evaluate(()=>window.__uiCalls.some(c=>c.command==='cancel_import_translation')),'navigation cancels full translation');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='fill_reading_translations').length),fillsBeforeCancel,'cancelled late translation cannot write back');
  eq((await call('open_reading_material',{fileId:bookId})).segments.map(s=>s.zh_text),[null,null],'cancelled results do not change stored source');
  // Responsive, zoom, reduced motion and an IME-sized viewport.
  const broken = zipSync({'broken.srt':strToU8(srt('This subtitle remains readable.')), 'broken.mp4':strToU8('invalid audio')});
  await drop([['broken.zip',Array.from(broken)]]);await preview();
  const beforeBroken=(await call('test_counts')).files;
  await confirm();await page.getByText('无法读取原音，或原音与字幕时间不匹配。',{exact:true}).waitFor();
  eq((await call('test_counts')).files,beforeBroken,'audio error leaves the batch unwritten');
  await page.getByRole('button',{name:'仅导入正文和封面',exact:true}).click();
  await landed();eq((await call('test_counts')).files,beforeBroken+1,'the user can recover with text-only learning');
  const fallbackId=Number(await page.locator('.approved-card[data-desk-active=true]').getAttribute('data-motion-file'));
  const fallback=await call('open_reading_material',{fileId:fallbackId});
  eq(fallback.media_refs,{},'text-only fallback uses synthesis');
  await drop([['responsive.srt',flight]]);await preview();
  for(const [width,height,scale]of [[375,812,1],[320,568,1],[390,320,1],[768,420,1],[390,844,2]]){
   await page.setViewportSize({width,height});await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale*100}%`,scale);await settle();await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page horizontal overflow');
   ok(await page.locator('.lc-import-modal').evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),'dialog inside viewport');
   ok(await page.locator('.import-edge-label').evaluate(n=>{const r=n.getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0;}),'confirmation reachable at zoom and keyboard height');
   ok(await page.locator('.import-card-stage').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'body has no horizontal overflow');
   await page.screenshot({path:`${output}/${theme}-${width}x${height}-${scale}x.png`});
  }
  await close();
  for(const [name,expected] of Object.entries(bodies)){
    await drop([[name,originals[name]]]);
    if(expected.error){
      await page.locator('.lc-import-modal [role=alert]').waitFor();
      eq(await itemStages(),['failed'],theme+' image-only PDF does not generate an empty preview');
    }else{
      await preview();
      eq((await draft()).content,expected.content,theme+' app Worker extracts '+name);
      if(name==='harbor-two-pages.pdf'){
        await confirm();await landed();
        const saved=await call('export_all');
        ok(saved.data.files.some(file=>file.content===expected.content),theme+' cross-page PDF body survives SQLite import');
      }
    }
    await close();
  }
  await page.evaluate(()=>document.documentElement.style.fontSize='100%');await page.setViewportSize({width:1440,height:900});await close();await page.emulateMedia({reducedMotion:'reduce'});await showChooser();await page.getByRole('button',{name:'选择文件',exact:true}).click();await page.locator('.lc-import-modal--compact').waitFor();await close();
  await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');void useImportStore.getState().start([{name:'reduced.srt',read:()=>new Promise(done=>window.__reducedRead=done)}]);});await page.locator('.lc-import-paper-character').waitFor();eq(await page.locator('.lc-import-paper-character').evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion paper');await close();await page.evaluate(()=>window.__reducedRead(''));await context.close();
 }
 // The native OS hands us file URLs on iOS and permission-bearing content
 // URIs on Android. Simulate both delivery boundaries with the real Worker's bytes.
 for(const platform of ['ios','android']){
  const ios=platform==='ios';
  const platformContext=await browser.newContext({
   viewport:{width:375,height:812},isMobile:true,hasTouch:true,
   userAgent:ios?'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36',
  });
  page=await platformContext.newPage();await fixture(page,ios?'midnight':'sage');await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(({ios,files})=>{
   window.isTauri=true;
   const names=Object.keys(files);
   const paths=names.map(name=>ios?`file:///fixture/${name}`:`content://fixtures/documents/${name}`);
   for(const [index,name] of names.entries())window.__uiFiles[paths[index]]=files[name];
   const queue=[paths[0]];
   const take=()=>queue.splice(0);
   const callbacks=new Map(), listeners=new Map();
   let next=200;
   const base=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.transformCallback=callback=>{const id=++next;callbacks.set(id,callback);return id;};
   window.__TAURI_INTERNALS__.invoke=(command,args={})=>{
    if(command==='take_opened_documents')return Promise.resolve(take());
    if(command==='plugin:event|listen'){const id=++next;listeners.set(id,args);return Promise.resolve(id);}
    if(command==='plugin:event|unlisten'){listeners.delete(args.eventId);return Promise.resolve();}
    return base(command,args);
   };
   if(!ios)window.LexiCueSystemUi={
    setDarkTheme(){},
    takeOpenedDocuments:()=>JSON.stringify(take()),
    documentDisplayName:uri=>names[paths.indexOf(uri)],
   };
   window.__openSecondDocument=()=>{
    queue.push(paths[1]);
    const event='lexicue-open-documents';
    if(ios){for(const listener of listeners.values())if(listener.event===event)callbacks.get(listener.handler)?.({event});}
    else window.dispatchEvent(new Event(event));
   };
  },{ios,files:{'station.txt':originals['station.txt'],'morning-cues.srt':originals['morning-cues.srt']}});
  await page.goto(`${url}/files`);await preview();
  eq((await draft()).content,bodies['station.txt'].content,platform+' cold file open reaches preview');
  await page.evaluate(()=>window.__openSecondDocument());
  eq((await draft()).content,bodies['station.txt'].content,platform+' warm open keeps existing draft');
  await page.keyboard.press('Escape');
  await page.locator('.import-material-card').getByText('morning-cues',{exact:true}).waitFor();
  eq((await draft()).content,bodies['morning-cues.srt'].content,platform+' queues the new file and opens it after the first draft');
  await platformContext.close();
 }
 eq(errors,[],'no browser exceptions');await writeFile(`${output}/evidence.json`,JSON.stringify({checks,themes:['sage','midnight'],contrasts,errors,nativeBoundary:'simulated OS picker/drop/chunked FS IPC and translation-service responses; actual document/ZIP Workers, native video-to-audio conversion, Rust transactions, explicit reading translation writeback and temporary SQLite'},null,2));console.log(`Import UI: ${checks} checks passed. Evidence: ${output}`);
}catch(error){if(page){await page.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await page.evaluate(async()=>{const{useImportStore}=await window.__uiStoreModule('importStore');const s=useImportStore.getState();return {text:document.body.innerText,calls:window.__uiCalls,trace:window.__importTrace,state:{open:s.open,phase:s.phase,running:s.running,items:s.items.map(i=>({name:i.name,stage:i.stage,error:i.error}))}};}),null,2)).catch(()=>{});}throw error;}finally{await h.dispose();}
