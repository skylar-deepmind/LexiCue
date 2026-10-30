import { parse, parseFragment } from 'parse5';
import { lexer, type Token, type Tokens } from 'marked';
import type { RawDocument, RawDocumentBlock } from './documentCore';
import type { DocumentBlock, DocumentLocation } from './documentTypes';

const ignored = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'audio', 'video']);
function attribute(node: any, name: string): string { return node.attrs?.find((a: any) => a.name === name || `${a.prefix}:${a.name}` === name)?.value ?? ''; }
function hidden(node: any): boolean { return node.attrs?.some((a: any) => a.name === 'hidden') || attribute(node, 'aria-hidden') === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attribute(node, 'style')); }
export function inertHtmlText(html: string): string {
  const root = parseFragment(html);
  return nodeText(root).replace(/\u00a0/g, ' ');
}
function nodeText(node: any): string {
  if (node.nodeName === '#text') return node.value;
  if (ignored.has(node.tagName) || hidden(node)) return '';
  if (node.tagName === 'a' && /^#(?:FNanchor|noteref|footnote-ref)/i.test(attribute(node, 'href'))) return '';
  if (node.tagName === 'br') return '\n';
  const text = (node.childNodes ?? []).map(nodeText).join('');
  return ['p', 'div', 'li', 'tr'].includes(node.tagName) ? text + '\n' : text;
}
export function htmlDocumentBlocks(html: string, sectionId: string, mode: 'epub' | 'docx'): { blocks: RawDocumentBlock[]; title?: string; warnings: string[]; partial: boolean } {
  const root = parse(html);
  const blocks: RawDocumentBlock[] = [], warnings: string[] = [];
  let paragraph = 0, title: string | undefined, partial = false;
  const add = (kind: DocumentBlock['kind'], text: string) => {
    text = text.replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (text) blocks.push({ kind, text, section_id: sectionId, locations: [{ section_id: sectionId, paragraph: ++paragraph }] });
  };
  const walk = (node: any, inherited?: DocumentBlock['kind']) => {
    const tag = node.tagName;
    if (ignored.has(tag) || hidden(node)) return;
    if (mode === 'epub' && (/^(?:pg-header|pg-footer)$/.test(attribute(node, 'id')) || /(?:^|\s)pg-boilerplate(?:\s|$)/.test(attribute(node, 'class')))) return;
    if (mode === 'epub' && ['body', 'div', 'section'].includes(tag) && (node.childNodes?.length ?? 0) <= 12 && /^back$/i.test(nodeText(node).trim())) {
      const images: any[] = [], anchors: any[] = [];
      const collect = (n: any) => { if (n.tagName === 'img') images.push(n); if (n.tagName === 'a') anchors.push(n); for (const child of n.childNodes ?? []) collect(child); };
      collect(node);
      if (images.length && anchors.length === 1 && !/^[a-z]+:/i.test(attribute(anchors[0], 'href'))) return;
    }
    if (mode === 'epub' && tag === 'a' && (/backlink|noteref/i.test(attribute(node, 'role')) || /(?:^|\s)(?:footnote-back|footnote-backref)(?:\s|$)/.test(attribute(node, 'class')) || /^#(?:FNanchor|noteref|footnote-ref)/i.test(attribute(node, 'href')))) return;
    const semantic = attribute(node, 'epub:type') || attribute(node, 'type');
    if (mode === 'epub' && (tag === 'nav' || /(?:^|\s)(?:toc|landmarks|page-list|footnote|endnote)(?:\s|$)/.test(semantic))) {
      if (/footnote|endnote/.test(semantic)) warnings.push('附属注释没有重复并入正文。 / Ancillary notes are excluded from the reading body.');
      return;
    }
    if (tag === 'head') return;
    if (tag === 'table') {
      if (mode === 'epub') {
        const anchors: any[] = [];
        const links = (n: any) => { if (n.tagName === 'a') anchors.push(n); for (const child of n.childNodes ?? []) links(child); };
        links(node);
        const linkedText = anchors.map(nodeText).join('').replace(/\s/g, '');
        const allText = nodeText(node).replace(/\s/g, '');
        if (anchors.length >= 3 && anchors.every(a => /#/.test(attribute(a, 'href')) && !/^[a-z]+:/i.test(attribute(a, 'href'))) && linkedText.length >= allText.length * .7) return;
      }
      const rows: any[] = [];
      const findRows = (n: any) => { if (n.tagName === 'tr') rows.push(n); else for (const child of n.childNodes ?? []) findRows(child); };
      findRows(node);
      for (const row of rows) {
        const cells = (row.childNodes ?? []).filter((n: any) => n.tagName === 'td' || n.tagName === 'th');
        if (cells.some((c: any) => Number(attribute(c, 'colspan') || 1) > 1)) warnings.push('横向合并表格单元格按原行从左到右保留；不保留列宽。 / Horizontally merged cells retain row order; column widths are omitted.');
        if (cells.some((c: any) => Number(attribute(c, 'rowspan') || 1) > 1)) { partial = true; warnings.push('跨行合并表格已按行展开，请核对行列关系。 / Vertically merged table cells require a relationship check.'); }
        add('table', cells.map((c: any) => nodeText(c).trim()).join(' | '));
      }
      return;
    }
    if (tag === 'pre') { add('code', nodeText(node)); return; }
    if (/^h[1-6]$/.test(tag)) {
      let text = nodeText(node);
      if (!text.trim()) {
        const alternatives: string[] = [];
        const collect = (n: any) => { if (n.tagName === 'img' && attribute(n, 'alt')) alternatives.push(attribute(n, 'alt')); for (const child of n.childNodes ?? []) collect(child); };
        collect(node); text = alternatives.join(' ');
      }
      if (!title) title = text.trim(); add('heading', text); return;
    }
    if (tag === 'li') {
      const direct = (node.childNodes ?? []).filter((n: any) => n.tagName !== 'ul' && n.tagName !== 'ol');
      add('list', direct.map(nodeText).join(' '));
      for (const child of node.childNodes ?? []) if (child.tagName === 'ul' || child.tagName === 'ol') walk(child);
      return;
    }
    if (tag === 'p' || tag === 'blockquote' && !(node.childNodes ?? []).some((n: any) => ['p','div','ul','ol'].includes(n.tagName))) { add(inherited ?? (tag === 'blockquote' ? 'quote' : 'paragraph'), nodeText(node)); return; }
    if (tag === 'math') { partial = true; warnings.push('数学公式仅保留可提取文字，请核对原公式。 / Formula layout is not preserved.'); add('paragraph', nodeText(node)); return; }
    if (node.nodeName === '#text' && node.value.trim()) { add(inherited ?? 'paragraph', node.value); return; }
    for (const child of node.childNodes ?? []) walk(child, tag === 'blockquote' ? 'quote' : inherited);
  };
  walk(root);
  return { blocks, title, warnings, partial };
}
function inline(tokens: Token[] | undefined, fallback = ''): string {
  if (!tokens) return fallback;
  return tokens.map(token => {
    if (token.type === 'html') return inertHtmlText(token.raw);
    if (token.type === 'image') return ''; // Image alternatives are not document body.
    if (token.type === 'br') return '\n';
    if ('tokens' in token && token.tokens) return inline(token.tokens as Token[], 'text' in token ? String(token.text) : '');
    return 'text' in token ? token.type === 'codespan' ? String(token.text) : inertHtmlText(String(token.text)) : token.raw;
  }).join('');
}
export function markdownDocument(text: string): RawDocument {
  const sections: RawDocument['sections'] = [{ id: 'section-1', title: 'Document' }], blocks: RawDocumentBlock[] = [];
  let sectionId = 'section-1', paragraph = 0;
  const warnings: string[] = [];
  let partial = false;
  const add = (kind: DocumentBlock['kind'], text: string) => { if (text.trim()) blocks.push({ kind, text: text.trim(), section_id: sectionId, locations: [{ section_id: sectionId, paragraph: ++paragraph }] }); };
  const walk = (tokens: Token[], override?: DocumentBlock['kind']) => {
    for (const token of tokens) {
      switch (token.type) {
        case 'heading': {
          const title = inline((token as Tokens.Heading).tokens);
          if (!blocks.length) sections[0].title = title;
          else { sectionId = `section-${sections.length + 1}`; sections.push({ id: sectionId, title }); paragraph = 0; }
          add('heading', title); break;
        }
        case 'paragraph': case 'text': add(override ?? 'paragraph', inline('tokens' in token ? token.tokens as Token[] : undefined, String((token as Tokens.Text).text))); break;
        case 'blockquote': walk((token as Tokens.Blockquote).tokens, 'quote'); break;
        case 'list': for (const item of (token as Tokens.List).items) walk(item.tokens, 'list'); break;
        case 'code': add('code', (token as Tokens.Code).text); break;
        case 'table': {
          const table = token as Tokens.Table;
          add('table', table.header.map(cell => inline(cell.tokens)).join(' | '));
          for (const row of table.rows) add('table', row.map(cell => inline(cell.tokens)).join(' | '));
          break;
        }
        case 'html': {
          const result = htmlDocumentBlocks(token.raw, sectionId, 'epub');
          for (const block of result.blocks) add(block.kind, block.text);
          warnings.push(...result.warnings); partial ||= result.partial; break;
        }
      }
    }
  };
  walk(lexer(text, { gfm: true }));
  return { sections, blocks, warnings, partial };
}
export function plainDocument(text: string): RawDocument {
  const section_id = 'section-1';
  return { sections: [{ id: section_id, title: 'Document' }], blocks: text.split(/\n\s*\n/).map((text, i) => ({ kind: 'paragraph', text, section_id, locations: [{ section_id, paragraph: i + 1 }] })), warnings: [] };
}
export function withLocation(blocks: RawDocumentBlock[], extra: Partial<DocumentLocation>): RawDocumentBlock[] { return blocks.map(block => ({ ...block, locations: block.locations.map(location => ({ ...location, ...extra })) })); }
