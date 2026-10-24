import { describe,expect,it,vi } from 'vitest';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
vi.mock('../youtubeStore',()=>({useYoutubeStore:{getState:()=>({})}}));
vi.mock('../preferencesStore',()=>({usePreferencesStore:{getState:()=>({})}}));
vi.mock('../materialStore',()=>({useMaterialStore:{getState:()=>({changed:vi.fn()})}}));
import { runImportQueue,type ImportItem,type ImportIO } from '../importStore';
const item=(id:string):ImportItem=>({id,name:id+'.srt',stage:'queued',read:async()=>id});
const segments=[{index:0,en_text:'We fly.',zh_text:null,start_time:'00:00:01.000',end_time:'00:00:02.000'}];
describe('real per-file import stages and receipts',()=>{
 it('preserves successes while reporting a later parse failure and a duplicate',async()=>{
  const items=['good','bad','duplicate'].map(item);const stages:string[]=[];const io:ImportIO={parse:async text=>{if(text==='bad')throw Error('material_invalid_srt');return segments;},write:vi.fn(async input=>({file_id:1,outcome:input.operation_id==='duplicate'?'duplicate' as const:'created' as const,readable:true}))};
  await runImportQueue(items,new AbortController().signal,(id,patch)=>{Object.assign(items.find(i=>i.id===id)!,patch);stages.push(patch.stage!);},io);
  expect(items.map(i=>i.stage)).toEqual(['created','failed','duplicate']);expect(io.write).toHaveBeenCalledTimes(2);expect(stages.slice(0,4)).toEqual(['reading','parsing','writing','created']);
 });
 it('cancels queued files but awaits the in-flight transaction receipt',async()=>{
  const controller=new AbortController();const items=['one','two'].map(item);let release!:(value:unknown)=>void;
  const work=runImportQueue(items,controller.signal,(id,patch)=>Object.assign(items.find(i=>i.id===id)!,patch),{parse:async()=>segments,write:()=>new Promise(done=>{release=done as typeof release;})});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));controller.abort();release({file_id:1,outcome:'created',readable:true});await work;
  expect(items.map(i=>i.stage)).toEqual(['created','cancelled']);
 });
 it('does not claim cancellation when a write receipt is unknown, and retries with the same operation id',async()=>{
  const controller=new AbortController();const row=item('stable');const writes:string[]=[];
  await runImportQueue([row],controller.signal,(_,patch)=>Object.assign(row,patch),{parse:async()=>segments,write:async input=>{writes.push(input.operation_id);controller.abort();throw Error('connection lost');}});
  expect(row.stage).toBe('failed');
  await runImportQueue([row],new AbortController().signal,(_,patch)=>Object.assign(row,patch),{parse:async()=>segments,write:async input=>{writes.push(input.operation_id);return {file_id:1,outcome:'created',readable:true};}});
  expect(writes).toEqual(['stable','stable']);expect(row.stage).toBe('created');
 });
});
