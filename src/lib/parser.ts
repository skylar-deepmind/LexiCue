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

interface BilingualLines {
  sourceLines: string[];
  translationLines: string[];
}

function classifyBilingualLines(lines: string[], language: Language): BilingualLines {
  const sourceLines: string[] = [];
  const translationLines: string[] = [];

  if (language === 'ja') {
    // Han-only Japanese and Chinese lines are ambiguous, so prefer kana and
    // otherwise use the first CJK line as the learning-language source.
    const kanaLines = lines.filter((line) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line));
    if (kanaLines.length > 0) {
      sourceLines.push(...kanaLines);
      translationLines.push(...lines.filter((line) => !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line)));
    } else {
      const sourceIndex = lines.findIndex((line) => /\p{Script=Han}/u.test(line));
      if (sourceIndex >= 0) {
        sourceLines.push(lines[sourceIndex]);
        translationLines.push(...lines.filter((_, index) => index !== sourceIndex));
      }
    }
  } else if (language === 'zh') {
    // Chinese is the learning-language source, Latin lines are the translation.
    for (const line of lines) {
      const lineLanguage = detectLineLang(line);
      if (lineLanguage === 'zh') {
        sourceLines.push(line);
      } else if (lineLanguage === 'en') {
        translationLines.push(line);
      } else if (lineLanguage === 'mixed') {
        sourceLines.push(extractChineseWords(line));
        translationLines.push(line);
      }
    }
  } else {
    for (const line of lines) {
      const lineLanguage = detectLineLang(line);
      if (lineLanguage === 'en') {
        sourceLines.push(line);
      } else if (lineLanguage === 'zh') {
        translationLines.push(line);
      } else if (lineLanguage === 'mixed') {
        sourceLines.push(extractEnglishWords(line));
        translationLines.push(line);
      }
    }
  }

  return { sourceLines, translationLines };
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

    const cleanedLines = contentLines.map(cleanFormatting).filter((line) => line.length > 0);
    const { sourceLines, translationLines } = classifyBilingualLines(cleanedLines, language);
    if (sourceLines.length === 0) continue;

    cues.push({ startTime, endTime, sourceLines, transLines: translationLines });
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

  const addSegment = (source: string, translation: string | null) => {
    const index = segments.length;
    const words = tokenizeWithPositionsForLanguage(source, language);

    segments.push({
      index,
      en_text: source,
      zh_text: translation,
      start_time: null,
      end_time: null,
    });

    for (const w of words) {
      const lemma = w.word;
      allLemmas.add(lemma);
      allOccurrences.push({
        lemma,
        segment_index: index,
        original_form: w.word,
        position: w.position,
      });
    }
  };

  for (const paragraph of paragraphs) {
    const plainText = paragraph.replace(/\s+/g, ' ').trim();
    const lines = paragraph.split('\n').map(cleanFormatting).filter((line) => line.length > 0);
    const { sourceLines, translationLines } = classifyBilingualLines(lines, language);

    // Preserve the existing single-language TXT behavior, including paragraphs
    // whose selected language cannot be detected from their characters.
    if (sourceLines.length === 0 || translationLines.length === 0) {
      addSegment(plainText, null);
      continue;
    }

    const translationLanguage = language === 'zh' ? 'en' : 'zh';
    const sourceStream = sourceLines.flatMap((line) => splitIntoSentences(line, language));
    const translationStream = translationLines.flatMap((line) => splitIntoSentences(line, translationLanguage));
    const pairs = alignSentenceStreams(sourceStream, translationStream, language);

    for (const pair of pairs) {
      addSegment(pair.source, pair.translation);
    }
  }

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
