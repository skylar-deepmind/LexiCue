import {beforeEach, expect, it, vi} from 'vitest';
const mocks=vi.hoisted(()=>({open:vi.fn()}));
vi.mock('@tauri-apps/plugin-fs',()=>({open:mocks.open}));
vi.mock('../documentTypes',()=>({DOCUMENT_LIMITS:{binaryBytes:4}}));
import {readDocumentFile} from '../readDocumentFile';
beforeEach(()=>vi.clearAllMocks());
it('reads exact bytes from an opaque URI and always closes its handle',async()=>{
 let remaining=[1,2,3,4];const close=vi.fn();mocks.open.mockResolvedValue({read:vi.fn(async(buffer:Uint8Array)=>{if(!remaining.length)return null;const chunk=remaining.slice(0,2);remaining=remaining.slice(2);buffer.set(chunk);return chunk.length;}),close});
 expect([...await readDocumentFile('content://provider/opaque')]).toEqual([1,2,3,4]);
 expect(mocks.open).toHaveBeenCalledWith('content://provider/opaque',{read:true});expect(close).toHaveBeenCalledTimes(1);
});
it('stops at the capacity boundary without reading the rest of an oversized file',async()=>{
 const read=vi.fn(async(buffer:Uint8Array)=>{buffer.fill(65);return buffer.length;});const close=vi.fn();mocks.open.mockResolvedValue({read,close});
 await expect(readDocumentFile('/qa/huge.pdf')).rejects.toThrow('material_too_large');expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0].length).toBe(5);expect(close).toHaveBeenCalledTimes(1);
});
it('cancels a late native read and releases the handle',async()=>{
 const controller=new AbortController();const close=vi.fn();mocks.open.mockResolvedValue({read:vi.fn(async()=>{controller.abort();return 2;}),close});
 await expect(readDocumentFile('/qa/file',controller.signal)).rejects.toThrow('material_cancelled');expect(close).toHaveBeenCalledTimes(1);
});
