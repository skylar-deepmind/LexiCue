import { describe, expect, it, vi } from 'vitest';
import { QueryCache } from '../queryCache';

describe('QueryCache', () => {
  it('reuses a fresh result for the same query key', async () => {
    const cache = new QueryCache<number>();
    const loader = vi.fn().mockResolvedValue(42);

    await expect(cache.fetch('en:all', loader)).resolves.toBe(42);
    await expect(cache.fetch('en:all', loader)).resolves.toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent requests', async () => {
    const cache = new QueryCache<number>();
    let resolve!: (value: number) => void;
    const loader = vi.fn(() => new Promise<number>((done) => { resolve = done; }));

    const first = cache.fetch('same', loader);
    const second = cache.fetch('same', loader);
    resolve(7);

    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps stale data readable while refreshing it', async () => {
    const cache = new QueryCache<number>();
    await cache.fetch('stats', async () => 1);
    cache.invalidate('stats');

    expect(cache.peek('stats')).toBe(1);
    expect(cache.isFresh('stats')).toBe(false);
    await expect(cache.fetch('stats', async () => 2)).resolves.toBe(2);
    expect(cache.peek('stats')).toBe(2);
  });

  it('isolates values by query key and supports global invalidation', async () => {
    const cache = new QueryCache<number>();
    await cache.fetch('en', async () => 1);
    await cache.fetch('de', async () => 2);
    cache.invalidate();

    expect(cache.isFresh('en')).toBe(false);
    expect(cache.isFresh('de')).toBe(false);
  });
});
