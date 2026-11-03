/** Real package + real pointer range selection in an isolated native WebView. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import type { SavedRecord } from '../lib/savedRecords';
import type { MaterialImportResult, ReadingMaterial } from '../lib/materials';
import { dictionaryReference, validateDictionaryResult, type DictionaryResult } from '../lib/dictionaryResult';
export async function runPhrasalObjectChecks(){
  await assertSlicePreview();if(import.meta.env.VITE_SLICE_QA!=='1')throw Error('QA only');
  const report={checks:[] as string[],errors:[] as string[],queries:[] as unknown[],themes:[] as unknown[],completed:false};
  const check=(yes:unknown,label:string)=>(yes?report.checks:report.errors).push(label);
  const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const until=async<T,>(fn:()=>T,label:string)=>{const end=performance.now()+15000;while(performance.now()<end){const v=fn();if(v)return v;await wait(20);}throw Error(`Timeout ${label}`);};
  const live=<T extends HTMLElement=HTMLElement>(s:string)=>[...document.querySelectorAll<T>(s)].find(n=>n.getClientRects().length&&!n.closest('[inert],[aria-hidden="true"]'));
  const cases=[
    ['That job wore me out.','wore me out',['wear out']],
    ['This trip has worn us out.','worn us out',['wear out']],
    ['They saw them off.','saw them off',['saw off','see off']],
    ['She looked the new word up.','looked the new word up',['look up']],
    ['I took my warm coat off.','took my warm coat off',['take off']],
    ['He picked himself up.','picked himself up',['pick up']],
    ['We put the failure down to bad luck.','put the failure down to bad luck',['put down to']],
    ['I put up with the noise.','put up with the noise',['put up with']],
    ['Please look it right up.','look it right up',['look up']],
  ] as const;
  const originalTheme=document.documentElement.dataset.theme;
  try{
    for(const [sentence,expression,heads] of cases){
      const start=performance.now();const raw=await invoke<DictionaryResult>('lookup_longman_expression',{expression,context:sentence});
      const value=validateDictionaryResult(raw,expression,'longman');const actual=[...new Set(value.entries.map(e=>e.headword))];
      check(heads.every(h=>actual.includes(h)),`${expression}: real local package contains every expected prototype`);
      check(value.entries.every(e=>e.source.delivery==='local'&&e.source.provider==='longman'),`${expression}: prototype definitions retain local source provenance`);
      if(expression==='saw them off')check(dictionaryReference(value)===null,'ambiguous phrase does not attach an arbitrary saved dictionary reference');
      if(expression==='look it right up'){
        const meanings=value.entries.flatMap(e=>e.groups.flatMap(g=>g.senses.map(s=>s.meaning.zh??'')));
        check(meanings.some(m=>m.includes('查阅'))&&!meanings.some(m=>m.includes('好转')),'explicit object structure excludes unrelated intransitive fallback senses');
      }
      report.queries.push({expression,heads:actual,elapsedMs:performance.now()-start,senses:value.entries.map(e=>({head:e.headword,match:e.match,meanings:e.groups.flatMap(g=>g.senses.map(s=>s.meaning))}))});
    }
    for(const expression of ['look at what is up','look it upon','put me with up','lie it down']){
      const v=await invoke<DictionaryResult>('lookup_longman_expression',{expression,context:expression});check(v.entries.length===0,`${expression}: not an invented separated phrase`);
    }
    const dependent=await invoke<DictionaryResult>('lookup_longman_expression',{expression:'turn on it',context:'The decision will turn on it.'});
    const meanings=dependent.entries.flatMap(e=>e.groups.flatMap(g=>g.senses.map(s=>s.meaning.zh??'')));
    check(meanings.some(m=>m.includes('取决于'))&&!meanings.some(m=>m.includes('打开')||m.includes('启动')),'turn on it keeps the attested prepositional sense, not the separated switch-on sense');
    const imported=await invoke<MaterialImportResult>('import_reading_material',{input:{operation_id:'phrasal-object-qa-v1',name:'Phrasal object matching QA.txt',normalized_kind:'txt',content:cases.map(c=>c[0]).join('\n'),segments:cases.map((c,index)=>({index,en_text:c[0],zh_text:null,start_time:null,end_time:null}))}});
    (await until(()=>live<HTMLAnchorElement>('.b-dock a[href="/files"]'),'files')).click();await wait(600);
    await useMaterialStore.getState().load();const file=useMaterialStore.getState().files.find(f=>f.id===imported.file_id)!;useReadingDeskStore.getState().keep(file);await wait(100);
    (await until(()=>live<HTMLButtonElement>('.desk-primary'),'read fixture')).click();await until(()=>document.querySelector('.reading-word'),'reading');await wait(550);
    const data=await invoke<ReadingMaterial>('open_reading_material',{fileId:imported.file_id});
    const original=data.segments[2],savedExpression='saw them off',savedStart=original.en_text.indexOf(savedExpression);
    const prior=await invoke<SavedRecord|null>('saved_for_selection',{input:{segment_id:original.id,expression:savedExpression,start_offset:savedStart,end_offset:savedStart+savedExpression.length,explanation:null,explanation_source:'unknown'}});
    if(prior){await invoke('mutate_saved_record',{operationId:crypto.randomUUID(),mutation:{kind:'remove',record_id:prior.record_id,expected_revision:prior.revision}});window.dispatchEvent(new Event('lexicue-saved-changed'));}
    for(const theme of ['ocean','midnight']){
      document.documentElement.dataset.theme=theme;
      for(const [index,entry] of cases.entries()){
        const [,expression,heads]=entry;
        const sentence=document.querySelector<HTMLElement>(`[data-sentence="${index}"] .reading-original`)!;
        const words=[...sentence.querySelectorAll<HTMLButtonElement>('.reading-word')];
        const selected=expression.split(' ');const from=words.findIndex((word,i)=>selected.every((s,j)=>words[i+j]?.textContent===s));
        check(from>=0,`${theme}/${expression}: original contiguous range exists`);
        const first=words[from],last=words[from+selected.length-1];first.scrollIntoView({block:'center'});
        // Pointer handlers resolve the real final token through elementFromPoint.
        const a=first.getBoundingClientRect(),b=last.getBoundingClientRect();
        first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',clientX:a.x+a.width/2,clientY:a.y+a.height/2}));
        sentence.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:b.x+b.width/2,clientY:b.y+b.height/2}));
        sentence.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'mouse',clientX:b.x+b.width/2,clientY:b.y+b.height/2}));
        await until(()=>live('.soft-refresh')?.dataset.refreshState==='ready'&&live('.soft-refresh')?.querySelector('.soft-refresh-current h2')?.textContent===expression,`${theme} ${expression}`);
        const actual=[...document.querySelectorAll<HTMLElement>('.soft-refresh-current [data-prototype]')].map(n=>n.dataset.prototype);
        check(heads.every(h=>actual.includes(h)),`${theme}/${expression}: every candidate has a separate visible group`);
        check(live('.lookup-heading h2')?.textContent===expression,`${theme}/${expression}: heading keeps the selected original text`);
        check(!live<HTMLButtonElement>('.lookup-footer .saved-primary')?.disabled,`${theme}/${expression}: saving context remains available`);
        if(theme==='ocean'&&expression==='saw them off'){
          live<HTMLButtonElement>('.lookup-footer .saved-primary')!.click();await until(()=>live('.lookup-saved'),'saved original');
          const segment=data.segments[index],start=segment.en_text.indexOf(expression);
          const record=await invoke<SavedRecord>('saved_for_selection',{input:{segment_id:segment.id,start_offset:start,end_offset:start+expression.length,expression,explanation:null,explanation_source:'unknown'}});
          check(record.expression===expression&&record.normalized_expression===expression&&record.sentence===segment.en_text,'ambiguous save preserves the exact selected phrase and sentence');
          check(!record.dictionary_reference,'ambiguous save does not choose the first dictionary prototype');
          const catalog=await invoke<{expressions:string[]}>('saved_recall_catalog');check(catalog.expressions.includes(expression),'ambiguous saved phrase keeps its literal recall identity');
          live<HTMLButtonElement>('[data-testid="lookup-undo"]')!.click();await until(()=>live('.lookup-footer .saved-primary'),'undo QA save');
        }
        const panel=live('.context-panel')!.getBoundingClientRect();check(panel.top>=0&&panel.bottom<=innerHeight+.5,`${theme}/${expression}: candidate list stays in window`);
      }
      report.themes.push({theme,candidates:[...document.querySelectorAll('.soft-refresh-current [data-prototype]')].map(n=>n.getAttribute('data-prototype'))});
    }
  }catch(error){report.errors.push(String(error));}
  finally{document.documentElement.dataset.theme=originalTheme??'ocean';report.completed=true;await writeTextFile('mac-release-phrasal-object.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});const status=document.createElement('p');status.textContent=`词组验收：${report.checks.length} 通过，${report.errors.length} 问题`;status.style.cssText='position:fixed;right:20px;top:40px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)';document.body.append(status);}
  return report;
}
