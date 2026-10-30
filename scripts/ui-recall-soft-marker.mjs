/** Soft marker UI regression: real frontend + temporary SQLite; audio is a UI-only stub. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {createReadingHarness,root} from './ui-reading-support.mjs';

const output=process.env.LEXICUE_SOFT_MARKER_UI_OUTPUT||'/tmp/lexicue-recall-soft-marker-v1/visual';
const h=await createReadingHarness(output);
const checks=[],screenshots=[],contrasts=[],layouts=[],groups=[],paintGeometry=[],consoleMessages=[],resourceFailures=[];
let currentPage,baselineControls;
const ok=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks.push(label);};
const rows=[
 'I used to put off difficult tasks. But curiosity helped me get started.',
 'Then I came across an idea that helped me make sense of the problem.',
 '🚀 “Put   off,” she said. Don’t put off a well-known task; make sense of it.',
 'put off curiosity came across make sense of put off curiosity.',
 'Tomorrow, please put off this task and make sense of every detail.',
 'We read carefully and keep going.',
 ...Array.from({length:5},(_,i)=>`We ${'carefully '.repeat(i+1)}make sense of the problem.`),
 'well-being curiosity helps us learn.',
 'curiosity well-being matters.',
 'well-being.',
];
const expressions=['put off','curiosity','came across','make sense of','well-being curiosity','curiosity well-being','well-being'];
const original=(page,index)=>page.locator(`[data-sentence="${index}"] .reading-original`);
const word=(page,index,text)=>original(page,index).locator('.reading-word').filter({hasText:new RegExp(`^${text}$`)}).first();
const ready=page=>page.locator('.reading-paper[data-recall-state="ready"]').waitFor();
const paint=page=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
const close=async page=>{if(await page.locator('.context-panel').count()){await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});}await page.mouse.move(4,4);await paint(page);};
async function shot(page,name){const path=`${output}/${name}.png`;await page.screenshot({path});screenshots.push(path);}
async function importRows(name,texts){const imported=await h.call('import_reading_material',{input:{operation_id:randomUUID(),name,content:texts.join('\n'),segments:texts.map((text,index)=>({index,en_text:text,zh_text:null}))}});return h.call('open_reading_material',{fileId:imported.file_id});}
async function fixture(page,theme){
 await h.fixture(page,theme);
 page.on('response',response=>{if(response.status()>=400)resourceFailures.push({theme,url:response.url(),status:response.status()});});
 page.on('console',message=>{if(['warning','error'].includes(message.type()))consoleMessages.push({theme,type:message.type(),text:message.text(),location:message.location()});});
 await page.addInitScript(()=>{
  // No live synthesis/network request or actual sound. Queue and sentence UI still use production state/actions.
  window.__markerAudio=[];
  window.Audio=class{constructor(){window.__markerAudio.push(this);}async play(){this.onplaying?.();}pause(){}load(){}removeAttribute(){}};
  const invoke=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
   if(command==='resolve_tts_audio'){window.__uiCalls.push({command,args:structuredClone(args)});return{data_base64:'UI_ONLY_STUB',mime:'audio/mpeg',cache_key:'ui-only',source:'edge-cache',voice:args.request.voice,speed:args.request.speed,duration_ms:60000};}
   if(['cancel_tts','clear_tts_cache','invalidate_tts_cache'].includes(command))return null;
   return invoke(command,args);
  };
 });
}
async function openExpression(page,index,expression,activate){
 const before=await page.evaluate(()=>window.__uiCalls.length);
 await activate();await page.locator('.context-panel').waitFor();
 await page.waitForFunction(({before,expression})=>window.__uiCalls.slice(before).some(call=>call.command==='saved_for_selection'&&call.args.input.expression===expression),{before,expression});
 eq(await page.locator('.soft-refresh-current .lookup-context p[lang="en"]').textContent(),rows[index],`current sentence preserved for ${expression}`);
}
async function contrast(ink,label){
 const value=await ink.evaluate(node=>{
  const parse=value=>{const values=value.match(/[\d.]+/g)?.map(Number);if(!values||values.length<3)throw Error(`Unsupported computed color ${value}`);return [...values.slice(0,3),values[3]??1];};
  const blend=(top,bottom)=>top.slice(0,3).map((v,i)=>v*top[3]+bottom[i]*(1-top[3]));
  const luminance=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const layers=[];for(let parent=node;parent;parent=parent.parentElement)layers.unshift(parent);
  let upper=[255,255,255],lower=[255,255,255];const images=[];
  for(const element of layers){const styles=[getComputedStyle(element)];if(element===node)for(const pseudo of ['::before','::after']){const style=getComputedStyle(element,pseudo);if(style.content!=='none'&&style.content!=='normal')styles.push(style);}for(const style of styles){const background=parse(style.backgroundColor);upper=blend(background,upper);lower=blend(background,lower);if(style.backgroundImage!=='none'){images.push(style.backgroundImage);const stops=[...style.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map(match=>parse(match[0]));if(stops.length){const marker=stops.at(-1);lower=blend(marker,lower);}}}}
  const style=getComputedStyle(node),foreground=parse(style.color);
  const ratios=[upper,lower].map(background=>{const a=luminance(foreground),b=luminance(background);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
  return{color:style.color,upper,lower,ratios,min:Math.min(...ratios),images,font:style.fontSize,lineHeight:style.lineHeight};
 });
 contrasts.push({label,...value});ok(value.min>=4.5,`${label}: text contrast ${value.min.toFixed(2)}:1 across actual computed surface/gradient stops`);return value;
}
async function verifyText(page,label){
 for(let index=0;index<rows.length;index++)eq(await original(page,index).textContent(),rows[index],`${label}: sentence ${index} exact textContent/UTF-16`);
 const values=await page.locator('.reading-recall').evaluateAll(nodes=>nodes.map(node=>({sentence:Number(node.closest('[data-sentence]').dataset.sentence),start:Number(node.dataset.recallStart),end:Number(node.dataset.recallEnd),ink:[...node.querySelectorAll('.reading-recall-ink')].map(part=>part.textContent).join(''),text:node.textContent,focusable:node.matches('button,[tabindex]'),rects:[...node.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}))})));
 ok(values.length>12,`${label}: repeated/dense saved matches rendered`);
 for(const value of values){eq(value.ink,rows[value.sentence].slice(value.start,value.end),`${label}: match ink preserves original range ${value.sentence}:${value.start}-${value.end}`);ok(!value.focusable,`${label}: group does not add a focus target`);}
 eq(values.filter(value=>value.sentence===3).length,6,`${label}: adjacent distinct and repeated matches retain six groups`);
 for(const [index,expression]of [[11,'well-being curiosity'],[12,'curiosity well-being'],[13,'well-being']]){eq(values.filter(value=>value.sentence===index).map(value=>value.ink),[expression],`${label}: tokenizer-skipped hyphen characters painted inside existing match`);eq(await original(page,index).locator('.reading-word').evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,index:node.dataset.wordIndex}))),baselineControls[index],`${label}: native hyphen word controls stay identical to unmarked baseline`);}
 const special=values.find(value=>value.sentence===2&&value.ink==='Put   off');ok(!!special,`${label}: multiple phrase spaces and quoted uppercase preserved`);eq(special.start,rows[2].indexOf('Put'),`${label}: emoji prefix retains UTF-16 start offset`);
 const punctuation=await page.locator('.reading-token').evaluateAll(nodes=>nodes.flatMap(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE&&/[,.;:!?…’”"')\]]/.test(child.textContent)).map(child=>{const range=new Range();range.selectNodeContents(child);const bounds=range.getBoundingClientRect(),word=node.querySelector('.reading-word,.reading-word-passive'),textRange=new Range();const walker=document.createTreeWalker(word,NodeFilter.SHOW_TEXT);let textNode=walker.nextNode(),last=textNode;while(textNode){last=textNode;textNode=walker.nextNode();}textRange.selectNodeContents(last);const textBounds=textRange.getBoundingClientRect();return{text:child.textContent,insideInk:!!child.parentElement.closest('.reading-recall-ink'),sameLine:Math.abs(bounds.bottom-textBounds.bottom)<2};})));
 ok(punctuation.length>6,`${label}: punctuation fixtures actually present`);ok(punctuation.every(item=>!item.insideInk&&item.sameLine),`${label}: trailing punctuation unpainted and stays with its word`);
 groups.push({label,values,punctuation});return values;
}
async function verifyPaintContinuity(page,label){
 const value=await page.evaluate(()=>{
  const box=node=>{const r=node.getBoundingClientRect(),style=getComputedStyle(node),pseudo=getComputedStyle(node,'::before'),hasPseudo=pseudo.content!=='none'&&pseudo.content!=='normal',width=hasPseudo?Math.max(r.width,parseFloat(pseudo.width)||0):r.width;return{text:node.textContent,x:r.x,y:r.y,right:r.x+width,width,inkWidth:r.width,height:r.height,image:style.backgroundImage,pseudoImage:hasPseudo?pseudo.backgroundImage:null};};
  const phrase=document.querySelector('[data-sentence="0"] .reading-recall'),parts=[...phrase.querySelectorAll('.reading-recall-ink')].filter(node=>node.textContent).map(box),buttons=[...phrase.querySelectorAll('.reading-word,.reading-word-passive')].map(node=>{const r=node.getBoundingClientRect();return{text:node.textContent,width:r.width,height:r.height};});
  const dense=[...document.querySelectorAll('[data-sentence="3"] .reading-recall')].map(group=>[...group.querySelectorAll('.reading-recall-ink')].filter(node=>node.textContent).map(box));
  const boundaries=dense.slice(0,-1).map((parts,index)=>{const a=parts.at(-1),b=dense[index+1][0];return{from:a.text,to:b.text,gap:b.x-a.right,sameLine:Math.abs(a.y-b.y)<2};});
  return{parts,buttons,boundaries};
 });
 paintGeometry.push({label,...value});
 for(let index=0;index<value.parts.length-1;index++){const a=value.parts[index],b=value.parts[index+1];if(Math.abs(a.y-b.y)<2)ok(b.x-a.right<.6,`${label}: ink continues through short-word button remainder and phrase gap`);}
 const adjacent=value.boundaries.filter(boundary=>boundary.sameLine);ok(adjacent.length>0,`${label}: dense adjacent matches share at least one actual line`);ok(adjacent.every(boundary=>boundary.gap>1),`${label}: separate matches retain an unpainted space`);
 return value;
}
async function geometry(page,label){
 const value=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,scroll:[...document.querySelectorAll('.reader-scroll')].map(node=>({width:node.clientWidth,scroll:node.scrollWidth})),sentences:[...document.querySelectorAll('.reading-original')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})}));
 layouts.push({label,...value});ok(value.document<=value.viewport&&value.scroll.every(row=>row.scroll<=row.width+1),`${label}: no horizontal overflow`);return value;
}
const sameGeometry=(a,b,label)=>ok(a.sentences.every((row,index)=>['x','y','width','height'].every(key=>Math.abs(row[key]-b.sentences[index][key])<1)),label);
async function setFont(page,size){await page.evaluate(async size=>{const {usePreferencesStore}=await window.__uiStoreModule('preferencesStore');usePreferencesStore.getState().setLearningTextFontSize(size);usePreferencesStore.getState().setReadingLineHeight('compact');},size);await page.locator(`.reading-paper[data-font="${size}"][data-lines="compact"]`).waitFor();await paint(page);}
async function hints(page,enabled){await page.getByRole('button',{name:'调整学习内容显示',exact:true}).click();await page.getByRole('checkbox',{name:'再遇提示',exact:true}).setChecked(enabled);await page.keyboard.press('Escape');await page.locator(`.reading-paper[data-recall-state="${enabled?'ready':'off'}"]`).waitFor();await paint(page);}
const headphone=page=>page.locator('.dock-reading-tools:visible button').first();

try{
 for(const theme of ['ocean','midnight']){
  await h.call('test_reset');
  const material=await importRows(`Soft marker ${theme} ${randomUUID()}.txt`,rows);
  const context=await h.browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();currentPage=page;await fixture(page,theme);await page.goto(`${h.url}/files/${material.material.id}`);await ready(page);
  eq(await page.locator('.reading-recall').count(),0,`${theme}: unsaved material has no marker`);baselineControls=await page.locator('.reading-original').evaluateAll(paragraphs=>paragraphs.map(node=>[...node.querySelectorAll('.reading-word')].map(word=>({text:word.textContent,index:word.dataset.wordIndex}))));
  // Exercise the visible save/undo flow before adding old-context fixtures.
  await openExpression(page,0,'curiosity',()=>word(page,0,'curiosity').click());
  await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();await page.locator('.reading-word--recalled[data-recall="curiosity"]').first().waitFor();
  ok(true,`${theme}: saving a word adds its marker`);await page.getByRole('button',{name:'撤销',exact:true}).click();await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).waitFor();await page.locator('.reading-word--recalled').first().waitFor({state:'detached'});await close(page);ok(await word(page,0,'curiosity').evaluate(node=>node===document.activeElement),`${theme}: save/undo regrouping restores focus to current logical word on close`);
  // A separate save-only close catches the first grouping remount as well as undo/removal.
  await openExpression(page,0,'curiosity',()=>word(page,0,'curiosity').click());await page.locator('.lookup-footer').getByRole('button',{name:'记下',exact:true}).click();await page.locator('.lookup-saved').waitFor();await page.locator('.reading-word--recalled').first().waitFor();const saveOnlyOperation=await page.evaluate(()=>window.__uiCalls.findLast(call=>call.command==='mutate_saved_record'&&call.args.mutation.kind==='save').args.operationId);await close(page);ok(await word(page,0,'curiosity').evaluate(node=>node===document.activeElement),`${theme}: saving then closing restores focus after marker group mounts`);await h.call('undo_saved_mutation',{operationId:saveOnlyOperation});await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-saved-changed')));await page.locator('.reading-word--recalled').first().waitFor({state:'detached'});
  const oldRows=expressions.map(expression=>`Earlier we wrote ${expression} in a different context.`),history=await importRows(`Marker historical contexts ${theme}.txt`,oldRows);
  for(const [index,expression]of expressions.entries()){const start=oldRows[index].indexOf(expression);await h.call('mutate_saved_record',{operationId:randomUUID(),mutation:{kind:'save',input:{segment_id:history.segments[index].id,expression,start_offset:start,end_offset:start+expression.length,explanation:null,explanation_source:'unknown'}}});}
  await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-saved-changed')));await page.locator('.reading-word--recalled[data-recall="put off"]').first().waitFor();await ready(page);await paint(page);
  await verifyText(page,`${theme} desktop`);
  const term=word(page,0,'put'),ink=term.locator('.reading-recall-ink');
  const defaultContrast=await contrast(ink,`${theme} default`);ok(defaultContrast.images.length>0,`${theme}: lower-half marker has a real gradient`);const initial=await geometry(page,`${theme} default 1280`);await shot(page,`${theme}-1280-default`);
  await term.hover();await contrast(ink,`${theme} hover`);await shot(page,`${theme}-1280-hover`);sameGeometry(initial,await geometry(page,`${theme} hover`),`${theme}: hover preserves layout`);
  for(const member of ['put','off']){await openExpression(page,0,'put off',()=>word(page,0,member).click());eq(await original(page,0).locator('.reading-word[aria-pressed="true"]').count(),2,`${theme}: clicking ${member} selects full saved phrase`);await contrast(ink,`${theme} selected via ${member}`);if(member==='put')await shot(page,`${theme}-1280-selected`);await close(page);}
  await page.keyboard.press('Tab');await term.focus();ok(await term.evaluate(node=>node.matches(':focus-visible')&&getComputedStyle(node).outlineStyle==='solid'),`${theme}: keyboard focus has a solid visible outline`);await contrast(ink,`${theme} keyboard focus`);await shot(page,`${theme}-1280-focus`);
  for(const key of ['Enter','Space']){await openExpression(page,0,'put off',()=>page.keyboard.press(key));await close(page);await term.focus();}
  await openExpression(page,2,'Put   off',()=>word(page,2,'Put').click());const specialSelection=await page.evaluate(()=>window.__uiCalls.findLast(call=>call.command==='saved_for_selection').args.input);eq([specialSelection.start_offset,specialSelection.end_offset],[rows[2].indexOf('Put'),rows[2].indexOf('Put')+'Put   off'.length],`${theme}: clicked quoted phrase preserves emoji-adjusted UTF-16 offsets`);await close(page);
  await openExpression(page,5,'read',()=>word(page,5,'read').click());eq(await word(page,5,'read').getAttribute('data-recall'),null,`${theme}: ordinary word keeps normal lookup`);await close(page);
  await word(page,0,'used').focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await openExpression(page,0,'used to put off',()=>page.keyboard.up('Shift'));eq(await original(page,0).locator('.reading-word[aria-pressed="true"]').count(),4,`${theme}: Shift arrows expand through marked phrase`);await close(page);
  const edges=await original(page,0).evaluate(node=>{const words=[...node.querySelectorAll('.reading-word')],from=words.find(n=>n.textContent==='used'),to=words.find(n=>n.textContent==='off');const a=new Range(),b=new Range();a.selectNodeContents(from);b.selectNodeContents(to);const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return{from:{x:x.left+.2,y:x.top+x.height/2},to:{x:y.right-.2,y:y.top+y.height/2}};});
  await openExpression(page,0,'used to put off',async()=>{await page.mouse.move(edges.from.x,edges.from.y);await page.mouse.down();await page.mouse.move(edges.to.x,edges.to.y,{steps:12});await page.mouse.up();});eq(await original(page,0).locator('.reading-word[aria-pressed="true"]').count(),4,`${theme}: real mouse drag crosses group boundary`);await close(page);
  const beforeHints=await geometry(page,`${theme} hints on`);await hints(page,false);eq(await page.locator('.reading-recall').count(),0,`${theme}: existing switch clears groups`);sameGeometry(beforeHints,await geometry(page,`${theme} hints off`),`${theme}: disabling hints preserves layout`);await hints(page,true);await term.waitFor();
  const current=(await h.call('saved_recall_contexts',{expression:'curiosity',offset:0,limit:10})).records[0],removed=await h.call('mutate_saved_record',{operationId:randomUUID(),mutation:{kind:'remove',record_id:current.record_id,expected_revision:current.revision}});await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-saved-changed')));await page.locator('.reading-word--recalled[data-recall="curiosity"]').first().waitFor({state:'detached'});ok(true,`${theme}: removing final history clears marker`);await h.call('undo_saved_mutation',{operationId:removed.operation_id});await page.evaluate(()=>window.dispatchEvent(new Event('lexicue-saved-changed')));await page.locator('.reading-word--recalled[data-recall="curiosity"]').first().waitFor();ok(true,`${theme}: undo removal restores marker`);
  let wrapped=false;
  for(const width of [1280,390,320])for(const size of ['sm','md','lg']){
   await page.setViewportSize({width,height:960});await setFont(page,size);await page.mouse.move(4,4);await original(page,0).scrollIntoViewIfNeeded();
   const label=`${theme} ${width} ${size} compact`;await geometry(page,label);await verifyPaintContinuity(page,label);const ranges=await verifyText(page,label);wrapped ||= ranges.some(group=>new Set(group.rects.filter(rect=>rect.width>0).map(rect=>Math.round(rect.y))).size>1);await contrast(word(page,0,'put').locator('.reading-recall-ink'),label);
   if(size==='lg'&&width!==1280)await shot(page,`${theme}-${width}-lg-compact`);
   if(width===390&&size==='md'){await original(page,3).scrollIntoViewIfNeeded();await shot(page,`${theme}-390-dense-continuity`);await original(page,0).scrollIntoViewIfNeeded();}
   const before=await geometry(page,`${label} read`);await headphone(page).click();await page.locator('.reading-page[data-listening="true"]').waitFor();await page.locator('.reading-sentence[data-current="true"][data-speech-state="playing"]').waitFor();sameGeometry(before,await geometry(page,`${label} passive`),`${label}: reading/listening geometry identical`);
   eq(await page.locator('.reading-word').count(),baselineControls.reduce((n,row)=>n+row.length,0),`${label}: listening retains all word lookup controls`);await verifyPaintContinuity(page,`${label} passive`);await contrast(original(page,0).locator('.reading-word.reading-word--recalled .reading-recall-ink').first(),`${label} current passive`);await contrast(original(page,1).locator('.reading-word.reading-word--recalled .reading-recall-ink').first(),`${label} idle passive`);
   if(width===1280&&size==='md'||width===390&&size==='lg')await shot(page,`${theme}-${width}-${size}-passive`);
   await headphone(page).click();await page.locator('.reading-page[data-listening="false"]').waitFor();sameGeometry(before,await geometry(page,`${label} restored`),`${label}: exiting listening preserves layout`);
  }
  ok(wrapped,`${theme}: a saved phrase actually spans natural line breaks`);
  await page.setViewportSize({width:1280,height:960});await setFont(page,'md');await original(page,0).scrollIntoViewIfNeeded();await headphone(page).click();await page.locator('.reading-page[data-listening="true"]').waitFor();const calls=await page.evaluate(()=>window.__uiCalls.filter(call=>call.command.startsWith('lookup_')).length);await page.locator('[data-sentence="1"] .sentence-listen').click();await page.waitForFunction(()=>document.querySelector('[data-sentence="1"]')?.dataset.current==='true');eq(await page.evaluate(()=>window.__uiCalls.filter(call=>call.command.startsWith('lookup_')).length),calls,`${theme}: sentence play button changes playback without word lookup`);await headphone(page).click();await page.locator('.reading-word').first().waitFor();
  // Inject a disabled state solely to inspect applicable CSS; production reader introduces no disabled flow.
  await term.evaluate(node=>node.disabled=true);await term.hover({force:true});const disabledContrast=await contrast(ink,`${theme} synthetic disabled`);eq(disabledContrast.images,defaultContrast.images,`${theme}: disabled hover keeps normal marker`);ok(await term.evaluate(node=>!node.matches(':enabled')),`${theme}: synthetic disabled test target is disabled`);await shot(page,`${theme}-1280-disabled-css`);await term.evaluate(node=>node.disabled=false);await page.mouse.move(4,4);
  await context.close();currentPage=null;console.log(`${theme}: soft marker functional/layout/state checks passed`);
 }
 // Theme inheritance uses the same real imported material and historical contexts.
 const materials=await h.call('list_materials',{tagIds:[],untagged:false}),id=materials.find(item=>item.name.startsWith('Soft marker midnight')).id;
 for(const theme of ['sage','twilight','amber']){
  const context=await h.browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage();currentPage=page;await fixture(page,theme);await page.goto(`${h.url}/files/${id}`);await ready(page);const term=word(page,0,'put');await contrast(term.locator('.reading-recall-ink'),`${theme} inherited default`);await term.hover();await contrast(term.locator('.reading-recall-ink'),`${theme} inherited hover`);await term.click();await page.locator('.context-panel').waitFor();await contrast(term.locator('.reading-recall-ink'),`${theme} inherited selected`);await close(page);await shot(page,`${theme}-1280-inherited`);await context.close();currentPage=null;
 }
 eq(h.errors,[],'no uncaught frontend exceptions');
 eq(consoleMessages.filter(message=>/unique ["']?key|Each child|Encountered two children|cannot be a descendant|cannot appear as a child|validateDOMNesting|Invalid DOM property|hydration/i.test(message.text)),[],'no React key or invalid-DOM console warnings/errors');
 const sourceHashes=Object.fromEntries(await Promise.all(['src/index.css','src/reading.css','src/pages/ReadingPage.tsx','scripts/ui-recall-soft-marker.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(`${root}/${path}`)).digest('hex')])));
 await writeFile(`${output}/evidence.json`,JSON.stringify({passed:true,sourceHashes,checks,screenshots,contrasts,layouts,groups,paintGeometry,errors:h.errors,consoleMessages,resourceFailures,scope:{frontend:'actual Vite application',storage:'real production command cores and disposable SQLite',audio:'TTS result and Audio class stubbed for UI-only passive/current/queue assertions; no real sound, decode, cache or network TTS is claimed',contrast:'computed foreground/surface and actual CSS gradient endpoint compositing, plus screenshots for visual review',syntheticDisabled:'temporarily sets disabled on existing word button to inspect CSS only; no product disabled flow added',uncovered:['native macOS WebView','Windows','Android','iOS','actual audio synthesis and playback']},rows},null,2));
 await Promise.all(['failure.png','failure.json'].map(name=>rm(`${output}/${name}`,{force:true})));
 console.log(`PASS: ${checks.length} soft-marker assertions. Evidence: ${output}/evidence.json`);
}catch(error){if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:`${output}/failure.png`}).catch(()=>{});await writeFile(`${output}/failure.json`,JSON.stringify({error:String(error),stack:error.stack,checks,consoleMessages,resourceFailures,text:await currentPage.locator('body').innerText(),calls:await currentPage.evaluate(()=>window.__uiCalls)},null,2)).catch(()=>{});}throw error;}
finally{await h.dispose();}
