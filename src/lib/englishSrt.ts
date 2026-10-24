import { clearlyNonEnglish } from './englishScope';
import { parseFile } from './parser';
import type { SegmentInput } from './types';
/** Validate the SRT structure before using the existing bilingual sentence parser. */
export function parseEnglishSrt(content: string): SegmentInput[] {
    if (!content.trim())
        throw new Error('material_empty');
    if (new TextEncoder().encode(content).length > 32 * 1024 * 1024)
        throw new Error('material_too_large');
    const blocks = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
    const time = (h: string, m: string, s: string, ms: string) => +h * 3600000 + +m * 60000 + +s * 1000 + +ms;
    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        if (/^\d+$/.test(lines[0] ?? ''))
            lines.shift();
        const match = lines[0]?.match(/^(\d{2}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2}):([0-5]\d):([0-5]\d)[,.](\d{3})(?:\s+.*)?$/);
        if (!match || lines.length < 2 || time(match[1], match[2], match[3], match[4]) >= time(match[5], match[6], match[7], match[8]))
            throw new Error('material_invalid_srt');
    }
    const segments = parseFile(content, 'srt', 'auto', 'en').segments;
    if (!segments.length || !segments.some(segment => /[A-Za-z]/.test(segment.en_text)))
        throw new Error('material_english_only');
    // Reject clear non-English source scripts; Chinese translation lines remain valid.
    if (segments.some(segment => /[\p{Script=Cyrillic}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(segment.en_text)))
        throw new Error('material_english_only');
    if (clearlyNonEnglish(segments.map(segment => segment.en_text).join(' ')))
        throw new Error('material_english_only');
    return segments;
}
