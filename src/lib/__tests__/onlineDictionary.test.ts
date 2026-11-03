import { describe, expect, it, vi } from 'vitest';
import type { DictionaryResult } from '../dictionaryResult';
import { runOnlineDictionary, shouldContinueToFreeDictionary } from '../onlineDictionary';

function content(english: string, chinese: string | null = null): DictionaryResult {
  return { schema_version: 1, query: { text: 'target', language: 'en', context: null }, status: chinese ? 'found' : 'partial', default_entry_id: 'entry', notices: [], entries: [{
    id: 'entry', headword: 'target', kind: 'word', expression_type: null, origin: 'headword', parent_headword: null,
    source: { provider: 'longman', dataset: 'fixture', release: 'test', edition: null, adapter_version: 'test', entry_key: 'target', locator: null, delivery: 'local', entry_url: null, retrieved_at: null },
    match: { type: 'exact', pattern: null, note: null, sense_ids: [] }, notes: [], related_expressions: [], groups: [{ id: 'group', part_of_speech: 'noun', source_part_of_speech: 'noun', pronunciations: [], forms: [], notes: [], labels: [], senses: [{ id: 'sense', meaning: { en: english, zh: chinese }, labels: [], patterns: [], examples: [], notes: [] }] }],
  }] };
}
const missing: DictionaryResult = { schema_version: 1, query: { text: 'target', language: 'en', context: null }, status: 'not_found', default_entry_id: null, entries: [], notices: [] };
const signal = () => new AbortController().signal;

describe('the sequential reading fallback controller', () => {
  it('uses no transport for complete local content and stops at Cambridge substantive content', async () => {
    const cambridge = vi.fn().mockResolvedValue(content('A useful definition.', '实义'));
    const free = vi.fn(); const onResult = vi.fn();
    const options = { expression: 'target', context: 'PRIVATE', signal: signal(), cambridge, free, onResult };
    expect((await runOnlineDictionary({ ...options, local: content('A useful definition.', '实义') })).attempted).toEqual([]);
    expect(cambridge).not.toHaveBeenCalled();
    expect((await runOnlineDictionary({ ...options, local: missing })).attempted).toEqual(['cambridge']);
    expect(free).not.toHaveBeenCalled();
  });
  it('supplements English-only local content with Cambridge, without automatically adding another English source', async () => {
    const cambridge = vi.fn().mockRejectedValue(Error('offline')); const free = vi.fn();
    const outcome = await runOnlineDictionary({ expression: 'target', context: '', local: content('Suspicious.'), signal: signal(), onResult: vi.fn(), cambridge, free });
    expect(outcome.attempted).toEqual(['cambridge']); expect(free).not.toHaveBeenCalled();
  });
  it('continues after only relation notes or Cambridge failure and gives the next native request the remaining budget', async () => {
    let time = 100;
    const cambridge = vi.fn().mockImplementation(async () => { time += 10_150; return content('Plural of anotherword.'); });
    const free = vi.fn().mockResolvedValue(content('A substantive target definition.'));
    const onResult = vi.fn();
    const outcome = await runOnlineDictionary({ expression: 'target', context: 'PRIVATE', local: content('Clipping of anotherword.'), signal: signal(), onResult, cambridge, free, now: () => time });
    expect(outcome).toEqual({ attempted: ['cambridge', 'wiktionary'], issue: null });
    expect(free).toHaveBeenCalledWith('target', 'PRIVATE', 7_850);
    expect(onResult.mock.calls.map(call => call[0])).toEqual(['cambridge', 'wiktionary']);
    expect(shouldContinueToFreeDictionary(content('Delusional.'), missing)).toBe(false);
  });
  it('offers an explicit other-definition request even when Cambridge has a different substantive sense', async () => {
    const cambridge = vi.fn(); const free = vi.fn().mockResolvedValue(content('Another definition.'));
    const outcome = await runOnlineDictionary({ expression: 'target', context: '', local: content('Existing definition.', '实义'), mode: 'continue', signal: signal(), onResult: vi.fn(), cambridge, free });
    expect(outcome.attempted).toEqual(['wiktionary']); expect(cambridge).not.toHaveBeenCalled();
  });
  it('does not launch or emit the next source after a query closes or is replaced', async () => {
    const controller = new AbortController(); const onResult = vi.fn(); const free = vi.fn();
    const cambridge = vi.fn().mockImplementation(async () => { controller.abort(); return missing; });
    await runOnlineDictionary({ expression: 'target', context: '', local: null, signal: controller.signal, onResult, cambridge, free });
    expect(onResult).not.toHaveBeenCalled(); expect(free).not.toHaveBeenCalled();
  });
  it('stops at the single overall deadline and preserves rate-limit feedback without retry loops', async () => {
    let time = 0; const free = vi.fn();
    const cambridge = vi.fn().mockImplementation(async () => { time = 18_001; return missing; });
    expect((await runOnlineDictionary({ expression: 'target', context: '', local: null, signal: signal(), onResult: vi.fn(), cambridge, free, now: () => time })).issue).toBe('deadline');
    expect(free).not.toHaveBeenCalled();
    const limited = { ...missing, status: 'unavailable' as const, notices: [{ code: 'free_rate_limited', text: '', entry_id: null }] };
    const limitedTransport = vi.fn().mockResolvedValue(limited);
    expect((await runOnlineDictionary({ expression: 'target', context: '', local: null, mode: 'continue', signal: signal(), onResult: vi.fn(), free: limitedTransport })).issue).toBe('rate_limited');
    expect(limitedTransport).toHaveBeenCalledTimes(1);
  });
});
