import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { DOCUMENT_LIMITS } from './documentTypes';
import type { RawDocument, RawDocumentBlock } from './documentCore';
import { joinPdfLines } from './documentCore';

const inNode = !!(globalThis as any).process?.versions?.node;
if (!inNode) pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
interface PdfItem { str: string; x: number; y: number; width: number; height: number }
interface PdfLine { text: string; x: number; y: number; width: number; height: number; column: number }
interface PdfPage { page: number; width: number; height: number; lines: PdfLine[]; complex: boolean }
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 12; };
const ligatures = (text: string) => text.replace(/[ﬀﬁﬂﬃﬄ]/g, char => ({ 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl' })[char]!);
function textLine(items: PdfItem[], column: number): PdfLine {
  items.sort((a, b) => a.x - b.x);
  let text = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i], previous = items[i - 1];
    if (previous && text && !/\s$/.test(text) && !/^\s|^[,.;:!?)}\]]/.test(item.str) && item.x - (previous.x + previous.width) > Math.max(1, item.height * .12)) text += ' ';
    text += item.str;
  }
  const first = items[0], right = Math.max(...items.map(item => item.x + item.width));
  return { text: ligatures(text).replace(/\u00a0/g, ' ').trim(), x: first.x, y: median(items.map(v => v.y)), width: right - first.x, height: median(items.map(v => v.height)), column };
}
function pageLines(items: PdfItem[], page: number, width: number, height: number): PdfPage {
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfItem[][] = [];
  for (const item of items) {
    let row = rows.at(-1);
    if (!row || Math.abs(row[0].y - item.y) > Math.max(2, item.height * .3)) { row = []; rows.push(row); }
    row.push(item);
  }
  const starts: number[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      if (row[i].x - (row[i - 1].x + row[i - 1].width) <= Math.max(30, row[i].height * 3) || row[i].x <= width * .38 || row[i].x >= width * .7) continue;
      const left = row.slice(0, i).map(v => v.str).join(' '), right = row.slice(i).map(v => v.str).join(' ');
      if (left.split(/\s+/).length >= 3 && right.split(/\s+/).length >= 3) starts.push(row[i].x);
    }
  }
  const rightStarts = items.filter(item => item.x > width * .38 && item.x < width * .7 && item.width < width * .55 && item.str.trim().length >= 4 && /[A-Za-z]/.test(item.str));
  const clusters = new Map<number, PdfItem[]>();
  for (const item of rightStarts) { const key = Math.round(item.x / 8); if (!clusters.has(key)) clusters.set(key, []); clusters.get(key)!.push(item); }
  const alignedRight = [...clusters.values()].filter(group => group.length >= 3).sort((a, b) => b.length - a.length).find(group => {
    const x = median(group.map(item => item.x)), top = Math.max(...group.map(item => item.y)), bottom = Math.min(...group.map(item => item.y));
    return items.some(item => item.x < x - 40 && item.x + item.width < x && item.y >= bottom && item.y <= top);
  });
  const rightOrigin = alignedRight ? median(alignedRight.map(item => item.x)) : null;
  const boundary = rightOrigin !== null ? Math.min(rightOrigin, ...starts.filter(x => x >= rightOrigin - 60)) - 8 : starts.length >= Math.max(3, rows.length * .12) ? median(starts) - 8 : null;
  const lines: PdfLine[] = [];
  let complex = false;
  for (const row of rows) {
    if (boundary === null || row.some(v => v.x < boundary && v.x + v.width > boundary + 12)) { lines.push(textLine(row, 0)); continue; }
    const left = row.filter(v => v.x < boundary), right = row.filter(v => v.x >= boundary);
    if (left.length) lines.push(textLine(left, 1));
    if (right.length) lines.push(textLine(right, 2));
  }
  // Three or more strong fragments on multiple rows are outside the ordinary two-column policy.
  const fragmented = rows.filter(row => row.filter((item, i) => i > 0 && item.x - (row[i - 1].x + row[i - 1].width) > 45).length >= 2).length;
  if (fragmented >= 2) complex = true;
  if (boundary !== null) {
    const bodyTop = Math.max(...lines.filter(v => v.column === 2).map(v => v.y));
    const bodyBottom = Math.min(...lines.filter(v => v.column === 2).map(v => v.y));
    lines.sort((a, b) => {
      const band = (v: PdfLine) => v.y > bodyTop + 3 ? 0 : v.y < bodyBottom - 3 ? 3 : v.column || 0;
      return band(a) - band(b) || b.y - a.y || a.x - b.x;
    });
    if (lines.some(v => !v.column && v.y < bodyTop - 3 && v.y > bodyBottom + 3)) complex = true;
    for (const line of lines) if (line.y > bodyTop + 3 || line.y < bodyBottom - 3) line.column = 0;
  }
  return { page, width, height, lines: lines.filter(line => line.text), complex };
}
type Margin = 'top' | 'bottom';

function marginOf(line: PdfLine, page: PdfPage): Margin | null {
  if (line.y > page.height * .88) return 'top';
  if (line.y < page.height * .12) return 'bottom';
  return null;
}
function marginKey(line: PdfLine, margin: Margin) {
  return margin + ':' + line.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}
function marginLines(page: PdfPage) {
  const byHeight = [...page.lines].sort((a, b) => b.y - a.y);
  const fontSize = median(byHeight.map(line => line.height));
  return byHeight.flatMap((line, i) => {
    const margin = marginOf(line, page);
    if (!margin || line.height > fontSize * 1.2) return [];
    const inward = byHeight[margin === 'top' ? i + 1 : i - 1];
    const isolated = inward && Math.abs(inward.y - line.y) > fontSize * 2.2;
    const extreme = line.y > page.height * .95 || line.y < page.height * .05;
    return isolated || line.height < fontSize * .9 || extreme ? [{ line, margin }] : [];
  });
}
function repeatedMargins(pages: PdfPage[]) {
  const occurrences = new Map<string, { page: number; y: number }[]>();
  const repeated = new Set<string>();
  for (const page of pages) for (const { line, margin } of marginLines(page)) {
    if (line.text.length > 140) continue;
    const key = marginKey(line, margin);
    if (repeated.has(key)) continue;
    // Quantize positions so identical text fragments on one page cannot
    // inflate the comparison work. Each key covers only the edge bands.
    const y = Math.round(line.y / page.height * 200) / 200;
    const group = (occurrences.get(key) ?? []).filter(entry => entry.page >= page.page - 2);
    if (group.some(entry => entry.page < page.page && Math.abs(entry.y - y) <= .025)) repeated.add(key);
    if (!group.some(entry => entry.page === page.page && entry.y === y)) group.push({ page: page.page, y });
    occurrences.set(key, group);
  }
  return repeated;
}
function paragraphs(page: PdfPage, repeated: Set<string>) {
  const furniture = new Set(marginLines(page).filter(({ line, margin }) => {
    const pageNumber = /^(?:page\s+)?(?:[-–—]\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?(?:\s*[-–—])?$/i.test(line.text);
    const navigationFooter = margin === 'bottom' && /(?:https?:\/\/|www\.)/i.test(line.text) &&
      (/^(?:www\.\S+|https?:\/\/\S+)$/.test(line.text) || /^(?:find|visit|learn more)\b/i.test(line.text));
    return pageNumber || navigationFooter || repeated.has(marginKey(line, margin));
  }).map(({ line }) => line));
  const lines = page.lines.filter(line => !furniture.has(line));
  const typical = median(lines.map(line => line.height));
  const section_id = `page-${page.page}`, blocks: RawDocumentBlock[] = [];
  const listMarker = /^(?:[•●▪]|[-–—]\s|\(?\d{1,3}[.)]\s)/;
  let pending: { first: PdfLine; last: PdfLine; text: string; kind: RawDocumentBlock['kind'] } | undefined;
  const flush = () => {
    if (!pending) return;
    blocks.push({ kind: pending.kind, text: pending.text, section_id, locations: [{ section_id, paragraph: blocks.length + 1, page: page.page }] });
    pending = undefined;
  };
  for (const line of lines) {
    const kind = listMarker.test(line.text) ? 'list' : line.height > typical * 1.2 ? 'heading' : 'paragraph';
    const gap = pending ? pending.last.y - line.y : 0;
    const indented = pending && kind === 'paragraph' && pending.kind === 'paragraph' &&
      line.x - pending.last.x >= typical * .9 && line.x - pending.first.x >= typical * .9;
    if (!pending || pending.last.column !== line.column || gap > typical * 1.9 || gap < -2 || kind !== 'paragraph' || pending.kind === 'heading' || indented) {
      flush();
      pending = { first: line, last: line, text: line.text, kind };
    } else {
      pending.text = joinPdfLines(pending.text, line.text);
      pending.last = line;
    }
  }
  flush();
  return { blocks, first: lines[0], last: lines.at(-1), typical };
}
function pageBlocks(pages: PdfPage[]) {
  const repeated = repeatedMargins(pages);
  const extracted = pages.map(page => paragraphs(page, repeated));
  for (let i = 1; i < pages.length; i++) {
    const previous = extracted[i - 1], current = extracted[i];
    const tail = previous.blocks.at(-1), head = current.blocks[0];
    if (!tail || !head || tail.kind !== 'paragraph' || head.kind !== 'paragraph' || !previous.last || !current.first) continue;
    if (pages[i - 1].complex || pages[i].complex || previous.last.y > pages[i - 1].height * .32 || current.first.y < pages[i].height * .68) continue;
    // A lowercase continuation near the next page's top is stronger evidence
    // than a missing full stop alone, which can also be a title or caption.
    if (!/^[a-z]/.test(head.text) || /[.!?:;…]["'”’)]*$/.test(tail.text)) continue;
    if (Math.abs(previous.last.height - current.first.height) > Math.min(previous.typical, current.typical) * .2) continue;
    head.continuesPreviousPage = true;
  }
  return extracted.flatMap(page => page.blocks);
}
export async function pdfDocument(bytes: Uint8Array): Promise<RawDocument> {
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('material_invalid_document');
  const assetBase = new URL('/pdfjs/', typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
  // WKWebView does not consistently expose nested Worker constructors. Load the
  // engine into this already-disposable background worker and let PDF.js use its
  // loopback port. Text extraction stays entirely off the UI thread.
  if (!inNode) await import(/* @vite-ignore */ pdfWorkerUrl);
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: true, useWorkerFetch: true, cMapUrl: assetBase + 'cmaps/', cMapPacked: true, standardFontDataUrl: assetBase + 'standard_fonts/', wasmUrl: assetBase + 'wasm/', verbosity: 0 });
  let doc: Awaited<typeof loading.promise>;
  try { doc = await loading.promise; } catch (error) {
    await loading.destroy();
    if ((error as Error).name === 'PasswordException') throw new Error('material_password_required');
    throw new Error('material_invalid_document');
  }
  const pages: PdfPage[] = [], warnings: string[] = [];
  const noText: number[] = [], complexPages: number[] = [];
  let partial = false;
  try {
    if (doc.numPages > DOCUMENT_LIMITS.pdfPages) throw new Error('material_too_many_pages');
    const started = Date.now();
    let extractedBytes = 0, extractedItems = 0;
    const encoder = new TextEncoder();
    for (let p = 1; p <= doc.numPages; p++) {
      if (Date.now() - started > DOCUMENT_LIMITS.timeoutMs) throw new Error('material_parse_timeout');
      const page = await doc.getPage(p);
      const [left, bottom, right, top] = page.view;
      // getTextContent() in recent PDF.js uses ReadableStream's async iterator,
      // which WKWebView may lack. The standard reader works on supported Tauri WK.
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
      const sourceItems: any[] = [];
      let pageCharacters = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (typeof item.str !== 'string' || !item.str.trim()) continue;
            pageCharacters += item.str.length;
            extractedBytes += encoder.encode(item.str).byteLength;
            if (extractedBytes > DOCUMENT_LIMITS.textBytes || pageCharacters > DOCUMENT_LIMITS.textBytes) throw new Error('material_too_large');
            if (sourceItems.length >= DOCUMENT_LIMITS.pdfPageItems || ++extractedItems > DOCUMENT_LIMITS.pdfTotalItems) throw new Error('material_too_large');
            sourceItems.push(item);
          }
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      const items: PdfItem[] = sourceItems.map((item: any) => ({ str: item.str, x: item.transform[4] - left, y: item.transform[5] - bottom, width: item.width, height: item.height || Math.abs(item.transform[3]) || 12 }));
      if (!items.length) noText.push(p);
      const result = pageLines(items, p, right - left, top - bottom);
      if (result.complex) { partial = true; complexPages.push(p); }
      pages.push(result); page.cleanup();
    }
  } finally { await doc.destroy(); }
  if (noText.length === pages.length) throw new Error('material_no_text_layer');
  for (let at = 0; at < complexPages.length; at += 100) {
    const list = complexPages.slice(at, at + 100).join(', ');
    warnings.push(`文件页 ${list} 含复杂多栏或表格，阅读顺序需核对。 / Complex columns or tables on file pages ${list}; verify order.`);
  }
  if (noText.length) partial = true;
  for (let at = 0; at < noText.length; at += 100) {
    const list = noText.slice(at, at + 100).join(', ');
    warnings.push(`未提取到文字的文件页：${list}。可能为空白页或图片页；不会执行 OCR。 / No text extracted on file pages: ${list}. No OCR is performed.`);
  }
  return { sections: pages.map(page => ({ id: `page-${page.page}`, title: `Page ${page.page}`, page: page.page })), blocks: pageBlocks(pages), warnings, partial };
}
