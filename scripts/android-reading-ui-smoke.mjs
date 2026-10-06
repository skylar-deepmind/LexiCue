/** Deterministic browser checks; physical Android acceptance is recorded separately. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const url = process.env.LEXICUE_UI_URL || 'http://127.0.0.1:5173';
const output = '/tmp/lexicue-android-reading-ui';
await mkdir(output, { recursive: true });
let checks = 0;
const errors = [];
async function fixture(page, theme, uiLanguage = 'en', failed = false) {
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ theme, uiLanguage, failed }) => {
    localStorage.setItem('lexicue-theme', theme);
    localStorage.setItem('lexicue-frequency-baseline-intro-seen', 'true');
    if (!localStorage.getItem('lexicue-preferences')) localStorage.setItem('lexicue-preferences', JSON.stringify({ state: { uiLanguage, language:'en', annotationModes:{word:'batch',phrase:'batch'} }, version:0 }));
    const word = { id:1, lemma:'curiosity', language:'en', status:'unprocessed', definition:null, frequency:5, reading:null, part_of_speech:null, word_kind:'common',search_aliases:[] };
    const words = Array.from({length:100}, (_,i) => ({...word,id:i+1,lemma:i ? `vocabulary${String(i).padStart(3,'0')}` : 'curiosity'}));
    const phrases = Array.from({length:100}, (_,i) => ({id:i+1,text:`phrase ${i+1}`, language:'en',status:'unprocessed',definition:null,frequency:5,category:'fixed_expression',unverified:false}));
    const progress = {total:100,unprocessed:100,learning:0,known:0,ignored:0};
    const file = {id:1,name:'Reader fixture',type:'txt',language:'en',folder_id:null,imported_at:1,segment_count:24,phrase_analyzed:true,phrase_analysis_at:null,phrase_skipped_items:0,word_progress:progress,phrase_progress:progress};
    const text = "😀 Let's Curiosity picked it up; novelty, unseen. novelty.";
    const tokens = Array.from(text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g), m => ({segment_index:0,language:'en',surface:m[0],lemma:m[0].toLowerCase()==='picked'?'pick':m[0].toLowerCase(),start:m.index,end:m.index+m[0].length,legacy_position:text.slice(0,m.index).trim().split(/\s+/).length,builtin_position:text.slice(0,m.index).replace(/[.,!?;:()[\]{}"'`«»–—…@#$%^&*+=<>/\\|~]/g,' ').replace(/--/g,' ').trim().split(/\s+/).length,word_id:m[0]==='Curiosity'?1:null,status:m[0]==='Curiosity'?'unprocessed':null}));
    let state = failed ? 'failed' : 'ready';
    window.__calls = [];
    window.__slow = false;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
    window.__TAURI_INTERNALS__ = { transformCallback:()=>1, unregisterCallback(){},convertFileSrc:p=>p,invoke:async (command,args={})=>{
      window.__calls.push({command,args});
      const snapshot = () => ({runId:1,sequence:10,state,currentSource:null,sources:[['ECDICT','en'],['JMdict','ja'],['GermanDict','de'],['CC-CEDICT','zh'],['CC-CEDICT Phrases','zh'],['PhraseDict','en'],['JMdict Idioms','ja']].map(([name,language],i)=>({name,language,state:state==='failed'&&i===0?'failed':'ready',processedRows:2000,error:i===0?'fixture database busy':null}))});
      if(command==='dictionary_init_status')return snapshot();
      if(command==='retry_dictionary_init'){state='ready';return snapshot();}
      if(command==='plugin:event|listen')return 1;
      if(command==='plugin:app|version')return '0.4.2';
      if(command==='list_words')return words.filter(w=>!args.statusFilter||w.status===args.statusFilter);
      if(command==='list_phrases')return phrases;
      if(command==='list_files')return [file];
      if(command==='get_file_info'){if(args.fileId===999&&!window.__allowInfo999)throw Error('database busy');return {...file,id:args.fileId};}
      if(command==='get_file_segments')return Array.from({length:24},(_,i)=>({id:i+1,index_num:i,en_text:text,zh_text:'阅读查词测试',start_time:null,end_time:null}));
      if(command==='get_file_segment_tokens')return [{segment_index:0,surface:'Curiosity',lemma:'curiosity',position:2}];
      if(command==='get_file_reader_tokens')return Array.from({length:24},(_,segment_index)=>tokens.map(t=>({...t,segment_index}))).flat();
      if(command==='get_file_phrases')return [{phrase_id:1,text:'pick it up',status:'unprocessed',definition:null,source:'detected',position:4,segment_index:0,word_count:3,token_positions:null}];
      if(command==='word_detail')return {word,occurrences:[]};
      if(command==='phrase_detail')return {phrase:{...phrases[0],text:'pick it up'},occurrences:[]};
      if(command==='lookup_phrase_dictionary')return {text:args.text,translation:'拿起',other_senses:[],other_senses_en:[],collins_senses:[],collins_available:false,provider:'PhraseDict'};
      if(command==='lookup_dictionary') {
        if(window.__slow) await new Promise(r=>setTimeout(r,400));
        if(args.lemma==='unseen' && args.mode!=='online')throw Error('ERR_DICTIONARY_NOT_FOUND');
        return {lemma:args.lemma,requested_form:args.lemma,matched_headword:args.lemma,match_kind:'exact',language:args.language,provider:args.mode==='online'?'Online fixture':'ECDICT',definitions:[{part_of_speech:'noun',definition:`Meaning of ${args.lemma}`,translation:null,example:null}],fetched_at:0};
      }
      if(command==='get_frequency_baseline')return {tier:null,enabled:false,pending:0,total:0};
      if(command==='get_local_gemma_activity')return {generations:0,pulling:false,deleting:false,sequence:0};
      if(command.startsWith('list_')||command.startsWith('get_file_'))return [];
      return null;
    }};
  },{theme,uiLanguage,failed});
}
async function overflow(page) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), 'horizontal overflow');checks++;
}
async function contrast(button) {
  return button.evaluate(node=>{
    const css=getComputedStyle(node);let parent=node;let bg=css.backgroundColor;
    while(bg==='rgba(0, 0, 0, 0)' && parent.parentElement){parent=parent.parentElement;bg=getComputedStyle(parent).backgroundColor;}
    const lum=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{const c=n/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
    const a=lum(css.color),b=lum(bg);return {ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05),outline:css.outlineStyle};
  });
}
async function close(page) { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state:'detached'}); }
try {
  for(const theme of ['ocean','midnight']) {
    const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    const page = await context.newPage();await fixture(page,theme);
    for(const [width,height] of [[320,844],[375,844],[390,844],[430,844],[844,390],[1440,900]]) {
      await page.setViewportSize({width,height});
      for(const route of ['words','phrases']) {
        await page.goto(`${url}/${route}`);await page.locator('.vocabulary-search').waitFor();await page.waitForTimeout(100);await overflow(page);
        if(width===390){
          const rows = await page.locator('.group').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight-70&&r.height>0}).length);
          assert.ok(rows>=5,`${theme} ${route}: only ${rows} complete entries on first screen`);checks++;
          await page.screenshot({path:`${output}/${theme}-${route}-390.png`});
        }
        if(width<768){assert.equal(await page.locator('.pagination-number:visible').count(),0);checks++;}
      }
    }
    await page.setViewportSize({width:390,height:844});await page.goto(`${url}/words`);
    const trigger = page.locator('.vocabulary-tools-trigger');await trigger.click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(250);await overflow(page);
    for(const button of await page.getByRole('dialog').locator('button').all()) { const r=await button.boundingBox();if(r)assert.ok(r.height>=48&&r.width>=48,`48px touch target: ${await button.innerText()} ${JSON.stringify(r)}`);checks++; }
    const sortButton=page.getByRole('button',{name:'Alphabet',exact:true});
    for(const state of ['default','hover','selected','focus','disabled']) {
      if(state==='hover')await sortButton.hover();
      if(state==='selected')await sortButton.click();
      if(state==='focus'){await sortButton.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');}
      if(state==='disabled')await sortButton.evaluate(n=>{n.disabled=true;});
      const value=await contrast(sortButton);assert.ok(value.ratio>=4.5,`${theme} ${state}: contrast ${value.ratio}`);checks++;
      if(state==='focus'){assert.equal(value.outline,'solid');checks++;}
    }
    await sortButton.evaluate(n=>{n.disabled=false;});await close(page);
    assert.match(await trigger.innerText(),/Alphabet/);checks++;
    assert.equal(await trigger.evaluate(n=>n===document.activeElement),true);checks++;
    await page.screenshot({path:`${output}/${theme}-filters-applied.png`});
    await page.goto(`${url}/files/1`);await page.locator('.reader-content [role=button]').first().waitFor();await overflow(page);
    assert.equal(await page.locator('.reader-search-bar').isVisible(),false);checks++;
    await page.locator('.reader-compact-search-trigger').click();
    assert.equal(await page.locator('.reader-search-bar input').evaluate(n=>n===document.activeElement),true);checks++;
    await page.evaluate(async()=>{(await import('/src/lib/backNavigation.ts')).backNavigation.back();});
    assert.equal(await page.locator('.reader-search-bar').isVisible(),false);assert.ok(page.url().endsWith('/files/1'));checks++;
    assert.equal(await page.locator('.reader-compact-search-trigger').evaluate(n=>n===document.activeElement),true);checks++;

    await page.locator('.reader-content [role=button]').filter({hasText:/^novelty[,]?$/}).first().click();
    await page.getByText('Meaning of novelty',{exact:true}).waitFor();await overflow(page);
    assert.ok((await page.evaluate(()=>window.__calls.filter(c=>c.command==='lookup_dictionary'))).every(c=>c.args.mode==='local'));checks++;
    await page.waitForTimeout(250);await page.screenshot({path:`${output}/${theme}-lookup.png`});await close(page);
    await page.locator('.reader-content [role=button]').filter({hasText:/^unseen[.]?$/}).first().click();await page.getByText('No definition found offline.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Look up online',exact:true}).click();await page.getByText('Meaning of unseen',{exact:true}).waitFor();
    assert.equal((await page.evaluate(()=>window.__calls.filter(c=>c.command==='lookup_dictionary'&&c.args.mode==='online'))).length,1);checks++;await close(page);
    await page.evaluate(()=>{window.__slow=true;});
    await page.locator('.reader-content [role=button]').filter({hasText:/^novelty[,]?$/}).first().click();await page.getByRole('dialog').waitFor();await close(page);await page.waitForTimeout(500);
    assert.equal(await page.getByRole('dialog').count(),0);checks++;
    await page.locator('.reader-content [role=button]').filter({hasText:/^novelty[,]?$/}).first().click();await page.getByRole('dialog').waitFor();await close(page);
    await page.locator('.reader-content [role=button]').filter({hasText:/^unseen[.]?$/}).first().click();await page.getByText('No definition found offline.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Meaning of novelty',{exact:true}).count(),0);checks++;await close(page);

    await page.evaluate(()=>{window.__slow=false;});
    await page.locator('.reader-content [role=button]').filter({hasText:/^Curiosity$/}).first().click();await page.getByRole('dialog').waitFor();await page.getByText('Meaning of curiosity',{exact:false}).waitFor();await close(page);
    await page.locator('.reader-content [role=button]').filter({hasText:/^picked it up/}).first().click();await page.getByRole('dialog').waitFor();
    const senses = page.getByRole('dialog').locator('details').filter({has:page.getByText('Add Chinese meanings and examples',{exact:true})});
    await senses.locator('summary').click();await senses.getByRole('button',{name:'Edit other Chinese meanings',exact:true}).click();
    await senses.getByRole('button',{name:'Add other meaning',exact:true}).click();
    const draft=senses.locator('.dictionary-evidence__input').first();await draft.fill('Preserve this draft');
    await page.evaluate(async()=>{(await import('/src/stores/dictionaryStore.ts')).applyDictionarySnapshot({runId:1,sequence:100,state:'failed',currentSource:null,sources:[{name:'ECDICT',language:'en',state:'failed',processedRows:2000,error:'fixture resource failure'}]});});
    await page.waitForTimeout(100);assert.equal(await draft.inputValue(),'Preserve this draft');checks++;
    await senses.getByRole('button',{name:'Edit other Chinese meanings',exact:true}).click();await close(page);checks++;
    assert.ok((await page.evaluate(()=>window.__calls)).every(c=>!['update_word_status','create_review_card','update_phrase_status'].includes(c.command)),'lookup mutated learning records');checks++;
    await page.goto(`${url}/files/999`);await page.locator('.reader-load-error .ui-button').waitFor();await page.evaluate(()=>{window.__allowInfo999=true;});await page.locator('.reader-load-error .ui-button').click();await page.locator('.reader-content [role=button]').first().waitFor();checks++;
    await context.close();
  }
  for(const language of ['zh','en','ja','de']) {
    const context=await browser.newContext({viewport:{width:320,height:844},hasTouch:true});const page=await context.newPage();await fixture(page,'midnight',language,true);await page.goto(`${url}/words`);await page.locator('.dictionary-init-notice').waitFor();await overflow(page);
    assert.equal(await page.locator('.dictionary-init-notice').evaluate(n=>getComputedStyle(n).position),'static');checks++;
    await page.locator('.dictionary-init-notice button').first().click();await page.locator('.dictionary-init-notice').waitFor({state:'detached'});checks++;
    await page.locator('.vocabulary-tools-trigger').click();await overflow(page);await close(page);
    assert.equal(await page.getByText(/mobileBrowse\.|dictionaryInit\.|lookup\./).count(),0);checks++;
    await page.evaluate(()=>document.documentElement.style.fontSize='24px');await overflow(page);
    await context.close();
  }
  assert.deepEqual(errors,[]);console.log(`PASS: ${checks} Android reading/layout checks; screenshots: ${output}`);
} finally {await browser.close();}
