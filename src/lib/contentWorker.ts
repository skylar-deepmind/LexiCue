import { extractClipboard, extractWebpage } from './contentExtract';
self.onmessage=async event=>{try{postMessage({result:await (event.data.kind==='clipboard'?extractClipboard(event.data.text):extractWebpage(event.data.response))});}catch(error){postMessage({error:error instanceof Error?error.message:'material_parse_failed'});}};
