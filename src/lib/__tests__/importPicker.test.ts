import { afterEach, expect, it, vi } from 'vitest';
import { materialPickerOptions, selectedMaterialName, pickedMaterialSource } from '../importPicker';
afterEach(()=>vi.unstubAllGlobals());
it('keeps desktop SRT filtering and permits Android providers with inconsistent MIME metadata',()=>{
  vi.stubGlobal('navigator',{userAgent:'Macintosh'});expect(materialPickerOptions()).toEqual({multiple:true,filters:[{name:'English SRT',extensions:['srt']}]});
  vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 (Linux; Android 16)'});expect(materialPickerOptions()).toEqual({multiple:true});
});
it('uses provider display names for opaque Android document IDs without changing the read URI',async()=>{
  const uri='content://com.android.providers.downloads.documents/document/msf%3A1000000288';
  const name=vi.fn(()=> 'flight one.srt');const read=vi.fn(async()=> 'actual file bytes');vi.stubGlobal('window',{LexiCueSystemUi:{documentDisplayName:name}});
  const source=pickedMaterialSource(uri,read);expect(source.name).toBe('flight one.srt');expect(await source.read()).toBe('actual file bytes');expect(read).toHaveBeenCalledWith(uri);expect(name).toHaveBeenCalledWith(uri);
});
it('does not disguise non-SRT selections as valid subtitles',()=>{
  vi.stubGlobal('window',{LexiCueSystemUi:{documentDisplayName:()=> 'notes.txt'}});expect(selectedMaterialName('content://provider/document/1')).toBe('notes.txt');
});
it('keeps a metadata failure local to the file and never reads or fabricates a successful source',async()=>{
  vi.stubGlobal('window',{LexiCueSystemUi:{documentDisplayName:()=>null}});const read=vi.fn();
  await expect(pickedMaterialSource('content://provider/document/1',read).read()).rejects.toThrow('material_read_failed');expect(read).not.toHaveBeenCalled();expect(()=>selectedMaterialName('content://provider/document/1')).toThrow();
});
it('keeps literal desktop names and decodes file URIs through the existing parser',()=>{
  expect(selectedMaterialName('/tmp/100%20.srt')).toBe('100%20.srt');expect(selectedMaterialName('file:///tmp/a%20b.srt')).toBe('a b.srt');
});
