import { describe, expect, it } from 'vitest';
import { importEntryVisible, navigationActive } from '../NavigationItems';

describe('import entry route ownership', () => {
  it('belongs only to the normalized material summary route', () => {
    expect(importEntryVisible('/files')).toBe(true);
    expect(importEntryVisible('/files/')).toBe(true);
    expect(importEntryVisible('/files///')).toBe(true);
    for (const path of ['/files/42', '/files/42/', '/example', '/saved', '/settings', '/legacy', '/', '/files-archive']) {
      expect(importEntryVisible(path), path).toBe(false);
    }
  });
  it('preserves the broader materials navigation selection for reading', () => {
    expect(navigationActive('/files/42', '/files')).toBe(true);
    expect(navigationActive('/example', '/files')).toBe(true);
    expect(importEntryVisible('/files/42')).toBe(false);
    expect(importEntryVisible('/example')).toBe(false);
  });
});
