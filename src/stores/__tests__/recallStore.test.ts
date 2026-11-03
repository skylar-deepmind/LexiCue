import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
import { useRecallStore } from '../recallStore';
import { mutateSaved, undoSaved } from '../../lib/savedRecords';
const catalog=(expressions:string[],case_exclusions:string[]=[],literal_only=false)=>({expressions,case_exclusions,literal_only});
beforeEach(()=>{vi.clearAllMocks();useRecallStore.setState({expressions:[],caseExclusions:[],literalOnly:true,loaded:false,error:false,loading:false,revision:0});});
describe('saved re-encounter cache ownership',()=>{
  it('keeps the newest index when an earlier request arrives late',async()=>{
    const release:Array<(v:unknown)=>void>=[];mocks.invoke.mockImplementation(()=>new Promise(done=>release.push(done)));
    const old=useRecallStore.getState().refresh(),latest=useRecallStore.getState().refresh();
    release[1](catalog(['take off'],['US']));await latest;release[0](catalog(['took off'],['May']));await old;
    expect(useRecallStore.getState()).toMatchObject({expressions:['take off'],loaded:true,loading:false,error:false});
    expect(useRecallStore.getState().caseExclusions).toEqual(['US']);
    expect(mocks.invoke.mock.calls.every(([command])=>command==='saved_recall_catalog')).toBe(true);
  });
  it('removes stale marks on index failure and permits retry',async()=>{
    useRecallStore.setState({expressions:['removed'],loaded:true});mocks.invoke.mockRejectedValueOnce(Error('busy'));
    await useRecallStore.getState().refresh();expect(useRecallStore.getState()).toMatchObject({expressions:[],loaded:false,error:true});
    mocks.invoke.mockResolvedValueOnce(catalog(['restored']));await useRecallStore.getState().refresh();expect(useRecallStore.getState()).toMatchObject({expressions:['restored'],error:false,loaded:true});
  });
  it('drops old forms immediately on dictionary invalidation and rejects an in-flight older catalog',async()=>{
    let release!:(value:ReturnType<typeof catalog>)=>void;
    mocks.invoke.mockImplementationOnce(()=>new Promise<ReturnType<typeof catalog>>(done=>{release=done;}));
    useRecallStore.setState({expressions:['went'],loaded:true});
    const old=useRecallStore.getState().refresh();
    useRecallStore.getState().invalidate();
    expect(useRecallStore.getState()).toMatchObject({expressions:[],loaded:false,loading:false});
    release(catalog(['went']));await old;
    expect(useRecallStore.getState().expressions).toEqual([]);
    mocks.invoke.mockResolvedValueOnce(catalog(['go']));await useRecallStore.getState().refresh();
    expect(useRecallStore.getState()).toMatchObject({expressions:['go'],loaded:true});
  });
  it('fails closed if the bulk catalog omits source case reservations',async()=>{
    useRecallStore.setState({expressions:['us'],caseExclusions:['US'],loaded:true});
    mocks.invoke.mockResolvedValueOnce({expressions:['us']});await useRecallStore.getState().refresh();
    expect(useRecallStore.getState()).toMatchObject({expressions:[],caseExclusions:[],loaded:false,error:true});
  });
  it('carries missing-package literal mode atomically and refuses a catalog missing the mode',async()=>{
    mocks.invoke.mockResolvedValueOnce(catalog(['may','May'],[],true));await useRecallStore.getState().refresh();
    expect(useRecallStore.getState()).toMatchObject({expressions:['may','May'],literalOnly:true,loaded:true});
    mocks.invoke.mockResolvedValueOnce({expressions:['may'],case_exclusions:[]});await useRecallStore.getState().refresh();
    expect(useRecallStore.getState()).toMatchObject({expressions:[],caseExclusions:[],literalOnly:true,loaded:false,error:true});
  });
  it('invalidates only confirmed mutations and undo, with no lookup or review writes',async()=>{
    const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
    const mutation={kind:'remove' as const,record_id:'record',expected_revision:'revision'};
    mocks.invoke.mockRejectedValueOnce(Error('disk'));await expect(mutateSaved(mutation,'retry')).rejects.toThrow();expect(dispatchEvent).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce({changed:false});await mutateSaved(mutation,'noop');expect(dispatchEvent).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce({changed:true});await mutateSaved(mutation,'remove');expect(dispatchEvent).toHaveBeenCalledTimes(1);
    mocks.invoke.mockResolvedValueOnce({});await undoSaved('remove');expect(dispatchEvent).toHaveBeenCalledTimes(2);vi.unstubAllGlobals();
  });
});
