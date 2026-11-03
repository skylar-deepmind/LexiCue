import { expect, it, vi } from 'vitest';
import { positionMatchesMaterial, readingPosition } from '../readingDesk';
import type { Material } from '../materials';
it('accepts only content-bound positions without deleting old unbound source positions', () => {
  const values = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  const old = {id:1,content_hash:'old',segment_count:10,source:{key:'same-source'}} as Material;
  const replacement = {...old,content_hash:'new'};
  values.set('lexicue-reader-state:same-source',JSON.stringify({segment:3,offset:0}));
  expect(readingPosition(old)).toBeNull(); expect(readingPosition(replacement)).toBeNull();
  expect(values.has('lexicue-reader-state:same-source')).toBe(true);
  values.set('lexicue-reader-state:same-source',JSON.stringify({segment:4,offset:0,hash:'old'}));
  expect(readingPosition(replacement)).toBeNull(); expect(readingPosition(old)).toBe(4);
  expect(positionMatchesMaterial({},old,'old')).toBe(true);
  expect(positionMatchesMaterial({hash:'new'},replacement,'same-source')).toBe(true);
});
