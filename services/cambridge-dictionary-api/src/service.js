import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {requestPage,DATASET,LookupError} from './fetch.js';
import {parsePage,resolveQuery,inflectionTarget,ADAPTER} from './parse.js';
import {emptyResult,validateResult} from './validate.js';
export const cacheKey=text=>crypto.createHash('sha256').update(JSON.stringify([1,ADAPTER,DATASET,text])).digest('hex');
function retainedUnits(result){
 const units=new Set();
 function example(value){units.add(`example:${value.id}`)}
 function notes(values){for(const note of values){units.add(`note:${note.id}`);note.examples.forEach(example)}}
 for(const entry of result.entries){units.add(`entry:${entry.id}`);notes(entry.notes);for(const group of entry.groups){units.add(`group:${group.id}`);notes(group.notes);for(const sense of group.senses){units.add(`sense:${sense.id}`);if(sense.meaning.zh)units.add(`zh:${sense.id}`);notes(sense.notes);sense.examples.forEach(example);for(const pattern of sense.patterns){units.add(`pattern:${pattern.id}`);pattern.examples.forEach(example);notes(pattern.notes)}}}}
 return units;
}

export function createService({fetchPage=requestPage,cacheDir=null,now=()=>Date.now(),ttl=86400000,negativeTtl=60000,staleTtl=604800000,maxConcurrent=4,maxQueue=16,totalTimeout=8000,upstreamTimeout=7000}={}){
 const pages=new Map(),inflight=new Map();let active=0,requests=0,cacheHits=0;const queue=[];let blockedUntil=0;
 async function read(key){if(pages.has(key))return pages.get(key);if(cacheDir){try{const value=JSON.parse(await fs.readFile(path.join(cacheDir,key+'.json'),'utf8'));if(value.key===key&&value.adapter===ADAPTER&&value.page&&value.savedAt){pages.set(key,value);return value}}catch{}}return null}
 async function write(key,page,negative){const value={key,adapter:ADAPTER,savedAt:now(),negative,page};pages.set(key,value);while(pages.size>500)pages.delete(pages.keys().next().value);if(cacheDir){await fs.mkdir(cacheDir,{recursive:true});const target=path.join(cacheDir,key+'.json');await fs.writeFile(target+'.tmp',JSON.stringify(value));await fs.rename(target+'.tmp',target);const files=await fs.readdir(cacheDir);if(files.length>500){const stats=await Promise.all(files.filter(n=>n.endsWith('.json')).map(async name=>({name,time:(await fs.stat(path.join(cacheDir,name))).mtimeMs})));stats.sort((a,b)=>a.time-b.time);for(const item of stats.slice(0,Math.max(0,stats.length-500)))await fs.unlink(path.join(cacheDir,item.name)).catch(()=>{})}}}
 async function limited(task){let reserved=false;if(active>=maxConcurrent){if(queue.length>=maxQueue)throw new LookupError('service_busy',503);await new Promise((resolve,reject)=>{const item={resolve,reject};queue.push(item);item.timer=setTimeout(()=>{const n=queue.indexOf(item);if(n>=0)queue.splice(n,1);reject(new LookupError('service_busy',503))},1000)});reserved=true}if(!reserved)active++;try{return await task()}finally{const item=queue.shift();if(item){clearTimeout(item.timer);item.resolve()}else active--}}
 function fetchShared(text,key,deadline=now()+totalTimeout){if(inflight.has(key))return inflight.get(key);const p=limited(async()=>{
  if(now()<blockedUntil)throw new LookupError('upstream_rate_limited',429,Math.ceil((blockedUntil-now())/1000));requests++;
  const remaining=Math.max(1,deadline-now());if(remaining<50)throw new LookupError('upstream_timeout',504);
  const page=await fetchPage(text,{timeout:Math.min(upstreamTimeout,remaining)});page.fetchedAt=page.fetchedAt||new Date(now()).toISOString();
  if(page.status===429){let delay=Number(page.retryAfter);if(!Number.isFinite(delay))delay=(Date.parse(page.retryAfter)-now())/1000;if(!Number.isFinite(delay)||delay<1)delay=60;delay=Math.min(delay,3600);blockedUntil=now()+delay*1000;throw new LookupError('upstream_rate_limited',429,Math.ceil(delay))}
  if(page.status===403)throw new LookupError('upstream_forbidden',503);
  if(page.status>=500)throw new LookupError('upstream_server',502);
  // A plain 404 isn't enough to distinguish a dictionary miss from an error page.
  if(page.status!==200)throw new LookupError('upstream_http',502);
  if(!/^text\/html(?:;|$)/i.test(page.contentType))throw new LookupError('upstream_content_type',502);
  const full=parsePage({text,html:page.html,url:page.finalUrl||page.url,fetchedAt:page.fetchedAt});
  const previous=await read(key);
  if(previous&&!previous.negative&&now()-previous.savedAt<staleTtl){
   try{const old=parsePage({text,html:previous.page.html,url:previous.page.finalUrl||previous.page.url,fetchedAt:previous.page.fetchedAt});const oldUnits=retainedUnits(old),newUnits=retainedUnits(full);const degraded=[...oldUnits].some(value=>!newUnits.has(value));if(degraded)return{...previous.page,retainedIncomplete:true}}catch{}
  }
  await write(key,page,full.status==='not_found');return page;
 }).finally(()=>inflight.delete(key));inflight.set(key,p);return p}
 async function lookup(text,{refresh=false}={}){
  const deadline=now()+totalTimeout;
  if(typeof text!=='string'||!text.trim()||text.length>120||/[\u0000-\u001f\u007f]/.test(text))return{httpStatus:400,result:emptyResult(typeof text==='string'&&text.trim()?text:'invalid','unavailable','invalid_query')};
  const resolved=resolveQuery(text),key=cacheKey(resolved.fetchText),cached=await read(key),age=cached?now()-cached.savedAt:Infinity;
  async function convert(page,delivery,stale=false){const incomplete=page.retainedIncomplete;if(incomplete)delivery='cache';let targetResolved=resolved;const target=inflectionTarget(page.html,text);if(target){const targetKey=cacheKey(target.fetchText),targetCache=await read(targetKey);if(!refresh&&targetCache&&now()-targetCache.savedAt<ttl){page=targetCache.page;delivery='cache';targetResolved=target}else{try{page=await fetchShared(target.fetchText,targetKey,deadline);targetResolved=target}catch{if(targetCache&&now()-targetCache.savedAt<staleTtl){page=targetCache.page;delivery='cache';stale=true;targetResolved=target}}}}const result=parsePage({text,html:page.html,url:page.finalUrl||page.url,fetchedAt:page.fetchedAt,resolved:targetResolved});for(const entry of result.entries)entry.source.delivery=delivery;if(incomplete)result.notices.push({code:'incomplete_refresh',text:'在线更新内容不完整，正在显示此前缓存。',entry_id:null});if(stale)result.notices.push({code:'stale_cache',text:'在线补查暂不可用，正在显示已缓存内容。',entry_id:null});return validateResult(result)}
  if(!refresh&&cached&&age<(cached.negative?negativeTtl:ttl)){cacheHits++;try{return{httpStatus:200,result:await convert(cached.page,'cache')}}catch{pages.delete(key)}}
  try{const page=await fetchShared(resolved.fetchText,key,deadline);return{httpStatus:200,result:await convert(page,'online')}}catch(error){
   const e=error instanceof LookupError?error:new LookupError('upstream_parse',502);
   if(cached&&!cached.negative&&age<staleTtl){try{cacheHits++;return{httpStatus:200,result:await convert(cached.page,'cache',true),diagnostic:e.code}}catch{}}
   return{httpStatus:e.status,retryAfter:e.retryAfter,result:emptyResult(text,'unavailable',e.code)};
  }
 }
 return{lookup,health:()=>({ok:true,schema_version:1,adapter_version:ADAPTER,dataset:DATASET,active,queued:queue.length,upstream_requests:requests,cache_hits:cacheHits,cache_entries:pages.size})};
}
