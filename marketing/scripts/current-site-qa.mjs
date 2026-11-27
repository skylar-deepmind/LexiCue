// Browser acceptance for the live current-app workspace and independent website routes.
// Reuse an existing Ego TaskSpace during collaborative work; standalone runs own one.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {manualContent} from '../src/manual-content.mjs';
import {guides} from '../src/experience-copy.mjs';
import {currentCopy} from '../src/current-copy.mjs';
const root=resolve(import.meta.dirname,'../..');
const config={space:process.env.LEXICUE_EGO_SPACE?Number(process.env.LEXICUE_EGO_SPACE):null,page:process.env.LEXICUE_EGO_PAGE||'p1',base:process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/',mode:process.env.LEXICUE_SITE_QA_MODE||'all',height:Number(process.env.LEXICUE_QA_HEIGHT||1000),locales:(process.env.LEXICUE_QA_LOCALES||'en,zh,ja,de').split(','),themes:(process.env.LEXICUE_QA_THEMES||'ocean,midnight').split(','),widths:(process.env.LEXICUE_QA_WIDTHS||'390,768,1440').split(',').map(Number),out:resolve(root,'output/marketing/qa/live-site'),manualContent,guides,currentCopy};
const browserScript=cfg=>`
const cfg=${JSON.stringify(cfg)};
const fs=await import('node:fs/promises');await fs.mkdir(cfg.out,{recursive:true});
const task=await taskSpace(cfg.space||'LexiCue current website acceptance'),page=task.page(cfg.page);
await page.cdp('Emulation.setScriptExecutionDisabled',{value:false});
const homeFor=locale=>cfg.base+(locale==='en'?'?lang=en':locale+'/');
let checks=0,stage='start';const results=[];const mark=value=>{stage=cfg.locales.join('-')+'/'+cfg.themes.join('-')+'/'+cfg.widths.join('-')+'x'+cfg.height+'/'+value;console.log('QA '+stage);};const check=(value,label)=>{if(!value)throw Error(label);checks++;};
const observe=async()=>page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,errors:performance.getEntriesByType('resource').filter(r=>r.responseStatus>=400).map(r=>r.name),remote:performance.getEntriesByType('resource').filter(r=>!r.name.startsWith(location.origin)&&!r.name.startsWith('data:')).map(r=>r.name)}));
const contrast=async(selector)=>page.evaluate(selector=>{const el=document.querySelector(selector);const lum=s=>{const n=s.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return n[0]*.2126+n[1]*.7152+n[2]*.0722;};let p=el,bg;while(p){bg=getComputedStyle(p).backgroundColor;if(bg!=='transparent'&&bg!=='rgba(0, 0, 0, 0)')break;p=p.parentElement;}const a=lum(getComputedStyle(el).color),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);},selector);
try{
for(const locale of cfg.locales)for(const theme of cfg.themes)for(const width of cfg.widths){
 mark('workspace/load');await page.cdp('Page.bringToFront');
 await page.cdp('Emulation.setDeviceMetricsOverride',{width,height:cfg.height,deviceScaleFactor:1,mobile:width<650});
 const actual=await page.evaluate(()=>({width:innerWidth,height:innerHeight,ratio:devicePixelRatio}));if(Math.abs(actual.width-width)>1||Math.abs(actual.height-cfg.height)>1||Math.abs(actual.ratio-1)>.01)await page.cdp('Emulation.setDeviceMetricsOverride',{width:Math.round(width*width/actual.width),height:Math.round(cfg.height*cfg.height/actual.height),deviceScaleFactor:1/actual.ratio,mobile:width<650});
 const prefix=cfg.base+(locale==='en'?'':locale+'/');
 await page.goto(cfg.mode==='manual'?prefix+'guide/quick-start/':homeFor(locale));await page.evaluate(theme=>localStorage.setItem('lexicue-marketing-theme',theme),theme);await page.reload();
 if(cfg.mode!=='manual'){
  await page.waitForSelector('.kn-tour.kn-enhanced');
  check(await page.evaluate(()=>document.querySelectorAll('.kn-story').length===5),'five visible product stories');
  await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const id of ['highlights','lookup','listen','save','memory']){
   mark('feature/'+id);await page.focus('.kn-index a[href="#'+id+'"]');await page.keyboard.press('Enter');
   await page.waitForFunction(id=>location.hash==='#'+id,id);
   await page.waitForFunction(id=>{const img=document.querySelector('.kn-view.is-current img');return document.querySelector('#'+id).hasAttribute('data-current') && img?.complete && img.naturalWidth>0 && img.src.endsWith('.webp') && !img.src.endsWith('-still.webp');},id);
   check(await page.evaluate(()=>{const img=document.querySelector('.kn-view.is-current img');return img.src.endsWith((matchMedia('(max-width:760px)').matches?'phone':'desktop')+'-'+img.parentElement.dataset.clip+'.webp');}),'active chapter loads its localized looping image');
   if(id==='listen'){
    await page.focus('.kn-hear'); await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.kn-player audio').currentTime>0);
   }
  }
  check(await page.evaluate(()=>!document.querySelector('.kn-transport,.kn-story p,.kn-story a') && document.querySelector('.kn-player audio').paused),'feature artwork has no player chrome or small copy and audio stops on exit');
  if(locale==='zh'&&theme==='ocean'&&(width===390||width===1440)){
   mark('feature/reduced-motion');
   await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await page.goto(homeFor(locale)+'#lookup');await page.reload();
   await page.waitForFunction(()=>document.querySelector('#lookup[data-current]')&&document.querySelector('.kn-view.is-current img')?.src.endsWith('-still.webp'));
   check(await page.evaluate(()=>document.querySelector('.kn-dust').hidden&&!performance.getEntriesByType('resource').some(r=>r.name.includes('/keynote/motion/')&&!r.name.endsWith('-still.webp'))),'reduced motion loads static artwork');
   await page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  }
  await page.focus('.kn-try');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>location.hash==='#experience'&&document.querySelector('.live-app-frame')?.contentDocument?.querySelector('.app-layout'));
  check(await page.evaluate(()=>document.querySelectorAll('.live-app-frame').length===1),'one live app window');
  // Restore only the demo namespace through its real outer reset control.
  mark('workspace/reset');await page.waitForFunction(()=>!document.querySelector('.demo-reset').disabled);
  await page.evaluate(()=>{window.__qaBeforeResetDocument=document.querySelector('.live-app-frame').contentDocument;const reset=document.querySelector('.demo-reset');if(reset.getBoundingClientRect().bottom>innerHeight)reset.scrollIntoView({block:'center',behavior:'instant'});});
  await page.focus('.demo-reset');await page.keyboard.press('Enter');await page.acceptDialog();
  await page.waitForFunction(()=>{const doc=document.querySelector('.live-app-frame')?.contentDocument;return doc&&doc!==window.__qaBeforeResetDocument&&doc.querySelector('.approved-card[data-desk-active=true]')&&!document.querySelector('.demo-reset').disabled;});
  await page.waitForFunction(({locale,theme})=>{const doc=document.querySelector('.live-app-frame').contentDocument;return doc.documentElement.lang===locale&&doc.documentElement.dataset.theme===theme;},{locale,theme});
  mark('workspace/geometry');await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.waitForFunction(()=>{const frame=document.querySelector('.live-app-frame'),nav=document.querySelector('.site-nav');return scrollY===0&&frame.getBoundingClientRect().top>=nav.getBoundingClientRect().bottom;});
  check(await page.evaluate(()=>{const frame=document.querySelector('.live-app-frame'),r=frame.getBoundingClientRect(),nav=document.querySelector('.site-nav').getBoundingClientRect();const minimum=parseFloat(getComputedStyle(frame.parentElement).minHeight)||0;const fits=r.bottom<=document.documentElement.scrollHeight+1;const proportional=innerWidth<=650?true:Math.abs(r.height-Math.max(minimum-2,frame.parentElement.clientWidth*10/16-2))<=3&&r.width<=1120&&r.left>=Math.min(48,(innerWidth-r.width)/2)-1;return Math.abs(frame.contentWindow.innerWidth-r.width)<=2&&r.height>=Math.min(240,innerHeight-124)&&fits&&proportional&&r.top>=nav.bottom; }),'live app fits the available responsive viewport');
  await page.evaluate(()=>document.querySelector('.live-app-frame').contentDocument.fonts.ready);
  await page.evaluate(()=>{const frame=document.querySelector('.live-app-frame');window.__qaDemoWindow=frame.contentWindow;frame.scrollIntoView({block:'center',behavior:'instant'});});
  mark('workspace/open-material');
  await page.focus('[data-testid=desk-continue]');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.live-app-frame').contentDocument.querySelector('.reading-sentence .reading-word'));
  check(true,'actual material control opens real reading view');
  mark('workspace/lookup');await page.focus('css=.reading-sentence[data-sentence="0"] .reading-word >> nth=1');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.live-app-frame').contentDocument.querySelector('.context-panel .longman-meaning'));
  mark('workspace/save');
  await page.focus('[data-sheet-active] [data-sheet-id]');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.live-app-frame').contentDocument.querySelector('.quiet-pocket')?.getAttribute('aria-label').endsWith(' · 1'));
  mark('workspace/theme');await page.focus('.site-nav .theme-button');await page.keyboard.press('Enter');
  await page.waitForFunction(theme=>document.querySelector('.live-app-frame').contentDocument.documentElement.dataset.theme===(theme==='ocean'?'midnight':'ocean'),theme);
  await page.focus('.site-nav .theme-button');await page.keyboard.press('Enter');await page.waitForFunction(theme=>document.querySelector('.live-app-frame').contentDocument.documentElement.dataset.theme===theme,theme);
  mark('workspace/locale');const other=locale==='en'?'zh':'en';await page.focus('.site-nav .language-switch a[lang='+other+']');await page.keyboard.press('Enter');
  await page.waitForFunction(locale=>document.querySelector('.live-app-frame').contentDocument.documentElement.lang===locale,other);
  check(await page.evaluate(()=>document.querySelector('.live-app-frame').contentWindow===window.__qaDemoWindow&&document.querySelector('.live-app-frame').contentDocument.querySelector('.quiet-pocket')?.getAttribute('aria-label').endsWith(' · 1')),'locale and theme preserve the same live app and saved state');
  await page.focus('.site-nav .language-switch a[lang='+locale+']');await page.keyboard.press('Enter');await page.waitForFunction(locale=>document.querySelector('.live-app-frame').contentDocument.documentElement.lang===locale,locale);
  mark('workspace/checks');const state=await observe();check(state.width===width,'requested viewport width');check(!state.overflow,'workspace horizontal overflow');check(!state.errors.length,'workspace missing outer assets: '+JSON.stringify(state.errors));check(!state.remote.length,'workspace unexpected outer network request');
  check(await contrast('.workspace-download p')>=4.5,'download summary contrast');
  if(locale==='zh'&&(width===390||width===1440)){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:cfg.out+'/workspace-'+locale+'-'+theme+'-'+width+'x'+cfg.height+'.png'});}
  mark('download');await page.goto(prefix+'download/');await page.waitForSelector('.download-page');
  check(await page.evaluate(()=>!document.querySelector('iframe')&&document.querySelector('.download-page').textContent.includes('v0.4.5')),'download route contains release and install details only');
  check(await page.evaluate(()=>[...document.querySelectorAll('.download-grid a')].length===3),'real public platform download links');
  mark('support');await page.goto(prefix+'support/');await page.waitForSelector('.support-page');
  check(await page.evaluate(()=>!document.querySelector('iframe')&&!!document.querySelector('a[href="https://www.ifdian.net/a/skylar-lexicue"]')),'support route contains support destinations only');
  if(locale!=='zh')check(await page.evaluate(()=>!!document.querySelector('a[href="https://www.patreon.com/16942122/join"]')),'localized membership link retained');
  mark('legacy-link');await page.goto(homeFor(locale)+'#feature-sync');await page.waitForSelector('#device-sync');
  check(await page.url().then(url=>url.includes('/guide/settings/')&&url.endsWith('#device-sync')),'older feature links resolve to the corresponding guide');
 }
 if(cfg.mode!=='home')for(const chapter of cfg.guides[locale]){
  mark('manual/'+chapter.id);await page.goto(cfg.base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/');await page.waitForSelector('.doc-section');
  check(await page.evaluate(()=>document.querySelectorAll('.doc-section').length)===cfg.manualContent[locale][chapter.id].sections.length,'complete manual sections');
  const state=await observe();check(!state.overflow,'manual horizontal overflow');check(!state.errors.length,'manual missing assets');
  check(await contrast('.manual-intro')>=4.5,'manual contrast');
  if(cfg.manualContent[locale][chapter.id].sections.some(s=>s.image)){
   const picture='.doc-image-'+(theme==='midnight'?'dark':'light')+' img';
   await page.evaluate(selector=>document.querySelector(selector).scrollIntoView(),picture);
   await page.waitForFunction(selector=>{const img=document.querySelector(selector);return img.complete&&img.naturalWidth>0;},picture);
   await page.focus('[data-doc-image]');await page.keyboard.press('Enter');await page.waitForSelector('.doc-lightbox[open]');
   check(await page.evaluate(()=>document.querySelector('.doc-lightbox img').src).then(src=>src.endsWith(theme+'-'+(width<=650?'mobile':'desktop')+'.webp')),'full-size manual picture matches theme and viewport');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.doc-lightbox'));
   await page.waitForFunction(()=>document.activeElement.matches('[data-doc-image]')).catch(e=>{throw Error('Focus restore: '+stage+'; '+e.message);});check(true,'manual lightbox restores focus');
  }
 }
 results.push({locale,theme,width,height:cfg.height});console.log('Verified '+locale+'/'+theme+'/'+width+'/'+cfg.mode);
}
// Static content remains useful without JavaScript.
mark('no-javascript');
await page.cdp('Emulation.setScriptExecutionDisabled',{value:true});
for(const locale of cfg.locales){await page.goto(homeFor(locale));check(await page.evaluate(()=>!!document.querySelector('.workspace-noscript')&&document.querySelector('.workspace-download').textContent.includes('v0.4.5')&&document.querySelectorAll('.kn-story').length===5),'no-JavaScript guidance and real download status');if(cfg.mode!=='home')for(const chapter of cfg.guides[locale]){await page.goto(cfg.base+(locale==='en'?'':locale+'/')+'guide/'+chapter.id+'/');check(await page.evaluate(()=>document.querySelectorAll('.doc-section').length)===cfg.manualContent[locale][chapter.id].sections.length,'no-JavaScript complete guide');}}
await page.cdp('Emulation.setScriptExecutionDisabled',{value:false});
await fs.writeFile(cfg.out+'/report-'+cfg.mode+'-'+cfg.locales.join('-')+'-'+cfg.widths.join('-')+'x'+cfg.height+'-'+cfg.themes.join('-')+'.json',JSON.stringify({checks,results,scope:'Chromium browser emulation; no native or physical-device acceptance'},null,2));console.log(checks+' current website checks passed.');
}catch(error){
 let bounds;
 try{bounds=await page.evaluate(()=>{
  const frame=document.querySelector('.live-app-frame'),child=frame?.contentWindow,doc=child?.document;
  const rect=el=>{const r=el?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,bottom:r.bottom}:null;};
  const button=doc?.querySelector('.quiet-pocket');
  return {url:location.href,stageVisibility:document.visibilityState,viewport:{width:innerWidth,height:innerHeight,scrollY},iframe:rect(frame),childViewport:child?{width:child.innerWidth,height:child.innerHeight,visibility:doc.visibilityState}:null,save:rect(button),saveDisabled:button?.disabled,material:rect(doc?.querySelector('[data-testid=desk-continue]')),activeElement:doc?.activeElement?.outerHTML?.slice(0,250),animations:doc?.getAnimations().filter(a=>a.playState==='running'||a.pending).slice(0,8).map(a=>({target:a.effect?.target?.className,state:a.playState,end:a.effect?.getComputedTiming().endTime}))};
 });}catch(diagnosticError){bounds={diagnosticError:String(diagnosticError)};}
 console.error('QA failure '+JSON.stringify({stage,error:String(error),bounds}));
 throw Error(stage+': '+String(error));
}
`;
function runBrowser(input){
 const result=spawnSync('ego-browser',['nodejs'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024});
 if(result.stdout)process.stdout.write(result.stdout);
 if(result.stderr)process.stderr.write(result.stderr);
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('Current website browser acceptance failed.');
 return result.stdout;
}
const owned=!config.space;
if(owned){const output=runBrowser("const t=await taskSpace('LexiCue current website acceptance');console.log('QA_SPACE='+t.spaceId);");config.space=Number(output.match(/QA_SPACE=(\d+)/)?.[1]);if(!config.space)throw Error('Ego did not return a task space.');config.page='p1';}
// A complete default run is deliberately several short rounds in the same space.
// Every round re-applies its temporary viewport and verifies one locale/theme/width.
for(const locale of config.locales)for(const theme of config.themes)for(const width of config.widths){
 runBrowser(browserScript({...config,locales:[locale],themes:[theme],widths:[width]}));
}
if(owned)runBrowser(`const t=await taskSpace(${config.space});await t.finish({keep:[]});`);
