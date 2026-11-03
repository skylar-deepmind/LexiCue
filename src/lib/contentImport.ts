import { invoke } from '@tauri-apps/api/core';
import type { ExtractedDocument } from './documentTypes';
import type { WebpageResponse } from './contentExtract';
export async function prepareContent(kind:'clipboard'|'webpage',value:string,signal:AbortSignal):Promise<ExtractedDocument>{
    if(signal.aborted)throw Error('material_cancelled');
    let response:WebpageResponse|undefined;
    if(kind==='webpage'){
        const job=crypto.randomUUID();const abort=()=>{void invoke('cancel_import_webpage',{job}).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
        try{response=await invoke<WebpageResponse>('fetch_import_webpage',{job,url:value});}finally{signal.removeEventListener('abort',abort);}
    }
    if(signal.aborted)throw Error('material_cancelled');
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./contentWorker.ts',import.meta.url),{type:'module'});
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();};
        const abort=()=>{cleanup();reject(Error('material_cancelled'));};
        const timer=setTimeout(()=>{cleanup();reject(Error('material_parse_timeout'));},30000);
        signal.addEventListener('abort',abort,{once:true});
        worker.onmessage=event=>{cleanup();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};
        worker.onerror=()=>{cleanup();reject(Error('material_parse_failed'));};
        worker.postMessage({kind,text:value,response});
    });
}
