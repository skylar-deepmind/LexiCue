import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
import { LIBRARY_SCOPE, mutateInScope, selectionInScope, undoInScope } from '../readingScope';
const input={segment_id:1,expression:'example',start_offset:0,end_offset:7,explanation:null,explanation_source:'unknown' as const};
const dispatchEvent=vi.fn();
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('window',{dispatchEvent});mocks.invoke.mockResolvedValue({changed:true});});
it('routes all example read/write/undo commands to its session, without invalidating the real library',async()=>{
  const scope={kind:'example' as const,sessionId:'isolated'};
  await selectionInScope(scope,input);await mutateInScope(scope,{kind:'save',input},'save');await undoInScope(scope,'save');
  expect(mocks.invoke.mock.calls).toEqual([['example_saved_for_selection',{sessionId:'isolated',input}],['mutate_example_saved_record',{sessionId:'isolated',mutation:{kind:'save',input},operationId:'save'}],['undo_example_saved_mutation',{sessionId:'isolated',operationId:'save'}]]);expect(dispatchEvent).not.toHaveBeenCalled();
});
it('keeps real library saves and undo on the production path, including cache invalidation',async()=>{
  await selectionInScope(LIBRARY_SCOPE,input);await mutateInScope(LIBRARY_SCOPE,{kind:'save',input},'save');await undoInScope(LIBRARY_SCOPE,'save');expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['saved_for_selection','mutate_saved_record','undo_saved_mutation']);expect(dispatchEvent).toHaveBeenCalledTimes(2);
});
