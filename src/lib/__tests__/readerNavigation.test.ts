import { describe, expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { readerNavigation, resolveSavedSource, sourceMatches, type ReaderSourceTarget, type ReturnOrigin } from '../readerNavigation';
import type { ReadingMaterial } from '../materials';
import type { SavedRecord } from '../savedRecords';

const sentence = '😀 We take off tomorrow.';
const target: ReaderSourceTarget = {recordId:'record',fileId:9,segmentIndex:4,contentHash:'hash',sentence,expression:'take off',start:6,end:14};
const data: ReadingMaterial = {material:{id:9,name:'Trip',content_hash:'hash',imported_at:0,segment_count:1,preview:sentence,tags:[]},segments:[{id:22,index_num:4,en_text:sentence,zh_text:null,start_time:null,end_time:null}],tokens:[]};
const origin: ReturnOrigin = {kind:'saved',path:'/saved',view:{query:'take',loadedGroups:120,expandedGroupId:'group',loadedContexts:{group:35},scrollTop:117,anchor:{recordId:'record',offset:30}}};

describe('source visits preserve identity and session return state', () => {
  it('checks actual source sentence and UTF-16 offset, not just an index', () => {
    expect(sourceMatches(target,data)).toBe(true);
    expect(sourceMatches({...target,start:5,end:13},data)).toBe(false);
    expect(sourceMatches({...target,contentHash:'new'},data)).toBe(false);
    expect(sourceMatches(target,{...data,segments:[{...data.segments[0],en_text:'A different sentence.'}]})).toBe(false);
  });
  it('supports valid media sources without playable audio/cues while rejecting another identity', () => {
    const media = {...data,material:{...data.material,source:{key:'media',video_id:'video',title:'Trip',audio:null}}};
    expect(sourceMatches({...target,mediaIdentity:'media'},media)).toBe(true);
    expect(sourceMatches({...target,mediaIdentity:'different'},media)).toBe(false);
  });
  it('uses native expression normalization and exact optional identities', () => {
    expect(sourceMatches({...target,expression:' TAKE  OFF '},data)).toBe(true);
    expect(sourceMatches({...target,mediaIdentity:'unexpected'},data)).toBe(false);
    expect(sourceMatches({...target,documentIdentity:'unexpected'},data)).toBe(false);
    expect(sourceMatches({...target,start:null},data)).toBe(false);
    expect(sourceMatches({...target,start:NaN},data)).toBe(false);
  });
  it('snapshots return state independently and allows non-destructive StrictMode reads', () => {
    const token=readerNavigation.create(origin,target);
    expect(readerNavigation.get(token)?.origin).toEqual(origin);
    expect(readerNavigation.get(token)?.target).toEqual(target);
    readerNavigation.complete(token);
    expect(readerNavigation.get(token)).toBeUndefined();
  });
  it('bounds repeated visit memory', () => {
    const first=readerNavigation.create(origin,target);
    for(let i=0;i<17;i++)readerNavigation.create(origin,target);
    expect(readerNavigation.get(first)).toBeUndefined();
  });
  it('distinguishes missing source from a transport failure', async () => {
    const record={record_id:'record',sentence,expression:'take off',source:{content_hash:'hash',segment_index:4,start_offset:6,end_offset:14}} as SavedRecord;
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await resolveSavedSource(record)).toBeNull();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('offline transport'));
    await expect(resolveSavedSource(record)).rejects.toThrow('offline transport');
    vi.mocked(invoke).mockResolvedValueOnce({file_id:9,segment_index:4}).mockResolvedValueOnce(data);
    expect(await resolveSavedSource(record)).toMatchObject(target);
  });
});
