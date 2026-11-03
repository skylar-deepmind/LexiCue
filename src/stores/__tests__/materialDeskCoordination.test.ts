import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
import { useMaterialStore } from '../materialStore';
import { useReadingDeskStore } from '../readingDeskStore';
import { DESK_KEY, emptyDesk, materialRef } from '../../lib/readingDesk';
import type { Material } from '../../lib/materials';
const files: Material[]=[1,2].map(id=>({id,name:`File ${id}`,content_hash:`hash-${id}`,segment_count:20,preview:'Hello.',imported_at:0,tags:[]}));
beforeEach(()=>{
    invoke.mockReset();
    const values=new Map<string,string>();
    vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
    useMaterialStore.setState({files:[],loading:false,error:false});
    useReadingDeskStore.setState({desk:{...emptyDesk(true),items:files.map(materialRef),selected:materialRef(files[0])},undo:null,catalog:files});
    const raw=JSON.stringify(useReadingDeskStore.getState().desk);
    values.set(DESK_KEY,raw);useReadingDeskStore.getState().acceptExternal(raw);
});
describe('authoritative material reconciliation',()=>{
    it('never prunes desk references from filtered or failed lists',async()=>{
        invoke.mockResolvedValueOnce([]);await useMaterialStore.getState().load([42]);
        expect(useReadingDeskStore.getState().desk.items).toHaveLength(2);
        invoke.mockResolvedValueOnce([]);await useMaterialStore.getState().load([],true);
        expect(useReadingDeskStore.getState().desk.items).toHaveLength(2);
        invoke.mockRejectedValueOnce(Error('IPC'));await useMaterialStore.getState().load();
        expect(useMaterialStore.getState().error).toBe(true);expect(useReadingDeskStore.getState().desk.items).toHaveLength(2);
        invoke.mockResolvedValueOnce([files[1]]);await useMaterialStore.getState().load();
        expect(useReadingDeskStore.getState().desk.items.map(ref=>ref.id)).toEqual([2]);
    });
    it('ignores an older full-list response arriving after a newer list or a failed refresh',async()=>{
        let resolveOld!: (files: Material[])=>void;
        invoke.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
        const old=useMaterialStore.getState().load();
        invoke.mockResolvedValueOnce(files);await useMaterialStore.getState().load();
        resolveOld([]);await old;
        expect(useMaterialStore.getState().files).toEqual(files);expect(useReadingDeskStore.getState().desk.items).toHaveLength(2);
        invoke.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
        const older=useMaterialStore.getState().load();invoke.mockRejectedValueOnce(Error('newer failure'));await useMaterialStore.getState().load();
        resolveOld([]);await older;
        expect(useMaterialStore.getState().error).toBe(true);expect(useReadingDeskStore.getState().desk.items).toHaveLength(2);
    });
});
