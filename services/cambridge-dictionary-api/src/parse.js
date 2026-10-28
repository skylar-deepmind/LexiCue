// Cambridge DOM adapter, repaired from upstream/data.js (MIT, EliasChen).
// Every descendant query is bounded by its original entry / expression / definition.
import {load} from 'cheerio';
import {createHash} from 'node:crypto';
import {DATASET,ORIGIN,LookupError} from './fetch.js';
import {emptyResult,validateResult} from './validate.js';
export const ADAPTER='cambridge-v1.0.0';
const scopeSelector='.entry-body__el,.pv-block,.idiom-block,.phrase-block';
const clean=s=>s?.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()||null;
const id=(...s)=>`cambridge:${ADAPTER}:${createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0,24)}`;
export function resolveQuery(text){
 const spaced=clean(text)||text;
 const normalizationNotes=text!==spaced?[`Whitespace normalized: ${JSON.stringify(text)} → ${spaced}.`]:[];
 const m=spaced.match(/^(look|looks|looked|looking) (it|this|that|the word|the words|a word|the meaning) up$/i);
 return m?{fetchText:'look up',restricted:true,pattern:'look something up',type:'expression_pattern',normalizationNotes}:{fetchText:spaced,restricted:false,type:'exact',normalizationNotes};
}
function sentenceCaseQuery(text){
 const [first,...rest]=[...text],tail=rest.join('');
 if(!first||!/^\p{Lu}$/u.test(first)||/\p{Lu}/u.test(tail)||!/\p{Ll}/u.test(tail))return null;
 return first.toLowerCase()+tail;
}

function own($,root,selector){return root.find(selector).filter((i,e)=>$(e).closest(scopeSelector)[0]===root[0]);}
function labels($,root){const out=[];for(const [selector,kind] of [['.gram,.dgram','grammar'],['.usage','register'],['.region:not(.dreg)','region'],['.epp-xref','level']])root.find(selector).each((i,e)=>{const text=clean($(e).text());if(text&&!(kind==='register'&&/^(symbol|abbreviation|short form|past simple of|past participle of|present participle of)$/.test(text))&&!out.some(l=>l.kind===kind&&l.text===text))out.push({kind,text})});return out;}
function titleOf($,scope){
 const title=scope.children('.di-title').find('.headword').first();
 if(title.length)return title;
 const header=scope.children('.pos-header');if(header.length)return header.find('.di-title .headword').first();
 return scope.children('.phrase-head').find('.phrase-title').first();
}
function baseTitle($,title){const c=title.clone();c.find('.obj').filter((i,e)=>/^(something|someone|somebody)(\/(something|someone|somebody))*$/.test(clean($(e).text())||'')).remove();return clean(c.text());}
function matches(query,base,full,restricted){
 if(restricted)return /\bsomething\b/.test(full)&&base==='look up';
 if(query===base||query===full)return true;
 // Slash alternatives are source-provided, never arbitrary prefix matches.
 if(base?.includes('/')&&base.split('/')[0]===query)return true;
 return false;
}
function sourceScopeMatches($,scope,query,restricted){
 const title=titleOf($,scope),full=clean(title.text()),base=baseTitle($,title);
 const parentTitle=clean(scope.closest('.entry-body__el').children('.pos-header').find('.di-title .hw').first().text());
 return matches(query,base,full,restricted)||(scope.is('.phrase-block')&&full===`the ${query}`&&parentTitle===query);
}
function normalizedSourceQuery($,scopes,resolved){
 // The complete page's exact spelling always wins, including case-sensitive abbreviations.
 if(scopes.toArray().some(e=>sourceScopeMatches($,$(e),resolved.fetchText,resolved.restricted)))return resolved;
 const lower=sentenceCaseQuery(resolved.fetchText);
 if(!lower||!scopes.toArray().some(e=>sourceScopeMatches($,$(e),lower,resolved.restricted)))return resolved;
 return{...resolved,fetchText:lower,normalizationNotes:[...(resolved.normalizationNotes||[]),`Sentence capitalization normalized: ${resolved.fetchText} → ${lower}.`]};
}
function datasetOf($,scope){const d=scope.closest('[data-id].dictionary').attr('data-id');if(d)return d;const article=scope.closest('article');for(const name of ['english-chinese-simplified','english','business-english','american-english'])if(article.hasClass(name))return name;return null;}
function nativeLocator($,scope){return scope.children('.cid[id]').attr('id')||scope.parent().children('.cid[id]').attr('id')||scope.find('.cid[id]').first().attr('id')||null;}
function metadataNotes($,header,scopeId){
 const seen=new Set();
 return header.find('.var,.spellvar').filter((i,e)=>!$(e).parents('.var,.spellvar').length).map((i,e)=>{
   const content=clean($(e).text());if(!content||seen.has(content))return null;seen.add(content);
   return{id:id(scopeId,'source_metadata',content),kind:'usage',content:{en:content,zh:null},examples:[]};
 }).get();
}
function grammarNotes($,scope,groupId){
 const seen=new Set();
 return own($,scope,'.xref.grammar .item').map((i,e)=>{
   const item=$(e),link=item.find('a').first(),heading=clean(link.find('.x-h').text()),excerpt=clean(link.find('.x-pos').text());
   if(!heading||!excerpt)return null;
   // These are the short grammar extracts already on this source page, not the linked article's full text.
   const content=`Grammar excerpt: ${heading}: ${excerpt} …`,key=JSON.stringify([link.attr('href'),content]);
   if(seen.has(key))return null;seen.add(key);
   return{id:id(groupId,'grammar_excerpt',key),kind:'grammar',content:{en:content,zh:null},examples:[]};
 }).get();
}
function senseOf($,node,scope,groupId,pattern){
 const en=clean(node.children('.ddef_h').children('.def').text()),body=node.children('.def-body'),zh=clean(body.children('.trans').text());if(!en&&!zh)return null;
 const native=node.attr('data-wl-senseid')||node.closest('.dsense').children('.cid').attr('id')||id(en,zh);
 const sid=id(groupId,native),header=node.children('.ddef_h');
 // Phrase title is an actual source construction, stored at this sense only.
 const patterns=pattern?[{id:id(sid,'pattern',pattern),text:pattern,explanation:null,labels:[],examples:[],notes:[]}]:[];
 const scopedLabels=[...labels($,header),...labels($,node.parents('.dsense').first().children('.dsense_h'))].filter((v,i,a)=>a.findIndex(x=>x.kind===v.kind&&x.text===v.text)===i);
 const allExamples=[],seen=new Set();
 body.children('.examp').each((i,e)=>{
   const ex=$(e),english=clean(ex.children('.eg').text()),chinese=clean(ex.children('.trans').text());if(!english)return;
   const eid=id(sid,'example',english,chinese);if(seen.has(eid))return;seen.add(eid);
   const example={id:eid,english,chinese,audio:null},construction=clean(ex.children('.gram,.dgram').text());
   if(construction){
     let destination=patterns.find(p=>p.text===construction);
     if(!destination){destination={id:id(sid,'pattern',construction),text:construction,explanation:null,labels:[],examples:[],notes:[]};patterns.push(destination)}
     destination.examples.push(example);
   }else allExamples.push(example);
 });
 node.nextUntil('.def-block').filter('.daccord').find('.dexamp').each((i,e)=>{const ex=$(e),copy=ex.clone();copy.find('.trans').remove();const english=clean(copy.text()),chinese=clean(ex.find('.trans').text()),eid=id(sid,'example',english,chinese);if(english&&!seen.has(eid)){seen.add(eid);allExamples.push({id:eid,english,chinese,audio:null})}});
 return{id:sid,meaning:{en,zh},labels:scopedLabels,patterns,examples:allExamples,notes:metadataNotes($,header,sid)};
}
function pronunciations($,scope,isExpression){
 // Cambridge phrasal-verb headers explicitly say "with [parent]"; this is parent audio.
 if(isExpression)return [];
 return scope.children('.pos-header').find('.dpron-i').map((i,e)=>{const p=$(e),region=clean(p.find('.region').text())?.toLowerCase(),ipa=clean(p.find('.pron').text()),src=p.find('source[type="audio/mpeg"]').attr('src');let audio=null;if(src){try{const u=new URL(src,ORIGIN);if(u.origin===ORIGIN&&u.pathname.startsWith('/media/'))audio={kind:'remote_url',location:u.href}}catch{}}if(!ipa&&!audio)return null;return{region:['uk','us'].includes(region)?region:'unspecified',ipa,audio,form_label:null}}).get();
}
const poses=new Set(['noun','verb','adjective','adverb','pronoun','determiner','preposition','conjunction','interjection','auxiliary','modal','numeral','particle','prefix','suffix','abbreviation','symbol']);
export function parsePage({text,html,url,fetchedAt=new Date().toISOString(),resolved=resolveQuery(text)}){
 const $=load(html);const title=clean($('title').text())||'';
 if(!/Cambridge/i.test(title)||/just a moment|access denied|verify you are human/i.test(title))throw new LookupError('upstream_page_identity',502);
 const allScopes=$(scopeSelector).filter((i,e)=>titleOf($,$(e)).length>0);
 if(!allScopes.length){
   const home=new URL(url).pathname.replace(/\/$/,'')===`/dictionary/${DATASET}`;
   if(home || $('.spellcheck,.didyoumean,.search-results').length)return emptyResult(text,'not_found','target_not_found');
   throw new LookupError('upstream_parse',502);
 }
 resolved=normalizedSourceQuery($,allScopes,resolved);
 const entries=new Map();let candidate=false;
 allScopes.each((i,el)=>{
   const scope=$(el),titleNode=titleOf($,scope),full=clean(titleNode.text()),base=baseTitle($,titleNode);
   const parentTitle=clean(scope.closest('.entry-body__el').children('.pos-header').find('.di-title .hw').first().text());
   const sourceArticle=scope.is('.phrase-block')&&full===`the ${resolved.fetchText}`&&parentTitle===resolved.fetchText;
   if(!matches(resolved.fetchText,base,full,resolved.restricted)&&!sourceArticle)return;
   candidate=true;
   const expression=scope.is('.pv-block,.idiom-block,.phrase-block')||/\s/.test(base),dataset=datasetOf($,scope);
   const headword=resolved.restricted?'look up':resolved.fetchText===base?base:(base?.split('/')[0]===resolved.fetchText?full:base);
   if(!dataset)throw new LookupError('upstream_dataset',502);
   const entryId=id('entry',dataset,headword),locator=nativeLocator($,scope)||id('scope',dataset,headword,full),groupId=id(entryId,locator,full);
   const posNodes=scope.children('.pos-header,.di-info').find('.pos');
   const posText=clean((scope.is('.pv-block')?posNodes.last():posNodes.first()).text())||null;
   const pos=poses.has(posText)?posText:scope.is('.pv-block')?'verb':posText==='exclamation'?'interjection':posText? 'other':null;
   if(resolved.partOfSpeech&&pos!==resolved.partOfSpeech)return;
   if(resolved.requireForm&&!scope.children('.pos-header').find('.inf').toArray().some(e=>clean($(e).text())===resolved.requireForm))return;
   const pattern=full!==base?full:null;
   const senses=own($,scope,'.def-block').map((i,e)=>senseOf($,$(e),scope,groupId,pattern)).get();
   if(!senses.length)return;
   const groupHeader=scope.children('.pos-header,.di-info,.phrase-head');
   const forms=scope.children('.pos-header').find('.inf-group').map((i,e)=>({text:clean($(e).text()),label:'词形'})).get().filter(x=>x.text);
   const group={id:groupId,part_of_speech:pos,source_part_of_speech:posText,pronunciations:pronunciations($,scope,expression),forms,labels:labels($,groupHeader),senses,notes:[...metadataNotes($,groupHeader,groupId),...grammarNotes($,scope,groupId)]};
   let entry=entries.get(entryId);
   const parent=scope.closest('.entry-body__el').not(scope).children('.pos-header').find('.hw').first();
   const nested=scope.is('.phrase-block') || (scope.is('.pv-block,.idiom-block')&&!!parent.length);
   if(!entry){entry={id:entryId,headword,kind:expression?'expression':'word',expression_type:scope.is('.pv-block')?'phrasal_verb':scope.is('.idiom-block')?'idiom':null,origin:nested?'subentry':'headword',parent_headword:nested?clean(parent.text())||clean(scope.closest('.entry-body__el').find('.hw').first().text())||base:null,source:{provider:'cambridge',dataset,edition:null,release:null,adapter_version:ADAPTER,delivery:'online',entry_key:headword,locator:`#${locator}`,entry_url:url,retrieved_at:fetchedAt},match:{type:resolved.type==='inflection'?'inflection':resolved.restricted?'expression_pattern':sourceArticle?'reference':base?.includes('/')?'spelling_variant':'exact',pattern:resolved.restricted?resolved.pattern:null,note:resolved.type==='inflection'?`${text} → ${resolved.fetchText}（Cambridge词形交叉引用）`:resolved.restricted?'Cambridge收录句型；仅显示查阅义。':null,sense_ids:[]},groups:[],notes:[],related_expressions:[]};entries.set(entryId,entry)}
   entry.groups.push(group);
   if(resolved.restricted)entry.match.sense_ids.push(...senses.map(s=>s.id));
   // Preserve related expression queries under their parent, never their definitions.
   if(!expression)scope.find('.phrase-title').each((i,e)=>{const value=clean($(e).text());if(value)entry.related_expressions.push({text:value,expression_type:null,scope_id:groupId,target_query:value})});
 });
 const list=[...entries.values()];
 if(resolved.normalizationNotes?.length)for(const entry of list)entry.match.note=[entry.match.note,...resolved.normalizationNotes].filter(Boolean).join(' ');
 if(!list.length){if(candidate)throw new LookupError('upstream_parse',502);return emptyResult(text,'not_found','target_not_found')}
 const preferred=list.find(e=>e.groups.some(g=>g.senses.some(s=>s.meaning.zh)))||list[0];
 const status=preferred.groups.some(g=>g.senses.some(s=>s.meaning.zh))?'found':'partial';
 return validateResult({schema_version:1,query:{text,language:'en',context:null},status,default_entry_id:preferred.id,entries:list,notices:status==='partial'?[{code:'english_only',text:'剑桥目前仅提供英文释义。',entry_id:preferred.id}]:[]});
}

/** Follow only a Cambridge-provided inflection cross-reference, then verify the target's own forms. */
export function inflectionTarget(html,text){
 const $=load(html);let target=null;
 const resolved=normalizedSourceQuery($,$(scopeSelector).filter((i,e)=>titleOf($,$(e)).length>0),resolveQuery(text));
 $('.entry-body__el').each((i,e)=>{const scope=$(e);if(clean(titleOf($,scope).text())!==resolved.fetchText)return;const def=own($,scope,'.def').first();const usage=clean(def.find('.usage').text());if(!/^(past simple|past participle|present participle) of$/.test(usage||''))return;const link=def.find('a.Ref').first(),word=clean(link.text());try{const u=new URL(link.attr('href'),ORIGIN);if(word&&u.origin===ORIGIN&&u.pathname===`/dictionary/${DATASET}/${encodeURIComponent(word)}`)target={fetchText:word,type:'inflection',partOfSpeech:'verb',requireForm:resolved.fetchText,restricted:false,normalizationNotes:resolved.normalizationNotes}}catch{}});
 return target;
}
