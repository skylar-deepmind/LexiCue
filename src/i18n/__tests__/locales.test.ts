import { describe, it, expect } from 'vitest';
import zh from '../locales/zh.json';
import en from '../locales/en.json';
import ja from '../locales/ja.json';
import de from '../locales/de.json';

const PLURAL_SUFFIX = /_(one|other|few|many|zero)$/;

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      keys.push(...flatten(value as Record<string, unknown>, path));
    } else {
      keys.push(path.replace(PLURAL_SUFFIX, ''));
    }
  }
  return keys;
}

const LOCALES: Record<string, unknown> = { zh, en, ja, de };

describe('i18n locales', () => {
  it('all locales contain the exact same keys', () => {
    const reference = flatten(zh as Record<string, unknown>).sort();
    const referenceSet = new Set(reference);
    for (const [name, resource] of Object.entries(LOCALES)) {
      const keys = flatten(resource as Record<string, unknown>).sort();
      const keySet = new Set(keys);
      expect([...keySet].sort(), `${name} keys`).toEqual(reference);
      expect(keys.length, `${name} key count`).toBeGreaterThanOrEqual(referenceSet.size);
    }
  });

  it('has no empty or whitespace-only values', () => {
    const walk = (obj: Record<string, unknown>, prefix: string, found: string[]) => {
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') {
          walk(value as Record<string, unknown>, path, found);
        } else if (typeof value === 'string' && value.trim() === '') {
          found.push(path);
        }
      }
      return found;
    };
    for (const [name, resource] of Object.entries(LOCALES)) {
      expect(walk(resource as Record<string, unknown>, '', []), `${name} empty values`).toEqual([]);
    }
  });
});
