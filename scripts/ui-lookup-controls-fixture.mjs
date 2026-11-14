/** Isolated interaction fixtures. Local entry is a captured Rust result;
 * online entries and playback delays are explicitly controlled test responses. */
export function lookupControlsFixture({local}) {
  const original=window.__TAURI_INTERNALS__.invoke;
  window.__lookupControls={calls:[],pending:[],missing:false,failed:false,localMissing:false};
  const state=window.__lookupControls;
  const text='A soliloquy helps us understand a character.';
  const online=provider=>{
    const prefix=provider==='cambridge'?'cambridge:public:cambridge-public-v1.1.0:':'wiktionary:freedictionaryapi-v1.0.0:';
    const source=provider==='cambridge'?{
      provider,dataset:'Cambridge Dictionary (author public API)',release:null,edition:null,adapter_version:'cambridge-public-v1.1.0',entry_key:prefix+'entry:test',locator:null,delivery:'online',entry_url:null,retrieved_at:null,access_channel:'author_public_api',service_url:'https://dictionary-api.eliaschen.dev',received_at:'2026-11-13T08:00:00Z',
    }:{
      provider,dataset:'Wiktionary',release:null,edition:null,adapter_version:'freedictionaryapi-v1.0.0',entry_key:prefix+'entry:test',locator:'/entries/0',delivery:'online',entry_url:'https://en.wiktionary.org/wiki/soliloquy',retrieved_at:'2026-11-13T08:00:00Z',received_at:'2026-11-13T08:00:00Z',access_channel:'freedictionaryapi',service_url:'https://freedictionaryapi.com',content_hash:'a'.repeat(64),license:{name:'CC BY-SA 4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/'},attribution:'Wiktionary contributors via FreeDictionaryAPI.com',modifications:'Adapted English definitions and ordinary examples; translations, quotations and audio omitted.',
    };
    return {schema_version:1,query:{text:'soliloquy',language:'en',context:text},status:'found',default_entry_id:prefix+'entry:test',notices:[],entries:[{id:prefix+'entry:test',headword:'soliloquy',kind:'word',expression_type:null,origin:'headword',parent_headword:null,source,match:{type:'exact',pattern:null,note:null,sense_ids:[]},notes:[],related_expressions:[],groups:[{id:prefix+'group:test',part_of_speech:'noun',source_part_of_speech:'noun',pronunciations:[],forms:[],notes:[],labels:[],senses:[{id:prefix+'sense:test',meaning:{en:'A speech spoken to oneself.',zh:provider==='cambridge'?'独白':null},labels:[],patterns:[],notes:[],examples:[],...(provider==='wiktionary'?{source_path:'/entries/0/senses/0',content_kind:'definition',ancestors:[]}: {})}]}]}]};
  };
  const empty=(online=false)=>({schema_version:1,query:{text:'soliloquy',language:'en',context:text},status:online?'unavailable':'not_found',default_entry_id:null,entries:[],notices:online?[{code:'online_free_not_found',text:'本次在线查询未获取到可用解释。',entry_id:null}]:[]});
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    state.calls.push({command,args});
    if(command==='open_reading_material')return {material:{id:1,name:'Lookup interaction test.txt',content_hash:'lookup-test',imported_at:1,segment_count:1,preview:text,tags:[],source_kind:'file',original_format:'txt'},segments:[{id:1,file_id:1,index_num:0,en_text:text,zh_text:null,start_time:null,end_time:null}],tokens:[...text.matchAll(/[A-Za-z]+/g)].map(m=>({segment_index:0,language:'en',surface:m[0],lemma:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length,word_id:null,status:null}))};
    if(command==='lookup_local_expression')return state.localMissing?empty():structuredClone(local);
    if(command==='lookup_cambridge_expression'||command==='lookup_free_dictionary_expression'){
      await new Promise(resolve=>state.pending.push(resolve));
      if(state.failed)throw Error('controlled network failure');
      return state.missing?empty(true):online(command==='lookup_cambridge_expression'?'cambridge':'wiktionary');
    }
    if(['saved_for_selection','saved_recall_catalog','saved_recall_index'].includes(command))return command==='saved_for_selection'?null:[];
    if(command==='saved_recall_contexts')return {records:[],total:0};
    return original(command,args);
  };
}
