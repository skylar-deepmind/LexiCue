/** Card choreography and category edits, with real disposable Rust/SQLite stores. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createReadingHarness} from './ui-reading-support.mjs';
const out=process.env.LEXICUE_CARD_UI_OUTPUT||'/tmp/lexicue-card-interactions';
const h=await createReadingHarness(out);let page,checks=0;
const ok=(v,label)=>{assert.ok(v,label);checks++;},eq=(v,e,label)=>{assert.deepEqual(v,e,label);checks++;};
const settle=()=>page.waitForFunction(()=>!document.querySelector('.approved-handoff,.approved-reading-hold,.approved-tag-flight'));
const finish=()=>page.evaluate(()=>document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).forEach(a=>a.finish()));
try{
 for(const theme of ['sage','midnight'])for(const width of [1360,375]){
  await h.call('test_reset');for(const name of ['Travel','Daily','Empty'])await h.call('create_tag',{name});const tags=await h.call('list_tags'),travel=tags.find(t=>t.name==='Travel'),daily=tags.find(t=>t.name==='Daily'),empty=tags.find(t=>t.name==='Empty');
  const files=[];for(let i=0;i<2;i++)files.push(await h.call('import_reading_material',{input:{operation_id:crypto.randomUUID(),name:`Card journey ${i}.txt`,content:`The air is cool near the harbor. Journey ${i}.`,normalized_kind:'txt',segments:[{index:0,en_text:`The air is cool near the harbor. Journey ${i}.`,zh_text:'海港附近的空气很凉爽。'}],tag_ids:[travel.id]}}));
  const context=await h.browser.newContext({viewport:{width,height:width===1360?880:812},hasTouch:width<768});page=await context.newPage();await h.fixture(page,theme);
  await page.goto(h.url+'/files');await page.evaluate(async()=>{const{useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const{useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const file of m.getState().files)d.getState().keepAndOpen(file);});
  const card=page.locator('.approved-card[data-desk-active=true]');await card.waitFor();const fileId=Number(await card.getAttribute('data-motion-file'));
  // A stationary release must restore the real card on both mouse and touch.
  const cover=card.locator('.approved-card-open'),r=await cover.boundingBox(),point={x:r.x+r.width/2,y:r.y+r.height/2};
  const cdp=width<768?await context.newCDPSession(page):null;
  if(cdp)await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});else{await page.mouse.move(point.x,point.y);await page.mouse.down();}
  await page.locator('.trash-drag-layer').waitFor();
  if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}else await page.mouse.up();
  await page.locator('.trash-drag-layer').waitFor({state:'detached'});
  eq(await card.evaluate(n=>getComputedStyle(n).visibility),'visible','stationary hold release restores the source');eq((await h.call('test_counts')).files,2,'cancel never deletes material');
  await cover.focus();await page.keyboard.press('Delete');await page.locator('.trash-drop-target').waitFor();await page.keyboard.press('Escape');await page.locator('.trash-drag-layer').waitFor({state:'detached'});ok(await cover.isVisible(),'keyboard trash remains available and cancellable');
  // The turn indicator stays through the pause between consecutive swipes.
  const position=Number(await card.getAttribute('data-desk-position'));eq(position,0,'active card is centered');
  const next=await page.locator('.approved-edge-next').isEnabled()?'.approved-edge-next':'.approved-edge-prev',back=next.endsWith('next')?'.approved-edge-prev':'.approved-edge-next';
  await page.locator(next).click();await page.waitForTimeout(1100);ok(await page.locator('.approved-dots').evaluate(n=>Number(getComputedStyle(n).opacity)>.95),'turn indicator remains visible after 1.1 seconds');
  await page.locator(back).click();await page.waitForTimeout(1100);ok(await page.locator('.approved-dots').evaluate(n=>Number(getComputedStyle(n).opacity)>.95),'a second turn renews the hold without fading');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.approved-dots')).opacity==='0');
  const drag=await cover.boundingBox();await page.mouse.move(drag.x+drag.width/2,drag.y+drag.height/2);await page.mouse.down();await page.mouse.move(drag.x+drag.width/2+20,drag.y+drag.height/2);await page.waitForTimeout(2200);ok(await page.locator('.approved-dots').evaluate(n=>Number(getComputedStyle(n).opacity)>.95),'indicator stays visible throughout a held horizontal gesture');await page.mouse.up();eq(new URL(page.url()).pathname,'/files','short horizontal gesture does not accidentally open reading');
  eq(await card.locator('.material-floating-tag').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(251, 250, 245)','assigned tags use the same white paper in either theme');
  await card.locator('.approved-tag-edit').click();const strip=page.locator('.approved-desk .edge-choice[data-phase=open]');await strip.waitFor();
  const bar=await strip.boundingBox(),initialBounds=await card.boundingBox();ok(initialBounds.width>0,'card remains present');await page.waitForTimeout(240);ok((await card.boundingBox()).y+(await card.boundingBox()).height<=bar.y+2,'tag choices clear the raised home card');eq(await page.locator('.tag-dialog,.tag-color-picker').count(),0,'no retired dialog or color controls');
  await page.evaluate(()=>window.__uiFailure={command:'set_file_tags',remaining:1,afterCommit:false});await strip.getByRole('button',{name:'Daily',exact:true}).click();await strip.getByRole('alert').waitFor();eq((await h.call('list_materials')).find(f=>f.id===fileId).tags[0].id,travel.id,'failed assignment retains the original tag');
  await strip.getByRole('button',{name:'Daily',exact:true}).click();await strip.waitFor({state:'detached'});eq((await h.call('list_materials')).find(f=>f.id===fileId).tags.map(t=>t.id),[daily.id],'one tap persists exactly one category');
  // Each return frame must finish the card before the tag stamp starts.
  await cover.click();await page.locator('.reading-word').first().waitFor();await settle();await page.locator('.reading-breadcrumb .page-back').click();await page.locator('[data-motion-piece=tag]').waitFor();
  await page.evaluate(()=>document.querySelectorAll('.approved-handoff *').forEach(n=>n.getAnimations().forEach(a=>a.pause())));
  for(const time of [0,250,579,700,820]){
   await page.evaluate(time=>document.querySelectorAll('.approved-handoff *').forEach(n=>n.getAnimations().forEach(a=>a.currentTime=time)),time);
   const opacity=await page.locator('[data-motion-piece=tag]').evaluate(n=>Number(getComputedStyle(n).opacity));
   if(time<580)eq(opacity,0,`tag remains absent while the card assembles at ${time}ms`);else if(time===700)ok(opacity>0&&opacity<1,'tag fades in after assembly');else eq(opacity,1,'tag finishes after the card is complete');
  }
  await finish();await settle();
  await page.locator('.approved-library-entry').click();await settle();
  eq(await page.locator('.approved-tag-add').count(),0,'the library has no category creation button');
  const caption=page.locator(`[data-tag-id="${daily.id}"] .approved-tag-name`);
  await caption.click();
  const rename=page.locator('.approved-tag-name-editor');
  await rename.locator('input').waitFor();
  eq(await rename.getByRole('button').count(),1,'the input has one confirmation control');
  await rename.locator('input').fill('A long draft name '.repeat(6));
  await page.waitForFunction(()=>{
    const editor=document.querySelector('.approved-tag-name-field'),field=editor.querySelector('input'),button=editor.querySelector('button');
    const input=field.getBoundingClientRect(),confirm=button.getBoundingClientRect(),visible=editor.closest('.approved-tag-rail').getBoundingClientRect();
    return input.left>=visible.left-1&&input.right<=visible.right+1&&confirm.right<=input.right+1&&
      Math.abs(confirm.top-input.top)<1&&confirm.width>=44&&
      button.contains(document.elementFromPoint(confirm.x+confirm.width/2,confirm.y+confirm.height/2));
  });
  ok(true,'confirmation keeps a visible hit target inside the right end of a long input');
  await page.keyboard.press('Enter');
  eq(await rename.count(),1,'typing Enter in the field never commits the draft');
  await page.locator('[data-tag-id="all"] .approved-tag-name').click();
  eq((await h.call('list_tags')).find(t=>t.id===daily.id).name,daily.name,'switching fields without confirming discards the draft');
  await caption.click();
  await page.locator('.approved-tag-name-editor input').fill('Voyage');await page.locator('.approved-tag-name-editor').getByRole('button',{name:'保存',exact:true}).click();await page.locator('.approved-tag-name-editor').waitFor({state:'detached'});
  eq((await h.call('list_materials')).find(f=>f.id===fileId).tags[0].id,daily.id,'inline rename preserves the existing association and ID');eq(await page.locator(`[data-tag-id="${daily.id}"] strong`).innerText(),'Voyage','renamed caption is updated in place');
  await page.getByRole('button',{name:'重命名 Voyage',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('.approved-tag-name-editor input').fill('Travel');
  await page.locator('.approved-tag-name-editor').getByRole('button',{name:'保存',exact:true}).click();await page.locator('.approved-tag-name-editor [role=alert]').waitFor();eq(await page.locator('.approved-tag-name-editor input').inputValue(),'Travel','a rejected duplicate name retains the draft for correction');eq((await h.call('list_tags')).find(t=>t.id===daily.id).name,'Voyage','failed inline rename leaves the original name intact');
  await page.keyboard.press('Escape');await page.locator('.approved-tag-name-editor').waitFor({state:'detached'});eq((await h.call('list_tags')).find(t=>t.id===daily.id).name,'Voyage','Escape cancels inline renaming without saving');
  ok(await page.locator(`[data-tag-id="${empty.id}"] .empty-library-artwork img`).isVisible(),'empty classification has the approved static comic');
  await page.getByRole('button',{name:'Empty · 0',exact:true}).click();await page.locator('.approved-wall-empty .empty-library-artwork img').waitFor();eq(await page.locator('.approved-wall-empty img').getAttribute('src'),'/design/empty-material/waiting.png','empty wall uses a static waiting pose');
  eq(await page.locator('.approved-wall').getByRole('button',{name:'新建标签',exact:true}).count(),0,'category wall has no create-tag control');
  ok(await page.locator('.approved-wall-empty p').evaluate(n=>{const l=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};const a=l(getComputedStyle(n).color),b=l(getComputedStyle(n.closest('.approved-wall')).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5;}),'empty status stays readable on the dark gallery in both themes');
  await page.locator('.approved-wall header button').click();await settle();await page.locator('.approved-rail-back').click();await settle();
  // Preview assignment uses the same options, outside and above the artwork.
  await page.evaluate(async()=>{const{useImportStore:i}=await window.__uiStoreModule('importStore');await i.getState().fromContent('clipboard','A new card waits beside the quiet harbor.',true);});await page.locator('.import-material-card').waitFor();
  ok(await page.locator('.import-card-title-input').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)>=29),'editable title retains card typography');
  await page.locator('.import-edge-label').click();
  const options=page.locator('.import-card-stage .edge-choice[data-phase=open]');
  await page.waitForTimeout(240);
  const ob=await options.boundingBox(), preview=await page.locator('.import-material-card').boundingBox();
  ok(preview.y+preview.height<=ob.y+2,'choices clear preview cover');
  await page.screenshot({path:`${out}/${theme}-${width}-preview.png`});
  await options.getByRole('button',{name:'Voyage',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.import-material-card'));
  eq((await h.call('test_counts')).files,3,'choosing commits exactly one card');
  if(width<768){await page.setViewportSize({width:667,height:375});await card.locator('.approved-tag-edit').click();await page.waitForTimeout(240);const bar=await page.locator('.approved-desk .edge-choice[data-phase=open]').boundingBox(),header=await page.locator('.approved-home-header').boundingBox(),bounds=await card.boundingBox();ok(bar.y>=header.y+header.height,'landscape tag choices clear the header');ok(bar.y>=bounds.y+bounds.height-2,'landscape choices below the card');ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'landscape choices do not widen the page');await page.screenshot({path:`${out}/${theme}-landscape.png`});await page.keyboard.press('Escape');await page.setViewportSize({width:375,height:812});}
  // Real repeated clicks reverse the live colors, without a snapshot input lock.
  const brand=page.locator('.approved-brand'),color=()=>page.locator('.approved-desk').evaluate(n=>getComputedStyle(n).backgroundColor);
  const oldColor=await color(),oldTheme=await page.evaluate(()=>document.documentElement.dataset.theme);
  await brand.click();await page.waitForTimeout(240);const midColor=await color();ok(midColor!==oldColor,'live palette leaves the old color gradually');
  ok(await brand.locator('.approved-wordmark').evaluate(n=>{const letters=getComputedStyle(n,'::after'),book=getComputedStyle(n,'::before');return letters.maskImage.includes('wordmark-night')&&letters.clipPath!=='none'&&book.clipPath!=='none'&&getComputedStyle(n.parentElement).backgroundColor==='rgba(0, 0, 0, 0)';}),'the wordmark paints transparent glyphs throughout the color transition');
  const nextTheme=await page.evaluate(()=>document.documentElement.dataset.theme);ok(nextTheme!==oldTheme,'first click changes the semantic theme immediately');
  await brand.click();eq(await page.evaluate(()=>document.documentElement.dataset.theme),oldTheme,'a second click during motion reverses the theme');
  await brand.click();eq(await page.evaluate(()=>document.documentElement.dataset.theme),nextTheme,'a third click during motion is also delivered');
  await page.waitForFunction(()=>!document.documentElement.dataset.themeTransition);ok(midColor!==await color(),'palette has intermediate colors rather than a hard cut');
  eq(await page.evaluate(()=>document.getAnimations().filter(a=>a.animationName==='theme-soft-in').length),0,'theme switching does not capture an input-blocking page snapshot');
  await page.emulateMedia({reducedMotion:'reduce'});await brand.click();eq(await page.evaluate(()=>document.documentElement.dataset.themeTransition),undefined,'reduced motion changes theme without a forced animation');
  await context.close();console.log(`Card interactions ${theme}/${width}: ${checks} assertions`);
 }
 eq(h.errors,[],'no browser exceptions');await writeFile(`${out}/evidence.json`,JSON.stringify({passed:true,checks,scope:'Both approved themes, desktop and touch-sized Chromium; real temporary SQLite. Touch cancellation uses Chromium touch input, native devices checked separately.'},null,2));console.log(`Card interactions: ${checks} checks passed`);
}catch(e){await page?.screenshot({path:`${out}/failure.png`}).catch(()=>{});await writeFile(`${out}/failure.json`,JSON.stringify(await page?.evaluate(()=>({url:location.href,text:document.body.innerText,calls:window.__uiCalls})).catch(()=>null),null,2));throw e;}finally{await h.dispose();}
