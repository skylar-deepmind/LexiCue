interface CacheEntry<T> {
  value: T;
  stale: boolean;
}

export class QueryCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 8) {
    this.maxEntries = maxEntries;
  }

  peek(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  isFresh(key: string): boolean {
    return this.entries.get(key)?.stale === false;
  }

  prime(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, stale: false });
  }

  invalidate(key?: string): void {
    if (key !== undefined) {
      const entry = this.entries.get(key);
      if (entry) entry.stale = true;
      return;
    }
    for (const entry of this.entries.values()) entry.stale = true;
  }

  async fetch(key: string, loader: () => Promise<T>, force = false): Promise<T> {
    const cached = this.entries.get(key);
    if (!force && cached && !cached.stale) return cached.value;

    const running = this.pending.get(key);
    if (running) return running;

    const request = loader().then((value) => {
      this.entries.delete(key);
      this.entries.set(key, { value, stale: false });
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      return value;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }
}
