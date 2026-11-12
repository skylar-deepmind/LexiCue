// Browser-only, ephemeral data. No database, native command, account or network client.
import {demoDictionary,demoLemma} from './demo-dictionary.mjs';
export {demoDictionary} from './demo-dictionary.mjs';
import {englishTokenSpans} from '../../src/lib/englishTokenSpans.ts';
const clone=x=>structuredClone(x);
const normalize=x=>String(x??'').trim().replace(/\s+/g,' ').toLowerCase();
function savedDocument(document,index){
 if(!document)return null;
 const block=document.blocks?.find(block=>block.segment_indices?.includes(index));
 const section=document.sections?.find(section=>section.id===block?.section_id);
 return clone({schema_version:document.schema_version,identity:document.identity,original_format:document.original_format,source_sha256:document.source_sha256,extractor_version:document.extractor_version,selection:document.selection,origin:document.origin,locations:block?.locations||[],section_title:section?.title||''});
}

export const STORIES=[
 {name:'A quiet morning.txt',lines:[['A quiet morning is a good time to read.','安静的清晨很适合阅读。'],['Curiosity helps us notice small changes.','好奇心帮助我们发现细微的变化。'],['We take off our coats and sit beside the window.','我们脱下外套，坐在窗边。'],['A familiar phrase can carry a new meaning in another story.','熟悉的表达在另一个故事中可能有新的含义。'],['One sentence is enough to begin.','从一句话就可以开始。']]},
 {name:'The next journey.txt',lines:[['The plane will take off before dawn.','飞机将在黎明前起飞。'],['We leave a little space for things we have not planned.','我们为计划之外的事留出一点余地。'],['Reading a new story brings familiar words back to us.','阅读新故事，让我们再次遇见熟悉的词。']]},
 {name:'Small steps.txt',lines:[['Small steps can lead to meaningful changes.','小小的行动可以带来有意义的变化。'],['We return to the page and try again.','我们回到这一页，再试一次。']]},
];
export function memoryStorage(){const values=new Map();return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(String(key))??null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear()};}
export class DemoEngine {
 constructor(){this.next=1;this.tick=0;this.materials=[];this.records=[];this.tags=[{id:1,name:'Daily reading',tone:'blue',created_at:0},{id:2,name:'Travel',tone:'purple',created_at:0}];this.receipts=new Map();this.examples=new Map();this.operations=new Map();this.jobs=new Map();
  for(const [i,story]of STORIES.entries()){const result=this.importMaterial({operation_id:'seed-'+i,name:story.name,content:story.lines.map(x=>x[0]).join('\n'),segments:story.lines.map(([en_text,zh_text],index)=>({index,en_text,zh_text})),normalized_kind:'txt'});this.materials.find(m=>m.material.id===result.file_id).material.tags=[clone(this.tags[i===1?1:0])];}
  const s=this.materials[0].segments[2],start=s.en_text.indexOf('take off');this.mutate({kind:'save',input:{segment_id:s.id,expression:'take off',start_offset:start,end_offset:start+8,explanation:'脱下外套。留意它在不同原句里的用法。',explanation_source:'personal'}},'seed-context');
 }
 revision(){return 'demo-revision-'+(++this.tick);}
 importMaterial(input){if(this.operations.has(input.operation_id))return clone(this.operations.get(input.operation_id));if(!input.segments?.length)throw Error('material_empty');
  const same=this.materials.find(x=>x.content===input.content&&x.material.name===input.name);if(same)return {file_id:same.material.id,outcome:'duplicate',readable:true};
  const id=this.next++,hash='demo-content-'+id;
  const data={content:input.content,material:{id,name:String(input.name||'English text'),content_hash:hash,imported_at:Date.now(),segment_count:input.segments.length,preview:input.segments[0].en_text,tags:[],position:null,source_kind:input.document?.origin?.kind||'file',original_format:input.document?.original_format||input.normalized_kind||'txt',document:input.document?clone(input.document):null},segments:input.segments.map((s,i)=>({id:this.next++,index_num:s.index??i,en_text:s.en_text,zh_text:s.zh_text??null,start_time:s.start_time??null,end_time:s.end_time??null})),tokens:[],media_refs:{}};
  this.materials.push(data);const result={file_id:id,outcome:'created',readable:true};this.operations.set(input.operation_id,result);return clone(result);
 }
 open(id){const data=this.materials.find(x=>x.material.id===Number(id));if(!data)throw Error('material_source_removed');return clone({material:data.material,segments:data.segments,tokens:data.segments.flatMap(segment=>englishTokenSpans(segment.en_text).map(span=>({segment_index:segment.index_num,language:'en',surface:segment.en_text.slice(span.start,span.end),lemma:demoLemma(segment.en_text.slice(span.start,span.end)),start:span.start,end:span.end,legacy_position:span.position,builtin_position:span.position,word_id:null,status:null}))),media_refs:{}});}
 selection(input){return this.records.find(r=>r.deleted_at===null&&r.source?.segment_id===input.segment_id&&r.source.start_offset===input.start_offset&&r.source.end_offset===input.end_offset&&r.expression===input.expression)||null;}
 mutate(mutation,operationId){if(this.receipts.has(operationId))return clone(this.receipts.get(operationId).result);let before=null,record;
  if(mutation.kind==='save'){const input=mutation.input,data=this.materials.find(m=>m.segments.some(s=>s.id===input.segment_id)),segment=data?.segments.find(s=>s.id===input.segment_id);if(!segment||segment.en_text.slice(input.start_offset,input.end_offset).trim()!==input.expression.trim())throw Error('saved_invalid_selection');
   record=this.selection(input);if(record)return {record:clone(record),changed:false,operation_id:operationId};
   record={record_id:'demo-saved-'+this.next++,expression:input.expression,normalized_expression:normalize(input.expression),source_key:'demo-source-'+segment.id+'-'+input.start_offset+'-'+input.end_offset,sentence:segment.en_text,sentence_translation:segment.zh_text,source:{content_hash:data.material.content_hash,file_name:data.material.name,segment_index:segment.index_num,segment_id:segment.id,start_offset:input.start_offset,end_offset:input.end_offset,start_time:segment.start_time,end_time:segment.end_time,document:savedDocument(data.material.document,segment.index_num)},explanation:input.explanation||null,explanation_source:input.explanation_source||'unknown',dictionary_reference:clone(input.dictionary_reference??null),dictionary_snapshot:clone(input.dictionary_snapshot??null),origin:'reader',legacy:null,saved_at:Date.now(),updated_at:Date.now(),revision:this.revision(),generation:0,deleted_at:null};this.records.push(record);
  }else{record=this.records.find(r=>r.record_id===mutation.record_id);if(!record||record.revision!==mutation.expected_revision)throw Error('saved_conflict');before=clone(record);if(mutation.kind==='remove')record.deleted_at=Date.now();else if(mutation.kind==='edit'){record.explanation=mutation.explanation||null;record.explanation_source='personal';}else throw Error('demo_unsupported_mutation');record.revision=this.revision();record.updated_at=Date.now();}
  const result={record:clone(record),changed:true,operation_id:operationId};this.receipts.set(operationId,{before,result});return clone(result);
 }
 undo(id){const receipt=this.receipts.get(id);if(!receipt)throw Error('saved_conflict');const current=this.records.find(r=>r.record_id===receipt.result.record.record_id);if(!current||current.revision!==receipt.result.record.revision)throw Error('saved_conflict');if(receipt.before)Object.assign(current,clone(receipt.before),{revision:this.revision()});else{current.deleted_at=Date.now();current.revision=this.revision();}this.receipts.delete(id);return clone(current);}
 active(expression){return this.records.filter(r=>r.deleted_at===null&&(!expression||normalize(r.expression)===normalize(expression))).sort((a,b)=>(b.saved_at??0)-(a.saved_at??0));}
 groups(args){const map=new Map();for(const r of this.active())map.set(r.normalized_expression,[...(map.get(r.normalized_expression)||[]),r]);const groups=[...map.entries()].map(([key,records])=>({group_id:'demo-group:'+key,expression:records[0].expression,context_count:records.length,latest_saved_at:records[0].saved_at,preview:records[0],summary:null})).filter(g=>JSON.stringify(g).toLowerCase().includes(normalize(args.query)));return clone({groups:groups.slice(args.offset||0,(args.offset||0)+(args.limit||50)),total_groups:groups.length,total_records:groups.reduce((n,g)=>n+g.context_count,0)});}
 invoke(command,args={}){switch(command){
  case 'list_materials':return clone(this.materials.map(x=>x.material).filter(m=>(!args.untagged||!m.tags.length)&&(!args.tagIds?.length||args.tagIds.every(id=>m.tags.some(t=>t.id===id)))));
  case 'open_reading_material':return this.open(args.fileId);
  case 'import_reading_material':return this.importMaterial(args.input);
  case 'remember_reading_position':{const m=this.materials.find(x=>x.material.id===args.fileId)?.material;if(!m||m.content_hash!==args.contentHash)throw Error('material_source_removed');const revision=this.revision();m.position={segment:args.segment,revision};return revision;}
  case 'begin_example_session':{let demo=this.examples.get(args.sessionId);if(!demo){demo=new DemoEngine();demo.records=[];demo.receipts.clear();this.examples.set(args.sessionId,demo);}return {session_id:args.sessionId,data:demo.open(demo.materials[0].material.id)};}
  case 'end_example_session':this.examples.delete(args.sessionId);return null;
  case 'example_saved_for_selection':return this.examples.get(args.sessionId)?.invoke('saved_for_selection',args)??null;
  case 'mutate_example_saved_record':return this.examples.get(args.sessionId)?.invoke('mutate_saved_record',args);
  case 'undo_example_saved_mutation':return this.examples.get(args.sessionId)?.invoke('undo_saved_mutation',args);
  case 'example_recall_contexts':return this.examples.get(args.sessionId)?.invoke('saved_recall_contexts',args)??{records:[],total:0};
  case 'saved_for_selection':return clone(this.selection(args.input));
  case 'mutate_saved_record':return this.mutate(args.mutation,args.operationId);
  case 'undo_saved_mutation':return this.undo(args.operationId);
  case 'remove_saved_group':{
   const request=JSON.stringify([args.groupId,args.expectedCount]),previous=this.receipts.get(args.operationId);
   if(previous){if(previous.kind!=='remove_group'||previous.request!==request||previous.undone)throw Error('saved_conflict');return clone(previous.result);}
   const records=this.active().filter(r=>'demo-group:'+r.normalized_expression===args.groupId);
   if(!records.length||records.length!==args.expectedCount)throw Error('saved_conflict');
   const before=clone(records),after={};
   for(const record of records){record.deleted_at=Date.now();record.updated_at=Date.now();record.revision=this.revision();after[record.record_id]=record.revision;}
   const result={operation_id:args.operationId,count:records.length,changed:true};
   this.receipts.set(args.operationId,{kind:'remove_group',request,before,after,result,undone:false});return clone(result);
  }
  case 'undo_saved_group':{
   const receipt=this.receipts.get(args.operationId);if(receipt?.kind!=='remove_group')throw Error('saved_conflict');
   if(receipt.undone)return {...clone(receipt.result),changed:false};
   const targets=receipt.before.map(before=>this.records.find(r=>r.record_id===before.record_id));
   if(targets.some(record=>!record||record.deleted_at===null||record.revision!==receipt.after[record.record_id]))throw Error('saved_conflict');
   targets.forEach((record,index)=>Object.assign(record,clone(receipt.before[index]),{generation:record.generation+1,revision:this.revision(),updated_at:Date.now()}));
   receipt.undone=true;return clone(receipt.result);
  }
  case 'list_saved_groups':return this.groups(args);
  case 'saved_group_contexts':{const rows=this.active(String(args.groupId).replace('demo-group:',''));return clone({records:rows.slice(args.offset||0,(args.offset||0)+(args.limit||10)),total:rows.length});}
  case 'saved_recall_contexts':{const rows=this.active(args.expression);return clone({records:rows.slice(args.offset||0,(args.offset||0)+(args.limit||10)),total:rows.length});}
  case 'saved_recall_catalog':return {expressions:[...new Set(this.active().map(r=>r.expression))],case_exclusions:[],literal_only:true};
  case 'saved_recall_index':return [...new Set(this.active().map(r=>r.expression))];
  case 'saved_record_source':{const r=this.records.find(r=>r.record_id===args.recordId),m=this.materials.find(m=>m.material.content_hash===r?.source?.content_hash);return m?{file_id:m.material.id,segment_index:r.source.segment_index}:null;}
  case 'saved_record_conflicts':case 'list_device_conflicts':return [];
  case 'saved_migration_report':return {eligible_words:0,eligible_phrases:0,saved_contexts:0,missing_sources:0,merged_duplicate_positions:0,history_only:[]};
  case 'list_tags':return clone(this.tags);
  case 'create_tag':{const name=String(args.name??'').trim();if(!name||this.tags.some(t=>normalize(t.name)===normalize(name)))throw Error('tag_duplicate');const tag={id:this.next++,name,tone:null,created_at:Date.now()};this.tags.push(tag);return clone(tag);}
  case 'rename_tag':{const t=this.tags.find(t=>t.id===(args.tagId??args.id));if(!t)throw Error('tag_missing');if(this.tags.some(x=>x!==t&&normalize(x.name)===normalize(args.name)))throw Error('tag_duplicate');t.name=String(args.name).trim();this.syncTags();return null;}
  case 'set_tag_tone':{const t=this.tags.find(t=>t.id===args.tagId);if(!t)throw Error('tag_missing');t.tone=args.tone;this.syncTags();return null;}
  case 'delete_tag':this.tags=this.tags.filter(t=>t.id!==(args.tagId??args.id));this.syncTags();return null;
  case 'set_file_tags':{const m=this.materials.find(m=>m.material.id===args.fileId);if(!m)throw Error('material_source_removed');const ids=[...(args.tagIds||[])];for(const name of args.newTagNames||[]){let tag=this.tags.find(t=>normalize(t.name)===normalize(name));if(!tag){tag={id:this.next++,name:String(name).trim(),tone:null,created_at:Date.now()};this.tags.push(tag);}ids.push(tag.id);}for(const [name,tone]of Object.entries(args.tones||{})){const tag=this.tags.find(t=>normalize(t.name)===normalize(name));if(tag&&['blue','green','pink','purple','amber','slate'].includes(tone))tag.tone=tone;}m.material.tags=clone(this.tags.filter(t=>ids.includes(t.id)));this.syncTags();return null;}
  case 'delete_file_start':{const id=args.fileId;this.materials=this.materials.filter(m=>m.material.id!==id);const job='demo-delete-'+id;this.jobs.set(job,{done:true,deleted:1,total:1});return {job_id:job,phase:'done',error_code:null,deleted:1,total:1};}
  case 'delete_file_status':return {job_id:args.jobId,phase:'done',error_code:null,deleted:1,total:1};
  case 'lookup_longman_expression':return demoDictionary(args.expression,args.context);
  case 'longman_dictionary_status':return {state:'ready',release:'LexiCue original demo definitions · CC0',error:null,audio_available:false,audio_error:null};
  case 'dictionary_init_status':case 'retry_dictionary_init':return {runId:1,sequence:1,state:'ready',currentSource:null,sources:[]};
  case 'list_files':return [];
  case 'list_legacy_records':return {rows:[],more:false};
  case 'legacy_record_detail':return null;
  case 'device_sync':return {state:'unsupported',role:'mac',paired:false};
  case 'youtube_ytdlp_status':return {available:false,path:null,version:null,javascript:null,ejs:'unknown',ffmpeg:null};
  case 'youtube_clear_subtitle_cache':case 'clear_tts_cache':case 'cancel_import_translation':case 'cancel_import_webpage':case 'youtube_cancel_job':return null;
  case 'translate_import_sentences':return {translations:[],error:'demo_translation_unavailable'};
  case 'export_all':return {schema_version:13,demo:true,data:{next:this.next,tick:this.tick,materials:clone(this.materials),records:clone(this.records),tags:clone(this.tags)}};
  case 'restore_all':{if(args.backup?.demo!==true||!validSnapshot({version:1,engine:{...args.backup.data,next:args.backup.data?.next??this.next,tick:args.backup.data?.tick??0,receipts:[],operations:[],jobs:[]},local:{},session:{}}))throw Error('demo_backup_only');this.materials=clone(args.backup.data.materials);this.records=clone(args.backup.data.records);this.tags=clone(args.backup.data.tags);this.next=Math.max(this.next,args.backup.data.next??0,Math.max(0,...this.materials.flatMap(m=>[m.material.id,...m.segments.map(s=>s.id)]),...this.tags.map(t=>t.id),...this.records.map(r=>Number(r.record_id.replace('demo-saved-',''))||0))+1);this.tick=Math.max(this.tick,args.backup.data.tick??0,...this.records.map(r=>Number(r.revision.replace('demo-revision-',''))||0),...this.materials.map(m=>Number(m.material.position?.revision?.replace('demo-revision-',''))||0));this.receipts.clear();this.operations.clear();return {safety_backup_path:'browser-demo-memory'};}
  default:throw Error('demo_unavailable:'+command);
 }}
 syncTags(){for(const m of this.materials)m.material.tags=m.material.tags.flatMap(t=>{const found=this.tags.find(x=>x.id===t.id);return found?[clone(found)]:[];});}
}

// A corrupt/older snapshot is discarded as one unit; never hydrate partial app stores.
export function validSnapshot(value){
 if(value?.version!==1||!value.engine||!Number.isSafeInteger(value.engine.next)||!Number.isSafeInteger(value.engine.tick)||!Array.isArray(value.engine.materials)||!Array.isArray(value.engine.records)||!Array.isArray(value.engine.tags))return false;
 if(!value.engine.materials.every(m=>Number.isSafeInteger(m?.material?.id)&&typeof m.material.name==='string'&&typeof m.material.content_hash==='string'&&Array.isArray(m.material.tags)&&Array.isArray(m.segments)&&m.segments.every(s=>Number.isSafeInteger(s.id)&&typeof s.en_text==='string')))return false;
 if(!value.engine.records.every(r=>typeof r?.record_id==='string'&&typeof r.expression==='string'&&typeof r.revision==='string'))return false;
 for(const key of ['receipts','operations','jobs'])if(!Array.isArray(value.engine[key])||!value.engine[key].every(row=>Array.isArray(row)&&row.length===2))return false;
 for(const key of ['local','session'])if(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])||!Object.values(value[key]).every(v=>typeof v==='string'))return false;
 return true;
}
