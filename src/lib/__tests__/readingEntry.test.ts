import { describe, expect, it } from 'vitest';
import { authorizeImportedReading, consumeImportedReading, readingReturnPath, retainImportedReading, validateImportedReading } from '../readingEntry';
import type { ImportItem } from '../../stores/importStore';
import type { ReadingMaterial } from '../materials';
import type { YoutubeSource } from '../sourceMedia';
const item={id:'operation',stage:'created',result:{file_id:4,outcome:'created',readable:true},draft:{content:'Hello.',operation_id:'operation',name:'hello',segments:[],wordCount:1}} as unknown as ImportItem;
const data={material:{id:4,content_hash:'2d8bd7d9bb5f85ba'},segments:[{en_text:'Hello.'}],tokens:[]} as unknown as ReadingMaterial;
describe('reading entry authorization', () => {
    it('requires a fresh readable created receipt plus a successful open with matching content and identity', async () => {
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
    it('accepts a saved YouTube import only when the media source matches the draft', async () => {
        const source: YoutubeSource = {
            version: 1, provider: 'youtube', key: 'caption-source', video_id: 'jNQXAC9IVRw',
            title: 'Example', audio: null, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            duration_ms: 1000, subtitle_track: 'en', subtitle_language: 'en', subtitle_kind: 'manual',
            subtitle_sha256: 'caption-hash', cues: [{ id: 0, start_ms: 0, end_ms: 1000, text: 'Hello.' }],
        };
        const token = authorizeImportedReading({ ...item, draft: { ...item.draft!, source } });
        const opened = (source: ReadingMaterial['material']['source']) => ({
            ...data, material: { ...data.material, source },
        });
        expect(await validateImportedReading(token, opened(source))).toBe(true);
        expect(await validateImportedReading(token, opened(null))).toBe(false);
        expect(await validateImportedReading(token, opened({ ...source, provider: 'local' }))).toBe(false);
        expect(await validateImportedReading(token, opened({ ...source, key: 'different-captions' }))).toBe(false);
        expect(consumeImportedReading(token)).toBe(true);
    });
    it('returns to the origin without treating saved/deep-link entries as library placement', () => {
        expect(readingReturnPath({readingOrigin:'library'})).toBe('/files?view=library');
        for (const state of [null,{}, {readingOrigin:'desk'}, {readingOrigin:'saved'}]) expect(readingReturnPath(state)).toBe('/files');
    });
});
