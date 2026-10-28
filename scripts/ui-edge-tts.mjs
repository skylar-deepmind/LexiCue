/** Browser UI → isolated real Rust service/cache → Edge; media is never mocked. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=`${root}/docs/implementation/evidence/edge-tts-v1`;
const h=await createReadingHarness(output,['resolve_tts_audio','cancel_tts','clear_tts_cache','invalidate_tts_cache']);
let page;const checks=[];const observations=[];
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
const setPrefs=(page,patch)=>page.evaluate(async patch=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setSpeech(patch);},patch);
const speech=page=>page.evaluate(async()=>{const {useSpeechStore}=await window.__uiStoreModule('speechStore');const {key,status,source,error,errorCode}=useSpeechStore.getState();return {key,status,source,error,errorCode};});
const stop=page=>page.evaluate(async()=>{const {useSpeechStore}=await window.__uiStoreModule('speechStore');useSpeechStore.getState().stop();});
const waitPlaying=async page=>{const end=Date.now()+20000;while(Date.now()<end){const state=await speech(page);if(state.status==='playing')return;if(state.status==='error')throw Error(`Speech failed: ${state.errorCode}`);await new Promise(done=>setTimeout(done,50));}throw Error('Speech did not start within 20s');};
async function contrast(locator){return locator.evaluate(node=>{
 const rgb=value=>value.match(/[\d.]+/g)?.slice(0,3).map(Number);
 const luminance=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 let background;for(let el=node;el;el=el.parentElement){const value=getComputedStyle(el).backgroundColor;if(!value.includes('rgba')&&!value.includes('transparent')){background=rgb(value);break;}}
 const fg=luminance(rgb(getComputedStyle(node).color)),bg=luminance(background??[255,255,255]);return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
});}
async function choose(id,name){await page.locator(`#${id}`).click();await page.getByRole('option',{name,exact:true}).click();}
try{
 const text='Curiosity helped us record the US visit. We will take off at noon.';
 const imported=await h.call('import_reading_material',{input:{operation_id:'edge-ui',name:'speech.srt',content:`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,segments:[{index:0,en_text:text,zh_text:'不应该发送此翻译',start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});
 for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext({viewport:{width:1100,height:800}});page=await context.newPage();await h.fixture(page,theme);
  await page.addInitScript(()=>{
   window.__speechMedia=[];
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){window.__speechMedia.push({event:'play',mime:this.src.slice(0,25)});for(const event of ['playing','loadedmetadata','ended','error'])this.addEventListener(event,()=>window.__speechMedia.push({event,duration:this.duration,readyState:this.readyState,error:this.error?.code}));return play.call(this);};
  });
  await page.goto(`${h.url}/settings`);await page.locator('.speech-settings').waitFor();
  await setPrefs(page,{accent:'us',speed:'normal',onlineEnabled:true,allowDeviceFallback:false,voices:{us:'en-US-JennyNeural',gb:'en-GB-SoniaNeural'}});
  const preview=page.locator('[data-speech-key="settings:speech-preview"]');
  check((await page.locator('#speech-voice').innerText()).includes('Jenny'),`${theme}: initial Jenny`);
  check((await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='resolve_tts_audio').length))===0,`${theme}: settings do not generate automatically`);
  await page.locator('#speech-voice').click();check((await page.getByRole('option').allTextContents()).length===3,`${theme}: exactly three US voices`);await page.keyboard.press('Escape');
  await choose('speech-accent','英音');await page.locator('#speech-voice').click();const gb=await page.getByRole('option').allTextContents();check(gb.length===2&&gb.join().includes('Sonia')&&gb.join().includes('Ryan'),`${theme}: exactly two UK voices`);await page.keyboard.press('Escape');
  await choose('speech-voice','Ryan · 男声');await choose('speech-accent','美音');check((await page.locator('#speech-voice').innerText()).includes('Jenny'),`${theme}: per-accent voice memory`);
  await choose('speech-accent','英音');check((await page.locator('#speech-voice').innerText()).includes('Ryan'),`${theme}: UK memory`);await choose('speech-accent','美音');
  for(const state of ['default','hover','focus','selected','disabled']){
   if(state==='hover')await preview.hover();if(state==='focus'){await page.keyboard.press('Tab');await preview.focus();check(await preview.evaluate(n=>getComputedStyle(n).outlineStyle)==='solid',`${theme}: keyboard focus ring`);}
   if(state==='selected')await preview.evaluate(n=>n.setAttribute('aria-pressed','true'));
   if(state==='disabled')await preview.evaluate(n=>{n.setAttribute('aria-pressed','false');n.disabled=true;});
   check(await contrast(preview)>=4.5,`${theme}: ${state} readable contrast`);
   if(state==='disabled')await preview.evaluate(n=>{n.disabled=false;});
  }
  await preview.evaluate(n=>n.setAttribute('aria-pressed','false'));
  await preview.click();await waitPlaying(page);let state=await speech(page);check(['edge-network','edge-cache'].includes(state.source),`${theme}: preview uses Edge`);observations.push({theme,preview:state});
  await page.screenshot({path:`${output}/${theme}-settings-playing.png`});await preview.click();check((await speech(page)).status==='idle',`${theme}: repeat click stops`);
  // Replay with online requests disabled proves the exact preference-key cache path.
  await setPrefs(page,{onlineEnabled:false});await preview.click();await waitPlaying(page);check((await speech(page)).source==='edge-cache',`${theme}: offline cache replay`);await stop(page);
  await setPrefs(page,{onlineEnabled:true});await preview.click();await waitPlaying(page);await choose('speech-speed','慢速');check((await speech(page)).status==='idle',`${theme}: preference change stops playback`);
  await page.reload();await page.locator('.speech-settings').waitFor();check((await page.locator('#speech-speed').innerText()).includes('慢速'),`${theme}: persisted speed after reload`);
  await setPrefs(page,{speed:'normal',allowDeviceFallback:false});
  for(const viewport of [{width:375,height:812},{width:844,height:390},{width:768,height:1024}]){
   await page.setViewportSize(viewport);await page.locator('.speech-settings').scrollIntoViewIfNeeded();
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: ${viewport.width} no horizontal overflow`);
   check(await preview.evaluate(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;}),`${theme}: ${viewport.width} touch target`);
   await page.screenshot({path:`${output}/${theme}-settings-${viewport.width}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});check(await preview.evaluate(n=>{const s=document.createElement('i');s.className='speech-spinner';n.append(s);const v=getComputedStyle(s).animationName;s.remove();return v==='none';}),`${theme}: reduced motion`);
  await page.setViewportSize({width:1100,height:800});await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();
  await page.locator('.reading-word').filter({hasText:/^Curiosity$/}).first().click();await page.locator('[data-speech-key="lookup:term"]').click();await waitPlaying(page);check(['edge-network','edge-cache'].includes((await speech(page)).source),`${theme}: selected word Edge`);await stop(page);
  await page.locator('[data-speech-key="lookup:sentence"]').click();await waitPlaying(page);check(['edge-network','edge-cache'].includes((await speech(page)).source),`${theme}: original sentence Edge`);await page.screenshot({path:`${output}/${theme}-reading-playing.png`});
  await page.keyboard.press('Escape');check((await speech(page)).status==='idle',`${theme}: close panel stops`);
  const take=page.locator('.reading-word').filter({hasText:/^take$/}).first();await take.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');await page.locator('.lookup-heading h2').filter({hasText:/^take off$/}).waitFor();await page.locator('[data-speech-key="lookup:term"]').click();await waitPlaying(page);check(['edge-network','edge-cache'].includes((await speech(page)).source),`${theme}: selected phrase Edge`);await stop(page);await page.keyboard.press('Escape');
  await page.locator('.b-dock .dock-reading-tools > button').first().click();await waitPlaying(page);check(['edge-network','edge-cache'].includes((await speech(page)).source),`${theme}: reading row Edge`);
  const calls=await page.evaluate(()=>window.__uiCalls.filter(c=>c.command==='resolve_tts_audio').map(c=>c.args.request));
  check(calls.every(c=>!c.text.includes('不应该')&&!c.text.includes('翻译')),`${theme}: only requested English sent`);
  const media=await page.evaluate(()=>window.__speechMedia);check(media.some(e=>e.event==='playing')&&!media.some(e=>e.event==='error'),`${theme}: actual MP3 decoding/playback events`);
  observations.push({theme,calls:calls.map(({text,...params})=>({...params,textLength:text.length})),media});
  await page.locator('.b-dock a[href="/settings"]').click();await page.locator('.speech-settings').waitFor();check((await speech(page)).status==='idle',`${theme}: navigation stops`);await context.close();
 }
 check(h.errors.length===0,'no browser exceptions');
 const sourceHashes=Object.fromEntries(await Promise.all(['src-tauri/src/commands/tts.rs','src/stores/speechStore.ts','src/components/SpeechButton.tsx','src/components/SpeechSettings.tsx'].map(async path=>[path,createHash('sha256').update(await readFile(`${root}/${path}`)).digest('hex')])));
 await writeFile(`${output}/ui-validation.json`,JSON.stringify({passed:true,kind:'real Rust Edge/cache + Chromium media decoding over test-only loopback bridge; not installed WebView/device verification',sourceHashes,checks,observations,errors:h.errors},null,2));
 console.log(`Edge TTS UI: ${checks.length} checks passed.`);
}catch(error){if(page){await page.screenshot({path:`${output}/ui-failure.png`}).catch(()=>{});await writeFile(`${output}/ui-failure.json`,JSON.stringify({message:String(error),state:await speech(page).catch(()=>null),text:await page.locator('body').innerText(),calls:await page.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
