import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);
const schema=JSON.parse(fs.readFileSync(new URL('../schema/dictionary-result-v1.schema.json',import.meta.url),'utf8'));
const schemaCheck=ajv.compile(schema);
export function validateResult(result){
 if(!schemaCheck(result))throw Error(`schema:${ajv.errorsText(schemaCheck.errors)}`);
 const ids=new Set();
 for(const entry of result.entries){
   if(entry.source.provider!=='cambridge'||!entry.id.startsWith('cambridge:'))throw Error('provider');
   const url=new URL(entry.source.entry_url);if(url.origin!=='https://dictionary.cambridge.org'||!url.pathname.includes('/dictionary/'))throw Error('source_url');
   const senses=[];
   function id(value){if(ids.has(value)||!value.startsWith('cambridge:'))throw Error('duplicate_id');ids.add(value)}
   id(entry.id);
   function notes(values){for(const note of values){id(note.id);for(const example of note.examples)id(example.id)}}
   notes(entry.notes);
   for(const group of entry.groups){id(group.id);notes(group.notes);for(const sense of group.senses){id(sense.id);senses.push(sense.id);notes(sense.notes);for(const example of sense.examples)id(example.id);for(const pattern of sense.patterns){id(pattern.id);notes(pattern.notes);for(const example of pattern.examples)id(example.id)}}}
   if(entry.match.sense_ids.some(v=>!senses.includes(v))||entry.match.sense_ids.length&&senses.some(v=>!entry.match.sense_ids.includes(v)))throw Error('sense_scope');
   for(const group of entry.groups)for(const pron of group.pronunciations)if(pron.audio){const u=new URL(pron.audio.location);if(u.origin!=='https://dictionary.cambridge.org'||!u.pathname.startsWith('/media/'))throw Error('audio_url')}
 }
 if(result.entries.length&&!result.entries.some(e=>e.id===result.default_entry_id))throw Error('default');
 return result;
}
export function emptyResult(text,status,code){return {schema_version:1,query:{text,language:'en',context:null},status,default_entry_id:null,entries:[],notices:code?[{code,text:status==='not_found'?'未确认到该表达的完整词条。':'剑桥暂时无法查询，请稍后重试。',entry_id:null}]:[]};}
