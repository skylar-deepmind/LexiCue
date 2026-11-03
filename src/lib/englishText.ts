import { clearlyNonEnglish, readableEnglishSegment } from './englishScope';
import { parseFile } from './parser';
import type { SegmentInput } from './types';

export function parseEnglishText(content: string): SegmentInput[] {
  if (!content.trim()) throw new Error('material_empty');
  if (new TextEncoder().encode(content).length > 32 * 1024 * 1024) throw new Error('material_too_large');
  const segments = parseFile(content, 'txt', 'auto', 'en').segments;
  if (!segments.length || !segments.some(segment => /[A-Za-z]/.test(segment.en_text)) || segments.some(segment => !readableEnglishSegment(segment.en_text)
    || /[\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(segment.en_text))
    || clearlyNonEnglish(segments.map(segment => segment.en_text).join(' '))) throw new Error('material_english_only');
  return segments;
}
