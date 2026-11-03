import { describe, expect, it } from 'vitest';
import { dictionaryOnlineSourceNumber, dictionarySourceLabelKey } from '../dictionaryPresentation';

describe('dictionary source labels', () => {
  it('maps real provider identities and leaves missing or unknown providers unclassified', () => {
    expect(dictionarySourceLabelKey('longman')).toBe('dictionary.sourceKinds.local');
    expect(dictionarySourceLabelKey('cambridge')).toBe('dictionary.sourceKinds.online');
    expect(dictionarySourceLabelKey('wiktionary')).toBe('dictionary.sourceKinds.online');
    for (const provider of [null, undefined, '', 'cache', 'other']) {
      expect(dictionarySourceLabelKey(provider)).toBe('dictionary.sourceKinds.unknown');
    }
  });

  it('numbers only a second available online source without changing its provider identity', () => {
    expect(dictionaryOnlineSourceNumber('wiktionary', ['longman', 'wiktionary'])).toBeNull();
    expect(dictionaryOnlineSourceNumber('cambridge', ['longman', 'cambridge', 'wiktionary'])).toBeNull();
    expect(dictionaryOnlineSourceNumber('wiktionary', ['longman', 'cambridge', 'wiktionary'])).toBe(2);
    expect(dictionaryOnlineSourceNumber('longman', ['longman', 'cambridge', 'wiktionary'])).toBeNull();
    expect(dictionaryOnlineSourceNumber('unknown', ['longman', 'cambridge', 'wiktionary'])).toBeNull();
  });
});
