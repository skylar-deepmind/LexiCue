/** UI stress data only: never opens or modifies a learning database. */
export function collectionFixture({theme='ocean',count=10003}={}) {
  localStorage.setItem('lexicue-theme',theme);
  localStorage.setItem('lexicue-preferences',JSON.stringify({state:{uiLanguage:'zh'},version:0}));
  localStorage.setItem('lexicue-onboarding-v1',JSON.stringify({version:1,status:'skipped'}));
  const materials=Array.from({length:count},(_,i)=>({id:i+1,name:`Material ${String(i+1).padStart(5,'0')}${i===23?' — '+ 'Very long title '.repeat(24):''}.txt`,content_hash:`hash-${i+1}`,imported_at:i+1,segment_count:1,preview:'A quiet moment helps us notice the small details around us.',tags:i%2?[{id:1,name:'Reading',tone:'blue'}]:[],source_kind:'file',original_format:'txt'}));
  const items=materials.slice(0,5).map(m=>({id:m.id,identity:`content:${m.content_hash}`,hash:m.content_hash}));
  localStorage.setItem('lexicue-reading-desk:v2',JSON.stringify({version:2,initialized:true,items,selected:items[0]??null,opened:items}));
  window.__collection={materialCount:count,savedCount:count,contexts:1003,delay:0,fail:false,calls:[]};
  const record=(id,index=0)=>({record_id:`record-${id}-${index}`,expression:`word ${id}`,normalized_expression:`word ${id}`,source_key:`source-${id}-${index}`,sentence:`A quiet moment helps us learn word ${id} in sentence ${index+1}.`,sentence_translation:null,source:null,explanation:'一段保存在语境中的解释',explanation_source:'personal',origin:'reader',legacy:null,saved_at:1700000000000-index,updated_at:1,revision:`revision-${id}-${index}`,generation:0,deleted_at:null});
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  window.__TAURI_INTERNALS__={transformCallback:()=>1,unregisterCallback(){},convertFileSrc:path=>path,invoke:async(command,args={})=>{
    const state=window.__collection;state.calls.push({command,args:structuredClone(args)});
    if(command==='list_materials')return materials.slice(0,state.materialCount);
    if(command==='list_tags')return [{id:1,name:'Reading',tone:'blue',file_count:Math.floor(state.materialCount/2)}];
    if(command==='open_reading_material'){const material=materials.find(m=>m.id===args.fileId);return {material,segments:[{id:1,file_id:material.id,index_num:0,en_text:material.preview,zh_text:null,start_time:null,end_time:null}],tokens:[]};}
    if(command==='list_saved_groups'){
      const groups=Array.from({length:state.savedCount},(_,i)=>{const id=String(i+1).padStart(5,'0');return {group_id:`group-${id}`,expression:`word ${id}`,context_count:state.contexts,latest_saved_at:1700000000000,preview:record(id),summary:'词典中的简短解释'};}).filter(g=>!args.query||g.expression.includes(args.query));
      const result={groups:groups.slice(args.offset,args.offset+args.limit),total_groups:groups.length,total_records:groups.length*state.contexts};
      if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
      if(state.fail)throw Error('fixture read failure');return result;
    }
    if(command==='saved_group_contexts')return {records:Array.from({length:Math.min(args.limit,Math.max(0,state.contexts-args.offset))},(_,i)=>record(args.groupId.slice(6),args.offset+i)),total:state.contexts};
    if(command==='saved_migration_report')return {saved_contexts:0};
    if(command==='saved_record_conflicts')return [];
    if(command==='dictionary_init_status')return {runId:1,sequence:1,state:'ready',currentSource:null,sources:[]};
    if(command==='dictionary_status')return true;
    if(command==='get_local_gemma_activity')return {generations:0,pulling:false,deleting:false,sequence:0};
    if(command==='youtube_ytdlp_status')return {available:false,version:null,path:null};
    if(command==='plugin:event|listen')return 1;
    if(command==='plugin:app|version')return '0.4.7';
    if(command==='list_files')return [];
    if(command.startsWith('plugin:'))return null;
    return null;
  }};
}
