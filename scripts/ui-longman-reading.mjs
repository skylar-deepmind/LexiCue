/** Real Longman SQLite → Rust command cores → reading UI, using disposable data.
 * Start Vite and configure LEXICUE_LONGMAN_PACKAGE_ROOT before running. No lookup
 * result is mocked: the fixture only bridges Tauri IPC to production Rust cores.
 */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_LONGMAN_UI_OUTPUT||`${root}/docs/implementation/evidence/longman-reading-v1`;
await mkdir(output,{recursive:true});
const harness=await createReadingHarness(output);
const {browser,url,call,fixture,errors}=harness;
let currentPage;const checks=[],timings=[],network=[],audio=[];
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);};
const eq=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks.push(label);};
const sentences=[
 'We will take off after noon.',
 'Please record the record before dinner.',
 'She looked the word up in her dictionary.',
 'Can you look it up for us?',
 'They turned it off before leaving.',
 'The US welcomed us warmly.',
 'It will cost an arm and a leg.',
 'He drove a red car yesterday.',
 'He took the written note and went home.',
];
const segments=sentences.map((en_text,index)=>({index,en_text,zh_text:null,start_time:`00:00:${String(index+1).padStart(2,'0')}.000`,end_time:`00:00:${String(index+2).padStart(2,'0')}.000`}));
const content=sentences.map((text,i)=>`${i+1}\n00:00:${String(i+1).padStart(2,'0')},000 --> 00:00:${String(i+2).padStart(2,'0')},000\n${text}\n`).join('\n');
const close=async page=>{await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});};
const ready=async(page,text)=>{await page.getByRole('dialog',{name:text,exact:true}).waitFor();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();await page.waitForFunction(()=>!!document.querySelector('.longman-result')||!!document.querySelector('.lookup-body > .longman-notice'));};
const word=(page,row,text,nth=0)=>page.locator(`[data-sentence="${row}"] .reading-word`).filter({hasText:new RegExp(`^${text}$`)}).nth(nth);
const open=async(page,row,text,nth=0)=>{const start=performance.now();await word(page,row,text,nth).click();await ready(page,text);timings.push(performance.now()-start);};
async function drag(page,row,first,last,expected){
 await page.locator(`[data-sentence="${row}"]`).scrollIntoViewIfNeeded();
 const points=await page.locator(`[data-sentence="${row}"]`).evaluate((node,{first,last})=>{
  const words=[...node.querySelectorAll('.reading-word')],a=words.find(n=>n.textContent===first),b=words.findLast(n=>n.textContent===last);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return{from:{x:x.left+1,y:x.top+x.height/2},to:{x:y.right-1,y:y.top+y.height/2}};
 },{first,last});
 await page.mouse.move(points.from.x,points.from.y);await page.mouse.down();await page.mouse.move(points.to.x,points.to.y,{steps:12});await page.mouse.up();await ready(page,expected);
}
async function screenshot(page,name){if(await page.locator('.context-panel').count())await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));await page.screenshot({path:`${output}/${name}.png`});}
async function layout(page,label){
 await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 await page.locator('.context-panel').evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: document has no horizontal overflow`);
 ok(await page.locator('.context-panel').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}),`${label}: card fits viewport`);
 ok(await page.locator('.lookup-footer').evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;}),`${label}: save footer remains visible`);
}
async function textContrast(locator,property='color'){return locator.evaluate((node,property)=>{
 const rgb=v=>v.match(/[\d.]+/g).map(Number);const lum=v=>v.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);
 let target=node,bg;do{bg=rgb(getComputedStyle(target).backgroundColor);target=target.parentElement;}while(target&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node)[property])),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
 },property);}
try{
 const status=await call('longman_dictionary_status');eq(status.state,'ready','real package is ready');ok(status.release,'real release is reported');
 for(const theme of ['ocean','midnight']){
  await call('test_reset');
  const imported=await call('import_reading_material',{input:{operation_id:`longman-ui-${theme}`,name:`longman-${theme}.srt`,content,segments}});
  const context=await browser.newContext({viewport:{width:1100,height:750}});
  await context.route('**/*',route=>{const request=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(request.hostname)||['data:','blob:'].includes(request.protocol))return route.continue();network.push({theme,url:request.href});return route.abort();});
  const page=await context.newPage();currentPage=page;await page.routeWebSocket('**',socket=>socket.close());await fixture(page,theme);
  await page.addInitScript(()=>{
   window.__longmanAudioEvents=[];
   const pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(...args){const result=pause.apply(this,args);if(this.__observed)window.__longmanAudioEvents.push({type:'pause-call',paused:this.paused,currentTime:this.currentTime});return result;};
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(...args){if(!this.__observed){this.__observed=true;for(const type of ['loadstart','loadedmetadata','canplay','play','playing','pause','ended','error'])this.addEventListener(type,()=>window.__longmanAudioEvents.push({type,currentTime:this.currentTime,duration:Number.isFinite(this.duration)?this.duration:null,error:this.error?.message??null}));}return play.apply(this,args);};
  });
  await page.goto(`${url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();
  eq(await page.locator('html').getAttribute('data-theme'),theme,`${theme}: actual theme applied`);
  await open(page,1,'record');await page.locator('.dictionary-overview').waitFor();eq(await page.locator('input[type="radio"]').count(),0,`${theme}: lookup has no compulsory sense choice`);await page.locator('.dictionary-more > summary').click();
  ok(!(await page.locator('.longman-pronunciations').allTextContents()).join(' ').includes('source US variant'),`${theme}: pronunciation relationship uses readable UI copy`);
  const groupIds=await page.locator('[data-group-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.groupId));ok(groupIds.length>=2,`${theme}: record preserves multiple source groups`);
  const senses=page.locator('[data-sense-id]');ok(await senses.count()>=2,`${theme}: all later senses remain readable in full content`);
  await page.locator('.longman-english summary').first().click();ok(await page.locator('.longman-english').first().getAttribute('open')!==null,`${theme}: English meaning expands`);
  ok(await page.locator('[data-sense-id]').count()>3,`${theme}: complete meaning list remains available`);
  const shownIds=await page.locator('[data-overview-sense]').evaluateAll(nodes=>nodes.map(node=>node.dataset.overviewSense));eq(shownIds.length,3,`${theme}: overview is short`);
  await page.locator('.dictionary-overview-line').first().hover();ok(await textContrast(page.locator('.dictionary-overview .longman-meaning').first())>=4.5,`${theme}: overview hover text contrast >= 4.5`);
  await page.locator('.dictionary-overview-line').first().hover();ok(await textContrast(page.locator('.dictionary-overview .longman-meaning').first())>=4.5,`${theme}: overview hover text contrast >= 4.5`);
  ok(await textContrast(page.locator('.longman-meaning').first())>=4.5,`${theme}: meaning text contrast >= 4.5`);
  ok(await textContrast(page.locator('.longman-tag--pos').first())>=4.5,`${theme}: part-of-speech tag contrast >= 4.5`);
  await screenshot(page,`${theme}-record-selected`);
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();
  let records=await call('list_saved_records',{query:'',limit:100,offset:0});eq(records.length,1,`${theme}: one real saved record`);
  let record=records[0];eq(record.dictionary_reference.senses.map(item=>item.sense_id),shownIds,`${theme}: displayed excerpt frozen without selecting a meaning`);eq(record.dictionary_snapshot,undefined,`${theme}: no selected-sense snapshot fabricated`);eq(record.expression,'record',`${theme}: source expression preserved`);eq(record.sentence,sentences[1],`${theme}: source context preserved`);eq(record.source.file_name,`longman-${theme}.srt`,`${theme}: source filename preserved`);eq(record.explanation_source,'unknown',`${theme}: reference not labelled as sentence meaning`);eq(record.explanation,null,`${theme}: no default meaning is claimed`);
  await screenshot(page,`${theme}-record-saved`);
  await close(page);await call('test_reopen');await page.reload();await page.locator('.reading-word').first().waitFor();await open(page,1,'record');await page.locator('.lookup-saved').waitFor();ok((await page.locator('.lookup-saved').innerText()).includes('本句已记下'),`${theme}: reopening distinguishes current sentence`);eq((await call('list_saved_records',{query:'record',limit:100,offset:0}))[0].dictionary_reference.senses.map(item=>item.sense_id),shownIds,`${theme}: reopening preserves frozen reference`);
  await close(page);await open(page,0,'noon');await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).waitFor();eq((await call('list_saved_records',{query:'noon',limit:100,offset:0})).length,0,`${theme}: undo removes real save`);
  await close(page);await open(page,1,'record');await page.getByRole('button',{name:'补充个人解释',exact:true}).click();await page.locator('#reader-meaning').fill(`撤销临时解释 ${theme}`);await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByRole('button',{name:'撤销',exact:true}).click();eq((await call('list_saved_records',{query:'record',limit:100,offset:0}))[0].dictionary_reference.senses.map(item=>item.sense_id),shownIds,`${theme}: undo personal edit retains dictionary reference`);
  await page.getByRole('button',{name:'补充个人解释',exact:true}).click();await page.locator('#reader-meaning').fill(`个人解释 ${theme}`);await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.locator('.lookup-saved').waitFor();await close(page);await open(page,1,'record');await page.getByRole('button',{name:'补充个人解释',exact:true}).click();eq(await page.locator('#reader-meaning').inputValue(),`个人解释 ${theme}`,`${theme}: saved personal explanation survives reopen`);
  ok(await page.locator('.dictionary-overview').isVisible(),`${theme}: personal content coexists with current dictionary reference`);
  await close(page);await drag(page,2,'looked','up','looked the word up');eq(await page.locator('.lookup-heading h2').innerText(),'look up',`${theme}: separable expression shows canonical form`);eq(await page.locator('.reading-word[aria-pressed="true"]').count(),4,`${theme}: drag preserves complete source range`);await page.waitForTimeout(450);eq(await page.locator('.context-panel').count(),1,`${theme}: opening drag leaves panel open`);
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();record=(await call('list_saved_records',{query:'looked the word up',limit:100,offset:0}))[0];eq(record.expression,'looked the word up',`${theme}: expression snapshot keeps inflected source text`);eq(record.dictionary_reference.headword,'look up',`${theme}: canonical expression stored separately`);await screenshot(page,`${theme}-expression-saved`);
  await close(page);const look=word(page,3,'look');await look.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await ready(page,'look it up');eq(await page.locator('.reading-word[aria-pressed="true"]').count(),3,`${theme}: keyboard extends the complete expression`);ok(await page.locator('[data-sense-id]').count()>=1,`${theme}: expression returns real meaning`);await screenshot(page,`${theme}-keyboard-expression`);
  await close(page);await open(page,5,'US');ok((await page.locator('.lookup-body').innerText()).includes('仅英文'),`${theme}: US has explicit English-only notice`);await screenshot(page,`${theme}-english-only`);const upper=(await page.locator('.lookup-body').innerText());await close(page);await open(page,5,'us');ok((await page.locator('.lookup-body').innerText())!==upper,`${theme}: US and us are distinct`);
  await close(page);await drag(page,7,'a','car','a red car');eq(await page.locator('[data-sense-id]').count(),0,`${theme}: unrecorded arbitrary phrase is not fabricated`);ok(await page.locator('.lookup-footer button').isEnabled(),`${theme}: no-meaning original remains saveable`);ok(await textContrast(page.locator('.lookup-footer button'))>=4.5,`${theme}: save text remains readable without a lookup result`);await screenshot(page,`${theme}-not-found`);
  await close(page);await open(page,0,'noon');await page.evaluate(()=>window.__uiDelayLookup=true);await word(page,0,'take').click();await page.getByRole('dialog',{name:'take',exact:true}).waitFor();ok(await page.locator('.lookup-footer .saved-primary').isEnabled(),`${theme}: pending lookup does not block save`);await page.locator('.lookup-footer .saved-primary').click();await page.locator('.lookup-saved').waitFor();const pendingSave=(await call('list_saved_records',{query:'take',limit:100,offset:0})).find(r=>r.expression==='take');ok(pendingSave,`${theme}: pending save uses new source selection`);await word(page,1,'dinner').click();await ready(page,'dinner');await page.waitForTimeout(450);eq(await page.locator('.lookup-heading h2').innerText(),'dinner',`${theme}: late lookup cannot replace current query`);await page.evaluate(()=>window.__uiDelayLookup=false);
  await close(page);await page.evaluate(()=>window.__uiFailure={command:'lookup_longman_expression',afterCommit:false,remaining:10});await open(page,0,'noon');eq(await page.locator('[data-sense-id]').count(),0,`${theme}: failed lookup has no fabricated sense`);await screenshot(page,`${theme}-unavailable`);await page.evaluate(()=>window.__uiFailure=null);await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.dictionary-overview').waitFor();
  for(const size of [{width:1100,height:750},{width:800,height:600}]){
   await page.setViewportSize(size);await layout(page,`${theme} ${size.width}x${size.height}`);await screenshot(page,`${theme}-${size.width}x${size.height}`);
  }
  await page.setViewportSize({width:1100,height:750});await close(page);await open(page,1,'record');
  const focusSummary=page.locator('.dictionary-more > summary');await focusSummary.focus();await page.keyboard.press('Tab');ok(await page.evaluate(()=>document.activeElement.matches(':focus-visible')),`${theme}: keyboard focus is visible`);const focused=page.locator(':focus-visible').last();ok(await focused.evaluate(node=>parseFloat(getComputedStyle(node).outlineWidth)>=2),`${theme}: keyboard focus has a visible outline`);ok(await textContrast(focused,'outlineColor')>=3,`${theme}: keyboard focus contrast >= 3`);await screenshot(page,`${theme}-focus`);
  eq(await page.locator('.longman-audio').count(),0,`${theme}: dictionary recording controls are removed`);
  eq(await page.locator('.dictionary-overview .longman-ipa').count(),0,`${theme}: incomplete US source suffixes omitted from overview`);await page.locator('.dictionary-more > summary').click();ok(await page.locator('.longman-pronunciations .longman-ipa').count()>=2,`${theme}: selected-accent original variant relationships retained in details`);await page.locator('.dictionary-more > summary').click();
  eq(await page.evaluate(()=>window.__uiCalls.filter(call=>/audio/.test(call.command))),[],`${theme}: no dictionary media IPC requests`);
  eq(await page.evaluate(()=>window.__longmanAudioEvents),[],`${theme}: no dictionary recording playback`);
  await page.mouse.click(12,110);await page.locator('.context-panel').waitFor({state:'detached'});ok(true,`${theme}: genuine blank-space click still dismisses the card`);
  await page.emulateMedia({reducedMotion:'reduce'});await open(page,0,'take');await word(page,0,'noon').click();await ready(page,'noon');eq(await page.locator('.lookup-content').evaluate(node=>node.getAnimations().length),0,`${theme}: reduced motion handoff stays still`);
  await context.close();
 }
 eq(network,[],'offline reading performs no nonlocal requests');eq(errors,[],'no browser exceptions');
 timings.sort((a,b)=>a-b);await writeFile(`${output}/ui-evidence.json`,JSON.stringify({passed:true,checks:checks.length,assertions:checks,themes:['default (ocean)','midnight'],viewports:['1100x750','800x600'],backend:'production Rust command cores and genuine Longman SQLite, disposable user DB via test-only HTTP bridge',audio,recordingsRemoved:true,systemSpeech:'separate word/sentence controls retained',network,timingMs:{samples:timings.length,median:timings[Math.floor(timings.length/2)],p95:timings[Math.ceil(timings.length*.95)-1]},errors},null,2));
 console.log(`Longman reading UI: ${checks.length} checks passed. Evidence: ${output}`);
}catch(error){if(currentPage){await screenshot(currentPage,'failure').catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify(await currentPage.evaluate(()=>({text:document.body.innerText,calls:window.__uiCalls,audio:window.__longmanAudioEvents})),null,2)).catch(()=>{});}await writeFile(`${output}/ui-evidence.json`,JSON.stringify({passed:false,checks:checks.length,assertions:checks,error:String(error),network,audio},null,2));throw error;}finally{await harness.dispose();}
