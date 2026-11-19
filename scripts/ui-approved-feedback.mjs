/** Screenshot-feedback acceptance against real Rust commands and disposable SQLite. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const out=process.env.LEXICUE_FEEDBACK_UI_OUTPUT||'/tmp/lexicue-approved-feedback';await mkdir(out,{recursive:true});
const h=await createReadingHarness(out),checks=[];let page;
const ok=(v,label)=>{assert.ok(v,label);checks.push(label);},eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks.push(label);};
const settle=()=>page.waitForFunction(()=>!document.querySelector('.approved-handoff,.approved-tag-flight,.approved-saved-flight')&&!document.documentElement.dataset.dissolve);
try{
 for(const theme of ['sage','midnight'])for(const width of [1360,390,320]){
  await h.call('test_reset');const tag=await h.call('create_tag',{name:'Coast'});
  for(let i=0;i<4;i++){
   const lines=['The air smelled of salt near the old pier.','I stood at the edge of the water and waited.',`We walked along the coast. Journey ${i+1}.`,
     ...Array.from({length:24},(_,i)=>`We continued along the path until the next bend in the road. Stop ${i+1}.`)];
   const readerTitle = `The Lighthouse at the End of the Old Coast Road ${i+1}`;
   const result=await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`${readerTitle}.txt`,content:lines.join('\n'),normalized_kind:'txt',tag_ids:[tag],segments:lines.map((en_text,index)=>({index,en_text,zh_text:'海边的空气带着盐味。'}))}});
   if(i===0){const read=await h.call('open_reading_material',{fileId:result.file_id}),s=read.segments[0],start=s.en_text.indexOf('air');await h.call('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'save',input:{segment_id:s.id,expression:'air',start_offset:start,end_offset:start+3,explanation:'海边读到的原句。',explanation_source:'personal'}}});}
  }
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
        desk: opacity(caption.closest('.approved-desk')),
        layout: opacity(layout),
        separateTextLayers: layer.querySelectorAll('[data-motion-piece=title],[data-motion-piece=quote]').length,
        cover: opacity(cover.parentElement),
        realCover: opacity(liveCover),
        realMask: getComputedStyle(liveCover).maskImage,
        contour: opacity(contour),
        contourOffset: distance(cover, contour),
        coverOffset: distance(cover, liveCover),
        readerClip: getComputedStyle(liveCover.closest('.reading-page')).clipPath,
      });
    }
    return frames;
  });
  ok(handoff[20].contourOffset < 1 && handoff[20].coverOffset > 1, 'contour travels with the moving cover');
  ok(handoff[36].layout < .05, 'reading text waits for the reveal phase');
  ok(handoff.every(frame => !frame.separateTextLayers && (frame.desk < .001 || frame.layout < .001)), 'desk caption and real reader text each paint as one layout in separate phases');
  ok(handoff.every(frame => frame.layout < .001 || frame.coverOffset < .1), 'the cover is already stationary when the reader text appears');
  ok(handoff.every(frame => frame.layout < .001 || frame.realCover > 0 && frame.realCover < 1 && frame.realMask !== 'none' && frame.readerClip === 'none'), 'the settled cover is translucent and masked when the reader appears');
  ok(handoff.every(frame => frame.layout < .999 || frame.cover < .001), 'only the real gradient cover remains once the text is fully painted');
  ok(handoff.slice(-12).every(frame => frame.cover < .001 && frame.realCover && frame.contour < .001), 'the last 60 ms show only the real, stationary cover');
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
  const docking = await page.evaluate(async () => {
    const viewport = document.querySelector('.reader-scroll');
    const heading = document.querySelector('.reading-title');
    const cover = document.querySelector('.folio-print');
    const bar = document.querySelector('.reader-docked-title');
    const track = bar.querySelector('.reader-docked-title-motion');
    const line = bar.querySelector('.reader-docked-title-line');
    const back = document.querySelector('.reading-breadcrumb .page-back');
    const frame = () => new Promise(done => requestAnimationFrame(()=>requestAnimationFrame(done)));
    const sample = () => ({
      inline: Number(getComputedStyle(heading).opacity),
      dock: Number(getComputedStyle(track).opacity),
      size: cover.offsetHeight,
      back: back.getBoundingClientRect().toJSON(),
    });
    viewport.scrollTop = 0;
    await frame();
    const threshold = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    const samples = [sample()];
    for(let offset = -18; offset <= 48; offset += 6) {
      viewport.scrollTop = threshold + offset;
      await frame();
      samples.push(sample());
    }
    const center = node => { const rect = node.getBoundingClientRect(); return rect.y + rect.height / 2; };
    const settled = {overflow:bar.hasAttribute('data-overflow'),marquee:line.getAnimations().length,
      aligned:Math.abs(center(back) - center(track)) < .5, docked:bar.hasAttribute('data-docked')};
    const backwards = [];
    for(let offset = 48; offset >= -18; offset -= 6) {
      viewport.scrollTop = threshold + offset;
      await frame();
      backwards.push(sample().dock);
    }
    viewport.scrollTop = 0;
    await frame();
    return {samples,settled,backwards,final:sample(),animationReset:!line.getAnimations().length};
  });
  ok(docking.samples.filter(sample => sample.dock > 0 && sample.dock < 1).length >= 5, 'scroll progress gives multiple intermediate title frames');
  ok(docking.samples.every((sample,index)=>!index||sample.dock>=docking.samples[index-1].dock), 'title docks monotonically with upward scroll');
  ok(docking.backwards.every((opacity,index)=>!index||opacity<=docking.backwards[index-1]), 'title leaves the bar smoothly on reverse scroll');
  ok(docking.samples.every(sample => Math.abs(sample.inline + sample.dock - 1) < .001 && sample.size === docking.samples[0].size), 'title opacity transfers continuously with a stationary cover size');
  ok(docking.samples.every(sample => JSON.stringify(sample.back) === JSON.stringify(docking.final.back)), 'title motion leaves the back button fixed');
  ok(docking.settled.aligned && docking.settled.docked, 'settled title is at the back arrow centerline');
  eq(docking.settled.overflow,width < 768,'only the viewport where the long title overflows needs scrolling');
  eq(docking.settled.marquee,width < 768 ? 1 : 0,'only an overflowing docked title moves horizontally');
  ok(docking.final.inline === 1 && docking.final.dock === 0 && docking.animationReset, 'scrolling back fully restores the original title');
  eq(await page.locator('.reading-document-location:visible,.sentence-number:visible,.sentence-number-static:visible,.display-settings-trigger:visible').count(),0,'reader has no format/paragraph indices or font menu');
  const bar=page.locator('.mobile-reading-bar');ok(await bar.isVisible(),'floating tools are visible on both desktop and phone');ok(await bar.evaluate(n=>innerHeight-n.getBoundingClientRect().bottom>=15),'floating controls clear the bottom edge');
  ok(await bar.evaluate(n=>{const r=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect()).sort((a,b)=>a.x-b.x);return r.length===2&&r[0].right<=r[1].left+1;}),'collapsed translation and headphones never overlap');
  await page.locator('.mobile-headphone-mode button').click();await page.waitForFunction(()=>document.querySelector('.mobile-reading-bar')?.dataset.listening==='true');eq(await page.locator('.mobile-playback-mode button').count(),3,'headphones split into three working listening controls');await page.waitForFunction(()=>Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width)===194);ok(await bar.evaluate(n=>{const r=[...n.querySelectorAll('button')].filter(b=>!b.closest('[inert]')).map(b=>b.getBoundingClientRect()).sort((a,b)=>a.x-b.x);return r.length===4&&r.slice(1).every((b,i)=>r[i].right<=b.left+1);}),'expanded listening controls keep independent hit targets');
  const before=await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');return s.getState().rate;});await page.locator('.mobile-rate-control').click();const after=await page.evaluate(async()=>{const {useSpeechStore:s}=await window.__uiStoreModule('speechStore');return s.getState().rate;});ok(before!==after,'speed control changes actual speech store rate');await page.locator('.mobile-playback-mode button').last().click();await page.waitForFunction(()=>document.querySelector('.mobile-reading-bar')?.dataset.listening==='false');
  await page.waitForFunction(()=>Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width)===106);await page.screenshot({path:`${out}/${theme}-${width}-reading.png`});await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();await settle();
  const active = page.locator('.approved-card[data-desk-active=true]');
  const activeId = Number(await active.getAttribute('data-motion-file'));
  const { content_hash, position } = (await h.call('list_materials')).find(file => file.id === activeId);
  await h.call('remember_reading_position', { fileId:activeId, contentHash:content_hash, segment:14, back:false, legacy:false, parent:position?.revision ?? null });
  await page.reload();
  await active.locator('.approved-card-open').click();
  const restored = page.locator('.approved-handoff .approved-desk');
  await restored.waitFor({state:'attached'});
  const resume = await restored.evaluate(desk => {
    const layer = desk.closest('.approved-handoff');
    const reader = document.querySelector('.reading-page');
    const active = desk.querySelector('[data-desk-active=true]');
    const jobs = document.getAnimations().filter(job => job.effect.getTiming().duration === 580);
    jobs.forEach(job => { job.pause(); job.currentTime = 65; });
    const cover = reader.querySelector('.folio-print').getBoundingClientRect();
    const viewport = reader.querySelector('.reader-scroll').getBoundingClientRect();
    const result = { galleryCover: getComputedStyle(active.querySelector('.approved-card-cover')).visibility,
      tag: getComputedStyle(active.querySelector('.material-floating-tag')).visibility,
      desktopFade: Number(getComputedStyle(desk).opacity),
      restoredPosition: cover.bottom < viewport.top,
      flights: layer.querySelectorAll('[data-motion-piece=cover]').length };
    const layout = reader.querySelector('.reading-layout');
    const handoff = [];
    for (let time = 100; time <= 500; time += 5) {
      jobs.forEach(job => { job.currentTime = time; });
      handoff.push([Number(getComputedStyle(desk).opacity), Number(getComputedStyle(layout).opacity)]);
    }
    jobs.forEach(job=>job.finish());
    return { ...result, handoff };
  });
  ok(resume.restoredPosition && resume.flights === 0, 'resume stays at the saved sentence with no flight to an offscreen cover');
  ok(resume.galleryCover === 'visible' && resume.tag === 'visible' && resume.desktopFade > 0, 'restored reading keeps the cover and label visible as the desk card fades');
  ok(resume.handoff.filter(([desk, layout]) => desk < .001 && layout < .001).length <= 1
    && resume.handoff.every(([desk, layout]) => desk < .001 || layout < .001),
    'the restored reader starts as the desk finishes, without text overlap or a blank pause');
  await settle();
  await page.locator('.reading-breadcrumb .page-back').click();await page.locator('.approved-desk').waitFor();await settle();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.approved-language-slider').waitFor();eq(await backRect('.approved-settings-back'),railBack,'settings back shares the same position');eq(await page.getByRole('radio').count(),4,'four interface languages are immediately available');eq(await page.locator('[data-entry=guide],[data-entry=language]').count(),0,'no guide or nested language menu');
  ok(await page.locator('.approved-settings-paper > h1').evaluate(n=>n.getBoundingClientRect().width<=1),'category heading is not repeated in the detail paper');
  await page.getByRole('radio',{name:'Deutsch',exact:true}).click();await page.getByRole('radio',{name:'中文',exact:true}).click();eq(await page.getByRole('radio',{name:'中文',exact:true}).getAttribute('aria-checked'),'true','language changes in place without navigation');
  await page.locator('.approved-settings-tabs button').last().click();ok(await page.locator('.approved-settings-tabs').isVisible(),'software update retains the settings index');eq(await page.locator('.approved-settings-tabs button:visible').count(),4,'all settings categories remain available in update detail');
  if(width===1360){
    const pane=page.locator('.update-settings');
    const check=page.getByRole('button',{name:'检查更新',exact:true});
    const toast=page.locator('[data-notification-host="top"] .toast-card');
    const version=await pane.locator('.settings-facts').boundingBox(), refresh=await check.boundingBox();
    ok(refresh.x >= version.x+version.width-1 && Math.abs(refresh.y+refresh.height/2-version.y-version.height/2)<2,'refresh icon is on the same row as the version');
    await check.click();
    await toast.filter({hasText:'已是最新版本'}).waitFor();
    eq(await pane.getByText('已是最新版本').count(),0,'up-to-date result belongs only to the toast');
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('[data-notification-host="top"] .toast-card')).opacity)===1);
    await page.screenshot({path:`${out}/${theme}-update-toast.png`});
    await toast.waitFor({state:'detached'});
    await page.evaluate(()=>{
      const native=window.__TAURI_INTERNALS__.invoke;
      window.__updateResult='error';
      window.__TAURI_INTERNALS__.invoke=(command,args)=>{
        if(command==='plugin:updater|check')throw Error('controlled updater unavailable');
        if(command==='check_github_release'){
          if(window.__updateResult==='error')throw Error('controlled release failure');
          return Promise.resolve({version:'99.0.0',url:'https://example.com/release'});
        }
        return native(command,args);
      };
    });
    await check.click();
    await toast.filter({hasText:'暂时无法检查更新，请重试。'}).waitFor();
    eq(await pane.getByRole('alert').count(),0,'check failure is a concise toast without inline diagnostics');
    await page.evaluate(()=>{window.__updateResult='available';});
    await check.click();
    await toast.filter({hasText:'发现新版本 v99.0.0'}).waitFor();
    ok(await pane.getByRole('button',{name:'打开下载页面'}).isVisible() && await toast.count()===1,'a new version shows one toast and keeps the download action reachable');
    await toast.waitFor({state:'detached'});
  }
  await page.locator('.approved-settings-tabs button').nth(2).click();await page.locator('[data-entry=youtube]').click();
  const youtube=page.locator('.youtube-download-settings'), help=youtube.locator('.youtube-tool-help > summary');
  ok((await youtube.locator('.youtube-tool-summary').innerText()).length<120,'subtitle status stays concise');
  const installation=youtube.getByRole('button',{name:'官方安装说明',exact:true});
  ok(!await installation.isVisible(),'installation and diagnostics start collapsed');
  await help.click();
  ok(await installation.isVisible(),'missing-tool installation is reachable without enabling browser sessions');
  await help.click();
  eq(await youtube.locator('#youtube-browser-profile:visible').count(),0,'optional profiles stay out of the default flow');
  await page.screenshot({path:`${out}/${theme}-${width}-settings.png`});
  const browserSwitch=youtube.getByRole('switch',{name:'使用浏览器登录会话'});
  eq(await youtube.getByText(/仅在本机读取登录会话/).count(),0,'an off browser session keeps the privacy help out of the default view');
  await browserSwitch.click();
  ok(await youtube.getByText(/仅在本机读取登录会话/).isVisible(),'privacy guidance appears with the enabled browser session');
  await browserSwitch.click();
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`${h.url}/files`);await page.locator('.approved-desk').waitFor();await page.getByRole('button',{name:'已保存',exact:true}).click();await page.locator('.approved-saved-folio').waitFor();eq(await page.locator('.approved-saved-flight,.approved-handoff,.approved-tag-flight').count(),0,'reduced motion opens real content without flights');ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await context.close();
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${out}/evidence.json`,JSON.stringify({checks,scope:'Chromium desktop and touch emulation, Sage/Midnight; real SQLite commands; speech transport controlled, no native acoustic claim'},null,2));console.log(`Approved feedback: ${checks.length} checks passed`);
}catch(error){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.txt`,String(error)+'\n'+await page?.locator('body').innerText().catch(()=>''));throw error;}finally{await h.dispose();}
