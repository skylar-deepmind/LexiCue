import { describe, expect, it } from 'vitest';
import { readPaged } from './readPaged';

describe('readPaged', () => {
  it.each([[260, 200], [75, 50]])('restores %i items under a %i-item backend cap', async (count, cap) => {
    const calls: number[] = [];
    const result = await readPaged(count, 0, cap, async (limit, offset) => {
      calls.push(limit);
      return {items: Array.from({length: Math.min(limit, count - offset)}, (_, i) => offset + i), total: count};
    }, () => true);
    expect(result?.items).toEqual(Array.from({length: count}, (_, i) => i));
    expect(calls.every(limit => limit <= cap)).toBe(true);
  });
  it('drops a late response after invalidation', async () => {
    const result = await readPaged(10, 0, 5, async () => ({items:[1], total:10}), () => false);
    expect(result).toBeNull();
  });
});
