import { extractDocumentBytes } from './documentExtract';
self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; name: string }>) => {
  try { self.postMessage({ result: await extractDocumentBytes(event.data.bytes, event.data.name) }); }
  catch (error) { const message = String(error); self.postMessage({ error: message.match(/material_[a-z_]+/)?.[0] ?? 'material_parse_failed', ...(import.meta.env.DEV ? { diagnostic: { name: (error as Error).name, message, stack: (error as Error).stack } } : {}) }); }
};
