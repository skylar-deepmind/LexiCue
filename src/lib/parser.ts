import { tokenizeWithPositionsForLanguage } from './tokenizer';
import {
  alignSentenceStreams,
  mergeUnitsIntoSentences,
  splitIntoSentences,
  type SentenceMergeUnit,
} from './sentenceMerge';
import type { SegmentInput, OccurrenceInput } from './types';
import type { Language } from './languages';

export type SubtitleMode = 'en-first' | 'zh-first' | 'auto';

export interface ParsedResult {
  segments: SegmentInput[];
  lemmas: string[];
  occurrences: OccurrenceInput[];
  language: Language;
}

function cleanFormatting(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/♪[^♪]*♪?/g, '')
    .replace(/♫[^♫]*♫?/g, '')
    .replace(/^[-–—] /, '')
    .trim();
}

function detectLineLang(line: string): 'en' | 'zh' | 'mixed' | 'other' {
  const text = cleanFormatting(line);
  if (text.length === 0) return 'other';

  const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) || []).length;

  if (latin === 0 && cjk === 0) return 'other';
  if (cjk === 0 && latin > 0) return 'en';
  if (latin === 0 && cjk > 0) return 'zh';
  return 'mixed';
}

function extractEnglishWords(line: string): string {
  return line
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ' ')
    .replace(/[^\p{Script=Latin}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractChineseWords(line: string): string {
  return line
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]/gu, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function parseSrtBlocks(content: string, _mode: SubtitleMode, language: Language): ParsedResult {
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const blocks = normalized.split(/\n\n+/);

  interface Cue {
    startTime: string | null;
    endTime: string | null;
    sourceLines: string[];
    transLines: string[];
  }

  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    if (lines.findIndex(l => !/^\d+$/.test(l) && !l.includes('-->')) === -1) continue;

    let startTime: string | null = null;
    let endTime: string | null = null;
    for (const line of lines) {
      const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
      if (timeMatch) {
        startTime = timeMatch[1].replace(',', '.');
        endTime = timeMatch[2].replace(',', '.');
        break;
      }
    }

    const contentLines = lines.filter(l => !/^\d+$/.test(l) && !l.includes('-->'));
    if (contentLines.length === 0) continue;

    const enLines: string[] = [];
    const zhLines: string[] = [];

    const cleanedLines = contentLines.map(cleanFormatting).filter((line) => line.length > 0);
    if (language === 'ja') {
      // Han-only Japanese and Chinese lines are ambiguous, so prefer kana and
      // otherwise use the first CJK line as the learning-language source.
      const kanaIndex = cleanedLines.findIndex((line) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line));
      const sourceIndex = kanaIndex >= 0 ? kanaIndex : cleanedLines.findIndex((line) => /\p{Script=Han}/u.test(line));
      if (sourceIndex >= 0) {
        enLines.push(cleanedLines[sourceIndex]);
        zhLines.push(...cleanedLines.filter((_, index) => index !== sourceIndex));
      }
    } else if (language === 'zh') {
      // Chinese is the learning-language source, English lines are the translation.
      for (const cleaned of cleanedLines) {
        const lang = detectLineLang(cleaned);
        if (lang === 'zh') {
          enLines.push(cleaned);
        } else if (lang === 'en') {
          zhLines.push(cleaned);
        } else if (lang === 'mixed') {
          enLines.push(extractChineseWords(cleaned));
          zhLines.push(cleaned);
        }
      }
    } else {
      for (const cleaned of cleanedLines) {
        const lang = detectLineLang(cleaned);
        if (lang === 'en') {
          enLines.push(cleaned);
        } else if (lang === 'zh') {
          zhLines.push(cleaned);
        } else if (lang === 'mixed') {
          enLines.push(extractEnglishWords(cleaned));
          zhLines.push(cleaned);
        }
      }
    }

    if (enLines.length === 0) continue;

    cues.push({ startTime, endTime, sourceLines: enLines, transLines: zhLines });
  }

  const units: SentenceMergeUnit[] = [];
  const translationLanguage = language === 'zh' ? 'en' : 'zh';

  for (const cue of cues) {
    const sourceStream = cue.sourceLines.flatMap((line) => splitIntoSentences(line, language));
    const transStream = cue.transLines.flatMap((line) => splitIntoSentences(line, translationLanguage));

    const pairs = alignSentenceStreams(sourceStream, transStream, language);
    for (const pair of pairs) {
      units.push({
        source: pair.source,
        translation: pair.translation,
        startTime: cue.startTime,
        endTime: cue.endTime,
      });
    }
  }

  const sentences = mergeUnitsIntoSentences(units, language);

  const segments: SegmentInput[] = [];
  const allLemmas: Set<string> = new Set();
  const allOccurrences: OccurrenceInput[] = [];

  sentences.forEach((sentence, segIndex) => {
    const words = tokenizeWithPositionsForLanguage(sentence.source, language);

    segments.push({
      index: segIndex,
      en_text: sentence.source,
      zh_text: sentence.translation,
      start_time: sentence.startTime,
      end_time: sentence.endTime,
    });

    for (const w of words) {
      const lemma = w.word;
      allLemmas.add(lemma);
      allOccurrences.push({
        lemma,
        segment_index: segIndex,
        original_form: w.word,
        position: w.position,
      });
    }
  });

  return {
    segments,
    lemmas: [...allLemmas],
    occurrences: allOccurrences,
    language,
  };
}

function parseTxtBlocks(content: string, language: Language): ParsedResult {
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const paragraphs = normalized.split(/\n\n+/).filter(p => p.trim().length > 0);

  const segments: SegmentInput[] = [];
  const allLemmas: Set<string> = new Set();
  const allOccurrences: OccurrenceInput[] = [];

  paragraphs.forEach((para, i) => {
    const enText = para.replace(/\s+/g, ' ').trim();
    const words = tokenizeWithPositionsForLanguage(enText, language);

    segments.push({
      index: i,
      en_text: enText,
      zh_text: null,
      start_time: null,
      end_time: null,
    });

    for (const w of words) {
      const lemma = w.word;
      allLemmas.add(lemma);
      allOccurrences.push({
        lemma,
        segment_index: i,
        original_form: w.word,
        position: w.position,
      });
    }
  });

  return {
    segments,
    lemmas: [...allLemmas],
    occurrences: allOccurrences,
    language,
  };
}

export function parseFile(content: string, fileType: 'txt' | 'srt', mode: SubtitleMode = 'auto', language: Language = 'en'): ParsedResult {
  if (fileType === 'srt') {
    return parseSrtBlocks(content, mode, language);
  }
  return parseTxtBlocks(content, language);
}

export function previewSrtParsing(content: string): Array<{ en: string; zh: string | null }> {
  const result = parseSrtBlocks(content, 'auto', 'en');
  return result.segments.slice(0, 5).map(s => ({
    en: s.en_text,
    zh: s.zh_text,
  }));
}
