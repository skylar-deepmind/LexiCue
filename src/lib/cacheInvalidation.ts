export type CacheDomain = 'files' | 'words' | 'phrases' | 'review' | 'insights' | 'storage';

const invalidators = new Map<CacheDomain, Set<() => void>>();

export function registerCacheInvalidator(domain: CacheDomain, invalidate: () => void): void {
  const callbacks = invalidators.get(domain) ?? new Set<() => void>();
  callbacks.add(invalidate);
  invalidators.set(domain, callbacks);
}

export function invalidateCaches(...domains: CacheDomain[]): void {
  for (const domain of domains) {
    for (const invalidate of invalidators.get(domain) ?? []) invalidate();
  }
}
