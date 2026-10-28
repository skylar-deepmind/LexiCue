// Low-frequency evidence collection. Stops on access control/rate limit; never solves challenges.
import { requestPage } from '../src/fetch.js';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const dir = process.argv[2] || '../../docs/implementation/evidence/cambridge-online-v1/service';
const words = process.argv.slice(3);
await fs.mkdir(dir,{recursive:true});
let manifest=[];try{manifest=JSON.parse(await fs.readFile(`${dir}/pages.json`,'utf8'))}catch{}
for(const text of words){
  if(manifest.some(v=>v.text===text && v.status===200))continue;
  let r;try{r=await requestPage(text)}catch(e){r={status:0,error:e.code||e.message,url:null,html:''}};
  const name=crypto.createHash('sha256').update(text).digest('hex').slice(0,16);
  const file=`${name}.html`;
  await fs.writeFile(`${dir}/${file}`,r.html||'');
  const item={text,file,url:r.url,final_url:r.finalUrl||r.url,fetched_at:new Date().toISOString(),status:r.status,content_type:r.contentType,sha256:crypto.createHash('sha256').update(r.html||'').digest('hex'),error:r.error||null};
  manifest.push(item);await fs.writeFile(`${dir}/pages.json`,JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(item));
  if([403,429].includes(r.status))break;
  await new Promise(r=>setTimeout(r,1200));
}
