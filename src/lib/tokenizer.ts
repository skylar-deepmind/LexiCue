import type { Language } from './languages';

export interface Token {
  word: string;
  position: number;
  lemma?: string;
  reading?: string | null;
  partOfSpeech?: string | null;
}

const PUNCTUATION_RE = /[.,!?;:()[\]{}"'`«»–—…@#$%^&*+=<>/\\|~]/g;
const ASCII_WORD_RE = /^[a-z]+$/;
const LATIN_WORD_RE = /^\p{Script=Latin}+(?:-\p{Script=Latin}+)*$/u;

function splitWords(text: string): string[] {
  return text
    .replace(PUNCTUATION_RE, ' ')
    .replace(/--/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
}

function keepWord(word: string, keepCase: boolean): string | null {
  if (word.length === 0) return null;
  const normalized = keepCase ? word : word.toLowerCase();
  if (normalized === 'a' || normalized === 'i' || normalized === 'A' || normalized === 'I') {
    return normalized;
  }
  if (normalized.length === 1) return null;
  return keepCase ? (LATIN_WORD_RE.test(normalized) ? normalized : null) : (ASCII_WORD_RE.test(normalized) ? normalized : null);
}

export function tokenize(text: string): string[] {
  return splitWords(text)
    .map((word) => keepWord(word, false))
    .filter((word): word is string => word !== null);
}

// Latin-script tokenization that preserves German letters (ä ö ü ß) and case.
function tokenizeLatin(text: string): string[] {
  return splitWords(text)
    .map((word) => keepWord(word, true))
    .filter((word): word is string => word !== null);
}

// This is a conservative fallback for Japanese. The production tokenizer can
// replace it without changing parser or UI call sites.
function tokenizeJapanese(text: string): string[] {
  return text
    .normalize('NFKC')
    .match(/[\p{Script=Han}]+|[\p{Script=Hiragana}]+|[\p{Script=Katakana}]+|[A-Za-z0-9]+/gu) ?? [];
}

// Conservative fallback for Chinese. The production tokenizer (jieba-rs via the
// `tokenize_chinese` command) replaces it during import without changing callers.
function tokenizeChinese(text: string): string[] {
  return text
    .normalize('NFKC')
    .match(/[\p{Script=Han}]+|[\p{Script=Latin}]+|\d+/gu) ?? [];
}

export function tokenizeForLanguage(text: string, language: Language): string[] {
  if (language === 'ja') return tokenizeJapanese(text);
  if (language === 'de') return tokenizeLatin(text);
  if (language === 'zh') return tokenizeChinese(text);
  return tokenize(text);
}

export function tokenizeWithPositions(text: string): { word: string; position: number }[] {
  return splitWords(text)
    .map((word) => keepWord(word, false))
    .filter((word): word is string => word !== null)
    .map((w, i) => ({ word: w, position: i }));
}

export function tokenizeWithPositionsForLanguage(text: string, language: Language): Token[] {
  return tokenizeForLanguage(text, language).map((word, position) => ({ word, position }));
}
