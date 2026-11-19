export type LibraryNameKey = 'all' | 'untagged';
export type LibraryNames = Partial<Record<LibraryNameKey, string>>;
export function normalizeLibraryNames(value: unknown): LibraryNames {
  if (!value || typeof value !== 'object') return {};
  const names: LibraryNames = {};
  for (const key of ['all', 'untagged'] as const) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === 'string') {
      const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (name) names[key] = name;
    }
  }
  return names;
}
