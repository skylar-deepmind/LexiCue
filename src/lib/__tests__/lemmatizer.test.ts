import { describe, it, expect } from 'vitest';
import { lemmatize } from '../lemmatizer';

describe('lemmatizer', () => {
  it('reduces common irregular forms to base lemma', () => {
    expect(lemmatize('went')).toBe('go');
    expect(lemmatize('gone')).toBe('go');
    expect(lemmatize('going')).toBe('go');
    expect(lemmatize('goes')).toBe('go');
  });

  it('reduces regular -ed/-ing/-s forms', () => {
    expect(lemmatize('studies')).toBe('study');
    expect(lemmatize('studied')).toBe('study');
    expect(lemmatize('studying')).toBe('study');
    expect(lemmatize('worked')).toBe('work');
    expect(lemmatize('working')).toBe('work');
    expect(lemmatize('works')).toBe('work');
  });

  it('returns original word if no lemma mapping exists', () => {
    expect(lemmatize('javascript')).toBe('javascript');
    expect(lemmatize('unforgettable')).toBe('unforgettable');
  });

  it('handles uppercase but still matches lowercase dictionary entries', () => {
    expect(lemmatize('Went')).toBe('go');
    expect(lemmatize('GONE')).toBe('go');
  });
});
