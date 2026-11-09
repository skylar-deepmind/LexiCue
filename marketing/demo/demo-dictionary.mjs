import {DEMO_WORDS,DEMO_FORMS,DEMO_PHRASES} from './dictionary-data.mjs';
const own=(object,key)=>Object.hasOwn(object,key)?object[key]:undefined;
const normalize=value=>String(value??'').trim().replace(/[’‘]/g,"'").replace(/\s+/g,' ').toLowerCase();
export function demoLemma(expression){const word=normalize(expression);return own(DEMO_FORMS,word)?.headword??word;}
export function demoDictionary(expression,context=null){
 const query=normalize(expression),form=own(DEMO_FORMS,query),headword=form?.headword??query,phrase=own(DEMO_PHRASES,query);
 const definitions=phrase?.groups??own(DEMO_WORDS,headword);
 const result={schema_version:1,query:{text:expression,language:'en',context},status:definitions?'found':'not_found',default_entry_id:null,entries:[],notices:[]};
 if(!definitions)return result;
 const id='demo:entry:'+headword,groups=(form?.pos?definitions.filter(group=>form.pos.includes(group.pos)):definitions).map((group,index)=>{
  const groupId=id+':group:'+index;
  return {id:groupId,part_of_speech:group.pos,source_part_of_speech:group.pos==='particle'?'infinitive marker · 不定式标记':group.pos,
   // Pronounce the selected surface spelling, while meanings remain attached
   // to its base word. Never show /biː/ under an 'is' lookup, for example.
   pronunciations:[['us',form?.us??group.us],['uk',form?.uk??group.uk]].filter(([,ipa])=>!!ipa).map(([region,ipa])=>({region,ipa,audio:null,form_label:null})),
   forms:Object.entries(DEMO_FORMS).filter(([,item])=>item.headword===headword).map(([text,item])=>({text,label:item.label})),labels:[],
   senses:group.senses.map((sense,n)=>({id:groupId+':sense:'+n,meaning:{en:sense.en,zh:sense.zh},labels:[],patterns:[],examples:sense.example?[{id:groupId+':example:'+n,english:sense.example,chinese:sense.translation??null,audio:null}]:[],notes:[]})),notes:[]};
 });
 result.default_entry_id=id;
 result.entries=[{id,headword,kind:phrase?'expression':'word',expression_type:phrase?.type??null,origin:'demo-original',parent_headword:null,
  source:{provider:'longman',dataset:'LexiCue original demo definitions',edition:'Original sample · CC0',release:'demo-2',adapter_version:'lexicue-demo-v2',entry_key:id,locator:null,delivery:'local',entry_url:null,retrieved_at:null},
  match:{type:form?'inflection':'exact',pattern:null,note:form?`${query} → ${headword} · ${form.label}`:null,sense_ids:[]},groups,notes:[],
  related_expressions:(['take','off'].includes(query)?['take off']:query==='lead'?['lead to']:query==='little'?['a little']:query==='bring'||query==='brings'?['bring back']:[]).map(text=>({text,expression_type:DEMO_PHRASES[text].type,scope_id:'demo:entry:'+text,target_query:text}))}];
 if(form)result.notices.push({code:'demo_inflection',text:`${query} → ${headword} · ${form.label}`,entry_id:id});
 return result;
}
