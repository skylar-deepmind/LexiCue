import { Channel, invoke } from '@tauri-apps/api/core';
import type { ExtractedDocument } from './documentTypes';
import type { WebpageResponse } from './contentExtract';
import type { YoutubeSource } from './sourceMedia';

type DownloadMessage = { part: 'page' | 'audio'; received: number; total: number | null } | { part: 'captions' | 'cover' };
type Progress = (fraction: number) => void;

async function fetchLink<T>(command: 'fetch_import_webpage' | 'fetch_import_youtube', url: string, signal: AbortSignal,
    progress: Progress, operationId?: string): Promise<T> {
    if (signal.aborted) throw Error('material_cancelled');
    const job = crypto.randomUUID();
    // YouTube work can overlap. Track the completed parts independently so a
    // late cover or a downloader retry cannot move the paper backwards.
    let captions = 0, cover = 0, audio = 0;
    const onProgress = new Channel<DownloadMessage>(message => {
        if (signal.aborted) return;
        if (message.part === 'captions') captions = .34;
        else if (message.part === 'cover') cover = .10;
        else if ('total' in message && message.total) {
            const ratio = Math.max(0, Math.min(1, message.received / message.total));
            if (message.part === 'page') { progress(.95 * ratio); return; }
            audio = Math.max(audio, .51 * ratio);
        }
        if (operationId) progress(captions + cover + audio);
    });
    const abort = () => { void invoke('cancel_import_webpage', { job }).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        return await invoke<T>(command, { job, url, onProgress, ...(operationId ? { operationId } : {}) });
    } finally {
        signal.removeEventListener('abort', abort);
        onProgress.onmessage = () => {};
    }
}

export type YouTubeCaptions = { content: string; source: YoutubeSource; cover?: string | null; audio_unavailable?: boolean };

export function prepareYouTube(url: string, operationId: string, signal: AbortSignal, progress: Progress) {
    return fetchLink<YouTubeCaptions>('fetch_import_youtube', url, signal, progress, operationId);
}

export async function prepareContent(kind:'clipboard'|'webpage',value:string,signal:AbortSignal,
    download: Progress, parsing: () => void, organize: Progress):Promise<ExtractedDocument>{
    if(signal.aborted)throw Error('material_cancelled');
    const response = kind === 'webpage' ? await fetchLink<WebpageResponse>('fetch_import_webpage', value, signal, download) : undefined;
    if(signal.aborted)throw Error('material_cancelled');
    parsing();
    return new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./contentWorker.ts',import.meta.url),{type:'module'});
        const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();};
        const abort=()=>{cleanup();reject(Error('material_cancelled'));};
        const timer=setTimeout(()=>{cleanup();reject(Error('material_parse_timeout'));},30000);
        signal.addEventListener('abort',abort,{once:true});
        worker.onmessage=event=>{
            if (typeof event.data.progress === 'number') { organize(event.data.progress); return; }
            cleanup();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);
        };
        worker.onerror=()=>{cleanup();reject(Error('material_parse_failed'));};
        worker.postMessage({kind,text:value,response});
    });
}
