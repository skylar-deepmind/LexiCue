/** Actual app reading controls → real Rust TTS/cache → Chromium MP3 events. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/ui-approved-20261027/reading`;
const h=await createReadingHarness(output,['resolve_tts_audio','cancel_tts','clear_tts_cache','invalidate_tts_cache']);
const checks=[],observations=[];let page;
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
const state=page=>page.evaluate(async()=>{const {useSpeechStore}=await window.__uiStoreModule('speechStore');const {key,status,source,error,errorCode,queueActive,queueIndex}=useSpeechStore.getState();return {key,status,source,error,errorCode,queueActive,queueIndex};});
const waitState=async(page,predicate,label)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){const current=await state(page);if(predicate(current))return current;if(current.status==='error')throw Error(`${label}: ${current.errorCode}`);await page.waitForTimeout(30);}throw Error(`Timed out: ${label}; ${JSON.stringify(await state(page))}`);};
const ttsCalls=page=>page.evaluate(()=>window.__uiCalls.filter(call=>call.command==='resolve_tts_audio'));
const visibleHeadphone=page=>page.locator('.b-dock .dock-reading-tools button').first();
async function instrument(page,theme){
 await h.fixture(page,theme);
 await page.addInitScript(()=>{
  window.__speechMedia=[];window.__speechAudio=[];window.__ttsHoldNext=0;window.__ttsHeld=[];
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){const id=window.__speechAudio.length;window.__speechAudio.push(this);window.__speechMedia.push({event:'play',id});for(const event of ['loadedmetadata','playing','ended','error'])this.addEventListener(event,()=>window.__speechMedia.push({event,id,duration:this.duration,error:this.error?.code}));return play.call(this);};
  const invoke=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
   const held=command==='resolve_tts_audio'&&window.__ttsHoldNext>0;
   if(held)window.__ttsHoldNext--;
   const result=await invoke(command,args);
   if(held)await new Promise(resolve=>window.__ttsHeld.push({resolve,requestId:args.request.requestId}));
   return result;
  };
 });
}
async function setSpeechPrefs(page){await page.evaluate(async()=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setSpeech({accent:'us',speed:'normal',onlineEnabled:true,allowDeviceFallback:false,voices:{us:'en-US-JennyNeural',gb:'en-GB-SoniaNeural'}});});}
const releaseHeld=page=>page.evaluate(()=>{for(const held of window.__ttsHeld.splice(0).reverse())held.resolve();});
async function verifyFontMetrics(page,headphone,label){
 await page.locator('.reader-scroll').evaluate(node=>node.scrollTop=0);
 for(const size of ['sm','md','lg'])for(const lines of ['compact','normal','loose']){
  await page.evaluate(async({size,lines})=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setLearningTextFontSize(size);usePreferencesStore.getState().setReadingLineHeight(lines);},{size,lines});
  await page.waitForFunction(({size,lines})=>{const node=document.querySelector('.reading-paper');return node?.dataset.font===size&&node?.dataset.lines===lines;},{size,lines});
  const paragraph=page.locator('[data-sentence="2"] .reading-original');
  const before=await paragraph.boundingBox();await headphone.click();await page.locator('.reading-page[data-listening="true"]').waitFor();const during=await paragraph.boundingBox();
  await headphone.click();await page.locator('.reading-page[data-listening="false"]').waitFor();const after=await paragraph.boundingBox();
  check(['x','y','width','height'].every(key=>Math.abs(before[key]-during[key])<1&&Math.abs(before[key]-after[key])<1),`${label}: ${size}/${lines} preserves position/wrapping in both directions: ${JSON.stringify({before,during,after})}`);
 }
}

try{
 const token=randomUUID();
 const sentences=Array.from({length:85},(_,index)=>({index,en_text:index===0?'Hello.':index===1?'We can listen to this sentence and continue reading the next one without another click.':index===2?'Curiosity helps us notice how the same word changes its meaning in a new sentence.':index===84?`This unique reading fixture has the identifier ${token}.`:'Welcome.',zh_text:index<3?['你好。','我们可以继续朗读下一句。','好奇心帮助我们留意词义。'][index]:null}));
 const imported=await h.call('import_reading_material',{input:{operation_id:`ui-approved-reading-${token}`,name:`Reading interaction ${token}.txt`,content:sentences.map(item=>item.en_text).join('\n'),segments:sentences}});
 for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext({viewport:{width:1120,height:900}});page=await context.newPage();await instrument(page,theme);
  await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();await setSpeechPrefs(page);
  check(await page.locator('.sentence-listen').count()===0,`${theme}: ordinary reading has no persistent play controls`);
  check(await page.locator('.reader-tools').count()===0,`${theme}: no top playback/display toolbar`);
  await page.locator('[data-sentence="2"] .reading-word').filter({hasText:/^Curiosity$/}).click();await page.locator('.lookup-heading h2').waitFor();
  check((await page.locator('.lookup-heading h2').innerText()).toLowerCase().includes('curiosity'),`${theme}: existing word lookup works before listening`);
  const initialLookupCalls=await page.evaluate(()=>window.__uiCalls.filter(call=>call.command.startsWith('lookup_')).length);
  await visibleHeadphone(page).click();
  await waitState(page,s=>s.status==='playing'&&s.queueIndex===0,`${theme} first sentence starts from one click`);
  check(await page.locator('.lookup-heading').count()===0,`${theme}: starting from open lookup preserves new queue after panel cleanup`);
  check(await page.locator('.reading-page').getAttribute('data-listening')==='true',`${theme}: one click enters listening mode`);
  check((await ttsCalls(page))[0].args.request.text==='Hello.',`${theme}: queue begins at full material start`);
  check(await page.locator('.reading-word').count()===0,`${theme}: listening body clicks target sentences`);
  await waitState(page,s=>s.status==='playing'&&s.queueIndex===1,`${theme} actual first audio end advances`);
  check(await page.evaluate(()=>window.__speechMedia.some(event=>event.event==='ended'&&event.id===0)),`${theme}: next request follows actual MP3 ended event`);
  const row=page.locator('[data-sentence="2"]'),number=row.locator('.sentence-number'),icon=row.locator('.sentence-play');
  await page.mouse.move(1050,60);const before=await row.locator('.reading-original').boundingBox();
  check(await number.evaluate(n=>getComputedStyle(n).opacity)==='1',`${theme}: idle sentence shows its number`);
  await row.locator('.reading-original').hover();
  check(await icon.evaluate(n=>getComputedStyle(n).opacity)==='1'&&await number.evaluate(n=>getComputedStyle(n).opacity)==='0',`${theme}: hovering sentence replaces number with play icon`);
  const after=await row.locator('.reading-original').boundingBox();
  check(Math.abs(before.x-after.x)<.1&&Math.abs(before.y-after.y)<.1,`${theme}: hover replacement does not move sentence`);
  await page.screenshot({path:`${output}/${theme}-listening-hover.png`});
  await page.mouse.move(1050,60);check(await number.evaluate(n=>getComputedStyle(n).opacity)==='1',`${theme}: leaving sentence restores number`);
  await row.locator('.sentence-listen').focus();await page.keyboard.press('ArrowRight');
  check(await icon.evaluate(n=>getComputedStyle(n).opacity)==='1',`${theme}: keyboard focus exposes equivalent play affordance`);
  await page.keyboard.press('Enter');await waitState(page,s=>s.status==='playing'&&s.queueIndex===2,`${theme} keyboard sentence jump`);
  await page.locator('[data-sentence="1"] .reading-original').click();await waitState(page,s=>s.status==='playing'&&s.queueIndex===1,`${theme} body click jumps immediately`);
  const wordLookups=(await page.evaluate(()=>window.__uiCalls.filter(call=>call.command.startsWith('lookup_')).length));
  check(wordLookups===initialLookupCalls,`${theme}: listening sentence body does not open another lookup`);
  await visibleHeadphone(page).click();check((await state(page)).status==='idle',`${theme}: second headphone click cancels queue`);
  check(await page.locator('.sentence-listen').count()===0&&await page.locator('.reading-word').count()>0,`${theme}: exiting restores ordinary word controls`);
  await page.locator('[data-sentence="2"] .reading-word').filter({hasText:/^Curiosity$/}).click();await page.locator('.lookup-heading h2').waitFor();await page.keyboard.press('Escape');await page.locator('.lookup-heading').waitFor({state:'hidden'});
  await page.waitForTimeout(450);const modeBefore=await page.locator('[data-sentence="2"] .reading-original').boundingBox();
  await visibleHeadphone(page).click();await waitState(page,s=>s.status==='playing',`${theme} mode stability check`);
  const modeAfter=await page.locator('[data-sentence="2"] .reading-original').boundingBox();
  check(Math.abs(modeBefore.x-modeAfter.x)<1&&Math.abs(modeBefore.y-modeAfter.y)<1,`${theme}: changing reading mode preserves sentence position: ${JSON.stringify({modeBefore,modeAfter})}`);await visibleHeadphone(page).click();
  // Hold an already successful native audio result: even a late successful response
  // must not replace the sentence chosen by a subsequent click.
  await page.evaluate(()=>window.__ttsHoldNext=2);await visibleHeadphone(page).click();await page.waitForFunction(()=>window.__ttsHeld.length===1);
  await page.locator('[data-sentence="1"] .reading-original').click();await page.waitForFunction(()=>window.__ttsHeld.length===2);
  await page.locator('[data-sentence="2"] .reading-original').click();await waitState(page,s=>s.status==='playing'&&s.queueIndex===2,`${theme} jump while old successful result is held`);
  const playsBeforeRelease=await page.evaluate(()=>window.__speechAudio.length);await releaseHeld(page);await page.waitForTimeout(250);
  check((await state(page)).queueIndex===2&&await page.evaluate(()=>window.__speechAudio.length)===playsBeforeRelease,`${theme}: late successful response cannot override jumped sentence`);
  await visibleHeadphone(page).click();
  await page.evaluate(()=>window.__ttsHoldNext=1);await visibleHeadphone(page).click();await page.waitForFunction(()=>window.__ttsHeld.length===1);
  const beforeStop=await page.evaluate(()=>window.__speechAudio.length);await visibleHeadphone(page).click();await releaseHeld(page);await page.waitForTimeout(250);
  check((await state(page)).status==='idle'&&await page.evaluate(()=>window.__speechAudio.length)===beforeStop,`${theme}: late successful response cannot play after explicit exit`);
  await page.evaluate(()=>window.__ttsHoldNext=1);await visibleHeadphone(page).click();await page.waitForFunction(()=>window.__ttsHeld.length===1);
  const beforeRoute=await page.evaluate(()=>window.__speechAudio.length);await page.locator('.b-dock a[href="/files"]').click();await page.locator('.materials-page').waitFor();await releaseHeld(page);await page.waitForTimeout(250);
  check((await state(page)).status==='idle'&&await page.evaluate(()=>window.__speechAudio.length)===beforeRoute,`${theme}: route exit rejects late audio`);
  check(await page.locator('.b-dock .dock-reading-tools').isHidden(),`${theme}: reading tools collapse outside reading`);
  observations.push({theme,phase:'initial interactions and cancellation',media:await page.evaluate(()=>window.__speechMedia),requests:(await ttsCalls(page)).map(call=>({requestId:call.args.request.requestId,textLength:call.args.request.text.length}))});
  await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();await setSpeechPrefs(page);
  await visibleHeadphone(page).click();await waitState(page,s=>s.status==='playing',`${theme} restart after route return`);
  // A far row remains an ordinary UI target; completing it crosses the old
  // sixty-sentence boundary using the same real player and complete queue.
  await page.locator('[data-sentence="64"]').scrollIntoViewIfNeeded();await page.locator('[data-sentence="64"] .sentence-listen').click();await waitState(page,s=>s.status==='playing'&&s.queueIndex===64,`${theme} jump beyond first sixty`);
  await page.evaluate(()=>{const audio=window.__speechAudio.at(-1);audio.currentTime=Math.max(0,audio.duration-.03);});
  await waitState(page,s=>s.status==='playing'&&s.queueIndex===65,`${theme} real audio ends beyond sixty`);
  check((await ttsCalls(page)).at(-1).args.request.text==='Welcome.',`${theme}: full queue continues beyond first sixty rendered sentences`);
  await visibleHeadphone(page).click();
  await verifyFontMetrics(page,visibleHeadphone(page),theme);
  check(!await page.evaluate(()=>window.__speechMedia.some(event=>event.event==='error')),`${theme}: real MP3 decode succeeds without media errors`);
  observations.push({theme,phase:'past sixty sentences',final:await state(page),media:await page.evaluate(()=>window.__speechMedia),requests:(await ttsCalls(page)).map(call=>({requestId:call.args.request.requestId,textLength:call.args.request.text.length}))});
  await context.close();
 }
 const context=await h.browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page=await context.newPage();await instrument(page,'midnight');
 await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();await setSpeechPrefs(page);
 const mobileHeadphone=page.locator('.mobile-reading-tools .dock-reading-tools button').first();
 check(await mobileHeadphone.isVisible(),'touch: existing mobile navigation exposes reading tools');
 const touchBefore=await page.locator('[data-sentence="1"] .reading-original').boundingBox();
 await mobileHeadphone.tap();await waitState(page,s=>s.status==='playing','touch one click begins playback');
 const touchAfter=await page.locator('[data-sentence="1"] .reading-original').boundingBox();
 check(Math.abs(touchBefore.x-touchAfter.x)<1&&Math.abs(touchBefore.y-touchAfter.y)<1&&Math.abs(touchBefore.height-touchAfter.height)<1,`touch: mode preserves sentence position and wrapping: ${JSON.stringify({touchBefore,touchAfter})}`);
 const touchRow=page.locator('[data-sentence="1"]');
 check(await touchRow.locator('.sentence-play').evaluate(n=>getComputedStyle(n).opacity)==='1','touch: sentence play icon is visible without hover');
 await touchRow.locator('.sentence-listen').tap();await waitState(page,s=>s.status==='playing'&&s.queueIndex===1,'touch sentence action jumps');
 await page.screenshot({path:`${output}/midnight-touch-listening.png`});
 await mobileHeadphone.tap();check((await state(page)).status==='idle','touch: repeat tap stops playback');
 await verifyFontMetrics(page,mobileHeadphone,'touch');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'touch: reading has no horizontal overflow');
 await context.close();
 check(h.errors.length===0,'no browser exceptions');
 const sourceHashes=Object.fromEntries(await Promise.all(['src/stores/speechStore.ts','src/pages/ReadingPage.tsx','src/components/ReadingTools.tsx','src/reading.css'].map(async path=>[path,createHash('sha256').update(await readFile(`${root}/${path}`)).digest('hex')])));
 await writeFile(`${output}/ui-validation.json`,JSON.stringify({passed:true,kind:'actual Vite app + real Rust TTS/cache + Chromium real MP3 events; controlled delays hold successful native responses, playback is not mocked',sourceHashes,checks,observations,errors:h.errors},null,2));
 await Promise.all(['ui-failure.png','ui-failure.json'].map(name=>rm(`${output}/${name}`,{force:true})));
 console.log(`Reading mode UI: ${checks.length} checks passed.`);
}catch(error){if(page){await page.screenshot({path:`${output}/ui-failure.png`}).catch(()=>{});await writeFile(`${output}/ui-failure.json`,JSON.stringify({message:String(error),state:await state(page).catch(()=>null),text:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
