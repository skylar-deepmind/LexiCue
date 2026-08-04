import lemmaMap from './lemmas.json';

const lookup: Record<string, string> = lemmaMap;

export function lemmatize(word: string): string {
  const lower = word.toLowerCase();
  return lookup[lower] ?? lower;
}
