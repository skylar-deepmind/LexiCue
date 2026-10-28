/** Real application regression for viewport-centered navigation and import route ownership. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness, root } from './ui-reading-support.mjs';
const output = `${root}/docs/implementation/evidence/ui-refinement-v2-20261027/navigation`;
const h = await createReadingHarness(output);
const checks = [], observations = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const metrics = page => page.locator('.b-dock').evaluate(dock => {
  const rect=dock.getBoundingClientRect();
  const controls=[...dock.querySelectorAll('.b-dock-control')].filter(el=>!el.closest('[inert]')&&el.getClientRects().length);
  return {top:rect.top,height:rect.height,center:rect.top+rect.height/2,controls:controls.map(el=>({tag:el.tagName,label:el.getAttribute('aria-label'),href:el.getAttribute('href'),top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height})),inertCount:dock.querySelectorAll('[inert]').length};
});
async function centered(page,label,count){
  await settle(420);const m=await metrics(page), height=page.viewportSize().height;
  check(Math.abs(m.center-height/2)<1,`${label}: dock centered on viewport`);
  check(m.controls.length===count,`${label}: actual visible control count ${count}`);
  check(m.controls.every(control=>control.height>=44),`${label}: preserved target size`);
  check(Math.abs((m.controls[0].top+m.controls.at(-1).top+m.controls.at(-1).height)/2-height/2)<1,`${label}: controls centered as a group`);
  observations.push({label,...m});return m;
}
try {
  const unique=`nav-v2-${Date.now()}`;
  const text='Take time to understand the world.';
  const imported=await h.call('import_reading_material',{input:{operation_id:unique,name:`${unique}.srt`,content:`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,segments:[{index:0,en_text:text,zh_text:'',start_time:'00:00:01.000',end_time:'00:00:03.000'}]}});
  for(const theme of ['ocean','midnight']){
    const context=await h.browser.newContext({viewport:{width:1100,height:800}}),page=await context.newPage();
    await h.fixture(page,theme);
    await page.goto(`${h.url}/files`);await page.locator('.materials-paper').waitFor();
    const first=await centered(page,`${theme}/files`,4);
    check(!first.controls[0].href&&first.controls[1].href==='/files'&&first.controls[2].href==='/saved'&&first.controls[3].href==='/settings',`${theme}: import then files/saved/settings order`);
    const importButton=page.locator('.b-dock .dock-import-slot button');
    await importButton.click();await page.locator('.lc-import-modal').waitFor();
    await page.keyboard.press('Escape');await settle(250);
    const fileLink=page.locator('.b-dock a[href="/files"]');
    await fileLink.focus();await page.keyboard.press('Tab');
    check(await page.locator('.b-dock a[href="/saved"]').evaluate(el=>document.activeElement===el),`${theme}: sidebar keyboard order preserved`);
    const selectedStyle=await fileLink.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-700').trim()}));
    check(selectedStyle.bg==='rgba(0, 0, 0, 0)',`${theme}: selected icon has no persistent block`);
    await page.locator('.b-dock a[href="/saved"]').click();
    await settle(90);const during=await metrics(page);await settle(400);const after=await metrics(page);
    check(during.height<first.height&&during.height>after.height,`${theme}: removal folds smoothly before settling`);
    check(Math.abs(during.center-400)<1,`${theme}: folding stays centered`);
    check(await importButton.count()===0,`${theme}: hidden import removes its button after the exit`);
    await centered(page,`${theme}/saved`,3);
    for(const path of ['/files/','/settings','/legacy',`/files/${imported.file_id}`,'/example']){
      await page.goto(`${h.url}${path}`);
      if(path==='/example'||path.startsWith('/files/')&&path!=='/files/') await page.locator('.reading-word').first().waitFor();
      else await page.locator('.b-dock').waitFor();
      await centered(page,`${theme}${path}`,path==='/files/'?4:path==='/example'||path===`/files/${imported.file_id}`?6:3);
      check(await page.locator('.b-dock .dock-import-slot button').count()===(path==='/files/'?1:0),`${theme}${path}: exact import route visibility`);
    }
    await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();
    for(const height of [600,740,900,650]){await page.setViewportSize({width:1100,height});await centered(page,`${theme}: ${height}px reading viewport`,6);}
    const trigger=page.locator('.b-dock .display-settings-trigger');
    await trigger.hover();await page.locator('.display-font-popover:visible').waitFor();
    const panel=await page.locator('.display-font-popover:visible').boundingBox(), anchor=await trigger.boundingBox();
    check(panel.x>anchor.x+anchor.width&&panel.y>=0&&panel.y+panel.height<=650,`${theme}: existing Aa popover remains beside the moving dock`);
    await settle(240);await page.screenshot({path:`${output}/${theme}-reading-centered.png`});
    await page.mouse.move(1000,100);await settle(350);
    const disabled=page.locator('.b-dock .dock-reading-tools button:disabled');
    check(await disabled.count()===1,`${theme}: translation disabled state preserved`);
    await disabled.evaluate(el=>el.focus());
    check(!await disabled.evaluate(el=>document.activeElement===el),`${theme}: disabled tool remains outside keyboard focus`);
    for(const path of ['/saved','/files','/settings','/files','/saved','/files']){
      await page.evaluate(path=>{const a=document.querySelector(`.b-dock a[href="${path}"]`);a.click();},path);await settle(40);
    }
    await centered(page,`${theme}: rapid route changes settle`,4);
    check(await page.locator('.dock-import-slot button').count()===1,`${theme}: rapid changes leave one desktop import`);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.locator('.b-dock a[href="/saved"]').click();await settle(30);
    const reduced=await page.locator('.b-dock').evaluate(el=>({dock:getComputedStyle(el).transitionDuration,rows:[...el.querySelectorAll('.dock-presence')].map(row=>getComputedStyle(row).transitionDuration),center:el.getBoundingClientRect().top+el.getBoundingClientRect().height/2}));
    check(parseFloat(reduced.dock)<=.001&&reduced.rows.every(value=>parseFloat(value)<=.001)&&Math.abs(reduced.center-325)<1,`${theme}: reduced motion switches and centers immediately`);
    await context.close();
    const mobile=await h.browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true}),touch=await mobile.newPage();await h.fixture(touch,theme);
    for(const path of ['/files','/files/','/saved','/settings','/legacy',`/files/${imported.file_id}`,'/example']){
      await touch.goto(`${h.url}${path}`);await touch.locator('.b-mobile-nav').waitFor();await settle(420);
      const m=await touch.locator('.b-mobile-nav').evaluate(nav=>[...nav.children].map(el=>({tag:el.tagName,href:el.getAttribute('href')})));
      const summary=path==='/files'||path==='/files/';
      check(m.length===(summary?4:3),`${theme}: mobile ${path} exact visible count`);
      check(summary?m[0].tag==='BUTTON'&&m[1].href==='/files':m.every(item=>item.tag==='A'),`${theme}: mobile ${path} import first or fully absent`);
      check(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}: mobile ${path} no horizontal overflow`);
    }
    await touch.screenshot({path:`${output}/${theme}-mobile-reading.png`});await mobile.close();
  }
  check(h.errors.length===0,`no frontend errors: ${h.errors.join('; ')}`);
  await writeFile(`${output}/validation.json`,JSON.stringify({checks,observations},null,2));
  console.log(JSON.stringify({passed:checks.length,output},null,2));
} finally {await h.dispose();}
