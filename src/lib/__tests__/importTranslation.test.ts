import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),unlisten:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:mocks.listen}));
import { translateImportSegments } from '../importTranslation';
const rows = [{index:0,en_text:'First.',zh_text:'已有翻译。',start_time:null,end_time:null},{index:1,en_text:'Second.',zh_text:null,start_time:null,end_time:null}];
beforeEach(()=>{vi.clearAllMocks();mocks.listen.mockResolvedValue(mocks.unlisten);});
it('only sends missing translations and applies indexed output without replacing existing Chinese',async()=>{
  mocks.invoke.mockResolvedValue({translations:[{index:1,translation:'第二句。'},{index:0,translation:'不能覆盖。'}],error:null});
  const result = await translateImportSegments(rows,new AbortController().signal,vi.fn());
  expect(mocks.invoke).toHaveBeenCalledWith('translate_import_sentences',{jobId:expect.any(Number),sentences:[{index:1,text:'Second.'}]});
  expect(result).toEqual({segments:[rows[0],{...rows[1],zh_text:'第二句。'}],failed:false});expect(mocks.unlisten).toHaveBeenCalledOnce();
});
it('retains completed results and detects omissions even if the service claims success',async()=>{
  mocks.invoke.mockResolvedValue({translations:[],error:null});
  expect(await translateImportSegments(rows,new AbortController().signal,vi.fn())).toEqual({segments:rows,failed:true});
});
it('does not contact the service for an already bilingual material',async()=>{
  await translateImportSegments([rows[0]],new AbortController().signal,vi.fn());expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.listen).not.toHaveBeenCalled();
});
it('sends cancellation and discards late results',async()=>{
  let resolve!: (value:unknown)=>void;
  mocks.invoke.mockImplementation(command=>command==='translate_import_sentences'?new Promise(done=>resolve=done):Promise.resolve());
  const controller = new AbortController();const pending=translateImportSegments(rows,controller.signal,vi.fn());
  await vi.waitFor(()=>expect(resolve).toBeDefined());controller.abort();
  const rejection=expect(pending).rejects.toThrow('material_cancelled');
  resolve({translations:[{index:1,translation:'late'}],error:null});await rejection;
  expect(mocks.invoke).toHaveBeenCalledWith('cancel_import_translation',{jobId:expect.any(Number)});expect(mocks.unlisten).toHaveBeenCalledOnce();
});
