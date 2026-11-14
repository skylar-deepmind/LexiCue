/** Real command cores + disposable SQLite. Normal motion is intentional: reduced
 * motion alone cannot detect a returned page painting before its scroll restore. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_NAVIGATION_OUTPUT||'/tmp/lexicue-navigation-return';
const h=await createReadingHarness(output);const checks=[];let current;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
try{
 await h.call('test_reset');
 const words=[...Array(21).fill('quiet'),'apple','book','city','door','early','friend','green','home','idea','journey','kind','light','morning','night','open','paper','question','river','story','time'];
 const lines=words.map((word,index)=>`${word} is part of original sentence ${index+1}.`);
 const imported=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'Return navigation.txt',content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:null,start_time:null,end_time:null}))}});
 const material=await h.call('open_reading_material',{fileId:imported.file_id});
 for(const [i,segment] of material.segments.entries())await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:segment.id,expression:words[i],start_offset:0,end_offset:words[i].length,explanation:null,explanation_source:'unknown'}}});
 for(const theme of ['ocean','midnight'])for(const width of [375,1280]){
  const context=await h.browser.newContext({viewport:{width,height:900},reducedMotion:'no-preference'});
  const page=await context.newPage();current=page;await h.fixture(page,theme);
  await page.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));
  const label=`${theme}/${width}`;
  const back=()=>page.locator(width<768?'.mobile-settings-header button':'.settings-back').click();
  const settings=()=>page.locator(width<768?'.mobile-settings-link':'.b-dock-control[href="/settings"]').click();
  await page.goto(`${h.url}/saved`);await page.locator('.saved-record-row').first().waitFor();
  const pager=page.locator('.saved-floating-pager').getByRole('textbox',{name:'跳转到页码'});
  await pager.fill('2');await pager.press('Enter');await page.waitForFunction(()=>document.querySelector('.saved-record-term')?.textContent==='quiet');
  await page.locator('.saved-record-open').click();await page.getByRole('button',{name:'还有 20 句',exact:true}).click();
  const contexts=page.locator('.saved-group-contexts');const contextPager=contexts.getByRole('textbox',{name:'跳转到页码'});
  await contextPager.fill('2');await contextPager.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.saved-sentence').length===1&&!document.querySelector('.saved-group-contexts[aria-busy=true]'));
  const record=await page.locator('.saved-sentence').getAttribute('data-record');
  await settings();await page.locator('.settings-groups').waitFor();
  await page.locator('[data-entry=speech]').click();await back();await page.locator('.settings-groups').waitFor();
  if(width<768)await page.locator('.mobile-settings-header button').click();else await page.evaluate(()=>window.__lexicueBack());
  await page.locator('.saved-record-open[aria-expanded=true]').waitFor();await page.waitForFunction(()=>!document.querySelector('.saved-group-contexts[aria-busy=true]'));
  eq(await pager.inputValue(),'2',`${label}: settings roundtrip keeps saved page`);
  eq(await contextPager.inputValue(),'2',`${label}: settings roundtrip keeps example page`);
  eq(await page.locator('.saved-sentence').getAttribute('data-record'),record,`${label}: settings roundtrip keeps exact expanded example`);
  const before=await page.locator('.saved-scroll').evaluate(n=>n.scrollTop);
  await page.getByRole('button',{name:'返回原文',exact:true}).click();await page.locator('.reading-page').waitFor();
  const sourceReturn=page.locator('.reader-return-origin');eq((await sourceReturn.textContent()).trim(),'',`${label}: source return is icon only`);
  await page.locator('.reading-word').filter({hasText:/^quiet$/}).first().click();await page.locator('.lookup-stage[data-lookup-state=ready]').waitFor();
  await page.getByTestId('lookup-records-tab').click();await page.locator('.recall-history .saved-sentence').first().waitFor();
  const lookupLabel=await page.locator('.lookup-heading h2').textContent();
  if(width>=768){await settings();await page.locator('.settings-groups').waitFor();await page.evaluate(()=>window.__lexicueBack());}
  else{await page.getByRole('button',{name:'返回原文',exact:true}).first().click();await page.locator('.reader-return-origin').click();}
  await page.locator('.reading-page').waitFor();
  eq(await page.locator('.lookup-heading h2').textContent(),lookupLabel,`${label}: reader visit keeps selected word`);
  eq(await page.getByTestId('lookup-records-tab').getAttribute('aria-selected'),'true',`${label}: reader visit keeps lookup tab`);
  await sourceReturn.click();await page.locator('.saved-record-open[aria-expanded=true]').waitFor();
  eq(await contextPager.inputValue(),'2',`${label}: source return keeps example page`);
  const frames=await page.evaluate(()=>new Promise(resolve=>{const frames=[];const start=performance.now();const step=()=>{const n=document.querySelector('.saved-scroll');frames.push({scroll:n.scrollTop,opacity:getComputedStyle(n.closest('.page-live')).opacity,ghost:!!document.querySelector('.page-ghost .page-snapshot')});if(performance.now()-start<500)requestAnimationFrame(step);else resolve(frames);};requestAnimationFrame(step);}));
  assert.ok(frames.every(f=>Math.abs(f.scroll-before)<=2&&f.opacity==='1'&&!f.ghost),`${label}: return stays at restored position without a crossfade/late jump`);checks.push(`${label}: normal-motion return stays stable across 500ms`);
  await contextPager.fill('1');await contextPager.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.saved-group-contexts .saved-sentence').length===20&&!document.querySelector('.saved-group-contexts[aria-busy=true]'));
  await page.locator('.saved-sentence-original').nth(8).click();
  await page.getByRole('button',{name:'返回原文',exact:true}).scrollIntoViewIfNeeded();
  const scrolled=await page.locator('.saved-scroll').evaluate(n=>n.scrollTop);assert.ok(scrolled>100,`${label}: exercise a nonzero scroll anchor`);
  await page.getByRole('button',{name:'返回原文',exact:true}).click();await page.locator('.reading-page').waitFor();await sourceReturn.click();
  await page.locator('.saved-group-contexts .saved-sentence').nth(8).waitFor();
  const positions=await page.evaluate(()=>new Promise(resolve=>{const values=[];const start=performance.now();const frame=()=>{values.push(document.querySelector('.saved-scroll').scrollTop);if(performance.now()-start<500)requestAnimationFrame(frame);else resolve(values);};requestAnimationFrame(frame);}));
  assert.ok(positions.every(n=>Math.abs(n-scrolled)<2),`${label}: nonzero scroll never flashes at the top or jumps after return`);checks.push(`${label}: exact nonzero scroll remains stable throughout normal-motion return`);
  if(width<768){await page.getByRole('button',{name:'返回原文',exact:true}).click();await page.locator('.reading-page').waitFor();await page.locator('.mobile-saved-control').click();await page.locator('.saved-record-row').first().waitFor();await page.locator('.mobile-workspace-header .page-back').click();await page.locator('.reading-page').waitFor();eq(await page.locator('.context-panel').count(),0,`${label}: reader/saved roundtrip preserves a deliberately closed lookup`);await sourceReturn.click();}
  await settings();await page.locator('[data-entry=backup]').click();await page.locator('a[href="/legacy"]').click();await page.locator('.legacy-paper').waitFor();
  await page.locator(width<768?'.mobile-workspace-header .page-back':'.legacy-paper .page-back').click();await page.waitForURL('**/settings?section=backup');
  eq(new URL(page.url()).search,'?section=backup',`${label}: old records return to backup, not materials`);
  await back();await page.locator('.settings-groups').waitFor();
  const directory=page.locator('.settings-scroll');await directory.evaluate(n=>n.scrollTop=130);const dirTop=await directory.evaluate(n=>n.scrollTop);
  await page.locator('[data-entry=updates]').click();await back();await page.locator('.settings-groups').waitFor();
  eq(await directory.evaluate(n=>n.scrollTop),dirTop,`${label}: settings directory returns without auto-scroll from focus`);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-entry=speech]').click();await back();
  eq(await page.locator('.page-live').evaluate(n=>n.getAnimations({subtree:true}).filter(a=>a.effect?.getKeyframes().some(k=>'translate' in k)).length),0,`${label}: reduced motion disables route displacement`);
  await page.screenshot({path:`${output}/${theme}-${width}.png`});await context.close();
 }
 eq(h.errors,[],'no application errors');await writeFile(`${output}/navigation-report.json`,JSON.stringify({checks,scope:'Production Rust/SQLite cores, Chromium desktop/mobile layout; physical devices separately verified'},null,2));console.log(`Navigation return: ${checks.length} checks passed`);
}catch(error){await current?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}finally{await h.dispose();}
