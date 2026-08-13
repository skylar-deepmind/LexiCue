import type { Language } from './languages';

export interface OccurrencePiece {
  text: string;
  highlighted: boolean;
}

const LATIN_CLEAN_RE = /[^\p{Script=Latin}'-]/gu;

function cleanLatinToken(token: string): string {
  return token.replace(LATIN_CLEAN_RE, '').toLowerCase();
}

function isLatinWordToken(token: string): boolean {
  const clean = cleanLatinToken(token);
  return clean.length > 0 && (clean === 'a' || clean === 'i' || clean.length > 1);
}

function highlightBySubstring(text: string, surface: string): OccurrencePiece[] {
  const parts = text.split(surface);
  if (parts.length === 1) return [{ text, highlighted: false }];
  const pieces: OccurrencePiece[] = [];
  parts.forEach((part, index) => {
    if (part) pieces.push({ text: part, highlighted: false });
    if (index < parts.length - 1) pieces.push({ text: surface, highlighted: true });
  });
  return pieces;
}

function highlightWordLatin(text: string, surface: string): OccurrencePiece[] {
  const target = cleanLatinToken(surface);
  return text.split(/(\s+)/).filter(Boolean).map((token) => ({
    text: token,
    highlighted: isLatinWordToken(token) && cleanLatinToken(token) === target,
  }));
}

function highlightPhraseLatin(text: string, surface: string): OccurrencePiece[] {
  const pieces = text.split(/(\s+)/).filter(Boolean);
  const phraseWords = surface.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const highlighted = new Set<number>();
  if (phraseWords.length > 0) {
    for (let i = 0; i < pieces.length; i++) {
      if (!isLatinWordToken(pieces[i]) || cleanLatinToken(pieces[i]) !== phraseWords[0]) continue;
      const matchIndexes: number[] = [];
      let wordIndex = 0;
      for (let j = i; j < pieces.length && wordIndex < phraseWords.length; j++) {
        if (!isLatinWordToken(pieces[j])) continue;
        if (cleanLatinToken(pieces[j]) !== phraseWords[wordIndex]) break;
        matchIndexes.push(j);
        wordIndex++;
      }
      if (wordIndex === phraseWords.length) {
        for (const index of matchIndexes) highlighted.add(index);
        break;
      }
    }
  }
  return pieces.map((piece, index) => ({ text: piece, highlighted: highlighted.has(index) }));
}

export function highlightOccurrence(
  text: string,
  surface: string,
  language: Language,
  mode: 'word' | 'phrase' = 'word',
): OccurrencePiece[] {
  if (!surface) return [{ text, highlighted: false }];
  if (language === 'ja' || language === 'zh') {
    return highlightBySubstring(text, surface);
  }
  return mode === 'phrase' ? highlightPhraseLatin(text, surface) : highlightWordLatin(text, surface);
}
