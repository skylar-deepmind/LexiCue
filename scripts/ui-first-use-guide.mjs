/** Live application components → real Rust command cores → disposable SQLite. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output='/tmp/lexicue-real-guide';
const harness=await createReadingHarness(output,['example_recall_contexts']);
const {browser,url,call,fixture,errors}=harness;
let checks=0,current;
const ok=(value,label)=>{assert.ok(value,label);checks++;};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const state=page=>page.evaluate(async()=>{const {useOnboardingStore}=await window.__uiStoreModule('onboardingStore');const s=useOnboardingStore.getState();return {tour:s.tour,step:s.step,records:s.records.length,active:s.active,outcome:s.outcome};});
async function fits(page,label){
 await page.waitForFunction(()=>{const n=document.querySelector('.app-guide__bubble');return n&&getComputedStyle(n).visibility==='visible';});
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,700)));
 ok(await page.locator('.app-guide__bubble').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),`${label}: bubble inside viewport`);
 ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: no overflow`);
 ok(await page.locator('[data-guide-anchor-active]').evaluate(target=>{const r=target.getBoundingClientRect(),n=document.querySelector('.app-guide__bubble').getBoundingClientRect();return r.right<=n.left||r.left>=n.right||r.bottom<=n.top||r.top>=n.bottom;}),`${label}: target not obscured`);
}
async function contrast(locator){return locator.evaluate(node=>{const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);let n=node,bg;do{bg=rgb(getComputedStyle(n).backgroundColor);n=n.parentElement;}while(n&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});}
try{
 for(const theme of ['ocean','midnight'])for(const width of [1280,390,360]){
  await call('test_reset');const before=(await call('export_all')).data;
  const context=await browser.newContext({viewport:{width,height:width<768?844:800}}),page=await context.newPage();current=page;
  await fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());await page.goto(url);
  await page.locator('.app-guide[data-stage=import]').waitFor();eq(new URL(page.url()).pathname,'/files','first launch shows real material desk');
  await fits(page,`${theme}-${width}-import`);
  await page.locator('[data-guide-anchor-active]').click();await page.locator('.lc-import-sources').waitFor();
  await fits(page,`${theme}-${width}-sources`);
  ok(await page.locator('.app-guide').evaluate(n=>!n.closest('[inert]')),'coach remains interactive with native modal');
  await page.locator('.lc-import-close').focus();for(let i=0;i<4;i++)await page.keyboard.press('Tab');
  ok(await page.locator('.app-guide__next').evaluate(n=>n===document.activeElement),'modal keyboard order reaches coach');
  await page.screenshot({path:`${output}/${theme}-${width}-import.png`});
  await page.getByRole('button',{name:'先用体验材料',exact:true}).click();await page.locator('.reading-word').first().waitFor();
  await page.locator('.app-guide[data-stage=lookup]').waitFor();await fits(page,`${theme}-${width}-lookup`);
  eq(await page.locator('.first-guide__illustration').count(),0,'no recreated application UI');
  await page.getByRole('button',{name:'Curiosity',exact:true}).click();await page.locator('.app-guide[data-stage=save]').waitFor();await fits(page,`${theme}-${width}-save`);
  const label=await page.getByTestId('lookup-save').innerText();ok((await page.locator('.app-guide__bubble').innerText()).includes(label),'copy uses actual save action label');
  await page.evaluate(()=>window.__uiFailure={command:'mutate_example_saved_record',afterCommit:true,remaining:1});
  await page.getByTestId('lookup-save').click();await page.locator('.lookup-write-error[role=alert]').waitFor();eq((await state(page)).records,0,'lost receipt never invents saved state');
  await page.getByTestId('lookup-save').click();await page.locator('.lookup-save-toast').waitFor();eq((await state(page)).records,1,'real save updates coach');
  await page.getByTestId('lookup-undo').click();await page.getByTestId('lookup-save').waitFor();eq((await state(page)).records,0,'real undo returns coach to save instruction');
  await page.getByTestId('lookup-save').click();await page.locator('.lookup-save-toast').waitFor();await fits(page,`${theme}-${width}-saved`);
  for(const interaction of ['default','hover','focus']){
   if(interaction==='hover')await page.locator('.app-guide__next').hover();if(interaction==='focus')await page.locator('.app-guide__next').focus();
   ok(await contrast(page.locator('.app-guide__next'))>=4.5,`${theme} ${interaction} primary contrast`);
   ok(await contrast(page.locator('.app-guide__skip'))>=4.5,`${theme} ${interaction} skip contrast`);
  }
  ok(await contrast(page.locator('.app-guide__bubble p'))>=4.5,'bubble text contrast');
  await page.screenshot({path:`${output}/${theme}-${width}-save.png`});
  await page.getByRole('button',{name:'继续听读',exact:true}).click();await page.locator('.context-panel').waitFor({state:'detached'});await fits(page,`${theme}-${width}-tools`);
  const translation=page.locator('[data-guide-anchor-active] button').filter({has:page.locator('svg.lucide-languages')});
  await translation.click();await page.waitForFunction(()=>[...document.querySelectorAll('.reading-translation-disclosure')].some(n=>n.dataset.open));
  ok(await page.locator('.reading-translation').first().innerText(),'real sample translation is available');
  await page.getByRole('button',{name:'看看记忆提示',exact:true}).click();await page.locator('.app-guide[data-stage=recall]').waitFor();await fits(page,`${theme}-${width}-recall`);
  await page.locator('.reading-word[data-recall]').first().click();await page.getByTestId('lookup-records-tab').waitFor();await fits(page,`${theme}-${width}-records-tab`);
  await page.getByTestId('lookup-records-tab').click();await page.locator('.recall-history .saved-sentence-original').waitFor();await fits(page,`${theme}-${width}-history`);
  eq((await page.locator('.saved-sentence-original').innerText()).trim(),'Curiosity helps us notice small changes.','history is the sentence saved in this session');
  await page.screenshot({path:`${output}/${theme}-${width}-history.png`});
  // Personal notes in sample history also stay in its in-memory scope.
  await page.getByRole('button',{name:'补充个人解释',exact:true}).click();await page.getByRole('textbox',{name:'个人解释',exact:true}).fill('体验笔记');await page.locator('.app-guide').waitFor({state:'detached'});eq(await page.locator('.app-guide').count(),0,'note editor owns the screen without a coach blocking its save action');await page.getByRole('button',{name:'保存解释',exact:true}).click();await page.getByRole('textbox',{name:'个人解释',exact:true}).waitFor({state:'detached'});
  eq((await call('export_all')).data,before,'sample saves and notes never change real backup tables');
  await page.getByRole('button',{name:'开始自己的阅读',exact:true}).click();await page.waitForURL(/\/files$/);eq((await state(page)).outcome,'completed','completion is remembered');
  eq(await page.locator('.app-guide').count(),0,'coach cleans up after completion');eq(await page.locator('[data-guide-anchor-active]').count(),0,'anchor accessibility additions are removed');
  await page.goto(`${url}/settings`);const replayIndex=await page.evaluate(()=>history.state.idx);await page.getByRole('link',{name:'实操引导',exact:true}).click();await page.locator('.app-guide[data-stage=import]').waitFor();
  await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/settings$/);eq(await page.evaluate(()=>history.state.idx),replayIndex,'directory replay returns to its original history entry');eq((await state(page)).outcome,'skipped','skip works from import');
  await page.goto(`${url}/example`);await page.locator('.app-guide[data-stage=lookup]').waitFor();await page.emulateMedia({reducedMotion:'reduce'});eq(await page.locator('.app-guide__bubble').evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion honored');
  await page.keyboard.press('Escape');await page.waitForURL(/\/files$/);eq((await state(page)).active,false,'Escape skips without trapping focus');
  if(width===1280){
    // Loading failures and late receipts must not trap the user or resurrect a skipped tour.
    await page.goto(`${url}/settings`);const replayIndex=await page.evaluate(()=>history.state.idx);await page.getByRole('link',{name:'实操引导',exact:true}).click();
    await page.evaluate(()=>window.__uiFailure={command:'begin_example_session',afterCommit:false,remaining:100});
    await page.getByRole('button',{name:'先用体验材料',exact:true}).click();await page.locator('.example-load [role=alert]').waitFor();
    eq(await page.getByRole('button',{name:'跳过引导',exact:true}).count(),1,'one reachable skip on material load failure');
    await page.evaluate(()=>window.__uiFailure=null);await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.reading-word').first().waitFor();
    await page.getByRole('button',{name:'Curiosity',exact:true}).click();await page.locator('.app-guide[data-stage=save]').waitFor();
    await page.evaluate(()=>window.__uiDelayExampleSave=true);await page.getByTestId('lookup-save').click();
    await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/settings$/);eq(await page.evaluate(()=>history.state.idx),replayIndex,'replayed guide returns to its original settings entry without adding history');await page.waitForTimeout(500);
    eq((await state(page)).outcome,'skipped','late save cannot complete a skipped coach');
    eq((await call('export_all')).data,before,'late example write remains isolated');
    await page.goto(`${url}/example`);await page.locator('.reading-word').first().waitFor();
    await page.getByRole('button',{name:'Curiosity',exact:true}).click();await page.getByTestId('lookup-save').waitFor();
    eq(await page.locator('.lookup-save-toast').count(),0,'replay starts with an empty example DB');
    await page.setViewportSize({width:844,height:390});await fits(page,`${theme}-landscape`);
    await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/files$/);
    await page.evaluate(()=>window.__uiDelayExampleBegin=true);await page.goto(`${url}/example`);await page.locator('.example-load').waitFor();
    await page.getByRole('button',{name:'跳过引导',exact:true}).click();await page.waitForURL(/\/files$/);await page.waitForTimeout(500);
    eq(await page.locator('.reading-page').count(),0,'late begin cannot reopen a skipped sample');
  }
  await context.close();
 }
 eq(errors,[],'no browser errors');await writeFile(`${output}/report.json`,JSON.stringify({checks,errors,scope:'Actual React app and real Rust example/save/recall cores with temporary DBs'},null,2));
 console.log(`Real application guide: ${checks} checks passed; ${output}`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`});throw error;}finally{await harness.dispose();}
