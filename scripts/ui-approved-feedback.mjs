/** Screenshot-feedback acceptance against real Rust commands and disposable SQLite. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const out=process.env.LEXICUE_FEEDBACK_UI_OUTPUT||'/tmp/lexicue-approved-feedback';await mkdir(out,{recursive:true});
const h=await createReadingHarness(out),checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);},eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const settle=()=>page.waitForFunction(()=>!document.querySelector('.approved-handoff,.approved-tag-flight,.approved-saved-flight')&&!document.documentElement.dataset.dissolve);
try{
 await h.call('test_reset');const tag=await h.call('create_tag',{name:'Coast'});
 for(let i=0;i<4;i++){
  const lines=['The air smelled of salt near the old pier.','I stood at the edge of the water and waited.',`We walked along the coast. Journey ${i+1}.`];
  const result=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`Coast ${i+1}.txt`,content:lines.join('\n'),normalized_kind:'txt',tag_ids:[tag],segments:lines.map((en_text,index)=>({index,en_text,zh_text:'海边的空气带着盐味。'}))}});
  if(i===0){const read=await h.call('open_reading_material',{fileId:result.file_id}),s=read.segments[0],start=s.en_text.indexOf('air');await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:s.id,expression:'air',start_offset:start,end_offset:start+3,explanation:'海边读到的原句。',explanation_source:'personal'}}});}
 }
 for(const theme of ['sage','midnight'])for(const width of [1360,390,320]){
  const context=await h.browser.newContext({viewport:{width,height:width===1360?880:844},isMobile:width<768,hasTouch:width<768});page=await context.newPage();await h.fixture(page,theme);await page.routeWebSocket('**',s=>s.close());await page.goto(h.url);await page.locator('.approved-desk').waitFor();await page.locator('.mobile-startup').waitFor({state:'detached'});
  eq(await page.locator('.app-guide').count(),0,'fresh users see no guide');
  await page.evaluate(async()=>{const {useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const {useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files.slice().reverse())d.getState().keepAndOpen(file);});await page.locator('.approved-card[data-desk-active=true]').waitFor();await page.evaluate(()=>document.fonts.ready);
  eq(await page.locator('.approved-home-header > div button:visible').count(),3,'clipboard, file and settings are independent visible actions');
  const centers=await page.evaluate(()=>{
    const center=nodes=>{const r=nodes.map(n=>n.getBoundingClientRect());return (Math.min(...r.map(r=>r.top))+Math.max(...r.map(r=>r.bottom)))/2;};
    return [center([...document.querySelectorAll('.approved-stock img')]),center([...document.querySelector('.approved-word-pocket').children])];
  });ok(Math.abs(centers[0]-centers[1])<2,'painted bottom entrance centers align');
  await page.locator('.approved-library-entry').hover();ok(await page.locator('.approved-library-entry').evaluate(n=>{const s=getComputedStyle(n);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&s.boxShadow==='none'&&parseFloat(s.borderTopWidth)===0;}),'library hover never paints a placeholder rectangle');
  for(const selector of ['.clipboard-import','.import-tray','.home-settings-action']){await page.locator(selector).hover();if(width===1360)ok(await page.locator(selector).evaluate(n=>n.getAnimations({subtree:true}).length>0),'header icon has an illustrative hover animation');}
  const backRect = async selector => {
    const { x, y, width, height } = await page.locator(selector).boundingBox();
    return [x, y, width, height].map(Math.round);
  };
  await page.locator('.approved-library-entry').click();await page.locator('.approved-tag-panel').waitFor();await page.locator('.approved-tag-flight').waitFor();ok(await page.locator('.approved-tag-flight').evaluate(n=>n.getAnimations({subtree:true}).some(a=>a.effect.getTiming().duration===430)),'library cards fly from the actual cover anchor');await settle();const railBack=await backRect('.approved-rail-back');await page.keyboard.press('Escape');await page.locator('.approved-tag-panel').waitFor({state:'detached'});await settle();
  await page.screenshot({path:`${out}/${theme}-${width}-home.png`});
  const preview=page.locator('.approved-pocket-preview');await preview.waitFor();ok((await preview.innerText()).includes('The air smelled of salt'),'pocket thumbnail contains its real full sentence');
  await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.approved-saved-folio').waitFor();await settle();eq((await page.locator('.approved-folio-sentence').innerText()).trim(),'The air smelled of salt near the old pier.','miniature expands to the same saved sentence');eq(await backRect('.approved-saved-header .approved-back'),railBack,'saved and library back targets share the same position');await page.locator('.approved-saved-header').getByRole('button',{name:'返回',exact:true}).click();await page.locator('.approved-desk').waitFor();await settle();
  await page.locator('.approved-card[data-desk-active=true] .approved-card-open').click();await page.locator('.approved-handoff [data-motion-piece=cover]').waitFor();
  const handoff = await page.locator('.approved-handoff').evaluate(layer => {
    const jobs = document.getAnimations().filter(animation => animation.effect.getTiming().duration === 580);
    jobs.forEach(job => job.pause());
    const caption = layer.querySelector('.approved-card[data-desk-active=true] .approved-card-copy');
    const cover = layer.querySelector('[data-motion-piece=cover]');
    const contour = layer.querySelector('[data-motion-piece=contours]');
    const liveCover = document.querySelector('.folio-print');
    const layout = liveCover.closest('.reading-layout');
    const opacity = node => Number(getComputedStyle(node).opacity);
    const bounds = node => { const r = node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]; };
    const distance = (a, b) => Math.max(...bounds(a).map((value, axis) => Math.abs(value - bounds(b)[axis])));
    const frames = [];
    for (let time = 0; time < 580; time += 5) {
      jobs.forEach(job => { job.currentTime = time; });
      frames.push({
        desk: opacity(caption.closest('.approved-reading-hold')),
        layout: opacity(layout),
        separateTextLayers: layer.querySelectorAll('[data-motion-piece=title],[data-motion-piece=quote]').length,
        cover: opacity(cover),
        realCover: getComputedStyle(liveCover).visibility === 'visible',
        contour: opacity(contour),
        contourOffset: distance(cover, contour),
        coverOffset: distance(cover, liveCover),
        readerClip: getComputedStyle(liveCover.closest('.reading-page')).clipPath,
      });
    }
    return frames;
  });
  ok(handoff[36].contourOffset < 1 && handoff[36].coverOffset > 1, 'contour travels with the moving cover');
  ok(handoff[36].layout < .05, 'reading text waits for the reveal phase');
  ok(handoff.every(frame => !frame.separateTextLayers && (frame.desk < .001 || frame.layout < .001)), 'desk caption and real reader text each paint as one layout in separate phases');
  ok(handoff.some(frame => frame.cover === 1 && frame.coverOffset < .1), 'travel reaches the final rectangle with a fully painted cover');
  ok(handoff.every(frame => frame.cover === 1 || frame.realCover && frame.coverOffset < .1 && frame.readerClip === 'none' && frame.layout === 1), 'the cover stays opaque through the settled handoff');
  ok(handoff.slice(-18).every(frame => frame.cover < .001 && frame.realCover && frame.contour < .001), 'the last 90 ms show only the real, stationary cover');
  const entryGeometry = () => page.evaluate(() => {
    const positions=['.reading-breadcrumb .page-back','.reading-title','.folio-print','.reading-original'].map(selector=>{
      const rect=document.querySelector(selector).getBoundingClientRect();return [rect.x,rect.y,rect.width,rect.height];
    });
    return {positions,scroll:document.querySelector('.reader-scroll').scrollTop};
  });
  await page.locator('.approved-handoff').evaluate(()=>document.getAnimations().filter(a=>a.effect.getTiming().duration===580).forEach(a=>{a.currentTime=579;}));
  const lastFrame=await entryGeometry();
  ok(await page.locator('.reading-layout').evaluate(n=>Number(getComputedStyle(n).opacity) === 1),'reader text is fully painted before cleanup');
  await page.locator('.approved-handoff').evaluate(()=>document.getAnimations().filter(a=>a.effect.getTiming().duration===580).forEach(a=>a.finish()));await settle();
  eq(await entryGeometry(),lastFrame,'the real reader has identical geometry across the final handoff frame');
  eq(await backRect('.reading-breadcrumb .page-back'),railBack,'reader back stays at the same position as saved and library');
  eq(await page.locator('.reading-document-location:visible,.sentence-number:visible,.sentence-number-static:visible,.display-settings-trigger:visible').count(),0,'reader has no format/paragraph indices or font menu');
  const bar=page.locator('.mobile-reading-bar');ok(await bar.isVisible(),'floating tools are visible on both desktop and phone');ok(await bar.evaluate(n=>innerHeight-n.getBoundingClientRect().bottom>=15),'floating controls clear the bottom edge');
  ok(await bar.evaluate(n=>{const r=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect()).sort((a,b)=>a.x-b.x);return r.length===2&&r[0].right<=r[1].left+1;}),'collapsed translation and headphones never overlap');
  await page.locator('.mobile-headphone-mode button').click();await page.waitForFunction(()=>document.querySelector('.mobile-reading-bar')?.dataset.listening==='true');eq(await page.locator('.mobile-playback-mode button').count(),3,'headphones split into three working listening controls');await page.waitForFunction(()=>Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width)===194);ok(await bar.evaluate(n=>{const r=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect()).sort((a,b)=>a.x-b.x);return r.length===4&&r.slice(1).every((b,i)=>r[i].right<=b.left+1);}),'expanded listening controls keep independent hit targets');
  const before=await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');return s.getState().rate;});await page.locator('.mobile-rate-control').click();const after=await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');return s.getState().rate;});ok(before!==after,'speed control changes actual speech store rate');await page.locator('.mobile-playback-mode button').last().click();await page.waitForFunction(()=>document.querySelector('.mobile-reading-bar')?.dataset.listening==='false');
  await page.waitForFunction(()=>Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width)===106);await page.screenshot({path:`${out}/${theme}-${width}-reading.png`});await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();await settle();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-language-slider').waitFor();eq(await backRect('.approved-settings-back'),railBack,'settings back shares the same position');eq(await page.getByRole('radio').count(),4,'four interface languages are immediately available');eq(await page.locator('[data-entry=guide],[data-entry=language]').count(),0,'no guide or nested language menu');
  ok(await page.locator('.approved-settings-paper > h1').evaluate(n=>n.getBoundingClientRect().width<=1),'category heading is not repeated in the detail paper');
  await page.getByRole('radio',{name:'Deutsch',exact:true}).click();await page.getByRole('radio',{name:'中文',exact:true}).click();eq(await page.getByRole('radio',{name:'中文',exact:true}).getAttribute('aria-checked'),'true','language changes in place without navigation');
  await page.locator('.approved-settings-tabs button').last().click();ok(await page.locator('.approved-settings-tabs').isVisible(),'software update retains the settings index');eq(await page.locator('.approved-settings-tabs button:visible').count(),4,'all settings categories remain available in update detail');
  await page.locator('.approved-settings-tabs button').nth(2).click();await page.locator('[data-entry=youtube]').click();const youtube=page.locator('.youtube-download-settings');ok((await youtube.locator('.youtube-tool-summary').innerText()).length<120,'subtitle status stays concise');ok(await youtube.getByRole('button',{name:'官方安装说明',exact:true}).isVisible(),'missing-tool installation is visible without enabling browser sessions');eq(await youtube.locator('#youtube-browser-profile:visible').count(),0,'optional profiles and diagnostics stay out of the default flow');await page.screenshot({path:`${out}/${theme}-${width}-settings.png`});
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`${h.url}/files`);await page.locator('.approved-desk').waitFor();await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.approved-saved-folio').waitFor();eq(await page.locator('.approved-saved-flight,.approved-handoff,.approved-tag-flight').count(),0,'reduced motion opens real content without flights');ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await context.close();
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${out}/evidence.json`,JSON.stringify({checks,scope:'Chromium desktop and touch emulation, Sage/Midnight; real SQLite commands; speech transport controlled, no native acoustic claim'},null,2));console.log(`Approved feedback: ${checks.length} checks passed`);
}catch(error){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.txt`,String(error)+'\n'+await page?.locator('body').innerText().catch(()=>''));throw error;}finally{await h.dispose();}
