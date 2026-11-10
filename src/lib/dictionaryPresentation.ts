/** Labels describe where an explanation came from, independently of cache delivery.
 * Provider identities in results and saved snapshots remain unchanged. */
export function dictionarySourceLabelKey(provider: string | null | undefined): string {
  if (provider === 'longman' || provider === 'local') return 'dictionary.sourceKinds.local';
  if (provider === 'cambridge' || provider === 'wiktionary') return 'dictionary.sourceKinds.online';
  return 'dictionary.sourceKinds.unknown';
}

/** Only distinguish a second online result when both online sources are available. */
export function dictionaryOnlineSourceNumber(provider: string, available: readonly string[]): number | null {
  const online = available.filter(item => dictionarySourceLabelKey(item) === 'dictionary.sourceKinds.online');
  const index = online.indexOf(provider);
  return index > 0 ? index + 1 : null;
}
