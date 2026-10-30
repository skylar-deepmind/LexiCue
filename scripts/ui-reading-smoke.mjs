/** Reading regression runs actual Rust command cores and disposable SQLite. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
import {checkReadingInteractions} from './ui-reading-interactions.mjs';
const output=process.env.LEXICUE_READING_UI_OUTPUT||'/tmp/lexicue-ui-reading';
const harness=await createReadingHarness(output);
const {browser,url,call,fixture,errors}=harness;
let currentPage;let checks=0;const timings=[],visibleTimings=[];
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const srt=text=>`1\n00:00:01,000 --> 00:00:03,000\n${text}\n测试原句。\n`;
const flightSource=await readFile(`${root}/docs/implementation/fixtures/v31-reading.srt`,'utf8');
// Keep this reading regression local; import-translation has a separate suite.
const flight=flightSource.trim().split(/\n\s*\n/).map(block=>/[\u4e00-\u9fff]/.test(block)?block:`${block}\n测试原句。`).join('\n\n');
const close=async page=>{await page.keyboard.press('Escape');await page.locator('.context-panel,.lc-import-modal').waitFor({state:'detached'});};
const settle=page=>page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(a=>a.finished)));
const waitLibrary=page=>page.waitForFunction(()=>!document.querySelector('.material-status')&&document.querySelector('.materials-paper'));
const drop=async(page,files)=>page.evaluate(files=>{const transfer=new DataTransfer();for(const [name,text]of files)transfer.items.add(new File([text],name,{type:'application/x-subrip'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));},files);
async function contrast(locator){return locator.evaluate(node=>{
 const rgb=v=>v.match(/[\d.]+/g).map(Number);const lum=values=>values.slice(0,3).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
 let target=node,bg;do{bg=rgb(getComputedStyle(target).backgroundColor);target=target.parentElement;}while(target&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 });}
async function noOverflow(page,label){ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label);const card=page.locator('.context-panel');if(await card.count())ok(await card.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}),label+' card');}
try{
 for(const theme of ['ocean','midnight']){
  await call('test_reset');
  const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();currentPage=page;await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);
  // This reading regression deliberately checks unavailable online providers.
  // Keep the failure deterministic; other suites exercise actual provider cores.
  await page.addInitScript(()=>{const base=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{if(['lookup_cambridge_expression','lookup_free_dictionary_expression'].includes(command)){window.__uiCalls.push({command,args:structuredClone(args)});throw Error('controlled online provider unavailable');}return base(command,args);};});
  await page.goto(`${url}/files`);await waitLibrary(page);
  eq(await page.locator('.b-dock a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label'))),['材料','已保存','设置'],'icon dock retains accessible task names');
  eq(await page.locator('.learning-language-select,.coach-banner,.analysis-model-picker').count(),0,'retired learning controls');
  await page.getByRole('button',{name:'按标签筛选'}).click();
  await page.getByRole('button',{name:'管理标签',exact:true}).click();eq(await page.locator('#root').evaluate(node=>node.inert),true,'tag manager isolates background');
  await page.getByRole('button',{name:'新建标签',exact:true}).click();eq(await page.getByRole('dialog').count(),2,'nested tag prompt');
  eq(await page.evaluate(()=>window.__lexicueBack()),true,'system back closes top layer');await page.waitForFunction(()=>document.querySelectorAll('[role=dialog]').length===1);
  await page.getByRole('button',{name:'新建标签',exact:true}).click();const prompt=page.getByRole('dialog',{name:'新建标签',exact:true});
  await prompt.getByRole('textbox').fill('Keep this tag name');await page.evaluate(()=>window.__uiFailure={command:'create_tag',afterCommit:false,remaining:1});
  await prompt.getByRole('button',{name:'新建标签',exact:true}).click();await prompt.getByRole('alert').waitFor();eq(await prompt.getByRole('textbox').inputValue(),'Keep this tag name','failed tag create retains draft');
  await page.setViewportSize({width:390,height:320});ok(await prompt.getByRole('button',{name:'新建标签',exact:true}).evaluate(node=>node.getBoundingClientRect().bottom<=innerHeight),'short screen primary action reachable');await page.setViewportSize({width:1440,height:900});
  await prompt.getByRole('button',{name:'新建标签',exact:true}).click();await prompt.waitFor({state:'detached'});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});eq(await page.locator('#root').evaluate(node=>node.inert),false,'inert released');ok(await page.getByRole('button',{name:'管理标签',exact:true}).evaluate(node=>node===document.activeElement),'tag manager restores focus');
  await page.getByRole('button',{name:'导入',exact:true}).click();await page.locator('.lc-import-sources').waitFor();
  eq(await page.locator('.lc-import-modal select').count(),0,'no mandatory language form');
  await page.evaluate(content=>window.__uiFiles={'/fixture/flight.srt':content},flight);
  await page.getByRole('button',{name:'选择文件',exact:true}).click();await page.getByRole('button',{name:'确认导入（1）',exact:true}).click();await page.waitForURL(/\/files\/\d+/);await page.locator('.reading-word').first().waitFor();
  const fileId=Number(new URL(page.url()).pathname.split('/').at(-1));eq((await call('test_counts')).files,1,'single-file real write');
  ok((await page.locator('.b-path').innerText()).includes('材料'),'actual return path');
  const layout=()=>page.locator('.reading-original').first().evaluate(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {width:r.width,font:s.fontSize,line:s.lineHeight,height:r.height};});
  const before=await layout();const take=page.locator('.reading-word').filter({hasText:/^take$/}).first();await take.focus();await take.click();await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();await settle(page);
  const after=await layout();eq({font:after.font,line:after.line},{font:before.font,line:before.line},'opening card preserves user typography');
  ok(after.width<=before.width&&after.width>400,'opening card allocates readable text width');
  for(const state of ['default','hover','selected','focus']){if(state==='hover')await take.hover();if(state==='focus'){await page.keyboard.press('Tab');await take.focus();}ok(await contrast(take)>=4.5,`${theme} word ${state} contrast`);if(state==='focus')eq(await take.evaluate(node=>getComputedStyle(node).outlineStyle),'solid','word keyboard focus');}
  await checkReadingInteractions({page,theme,take,call,ok,eq,settle,output});

  eq(await page.locator('.context-panel button[aria-label*=关闭]').count(),0,'no close X');
  await page.getByRole('button',{name:'补充个人解释'}).click();await page.locator('#reader-meaning').fill('我的上下文解释');
  const saveCallsBeforeReceipt=await page.evaluate(()=>window.__uiCalls.filter(v=>v.command==='mutate_saved_record').length);
  await page.evaluate(()=>window.__uiFailure={command:'mutate_saved_record',afterCommit:true,remaining:1});
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-footer [role=alert]').waitFor();
  eq(await page.locator('#reader-meaning').inputValue(),'我的上下文解释','failed receipt retains draft');
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();
  eq((await call('list_saved_records',{query:'',limit:100,offset:0})).length,1,'lost receipt retry creates one record');
  const saves=(await page.evaluate(()=>window.__uiCalls.filter(v=>v.command==='mutate_saved_record'))).slice(saveCallsBeforeReceipt);eq(saves.length,2,'lost receipt has exactly one retry');eq(saves[0].args.operationId,saves[1].args.operationId,'retry reuses transaction identity');
  eq((await call('list_saved_records',{query:'',limit:100,offset:0}))[0].explanation,'我的上下文解释','real personal snapshot');
  await page.locator('.lookup-saved').getByRole('button',{name:'撤销'}).click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).waitFor();eq((await call('list_saved_records',{query:'',limit:100,offset:0})).length,0,'real undo');
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();
  await page.getByRole('button',{name:'补充个人解释'}).click();await page.locator('#reader-meaning').fill('暂时的修改');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.lookup-saved').waitFor();await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.getByRole('button',{name:'补充个人解释'}).click();eq(await page.locator('#reader-meaning').inputValue(),'我的上下文解释','undo edit restores editor too');
  await page.screenshot({path:`${output}/${theme}-1440-reading.png`});
  await close(page);ok(await take.evaluate(node=>node===document.activeElement),'Esc restores original trigger focus');
  // Keyboard continuous phrase selection shares the same lookup card.
  await take.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.soft-refresh-current .lookup-heading h2').filter({hasText:'take off'}).waitFor();await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();ok((await page.locator('.soft-refresh-current .longman-meaning').first().innerText()).length>0,'offline phrase dictionary');
  await close(page);
  const will=page.locator('.reading-word').filter({hasText:/^will$/}).first();await will.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.soft-refresh-current .lookup-heading h2').filter({hasText:/^will take$/}).waitFor();await page.locator('.soft-refresh-current .longman-result[data-result-status="not_found"]').waitFor({state:'attached'});await page.locator('.lookup-body[data-online-state="failed"]').waitFor();ok(await page.getByText('暂时无法连接，已有内容仍可使用。',{exact:true}).isVisible(),'unconfigured online fallback is explicitly unavailable, not an invented missing entry');eq(await page.locator('[data-sense-id]').count(),0,'missing phrase has no fabricated separate-word meaning');ok(await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).isEnabled(),'missing phrase can save its original without a dictionary meaning');await page.getByRole('button',{name:'补充个人解释',exact:true}).click();await page.locator('#reader-meaning').fill('原句中的个人解释：will take');await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();const unknown=(await call('list_saved_records',{query:'will take',limit:100,offset:0}))[0];eq(unknown.explanation,'原句中的个人解释：will take','missing phrase preserves explicit personal explanation');eq(unknown.explanation_source,'personal','does not label personal explanation as dictionary meaning');await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).waitFor();await close(page);
  // Late dictionary result must not replace the current word or a personal draft.
  await page.evaluate(()=>window.__uiDelayLookup=true);await take.click();if(!await page.locator('#reader-meaning').count())await page.getByRole('button',{name:'补充个人解释'}).click();await page.locator('#reader-meaning').fill('保留草稿');await page.locator('.reading-word').filter({hasText:/^noon$/}).first().click();await page.waitForTimeout(450);eq(await page.locator('.soft-refresh-current .lookup-heading h2').innerText(),'noon','late query response ownership');await close(page);await take.click();await page.locator('#reader-meaning').waitFor();eq(await page.locator('#reader-meaning').inputValue(),'保留草稿','draft survives query change');await close(page);
  for(const width of [360,390,430,768,1024,1280,1440]){
   await page.setViewportSize({width,height:900});await take.click();await settle(page);await noOverflow(page,`${theme} ${width}`);
   ok(await contrast(page.locator('.lookup-footer button,.lookup-saved strong').first())>=4.5,`${theme} save state contrast`);
   await page.screenshot({path:`${output}/${theme}-${width}-card.png`});
   if(width>=1024){await page.mouse.click(110,200);await page.locator('.context-panel').waitFor({state:'detached'});}else{await page.getByRole('button',{name:'收起，继续',exact:true}).click();await page.locator('.context-panel').waitFor({state:'detached'});}
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.b-dock').getByRole('button',{name:'调整学习内容显示',exact:true}).click();await page.locator('.display-font-popover:visible [data-font-category="definition"]').focus();await page.keyboard.press('End');await page.keyboard.press('Escape');await take.click();await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();eq(await page.locator('.soft-refresh-current .longman-meaning').first().evaluate(node=>getComputedStyle(node).fontSize),'25.2px','continuous definition font preference applies to unified card');await close(page);await page.locator('.b-dock').getByRole('button',{name:'调整学习内容显示',exact:true}).click();await page.locator('.display-font-popover:visible [data-font-category="definition"]').focus();await page.keyboard.press('Home');for(let step=0;step<20;step++)await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');
  await page.locator('.b-path a').click();await waitLibrary(page);eq(await page.locator('.material-card').count(),1,'return to real materials');
  await drop(page,[['duplicate.srt',flight],['empty.srt',''],['second.srt',srt('A second material is ready.')]]);await page.getByRole('button',{name:'确认导入（2）',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.lc-import-summary')?.textContent==='已导入 1 份材料');
  const statuses=await page.locator('.lc-import-items small').allTextContents();eq(statuses,['内容已存在，未覆盖','未完成','已导入'],'partial success and duplicate explicit');
  eq((await call('test_counts')).files,2,'partial failure preserves earlier successes');
  eq(await page.getByRole('button',{name:'重试未完成项'}).count(),0,'preparation errors are not offered as transaction retries');await close(page);
  await waitLibrary(page);eq(await page.locator('.material-card').count(),2,'bulk stays in materials');await page.screenshot({path:`${output}/${theme}-1440-materials.png`});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));eq(await page.locator('.b-mobile-nav .b-dock-control').allTextContents(),['导入','材料','已保存','设置'],'all mobile tasks remain reachable');await noOverflow(page,`${theme} mobile materials`);await page.screenshot({path:`${output}/${theme}-390-materials.png`});await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'列表',exact:true}).click();eq(await page.locator('.material-collection--list').count(),1,'list mode');await page.getByRole('button',{name:'画廊',exact:true}).click();eq(await page.locator('.material-collection--gallery').count(),1,'gallery mode');
  // Existing tags still write through the shared backend, with failure preserving form input.
  const tag=await call('create_tag',{name:'Travel'});await call('set_file_tags',{fileId,tagIds:[tag],newTagNames:[]});
  await page.reload();await waitLibrary(page);if(await page.getByRole('button',{name:'按标签筛选'}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'按标签筛选'}).click();await page.getByRole('button',{name:'Travel',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.material-card').length===1);eq(await page.locator('.material-card').count(),1,'tag filter real SQL');
  await page.getByRole('button',{name:'flight.srt',exact:true}).click();await page.locator('.reading-word').first().waitFor();await page.locator('.b-path a').click();await waitLibrary(page);eq(await page.locator('.tag-chip[aria-pressed=true]').count(),1,'filter retained on return');
  await page.getByRole('button',{name:'flight.srt',exact:true}).click();await page.locator('.reading-word').first().waitFor();
  await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('.reading-word'))window.__lookupActivatedAt=performance.now();},true));
  for(let i=0;i<50;i++){const term=i%2?'plane':'noon';await page.locator('.reading-word').filter({hasText:new RegExp(`^${term}$`)}).first().click();await page.locator('.soft-refresh-current .lookup-heading h2').filter({hasText:new RegExp(`^${term}$`)}).waitFor();await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();visibleTimings.push(await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-window.__lookupActivatedAt))))));}
  await close(page);await page.locator('.b-path a').click();await waitLibrary(page);
  // Restart the DB connection and round-trip a complete backup, including import receipts.
  const backup=await call('export_all');ok(backup.data.material_import_actions.length>=3,'import receipts included in backup');await call('test_reopen');await call('restore_all',{backup});eq((await call('test_counts')).files,2,'restart and restore keep materials');
  await call('test_delete_source',{fileId});const records=await call('list_saved_records',{query:'',limit:100,offset:0});eq(records.length,1,'source deletion keeps real saved snapshot');ok(records[0].sentence&&records[0].source.file_name==='flight.srt','snapshot keeps source');eq(await call('saved_record_source',{recordId:records[0].record_id}),null,'missing source explicit');
  await page.locator('.b-dock a[href="/saved"]').click();await page.locator('.saved-record-open').first().click();await page.getByRole('button',{name:'返回原文',exact:true}).click();await page.getByText('原材料已不存在或已变更，仍可阅读此副本。',{exact:true}).waitFor();checks++;await close(page);
  const counts=await call('test_counts');for(const table of ['words','phrases','reviews','phrase_reviews','review_logs','phrase_review_logs'])eq(counts[table],0,`new loop never writes ${table}`);
  // Cached command response timing uses a real initialized English dictionary.
  for(let i=0;i<30;i++){const start=performance.now();await call('lookup_longman_expression',{expression:'curiosity'});timings.push(performance.now()-start);}
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.saved-record-open').first().click();ok(await page.locator('.context-panel').evaluate(node=>getComputedStyle(node).animationName==='none'),'reduced motion');await close(page);
  await page.goto(`${url}/files`);await waitLibrary(page);
  const longSrt=Array.from({length:220},(_,i)=>{const clock=n=>`00:${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')},000`;return `${i+1}\n${clock(i*2+1)} --> ${clock(i*2+2)}\nWe read sentence number ${i+1}.\n测试原句。`;}).join('\n\n');
  await drop(page,[['long-reading.srt',longSrt]]);await page.getByRole('button',{name:'确认导入（1）',exact:true}).click();await page.waitForURL(/\/files\/\d+/);await page.locator('.reading-word').first().waitFor();
  ok(await page.locator('[data-sentence]').count()<=80,'long material initially renders a bounded chunk');const longId=Number(new URL(page.url()).pathname.split('/').at(-1));const material=(await call('list_materials',{tagIds:[],untagged:false})).find(item=>item.id===longId);const positionKey=`lexicue-reader-state:${material.source?.key??material.document?.identity??material.content_hash}`;
  await page.locator('.reader-scroll').evaluate(node=>{node.scrollTop=1700;});await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'{}').segment>0,positionKey);const position=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),positionKey);
  await page.reload();await page.locator(`[data-sentence="${position.segment}"]`).waitFor();const restored=await page.locator(`[data-sentence="${position.segment}"]`).evaluate(node=>document.querySelector('.reader-scroll').getBoundingClientRect().top-node.getBoundingClientRect().top);ok(Math.abs(restored-position.offset)<2,'reading position restores sentence and pixel offset after reload');
  await page.locator('.b-path a').click();await waitLibrary(page);ok((await page.locator('.material-continue').innerText()).includes('long-reading.srt'),'continue points to last actual material');const countBeforeCancel=(await call('test_counts')).files;
  await page.evaluate(async()=>{const {useImportStore}=await window.__uiStoreModule('importStore');void useImportStore.getState().start([{name:'slow.srt',read:()=>new Promise(done=>{window.__releaseRead=done;})},{name:'queued.srt',read:async()=>''}]);});
  await page.locator('.lc-import-loading-copy').waitFor();await close(page);await page.evaluate(text=>window.__releaseRead(text),srt('This import was cancelled before writing.'));await page.getByRole('button',{name:'导入',exact:true}).click();await page.locator('.lc-import-sources').waitFor();eq(await page.locator('.lc-import-items li').count(),0,'closing preparation discards its temporary queue');eq((await call('test_counts')).files,countBeforeCancel,'cancel before commit writes no files');await close(page);
  await context.close();
 }
 eq(errors,[],'no browser exceptions');timings.sort((a,b)=>a-b);const p95=timings[Math.ceil(timings.length*.95)-1];ok(p95<=500,`cached lookup p95 ${p95}ms`);
 visibleTimings.sort((a,b)=>a-b);const visibleP95=visibleTimings[Math.ceil(visibleTimings.length*.95)-1];ok(visibleTimings.length>=100&&visibleP95<=500,`activation to visible Chinese meaning p95 ${visibleP95}ms`);
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,checks,themes:['ocean','midnight'],widths:[360,390,430,768,1024,1280,1440],cachedLookupMs:{samples:timings.length,p95},activationToVisibleMs:{samples:visibleTimings.length,p95:visibleP95},errors},null,2));
 console.log(`Reading UI → SQLite: ${checks} checks passed; visible meaning p95 ${visibleP95.toFixed(2)}ms; cached command p95 ${p95.toFixed(2)}ms. Evidence: ${output}`);
}catch(error){if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await currentPage.evaluate(()=>({text:document.body.innerText,calls:window.__uiCalls})),null,2)).catch(()=>{});}await writeFile(`${output}/evidence.json`,JSON.stringify({passed:false,checks,error:String(error),errors,cachedLookupSamples:timings.length,visibleLookupSamples:visibleTimings.length},null,2));throw error;}finally{await harness.dispose();}
