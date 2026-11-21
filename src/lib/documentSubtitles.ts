import vttParser from 'webvtt-parser';
import { inertHtmlText } from './documentMarkup';
import { endsSentence } from './sentenceMerge';
import type { RawDocument, RawDocumentBlock } from './documentCore';

interface Cue { id: string; start_ms: number; end_ms: number; text: string }
function cleanCue(text: string): string {
  // Only known subtitle markup is removed; bracketed speech remains intact.
  return inertHtmlText(text.replace(/<(?:\d{2}:)?\d{2}:\d{2}\.\d{3}>/g, '')).trim();
}
function removeRollUpPrefix(text: string, previous: string): string {
  const words = text.matchAll(/\S+/g);
  let end = 0;
  for (const word of previous.split(/\s+/)) {
    const match = words.next().value;
    if (!match || match[0] !== word) return text;
    end = match.index + word.length;
  }
  // Identical dialogue at a distinct time is still a separate cue.
  return end < text.length ? text.slice(end).trimStart() : text;
}
function cueDocument(cues: Cue[], warnings: string[], partial = false): RawDocument {
  const section_id = 'subtitles', blocks: RawDocumentBlock[] = [];
  const seen = new Set<string>();
  let previous: Cue | undefined;
  let pending: RawDocumentBlock | undefined;
  let tail = '';
  let pendingEnd = 0;
  let paragraph = 0;
  for (const cue of cues.sort((a, b) => a.start_ms - b.start_ms)) {
    let text = cleanCue(cue.text);
    if (!text) continue;
    const key = `${cue.start_ms}:${cue.end_ms}:${text}`;
    if (seen.has(key)) { warnings.push('已合并时间范围与文字完全相同的重复字幕。 / Exact duplicate cues at the same time were merged.'); continue; }
    seen.add(key);
    const visibleText = text;
    if (previous && cue.start_ms < previous.end_ms && cue.start_ms >= previous.start_ms && cue.start_ms - previous.start_ms <= 10000) {
      text = removeRollUpPrefix(text, previous.text);
    }
    if (text !== visibleText) {
      warnings.push('重叠的滚动字幕仅移除前一条已显示的完整前缀；其他时间的重复台词保留。 / Overlapping roll-up cues remove only an exact preceding prefix.');
    }
    previous = { ...cue, text: visibleText };
    if (!text) continue;
    const english = text.split('\n').filter(line => /[A-Za-z]/.test(line)).join(' ').trim();
    const location = { section_id, paragraph: ++paragraph, cue_id: cue.id, start_ms: cue.start_ms, end_ms: cue.end_ms };
    const speakerChange = /^(?:[-–—]\s|[A-Z][A-Z ]{1,30}:)/.test(english);
    if (pending && cue.start_ms <= pendingEnd + 1600 && pending.locations.length < 32 && pending.text.length + text.length <= 3000 && !endsSentence(tail, 'en') && !speakerChange) {
      pending.text += '\n' + text;
      pending.locations.push(location);
      pending.cueTexts!.push(text);
      pendingEnd = Math.max(pendingEnd, cue.end_ms);
    } else {
      pending = { kind: 'paragraph', text, section_id, locations: [location], cueTexts: [text] };
      blocks.push(pending);
      pendingEnd = cue.end_ms;
    }
    if (english) tail = english;
  }
  return { sections: [{ id: section_id, title: 'Subtitles' }], blocks, warnings, partial };
}
export function srtDocument(text: string): RawDocument {
  if (!text.trim()) throw new Error('material_empty');
  const cues: Cue[] = [];
  const time = (h: string, m: string, s: string, ms: string) => +h * 3600000 + +m * 60000 + +s * 1000 + +ms;
  for (const [index, block] of text.trim().split(/\n\s*\n/).entries()) {
    const lines = block.split('\n');
    let id = `${index + 1}`;
    if (/^\d+$/.test(lines[0].trim())) id = lines.shift()!.trim();
    const match = lines.shift()?.trim().match(/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$/);
    if (!match || !lines.some(line => line.trim())) throw new Error('material_invalid_srt');
    const start_ms = time(match[1], match[2], match[3], match[4]), end_ms = time(match[5], match[6], match[7], match[8]);
    if (!Number.isSafeInteger(start_ms) || !Number.isSafeInteger(end_ms) || start_ms >= end_ms) throw new Error('material_invalid_srt');
    cues.push({ id, start_ms, end_ms, text: lines.join('\n').replace(/\{\\(?:an?[1-9]\d*|pos\([^{}\r\n]+\))\}/gi, '') });
  }
  return cueDocument(cues, []);
}
export function vttDocument(text: string): RawDocument {
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) throw new Error('material_invalid_vtt');
  // The W3C parser handles cue IDs, NOTE/STYLE and settings. REGION is metadata.
  const input = text.replace(/\n\nREGION(?:[ \t].*)?\n[\s\S]*?(?=\n\n|$)/g, '');
  const tree = new vttParser.WebVTTParser().parse(input, 'subtitles');
  const cues: Cue[] = tree.cues.map((cue: any, index: number) => ({ id: cue.id || `${index + 1}`, start_ms: Math.round(cue.startTime * 1000), end_ms: Math.round(cue.endTime * 1000), text: cue.text }));
  if (!cues.length) throw new Error('material_invalid_vtt');
  if (cues.some(cue => !Number.isFinite(cue.start_ms) || cue.start_ms < 0 || cue.end_ms <= cue.start_ms)) throw new Error('material_invalid_vtt');
  const errors = tree.errors.filter((error: any) => !/cue text|entity|escape|voice|tag|annotation/i.test(error.message ?? ''));
  return cueDocument(cues, errors.length ? ['部分 WebVTT 语法无法解析，请核对字幕与时间。 / Some WebVTT syntax could not be parsed.'] : [], errors.length > 0);
}
