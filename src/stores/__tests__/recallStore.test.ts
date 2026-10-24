import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
import { useRecallStore } from '../recallStore';
import { mutateSaved, undoSaved } from '../../lib/savedRecords';
beforeEach(()=>{vi.clearAllMocks();useRecallStore.setState({expressions:[],loaded:false,error:false,loading:false,revision:0});});
describe('saved re-encounter cache ownership',()=>{
  it('keeps the newest index when an earlier request arrives late',async()=>{
    const release:Array<(v:unknown)=>void>=[];mocks.invoke.mockImplementation(()=>new Promise(done=>release.push(done)));
    const old=useRecallStore.getState().refresh(),latest=useRecallStore.getState().refresh();
    release[1](['take off']);await latest;release[0](['took off']);await old;
    expect(useRecallStore.getState()).toMatchObject({expressions:['take off'],loaded:true,loading:false,error:false});
  });
  it('removes stale marks on index failure and permits retry',async()=>{
    useRecallStore.setState({expressions:['removed'],loaded:true});mocks.invoke.mockRejectedValueOnce(Error('busy'));
    await useRecallStore.getState().refresh();expect(useRecallStore.getState()).toMatchObject({expressions:[],loaded:false,error:true});
    mocks.invoke.mockResolvedValueOnce(['restored']);await useRecallStore.getState().refresh();expect(useRecallStore.getState()).toMatchObject({expressions:['restored'],error:false,loaded:true});
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
