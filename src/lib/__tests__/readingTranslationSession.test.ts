import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../readingTranslation', () => ({ translateReadingBatch: vi.fn() }));
import { translateReadingBatch } from '../readingTranslation';
import { createReadingTranslationSession } from '../readingTranslationSession';
import type { Segment } from '../types';
const rows: Segment[] = Array.from({length:20},(_,index)=>({id:index+10,index_num:index,en_text:`Sentence ${index}.`,zh_text:index===0?'原有译文':null,start_time:null,end_time:null}));
const createSession=(allowGenerate=true)=>createReadingTranslationSession({materialId:7,contentHash:'hash',segments:rows,allowGenerate});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
beforeEach(()=>vi.resetAllMocks());
describe('full reading translation consent and ownership',()=>{
 it('asks before translating missing content and cancel never contacts the service',async()=>{
   const session=createSession();session.toggle();
   expect(session.getSnapshot()).toMatchObject({confirming:true,enabled:false,missingCount:19});
   await session.request();session.dismissConfirmation();
   expect(translateReadingBatch).not.toHaveBeenCalled();expect(session.getSnapshot().confirming).toBe(false);
 });
 it('shows existing bilingual/example content without confirmation or generation',()=>{
   const session=createSession(false);session.toggle();
   expect(session.getSnapshot()).toMatchObject({enabled:true,confirming:false});expect(translateReadingBatch).not.toHaveBeenCalled();
   const bilingual=createReadingTranslationSession({materialId:8,contentHash:'bilingual',segments:rows.map(row=>({...row,zh_text:'已有中文'})),allowGenerate:true});bilingual.toggle();
   expect(bilingual.getSnapshot()).toMatchObject({enabled:true,confirming:false,missingCount:0});
 });
 it('confirmation translates all missing sentences, deduplicates clicks and retries only remaining results',async()=>{
   vi.mocked(translateReadingBatch).mockResolvedValueOnce({translations:[{id:11,zh_text:'第一句'}],failed:true})
     .mockResolvedValueOnce({translations:rows.slice(2).map(row=>({id:row.id,zh_text:'完成'})),failed:false});
   const session=createSession();session.toggle();session.confirm();session.confirm();await settle();
   expect(vi.mocked(translateReadingBatch).mock.calls[0][2].map(row=>row.id)).toEqual(rows.slice(1).map(row=>row.id));
   expect(session.getSnapshot()).toMatchObject({status:'partial',missingCount:18});await session.request();
   expect(vi.mocked(translateReadingBatch).mock.calls[1][2].map(row=>row.id)).toEqual(rows.slice(2).map(row=>row.id));
   expect(session.getSnapshot()).toMatchObject({status:'ready',missingCount:0});session.toggle();session.toggle();
   expect(session.getSnapshot().confirming).toBe(false);expect(translateReadingBatch).toHaveBeenCalledTimes(2);
 });
 it('publishes completed batches while hidden and retains them if a later write fails',async()=>{
   vi.mocked(translateReadingBatch).mockImplementation(async(_id,_hash,_rows,_signal,progress)=>{
     progress?.([{id:11,zh_text:'已保存'}],{done:1,total:19});throw Error('later write failed');
   });
   const session=createSession();session.toggle();session.confirm();session.toggle();await settle();
   expect(session.getSnapshot()).toMatchObject({enabled:false,status:'partial',generated:{11:'已保存'},missingCount:18});
 });
 it('rejects stale results and progress after leaving, even when another request has started',async()=>{
   const resolvers:Array<(result:{translations:{id:number;zh_text:string}[];failed:boolean})=>void>=[];
   vi.mocked(translateReadingBatch).mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
   const session=createSession();session.toggle();session.confirm();const first=vi.mocked(translateReadingBatch).mock.calls[0];
   session.close();session.toggle();session.confirm();resolvers[0]({translations:[{id:11,zh_text:'迟到'}],failed:false});
   first[4]?.([{id:11,zh_text:'迟到进度'}],{done:1,total:19});await settle();
   expect(first[3].aborted).toBe(true);expect(session.getSnapshot()).toMatchObject({status:'loading',generated:{}});
   resolvers[1]({translations:rows.slice(1).map(row=>({id:row.id,zh_text:'当前'})),failed:false});await settle();
   expect(session.getSnapshot()).toMatchObject({status:'ready',missingCount:0});
 });
 it('does not accept a response belonging to another material',async()=>{
   vi.mocked(translateReadingBatch).mockResolvedValue({translations:[{id:9999,zh_text:'错误材料'}],failed:false});
   const session=createSession();session.toggle();session.confirm();await settle();
   expect(session.getSnapshot()).toMatchObject({status:'error',generated:{},missingCount:19});
 });
});

it('opens received material without translating and displays its existing Chinese text on demand', async () => {
  const received = rows.slice(0, 2).map(row => ({ ...row, zh_text: row.id === 11 ? '手机上的改译' : row.zh_text }));
  const session = createReadingTranslationSession({ materialId: 8, contentHash: 'received', segments: received, allowGenerate: true });
  await settle();
  expect(translateReadingBatch).not.toHaveBeenCalled();
  session.toggle();
  await session.request();
  await settle();
  expect(session.getSnapshot().status).toBe('ready');
  expect(translateReadingBatch).not.toHaveBeenCalled();
});
