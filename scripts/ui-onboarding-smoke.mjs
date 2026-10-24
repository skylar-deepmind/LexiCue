/** Actual example command cores and save transactions, in disposable SQLite only. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';
const output=process.env.LEXICUE_ONBOARDING_UI_OUTPUT||'/tmp/lexicue-ui-onboarding';
const harness=await createReadingHarness(output);
const {browser,url,call,fixture,errors}=harness;
let checks=0,currentPage;const evidence=[];
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const ok=(actual,label)=>{assert.ok(actual,label);checks++;};
const store=async(page,method,...args)=>page.evaluate(async({method,args})=>{const {useOnboardingStore}=await window.__uiStoreModule('onboardingStore');if(method==='state'){const {active,step,outcome,records,persistError}=useOnboardingStore.getState();return{active,step,outcome,records,persistError};}return useOnboardingStore.getState()[method](...args);},{method,args});
const outcome=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('lexicue-onboarding-v1')||'null')?.status);
const close=async page=>{await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});};
const ready=page=>page.locator('.example-intro').waitFor();
const settle=async page=>{await page.evaluate(()=>Promise.allSettled([...document.querySelectorAll('.context-panel,.workspace-paper')].flatMap(n=>n.getAnimations().map(a=>a.finished))));};
const save=async page=>{await page.locator('.lookup-footer').getByRole('button',{name:'保存',exact:true}).click();await page.locator('.lookup-saved').waitFor();};
const word=page=>page.getByRole('button',{name:'Curiosity',exact:true});
const lookup=async page=>{await word(page).click();await page.locator('.lookup-meaning').waitFor();};
const replay=async page=>{await page.goto(`${url}/settings`);await page.getByRole('link',{name:'重新体验',exact:true}).click();await ready(page);};
async function contrast(locator){return locator.evaluate(node=>{const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);let n=node,bg;do{bg=rgb(getComputedStyle(n).backgroundColor);n=n.parentElement;}while(n&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});}
try{
 for(const theme of ['ocean','midnight']){
  await call('test_reset');const before=(await call('export_all')).data;
  const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();currentPage=page;await fixture(page,theme);await page.goto(url);await ready(page);
  eq(new URL(page.url()).pathname,'/example','first root launch opens actual English sample');
  eq(await page.locator('.reading-sentence').count(),3,'three real English sentences');eq((await store(page,'state')).step,1,'one initial instruction');
  eq(await page.locator('.coach-banner,.step-banner,.analysis-model-picker,.learning-language-select').count(),0,'no extra navigation, model or language tasks');eq(await page.getByRole('button',{name:'跳过引导',exact:true}).count(),1,'single visible skip entry');
  ok((await page.locator('.example-intro').innerText()).includes('不计入'),'example data clearly distinguished');
  eq(await page.evaluate(()=>window.__uiCalls.filter(c=>['saved_recall_index','saved_recall_contexts'].includes(c.command)).length),0,'sample never queries real saved contexts');
  await page.screenshot({path:`${output}/${theme}-1440-start.png`});
  const layout=()=>page.locator('.reading-original').first().evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight};});
  const geometry=await layout();await lookup(page);await settle(page);eq(await layout(),geometry,'example opening preserves wrapping and typography');
  ok((await page.locator('.lookup-meaning').innerText()).includes('好奇'),'actual ECDICT result');eq((await store(page,'state')).step,2,'actual lookup advances instruction');eq(await page.getByRole('button',{name:'跳过引导',exact:true}).count(),1,'skip moves into card');
  await page.getByRole('button',{name:'补充个人解释'}).click();await page.locator('#reader-meaning').fill('体验中的个人解释');
  await page.evaluate(()=>window.__uiFailure={command:'mutate_example_saved_record',afterCommit:true,remaining:1});await page.locator('.lookup-footer').getByRole('button',{name:'保存',exact:true}).click();await page.locator('.lookup-body [role=alert]').waitFor();
  eq(await page.locator('#reader-meaning').inputValue(),'体验中的个人解释','failed receipt keeps sample draft');eq((await store(page,'state')).step,2,'lost receipt never fakes success');
  await save(page);eq((await store(page,'state')).step,3,'actual save advances to closing');
  const mutations=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='mutate_example_saved_record'));eq(mutations[0].args.operationId,mutations[1].args.operationId,'retry reuses actual transaction identity');
  eq(await page.locator('.lookup-footer button').allTextContents(),['撤销'],'green saved footer has only undo');ok(await contrast(page.locator('.lookup-saved strong'))>=4.5,'saved confirmation contrast');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer').getByRole('button',{name:'保存',exact:true}).waitFor();eq((await store(page,'state')).step,2,'undo returns to optional save');await close(page);eq((await store(page,'state')).active,true,'closing after undo does not falsely complete');
  await lookup(page);await save(page);
  for(const width of [360,390,430,768,1024,1280,1440]){
   await page.setViewportSize({width,height:900});await settle(page);
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme} ${width} no overflow`);
   ok(await page.locator('.context-panel').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),`${theme} ${width} visible card`);
   const skip=page.getByRole('button',{name:'跳过引导',exact:true});ok(await skip.evaluate(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'skip always reachable');
   for(const state of ['default','hover','focus']){if(state==='hover')await skip.hover();if(state==='focus'){await page.keyboard.press('Tab');await skip.focus();}ok(await contrast(skip)>=4.5,`${theme} ${width} ${state} skip contrast`);if(state==='focus')eq(await skip.evaluate(n=>getComputedStyle(n).outlineStyle),'solid','keyboard focus visible');}
   ok(await contrast(word(page))>=4.5,'selected word contrast');
   await page.screenshot({path:`${output}/${theme}-${width}-saved.png`});
  }
  await page.setViewportSize({width:390,height:320});await settle(page);ok(await page.getByRole('button',{name:'跳过引导',exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),'short viewport skip reachable');ok(await page.getByRole('button',{name:'撤销',exact:true}).evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight),'short viewport undo reachable');await page.screenshot({path:`${output}/${theme}-390-short.png`});
  await page.setViewportSize({width:1440,height:900});await word(page).focus();await close(page);eq(await outcome(page),'completed','closing actual saved context remembers completion');eq((await store(page,'state')).active,false,'guide ends after three actions');eq(await page.getByRole('button',{name:'跳过引导',exact:true}).count(),0,'guide controls disappear after completion');
  eq((await call('export_all')).data,before,'example save/undo/edit does not alter any real backup table');
  eq(await page.evaluate(()=>localStorage.getItem('lexicue-last-reading')),null,'sample never replaces real last-reading position');
  await page.goto(url);await page.locator('.materials-paper').waitFor();eq(new URL(page.url()).pathname,'/files','ordinary relaunch does not repeat completed guide');eq(await page.locator('.material-card').count(),0,'no sample material in library');
  await page.goto(`${url}/saved`);eq((await call('list_saved_records',{query:'',limit:100,offset:0})).length,0,'no sample saved record or fake collection');
  for(const step of [1,2,3]){
   await replay(page);eq((await store(page,'state')).step,1,'replay starts at first action');await lookup(page);eq(await page.locator('.lookup-saved').count(),0,'replayed example starts without saved records');if(step===1)await close(page);if(step===3)await save(page);
   await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/files$/);eq(await outcome(page),'skipped',`skip action ${step} remembered`);await page.goto(url);await page.locator('.materials-paper').waitFor();eq(new URL(page.url()).pathname,'/files','skipped guide stays skipped after restart');
  }
  // Save can be in flight when Skip is chosen. Late acknowledgments cannot
  // complete a discarded guide or insert records in the actual library.
  await replay(page);await lookup(page);await page.evaluate(()=>window.__uiDelayExampleSave=true);await page.locator('.lookup-footer').getByRole('button',{name:'保存',exact:true}).click();
  const pending=page.locator('.lookup-footer').getByRole('button',{name:'保存',exact:true});await page.waitForFunction(()=>document.querySelector('.lookup-footer button')?.disabled);ok(await contrast(pending)>=4.5,'pending disabled state readable');await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/files$/);await page.waitForTimeout(500);eq(await outcome(page),'skipped','late save cannot complete skipped guide');
  await replay(page);await lookup(page);eq(await page.locator('.lookup-saved').count(),0,'late save cannot affect next session');await close(page);
  // Selecting a continuous phrase uses actual offsets and the same real save core.
  const small=page.locator('[data-sentence="1"] .reading-word').filter({hasText:/^small$/});await small.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.lookup-heading h2').filter({hasText:'small habit'}).waitFor();await save(page);await close(page);eq(await outcome(page),'completed','phrase save can finish guide without forcing a particular word');
  await page.evaluate(()=>localStorage.setItem('lexicue-last-reading','{"id":987,"hash":"preserve"}'));
  await replay(page);await page.getByRole('button',{name:'导入',exact:true}).click();await page.locator('.material-drop').waitFor();await page.waitForURL(/\/files$/);eq(await outcome(page),'skipped','Import leaves sample without mandatory saving');
  await page.evaluate(()=>window.__uiFiles={'/fixture/real-learning.srt':'1\n00:00:01,000 --> 00:00:03,000\nA real learning material stays here.\n'});await page.getByRole('button',{name:'选择文件',exact:true}).click();await page.waitForURL(/\/files\/\d+/);await page.locator('.reading-word').first().waitFor();eq((await call('test_counts')).files,1,'real import works after skipping');
  const last=await page.evaluate(()=>localStorage.getItem('lexicue-last-reading'));await replay(page);await lookup(page);await save(page);await close(page);eq(await page.evaluate(()=>localStorage.getItem('lexicue-last-reading')),last,'replay preserves actual continue-reading position');
  const realAfter=(await call('export_all')).data;eq(realAfter.saved_records.length,0,'no example saved snapshot in portable backup');eq(realAfter.files.length,1,'only user import is in portable backup');eq(await call('saved_recall_index'),[],'no sample expression in actual recall index');eq(realAfter.reviews.length,0,'no word review tasks');eq(realAfter.phrase_reviews.length,0,'no phrase review tasks');
  await page.goto(`${url}/settings`);eq(await page.getByRole('link',{name:'重新体验',exact:true}).count(),1,'single replay entry in settings');eq(await page.locator('.learning-language-select,.analysis-model-picker,.frequency-baseline').count(),0,'retired settings have no active learning controls');await page.screenshot({path:`${output}/${theme}-1440-settings.png`});
  // Backend load failure has visible retry and skip, without blocking real import.
  await page.evaluate(()=>window.__uiFailure={command:'begin_example_session',afterCommit:false,remaining:100});await page.getByRole('link',{name:'重新体验',exact:true}).click();await page.locator('.example-load [role=alert]').waitFor();eq(await page.getByRole('button',{name:'跳过引导',exact:true}).count(),1,'skip remains available on load failure');await page.evaluate(()=>window.__uiFailure=null);await page.getByRole('button',{name:'重试',exact:true}).click();await ready(page);
  await page.emulateMedia({reducedMotion:'reduce'});await lookup(page);await settle(page);ok(await page.locator('.context-panel').evaluate(n=>parseFloat(getComputedStyle(n).animationDuration)<=.001),'reduced motion honored');
  eq(await page.evaluate(()=>window.__lexicueBack()),true,'system Back closes explanation');await page.locator('.context-panel').waitFor({state:'detached'});eq((await store(page,'state')).active,true,'Back at lookup does not complete without save');eq(await page.evaluate(()=>window.__lexicueBack()),true,'second system Back leaves example');await page.waitForURL(/\/files$/);eq(await outcome(page),'skipped','system Back remembers skip');
  // Skip is reachable before a delayed begin receipt and stale receipt is ignored.
  await page.goto(`${url}/settings`);await page.evaluate(()=>window.__uiDelayExampleBegin=true);await page.getByRole('link',{name:'重新体验',exact:true}).click();await page.locator('.example-load').waitFor();await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/files$/);await page.waitForTimeout(500);eq(await page.locator('.example-intro').count(),0,'late begin never resurrects sample');
  evidence.push({theme,checks,realCounts:await call('test_counts'),status:await outcome(page)});
  await context.close();
 }
 eq(errors,[],'no browser exceptions');
 await writeFile(`${output}/report.json`,JSON.stringify({checks,evidence,errors,scope:'Chrome UI → actual Rust command cores → disposable real SQLite; example separate in-memory DB',widths:[360,390,430,768,1024,1280,1440]},null,2));console.log(`Onboarding UI: ${checks} checks passed; ${output}`);
}catch(error){if(currentPage)await currentPage.screenshot({path:`${output}/failure.png`}).catch(()=>{});console.error(error);throw error;}finally{await harness.dispose();}
