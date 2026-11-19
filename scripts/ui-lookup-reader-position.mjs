/** Sample the actual mobile reader and rising sheet after a touch lookup. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const output = process.env.LEXICUE_LOOKUP_POSITION_OUTPUT || '/tmp/lexicue-lookup-position';
const h = await createReadingHarness(output);
const checks = [], positions = [];
function equal(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks.push(label);
}
try {
 // A physical-style tap below the resting sheet edge keeps the highlighted word
 // in front of the rising sheet, including when the document needs extra tail space.
 const lines = Array.from({length:14}, () => 'The evening train crosses the river near the old market.');
 const reader = await h.call('import_reading_material', {input:{
   operation_id:crypto.randomUUID(), name:'Lookup position.txt', content:lines.join('\n'),
   segments:lines.map((en_text,index)=>({index,en_text,start_time:null,end_time:null})),
 }});
 for (const theme of ['sage','midnight']) for (const viewport of [{width:390,height:844},{width:667,height:375}]) {
  const label = `${theme}/${viewport.width}`;
  const context=await h.browser.newContext({viewport,isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await h.fixture(page,theme);
  await page.goto(`${h.url}/files/${reader.file_id}`);
  const word=page.locator('[data-sentence="6"] .reading-word').filter({hasText:/^crosses$/});
  await word.waitFor();
  await page.evaluate(()=>document.fonts.ready);
  const placeWord=async locator=>locator.evaluate(node=>{
   const scroll=node.closest('.reader-scroll');
   scroll.scrollTop+=node.getBoundingClientRect().bottom-innerHeight*.80;
   return scroll.scrollTop;
  });
  const tapWord=async locator=>{
   const {x,y,width,height}=await locator.boundingBox();
   await page.touchscreen.tap(x+width/2,y+height/2);
  };
  const initial=await placeWord(word);
  await word.evaluate(node=>{
   window.readerPositionFrames=[];
   const scroll=node.closest('.reader-scroll');
   const start=performance.now();
   const sample=()=>{
    const drawer=document.querySelector('.context-panel');
    const rect=node.getBoundingClientRect();
    window.readerPositionFrames.push({
     scroll:scroll.scrollTop, wordTop:rect.top, wordBottom:rect.bottom,
     drawerTop:drawer?.getBoundingClientRect().top, height:drawer?.offsetHeight,
     selected:node.getAttribute('aria-pressed')==='true',
    });
    if(performance.now()-start<600)requestAnimationFrame(sample);
    else window.readerPositionFrames.done=true;
   };
   sample();
  });
  await tapWord(word);
  await page.waitForFunction(()=>window.readerPositionFrames.done);
  const frames=await page.evaluate(()=>window.readerPositionFrames.filter(f=>f.selected&&f.drawerTop!==undefined));
  positions.push({label, initial, frames});
  const end=frames.at(-1);
  equal(end.scroll>initial+30 && end.wordBottom<=end.drawerTop-14,true,`${label}: lower word finishes fully visible with breathing room`);
  equal(new Set(frames.map(f=>f.scroll)).size>=6,true,`${label}: reader moves over multiple frames`);
  equal(frames.every((f,i)=>!i||f.scroll>=frames[i-1].scroll),true,`${label}: reader settles without bouncing`);
  equal(frames.every(f=>f.drawerTop>=f.wordBottom-.5),true,`${label}: the rising sheet never covers the word`);
  equal(new Set(frames.map(f=>f.height)).size,1,`${label}: the drawer frame stays fixed`);

  // A second word already above the open drawer needs no adjustment.
  const next=page.locator('[data-sentence="6"] .reading-word').filter({hasText:/^train$/});
  await tapWord(next);
  await page.getByRole('dialog',{name:'train',exact:true}).waitFor();
  await page.waitForTimeout(380);
  equal(await page.locator('.reader-scroll').evaluate(n=>n.scrollTop),end.scroll,`${label}: switching to a visible word keeps the reading position`);
  equal(await page.locator('.context-panel').evaluate(n=>n.offsetHeight),end.height,`${label}: switching retains drawer height`);
  await page.keyboard.press('Escape');
  await page.locator('.context-panel').waitFor({state:'detached'});

  // Reduced motion still reveals the final word at the end of the document.
  await page.emulateMedia({reducedMotion:'reduce'});
  const last=page.locator('[data-sentence="13"] .reading-word').last();
  const oldLimit=await last.evaluate(node=>{
   const scroll=node.closest('.reader-scroll');
   scroll.scrollTop=scroll.scrollHeight;
   return scroll.scrollTop;
  });
  await tapWord(last);
  await page.getByRole('dialog',{name:'market',exact:true}).waitFor();
  const lastPosition = await last.evaluate(n=>{
   const rect=n.getBoundingClientRect(), scroll=n.closest('.reader-scroll'), drawer=document.querySelector('.context-panel');
   return {scroll:scroll.scrollTop,top:rect.top,bottom:rect.bottom,readerTop:scroll.getBoundingClientRect().top,sheetTop:drawer.getBoundingClientRect().top};
  });
  equal(lastPosition.scroll>oldLimit && lastPosition.top>=lastPosition.readerTop && lastPosition.bottom<=lastPosition.sheetTop-14,true,
        `${label}: reduced motion reveals the last word immediately despite the old scroll limit (${JSON.stringify({oldLimit,...lastPosition})})`);
  await page.keyboard.press('Escape');
  await page.locator('.context-panel').waitFor({state:'detached'});
  equal(await page.locator('.reading-layout').evaluate(n=>n.style.getPropertyValue('--lookup-reader-tail')),'',`${label}: closing removes the temporary room below the article`);
  await context.close();
 }
 equal(h.errors, [], 'no uncaught browser errors');
 console.log(`Lookup source visibility: ${checks.length} checks passed`);
} finally {
 await writeFile(`${output}/report.json`, JSON.stringify({checks, positions}, null, 2));
 await h.dispose();
}
