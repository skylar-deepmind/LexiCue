/** QA-only additional A–I boundaries. All writes target this run's isolated fixtures. */
import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useFileStore } from '../stores/fileStore';
import { useMaterialStore } from '../stores/materialStore';
import { useImportStore } from '../stores/importStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import type { Material, MaterialImportResult, ReadingMaterial } from '../lib/materials';
import type { SavedMutationResult } from '../lib/savedRecords';
export async function runMacReleaseFlowGaps() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1' || import.meta.env.VITE_SLICE_MAC_RELEASE !== '1') throw Error('Explicit macOS QA required');
  const report = {method:'Actual native IPC and production DOM events; controlled text enters via import store; OS clipboard verified separately; disposable fixtures retained until QA baseline restore',checks:[] as string[],errors:[] as string[],completed:false};
  const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
  const check=(ok:unknown,label:string)=>{if(!ok)throw Error(label);report.checks.push(label);};
  const until=async<T,>(read:()=>T|Promise<T>,label:string)=>{const end=Date.now()+15000;while(Date.now()<end){const v=await read();if(v)return v;await delay(40);}throw Error(`Timeout: ${label}`);};
  const live=<T extends HTMLElement=HTMLElement>(selector:string)=>[...document.querySelectorAll<T>(selector)].find(n=>!n.closest('[inert],[aria-hidden="true"]')&&n.getClientRects().length);
  const settle=async()=>{await until(()=>!document.querySelector('[data-lookup-moving],[data-page-moving]')&&!document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity),'motion settles');await delay(50);};
  const click=async(s:string)=>{const n=await until(()=>live<HTMLButtonElement>(s),s);check(!n.disabled,`${s} enabled`);n.click();await delay(50);};
  const fill=async(s:string,value:string)=>{const n=await until(()=>live<HTMLInputElement|HTMLTextAreaElement>(s),s);Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));await delay(80);};
  const close=async()=>{document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await settle();};
  const nav=async(path:string)=>{await click(`.b-dock a[href="${path}"]`);await until(()=>location.pathname===path,'route');await settle();};
  const files=()=>invoke<Material[]>('list_materials',{tagIds:[],untagged:false});
  const oldTheme=document.documentElement.dataset.theme;
  try {
    for(const theme of ['ocean','midnight']) {
      document.documentElement.dataset.theme=theme;
      const nonce=crypto.randomUUID(), title=`macOS QA gaps ${theme} ${nonce}`;
      const sentence=`A compass keeps the original context available after its source has gone. Reference ${nonce}.`;
      const made=await invoke<MaterialImportResult>('import_reading_material',{input:{operation_id:`gaps-${nonce}`,name:title+'.txt',normalized_kind:'txt',content:sentence,segments:[{index:0,en_text:sentence,zh_text:null,start_time:null,end_time:null}]}});
      const tagName=`QA-${nonce.slice(0,8)}`;
      const tag=await invoke<number>('create_tag',{name:tagName});
      await invoke('set_file_tags',{fileId:made.file_id,tagIds:[tag],newTagNames:[]});
      await useFileStore.getState().loadTags(true);useMaterialStore.getState().changed();
      await nav('/files');await click('.desk-library-dock');await settle();
      await click('.library-ranges button:first-child');await fill('.library-search input',nonce);
      if(live('.library-tag-toggle')?.getAttribute('aria-expanded')!=='true')await click('.library-tag-toggle');
      const chip=await until(()=>[...document.querySelectorAll<HTMLButtonElement>('.tag-chip')].find(n=>n.textContent===tagName),'new tag chip');chip.click();await settle();
      await until(()=>live('.library-row')?.getAttribute('data-material')===String(made.file_id),'combined title and tag');
      check(document.querySelectorAll('.library-row:not([inert])').length===1,`${theme}: title and tag filters compose`);
      await click(`.library-row[data-material="${made.file_id}"] .library-preview-toggle`);await settle();
      check(live('.library-preview[data-open="true"]')?.textContent?.includes(sentence),`${theme}: expanded library preview has actual content`);
      await click(`.library-row[data-material="${made.file_id}"] .library-preview-toggle`);await settle();
      const hidden=document.querySelector<HTMLElement>('.library-preview');
      check(hidden?.inert&&hidden.getAttribute('aria-hidden')==='true',`${theme}: collapsed preview remains inaccessible`);
      await fill('.library-search input',`no-result-${nonce}`);await settle();
      check(!live('.library-row'),`${theme}: combined filter exposes empty result`);
      await fill('.library-search input','');await click('.tag-chip:first-child');await settle();
      check(!!live('.library-row'),`${theme}: clearing filters restores library`);await close();
      const countBefore=(await files()).length;
      // Archive is reversible organization, not material deletion.
      for(let i=0;i<5&&useReadingDeskStore.getState().desk.items.length;i++){
        await click('.desk-card-menu > button');await click('.desk-archive');await settle();
      }
      check(!!live('.desk-empty')&&useReadingDeskStore.getState().desk.items.length===0,`${theme}: explicitly empty desk is available`);
      check((await files()).length===countBefore,`${theme}: shelving never deletes materials`);
      await click('.notification-host .toast-action');await settle();
      check(useReadingDeskStore.getState().desk.items.length===1&&!live('.desk-empty'),`${theme}: last shelving undo restores its actual material`);
      await click('.dock-import-slot button');
      check(!live('.lc-import-footer .lc-import-primary')&&!!live('.lc-import-source--clipboard'),`${theme}: compact entry has clipboard action but no confirmation/write action`);
      const preparation=useImportStore.getState().fromContent('clipboard',Array.from({length:3000},()=>sentence).join('\n'));
      await close();await preparation;await delay(1500);
      check(!live('.lc-import-modal')&&(await files()).length===countBefore,`${theme}: close during parsing never revives preview or commits`);
      // Build one genuine saved context then remove only this run's source.
      const data=await invoke<ReadingMaterial>('open_reading_material',{fileId:made.file_id});
      const note=`QA note ${nonce}`;
      const saved=await invoke<SavedMutationResult>('mutate_saved_record',{operationId:`gaps-save-${nonce}`,mutation:{kind:'save',input:{segment_id:data.segments[0].id,expression:'compass',start_offset:2,end_offset:9,explanation:note,explanation_source:'personal'}}});
      let job=await invoke<{job_id:string;phase:string}>('delete_file_start',{fileId:made.file_id});
      await until(async()=>{if(job.phase==='failed')throw Error('fixture source deletion failed');if(job.phase==='done')return true;job=await invoke('delete_file_status',{jobId:job.job_id});return job.phase==='done';},'fixture source removal');
      window.dispatchEvent(new Event('lexicue-saved-changed'));useMaterialStore.getState().changed();
      await nav('/saved');await fill('.saved-search input',note);await until(()=>live('.saved-record-open'),'saved fixture search');await click('.saved-record-open');await settle();
      const row=`[data-record="${saved.record.record_id}"]`;
      await until(()=>live(row),'missing source original');
      const source=live<HTMLButtonElement>(`${row} .saved-record-actions button:first-child`)!;
      if(!source.disabled){source.click();await until(()=>source.disabled,'missing source disabled');}
      check(live(row)?.textContent?.includes(sentence)&&live(row)?.textContent?.includes(note),`${theme}: lost source preserves original sentence and personal note`);
      check(source.disabled&&!!live(`${row} [role="status"]`),`${theme}: lost source reports unavailable without leaving saved list`);
      await nav('/files');
    }
  } catch(error){report.errors.push(String(error));}
  finally {document.documentElement.dataset.theme=oldTheme??'ocean';report.completed=true;await writeTextFile('mac-release-flow-gaps.json',JSON.stringify(report,null,2),{baseDir:BaseDirectory.AppData});}
  return report;
}
