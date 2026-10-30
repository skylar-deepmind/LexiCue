import { describe, it, expect } from 'vitest';
import { documentLocationLabel } from '../documentTypes';
import { buildDocument, decodeDocumentText, documentDigest, rangeFromDocument } from '../documentCore';
import { markdownDocument, plainDocument, htmlDocumentBlocks } from '../documentMarkup';
import { srtDocument, vttDocument } from '../documentSubtitles';
import { boundedDocumentZip } from '../documentZip';
import { epubDocument, docxDocument } from '../documentOffice';
import { zipSync, strToU8, Zip, ZipDeflate } from 'fflate';
const hash = 'a'.repeat(64);
const epub = (resources: Record<string, string | null>) => zipSync(Object.fromEntries(Object.entries({
  mimetype:'application/epub+zip',
  'META-INF/container.xml':'<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  'OPS/book.opf':'<package><manifest><item id="two" href="z.xhtml" media-type="application/xhtml+xml"/><item id="one" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>',
  'OPS/z.xhtml':'<html><body><h1>The first chapter</h1><p>We are not alone. The price is 12.50.</p></body></html>',
  'OPS/a.xhtml':'<html><body><h1>The second chapter</h1><p>This is the end.</p></body></html>', ...resources,
}).filter(([, value])=>value!==null).map(([name, value])=>[name,strToU8(value!)])));

describe('local document extraction contracts',()=>{
 it('displays actual subtitle hours without wrapping after 24 hours',()=>{ expect(documentLocationLabel({section_id:'cues',paragraph:1,cue_id:'late',start_ms:108000001})).toBe('30:00:00.001 · late'); });
 it('decodes BOM UTF16 and rejects binary/invalid UTF8',()=>{
   expect(decodeDocumentText(new Uint8Array([255,254,65,0,66,0]))).toBe('AB');
   expect(()=>decodeDocumentText(new Uint8Array([0,0,0]))).toThrow('material_invalid_encoding');
   expect(()=>decodeDocumentText(new Uint8Array([0xff,0x80]))).toThrow('material_invalid_encoding');
 });
 it('preserves punctuation, brackets, mixed script and UTF16 exact mapping',async()=>{
   const result=await buildDocument(plainDocument('“We are not [alone],” she said. The price is 12.50!\n\nNASA 🚀 and 北京 are names.\n这是一句说明。'),'txt','test.txt',hash);
   expect(result.segments.map(s=>s.en_text).join(' ')).toContain('not [alone]');
   expect(result.segments.map(s=>s.en_text).join(' ')).toContain('12.50!');
   expect(result.segments.at(-1)?.en_text).toContain('北京');
   expect(result.segments.at(-1)?.zh_text).toBe('这是一句说明。');
   for(const block of result.document.blocks)expect(result.content.slice(block.start_utf16,block.end_utf16)).toBe(block.text);
 });
 it('extracts markdown syntax, keeps code preview-only and does not execute raw HTML',async()=>{
   const raw=markdownDocument('# Start\n\nA [visible link](https://example.com) and `x<y` are here.\n\n```js\nwindow.evil = true;\n```\n\n| Key | Value |\n|---|---|\n| a | 12 |\n\n<div><p>The final line.</p><script>steal()</script><img src="https://example.com/tracker"></div>');
   const result=await buildDocument(raw,'md','test.md',hash);
   expect(result.content).toContain('visible link');expect(result.content).not.toContain('https://example.com');
   expect(result.content).toContain('window.evil');expect(result.segments.some(s=>s.en_text.includes('window.evil'))).toBe(false);
   expect(result.content).toContain('Key | Value');expect(result.content).not.toContain('steal');
 });
 it('keeps separate-time repeats and actual cue ids/times; parses NOTE/STYLE/REGION',async()=>{
   const input='WEBVTT\n\nNOTE ignore this\n\nSTYLE\n::cue {color: red}\n\nREGION\nid:fred\n\nintro\n00:00.000 --> 00:02.000\n<v Alice>Hello &amp; welcome.\n你好。\n\nagain\n00:03.000 --> 00:05.000\nHello &amp; welcome.';
   const result=await buildDocument(vttDocument(input),'vtt','sample.vtt',hash);
   expect(result.segments).toHaveLength(2);expect(result.segments[0].en_text).toBe('Hello & welcome.');
   expect(result.document.blocks[0].locations[0].cue_id).toBe('intro');expect(result.segments[1].start_time).toBe('00:00:03.000');
 });
 it('rejects malformed SRT intervals and preserves brackets',async()=>{
   expect(()=>srtDocument('1\n00:00:02,000 --> 00:00:01,000\nHello.')).toThrow();
   const result=await buildDocument(srtDocument('1\n00:00:01,000 --> 00:00:02,000\n[Do not remove me.]'),'srt','test.srt',hash);
   expect(result.segments[0].en_text).toBe('[Do not remove me.]');
 });
 it('uses EPUB spine order and immutable chapter identities',async()=>{
   const raw=await epubDocument(epub({}));const full=await buildDocument(raw,'epub','book.epub',hash);
   expect(full.document.sections[0].spine_id).toBe('two');expect(full.content.indexOf('first chapter')).toBeLessThan(full.content.indexOf('second chapter'));
   const selected=await rangeFromDocument(full,{kind:'chapters',section_ids:['spine-2']});
   expect(selected.content).not.toContain('first chapter');expect(full.content).toContain('first chapter');expect(selected.document.identity).not.toBe(full.document.identity);
   expect(selected.document.blocks.flatMap(b=>b.segment_indices)).toEqual(selected.segments.map(s=>s.index));
   const all=await rangeFromDocument(full,{kind:'chapters',section_ids:full.document.sections.map(s=>s.id).reverse()});expect(all.document.identity).toBe(full.document.identity);expect(all.document.selection).toEqual({kind:'all'});
 });
 it('rejects protected body, reports missing spine, and allows font obfuscation',async()=>{
   const encrypted='<encryption><EncryptedData><EncryptionMethod Algorithm="http://example.com/drm"/><CipherData><CipherReference URI="OPS/z.xhtml"/></CipherData></EncryptedData></encryption>';
   await expect(epubDocument(epub({'META-INF/encryption.xml':encrypted}))).rejects.toThrow('material_protected_document');
   const font=encrypted.replace('http://example.com/drm','http://www.idpf.org/2008/embedding').replace('OPS/z.xhtml','OPS/font.otf');
   expect((await epubDocument(epub({'META-INF/encryption.xml':font}))).partial).toBe(false);
   const missing=await epubDocument(epub({'OPS/a.xhtml':null}));expect(missing.partial).toBe(true);expect(missing.warnings.join(' ')).toContain('Missing spine resource 2');
 });
 it('blocks traversal and bounded zip expansions',()=>{
   expect(()=>boundedDocumentZip(zipSync({'../escape.xml':strToU8('<x/>')}))).toThrow('material_unsafe_archive');
   expect(()=>boundedDocumentZip(zipSync({'large.xml':new Uint8Array(17*1024*1024)}))).toThrow('material_archive_limit');
 });
 it('preserves paragraph boundaries inside table cells and distinguishes horizontal/vertical merges',()=>{
   const horizontal=htmlDocumentBlocks('<table><tr><td colspan="2"><p>This is not</p><p>joined.</p></td></tr></table>','test','docx');
   expect(horizontal.blocks[0].text).toBe('This is not\njoined.');expect(horizontal.partial).toBe(false);expect(horizontal.warnings.length).toBe(1);
   expect(htmlDocumentBlocks('<table><tr><td rowspan="2">Shared</td><td>One</td></tr><tr><td>Two</td></tr></table>','test','docx').partial).toBe(true);
 });
 it('retains same-resource EPUB body after publisher header and offers each heading as a section',async()=>{
   const raw=await epubDocument(epub({'OPS/z.xhtml':'<html><body><header id="pg-header"><p>Publisher boilerplate.</p></header><h1>First chapter</h1><p>The first story is here.</p><h2>Second chapter</h2><p>The next story is here.</p><footer id="pg-footer">Publisher license.</footer></body></html>'}));
   const result=await buildDocument(raw,'epub','test.epub',hash);
   expect(result.content).toContain('The first story');expect(result.content).toContain('The next story');expect(result.content).not.toContain('Publisher');
   expect(result.document.sections.some(s=>s.title==='Second chapter')).toBe(true);
 });
 it('DOCX excludes deleted revision text and retains inserted visible text',async()=>{
   const data=zipSync({
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>We do not </w:t></w:r><w:del><w:r><w:delText>keep deleted words</w:delText></w:r></w:del><w:ins><w:r><w:t>lose visible words.</w:t></w:r></w:ins></w:p></w:body></w:document>'),
   });
   const result=await buildDocument(await docxDocument(data),'docx','revision.docx',hash);expect(result.content).toContain('We do not lose visible words.');expect(result.content).not.toContain('deleted words');
 });
 it('roll-up dedup stays inside overlapping intervals; truncated ZIP is rejected',async()=>{
   const input='WEBVTT\n\n00:00.000 --> 00:03.000\nWe do not\n\n00:02.000 --> 00:04.000\nWe do not forget.\n\n00:05.000 --> 00:07.000\nWe do not forget.';
   const raw=vttDocument(input);expect(raw.blocks.map(b=>b.text)).toEqual(['We do not','forget.','We do not forget.']);
   const zipped=epub({});expect(()=>boundedDocumentZip(zipped.slice(0,-10))).toThrow('material_invalid_document');
 });
 it('checks actual ZIP output despite false sizes, and supports legal small data-descriptor streams',()=>{
   const forged=zipSync({'large.xml':new Uint8Array(17*1024*1024)});
   const view=new DataView(forged.buffer);view.setUint32(22,0,true);
   for(let i=30;i<forged.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,0,true);break}
   expect(()=>boundedDocumentZip(forged)).toThrow('material_archive_limit');
   const chunks:Uint8Array[]=[];const archive=new Zip((error,data)=>{if(error)throw error;chunks.push(data)});
   const entry=new ZipDeflate('small.xml');archive.add(entry);entry.push(strToU8('<root>Actual bounded text.</root>'),true);archive.end();
   const stream=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){stream.set(chunk,offset);offset+=chunk.length}
   expect(new TextDecoder().decode(boundedDocumentZip(stream).get('small.xml'))).toBe('<root>Actual bounded text.</root>');
 });
 it('rejects a renamed non-DOCX zip',async()=>{
   await expect(docxDocument(zipSync({'hello.txt':strToU8('Hello.')}))).rejects.toThrow('material_invalid_document');
 });
 it('rejects a non-English body without rejecting English mixed-script quotations',async()=>{
   await expect(buildDocument(plainDocument('这是中文材料。'),'txt','cn.txt',hash)).rejects.toThrow('material_english_only');
   expect(await documentDigest(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 });
});
