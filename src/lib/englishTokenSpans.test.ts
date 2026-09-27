import { describe, expect, it } from 'vitest';
import { englishTokenSpans } from './englishTokenSpans';

describe('englishTokenSpans', () => {
  it('keeps phrase positions aligned after contractions and punctuation', () => {
    const text = "I'm ready to pick it up, right now.";
    const spans = englishTokenSpans(text);
    expect(spans.map(({ start, end }) => text.slice(start, end))).toEqual([
      'I', 'm', 'ready', 'to', 'pick', 'it', 'up', 'right', 'now',
    ]);
    expect(spans.filter(({ position }) => [4, 6].includes(position)).map(({ start, end }) => text.slice(start, end))).toEqual(['pick', 'up']);
  });
});
