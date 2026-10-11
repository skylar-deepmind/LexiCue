import { describe, expect, it } from 'vitest';
import { englishTokenSpans } from './englishTokenSpans';

describe('englishTokenSpans', () => {
  it('keeps phrase positions aligned after contractions and punctuation', () => {
    const text = "I'm ready to pick it up, right now.";
    const spans = englishTokenSpans(text);
    expect(spans.map(({ start, end }) => text.slice(start, end))).toEqual([
      "I'm", 'ready', 'to', 'pick', 'it', 'up', 'right', 'now',
    ]);
    expect(spans.filter(({ position }) => [3, 5].includes(position)).map(({ start, end }) => text.slice(start, end))).toEqual(['pick', 'up']);
  });

  it('keeps raw positions while excluding URLs and resource names', () => {
    const text = 'Open https://example.com image.png and read this';
    expect(englishTokenSpans(text).map((span) => [span.position, text.slice(span.start, span.end)])).toEqual([
      [0, 'Open'], [3, 'and'], [4, 'read'], [5, 'this'],
    ]);
  });
});
