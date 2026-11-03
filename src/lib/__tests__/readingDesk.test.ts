import { describe, expect, it } from 'vitest';
import { archiveFromDesk, DESK_LIMIT, emptyDesk, keepOnDesk, materialRef, openOnDesk, parseDesk, reconcileDesk, selectOnDesk } from '../readingDesk';
import type { Material } from '../materials';
const file = (id: number): Material => ({id,name:`Material ${id}`,content_hash:`hash-${id}`,segment_count:10,preview:'Hello.',imported_at:id,tags:[]});
const files = [1,2,3,4,5,6].map(file);
const ids = (desk: ReturnType<typeof emptyDesk>) => desk.items.map(ref=>ref.id);
describe('reading desk state and stable identity', () => {
    it('initializes only one matching last-reading material, once, including an explicitly empty desk', () => {
        let desk=reconcileDesk(emptyDesk(),files,{id:2,hash:'hash-2'});
        expect(ids(desk)).toEqual([2]);
        desk=archiveFromDesk(desk,materialRef(files[1]));
        expect(ids(reconcileDesk(desk,files,{id:3,hash:'hash-3'}))).toEqual([]);
        expect(ids(reconcileDesk(emptyDesk(),files,{id:2,hash:'wrong'}))).toEqual([]);
        expect(ids(reconcileDesk(emptyDesk(),[{...file(2),segment_count:0}],{id:2,hash:'hash-2'}))).toEqual([]);
    });
    it('keeps stable display order, caps at five, and never backfills', () => {
        let desk=emptyDesk(true);
        for (const material of files) desk=keepOnDesk(desk,material);
        expect(DESK_LIMIT).toBe(5);expect(ids(desk)).toEqual([6,5,4,3,2]);
        expect(desk.opened).toEqual([]);
        desk=keepOnDesk(desk,files[2]);expect(ids(desk)).toEqual([6,5,4,3,2]);
        desk=archiveFromDesk(desk,materialRef(files[2]));
        expect(ids(reconcileDesk(desk,files,null))).toEqual([6,5,4,2]);
    });
    it('separates selection from actual opens and evicts the least recently opened previous member', () => {
        let desk=emptyDesk(true);
        for (const material of files.slice(0,5)) desk=keepOnDesk(desk,material);
        for (const material of files.slice(0,5)) desk=openOnDesk(desk,material);
        const display=ids(desk), opened=desk.opened;
        desk=selectOnDesk(desk,files[0]);
        expect(ids(desk)).toEqual(display);expect(desk.opened).toBe(opened);
        desk=openOnDesk(desk,files[0]);
        expect(ids(desk)).toEqual(display);expect(desk.opened.map(ref=>ref.id)).toEqual([1,5,4,3,2]);
        expect(openOnDesk(desk,files[0])).toBe(desk);
        expect(openOnDesk(desk,files[5])).toBe(desk);
        desk=keepOnDesk(desk,files[5]);
        expect(ids(desk)).toEqual([6,5,4,3,1]);expect(desk.selected?.id).toBe(6);
        expect(desk.opened.map(ref=>ref.id)).toEqual([1,5,4,3]);
        // New member 6 is not marked opened and is therefore older than every actual open.
        desk=keepOnDesk(desk,file(7));expect(ids(desk)).toEqual([7,5,4,3,1]);
    });
    it('migrates v1 order into relative open recency without changing selection or ref identities', () => {
        const items=[3,2,1].map(file).map(materialRef);
        const parsed=parseDesk(JSON.stringify({version:1,initialized:true,items,selected:items[1]}));
        expect(parsed).toEqual({desk:{version:2,initialized:true,items,selected:items[1],opened:items},recovered:false});
        expect(parseDesk(JSON.stringify({version:1,initialized:true,items:[],selected:null})).desk).toEqual(emptyDesk(true));
    });
    it('cannot attach recycled ids, changed source keys or changed document identities', () => {
        const source={key:'youtube:one',video_id:'one',title:'One',audio:null};
        const material={...file(1),source};
        const desk=keepOnDesk(emptyDesk(true),material);
        expect(ids(reconcileDesk(desk,[{...material,source:{...source,key:'youtube:two'}}],null))).toEqual([]);
        expect(ids(reconcileDesk(keepOnDesk(emptyDesk(true),file(1)),[{...file(1),content_hash:'other'}],null))).toEqual([]);
        const document={identity:'document:one'} as NonNullable<Material['document']>;
        expect(ids(reconcileDesk(keepOnDesk(emptyDesk(true),{...file(1),document}),[{...file(1),document:{...document,identity:'document:two'}}],null))).toEqual([]);
    });
    it('safely handles missing, malformed, unknown, duplicate, excessive and invalid persistence', () => {
        expect(parseDesk(null).desk.initialized).toBe(false);
        for (const raw of ['{','null','{"version":99,"items":[]}','{"version":2,"initialized":true,"items":[]}','[]']) {
            expect(parseDesk(raw)).toMatchObject({desk:{initialized:true,items:[]},recovered:true});
        }
        const refs=[materialRef(file(1)),{...materialRef(file(1)),id:-2},materialRef(file(1)),...files.slice(1).map(materialRef)];
        const parsed=parseDesk(JSON.stringify({version:1,initialized:true,items:refs,selected:refs.at(-1)}));
        expect(ids(parsed.desk)).toEqual([1,2,3]);expect(parsed.desk.selected?.id).toBe(1);
        expect(parseDesk(JSON.stringify(emptyDesk(true)))).toEqual({desk:emptyDesk(true),recovered:false});
    });
});
