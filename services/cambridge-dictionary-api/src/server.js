import http from 'node:http';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createService} from './service.js';
import {resolveQuery} from './parse.js';
import {LookupError} from './fetch.js';
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3211);
let fetchPage;
if(process.env.CAMBRIDGE_REPLAY_DIR){
 const dir=path.resolve(process.env.CAMBRIDGE_REPLAY_DIR),pages=JSON.parse(await fs.readFile(path.join(dir,'pages.json'),'utf8'));
 fetchPage=async text=>{const item=pages.find(p=>p.text===resolveQuery(text).fetchText);if(!item)throw new LookupError('replay_missing',503);return{status:item.status,html:await fs.readFile(path.join(dir,item.file),'utf8'),url:item.url,finalUrl:item.final_url,contentType:item.content_type,fetchedAt:item.fetched_at}};
}
const setting=(name,fallback,min,max)=>Math.min(max,Math.max(min,Number(process.env[name])||fallback));
const cacheDir=process.env.CACHE_DIR||fileURLToPath(new URL('../.cache/',import.meta.url));
await fs.mkdir(cacheDir,{recursive:true});await fs.access(cacheDir,constants.W_OK);
const service=createService({fetchPage,totalTimeout:setting('TOTAL_TIMEOUT_MS',8000,1000,15000),upstreamTimeout:setting('UPSTREAM_TIMEOUT_MS',7000,100,14000),maxConcurrent:setting('MAX_CONCURRENT',4,1,8),cacheDir});
export function createHttpServer(){return http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let status=200,value,headers={};
 if(req.method==='GET'&&url.pathname==='/health')value={...service.health(),mode:fetchPage?'real_page_replay':'live',listening_host:host};
 else if(req.method==='GET'&&url.pathname==='/v1/lookup'){
  const allowed=[...url.searchParams.keys()].every(k=>['text','refresh'].includes(k));
  const result=await service.lookup(allowed?url.searchParams.get('text'):null,{refresh:url.searchParams.get('refresh')==='1'});status=result.httpStatus;value=result.result;if(result.retryAfter)headers['Retry-After']=String(result.retryAfter);
 }else{status=404;value={error:'route_not_found'}}
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));
 });}
const server=createHttpServer();server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;server.listen(port,host,()=>console.log(JSON.stringify({event:'ready',host,port,mode:fetchPage?'real_page_replay':'live',adapter:service.health().adapter_version})));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit(0)));
