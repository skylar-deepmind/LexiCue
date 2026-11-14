// Capture the current app components with the existing disposable SQLite fixture.
// Start a dedicated reading bridge and app dev server before running this script.
import {readFile,writeFile,mkdir,readdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root=fileURLToPath(new URL('../../',import.meta.url));
const infoPath=process.env.LEXICUE_READING_BRIDGE_INFO;
if(!infoPath)throw Error('Set LEXICUE_READING_BRIDGE_INFO to the dedicated test bridge info JSON.');
const info=JSON.parse(await readFile(infoPath,'utf8'));
if(info.temporary!==true||!Number.isInteger(info.port)||info.port<1||info.port>65535)throw Error('A disposable reading bridge is required.');
const bridge=`http://127.0.0.1:${info.port}`;
const app=new URL(process.env.LEXICUE_UI_URL||'http://127.0.0.1:5173');
if(app.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(app.hostname))throw Error('Use a local app dev server.');
const choose=(key,fallback,allowed)=>{
 const values=(process.env[key]||fallback).split(',');
 if(values.some(v=>!allowed.includes(v)))throw Error(`Unsupported ${key}`);
 return values;
};
const locales=choose('LEXICUE_ASSET_LOCALES','en,zh,ja,de',['en','zh','ja','de']);
const themes=choose('LEXICUE_ASSET_THEMES','ocean,midnight',['ocean','midnight']);
const devices=choose('LEXICUE_ASSET_DEVICES','desktop,mobile',['desktop','mobile']);
const scenes=choose('LEXICUE_ASSET_SCENES','materials,reading,lookup,saved,recall,settings',['materials','reading','lookup','saved','recall','settings']);
const call=async(command,args={})=>{
 const response=await fetch(bridge,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,args})});
 const result=await response.json();if(result.error)throw Error(JSON.stringify(result.error));return result.value;
};
const stories=[
 ['A quiet morning.txt',[
  ['A quiet morning is a good time to read.','安静的清晨很适合阅读。'],
  ['Curiosity helps us notice small changes.','好奇心帮助我们发现细微的变化。'],
  ['We take off our coats and sit beside the window.','我们脱下外套，坐在窗边。'],
  ['A familiar phrase can carry a new meaning in another story.','熟悉的表达在另一个故事中可能有新的含义。'],
  ['One sentence is enough to begin.','从一句话就可以开始。'],
 ]],
 ['The next journey.txt',[
  ['The plane will take off before dawn.','飞机将在黎明前起飞。'],
  ['We leave a little space for things we have not planned.','我们为计划之外的事留出一点余地。'],
  ['Reading a new story brings familiar words back to us.','阅读新故事，让我们再次遇见熟悉的词。'],
 ]],
 ['Small steps.txt',[
  ['Small steps can lead to meaningful changes.','小小的行动可以带来有意义的变化。'],
  ['We return to the page and try again.','我们回到这一页，再试一次。'],
 ]],
];
const ids=[];
for(const [index,[name,lines]] of stories.entries())ids.push((await call('import_reading_material',{input:{
 operation_id:`marketing-current-${index}`,name,normalized_kind:'txt',content:lines.map(l=>l[0]).join('\n'),
 segments:lines.map(([en_text,zh_text],index)=>({index,en_text,zh_text,start_time:null,end_time:null})),
}})).file_id);
const old=await call('open_reading_material',{fileId:ids[0]}),segment=old.segments[2],start=segment.en_text.indexOf('take off');
await call('mutate_saved_record',{operationId:'marketing-context',mutation:{kind:'save',input:{
 segment_id:segment.id,expression:'take off',start_offset:start,end_offset:start+8,
 explanation:'脱下外套。记住它与衣物搭配时的用法。',explanation_source:'personal',
}}});

// Reuse the maintained native boundary fixture, rather than inventing app stores.
const harness=await readFile(resolve(root,'scripts/ui-reading-support.mjs'),'utf8');
const begin='await page.addInitScript(({bridge,theme,extraCommands})=>{',end=' },{bridge,theme,extraCommands});';
if(!harness.includes(begin)||!harness.includes(end))throw Error('Reading fixture changed; update the screenshot adapter.');
const body=harness.split(begin)[1].split(end)[0];
const init=`(()=>{const q=new URLSearchParams(location.search); const theme=q.get('theme')||'ocean'; (({bridge,theme,extraCommands})=>{${body}
localStorage.setItem('lexicue-preferences',JSON.stringify({state:{uiLanguage:q.get('locale')||'en'},version:0}));
localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));
})({bridge:${JSON.stringify(bridge)},theme,extraCommands:[]});})();`;
function ego(source){
 const result=spawnSync('ego-browser',['nodejs'],{input:source,encoding:'utf8',cwd:root,maxBuffer:8*1024*1024});
 if(result.status!==0)throw Error(result.stderr||result.stdout||'ego-browser failed');
 process.stdout.write(result.stdout);return result.stdout;
}
const suppliedSpace=process.env.LEXICUE_EGO_SPACE;
const space=suppliedSpace?Number(suppliedSpace):Number(ego("const t=await taskSpace('LexiCue current product assets');console.log('ASSET_SPACE='+t.spaceId);").match(/ASSET_SPACE=(\d+)/)?.[1]);
if(!Number.isInteger(space)||space<1)throw Error('A valid Ego TaskSpace is required.');
const page=process.env.LEXICUE_EGO_PAGE||'p1',temp=await mkdtemp(join(tmpdir(),'lexicue-current-assets-'));
const output=resolve(root,'docs/media/current');
const previous=JSON.parse(await readFile(resolve(output,'manifest.json'),'utf8').catch(()=>'{}'));
for(const locale of locales)for(const theme of themes)for(const device of devices){
 const cfg={space,page,init,locale,theme,device,scenes,ids,temp,app:app.origin};
 ego(`const c=${JSON.stringify(cfg)};
const t=await taskSpace(c.space),p=t.page(c.page),fs=await import('node:fs/promises');
await p.cdp('Page.bringToFront');
const initId=(await p.cdp('Page.addScriptToEvaluateOnNewDocument',{source:c.init})).identifier;
try{
await p.cdp('Emulation.setDeviceMetricsOverride',{width:c.device==='mobile'?390:1280,height:c.device==='mobile'?844:850,deviceScaleFactor:1,mobile:c.device==='mobile'});
const target={width:c.device==='mobile'?390:1280,height:c.device==='mobile'?844:850};
const actual=await p.evaluate(()=>({width:innerWidth,height:innerHeight}));
if(Math.abs(actual.width-target.width)>1||Math.abs(actual.height-target.height)>1)await p.cdp('Emulation.setDeviceMetricsOverride',{width:Math.round(target.width*target.width/actual.width),height:Math.round(target.height*target.height/actual.height),deviceScaleFactor:1,mobile:c.device==='mobile'});
await p.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
const q='?locale='+c.locale+'&theme='+c.theme;
const go=async path=>{await p.goto(c.app+path+q);await p.waitForLoadState('load');};
const shot=async scene=>{if(!c.scenes.includes(scene))return;await p.evaluate(()=>document.fonts.ready.then(()=>true));await p.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished)).then(()=>true));const capture=await p.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true});await fs.writeFile(c.temp+'/'+c.locale+'-'+scene+'-'+c.theme+'-'+c.device+'.png',Buffer.from(capture.data,'base64'));};
await go('/files');await p.waitForSelector('.desk-library-dock');
await p.evaluate(async ids=>{const {useMaterialStore:m}=await window.__uiStoreModule('materialStore');await m.getState().load();const {useReadingDeskStore:d}=await window.__uiStoreModule('readingDeskStore');for(const id of [...ids].reverse())d.getState().keep(m.getState().files.find(f=>f.id===id));d.getState().select(m.getState().files.find(f=>f.id===ids[0]));d.getState().clearNotice();},c.ids);
await p.waitForSelector('.desk-paper[data-desk-active="true"]');await shot('materials');
if(c.scenes.some(s=>['reading','lookup','recall'].includes(s))){
 await go('/files/'+c.ids[1]);await p.waitForSelector('.reading-word');await shot('reading');
 if(c.scenes.includes('lookup')){await p.focus('.reading-word[data-word-index="1"] >> nth=0');await p.keyboard.press('Enter');await p.waitForSelector('.dictionary-overview [data-overview-sense]',{timeout:20000});await shot('lookup');await p.keyboard.press('Escape');await p.waitForSelector('.context-panel',{state:'detached'});}
 if(c.scenes.includes('recall')){await p.waitForSelector('.reading-word[data-recall]');await p.evaluate(()=>document.querySelector('.reading-word[data-recall]').click());await p.waitForFunction(()=>document.querySelector('.lookup-content')?.dataset.refreshState==='ready'&&document.querySelector('.context-panel [data-testid=lookup-records-tab]'));await p.evaluate(()=>document.querySelector('.context-panel [data-testid=lookup-records-tab]').click());await p.waitForSelector('.context-panel .saved-context-entry');await shot('recall');}
}
if(c.scenes.includes('saved')){await go('/saved');await p.waitForSelector('.saved-record-row');await p.click('.saved-record-open >> nth=0');await p.waitForSelector('.saved-context-entry');await shot('saved');}
if(c.scenes.includes('settings')){await go('/settings');await p.waitForSelector('.settings-groups');await shot('settings');}
console.log('Captured '+c.locale+'/'+c.theme+'/'+c.device);
}finally{await p.cdp('Page.removeScriptToEvaluateOnNewDocument',{identifier:initId});}
`);
 await mkdir(resolve(output,locale),{recursive:true});
 for(const scene of scenes)await sharp(resolve(temp,`${locale}-${scene}-${theme}-${device}.png`)).resize(device==='mobile'?390:1280,device==='mobile'?844:850,{fit:'fill'}).webp({quality:86}).toFile(resolve(output,locale,`${scene}-${theme}-${device}.webp`));
}
const images=[];
for(const locale of ['en','zh','ja','de'])for(const file of await readdir(resolve(output,locale)).catch(()=>[])){
 if(!file.endsWith('.webp'))continue;const {width,height}=await sharp(resolve(output,locale,file)).metadata();images.push({path:`${locale}/${file}`,width,height});
}
const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
const source=git.stdout.trim(),capturedAt=new Date().toISOString().slice(0,10),recaptured=[];
for(const locale of locales)for(const theme of themes)for(const device of devices)for(const scene of scenes)recaptured.push(`${locale}/${scene}-${theme}-${device}.webp`);
const provenance=images.map(image=>{
 const old=(previous.images||[]).find(item=>item.path===image.path);
 return {...image,source:recaptured.includes(image.path)?source:old?.source||previous.source||null,capturedAt:recaptured.includes(image.path)?capturedAt:old?.capturedAt||previous.capturedAt||null};
});
await writeFile(resolve(output,'manifest.json'),JSON.stringify({latestCapture:{source,capturedAt,recaptured},scope:'Current application React components rendered in Chromium desktop/mobile emulation. Original English sample materials and existing Chinese translations; personal note in Chinese. Native I/O uses ui-reading-support and a dedicated disposable SQLite test bridge. Speech is silent; dictionary fallback may fetch online. No personal library, pairing or physical-device acceptance.',images:provenance},null,2)+'\n');
if(!suppliedSpace)ego(`await (await taskSpace(${space})).finish({keep:[]});`);
console.log(`Captured ${locales.length*themes.length*devices.length*scenes.length} images; source PNGs: ${temp}`);
