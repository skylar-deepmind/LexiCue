/** Isolated UI → real Rust pack query/install/remove/save boundaries. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createReadingHarness,root} from './ui-reading-support.mjs';
const output=process.env.LEXICUE_DICTIONARY_UI_OUTPUT||`${root}/docs/implementation/evidence/dictionary-packs`;
await mkdir(output,{recursive:true});
const h=await createReadingHarness(output);const checks=[];
const ok=(value,label)=>{assert.ok(value,label);checks.push(label);};
const contrast=locator=>locator.evaluate(node=>{const rgb=s=>s.match(/[\d.]+/g).map(Number);const lum=v=>v.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);let target=node,bg;do{bg=rgb(getComputedStyle(target).backgroundColor);target=target.parentElement;}while(target&&(bg[3]??1)===0);const a=lum(rgb(getComputedStyle(node).color)),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
const archives=process.env.LEXICUE_DICTIONARY_TEST_ARCHIVES;
const status=await h.call('dictionary_pack_status');
const spec=status.packs.find(p=>p.id==='specialist');
try {
 for(const theme of ['ocean','midnight'])for(const phone of [false,true]){
  const label=`${theme}-${phone?'phone':'desktop'}`;
  await h.call('test_reset');
  const page=await h.browser.newPage({viewport:phone?{width:375,height:812}:{width:1140,height:760},reducedMotion:'reduce',...(phone?{isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile'}:{})});
  await h.fixture(page,theme);
  await page.addInitScript(()=>{
   const original=window.__TAURI_INTERNALS__.invoke;
   window.__TAURI_INTERNALS__.invoke=async(command,args)=>{
    if(command==='plugin:dialog|open'){window.__packDialogOptions=args.options;return window.__packFile??null;}
    if(command==='dictionary_pack_status'&&window.__packState)return window.__packState;
    if(command==='cancel_dictionary_pack'){window.__packState.operation=null;window.__packState.busy=false;return;}
    if(['lookup_cambridge_expression','lookup_free_dictionary_expression'].includes(command)){
     window.__uiCalls.push({command,args});return {schema_version:1,query:{text:args.expression,language:'en',context:args.context},status:'not_found',default_entry_id:null,entries:[],notices:[]};
    }
    return original(command,args);
   };
  });
  await page.goto(`${h.url}/settings?section=dictionary`);await page.locator('[data-pack=daily][data-installed=true]').waitFor();
  ok(await page.locator('[data-pack]').count()===3,`${label}: exactly three packs`);
  ok(await page.locator('[data-pack=daily] button').count()===0,`${label}: bundled base cannot be removed`);
  ok((await page.locator('[data-pack=daily]').innerText()).includes('60.69'),`${label}: data size shown`);
  await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!document.querySelector('[data-pack=specialist] button')?.disabled);
  ok(await page.locator('[data-pack=specialist]').getAttribute('data-installed')==='false',`${label}: cancelling picker changes no pack`);
  ok(await page.evaluate(()=>window.__packDialogOptions?.fileAccessMode==='scoped'),`${label}: picker reads in place instead of retaining an Inbox archive copy`);
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: no horizontal overflow`);
  await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).hover();
  ok(await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).evaluate(n=>n.getBoundingClientRect().height>=44),`${label}: touch target`);
  await page.screenshot({path:join(output,`${label}-packs.png`),fullPage:true});
  for(const selector of ['.dictionary-pack-heading h2','.dictionary-pack-size','.dictionary-pack-actions button']){const ratio=await contrast(page.locator(selector).first());ok(ratio>=4.5,`${label}: ${selector} contrast ${ratio.toFixed(2)}`);}
  await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: 200 percent text fits width`);
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  if(phone){await page.setViewportSize({width:812,height:375});ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: landscape fits width`);await page.setViewportSize({width:375,height:812});}

  // Controlled native IPC state validates the progress/cancel UI; transport
  // cancellation and digest checks are covered by actual Rust loopback tests.
  await page.evaluate(status=>{window.__packState={...status,busy:true,operation:{id:'specialist',phase:'downloading',completed:1000000,total:55155825}};document.dispatchEvent(new Event('visibilitychange'));},status);
  await page.locator('[data-pack=specialist] progress').waitFor();
  ok(await page.locator('[data-pack=extended] button').first().isDisabled(),`${label}: concurrent operations disabled`);
  await page.screenshot({path:join(output,`${label}-progress.png`),fullPage:true});
  await page.locator('[data-pack=specialist]').getByRole('button',{name:'取消',exact:true}).click();
  await page.locator('[data-pack=specialist] progress').waitFor({state:'detached'});
  await page.evaluate(()=>{window.__packState=null;document.dispatchEvent(new Event('visibilitychange'));});
  if(archives){
   await page.evaluate(path=>window.__packFile=path,join(archives,spec.filename));
   await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).click();
   await page.locator('[data-pack=specialist][data-installed=true]').waitFor({timeout:60000});
   ok((await h.call('lookup_local_expression',{expression:'ichthyology'})).status==='found',`${label}: actual optional data becomes queryable`);
   await page.locator('[data-pack=specialist]').getByRole('button',{name:'移除词典包',exact:true}).click();
   await page.locator('[data-pack=specialist][data-installed=false]').waitFor();
   ok((await h.call('lookup_local_expression',{expression:'ichthyology'})).status==='not_found',`${label}: removing pack removes live coverage`);
   await page.evaluate(()=>window.__packFile='/no/such/package.zip');
   await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).click();
   await page.locator('[data-pack=specialist] [role=alert]').waitFor();
   await page.screenshot({path:join(output,`${label}-error.png`),fullPage:true});
   ok(await page.locator('[data-pack=specialist]').getByRole('button',{name:'从文件安装',exact:true}).isEnabled(),`${label}: failed installation can be retried`);
  }
  const sentence='The soliloquy describes pneumonia.';
  const imported=await h.call('import_reading_material',{input:{operation_id:`pack-ui-${label}`,name:`${label}.txt`,content:sentence,segments:[{index:0,en_text:sentence,zh_text:null,start_time:null,end_time:null}]}});
  await page.goto(`${h.url}/files/${imported.file_id}`);
  await page.locator('.reading-word').filter({hasText:/^soliloquy$/}).click();await page.locator('.dictionary-overview').waitFor();
  ok((await page.locator('.dictionary-source').first().innerText()).includes('本地'),`${label}: local source slot is distinct from online Wiktionary`);
  await page.locator('[data-testid=lookup-save]').click();await page.locator('.lookup-saved').waitFor();
  const saved=await h.call('list_saved_records',{query:'soliloquy',limit:100,offset:0});
  ok(saved.some(r=>r.dictionary_reference?.senses[0].source.adapter_version==='wiktionary-local-v2.0.0'),`${label}: real local revision reference saved`);
  ok(await page.evaluate(()=>window.__uiCalls.some(c=>c.command==='lookup_cambridge_expression')&&!window.__uiCalls.some(c=>c.command==='lookup_free_dictionary_expression')),`${label}: online sequence retains existing English-content fallback policy`);
  await page.screenshot({path:join(output,`${label}-lookup.png`)});
  await page.close();
 }
 ok(!h.errors.length,`no page errors: ${h.errors.join('; ')}`);
 await writeFile(join(output,'report.json'),JSON.stringify({passed:true,checks,realOptionalArchives:!!archives,nativePicker:'controlled boundary; not physical device acceptance'},null,2));
 console.log(`Dictionary packs UI: ${checks.length} checks passed`);
} finally {await h.dispose();}
