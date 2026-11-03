import { describe, expect, it } from 'vitest';
import { authorizeImportedReading, consumeImportedReading, readingReturnPath, retainImportedReading, validateImportedReading } from '../readingEntry';
import type { ImportItem } from '../../stores/importStore';
import type { ReadingMaterial } from '../materials';
const item={id:'operation',stage:'created',result:{file_id:4,outcome:'created',readable:true},draft:{content:'Hello.',operation_id:'operation',name:'hello',segments:[],wordCount:1}} as unknown as ImportItem;
const data={material:{id:4,content_hash:'2d8bd7d9bb5f85ba'},segments:[{en_text:'Hello.'}],tokens:[]} as unknown as ReadingMaterial;
describe('reading entry authorization', () => {
    it('requires a fresh readable created receipt plus a successful open with matching content and identity', async () => {
        data.material.content_hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Hello.')))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
        const token=authorizeImportedReading(item);
        expect(await validateImportedReading(null,data)).toBe(false);
        expect(await validateImportedReading(token,{...data,material:{...data.material,id:5}})).toBe(false);
        expect(await validateImportedReading(token,{...data,material:{...data.material,content_hash:'recycled'}})).toBe(false);
        expect(await validateImportedReading(token,{...data,segments:[]})).toBe(false);
        expect(await validateImportedReading(token,data)).toBe(true);
        expect(consumeImportedReading(token)).toBe(true);expect(await validateImportedReading(token,data)).toBe(false);
        expect(consumeImportedReading(undefined)).toBe(false);
    });
    it('does not authorize duplicate, failed, unreadable or stale import intents', async () => {
        for (const patch of [{stage:'duplicate',result:{file_id:4,outcome:'duplicate',readable:true}},{stage:'failed'},{result:{file_id:4,outcome:'created',readable:false}}]) expect(authorizeImportedReading({...item,...patch} as ImportItem)).toBeNull();
        const old=authorizeImportedReading(item);authorizeImportedReading(item);
        expect(await validateImportedReading(old,data)).toBe(false);
        const abandoned=authorizeImportedReading(item);retainImportedReading(undefined);
        expect(await validateImportedReading(abandoned,data)).toBe(false);
    });
    it('returns to the origin without treating saved/deep-link entries as library placement', () => {
        expect(readingReturnPath({readingOrigin:'library'})).toBe('/files?view=library');
        for (const state of [null,{}, {readingOrigin:'desk'}, {readingOrigin:'saved'}]) expect(readingReturnPath(state)).toBe('/files');
    });
});
