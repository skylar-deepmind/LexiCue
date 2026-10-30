import mammoth from 'mammoth/mammoth.browser.js';
import { boundedDocumentZip, xmlDocument, arrayOf, resolveArchivePath } from './documentZip';
import { htmlDocumentBlocks } from './documentMarkup';
import { decodeDocumentText, type RawDocument } from './documentCore';

export async function docxDocument(bytes: Uint8Array): Promise<RawDocument> {
  const files = boundedDocumentZip(bytes);
  if (!files.has('[Content_Types].xml') || !files.has('word/document.xml')) throw new Error('material_invalid_document');
  const body = decodeDocumentText(files.get('word/document.xml')!);
  xmlDocument(files.get('word/document.xml'));
  const result = await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(bytes).buffer }, {
    externalFileAccess: false, includeEmbeddedStyleMap: false,
    styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh"],
    convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
  });
  const extracted = htmlDocumentBlocks(result.value, 'document', 'docx');
  const warnings = [...extracted.warnings];
  let partial = extracted.partial;
  if (/<(?:\w+:)?txbxContent\b/.test(body)) { partial = true; warnings.push('文本框按文档锚点顺序保留，视觉排版顺序需在预览中核对。 / Text boxes follow anchor order; verify layout order.'); }
  if (/<(?:\w+:)?(?:footnoteReference|endnoteReference)\b/.test(body)) warnings.push('脚注和尾注在正文后作为附属列表保留。 / Footnotes and endnotes follow the body as ancillary lists.');
  if (/<(?:\w+:)?del\b/.test(body)) warnings.push('已删除的修订文字被排除；采用最终可见正文。 / Deleted revision text is excluded.');
  if (result.messages.length) { warnings.push('此 DOCX 含未映射的样式或元素，请核对预览。 / This DOCX contains unmapped styles or elements.'); if (result.messages.some(message => message.type === 'error' || !/Unrecognised (?:paragraph|run) style/i.test(message.message))) partial = true; }
  if (/<(?:\w+:)?(?:oMath|oMathPara|altChunk)\b/.test(body)) { partial = true; warnings.push('公式或嵌入文档无法保证完整提取。 / Equations or embedded documents may be incomplete.'); }
  const sections: RawDocument['sections'] = [{ id: 'document', title: extracted.title || 'Document' }];
  let current = 'document', paragraph = 0;
  const blocks = extracted.blocks.map((block, index) => {
    if (block.kind === 'heading' && index > 0) { current = `heading-${sections.length + 1}`; sections.push({ id: current, title: block.text }); paragraph = 0; }
    return { ...block, section_id: current, locations: block.locations.map(location => ({ ...location, section_id: current, paragraph: ++paragraph })) };
  });
  return { sections, blocks, warnings, partial };
}
export async function epubDocument(bytes: Uint8Array): Promise<RawDocument> {
  const files = boundedDocumentZip(bytes);
  if (decodeDocumentText(files.get('mimetype') ?? new Uint8Array()).trim() !== 'application/epub+zip') throw new Error('material_invalid_document');
  const container = xmlDocument(files.get('META-INF/container.xml'));
  const roots = arrayOf<any>(container.container?.rootfiles?.rootfile);
  const packagePath = roots.find(root => root['@_media-type'] === 'application/oebps-package+xml')?.['@_full-path'];
  if (typeof packagePath !== 'string' || !files.has(packagePath)) throw new Error('material_invalid_document');
  const packageDoc = xmlDocument(files.get(packagePath)).package;
  if (!packageDoc) throw new Error('material_invalid_document');
  const metadata = packageDoc.metadata ?? {};
  const metas = arrayOf<any>(metadata.meta);
  if (metas.some(meta => meta['@_property'] === 'rendition:layout' && (meta['#text'] ?? meta) === 'pre-paginated' || meta['@_name'] === 'fixed-layout' && meta['@_content'] === 'true')) throw new Error('material_fixed_layout');
  const items = arrayOf<any>(packageDoc.manifest?.item), spine = arrayOf<any>(packageDoc.spine?.itemref);
  if (!items.length || !spine.length) throw new Error('material_invalid_document');
  const itemMap = new Map(items.map(item => [item['@_id'], item]));
  const protectedResources = new Set<string>();
  if (files.has('META-INF/encryption.xml')) {
    const encryption = xmlDocument(files.get('META-INF/encryption.xml'));
    for (const encrypted of arrayOf<any>(encryption.encryption?.EncryptedData)) {
      const algorithm = encrypted.EncryptionMethod?.['@_Algorithm'];
      if (algorithm === 'http://www.idpf.org/2008/embedding' || algorithm === 'http://ns.adobe.com/pdf/enc#RC') continue;
      const target = encrypted.CipherData?.CipherReference?.['@_URI'];
      if (typeof target === 'string') protectedResources.add(resolveArchivePath('root', target));
      else throw new Error('material_protected_document');
    }
  }
  const sections: RawDocument['sections'] = [], blocks: RawDocument['blocks'] = [], warnings: string[] = [];
  let partial = false;
  for (const [index, reference] of spine.entries()) {
    if (reference['@_linear'] === 'no') continue;
    const item = itemMap.get(reference['@_idref']);
    const id = `spine-${index + 1}`;
    if (!item || typeof item['@_href'] !== 'string') { partial = true; warnings.push(`章节 ${index + 1} 缺失正文资源。 / Missing spine resource ${index + 1}.`); sections.push({ id, title: `Chapter ${index + 1}`, spine_id: String(reference['@_idref'] ?? id) }); continue; }
    if (/\b(?:nav|cover-image)\b/.test(item['@_properties'] ?? '')) continue;
    if ((item['@_properties'] ?? '').includes('rendition:layout-pre-paginated') || (reference['@_properties'] ?? '').includes('rendition:layout-pre-paginated')) throw new Error('material_fixed_layout');
    const path = resolveArchivePath(packagePath, item['@_href']);
    if (protectedResources.has(path)) throw new Error('material_protected_document');
    if (!['application/xhtml+xml', 'text/html'].includes(item['@_media-type'])) { partial = true; warnings.push(`章节 ${index + 1} 不是可重排文字。 / Spine item ${index + 1} is not reflowable text.`); sections.push({ id, title: `Chapter ${index + 1}`, spine_id: String(item['@_id']) }); continue; }
    const resource = files.get(path);
    if (!resource) { partial = true; warnings.push(`章节 ${index + 1} 缺失正文资源。 / Missing spine resource ${index + 1}.`); sections.push({ id, title: `Chapter ${index + 1}`, spine_id: String(item['@_id']) }); continue; }
    const html = decodeDocumentText(resource);
    const extracted = htmlDocumentBlocks(html, id, 'epub');
    const spine_id = String(item['@_id']);
    let currentId = id, chapter = 0, paragraph = 0;
    let currentTitle = extracted.title || `Chapter ${index + 1}`;
    let hasBlocks = false;
    for (const block of extracted.blocks) {
      if (block.kind === 'heading' && hasBlocks) { currentId = `${id}-heading-${++chapter}`; currentTitle = block.text; paragraph = 0; hasBlocks = false; }
      if (!hasBlocks) { sections.push({ id: currentId, title: currentTitle, spine_id }); hasBlocks = true; }
      blocks.push({ ...block, section_id: currentId, locations: block.locations.map(location => ({ ...location, section_id: currentId, paragraph: ++paragraph, spine_id })) });
    }
    warnings.push(...extracted.warnings); partial ||= extracted.partial;
  }
  if (!blocks.length) throw new Error(partial ? 'material_missing_resource' : 'material_empty');
  return { sections, blocks, warnings, partial };
}
