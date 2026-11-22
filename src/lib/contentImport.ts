import { invoke } from '@tauri-apps/api/core';
import type { ExtractedDocument } from './documentTypes';
import type { WebpageResponse } from './contentExtract';
import type { YoutubeSource } from './sourceMedia';

async function fetchLink<T>(command: 'fetch_import_webpage' | 'fetch_import_youtube', url: string, signal: AbortSignal, operationId?: string): Promise<T> {
    if (signal.aborted) throw Error('material_cancelled');
    const job = crypto.randomUUID();
    const abort = () => { void invoke('cancel_import_webpage', { job }).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        return await invoke<T>(command, { job, url, ...(operationId ? { operationId } : {}) });
    } finally {
        signal.removeEventListener('abort', abort);
    }
}

export type YouTubeCaptions = { content: string; source: YoutubeSource; cover?: string | null; audio_unavailable?: boolean };

export function prepareYouTube(url: string, operationId: string, signal: AbortSignal) {
    return fetchLink<YouTubeCaptions>('fetch_import_youtube', url, signal, operationId);
}

export async function prepareContent(kind:'clipboard'|'webpage',value:string,signal:AbortSignal):Promise<ExtractedDocument>{
    if(signal.aborted)throw Error('material_cancelled');
    const response = kind === 'webpage' ? await fetchLink<WebpageResponse>('fetch_import_webpage', value, signal) : undefined;
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
