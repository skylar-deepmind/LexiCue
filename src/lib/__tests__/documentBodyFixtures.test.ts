/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { rangeFromDocument } from '../documentCore';
import { extractDocumentBytes } from '../documentExtract';
import expected from './fixtures/document-body/expected.json';

for (const [name, test] of Object.entries(expected)) {
  it(`extracts the expected reading body from ${name}`, async () => {
    const bytes = await readFile(new URL(`./fixtures/document-body/${name}`, import.meta.url));
    const extraction = extractDocumentBytes(bytes, name);
    if ('error' in test) {
      await expect(extraction).rejects.toThrow(test.error);
      return;
    }
    const full = await extraction;
    expect(full.content).toBe(test.content);
    for (const block of full.document.blocks) {
      expect(full.content.slice(block.start_utf16, block.end_utf16)).toBe(block.text);
    }
    if ('pages' in test) {
      const joined = full.document.blocks.find(block => block.locations.length > 1);
      expect(joined?.locations.map(location => location.page)).toEqual([1, 2]);
      expect(full.segments.map(segment => segment.en_text)).toContain(
        'The keeper explained that the light had guided ships through the narrow channel for over a century.',
      );
      for (const [index, content] of test.pages.entries()) {
        const page = index + 1;
        const selected = await rangeFromDocument(full, { kind: 'pages', start: page, end: page });
        expect(selected.content).toBe(content);
        expect(selected.document.blocks.flatMap(block => block.locations.map(location => location.page))).toEqual(
          Array(selected.document.blocks.length).fill(page),
        );
      }
    }
    if ('segments' in test) {
      expect(full.segments.map(s => [s.en_text, s.start_time, s.end_time])).toEqual(test.segments);
      expect(full.segments[1].zh_text).toBe('我们黎明时听到铃声，就收拾了行李。');
    }
  });
}
