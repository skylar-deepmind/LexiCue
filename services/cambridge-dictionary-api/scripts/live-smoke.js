import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {cacheKey} from '../src/service.js';
import {resolveQuery} from '../src/parse.js';
const origin=process.env.CAMBRIDGE_TEST_URL||'http://127.0.0.1:3211';
const dir=process.argv[2]||'../../docs/implementation/evidence/cambridge-online-v1/service';
await fs.mkdir(dir,{recursive:true});const before=await (await fetch(origin+'/health')).json(),results=[];
for(const text of ['doomscrolling','record','US','look it up','cost an arm and a leg','took','lexicuezzqnotaword']){
 const url=new URL('/v1/lookup',origin);url.searchParams.set('text',text);const started=new Date().toISOString(),r=await fetch(url),value=await r.json(),file='live-'+crypto.createHash('sha256').update(text).digest('hex').slice(0,16)+'.json';
 await fs.writeFile(path.join(dir,file),JSON.stringify(value,null,2));
 const item={text,requested_at:started,http_status:r.status,status:value.status,delivery:value.entries?.[0]?.source.delivery||null,result_file:file,entries:value.entries?.map(e=>({headword:e.headword,dataset:e.source.dataset,retrieved_at:e.source.retrieved_at,groups:e.groups.length,senses:e.groups.reduce((n,g)=>n+g.senses.length,0)}))};results.push(item);console.log(JSON.stringify(item));
 const fetchText=resolveQuery(text).fetchText;
 try{const cached=JSON.parse(await fs.readFile(new URL(`../.cache/${cacheKey(fetchText)}.json`,import.meta.url),'utf8')),htmlFile='live-source-'+cacheKey(fetchText).slice(0,16)+'.html';await fs.writeFile(path.join(dir,htmlFile),cached.page.html);item.source={file:htmlFile,url:cached.page.finalUrl||cached.page.url,fetched_at:cached.page.fetchedAt,sha256:crypto.createHash('sha256').update(cached.page.html).digest('hex')}}catch{}
 await new Promise(r=>setTimeout(r,1200));
}
const after=await (await fetch(origin+'/health')).json();await fs.writeFile(path.join(dir,'live-api-smoke.json'),JSON.stringify({before,results,after},null,2));
