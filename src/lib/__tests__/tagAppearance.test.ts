import {expect,it} from 'vitest';
import {includeTagQuery,normalizeTagColors,tagTone} from '../tagAppearance';

it('includes a pending typed name on Save without mutating the selection',()=>{
  const value={tagIds:[7],newTagNames:['Study']};
  expect(includeTagQuery(value,'  旅行  ',[])).toEqual({tagIds:[7],newTagNames:['Study','旅行']});
  expect(value).toEqual({tagIds:[7],newTagNames:['Study']});
});
it('selects an existing name and deduplicates pending names case-insensitively',()=>{
  const value={tagIds:[7],newTagNames:['Study']},tags=[{id:9,name:'Travel',created_at:0}];
  expect(includeTagQuery(value,' travel ',tags).tagIds).toEqual([7,9]);
  expect(includeTagQuery(value,'study',tags)).toBe(value);
  expect(includeTagQuery(value,' ',tags)).toBe(value);
});
it('normalizes persisted colors and ignores malformed or unsupported values',()=>{
  expect(normalizeTagColors({' Study ':'green',Bad:'neon',Empty:null})).toEqual({study:'green'});
  expect(normalizeTagColors(null)).toEqual({});
  expect(normalizeTagColors(['blue'])).toEqual({});
  expect(tagTone(' STUDY ',{study:'purple'})).toBe('purple');
  expect(tagTone('Travel',{})).toBe(tagTone('Travel',{}));
});
