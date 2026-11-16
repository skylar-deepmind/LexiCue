import { describe, expect, it } from 'vitest';
import { allocatedCover, materialCover, savedCover } from '../materialCover';
import { phonePosterLayout } from '../posterLayout';
import { dictionarySupplement } from '../dictionarySupplement';
import type { Material } from '../materials';
import type { SavedRecord } from '../savedRecords';
import type { DictionaryResult } from '../dictionaryResult';
describe('portable material artwork',()=>{
 it('uses content identity across renamed/restored material and saved source',()=>{
   const material={content_hash:'stable-source-hash',name:'before'} as Material;
   expect(materialCover({...material,name:'after'})).toBe(materialCover(material));
   expect(savedCover({source:{content_hash:material.content_hash}} as SavedRecord)).toBe(materialCover(material));
   expect(allocatedCover('stable-source-hash')).toMatch(/^\/design\/prints\/\d+\.jpg$/);
 });
});
describe('phone wall',()=>{
 it('has two columns with stable identity and a common bottom for an uneven library',()=>{
   const input=Array.from({length:37},(_,i)=>({id:i+1,characters:i%3?300:1700}));
   const layout=phonePosterLayout(input);
   expect(layout.flat().map(p=>p.id).sort((a,b)=>a-b)).toEqual(input.map(p=>p.id));
   expect(layout[1][0].units).toBe(6);
   expect(layout[0].reduce((n,p)=>n+p.units,0)).toBe(layout[1].reduce((n,p)=>n+p.units,0));
 });
 it('can render empty and single-material groups',()=>{expect(phonePosterLayout([])).toEqual([[],[]]);expect(phonePosterLayout([{id:1,characters:15}]).flat()).toHaveLength(1);});
});
describe('supplemental meanings',()=>{
 const result=(meanings:string[])=>({entries:[{groups:[{senses:meanings.map(en=>({meaning:{en,zh:null}}))}]}]} as DictionaryResult);
 it('keeps new meanings while discarding provider-ID and punctuation variants of existing ones',()=>{
   const local=result(['The air around us.']),online=result(['the air around us','A way of behaving.']);
   expect(dictionarySupplement(local,online)?.entries[0].groups[0].senses.map(s=>s.meaning.en)).toEqual(['A way of behaving.']);
   expect(local.entries[0].groups[0].senses).toHaveLength(1);
   expect(online.entries[0].groups[0].senses).toHaveLength(2);
 });
 it('represents no new uses without removing the base definition',()=>{expect(dictionarySupplement(result(['One.']),result(['one']))?.entries).toEqual([]);});
});
