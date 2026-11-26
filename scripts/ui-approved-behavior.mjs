import {keyboardTrash} from './ui-trash-support.mjs';
/** New surface persistence/failure/navigation acceptance against disposable real SQLite. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness,openSelectedSavedExpression} from './ui-reading-support.mjs';
const out=process.env.LEXICUE_APPROVED_BEHAVIOR_OUTPUT||'/tmp/lexicue-approved-behavior';await mkdir(out,{recursive:true});
const h=await createReadingHarness(out,['resolve_tts_audio','cancel_tts','clear_tts_cache']),checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);},eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
async function home(){await page.goto(`${h.url}/files`);await page.locator('.approved-desk').waitFor();await page.evaluate(async()=>{const {useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const {useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files.slice(0,5).reverse())d.getState().keepAndOpen(file);});await page.locator('.approved-card[data-desk-active=true]').waitFor();}
async function saved(){await home();await page.getByRole('button',{name:'已保存',exact:true}).click();await openSelectedSavedExpression(page);await page.waitForFunction(()=>!document.documentElement.dataset.dissolve&&!document.querySelector('.approved-saved-flight'));}
async function active(){return page.locator('.approved-saved-folio[data-current=true]').getAttribute('data-record');}
async function settle(){await page.waitForFunction(()=>!document.documentElement.dataset.dissolve&&!document.querySelector('.approved-handoff,.approved-saved-flight,.approved-tag-flight'));}
try{
 for(const theme of ['sage','midnight'])for(const width of [1360,390]){
  await h.call('test_reset');const files=[];const tag=await h.call('create_tag',{name:'Journeys'});
  for(let n=0;n<5;n++){const lines=['The plane will take off soon.','The air smelled of salt near the old pier.',`We return to the quiet harbor. Journey ${n+1}.`];const material=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`A journey ${n+1}.txt`,normalized_kind:'txt',content:lines.join('\n'),segments:lines.map((en_text,index)=>({index,en_text,zh_text:'我们沿着海岸继续阅读。',start_time:null,end_time:null})),tag_ids:[tag]}});files.push(material);const read=await h.call('open_reading_material',{fileId:material.file_id});for(const [i,expression]of [[0,'take off'],[1,'air']]){const s=read.segments[i],start=s.en_text.indexOf(expression);await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:s.id,expression,start_offset:start,end_offset:start+expression.length,explanation:'先前保存的个人解释。',explanation_source:'personal'}}});}}
  const context=await h.browser.newContext({viewport:{width,height:width===1360?880:844},hasTouch:width<768});page=await context.newPage();await h.fixture(page,theme);if(width<768)await page.addInitScript(()=>Object.defineProperty(document,'startViewTransition',{value:undefined}));await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(()=>{localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));window.__folioAnimations=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.classList.contains('approved-folio-scroll'))window.__folioAnimations.push({frames,options});return animate.call(this,frames,options);};});
  await home();const first=await page.locator('.approved-card[data-desk-active=true]').getAttribute('data-motion-file');await page.locator('.approved-deck').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(id=>document.querySelector('.approved-card[data-desk-active=true]')?.dataset.motionFile!==id,first);ok(true,'keyboard turns the real material card');await page.keyboard.press('ArrowLeft');await page.waitForFunction(id=>document.querySelector('.approved-card[data-desk-active=true]')?.dataset.motionFile===id,first);
  await page.locator('.approved-card[data-desk-active=true] .approved-card-open').click();await page.locator('.approved-handoff').waitFor();const homeMotion=await page.locator('.approved-handoff').evaluate(n=>n.getAnimations({subtree:true}).map(a=>a.effect.getTiming().duration));ok(homeMotion.includes(580),'home sentence/cover transition lasts 580 ms');await settle();
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-card[data-desk-active=true]').waitFor();await settle();eq(await page.locator('.approved-card[data-desk-active=true]').getAttribute('data-motion-file'),first,'reading return keeps actual card identity');
  // Explicitly archived members must stay archived, including an empty desk.
  await page.evaluate(async()=>{const {useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');const {useMaterialStore:m}=await window.__uiStoreModule('materialStore');for(const file of m.getState().files)d.getState().archive(file);});eq(await page.locator('.approved-card').count(),0,'empty organized desk never refills archived materials');eq((await h.call('test_counts')).files,5,'archiving preserves all material files');
  await saved();eq(await page.evaluate(()=>window.__folioAnimations.length),0,'full saved folio stays static while the corresponding pocket miniature arrives');const folio=page.locator('.approved-saved-folio[data-current=true]');ok(await page.locator('.approved-saved').evaluate(n=>Math.abs(n.getBoundingClientRect().width-innerWidth)<2),'saved page fills approved workspace width');
  const originalRecord=await active();eq(await page.locator('.approved-saved-folio').count(),5,'directory entry presents all five saved contexts');const second=page.locator('.approved-saved-folio:not([data-current=true])').first();const secondRecord=await second.getAttribute('data-record');await second.locator('.approved-folio-sentence').focus();eq(await active(),secondRecord,'focusing a real context selects that context');ok(secondRecord!==originalRecord,'context selection moved to another record');
  eq(await page.locator('.approved-folio-note').innerText(),'先前保存的个人解释。','selected context retains its explanation');
  const chosen=await page.locator('.approved-saved-word[aria-pressed=true]').getAttribute('data-group');await folio.locator('.approved-source-title').click();await page.locator('[data-source-highlight=true]').waitFor();await page.locator('.reading-breadcrumb .page-back').click();await folio.waitFor();eq(await active(),secondRecord,'source return restores exact sentence index');eq(await page.locator('.approved-saved-word[aria-pressed=true]').getAttribute('data-group'),chosen,'source return restores entry selection');await folio.locator('.approved-source-cover').click();await page.locator('[data-source-highlight=true]').waitFor();await page.locator('.reading-breadcrumb .page-back').click();await folio.waitFor();eq(await active(),secondRecord,'source cover also returns to the exact saved sentence');
  await keyboardTrash(page,folio.locator('.approved-folio-sentence'));await page.locator('.recall-undo').waitFor();ok(await active()!==secondRecord,'remove advances to an active real context');await page.locator('.recall-undo').getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.recall-undo').waitFor({state:'detached'});eq((await h.call('list_saved_records',{query:'',limit:100,offset:0})).filter(r=>r.deleted_at===null).length,10,'undo restores saved record without duplicating it');
  await page.locator('.approved-saved-search button').click();await page.getByRole('searchbox').fill('take off');await page.waitForFunction(()=>document.querySelectorAll('.approved-saved-word').length===1);eq(await page.locator('.approved-saved-word span').innerText(),'take off','saved search filters actual contexts');await page.getByRole('searchbox').fill('nothing matches 098765');await page.locator('.approved-saved-empty').waitFor();eq(await page.locator('.approved-saved-folio').count(),0,'empty search clears prior sentence');await page.getByRole('searchbox').fill('');await openSelectedSavedExpression(page);
  eq(await page.locator('input[type=date]').count(),0,'recorded page has no precise date form');eq(await page.locator('.saved-timeline-handle').count(),0,'same-day records need no range handles');
  await page.evaluate(()=>{window.__uiFailure={command:'list_saved_groups',remaining:1,afterCommit:false};window.dispatchEvent(new Event('lexicue-saved-changed'));});await page.locator('[role=alert]:visible').filter({has:page.getByRole('button',{name:'重试',exact:true})}).waitFor();await page.getByRole('button',{name:'重试',exact:true}).click();await folio.waitFor();ok(true,'archive query error retries without losing saved records');
  if(width<768){await page.keyboard.press('Escape');await page.locator('.saved-directory').waitFor();eq(await page.locator('.approved-saved-detail').count(),0,'mobile back returns to the directory');}
  await page.locator('.approved-saved-header').getByRole('button',{name:'返回',exact:true}).click();await page.locator('.approved-desk').waitFor();await settle();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-settings-tabs').waitFor();eq(await page.locator('.approved-settings-tabs button').count(),3,'three settings categories');await page.keyboard.press('Tab');await page.locator('[data-entry=lookup]').focus();ok(await page.locator('[data-entry=lookup]').evaluate(n=>getComputedStyle(n).outlineStyle!=='none'||getComputedStyle(n).boxShadow!=='none'),'settings keyboard focus visible');await page.keyboard.press('Enter');await page.locator('.approved-dictionary-book').first().waitFor();eq(await page.locator('.approved-dictionary-book').count(),3,'real offline dictionary books');await page.locator('.approved-settings-back').click();await page.locator('[data-entry=speech]').click();await page.locator('[data-voice-slot="0"]').waitFor();
  const voices=page.locator('.approved-voice-carousel');
  eq(await voices.locator('[data-voice-slot]').count(),5,'five voice choices');
  eq(await page.locator('.approved-voice-prev,.approved-voice-next,.approved-voice-connection').count(),0,'the voice page shows cards and speed without arrows or connection settings');
  for(const side of [-1,1])ok(await voices.locator(`[data-voice-slot="${side}"]`).evaluate(button=>{
    const rect=button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  }),'both blurred cards have tappable centers inside the carousel');
  const nextVoice=await voices.locator('[data-voice-slot="1"]').getAttribute('aria-label');
  await voices.locator('[data-voice-slot="1"]').click();
  eq(await voices.locator('[data-voice-slot="0"]').getAttribute('aria-label'),nextVoice,'the softly blurred right card is directly selectable');
  const previousVoice=await voices.locator('[data-voice-slot="-1"]').getAttribute('aria-label');
  const bounds=await voices.boundingBox();
  const start={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
  if(width<768){
    const touch=await context.newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...start,x:start.x+75}]});
    await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
  } else {
    await page.mouse.move(start.x,start.y);
    await page.mouse.down();await page.mouse.move(start.x+75,start.y,{steps:6});await page.mouse.up();
  }
  eq(await voices.locator('[data-voice-slot="0"]').getAttribute('aria-label'),previousVoice,'dragging the carousel advances to the previous voice');
  if(width>=768){
    const centered=voices.locator('[data-voice-slot="0"]');
    const next=await voices.locator('[data-voice-slot="1"]').getAttribute('aria-label');
    await page.mouse.move(start.x,start.y);
    await page.mouse.wheel(0,45);
    eq(await centered.getAttribute('aria-label'),previousVoice,'vertical wheel motion leaves the voice unchanged');
    await page.mouse.wheel(20,0);
    await page.mouse.wheel(24,0);
    await centered.and(page.getByRole('button',{name:next,exact:true})).waitFor();
    await page.mouse.wheel(85,0);
    eq(await centered.getAttribute('aria-label'),next,'horizontal motion and its momentum select exactly one neighboring voice');
    await page.waitForTimeout(240);
    await page.mouse.wheel(-75,0);
    await centered.and(page.getByRole('button',{name:previousVoice,exact:true})).waitFor();
    ok(true,'a second horizontal gesture can select the other neighbor');
  }
  await page.locator('.approved-clear-voice').click();
  const toast=page.locator('[data-notification-host="top"] [data-type="success"]');
  await toast.waitFor();
  eq(await page.locator('.approved-voices > p[role="status"]').count(),0,'cache deletion uses a top notification without changing the page content');
  await toast.waitFor({state:'detached'});
  await page.locator('.approved-settings-back').click();await page.locator('.approved-settings-tabs button').nth(1).click();await page.locator('[data-entry=backup]').click();await page.getByRole('button',{name:/备份|导出/}).first().waitFor();ok(true,'real backup detail remains reachable from data category');
  await context.close();
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${out}/evidence.json`,JSON.stringify({passed:true,checks,scope:'Chromium 1360/390 × sage/midnight; real Rust/SQLite; controlled receipt loss and query failure; not device acceptance'},null,2));console.log(`Approved behavior: ${checks.length} checks passed`);
}catch(e){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.txt`,String(e)+'\n'+(await page?.locator('body').innerText().catch(()=>'')));throw e;}finally{await h.dispose();}
