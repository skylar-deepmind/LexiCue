export type CacheDomain = 'files' | 'words' | 'phrases' | 'review' | 'insights' | 'storage';

const invalidators = new Map<CacheDomain, Set<(hard?: boolean) => void>>();

export function registerCacheInvalidator(domain: CacheDomain, invalidate: (hard?: boolean) => void): void {
  const callbacks = invalidators.get(domain) ?? new Set<(hard?: boolean) => void>();
  callbacks.add(invalidate);
  invalidators.set(domain, callbacks);
}

export function invalidateCaches(...domains: CacheDomain[]): void {
  invalidate(domains, false);
}
export function clearCaches(...domains: CacheDomain[]): void {
  invalidate(domains, true);
}
function invalidate(domains: CacheDomain[], hard: boolean): void {
  for (const domain of domains) {
    for (const invalidate of invalidators.get(domain) ?? []) invalidate(hard);
  }
}
