import vttParser from 'webvtt-parser';
import { inertHtmlText } from './documentMarkup';
import type { RawDocument, RawDocumentBlock } from './documentCore';

interface Cue { id: string; start_ms: number; end_ms: number; text: string }
function cleanCue(text: string): string {
  // Only known subtitle markup is removed; bracketed speech remains intact.
  return inertHtmlText(text.replace(/<(?:\d{2}:)?\d{2}:\d{2}\.\d{3}>/g, '')).trim();
}
function cueDocument(cues: Cue[], warnings: string[], partial = false): RawDocument {
  const section_id = 'subtitles', blocks: RawDocumentBlock[] = [];
  const seen = new Set<string>();
  let previous: Cue | undefined;
  for (const cue of cues) {
    let text = cleanCue(cue.text);
    if (!text) continue;
    const key = `${cue.start_ms}:${cue.end_ms}:${text}`;
    if (seen.has(key)) { warnings.push('已合并时间范围与文字完全相同的重复字幕。 / Exact duplicate cues at the same time were merged.'); continue; }
    seen.add(key);
    if (previous && cue.start_ms < previous.end_ms && cue.start_ms >= previous.start_ms && cue.start_ms - previous.start_ms <= 10000 && text.startsWith(previous.text + ' ')) {
      text = text.slice(previous.text.length).trim();
      warnings.push('重叠的滚动字幕仅移除前一条已显示的完整前缀；其他时间的重复台词保留。 / Overlapping roll-up cues remove only an exact preceding prefix.');
    }
    previous = { ...cue, text: cleanCue(cue.text) };
    if (!text) continue;
    blocks.push({ kind: 'paragraph', text, section_id, locations: [{ section_id, paragraph: blocks.length + 1, cue_id: cue.id, start_ms: cue.start_ms, end_ms: cue.end_ms }], start_ms: cue.start_ms, end_ms: cue.end_ms });
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
    if (start_ms >= end_ms) throw new Error('material_invalid_srt');
    cues.push({ id, start_ms, end_ms, text: lines.join('\n') });
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
