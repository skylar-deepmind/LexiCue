import { describe, it, expect } from 'vitest';
import { tokenize, tokenizeWithPositions, tokenizeForLanguage } from '../tokenizer';

describe('tokenizer', () => {
  it('splits sentences into lowercase words', () => {
    const result = tokenize('He went to the store.');
    expect(result).toEqual(['he', 'went', 'to', 'the', 'store']);
  });

  it('removes punctuation', () => {
    const result = tokenize('Hello, world! How are you?');
    expect(result).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('preserves single-letter words "a" and "i"', () => {
    const result = tokenize('I am a developer');
    expect(result).toEqual(['i', 'am', 'a', 'developer']);
  });

  it('filters out other single-letter tokens', () => {
    const result = tokenize('a b c d');
    expect(result).toEqual(['a']);
  });

  it('returns word positions', () => {
    const result = tokenizeWithPositions('He went to the store');
    expect(result).toEqual([
      { word: 'he', position: 0 },
      { word: 'went', position: 1 },
      { word: 'to', position: 2 },
      { word: 'the', position: 3 },
      { word: 'store', position: 4 },
    ]);
  });
});

describe('German tokenizer', () => {
  it('keeps umlauts and eszett', () => {
    expect(tokenizeForLanguage('Über die Straße für uns', 'de')).toEqual([
      'Über', 'die', 'Straße', 'für', 'uns',
    ]);
  });

  it('preserves noun capitalization', () => {
    expect(tokenizeForLanguage('Häuser sind teuer', 'de')).toEqual(['Häuser', 'sind', 'teuer']);
  });

  it('keeps internal hyphens in compounds', () => {
    expect(tokenizeForLanguage('Das ist eine E-Mail', 'de')).toEqual(['Das', 'ist', 'eine', 'E-Mail']);
  });

  it('drops punctuation but keeps words', () => {
    expect(tokenizeForLanguage('Hallo, wie geht es dir?', 'de')).toEqual(['Hallo', 'wie', 'geht', 'es', 'dir']);
  });
});

describe('Chinese tokenizer', () => {
  it('keeps Han runs as fallback tokens', () => {
    expect(tokenizeForLanguage('我今天学习中文。', 'zh')).toEqual(['我今天学习中文']);
  });

  it('keeps Latin and digits as separate tokens', () => {
    expect(tokenizeForLanguage('我用Python写代码', 'zh')).toEqual(['我用', 'Python', '写代码']);
  });
});
