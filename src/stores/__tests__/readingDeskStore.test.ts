import { describe, expect, it } from 'vitest';
import { createReadingDeskStore } from '../readingDeskStore';
import { DESK_INITIALIZED_KEY, DESK_KEY, DESK_V1_BACKUP_KEY, LEGACY_DESK_KEY, emptyDesk, materialRef } from '../../lib/readingDesk';
import type { Material } from '../../lib/materials';
const files: Material[]=[1,2,3,4,5,6].map(id=>({id,name:`File ${id}`,content_hash:`hash-${id}`,segment_count:50,preview:'Hello.',imported_at:0,tags:[]}));
function setup(saved?:string) {
    const values=new Map<string,string>(saved ? [[DESK_KEY,saved]] : []);
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    const store=createReadingDeskStore(()=>storage);
    return {store,values,storage,get:()=>store.getState(),ids:()=>store.getState().desk.items.map(ref=>ref.id)};
}
describe('desk persistence, undo and coordination', () => {
    it('ordinary opens and catalog refreshes leave membership, order and saved empty desks unchanged', () => {
        const s=setup();s.get().reconcile(files);
        for (const file of files.slice(0,3))s.get().keep(file);
        const before=JSON.stringify(s.get().desk);
        s.get().reconcile(files);expect(JSON.stringify(s.get().desk)).toBe(before);
        for (const file of files)s.get().archive(file);
        const restarted=createReadingDeskStore(()=>s.storage);restarted.getState().reconcile(files);
        expect(restarted.getState().desk.items).toEqual([]);expect(restarted.getState().desk.initialized).toBe(true);
    });
    it('keeps and evicts with persistent undo, restoring exact members and order without reader state', () => {
        const s=setup();s.get().reconcile(files);files.slice(0,5).forEach(file=>s.get().keep(file));
        const before=s.get().desk;s.get().keep(files[5]);
        expect(s.ids()).toEqual([6,5,4,3,2]);expect(s.get().notice).toEqual({kind:'replaced',name:'File 1'});
        s.get().reconcile([...files]);expect(s.get().undo).not.toBeNull();
        s.get().undoChange();expect(s.get().desk).toEqual(before);expect(s.get().undo).toBeNull();
        expect(JSON.parse(s.values.get(DESK_KEY)!)).toEqual(before);
        s.get().archive(files[2]);s.get().undoChange();expect(s.get().desk).toEqual(before);
    });
    it('persists independent selection and open recency without changing display order or inserting library items', () => {
        const s=setup();s.get().reconcile(files);files.slice(0,3).forEach(file=>s.get().keep(file));
        const revision=s.get().revision;s.get().keep(files[0]);expect(s.get().revision).toBe(revision);expect(s.ids()).toEqual([3,2,1]);
        s.get().select(files[0]);expect(s.ids()).toEqual([3,2,1]);expect(s.get().desk.selected?.id).toBe(1);expect(s.get().desk.opened).toEqual([]);
        s.get().use(files[0]);expect(s.ids()).toEqual([3,2,1]);expect(s.get().desk.opened.map(ref=>ref.id)).toEqual([1]);expect(s.get().undo).toBeNull();
        const openedRevision=s.get().revision;s.get().use(files[0]);expect(s.get().revision).toBe(openedRevision);
        s.get().use(files[3]);s.get().select(files[3]);expect(s.ids()).toEqual([3,2,1]);expect(s.get().revision).toBe(openedRevision);
        const restarted=createReadingDeskStore(()=>s.storage);expect(restarted.getState().desk).toEqual(s.get().desk);
    });
    it('places a successfully imported sixth material and marks it opened in one undoable intent', () => {
        const s=setup();s.get().reconcile(files);
        files.slice(0,5).forEach(file=>{s.get().keep(file);s.get().use(file);});
        const before=s.get().desk, revision=s.get().revision;
        s.get().keepAndOpen(files[5]);
        expect(s.ids()).toEqual([6,5,4,3,2]);expect(s.get().desk.selected?.id).toBe(6);
        expect(s.get().desk.opened.map(ref=>ref.id)).toEqual([6,5,4,3,2]);
        expect(s.get().revision).toBe(revision+1);expect(s.get().notice).toEqual({kind:'replaced',name:'File 1'});
        const undo=s.get().undo;
        s.get().use(files[5]);expect(s.get().undo).toBe(undo);expect(s.get().revision).toBe(revision+1);
        s.get().undoChange();expect(s.get().desk).toEqual(before);expect(JSON.parse(s.values.get(DESK_KEY)!)).toEqual(before);
        // A cancelled/failed import or unavailable row cannot insert anything.
        s.get().keepAndOpen({...files[5],content_hash:'stale'});expect(s.get().desk).toEqual(before);
    });
    it('cannot resurrect deleted, replaced, externally changed, or more recently rearranged materials', () => {
        const s=setup();s.get().reconcile(files);files.slice(0,5).forEach(file=>s.get().keep(file));s.get().keep(files[5]);
        s.get().reconcile(files.filter(file=>file.id!==1));s.get().undoChange();expect(s.ids()).toEqual([6,5,4,3,2]);expect(s.get().notice?.kind).toBe('undoUnavailable');
        s.get().archive(files[1]);
        const external=JSON.stringify({...emptyDesk(true),items:[materialRef(files[0])],selected:materialRef(files[0])});
        s.values.set(DESK_KEY,external);s.get().acceptExternal(external);
        s.get().undoChange();expect(s.ids()).toEqual([]); // External id is absent from current authoritative catalog.
        s.get().reconcile(files);s.get().keep(files[0]);s.get().reconcile([{...files[0],content_hash:'replacement'},...files.slice(1)]);
        expect(s.ids()).toEqual([]);s.get().undoChange();expect(s.ids()).toEqual([]);
    });
    it('captures last reading before a reader can update it and does not seed from failed or filtered results', () => {
        const s=setup();s.values.set('lexicue-last-reading',JSON.stringify({id:2,hash:'hash-2'}));
        const store=createReadingDeskStore(()=>s.storage);
        s.values.set('lexicue-last-reading',JSON.stringify({id:4,hash:'hash-4'}));
        expect(store.getState().desk.initialized).toBe(false);
        store.getState().reconcile(files);expect(store.getState().desk.items.map(ref=>ref.id)).toEqual([2]);
    });
    it('survives unavailable reads and failed writes without touching materials or blocking actions', () => {
        const store=createReadingDeskStore(()=>({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}}));
        expect(store.getState().persistenceFailed).toBe(true);store.getState().reconcile(files);store.getState().keep(files[0]);
        expect(store.getState().desk.items.map(ref=>ref.id)).toEqual([1]);expect(store.getState().persistenceFailed).toBe(true);
        store.getState().undoChange();expect(store.getState().desk.items).toEqual([]);expect(files[0].segment_count).toBe(50);
    });
    it('backs up v1 before migration, retains its exact raw value, and uses v2 on restart', () => {
        const s=setup();const refs=files.slice(0,3).map(materialRef);
        const legacy=JSON.stringify({version:1,initialized:true,items:refs,selected:refs[1]},null,2);
        s.values.set(LEGACY_DESK_KEY,legacy);
        const migrated=createReadingDeskStore(()=>s.storage);
        expect(s.values.get(LEGACY_DESK_KEY)).toBe(legacy);expect(s.values.get(DESK_V1_BACKUP_KEY)).toBe(legacy);
        expect(migrated.getState().desk).toMatchObject({version:2,items:refs,selected:refs[1],opened:refs});
        expect(migrated.getState().persistenceFailed).toBe(false);
        migrated.getState().reconcile(files);migrated.getState().keep(files[3]);migrated.getState().keep(files[4]);
        expect(createReadingDeskStore(()=>s.storage).getState().desk.items).toHaveLength(5);
        expect(s.values.get(DESK_V1_BACKUP_KEY)).toBe(legacy);
        expect(s.values.get(DESK_INITIALIZED_KEY)).toBe('1');
        s.values.delete(DESK_KEY);
        const removed=createReadingDeskStore(()=>s.storage);removed.getState().reconcile(files);
        expect(removed.getState().desk).toEqual(emptyDesk(true));
    });
    it('does not write v2 when the migration backup fails and retries without overwriting the original backup', () => {
        const s=setup();const refs=files.slice(0,3).map(materialRef);
        const legacy=JSON.stringify({version:1,initialized:true,items:refs,selected:refs[0]});
        s.values.set(LEGACY_DESK_KEY,legacy);let fail=true;
        const storage={...s.storage,setItem:(key:string,value:string)=>{if(fail&&key===DESK_V1_BACKUP_KEY)throw Error('quota');s.storage.setItem(key,value);}};
        const store=createReadingDeskStore(()=>storage);
        expect(store.getState().desk.items).toHaveLength(3);expect(store.getState().persistenceFailed).toBe(true);expect(s.values.has(DESK_KEY)).toBe(false);
        fail=false;store.getState().reconcile(files);store.getState().keep(files[3]);
        expect(store.getState().persistenceFailed).toBe(false);expect(s.values.get(DESK_V1_BACKUP_KEY)).toBe(legacy);
        expect(JSON.parse(s.values.get(DESK_KEY)!).items).toHaveLength(4);
    });
    it('does not echo external storage events and cannot undo over a queued external change', () => {
        const s=setup();s.get().reconcile(files);s.get().keep(files[0]);s.get().keep(files[1]);
        const external=JSON.stringify({...emptyDesk(true),items:[materialRef(files[4])],selected:materialRef(files[4])});
        // Another window has committed, but this window has not received its event yet.
        s.values.set(DESK_KEY,external);s.get().undoChange();
        expect(s.ids()).toEqual([5]);expect(s.values.get(DESK_KEY)).toBe(external);expect(s.get().undo).toBeNull();
        expect(s.get().notice?.kind).toBe('undoUnavailable');
        s.get().acceptExternal(null);expect(s.ids()).toEqual([]);expect(s.values.get(DESK_KEY)).toBe(external);
    });
});
