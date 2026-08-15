import type { Language } from './languages';

export interface SentenceMergeUnit {
  source: string;
  translation: string | null;
  startTime: string | null;
  endTime: string | null;
}

export interface MergedSentence {
  source: string;
  translation: string | null;
  startTime: string | null;
  endTime: string | null;
}

const MAX_CHARS_PER_SENTENCE = 240;
const MAX_UNITS_PER_SENTENCE = 15;

const LATIN_ABBREVIATIONS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'ST', 'JR', 'SR', 'PROF', 'CAPT', 'LT', 'COL',
  'GEN', 'SEN', 'REP', 'GOV', 'NO', 'VS', 'ETC', 'EG', 'IE', 'EST', 'APPROX',
  'DEPT', 'FIG', 'US', 'UK', 'U.S', 'Z.B', 'USW', 'CA', 'NR', 'HR', 'FR',
  'BSPW', 'GGF', 'A.M', 'P.M',
]);

const CLOSING_CHARS = /[\s"'“”‘’«»「」『』()（）[\]【】]+$/u;

function hasCjk(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

function lastWordBeforePeriod(text: string): string | null {
  const match = text.match(/[\p{L}\p{N}][\p{L}\p{N}.'-]*$/u);
  if (!match) return null;
  return match[0].replace(/\.+$/u, '').toUpperCase();
}

export function endsSentence(text: string, language: Language): boolean {
  const stripped = text.trim().replace(CLOSING_CHARS, '');
  if (stripped.length === 0) return false;

  const last = stripped[stripped.length - 1];

  if (language === 'ja' || language === 'zh' || hasCjk(stripped)) {
    return /[。！？!?…～~]/u.test(last);
  }

  if (last === '!' || last === '?') return true;
  if (last === '…') return true;
  if (last === '.') {
    const word = lastWordBeforePeriod(stripped);
    if (word && (LATIN_ABBREVIATIONS.has(word) || /^\d+(?:\.\d+)+$/.test(word))) return false;
    return true;
  }
  return false;
}

const OPEN_QUOTES = new Set(['「', '『', '（', '【', '(', '[', '“', '«']);
const CLOSE_QUOTES = new Set(['」', '』', '）', '】', ')', ']', '”', '»']);

const TERMINAL_CHAR = /[.!?…。！？～~]/u;

const IMMEDIATE_CLOSERS = new Set(['」', '』', '）', '】', ')', ']', '”', '»', '"', "'"]);

function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

interface QuoteState {
  depth: number;
}

function scanQuoteChar(state: QuoteState, ch: string, prev: string, next: string): void {
  if (OPEN_QUOTES.has(ch)) {
    state.depth += 1;
    return;
  }
  if (CLOSE_QUOTES.has(ch)) {
    if (state.depth > 0) state.depth -= 1;
    return;
  }
  if (ch !== '"' && ch !== "'") return;
  if (ch === "'" && isLetterOrDigit(prev) && isLetterOrDigit(next)) return;
  const prevWord = isLetterOrDigit(prev);
  const nextWord = isLetterOrDigit(next);
  const prevPunct = /[.,!?…。！？]/.test(prev);
  if ((prevWord || prevPunct) && !nextWord) {
    if (state.depth > 0) state.depth -= 1;
  } else if (!prevWord && nextWord) {
    state.depth += 1;
  }
}

export function splitIntoSentences(text: string, language: Language): string[] {
  const parts: string[] = [];
  let start = 0;
  const quote: QuoteState = { depth: 0 };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : ' ';
    const next = i < text.length - 1 ? text[i + 1] : ' ';
    scanQuoteChar(quote, ch, prev, next);
    if (quote.depth > 0) continue;
    if (TERMINAL_CHAR.test(ch)) {
      if (IMMEDIATE_CLOSERS.has(next)) continue;
      if (ch === '.' && /[0-9]/.test(next)) continue;
      const chunk = text.slice(start, i + 1);
      if (endsSentence(chunk, language)) {
        parts.push(chunk.trim());
        start = i + 1;
      }
    }
  }

  const rest = text.slice(start).trim();
  if (rest.length > 0) parts.push(rest);
  return parts.filter((part) => part.length > 0);
}

export interface AlignedPair {
  source: string;
  translation: string | null;
}

const ALIGN_EPSILON = 0.12;

function cumulativeSizes(parts: string[]): number[] {
  const sizes: number[] = [];
  let total = 0;
  for (const part of parts) {
    total += part.length;
    sizes.push(total);
  }
  return sizes;
}

export function alignSentenceStreams(
  sourceParts: string[],
  transParts: string[],
  sourceLanguage: Language,
): AlignedPair[] {
  if (sourceParts.length === 0) return [];
  if (transParts.length === 0) {
    return sourceParts.map((part) => ({ source: part, translation: null }));
  }

  if (sourceParts.length === transParts.length) {
    return sourceParts.map((part, index) => ({
      source: part,
      translation: transParts[index],
    }));
  }

  const totalSrc = sourceParts.reduce((sum, part) => sum + part.length, 0);
  const totalTrans = transParts.reduce((sum, part) => sum + part.length, 0);
  const cumSrc = cumulativeSizes(sourceParts);
  const cumTrans = cumulativeSizes(transParts);

  const pairs: AlignedPair[] = [];
  let groupSrc: string[] = [];
  let groupTrans: string[] = [];

  const flushGroup = () => {
    if (groupSrc.length === 0 && groupTrans.length === 0) return;
    const source = joinSourceLines(groupSrc, sourceLanguage).replace(/\s+/g, ' ').trim();
    const translation =
      groupTrans.length > 0 ? joinTranslationLines(groupTrans, sourceLanguage).trim() : null;
    pairs.push({
      source,
      translation: translation && translation.length > 0 ? translation : null,
    });
    groupSrc = [];
    groupTrans = [];
  };

  let i = 0;
  let j = 0;
  while (i < sourceParts.length && j < transParts.length) {
    const srcRatio = cumSrc[i] / totalSrc;
    const transRatio = cumTrans[j] / totalTrans;
    if (Math.abs(srcRatio - transRatio) <= ALIGN_EPSILON) {
      groupSrc.push(sourceParts[i]);
      groupTrans.push(transParts[j]);
      flushGroup();
      i += 1;
      j += 1;
    } else if (srcRatio < transRatio) {
      groupSrc.push(sourceParts[i]);
      i += 1;
    } else {
      groupTrans.push(transParts[j]);
      j += 1;
    }
  }
  while (i < sourceParts.length) {
    groupSrc.push(sourceParts[i]);
    i += 1;
  }
  while (j < transParts.length) {
    groupTrans.push(transParts[j]);
    j += 1;
  }
  flushGroup();

  return pairs;
}

export function joinSourceLines(lines: string[], language: Language): string {
  return lines.join(language === 'ja' || language === 'zh' ? '' : ' ');
}

export function joinTranslationLines(lines: string[], language: Language): string {
  return lines.join(language === 'zh' ? ' ' : '');
}

export function mergeUnitsIntoSentences(
  units: SentenceMergeUnit[],
  language: Language,
): MergedSentence[] {
  const sentences: MergedSentence[] = [];
  let buffer: SentenceMergeUnit[] = [];
  const quote: QuoteState = { depth: 0 };

  const flush = () => {
    if (buffer.length === 0) return;
    const source = joinSourceLines(buffer.map((unit) => unit.source), language)
      .replace(/\s+/g, ' ')
      .trim();
    const translation = joinTranslationLines(
      buffer.flatMap((unit) => (unit.translation ? [unit.translation] : [])),
      language,
    );
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    sentences.push({
      source,
      translation: translation.length > 0 ? translation : null,
      startTime: first.startTime,
      endTime: last.endTime,
    });
    buffer = [];
    quote.depth = 0;
  };

  for (const unit of units) {
    buffer.push(unit);
    const source = unit.source;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const prev = i > 0 ? source[i - 1] : ' ';
      const next = i < source.length - 1 ? source[i + 1] : ' ';
      scanQuoteChar(quote, ch, prev, next);
    }
    const text = joinSourceLines(buffer.map((u) => u.source), language);
    const charCount = buffer.reduce((sum, u) => sum + u.source.length, 0);
    if (
      (quote.depth === 0 && endsSentence(text, language)) ||
      charCount >= MAX_CHARS_PER_SENTENCE ||
      buffer.length >= MAX_UNITS_PER_SENTENCE
    ) {
      flush();
    }
  }
  flush();

  return sentences;
}
