import type { DictionaryResult } from './dictionaryResult';
/** Provider-specific IDs do not identify new uses; compare actual meanings. */
export function dictionarySupplement(local: DictionaryResult | null, online: DictionaryResult | null): DictionaryResult | null {
  if (!online) return null;
  const normalize = (value: string | null) => (value ?? '').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
  const known = new Set<string>();
  for (const entry of local?.entries ?? []) for (const group of entry.groups) for (const sense of group.senses) {
    if (sense.meaning.en) known.add(normalize(sense.meaning.en));
    if (sense.meaning.zh) known.add(normalize(sense.meaning.zh));
  }
  return { ...online, entries: online.entries.map(entry => ({ ...entry, groups: entry.groups.map(group => ({ ...group, senses: group.senses.filter(sense => {
    const keys = [sense.meaning.en, sense.meaning.zh].filter((text): text is string => !!text).map(normalize);
    if (!keys.length || keys.some(key => known.has(key))) return false;
    keys.forEach(key => known.add(key)); return true;
  }) })).filter(group => group.senses.length) })).filter(entry => entry.groups.length) };
}
