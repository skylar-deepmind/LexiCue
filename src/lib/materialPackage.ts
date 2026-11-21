import { DOCUMENT_LIMITS } from './documentTypes';
import type { PackageMember } from './materialPackageContents';

export function readMaterialPackage(bytes: Uint8Array, signal: AbortSignal): Promise<PackageMember[]> {
  if (signal.aborted) return Promise.reject(new Error('material_cancelled'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./materialPackageWorker.ts', import.meta.url), { type: 'module' });
    const close = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => { close(); reject(new Error('material_cancelled')); };
    const timer = setTimeout(() => { close(); reject(new Error('material_parse_timeout')); }, DOCUMENT_LIMITS.timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ members?: PackageMember[]; error?: string }>) => {
      close();
      if (data.members) resolve(data.members);
      else reject(new Error(data.error ?? 'material_invalid_document'));
    };
    worker.onerror = () => { close(); reject(new Error('material_invalid_document')); };
    const owned = new Uint8Array(bytes);
    worker.postMessage(owned, [owned.buffer]);
  });
}

export async function materialPackageCover(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy]);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('material_invalid_cover');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/jpeg', 0.82);
    if (!result.startsWith('data:image/jpeg;base64,') || result.length > 350_000)
      throw new Error('material_invalid_cover');
    return result;
  } finally { bitmap.close(); }
}
