import { fetch, ProxyAgent } from 'undici';
export const ORIGIN='https://dictionary.cambridge.org';
export const DATASET='english-chinese-simplified';
export class LookupError extends Error { constructor(code,status=503,retryAfter=null){super(code);this.code=code;this.status=status;this.retryAfter=retryAfter;} }
let dispatcher;
const proxy=process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy;
if(proxy)dispatcher=new ProxyAgent(proxy);
export function upstreamUrl(text){return `${ORIGIN}/dictionary/${DATASET}/${encodeURIComponent(text.trim().replace(/\s+/g,'-'))}`;}
export async function requestPage(text,{timeout=8000,maxBytes=2500000}={}){
  const url=upstreamUrl(text);const signal=AbortSignal.timeout(timeout);let next=url;
  try{
    for(let redirects=0;redirects<=3;redirects++){
      const response=await fetch(next,{signal,dispatcher,redirect:'manual',headers:{Accept:'text/html','User-Agent':'LexiCue-CambridgeAdapter/1.0'}});
      if([301,302,303,307,308].includes(response.status)){
        const to=new URL(response.headers.get('location'),next);await response.body?.cancel();
        if(to.origin!==ORIGIN || !to.pathname.startsWith('/dictionary/'))throw new LookupError('upstream_redirect',502);
        next=to.href;continue;
      }
      const declared=Number(response.headers.get('content-length')||0);if(declared>maxBytes){await response.body?.cancel();throw new LookupError('upstream_too_large',502)}
      const chunks=[];let size=0;
      for await(const chunk of response.body||[]){size+=chunk.length;if(size>maxBytes){throw new LookupError('upstream_too_large',502)}chunks.push(chunk)}
      return {url,finalUrl:next,status:response.status,contentType:response.headers.get('content-type')||'',retryAfter:response.headers.get('retry-after'),html:Buffer.concat(chunks).toString('utf8')};
    }
    throw new LookupError('upstream_redirect',502);
  }catch(error){if(error instanceof LookupError)throw error;throw new LookupError(signal.aborted?'upstream_timeout':'upstream_network',signal.aborted?504:503)}
}
