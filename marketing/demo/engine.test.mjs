import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoEngine,demoDictionary,memoryStorage,validSnapshot} from './engine.mjs';
test('every seed and imported material has actual ReaderToken ranges',()=>{const e=new DemoEngine();const imported=e.invoke('import_reading_material',{input:{operation_id:'test-import',name:'sample.txt',content:'A bright morning.',segments:[{index:0,en_text:'A bright morning.'}]}});for(const id of [...e.materials.map(m=>m.material.id),imported.file_id]){const data=e.open(id);assert.ok(data.tokens.length);for(const token of data.tokens){const segment=data.segments.find(s=>s.index_num===token.segment_index);assert.equal(segment.en_text.slice(token.start,token.end),token.surface);assert.equal(token.language,'en');}}});
test('save, repeat receipt, edit, remove and undo affect only one context',()=>{const e=new DemoEngine(),data=e.open(e.materials[1].material.id),s=data.segments[0],start=s.en_text.indexOf('take off'),mutation={kind:'save',input:{segment_id:s.id,expression:'take off',start_offset:start,end_offset:start+8,explanation:null,explanation_source:'unknown',dictionary_reference:{kind:'dictionary_excerpt',senses:[]}}};const saved=e.mutate(mutation,'new');assert.deepEqual(e.mutate(mutation,'new'),saved);assert.equal(e.active('take off').length,2);const edited=e.mutate({kind:'edit',record_id:saved.record.record_id,expected_revision:saved.record.revision,explanation:'A flight begins.'},'edit');assert.equal(edited.record.explanation,'A flight begins.');assert.throws(()=>e.mutate({kind:'edit',record_id:saved.record.record_id,expected_revision:saved.record.revision,explanation:'stale'},'stale'),/conflict/);e.mutate({kind:'remove',record_id:saved.record.record_id,expected_revision:edited.record.revision},'remove');assert.equal(e.active('take off').length,1);e.undo('remove');assert.equal(e.active('take off').length,2);assert.equal(e.invoke('saved_recall_contexts',{expression:'take off',offset:0,limit:1}).total,2);});
test('tag changes, positions and source links use current material identities',()=>{const e=new DemoEngine(),m=e.materials[0].material;const tag=e.invoke('create_tag',{name:'New tag'});e.invoke('set_file_tags',{fileId:m.id,tagIds:[tag.id],newTagNames:['Fresh'],tones:{'new tag':'green',fresh:'pink'}});assert.equal(e.invoke('list_materials',{tagIds:[tag.id]}).length,1);assert.equal(m.tags[0].tone,'green');assert.equal(m.tags[1].tone,'pink');e.invoke('rename_tag',{tagId:tag.id,name:'Renamed'});assert.equal(m.tags[0].name,'Renamed');e.invoke('remember_reading_position',{fileId:m.id,contentHash:m.content_hash,segment:2});assert.equal(e.open(m.id).material.position.segment,2);const record=e.active()[0];assert.equal(e.invoke('saved_record_source',{recordId:record.record_id}).file_id,m.id);e.invoke('delete_file_start',{fileId:m.id});assert.equal(e.invoke('saved_record_source',{recordId:record.record_id}),null);assert.ok(e.active()[0].sentence);});
test('native-only commands fail closed and engine has no network path',()=>{const e=new DemoEngine();assert.equal(e.invoke('device_sync').state,'unsupported');for(const command of ['device_sync_pair','fetch_import_webpage','youtube_list_subs','resolve_tts_audio','install_update','unknown'])assert.throws(()=>e.invoke(command),/demo_unavailable/);assert.equal(e.invoke('translate_import_sentences').translations.length,0);});
test('dictionary is explicitly original sample data and unknown words stay unknown',()=>{const result=demoDictionary('take off');assert.equal(result.entries[0].source.dataset,'LexiCue original demo definitions');assert.equal(result.entries[0].groups[0].senses.length,2);assert.equal(demoDictionary('not-in-this-demo').status,'not_found');});
test('storage is independent and corrupt/old snapshots never hydrate partially',()=>{const a=memoryStorage(),b=memoryStorage();a.setItem('lexicue-theme','midnight');assert.equal(b.getItem('lexicue-theme'),null);a.clear();assert.equal(a.length,0);for(const invalid of [null,{},[],{version:0},{version:1,engine:{}},{version:1,engine:{materials:[],records:[]}}])assert.equal(validSnapshot(invalid),false);const e=new DemoEngine();const snapshot={version:1,engine:{next:e.next,tick:e.tick,materials:e.materials,records:e.records,tags:e.tags,receipts:[...e.receipts],operations:[...e.operations],jobs:[...e.jobs]},local:{},session:{}};assert.equal(validSnapshot(snapshot),true);snapshot.engine.records=[{expression:'bad'}];assert.equal(validSnapshot(snapshot),false);});
test('tutorial saves have an independent scope',()=>{const e=new DemoEngine();const example=e.invoke('begin_example_session',{sessionId:'tour'});assert.equal(e.invoke('example_recall_contexts',{sessionId:'tour',expression:'take off'}).total,0);assert.equal(e.active('take off').length,1);assert.ok(example.data.tokens.length);e.invoke('end_example_session',{sessionId:'tour'});assert.equal(e.examples.size,0);});

test('imported document provenance remains usable for a saved source',()=>{
 const e=new DemoEngine();const document={schema_version:2,identity:'clipboard-identity',original_format:'clipboard',source_sha256:'source-hash',extractor_version:'demo',selection:{kind:'all'},origin:{kind:'clipboard',title:'Copied story'},sections:[{id:'s1',title:'Copied story'}],blocks:[{section_id:'s1',segment_indices:[0],locations:[{section_id:'s1',paragraph:1}]}]};
 const imported=e.importMaterial({operation_id:'document-import',name:'Copied story',content:'Curiosity matters.',document,segments:[{index:0,en_text:'Curiosity matters.'}]});const data=e.open(imported.file_id),segment=data.segments[0];const saved=e.mutate({kind:'save',input:{segment_id:segment.id,expression:'Curiosity',start_offset:0,end_offset:9,explanation:null}},'document-save');assert.equal(saved.record.source.document.identity,data.material.document.identity);assert.equal(saved.record.source.document.locations[0].paragraph,1);
 const backup=e.invoke('export_all');e.invoke('restore_all',{backup});assert.equal(e.invoke('saved_record_source',{recordId:saved.record.record_id}).file_id,imported.file_id);assert.throws(()=>e.invoke('restore_all',{backup:{schema_version:13,data:{}}}),/demo_backup_only/);
});

test('restoring many saved records preserves the next unique record ID',()=>{
 const original=new DemoEngine(),segments=Array.from({length:40},(_,index)=>({index,en_text:'Curiosity matters.'}));
 const id=original.importMaterial({operation_id:'many-contexts',name:'Many contexts.txt',content:segments.map(s=>s.en_text).join('\n'),segments}).file_id;
 for(const segment of original.open(id).segments)original.mutate({kind:'save',input:{segment_id:segment.id,expression:'Curiosity',start_offset:0,end_offset:9,explanation:null}},'many-'+segment.id);
 const backup=original.invoke('export_all'),restored=new DemoEngine();
 restored.invoke('restore_all',{backup});const previousIds=new Set(restored.records.map(r=>r.record_id));
 const segment=restored.open(id).segments[0];const next=restored.mutate({kind:'save',input:{segment_id:segment.id,expression:'matters',start_offset:10,end_offset:17,explanation:null}},'after-restore');
 assert.equal(previousIds.has(next.record.record_id),false);assert.ok(Number(next.record.record_id.replace('demo-saved-',''))>=backup.data.next);assert.equal(new Set(restored.records.map(r=>r.record_id)).size,restored.records.length);
 // Older demo backups without a next counter are also recovered by scanning record IDs.
 delete backup.data.next;const older=new DemoEngine();older.invoke('restore_all',{backup});const again=older.mutate({kind:'save',input:{segment_id:segment.id,expression:'matters',start_offset:10,end_offset:17,explanation:null}},'older-after-restore');assert.equal(previousIds.has(again.record.record_id),false);
});

test('restored revisions stay monotonic and reject stale edits',()=>{
 const original=new DemoEngine(),seed=original.active()[0];
 original.mutate({kind:'edit',record_id:seed.record_id,expected_revision:seed.revision,explanation:'Before the backup.'},'before-backup');
 const backup=original.invoke('export_all');
 for(const includeTick of [true,false]){
  const restored=new DemoEngine(),payload=structuredClone(backup);if(!includeTick)delete payload.data.tick;
  restored.invoke('restore_all',{backup:payload});const record=restored.active()[0],stale=record.revision;
  const first=restored.mutate({kind:'edit',record_id:record.record_id,expected_revision:stale,explanation:'First edit after restore.'},'first-after-restore');
  assert.notEqual(first.record.revision,stale);assert.ok(Number(first.record.revision.replace('demo-revision-',''))>backup.data.tick);
  assert.throws(()=>restored.mutate({kind:'edit',record_id:record.record_id,expected_revision:stale,explanation:'A stale edit must fail.'},'stale-after-restore'),/saved_conflict/);
 }
});

// Exercise the real product dictionary validator/presentation helpers. Only its
// native invoke import is replaced; no dictionary/network request is made.
const {readFile}=await import('node:fs/promises');
const {default:typescript}=await import('typescript');
const dictionarySource=await readFile(new URL('../../src/lib/dictionaryResult.ts',import.meta.url),'utf8');
const dictionaryJs=typescript.transpileModule(dictionarySource.replace("import { invoke } from '@tauri-apps/api/core';","const invoke=()=>{throw Error('No native dictionary access in this test');};"),{compilerOptions:{target:typescript.ScriptTarget.ES2023,module:typescript.ModuleKind.ESNext}}).outputText;
const productDictionary=await import('data:text/javascript;base64,'+Buffer.from(dictionaryJs).toString('base64'));
const {DEMO_WORDS,DEMO_FORMS,DEMO_PHRASES}=await import('./dictionary-data.mjs');

test('every built-in clickable ReaderToken has a complete usable sample dictionary result',()=>{
 const engine=new DemoEngine(),surfaces=new Set();let positions=0;
 for(const material of engine.materials){const data=engine.open(material.material.id);for(const token of data.tokens){
  const sentence=data.segments.find(segment=>segment.index_num===token.segment_index).en_text;
  const result=demoDictionary(token.surface,sentence);positions++;surfaces.add(token.surface.toLowerCase());
  assert.equal(result.status,'found',`${material.material.name}: ${token.surface}`);
  assert.equal(productDictionary.validateDictionaryResult(result,token.surface,'longman'),result);
  assert.equal(productDictionary.shouldLookupCambridge(result),false,`${token.surface}: no unnecessary online fallback`);
  const overview=productDictionary.dictionaryOverview(result);assert.ok(overview.length>0);
  for(const item of overview){assert.ok(item.group.part_of_speech);assert.ok(item.sense.meaning.en?.trim());assert.ok(item.sense.meaning.zh?.trim());assert.ok(productDictionary.accentPronunciations(item.group,'us').length>0,`${token.surface}: US surface IPA`);assert.ok(productDictionary.accentPronunciations(item.group,'gb').length>0,`${token.surface}: UK surface IPA`);}
  const reference=productDictionary.dictionaryReference(result);assert.ok(reference?.senses.length,`${token.surface}: can freeze a real dictionary reference`);
 }}
 assert.equal(positions,85);assert.equal(surfaces.size,60);
});
test('sample inflections keep base meanings and pronounce the actual selected form',()=>{
 for(const [surface,form]of Object.entries(DEMO_FORMS)){
  const result=demoDictionary(surface);assert.equal(result.entries[0].headword,form.headword);assert.equal(result.entries[0].match.type,'inflection');
  assert.ok(result.entries[0].groups.every(group=>group.forms.some(item=>item.text===surface)));
  for(const group of result.entries[0].groups){assert.equal(productDictionary.accentPronunciations(group,'us')[0].ipa,form.us);assert.equal(productDictionary.accentPronunciations(group,'gb')[0].ipa,form.uk);}
  assert.ok(result.notices.some(notice=>notice.text.includes(`${surface} → ${form.headword}`)));
 }
 assert.equal(demoDictionary('is').entries[0].groups[0].pronunciations[0].ipa,'ɪz');
 assert.equal(demoDictionary('planned').entries[0].groups[0].pronunciations[0].ipa,'plænd');
 const engine=new DemoEngine(),tokens=engine.materials.flatMap(m=>engine.open(m.material.id).tokens);
 for(const token of tokens){const form=DEMO_FORMS[token.surface.toLowerCase()];if(form)assert.equal(token.lemma,form.headword);}
});
test('functional words and ambiguous words retain correct grammar and distinct senses',()=>{
 const groups=word=>demoDictionary(word).entries[0].groups;
 assert.deepEqual(groups('to').map(group=>group.part_of_speech),['preposition','particle']);
 assert.ok(groups('a')[0].senses[0].meaning.en.includes('singular countable'));
 assert.ok(groups('the')[0].senses[0].meaning.en.includes('already known'));
 assert.ok(groups('us')[0].senses[0].meaning.en.includes('object'));
 assert.ok(groups('our')[0].senses[0].meaning.zh.includes('我们的'));
 assert.ok(groups('have').some(group=>group.part_of_speech==='auxiliary'&&group.senses[0].meaning.en.includes('past participle')));
 assert.equal(groups('lead').find(group=>group.part_of_speech==='verb').pronunciations[0].ipa,'liːd');
 assert.equal(groups('lead').find(group=>group.part_of_speech==='noun').pronunciations[0].ipa,'led');
 assert.ok(groups('take off')[0].senses.some(sense=>sense.meaning.zh.includes('脱下')));
 assert.ok(groups('take off')[0].senses.some(sense=>sense.meaning.zh.includes('起飞')));
});
test('all authored headwords and sample phrases obey the product dictionary contract',()=>{
 for(const word of [...Object.keys(DEMO_WORDS),...Object.keys(DEMO_PHRASES)]){
  const result=demoDictionary(word);productDictionary.validateDictionaryResult(result,word,'longman');assert.equal(productDictionary.shouldLookupCambridge(result),false);
  for(const entry of result.entries){assert.equal(entry.source.dataset,'LexiCue original demo definitions');assert.equal(entry.source.edition,'Original sample · CC0');for(const group of entry.groups)for(const sense of group.senses)for(const example of sense.examples){assert.ok(example.english.trim());assert.ok(example.chinese.trim());}}
 }
 assert.equal(Object.keys(DEMO_WORDS).length,59);assert.equal(Object.keys(DEMO_PHRASES).length,8);
});
test('unknown imported words and arbitrary passages never receive a universal definition',()=>{
 for(const expression of ['xylophone','unfamiliarity','A sentence outside the fixed glossary','take of','unlisted-demo-word','constructor','__proto__','prototype','toString','hasOwnProperty']){
  const result=demoDictionary(expression);assert.equal(result.status,'not_found');assert.deepEqual(result.entries,[]);assert.equal(result.default_entry_id,null);assert.equal(productDictionary.dictionaryReference(result),null);
 }
 const first=demoDictionary('Curiosity');first.entries[0].groups[0].senses[0].meaning.zh='changed';assert.notEqual(demoDictionary('Curiosity').entries[0].groups[0].senses[0].meaning.zh,'changed');
});
