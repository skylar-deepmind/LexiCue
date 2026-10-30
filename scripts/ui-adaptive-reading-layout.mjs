/** Real React and Rust command cores, disposable SQLite; no real user data. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createReadingHarness} from './ui-reading-support.mjs';
const baseline=process.argv.includes('--baseline');
const focused=process.argv.includes('--focused');
const output=process.env.LEXICUE_ADAPTIVE_OUTPUT||`/tmp/lexicue-adaptive-reading-layout-ui/${baseline?'baseline':'current'}`;
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output);const evidence={baseline,checks:[],measurements:[],errors:h.errors};let page;
const ok=(v,label)=>{assert.ok(v,label);evidence.checks.push(label);};
const settle=()=>page.waitForTimeout(500);
const measure=()=>page.evaluate(()=>{
 const rect=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 return{viewport:{width:innerWidth,height:innerHeight},paper:rect('.reading-paper'),text:rect('.reading-original'),panel:rect('.context-panel'),scroll:rect('.reader-scroll'),font:getComputedStyle(document.querySelector('.reading-original')).fontSize,mode:document.querySelector('.reading-layout')?.dataset.layout,overflow:document.documentElement.scrollWidth>innerWidth||document.querySelector('.reader-scroll').scrollWidth>document.querySelector('.reader-scroll').clientWidth};
});
try{
 const text='Curiosity invites us to take a closer look at the world around us, to notice the quiet details that other people may overlook, and to discover how a familiar place can offer an entirely different story when we give ourselves enough time to listen and understand.';
 const clock=n=>`00:${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')},000`;
 const segments=Array.from({length:180},(_,index)=>({index,en_text:text,zh_text:'好奇心邀请我们仔细观察身边的世界，留意容易错过的细节，并给自己足够的时间去倾听和理解。',start_time:clock(index*5),end_time:clock(index*5+4)}));
 const imported=await h.call('import_reading_material',{input:{operation_id:randomUUID(),name:'Adaptive reading — isolated fixture.srt',content:segments.map(s=>`${s.index+1}\n${s.start_time} --> ${s.end_time}\n${s.en_text}\n${s.zh_text}`).join("\n\n"),segments}});
 for(const theme of ['ocean','midnight']){
  const context=await h.browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();await page.routeWebSocket('**',s=>s.close());await h.fixture(page,theme);
  await page.goto(`${h.url}/files/${imported.file_id}`);await page.locator('.reading-word').first().waitFor();
  for(const [width,height] of (focused?[]:[[800,600],[1024,768],[1100,750],[1280,800],[1440,900],[1920,1080],[2560,1440]])){
   await page.setViewportSize({width,height});await settle();
   for(const open of [false,true]){
    if(open){await page.locator('.reading-word').filter({hasText:/^take$/}).first().click();await page.locator('.soft-refresh-current .longman-meaning').first().waitFor();await settle();}
    const m={theme,open,...await measure()};evidence.measurements.push(m);
    await page.screenshot({path:`${output}/${theme}-${width}-${open?'open':'closed'}.png`});
    if(!baseline){ok(!m.overflow,`${theme} ${width} ${open} no horizontal overflow`);if(open){ok(m.panel.x>=0&&m.panel.right<=width+1&&m.panel.y>=0&&m.panel.bottom<=height+1,`${theme} ${width} panel in viewport`);if(m.mode==='columns'){const gap=m.panel.x-m.paper.right;ok(gap>=23&&gap<=41,`${theme} ${width} adjacent columns`);const left=m.paper.x-m.scroll.x,right=m.scroll.right-m.panel.right;ok(Math.abs(left-right)<=3,`${theme} ${width} group centered`);}}}
    if(open){await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});}
   }
  }
  if(!baseline){
   await page.setViewportSize({width:1440,height:900});await settle();
   const anchor=page.locator('[data-sentence="24"] .reading-word').filter({hasText:/^take$/});
   await anchor.evaluate(n=>{const s=document.querySelector('.reader-scroll');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top-180;});await settle();
   const offset=()=>anchor.evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.reader-scroll').getBoundingClientRect().top);
   const initialOffset=await offset();await anchor.click();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();await settle();
   ok(Math.abs(await offset()-initialOffset)<=46,`${theme} middle query opening anchor`);
   await page.getByRole('button',{name:'补充个人解释',exact:true}).click();await page.locator('#reader-meaning').fill('保留跨布局的草稿');
   await page.evaluate(()=>{window.__adaptivePanel=document.querySelector('.context-panel');window.__adaptiveCalls=window.__uiCalls.filter(c=>c.command.startsWith('lookup_')).length;});
   const resizeOffsets=[];
   for(const width of [1100,1040,1030,1024,800,1035,1050,1280,1920,2560,1440]){
    const before=await offset();await page.setViewportSize({width,height:900});await settle();const after=await offset();resizeOffsets.push({width,before,after,error:Math.abs(after-before)});
    ok(Math.abs(after-before)<=46,`${theme} ${width} resize anchor within one line`);
    ok(await page.locator('.context-panel').evaluate(n=>n===window.__adaptivePanel),`${theme} ${width} same panel instance`);
    ok(await page.locator('#reader-meaning').inputValue()==='保留跨布局的草稿',`${theme} ${width} draft retained`);
   }
   evidence.anchorOffsets??=[];evidence.anchorOffsets.push({theme,resizeOffsets});
   ok(await page.evaluate(()=>window.__uiCalls.filter(c=>c.command.startsWith('lookup_')).length===window.__adaptiveCalls),`${theme} resize does not repeat lookup`);
   const beforePanelScroll=await page.locator('.reader-scroll').evaluate(n=>n.scrollTop);
   await page.locator('.lookup-body').evaluate(n=>n.scrollTop=n.scrollHeight);await settle();
   ok(await page.locator('.reader-scroll').evaluate(n=>n.scrollTop)===beforePanelScroll,`${theme} panel scroll is independent`);
   await page.locator('#reader-meaning').focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
   ok(await page.evaluate(()=>document.querySelector('.context-panel').contains(document.activeElement)),`${theme} keyboard controls reachable`);
   const beforeClose=await offset();await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await settle();
   ok(Math.abs(await offset()-beforeClose)<=46,`${theme} closing preserves reading anchor`);
   ok(await anchor.evaluate(n=>n===document.activeElement),`${theme} Escape restores original word focus`);
   await page.locator('.reader-scroll').hover();const manualBefore=await page.locator('.reader-scroll').evaluate(n=>n.scrollTop);await page.mouse.wheel(0,350);await settle();
   ok(await page.locator('.reader-scroll').evaluate(n=>n.scrollTop)>manualBefore+200,`${theme} manual scrolling wins`);
   const preferences=async(size,scale)=>page.evaluate(async({size,scale})=>{const {usePreferencesStore:s}=await window.__uiStoreModule('preferencesStore');s.getState().setLearningTextFontSize(size);s.getState().setContentFontScale('learning',scale);},{size,scale});
   for(const size of (focused?[]:['sm','md','lg']))for(const scale of [80,100,140])for(const width of [800,1100,1920]){
    await preferences(size,scale);await page.setViewportSize({width,height:width===800?600:900});await settle();
    await page.locator('.reader-scroll').evaluate(n=>n.scrollTop=0);await page.locator('.reading-word').filter({hasText:/^take$/}).first().click();await settle();
    const m={theme,size,scale,...await measure()};evidence.measurements.push(m);ok(!m.overflow,`${theme} ${size}/${scale}/${width} no overflow`);
    const footer=await page.locator('.lookup-footer').boundingBox();ok(footer&&footer.y>=0&&footer.y+footer.height<=m.viewport.height+1,`${theme} ${size}/${scale}/${width} save visible`);
    if(size==='lg'&&scale===140&&[800,1100].includes(width))await page.screenshot({path:`${output}/${theme}-${width}-large-type.png`});
    await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});
   }
   await preferences('md',100);await page.setViewportSize({width:1920,height:1080});await settle();
   const lines=await page.locator('.reading-original').first().evaluate(node=>{
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),lines=new Map();let text;
    while((text=walker.nextNode()))for(let i=0;i<text.length;i++){const r=document.createRange();r.setStart(text,i);r.setEnd(text,i+1);const rect=r.getBoundingClientRect();const y=Math.round(rect.top);lines.set(y,(lines.get(y)||'')+text.textContent[i]);}
    return [...lines.values()].map(line=>({characters:line.trim().length,text:line}));
   });evidence.proseLines??=[];evidence.proseLines.push({theme,lines});
   // With no query, retain the first visible sentence rather than an old selection.
   await page.setViewportSize({width:1440,height:900});await settle();
   await page.locator('[data-sentence="24"]').evaluate(n=>{const s=document.querySelector('.reader-scroll');s.scrollTop+=n.getBoundingClientRect().top-s.getBoundingClientRect().top+30;});await settle();
   const noQuery=()=>page.locator('[data-sentence="24"]').evaluate(n=>n.getBoundingClientRect().top-document.querySelector('.reader-scroll').getBoundingClientRect().top);
   const noQueryBefore=await noQuery();await page.setViewportSize({width:800,height:600});await settle();ok(Math.abs(await noQuery()-noQueryBefore)<=46,`${theme} no-query resize anchor`);
   await page.evaluate(async()=>{const {usePreferencesStore:s}=await window.__uiStoreModule('preferencesStore');s.getState().setContentFontScale('learning',140);s.getState().setContentFontScale('definition',140);s.getState().setContentFontScale('auxiliary',140);s.getState().setDefinitionFontSize('lg');s.getState().setAuxiliaryFontSize('lg');});await settle();
   ok(Math.abs(await noQuery()-noQueryBefore)<=64,`${theme} font change anchor`);
   await page.locator('.reader-scroll').evaluate(n=>n.scrollTop=0);const firstWord=page.locator('.reading-word').filter({hasText:/^take$/}).first();await firstWord.click();await settle();
   ok(!(await measure()).overflow,`${theme} maximum explanation and auxiliary text fit`);
   await page.screenshot({path:`${output}/${theme}-all-text-large.png`});
   const readable=async(locator,state)=>{
    const ratio=await locator.evaluate(n=>{const rgb=v=>v.match(/[\d.]+/g).map(Number),lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);let p=n,bg;do{bg=rgb(getComputedStyle(p).backgroundColor);p=p.parentElement;}while(p&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(n).color)),b=lum(bg);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
    evidence.contrasts??=[];evidence.contrasts.push({theme,state,ratio});ok(ratio>=4.5,`${theme} ${state} text contrast`);
   };
   await page.setViewportSize({width:1920,height:1080});await settle();
   await readable(firstWord,'selected word');await firstWord.hover();await readable(firstWord,'hover word');await firstWord.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');ok(await firstWord.evaluate(n=>getComputedStyle(n).outlineStyle==='solid'),`${theme} keyboard focus outline`);
   await readable(page.locator('.lookup-footer button').first(),'primary action');
   await page.evaluate(()=>document.querySelector('.lookup-footer button').disabled=true);await readable(page.locator('.lookup-footer button').first(),'disabled action');await page.screenshot({path:`${output}/${theme}-disabled-focus.png`});await page.evaluate(()=>document.querySelector('.lookup-footer button').disabled=false);
   await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});
   await page.evaluate(async()=>{const {usePreferencesStore:s}=await window.__uiStoreModule('preferencesStore');for(const c of ['learning','definition','auxiliary'])s.getState().setContentFontScale(c,100);s.getState().setDefinitionFontSize('md');s.getState().setAuxiliaryFontSize('md');});await settle();
   // 200% text enlargement and an effective 800x450 CSS viewport for page zoom.
   await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.setViewportSize({width:800,height:450});await settle();await page.locator('.reading-word').first().click();await settle();
   ok(!(await measure()).overflow,`${theme} 200% text no horizontal overflow`);
   await page.screenshot({path:`${output}/${theme}-200-percent.png`});await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await page.evaluate(()=>document.documentElement.style.fontSize='');
   await page.setViewportSize({width:390,height:844});await page.locator('.reader-scroll').evaluate(n=>n.scrollTop=0);await page.locator('.reading-word').first().click();await settle();ok(!(await measure()).overflow,`${theme} mobile reading no overflow`);await page.getByRole('button',{name:'收起，继续',exact:true}).click();await page.locator('.context-panel').waitFor({state:'detached'});
   await page.screenshot({path:`${output}/${theme}-390-reading.png`});
  }
  await context.close();
 }
 ok(!h.errors.length,'no browser exceptions');evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);if(page&&!page.isClosed())await page.screenshot({path:`${output}/failure.png`});throw error;}
finally{await writeFile(`${output}/evidence.json`,JSON.stringify(evidence,null,2));await h.dispose();}
console.log(`${evidence.checks.length} adaptive layout checks passed. ${output}`);
