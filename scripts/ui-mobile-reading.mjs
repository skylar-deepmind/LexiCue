/** Approved mobile reading: actual Rust/SQLite, controlled external-provider boundary.
 * This replaces obsolete shelf/dock geometry; the historical suite is retained. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_MOBILE_OUTPUT||'/tmp/lexicue-mobile-ui';await mkdir(output,{recursive:true});
const h=await createReadingHarness(output),checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);},eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const geometry=page=>page.locator('.reading-original').first().evaluate(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),sc=document.querySelector('.reader-scroll');return {x:r.x,y:r.y,width:r.width,font:s.fontSize,line:s.lineHeight,scroll:sc.scrollTop};});
const settled=page=>page.waitForFunction(()=>!document.querySelector('.reading-layout[data-lookup-moving]'));
const drawerFrame=page=>page.locator('.context-panel').evaluate(node=>{
 const {x,y,width,height}=node.getBoundingClientRect();
 return [x,y,width,height];
});
const sourceBottom=word=>word.evaluate(n=>n.getBoundingClientRect().bottom);
async function checkLookupSource(page,word,before,beforeBottom,label){
 const after=await geometry(page), [,sheetTop]=await drawerFrame(page);
 const offset=after.scroll-before.scroll;
 eq([after.x,after.width,after.font,after.line],[before.x,before.width,before.font,before.line],`${label}: preserves source measure and typography`);
 ok(Math.abs(after.y+offset-before.y)<.5,`${label}: only the scroller changes the source position`);
 if(beforeBottom<=sheetTop)eq(offset,0,`${label}: an already visible word stays in place`);
 else ok(offset>0 && await sourceBottom(word)<=sheetTop,`${label}: a covered word scrolls into view`);
}
const lookupShown=(page,term)=>page.waitForFunction(term=>{
 const heading=document.querySelector('.lookup-heading h2');
 const stage=heading?.closest('.lookup-stage');
 const content=stage?.querySelector('.soft-refresh');
 return heading?.textContent===term&&stage.dataset.lookupState==='ready'&&content.dataset.refreshState==='ready';
},term);

try{
 for(const theme of ['sage','midnight']){
  await h.call('test_reset');
  const rows=Array.from({length:45},(_,index)=>({index,en_text:`The plane will take off soon. We waited for the morning light. Paragraph ${index+1}.`,zh_text:'飞机即将起飞。我们等待清晨的阳光。',start_time:null,end_time:null}));
  const material=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:'The morning journey.txt',content:rows.map(r=>r.en_text).join('\n'),segments:rows,normalized_kind:'txt'}});
  const source=await h.call('open_reading_material',{fileId:material.file_id});
  for(const segment of source.segments.slice(0,2)){
   const start=segment.en_text.indexOf('take');
   await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{
    segment_id:segment.id,expression:'take',start_offset:start,end_offset:start+4,
    explanation:'保留侧袋笔记',explanation_source:'personal',
   }}});
  }
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:667,height:375},{width:1161,height:820},{width:1254,height:820}]){
   const phone=viewport.width<768;const context=await h.browser.newContext({viewport,hasTouch:phone,isMobile:phone});page=await context.newPage();if(viewport.width===390){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:51,bottom:34,left:0,right:0}});}await h.fixture(page,theme);await page.routeWebSocket('**',socket=>socket.close());
   await page.addInitScript(()=>{localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));const base=window.__TAURI_INTERNALS__.invoke;window.__supplementMode='empty';window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{if(command==='lookup_cambridge_expression'){window.__uiCalls.push({command,args:structuredClone(args)});await new Promise(r=>setTimeout(r,800));if(window.__supplementMode==='error')throw Error('controlled online unavailable');if(window.__supplementMode==='success')return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'found',default_entry_id:'cambridge:ui-fixture',notices:[],entries:[{id:'cambridge:ui-fixture',headword:args.expression,kind:'word',origin:'headword',expression_type:null,parent_headword:null,source:{provider:'cambridge',dataset:'Controlled UI provider fixture',edition:null,release:null,adapter_version:'controlled-ui-fixture',entry_key:args.expression,locator:null,delivery:'online',entry_url:'https://dictionary.cambridge.org/dictionary/english/take',retrieved_at:'2026-11-16T00:00:00Z'},match:{type:'exact',pattern:null,note:null,sense_ids:[]},groups:[{id:'cambridge:ui-group',part_of_speech:'verb',source_part_of_speech:'verb',pronunciations:[],forms:[],labels:[],notes:[],senses:[{id:'cambridge:ui-sense',meaning:{en:'A controlled additional meaning for this lookup.',zh:'补充的独立用法。'},labels:[],patterns:[],examples:[],notes:[]}]}],notes:[],related_expressions:[]}]};return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'not_found',entries:[],default_entry_id:null,notices:[]};}return base(command,args);};});
   await page.goto(`${h.url}/files/${material.file_id}`);await page.locator('.reading-original').first().waitFor();await page.locator('.mobile-startup').waitFor({state:'detached'});
   await page.evaluate(async()=>{const {usePreferencesStore:p}=await window.__uiStoreModule('preferencesStore');p.getState().setLearningTextFontSize('lg');p.getState().setReadingLineHeight('loose');});
   await page.evaluate(async()=>{
    await document.fonts.ready;
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
   });await page.waitForFunction(()=>!document.querySelector('[data-reading-anchoring]'));
   ok(await page.locator('.reading-title').evaluate(n=>n.getBoundingClientRect().top>=document.querySelector('.reading-breadcrumb').getBoundingClientRect().bottom),'reading title clears the back control and safe area');
   const bar=page.locator('.mobile-reading-bar');ok(await bar.evaluate(n=>{const r=n.getBoundingClientRect();const b=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect());return Math.round(r.width)===106&&b.length===2&&b.every(b=>b.left>=r.left&&b.right<=r.right+1&&b.width>=44);}), 'floating reading controls fit their 106 px capsule');
   const take=page.locator('.reading-word').filter({hasText:/^take$/}).first();await take.scrollIntoViewIfNeeded();const clickedGeometry=await geometry(page),clickedBottom=await sourceBottom(take);await take.click();await page.locator('.context-panel').waitFor();await settled(page);
   if(phone)await checkLookupSource(page,take,clickedGeometry,clickedBottom,`${theme}/${viewport.width} half drawer`);
   await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();
   if(!phone){
    await page.waitForFunction(()=>!document.querySelector('.reading-paper').getAnimations().some(a=>a.playState==='running'));
    const bounds=await page.evaluate(()=>{
      const back=document.querySelector('.reading-breadcrumb .page-back').getBoundingClientRect();
      const title=document.querySelector('.reading-title').getBoundingClientRect();
      const body=document.querySelector('.reading-original').getBoundingClientRect();
      return {back:back.left+back.width/2,title:title.left,body:body.left};
    });
    ok(Math.min(bounds.title,bounds.body)>=bounds.back-.5,'desktop title and prose stay at or to the right of the back icon');
    ok(Math.abs((await geometry(page)).width-clickedGeometry.width)<.5,'opening the drawer preserves the desktop prose measure');
   }
   const fixed=await drawerFrame(page);
   const content=page.locator('.soft-refresh-current:not([inert])');
   eq(await content.locator('.dictionary-pos-count, details.pos-group').count(),0,'lookup shows all senses without a disclosure trigger');
   eq(await page.locator('.lookup-heading h2').innerText(),'take','the query is the primary headword');
   const markers=page.locator('.word-families .dictionary-entry').first().locator('.dictionary-pos-heading [data-pos]');
   const highlights=await markers.evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundImage));
   ok(highlights.length>=2&&highlights.every(color=>color!=='none')&&new Set(highlights).size===highlights.length,
    'the visible parts of speech use distinct marker colors');
   ok(await page.locator('.word-families .dictionary-entry').evaluateAll(entries=>entries.every(entry=>{
    const labels=[...entry.querySelectorAll('.dictionary-pos-heading .dictionary-meaning-pos')].map(label=>label.textContent);
    return new Set(labels).size===labels.length;
   })),'same-headword senses share one heading per part of speech');
   eq(await content.locator('.longman-ipa,.longman-example').count(),0,'dictionary lookup omits phonetics and examples');
   ok(await content.evaluate(node=>{
    const ids=[...node.querySelectorAll('[data-sense-id]')].map(item=>item.dataset.senseId);
    return ids.length>3&&ids.length===new Set(ids).size;
   }),'all senses are rendered once immediately');
   ok(await content.locator('.dictionary-pos-group').evaluateAll(groups=>groups.every(group=>{
    const list=group.querySelector('.dictionary-meanings');
    const forms=group.querySelector('.dictionary-pos-forms');
    return list.start===1 && (list.children.length===1 || getComputedStyle(list).listStyleType==='decimal') &&
      (!forms || group.lastElementChild===forms) && getComputedStyle(group).borderTopWidth==='0px';
   })),'definitions restart for each part of speech and any forms appear last without dividers');
   if(phone&&viewport.width===390)await page.screenshot({path:`${output}/${theme}-dictionary-full.png`});
   await content.evaluate(node=>{node.scrollTop=node.scrollHeight;});
   ok(await content.evaluate(node=>node.scrollTop>0),'long dictionary contents scroll inside the fixed drawer');
   eq(await drawerFrame(page),fixed,'scrolling the result leaves the card fixed');
   await page.evaluate(()=>{
    const panel=document.querySelector('.context-panel');
    window.__drawerFrames=[];
    const sample=()=>{const {x,y,width,height}=panel.getBoundingClientRect();window.__drawerFrames.push([x,y,width,height]);window.__drawerFrameHandle=requestAnimationFrame(sample);};
    window.__drawerFrameHandle=requestAnimationFrame(sample);
    window.__uiDelayExpression='plane';window.__uiLookupDelayMs=350;
   });
   await page.locator('.reading-word').filter({hasText:/^plane$/}).first().click();
   await page.locator('.soft-refresh[data-refresh-state=waiting]').waitFor();
   await lookupShown(page,'plane');
   await take.click();
   await lookupShown(page,'take');
   const frames=await page.evaluate(()=>{cancelAnimationFrame(window.__drawerFrameHandle);delete window.__uiDelayExpression;return window.__drawerFrames;});
   ok(frames.length>5&&frames.every(frame=>frame.every((value,index)=>Math.abs(value-fixed[index])<.25)),`${theme}/${viewport.width}: short/long lookups keep the drawer frame during loading and throughout reveal`);
   await page.locator('.quiet-pocket').click();
   await page.waitForFunction(()=>document.querySelector('.lookup-stage')?.dataset.face==='records'&&document.querySelector('.soft-refresh')?.dataset.refreshState==='ready');
   eq(await drawerFrame(page),fixed,'switching to records keeps the same drawer size');
   const records=page.locator('.soft-refresh-current .saved-sentence');
   await records.nth(1).waitFor();
   eq(await records.locator('.saved-sentence-translation').allTextContents(),rows.slice(0,2).map(row=>row.zh_text),'existing Chinese translations open by default');
   eq(await records.locator('.saved-sentence-source').allTextContents(),Array(2).fill('The morning journey.txt'),'source lines contain only the filename');
   eq(await records.locator('.saved-sentence-note').allTextContents(),Array(2).fill('保留侧袋笔记'),'existing personal notes remain visible');
   eq(await records.locator('.saved-sentence-play').count(),0,'no row is selected when opening records');
   const next=records.nth(1),original=next.locator('.saved-sentence-original');
   if(phone)await original.tap();else await original.click();
   const play=next.locator('.saved-sentence-play');
   await play.waitFor();
   eq(await records.locator('.saved-sentence-play').count(),1,'only the selected row has a play button');
   ok(await play.evaluate(button=>{
    const r=button.getBoundingClientRect(),row=button.closest('.saved-sentence-row'),b=row.getBoundingClientRect();
    return r.width>=44&&r.height>=44&&Math.abs(r.y+r.height/2-b.y-b.height/2)<1&&
      getComputedStyle(row).backgroundColor!=='rgba(0, 0, 0, 0)';
   }),'play sits in the center of the highlighted row with a full touch target');
   const transparent=()=>play.evaluate(button=>getComputedStyle(button).backgroundColor==='rgba(0, 0, 0, 0)');
   ok(await transparent(),'idle play is transparent');
   if(!phone){await play.hover();ok(await transparent(),'hovered play is transparent');}
   await page.evaluate(async()=>{
    const {useSpeechStore}=await window.__uiStoreModule('speechStore');
    const player=useSpeechStore.getState();
    window.__originalSpeak=player.speak;
    useSpeechStore.setState({speak:async(text,key,options)=>{
     window.__sentenceRead={text,key,kind:options.kind};
     useSpeechStore.setState({key,owner:options.owner,status:'playing'});
    }});
   });
   if(phone)await play.tap();
   else {
    await page.keyboard.press('Tab');await original.focus();await page.keyboard.press('Tab');
    ok(await play.evaluate(button=>{const style=getComputedStyle(button);return button===document.activeElement&&style.outlineStyle==='none'&&style.boxShadow.includes('inset');}),'keyboard reaches play with an inset focus indicator');
    await play.hover();await page.mouse.down();ok(await transparent(),'pressed play is transparent');await page.mouse.up();
   }
   await next.locator('.saved-sentence-play[data-speech-state=playing]').waitFor();
   ok(await transparent(),'playing keeps the button transparent');
   const read=await page.evaluate(()=>window.__sentenceRead);
   eq(read.text,await original.textContent(),'play hands off the selected full English sentence');
   eq(read.kind,'sentence','play uses sentence speech');
   if(viewport.width===390||viewport.width===1161)await page.screenshot({path:`${output}/${theme}-${viewport.width}-pocket-playing.png`});
   await page.evaluate(async()=>{const {useSpeechStore}=await window.__uiStoreModule('speechStore');useSpeechStore.setState({speak:window.__originalSpeak});});
   await page.locator('.quiet-pocket').click();
   await lookupShown(page,'take');
   eq(await page.locator('.approved-lookup-map').count(),0,'the lookup uses only local dictionary data');
   const beforeSizeControls=await geometry(page);
   if(phone){
    await page.locator('.context-sheet-expand').click();await page.locator('.context-panel[data-expanded="true"]').waitFor();await settled(page);eq(await geometry(page),beforeSizeControls,'expanded drawer preserves original geometry and scroll');
    await page.locator('.context-sheet-expand').click();await page.locator('.context-panel[data-expanded="false"]').waitFor();await settled(page);eq(await geometry(page),beforeSizeControls,'return to half drawer preserves original geometry and scroll');
   }
   await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await settled(page);if(phone)eq(await geometry(page),beforeSizeControls,'closed drawer preserves original geometry and scroll');
   await page.emulateMedia({reducedMotion:'reduce'});
   await take.scrollIntoViewIfNeeded();
   const beforeReducedMotion=await geometry(page),reducedBottom=await sourceBottom(take);
   await take.click();await page.locator('.context-panel').waitFor();await settled(page);
   if(phone)await checkLookupSource(page,take,beforeReducedMotion,reducedBottom,`${theme}/${viewport.width} reduced motion`);
   eq(await drawerFrame(page),fixed,'reduced motion reveals the same fixed frame');
   await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await settled(page);
   ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${viewport.width}: no horizontal overflow with largest reading size`);
   if(viewport.width===390)await page.screenshot({path:`${output}/${theme}-large-reading.png`});
   await context.close();
  }
 }
 eq(h.errors,[],'no application errors');await writeFile(`${output}/report.json`,JSON.stringify({passed:true,checks,scope:'Chromium desktop and mobile emulation, real Rust command cores/disposable SQLite; not device acceptance'},null,2));console.log(`Mobile reading: ${checks.length} checks passed`);
}catch(e){await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw e;}finally{await h.dispose();}
