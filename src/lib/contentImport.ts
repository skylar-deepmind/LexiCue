import { Channel, invoke } from '@tauri-apps/api/core';
import type { ExtractedDocument } from './documentTypes';
import type { WebpageResponse } from './contentExtract';
import type { YoutubeSource } from './sourceMedia';

type DownloadMessage = { part: 'page' | 'audio'; received: number; total: number | null }
    | { part: 'caption_search' | 'captions' | 'audio_started' };
type Progress = (fraction: number) => void;
export type YouTubeImportProgress = { phase: 'captions' | 'media' } | { phase: 'audio'; fraction?: number };

const fraction = (received: number, total: number) => Math.max(0, Math.min(1, received / total));

async function fetchLink<T>(command: 'fetch_import_webpage' | 'fetch_import_youtube', url: string, signal: AbortSignal,
    progress: (message: DownloadMessage) => void, operationId?: string): Promise<T> {
    if (signal.aborted) throw Error('material_cancelled');
    const job = crypto.randomUUID();
    const onProgress = new Channel<DownloadMessage>(message => {
        if (!signal.aborted) progress(message);
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

export function prepareYouTube(url: string, operationId: string, signal: AbortSignal, progress: (value: YouTubeImportProgress) => void) {
    let received = -1;
    return fetchLink<YouTubeCaptions>('fetch_import_youtube', url, signal, message => {
        if (message.part === 'caption_search') progress({ phase: 'captions' });
        else if (message.part === 'captions') progress({ phase: 'media' });
        else if (message.part === 'audio_started') progress({ phase: 'audio' });
        else if (message.part === 'audio' && message.total) {
            const next = fraction(message.received, message.total);
            // A native download retry can restart the byte counter.
            if (next <= received) return;
            received = next;
            progress({ phase: 'audio', fraction: next });
        }
    }, operationId);
}

export async function prepareContent(kind:'clipboard'|'webpage',value:string,signal:AbortSignal,
    download: Progress, parsing: () => void, organize: Progress):Promise<ExtractedDocument>{
    if(signal.aborted)throw Error('material_cancelled');
    const response = kind === 'webpage' ? await fetchLink<WebpageResponse>('fetch_import_webpage', value, signal, message => {
        if (message.part === 'page' && message.total) download(.95 * fraction(message.received, message.total));
    }) : undefined;
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
