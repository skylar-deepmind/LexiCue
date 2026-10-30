import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_CLIPBOARD_UI_OUTPUT||'/tmp/lexicue-clipboard-content-ui';await mkdir(output,{recursive:true});
const h=await createReadingHarness(output),{browser,url,call,fixture}=h;
const report={scope:'Chromium UI + real Worker and Rust SQLite; clipboard, public fetch and OS dialogs controlled',checks:[],contrasts:[],errors:[]};
let page,theme;const ok=(name,v)=>{report.checks.push({theme,name,pass:!!v});assert.ok(v,name);};
const state=()=>page.evaluate(async()=>{const {useImportStore:s}=await window.__uiStoreModule('importStore');const x=s.getState();return {phase:x.phase,items:x.items.map(i=>({id:i.id,error:i.error,draft:i.draft,result:i.result,stage:i.stage}))};});
const wait=async()=>{for(let i=0;i<650;i++){const s=await state();if(s.phase==='preview')return;await page.waitForTimeout(100);}throw Error('preview timeout');};
async function show(text){await page.evaluate(async text=>{window.__clipText=text;const {useImportStore:s}=await window.__uiStoreModule('importStore');s.getState().changeSource();},text);await page.getByRole('button',{name:'粘贴内容',exact:true}).click();}
async function learn(kind){
 await page.locator('.reading-word').filter({hasText:/^We$/}).first().click();
 await page.locator('.context-panel').waitFor();
 ok(kind+' lookup opens current sentence',(await page.locator('.lookup-context p[lang=en]').innerText()).includes('We do not'));
 await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();
 const contexts=await call('saved_recall_contexts',{expression:'We',offset:0,limit:100});
 ok(kind+' saved context retains accurate origin',contexts.records.some(r=>r.source?.document?.origin?.kind===kind&&r.sentence.includes('We do not')));
 await page.reload();await page.locator('.reading-paper[data-recall-state="ready"]').waitFor();
 const recalled=page.locator('.reading-word--recalled').filter({hasText:/^We$/}).first();await recalled.waitFor();ok(kind+' re-encounter marked after reopen',true);
 await recalled.click();await page.locator('.soft-refresh-current .recall-history > summary').click();
 ok(kind+' previous context available',(await page.locator('.soft-refresh-current .recall-context').count())>0);
 await page.screenshot({path:`${output}/${theme}-${kind}-recall.png`});
 await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});
}
let body='We do not give up (even after 42 attempts).\n我们不会放弃。\n\nWe read https://example.com and keep this sentence.';
try{for(theme of ['ocean','midnight']){
 body=body+`\n\nThis is the ${theme} test.`;
 page=await browser.newPage({viewport:{width:1200,height:850}});await fixture(page,theme);
 await page.addInitScript(()=>{window.isTauri=true;const original=window.__TAURI_INTERNALS__.invoke;window.__clipReads=0;window.__webRequests=0;window.__clipText='';window.__nativeBackup='';window.__TAURI_INTERNALS__.invoke=async(c,a={})=>{
 if(c==='plugin:clipboard-manager|read_text'){window.__clipReads++;if(window.__clipFail)throw Error('denied');if(window.__clipDelay)await new Promise(r=>setTimeout(r,500));return window.__clipText;}
 if(c==='fetch_import_webpage'){window.__webRequests++;if(window.__webDelay)await new Promise(r=>setTimeout(r,600));if(a.url.includes('failure'))throw Error('material_web_network');return {bytes_base64:btoa('<html lang="en"><head><title>Public article</title></head><body><article><h1>Public article</h1>'+('<p>We do not remove these words (including 42 numbers). This is a real paragraph about the world and how we read it. The text has details for the reader to understand and remember.</p>'.repeat(6))+'</article></body></html>'),submitted_url:a.url,final_url:a.url,content_type:'text/html',fetched_at:1793350000000};}
 if(c==='cancel_import_webpage'){window.__cancelledWeb=true;return;}
 if(c==='plugin:fs|write_text_file'){window.__nativeBackup=new TextDecoder().decode(a instanceof Uint8Array ? a : a.contents??a.data??[]);return;}
 if(c==='plugin:dialog|open'&&window.__restore)return '/fixture/export.json';
 if(c==='plugin:fs|read_text_file'&&window.__restore)return Array.from(new TextEncoder().encode(window.__nativeBackup));
 return original(c,a);};});
 await page.goto(url+'/files');await page.locator('.materials-paper').waitFor();ok('no background clipboard read',await page.evaluate(()=>window.__clipReads===0));
 for(const text of ['https://example.com\n中文说明','https://example.com\n42','Note:','apple:苹果','word:definition']){
  await show(text);await wait();const item=(await state()).items[0];
  ok('mixed/colon text exact: '+JSON.stringify(text),item.draft?.content===text&&item.draft.document.origin.kind==='clipboard');
  ok('mixed/colon text never fetches: '+JSON.stringify(text),await page.evaluate(()=>window.__webRequests===0));
 }
 await show(body);await wait();let s=await state();ok('text ready',!!s.items[0].draft);ok('original body unchanged',s.items[0].draft.content===body);ok('embedded link does not fetch',await page.evaluate(()=>window.__webRequests===0));
 await page.locator('.lc-content-title input').fill('My clipboard lesson');ok('title editable', (await state()).items[0].draft.name==='My clipboard lesson');
 for(const width of [1200,800,375]){await page.setViewportSize({width,height:850});await page.waitForTimeout(350);ok(width+' one modal',await page.locator('.lc-import-modal').count()===1);const footer=await page.locator('.lc-import-footer').boundingBox();ok(width+' primary action visible',footer.y>=0&&footer.y+footer.height<=850);await page.screenshot({path:`${output}/${theme}-${width}-preview.png`});ok(width+' no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1200,height:850});
 const contrast=async(locator,label)=>{const ratio=await locator.evaluate(n=>{const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);let p=n,bg;do{bg=rgb(getComputedStyle(p).backgroundColor);p=p.parentElement;}while(p&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(n).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});report.contrasts.push({theme,label,ratio});ok(label+' readable',ratio>=4.5);};
 const confirm=page.locator('.lc-import-footer .lc-import-primary');await contrast(confirm,'default');await confirm.hover();await contrast(confirm,'hover');await confirm.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');ok('visible keyboard focus',await confirm.evaluate(n=>getComputedStyle(n).outlineStyle==='solid'));await page.locator('.lc-content-title input').selectText();await contrast(page.locator('.lc-content-title input'),'selected input');await contrast(page.locator('.lc-document-pagination button').first(),'disabled');
 const draft=(await state()).items[0].draft;await confirm.click();await page.locator('.reading-word').first().waitFor();let all=await call('export_all');let savedFile=all.data.files.find(f=>f.document_identity===draft.document.identity);ok('UI confirmation stores exact body',savedFile.content===body);ok('origin not a pretend file',JSON.parse(savedFile.document_source).origin.kind==='clipboard');
 const reopened=await call('open_reading_material',{fileId:savedFile.id});ok('reopen matches preview',JSON.stringify(reopened.segments.map(s=>s.en_text))===JSON.stringify(draft.segments.map(s=>s.en_text)));
 await learn('clipboard');
 await show(body);await wait();await page.locator('.lc-import-footer .lc-import-primary').click();await page.getByRole('button',{name:'查看已有材料',exact:true}).waitFor();ok('duplicate offers open existing',true);
 await show('https://example.com/article/'+theme);await wait();ok('web ready',(await state()).items[0].draft.document.origin.kind==='webpage');await page.screenshot({path:`${output}/${theme}-web-preview.png`});await page.locator('.lc-import-footer .lc-import-primary').click();await page.locator('.reading-word').first().waitFor();await learn('webpage');
 await show('https://example.com/failure');await wait();ok('network failure retained',(await state()).items[0].error==='web_network');await page.getByRole('button',{name:'粘贴正文',exact:true}).waitFor();await page.screenshot({path:`${output}/${theme}-web-failure.png`});
 await page.evaluate(()=>window.__clipText='apple');await page.getByRole('button',{name:'粘贴正文',exact:true}).click();await wait();ok('failed web can paste a word',(await state()).items[0].draft.content==='apple');
 await page.evaluate(()=>window.__webDelay=true);await show('https://example.com/late');await page.getByRole('button',{name:'取消',exact:true}).click();await show('New content wins.');await wait();await page.waitForTimeout(700);ok('late network cannot replace new preview',(await state()).items[0].draft.content==='New content wins.');await page.evaluate(()=>window.__webDelay=false);
 await show('https://example.com\nhttps://other.example');await page.getByRole('alert').filter({hasText:'请复制一条链接'}).waitFor();ok('multiple links rejected',true);
 await page.evaluate(()=>window.__clipFail=true);await show('ignored');await page.locator('#lc-manual-content').fill('Manual paste works.');await page.getByRole('button',{name:'预览内容',exact:true}).click();await wait();ok('manual fallback works',(await state()).items[0].draft.content==='Manual paste works.');await page.evaluate(()=>window.__clipFail=false);
 await show('');await page.getByRole('alert').filter({hasText:'未读到文字'}).waitFor();ok('empty clipboard explained',true);
 // Full system-dialog export/restore is verified separately in native QA.
 await page.close();
}}catch(e){report.errors.push(String(e));if(page)await page.screenshot({path:output+'/failure.png'});throw e;}finally{await writeFile(output+'/report.json',JSON.stringify(report,null,2));await h.dispose();}
