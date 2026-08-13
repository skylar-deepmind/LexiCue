import { describe, it, expect } from 'vitest';
import { highlightOccurrence, type OccurrencePiece } from '../occurrenceHighlight';

function highlightedTexts(pieces: OccurrencePiece[]): string[] {
  return pieces.filter((p) => p.highlighted).map((p) => p.text);
}

describe('highlightOccurrence - English words', () => {
  it('highlights a case-insensitive match', () => {
    const pieces = highlightOccurrence('He went to the store.', 'went', 'en');
    expect(highlightedTexts(pieces)).toEqual(['went']);
    expect(pieces.map((p) => p.text).join('')).toBe('He went to the store.');
  });

  it('handles capitalized surface in text', () => {
    const pieces = highlightOccurrence('Went to the store.', 'went', 'en');
    expect(highlightedTexts(pieces)).toEqual(['Went']);
  });

  it('preserves punctuation attached to tokens', () => {
    const pieces = highlightOccurrence('Hello, world!', 'world', 'en');
    expect(highlightedTexts(pieces)).toEqual(['world!']);
    expect(pieces.map((p) => p.text).join('')).toBe('Hello, world!');
  });

  it('highlights all occurrences of the same word', () => {
    const pieces = highlightOccurrence('went went', 'went', 'en');
    expect(highlightedTexts(pieces)).toEqual(['went', 'went']);
  });

  it('does not highlight a partial word match', () => {
    const pieces = highlightOccurrence('The book on the shelf.', 'book', 'en');
    expect(highlightedTexts(pieces)).toEqual(['book']);
  });

  it('returns plain text when there is no match', () => {
    const pieces = highlightOccurrence('Hello world', 'zebra', 'en');
    expect(highlightedTexts(pieces)).toEqual([]);
  });
});

describe('highlightOccurrence - German words', () => {
  it('matches umlauts and case-insensitively', () => {
    const pieces = highlightOccurrence('Der Müller singt ein Lied.', 'Müller', 'de');
    expect(highlightedTexts(pieces)).toEqual(['Müller']);
  });
});

describe('highlightOccurrence - phrases', () => {
  it('highlights a multi-word phrase', () => {
    const pieces = highlightOccurrence('To be or not to be.', 'to be', 'en', 'phrase');
    expect(highlightedTexts(pieces)).toEqual(['To', 'be']);
  });

  it('does not highlight a partial phrase', () => {
    const pieces = highlightOccurrence('To be or not to be.', 'not to be', 'en', 'phrase');
    expect(highlightedTexts(pieces)).toEqual(['not', 'to', 'be.']);
  });

  it('returns plain text when the phrase is absent', () => {
    const pieces = highlightOccurrence('I love this city.', 'take care', 'en', 'phrase');
    expect(highlightedTexts(pieces)).toEqual([]);
  });
});

describe('highlightOccurrence - CJK', () => {
  it('highlights a Japanese word by substring', () => {
    const pieces = highlightOccurrence('私は学生です', '学生', 'ja');
    expect(highlightedTexts(pieces)).toEqual(['学生']);
    expect(pieces.map((p) => p.text).join('')).toBe('私は学生です');
  });

  it('highlights all Chinese substring occurrences', () => {
    const pieces = highlightOccurrence('世界世界', '世界', 'zh');
    expect(highlightedTexts(pieces)).toEqual(['世界', '世界']);
  });

  it('highlights a Chinese phrase by substring', () => {
    const pieces = highlightOccurrence('我们一起去看电影吧', '看电影', 'zh', 'phrase');
    expect(highlightedTexts(pieces)).toEqual(['看电影']);
  });
});

describe('highlightOccurrence - edge cases', () => {
  it('returns plain text for an empty surface', () => {
    const pieces = highlightOccurrence('Hello world', '', 'en');
    expect(highlightedTexts(pieces)).toEqual([]);
  });
});
