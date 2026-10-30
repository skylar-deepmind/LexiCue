import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { dictionaryContentAssessment, dictionaryOverview, dictionaryReference, FREE_DICTIONARY_ADAPTER, hasSubstantiveTargetContent, isRelationOnlyMeaning, isWiktionaryEntryUrl, lookupFreeDictionary, selectedSnapshot, senseSelections, shouldLookupCambridge, validateDictionaryResult, WIKTIONARY_ATTRIBUTION, WIKTIONARY_MODIFICATIONS, type DictionaryResult } from '../dictionaryResult';
function value(): DictionaryResult {
  const prefix = `wiktionary:${FREE_DICTIONARY_ADAPTER}:`;
  return { schema_version: 1, query: { text: 'test word', language: 'en', context: 'Private context.' }, status: 'partial', default_entry_id: `${prefix}entry:fixture`, entries: [{
    id: `${prefix}entry:fixture`, headword: 'test word', kind: 'expression', expression_type: null, origin: 'headword', parent_headword: null,
    source: { provider: 'wiktionary', dataset: 'Wiktionary', edition: null, release: null, adapter_version: FREE_DICTIONARY_ADAPTER, delivery: 'online', entry_key: `${prefix}entry:fixture`, locator: '/entries/0', entry_url: 'https://en.wiktionary.org/wiki/test_word', retrieved_at: '2026-10-28T08:00:00Z', received_at: '2026-10-28T08:00:00Z', access_channel: 'freedictionaryapi', service_url: 'https://freedictionaryapi.com', content_hash: 'a'.repeat(64), license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' }, attribution: WIKTIONARY_ATTRIBUTION, modifications: WIKTIONARY_MODIFICATIONS },
    match: { type: 'exact', pattern: null, note: null, sense_ids: [] }, notes: [], related_expressions: [], groups: [{ id: `${prefix}group:fixture`, part_of_speech: 'noun', source_part_of_speech: 'noun', pronunciations: [], forms: [], labels: [], notes: [], senses: [{ id: `${prefix}sense:fixture`, meaning: { en: 'A specific object.', zh: null }, labels: [], patterns: [], notes: [], examples: [{ id: `${prefix}example:fixture`, english: 'A test word example.', chinese: null, audio: null }], source_path: '/entries/0/senses/0/subsenses/0', content_kind: 'definition', ancestors: [{ source_path: '/entries/0/senses/0', meaning: { en: 'In a restricted domain.', zh: null }, labels: [{ kind: 'register', text: 'technical' }] }] }] }],
  }], notices: [{ code: 'english_only', text: 'English only', entry_id: null }] };
}
describe('FreeDictionaryAPI separate source contract', () => {
  it('invokes the registered native source with a bounded remaining budget and preserves attribution and typed scope', async () => {
    const result = value(); mocks.invoke.mockResolvedValue(result);
    expect(await lookupFreeDictionary('test word', 'Private context.', 1500)).toBe(result);
    expect(mocks.invoke).toHaveBeenCalledWith('lookup_free_dictionary_expression', { expression: 'test word', context: 'Private context.', timeoutMs: 1500 });
    const snapshot = selectedSnapshot(senseSelections(result)[0]);
    result.entries[0].groups[0].senses[0].labels = [{ kind: 'register', text: 'figuratively' }];
    const reference = dictionaryReference(result)!;
    expect(reference.senses[0].labels).toEqual([{ kind: 'register', text: 'figuratively' }]);
    expect(snapshot.source).toMatchObject({ provider: 'wiktionary', content_hash: 'a'.repeat(64), attribution: WIKTIONARY_ATTRIBUTION });
    expect(snapshot.ancestors?.[0].meaning.en).toBe('In a restricted domain.');
    expect(reference.senses[0].ancestors).toEqual(snapshot.ancestors);
    result.entries[0].groups[0].senses[0].ancestors![0].meaning.en = 'later update';
    result.entries[0].groups[0].senses[0].meaning.en = 'later update';
    expect(snapshot.ancestors?.[0].meaning.en).toBe('In a restricted domain.');
    expect(snapshot.meaning.en).toBe('A specific object.');
    expect(reference.senses[0].meaning.en).toBe('A specific object.');
  });
  it('rejects incomplete metadata, fabricated translations and malformed parent scope', () => {
    for (const mutate of [
      (r: DictionaryResult) => { r.entries[0].source.access_channel = 'author_public_api'; },
      (r: DictionaryResult) => { delete r.entries[0].source.license; },
      (r: DictionaryResult) => { r.entries[0].source.content_hash = 'not-hash'; },
      (r: DictionaryResult) => { r.entries[0].source.entry_url = 'https://en.wiktionary.org/wiki/unrelated'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].meaning.zh = '译词'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].ancestors![0].source_path = '/entries/1/senses/0'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].examples[0].chinese = '译句'; },
      (r: DictionaryResult) => { r.entries[0].groups[0].senses[0].ancestors = []; },
      (r: DictionaryResult) => { r.entries[0].headword = 'unrelated'; r.entries[0].source.entry_url = 'https://en.wiktionary.org/wiki/unrelated'; },
    ]) { const r = value(); mutate(r); expect(() => validateDictionaryResult(r, 'test word', 'wiktionary')).toThrow(); }
  });
  it('checks exact original locator once without collapsing case, spaces, apostrophes or double decoding', () => {
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/test_word', 'test word')).toBe(true);
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/%25', '%')).toBe(true);
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/my%2520bad', 'my bad')).toBe(false);
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/US', 'us')).toBe(false);
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/take__off', 'take off')).toBe(false);
    expect(isWiktionaryEntryUrl('https://en.wiktionary.org/wiki/what%E2%80%99s_up', "what's up")).toBe(false);
    for (const url of ['https://evil.example/wiki/test_word', 'http://en.wiktionary.org/wiki/test_word', 'https://user@en.wiktionary.org/wiki/test_word', 'https://en.wiktionary.org:444/wiki/test_word', 'https://en.wiktionary.org/wiki/test_word?x=1', 'https://en.wiktionary.org/wiki/test_word#English', 'https://en.wiktionary.org/wiki/test%2520word', 'https://en.wiktionary.org/wiki/test%GGword']) expect(isWiktionaryEntryUrl(url, 'test word')).toBe(false);
  });
  it('omits an oversized reference as a whole instead of dropping attribution or required parent context', () => {
    const r = value(); r.entries[0].groups[0].senses[0].ancestors![0].meaning.en = 'x'.repeat(18000);
    expect(dictionaryReference(r)).toBeNull();
    const labels = Array.from({ length: 31 }, (_, i) => ({ kind: 'register', text: `qualifier ${i}` }));
    const tooManyLabels = value(); tooManyLabels.entries[0].groups[0].senses[0].labels = labels;
    expect(dictionaryReference(tooManyLabels)).toBeNull();
    const tooManyParentLabels = value(); tooManyParentLabels.entries[0].groups[0].senses[0].ancestors![0].labels = labels;
    expect(dictionaryReference(tooManyParentLabels)).toBeNull();
  });
});
describe('target definition assessment', () => {
  it('treats complete form relationships as gaps but retains synonyms and abbreviation expansions', () => {
    for (const en of ['Plural of tree.', 'Misspelling of receive.', 'Alternative form of well-being.', "a way of saying 'going to'", 'The act of tokenizing.', 'Clipping of abbreviation.', 'informal for going to', 'colloquial form of going to.']) expect(isRelationOnlyMeaning({ en, zh: null })).toBe(true);
    for (const en of ['Suspicious.', 'Delusional.', 'United States.', 'The act of moving something to a new place.', 'A plural society with diverse beliefs.']) expect(isRelationOnlyMeaning({ en, zh: null })).toBe(false);
  });
  it('does not let an unresolved mother-word reference or pure relation block lookup, while a confirmed inflection remains useful', () => {
    const r = value(); const entry = r.entries[0]; const sense = entry.groups[0].senses[0];
    entry.headword = 'parent'; entry.match.type = 'reference';
    expect(dictionaryContentAssessment(r).kind).toBe('unconfirmed'); expect(shouldLookupCambridge(r)).toBe(true);
    entry.match.type = 'inflection'; entry.match.note = 'Source inflection: requested → parent (past tense).';
    expect(hasSubstantiveTargetContent(r)).toBe(true);
    entry.headword = 'test word'; entry.match.type = 'exact'; sense.content_kind = 'relation';
    expect(dictionaryContentAssessment(r).kind).toBe('relation_only');
    sense.content_kind = 'definition'; expect(dictionaryContentAssessment(r).hasEnglish).toBe(true);
  });
  it('previews substantive Wiktionary senses ahead of relation hints while preserving complete source groups', () => {
    const r = value(); const group = r.entries[0].groups[0];
    const definition = group.senses[0];
    group.senses.unshift({ ...definition, id: 'relation', content_kind: 'relation', meaning: { en: 'Plural of object.', zh: null } });
    expect(dictionaryOverview(r)[0].sense.id).toBe(definition.id);
    expect(group.senses[0].id).toBe('relation');
    expect(dictionaryReference(r)?.senses[0].sense_id).toBe(definition.id);
  });
  it('recognizes substantive content in mixed relationship groups without claiming context disambiguation', () => {
    const r = value(); const sense = r.entries[0].groups[0].senses[0];
    r.entries[0].groups[0].senses.push({ ...sense, id: 'other', content_kind: 'relation', meaning: { en: 'Plural of object.', zh: null } });
    expect(dictionaryContentAssessment(r)).toEqual({ kind: 'substantive', hasEnglish: true, hasChinese: false, reason: 'target_definition' });
  });
});
