import { describe, expect, it, vi } from 'vitest';
import raw from './fixtures/wiktionary-local-v2.json';
import { dictionaryReference, isLocalWiktionarySource, isWiktionarySource, lookupFreeDictionary, selectedSnapshot, senseSelections, validateDictionaryResult, type DictionaryResult } from '../dictionaryResult';
import { dictionaryOnlineSourceNumber, dictionarySourceLabelKey } from '../dictionaryPresentation';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
const fixture = () => structuredClone(raw) as DictionaryResult;
describe('local Wiktionary v2 boundary', () => {
  it('accepts an actual Rust result from the pinned daily database and freezes its revision and ordinary example', () => {
    const result = validateDictionaryResult(fixture(), 'soliloquy', 'wiktionary');
    const selection = senseSelections(result)[0];
    expect(isLocalWiktionarySource(selection.entry.source, 'soliloquy')).toBe(true);
    expect(isWiktionarySource(selection.entry.source, 'soliloquy')).toBe(false);
    const snapshot = selectedSnapshot(selection);
    expect(snapshot.source.source_revision).toMatch(/^[1-9][0-9]*$/u);
    expect(snapshot.source.source_page).toMatch(/^[1-9][0-9]*$/u);
    expect(snapshot.source.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot.examples[0].english).toContain('soliloquy');
    const reference = dictionaryReference(result)!;
    result.entries[0].groups[0].senses[0].meaning.en = 'later cache change';
    expect(reference.senses[0].meaning.en).not.toBe('later cache change');
    expect(reference.senses[0].source.source_revision).toBe(snapshot.source.source_revision);
  });
  it('rejects forged local revision, source identity, translation, audio and parent scope', () => {
    for (const change of [
      (r: DictionaryResult) => { r.entries[0].source.source_revision = '0'; },
      (r: DictionaryResult) => { r.entries[0].source.release = 'mixed-release'; },
      (r: DictionaryResult) => { r.entries[0].source.entry_url = 'https://en.wiktionary.org/wiki/other'; },
      (r: DictionaryResult) => { r.entries[0].source.access_channel = 'freedictionaryapi'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].meaning.zh = '不能成为本地释义'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].examples[0].audio = {kind:'remote_url',location:'https://example.com/audio'}; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].source_path = '/records/1/senses/0'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].ancestors = [{ source_path: '/records/1/senses/0/ancestors/0', meaning: {en:'Unconfirmed parent.',zh:null},labels:[] }]; },
    ]) { const result = fixture(); change(result); expect(() => validateDictionaryResult(result, 'soliloquy')).toThrow(); }
  });
  it('keeps the online adapter boundary and source tabs distinct from local Wiktionary', async () => {
    mocks.invoke.mockResolvedValue(fixture());
    await expect(lookupFreeDictionary('soliloquy', '')).rejects.toThrow('dictionary_invalid_source');
    expect(dictionarySourceLabelKey('local')).toBe('dictionary.sourceKinds.local');
    expect(dictionaryOnlineSourceNumber('wiktionary', ['local','cambridge','wiktionary'])).toBe(2);
  });
});
