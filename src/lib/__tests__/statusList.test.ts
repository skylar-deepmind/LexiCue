import { describe, it, expect } from 'vitest';
import { applyStatusUpdates } from '../statusList';
import type { WordStatus } from '../types';

interface Item {
  id: number;
  lemma: string;
  status: WordStatus;
}

const words: Item[] = [
  { id: 1, lemma: 'apple', status: 'unprocessed' },
  { id: 2, lemma: 'book', status: 'unprocessed' },
  { id: 3, lemma: 'cat', status: 'unprocessed' },
  { id: 4, lemma: 'dog', status: 'unprocessed' },
];

describe('applyStatusUpdates', () => {
  it('updates statuses in place when filter is "all"', () => {
    const { words: result, removed } = applyStatusUpdates(
      words,
      [{ id: 2, status: 'known' }],
      'all',
    );
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({ id: 2, lemma: 'book', status: 'known' });
    expect(result[0]).toEqual(words[0]);
    expect(removed).toEqual([]);
  });

  it('keeps items whose new status matches the filter and removes the rest', () => {
    const { words: result, removed } = applyStatusUpdates(
      words,
      [
        { id: 1, status: 'learning' },
        { id: 2, status: 'known' },
      ],
      'learning',
    );
    expect(result).toEqual([
      { id: 1, lemma: 'apple', status: 'learning' },
      { id: 3, lemma: 'cat', status: 'unprocessed' },
      { id: 4, lemma: 'dog', status: 'unprocessed' },
    ]);
    expect(removed).toEqual([{ item: words[1], index: 1 }]);
  });

  it('removes items whose new status no longer matches the filter', () => {
    const { words: result, removed } = applyStatusUpdates(
      words,
      [{ id: 2, status: 'learning' }],
      'unprocessed',
    );
    expect(result).toEqual([
      { id: 1, lemma: 'apple', status: 'unprocessed' },
      { id: 3, lemma: 'cat', status: 'unprocessed' },
      { id: 4, lemma: 'dog', status: 'unprocessed' },
    ]);
    expect(removed).toEqual([{ item: words[1], index: 1 }]);
  });

  it('records original indices for multiple removed items', () => {
    const { words: result, removed } = applyStatusUpdates(
      words,
      [
        { id: 1, status: 'known' },
        { id: 4, status: 'ignored' },
      ],
      'unprocessed',
    );
    expect(result).toEqual([
      { id: 2, lemma: 'book', status: 'unprocessed' },
      { id: 3, lemma: 'cat', status: 'unprocessed' },
    ]);
    expect(removed).toEqual([
      { item: words[0], index: 0 },
      { item: words[3], index: 3 },
    ]);
  });

  it('ignores updates for ids not in the list', () => {
    const { words: result, removed } = applyStatusUpdates(
      words,
      [{ id: 99, status: 'learning' }],
      'unprocessed',
    );
    expect(result).toEqual(words);
    expect(removed).toEqual([]);
  });
});
