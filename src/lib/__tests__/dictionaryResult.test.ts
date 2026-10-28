import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { CURRENT_PUBLIC_CAMBRIDGE_ADAPTER, accentPronunciations, combineDictionaryResults, defaultSense, dictionaryOverview, dictionaryReference, dictionarySourceResult, formatIpa, lookupCambridge, lookupLongman, selectedSnapshot, senseSelections, shouldLookupCambridge, type DictionaryResult, type DictionarySense } from '../dictionaryResult';

function sense(id: string): DictionarySense {
  return {
    id,
    meaning: { en: `English meaning of ${id}`, zh: `${id}的释义` },
    labels: [{ kind: 'register', text: 'formal' }],
    examples: [1, 2, 3].map(index => ({ id: `${id}:example-${index}`, english: `${id} example ${index}.`, chinese: null, audio: null })),
    patterns: [],
    notes: [],
  };
}

function result(text = 'record'): DictionaryResult {
  return {
    schema_version: 1,
    query: { text, language: 'en', context: 'Please record the result.' },
    status: 'found',
    default_entry_id: 'longman:fixture:record-noun',
    entries: ['noun', 'verb'].map(part => ({
      id: `longman:fixture:record-${part}`,
      headword: 'record', kind: 'word', expression_type: null,
      origin: 'headword', parent_headword: null,
      source: {
        provider: 'longman', dataset: 'ldoce6-en-zh', edition: '6', release: 'fixture-release',
        adapter_version: 'fixture-adapter', entry_key: `record-${part}`, locator: `fixture-${part}`,
        delivery: 'local', entry_url: null, retrieved_at: null,
      },
      match: { type: 'exact', pattern: null, note: null, sense_ids: [] },
      groups: [{
        id: `longman:fixture:record-${part}:group`, part_of_speech: part, source_part_of_speech: part,
        pronunciations: [], forms: [], labels: [], notes: [],
        senses: [sense(`${part}-1`), sense(`${part}-2`)],
      }],
      notes: [], related_expressions: [],
    })),
    notices: [],
  };
}

beforeEach(() => vi.clearAllMocks());

describe('selected dictionary sense and saved identity', () => {
  it('keeps all same-source entries and restores a saved later sense outside the default entry', () => {
    const value = result();
    expect(senseSelections(value).map(item => item.sense.id)).toEqual(['noun-1', 'noun-2', 'verb-1', 'verb-2']);
    expect(defaultSense(value)).toBe('noun-1');
    expect(defaultSense(value, 'verb-2')).toBe('verb-2');
    expect(defaultSense(value, 'retired-release-sense')).toBe('noun-1');
  });

  it('snapshots the chosen later sense with its own source, group and examples', () => {
    const selected = senseSelections(result()).find(item => item.sense.id === 'verb-2')!;
    selected.group.labels = [{ kind: 'grammar', text: 'transitive' }, { kind: 'register', text: 'formal' }];
    const snapshot = selectedSnapshot(selected);
    expect(snapshot.headword).toBe('record');
    expect(snapshot.entry_id).toBe('longman:fixture:record-verb');
    expect(snapshot.group_id).toBe('longman:fixture:record-verb:group');
    expect(snapshot.sense_id).toBe('verb-2');
    expect(snapshot.meaning).toEqual({ en: 'English meaning of verb-2', zh: 'verb-2的释义' });
    expect(snapshot.source).toMatchObject({ provider: 'longman', release: 'fixture-release', entry_key: 'record-verb' });
    expect(snapshot.labels).toEqual([{ kind: 'grammar', text: 'transitive' }, { kind: 'register', text: 'formal' }]);
    expect(snapshot.examples.map(item => item.id)).toEqual(['verb-2:example-1', 'verb-2:example-2']);
    expect(snapshot.examples.every(item => !('audio' in item))).toBe(true);
  });
});

describe('native lookup boundary before saving', () => {
  it('preserves US case and the original context when invoking the native dictionary', async () => {
    const value = result('US');
    mocks.invoke.mockResolvedValue(value);
    await expect(lookupLongman('US', 'Help us in the US.')).resolves.toBe(value);
    expect(mocks.invoke).toHaveBeenCalledWith('lookup_longman_expression', { expression: 'US', context: 'Help us in the US.' });
    mocks.invoke.mockResolvedValue(result('us'));
    await expect(lookupLongman('US', 'Help us in the US.')).rejects.toThrow('dictionary_invalid_result');
  });

  it('rejects out-of-scope senses instead of allowing an expression to save unrelated meanings', async () => {
    const value = result('look it up');
    value.entries[0].match.sense_ids = ['noun-2'];
    mocks.invoke.mockResolvedValue(value);
    await expect(lookupLongman('look it up', 'Please look it up.')).rejects.toThrow('dictionary_invalid_scope');
  });

  it('rejects ambiguous duplicate sense identities and a missing default entry', async () => {
    const duplicate = result();
    duplicate.entries[1].groups[0].senses[0].id = 'noun-1';
    mocks.invoke.mockResolvedValue(duplicate);
    await expect(lookupLongman('record', '')).rejects.toThrow('dictionary_invalid_sense');
    const missing = result();
    missing.default_entry_id = 'missing';
    mocks.invoke.mockResolvedValue(missing);
    await expect(lookupLongman('record', '')).rejects.toThrow('dictionary_invalid_default');
  });

  it('retains unavailable as a distinct empty result and rejects falsely usable failure data', async () => {
    const unavailable = result();
    unavailable.status = 'unavailable'; unavailable.entries = []; unavailable.default_entry_id = null;
    unavailable.notices = [{ code: 'package_unavailable', text: 'Package unavailable', entry_id: null }];
    mocks.invoke.mockResolvedValue(unavailable);
    await expect(lookupLongman('record', '')).resolves.toBe(unavailable);
    const contradictory = result(); contradictory.status = 'not_found';
    mocks.invoke.mockResolvedValue(contradictory);
    await expect(lookupLongman('record', '')).rejects.toThrow('dictionary_invalid_status');
  });
});

describe('Cambridge fallback and independent source boundaries', () => {
  function online(text = 'record'): DictionaryResult {
    const value = result(text);
    const rewrite = (id: string) => `cambridge:fixture:${id}`;
    for (const entry of value.entries) {
      entry.id = rewrite(entry.id);
      entry.source = { ...entry.source, provider: 'cambridge', dataset: 'english-chinese-simplified', edition: null, release: null, adapter_version: 'cambridge-test-v1', delivery: 'online', entry_url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/record', retrieved_at: '2026-10-26T01:00:00.000Z' };
      for (const group of entry.groups) {
        group.id = rewrite(group.id);
        for (const sense of group.senses) { sense.id = rewrite(sense.id); for (const example of sense.examples) example.id = rewrite(example.id); }
      }
    }
    value.default_entry_id = value.entries[0].id;
    return value;
  }

  it('accepts a real online source without inventing release or edition, and snapshots provenance', async () => {
    const value = online(); mocks.invoke.mockResolvedValue(value);
    expect(await lookupCambridge('record', 'Private reading context.')).toBe(value);
    expect(mocks.invoke).toHaveBeenCalledWith('lookup_cambridge_expression', { expression: 'record', context: 'Private reading context.' });
    const snapshot = selectedSnapshot(senseSelections(value)[3]);
    expect(snapshot.source).toMatchObject({ provider: 'cambridge', release: null, edition: null, entry_url: value.entries[1].source.entry_url, retrieved_at: '2026-10-26T01:00:00.000Z' });
    expect(snapshot.meaning).toEqual(value.entries[1].groups[0].senses[1].meaning);
    expect(selectedSnapshot(senseSelections(result())[0]).source).not.toHaveProperty('entry_url');
  });

  function publicOnline(): DictionaryResult {
    const value = online();
    for (const entry of value.entries) {
      Object.assign(entry.source, { dataset: 'Cambridge Dictionary (author public API)', adapter_version: CURRENT_PUBLIC_CAMBRIDGE_ADAPTER, access_channel: 'author_public_api', service_url: 'https://dictionary-api.eliaschen.dev', received_at: '2026-10-26T03:04:05Z', entry_url: null, retrieved_at: null });
    }
    const rewriteIds = (item: unknown): void => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) { item.forEach(rewriteIds); return; }
      const object = item as Record<string, unknown>;
      if (typeof object.id === 'string') object.id = `cambridge:public:${CURRENT_PUBLIC_CAMBRIDGE_ADAPTER}:${object.id}`;
      Object.values(object).forEach(rewriteIds);
    };
    value.entries.forEach(rewriteIds); value.default_entry_id = value.entries[0].id;
    return value;
  }

  it('accepts explicit public provenance and snapshots the later meaning with unknown original metadata', async () => {
    const value = publicOnline(); mocks.invoke.mockResolvedValue(value);
    await expect(lookupCambridge('record', 'Private context.')).resolves.toBe(value);
    const selection = senseSelections(value)[3];
    const snapshot = selectedSnapshot(selection);
    expect(snapshot.sense_id).toBe(selection.sense.id);
    expect(snapshot.meaning).toEqual(selection.sense.meaning);
    expect(snapshot.examples).toEqual(selection.sense.examples.slice(0, 2).map(({ id, english, chinese }) => ({ id, english, chinese })));
    expect(snapshot.source).toMatchObject({ provider: 'cambridge', access_channel: 'author_public_api', service_url: 'https://dictionary-api.eliaschen.dev', received_at: '2026-10-26T03:04:05Z', edition: null, release: null });
    expect(snapshot.source).not.toHaveProperty('entry_url');
    expect(snapshot.source).not.toHaveProperty('retrieved_at');
    expect(selectedSnapshot(senseSelections(result())[0]).source).not.toHaveProperty('access_channel');
  });

  it('rejects a whole mixed translated and English-only public payload while keeping uniform English-only partial results usable', async () => {
    const mixed = publicOnline(); mixed.entries[1].groups[0].senses[1].meaning.zh = null;
    mocks.invoke.mockResolvedValue(mixed);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_unconfirmed_scope');
    const splitEntries = publicOnline(); splitEntries.entries[1].groups.forEach(group => group.senses.forEach(sense => sense.meaning.zh = null));
    mocks.invoke.mockResolvedValue(splitEntries);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_unconfirmed_scope');
    const englishOnly = publicOnline(); englishOnly.status = 'partial';
    englishOnly.notices = [{ code: 'english_only', text: 'English only', entry_id: null }];
    englishOnly.entries.forEach(entry => entry.groups.forEach(group => group.senses.forEach(sense => sense.meaning.zh = null)));
    mocks.invoke.mockResolvedValue(englishOnly);
    await expect(lookupCambridge('record', '')).resolves.toBe(englishOnly);
  });

  it('rejects retired public query adapters while retaining their snapshot source identity', async () => {
    const old = publicOnline(); old.entries.forEach(entry => entry.source.adapter_version = 'cambridge-public-v1.0.0');
    mocks.invoke.mockResolvedValue(old);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_source');
  });

  it('requires complete controlled public metadata instead of relaxing the legacy source boundary', async () => {
    for (const change of [
      { access_channel: undefined }, { service_url: undefined }, { received_at: undefined },
      { service_url: 'https://dictionary-api.eliaschen.dev.evil.example' },
      { received_at: 'unknown' }, { adapter_version: 'cambridge-v1.0.0' },
      { entry_url: 'https://dictionary.cambridge.org/dictionary/english/record' },
      { retrieved_at: '2026-10-26T03:04:05Z' }, { edition: '6' },
      { release: 'invented-release' }, { provider: 'longman' }, { delivery: 'local' },
    ]) {
      const value = publicOnline(); Object.assign(value.entries[0].source, change); mocks.invoke.mockResolvedValue(value);
      await expect(lookupCambridge('record', '')).rejects.toThrow();
    }
    const legacy = online(); legacy.entries[0].source.entry_url = null; mocks.invoke.mockResolvedValue(legacy);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_source');
    const legacyId = publicOnline(); legacyId.entries[0].groups[0].senses[0].id = 'cambridge:legacy:sense'; mocks.invoke.mockResolvedValue(legacyId);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_identity');
    const cached = publicOnline(); cached.entries.forEach(entry => entry.source.delivery = 'cache');
    mocks.invoke.mockResolvedValue(cached);
    await expect(lookupCambridge('record', '')).resolves.toBe(cached);
    expect(cached.entries[0].source.received_at).toBe('2026-10-26T03:04:05Z');
  });

  it('keeps pattern-only examples with the selected Cambridge sense in its portable snapshot', () => {
    const value = online();
    const selected = senseSelections(value)[3];
    const ownExamples = selected.sense.examples;
    selected.sense.examples = [];
    selected.sense.patterns = [{ id: `${selected.sense.id}:pattern`, text: 'record something for somebody', explanation: null, labels: [], examples: ownExamples, notes: [] }];
    const snapshot = selectedSnapshot(selected);
    expect(snapshot.source.provider).toBe('cambridge');
    expect(snapshot.sense_id).toBe(selected.sense.id);
    expect(snapshot.examples).toEqual(ownExamples.slice(0, 2).map(({ id, english, chinese }) => ({ id, english, chinese })));
    expect(snapshot.patterns).toEqual(['record something for somebody']);
    expect(snapshot.examples.every(example => example.id.startsWith(selected.sense.id))).toBe(true);
  });

  it('rejects the wrong provider, identity, source URL, or missing fetch time before a save', async () => {
    const wrongProvider = result(); mocks.invoke.mockResolvedValue(wrongProvider);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_entry');
    const wrongQuery = online('us'); mocks.invoke.mockResolvedValue(wrongQuery);
    await expect(lookupCambridge('US', '')).rejects.toThrow('dictionary_invalid_result');
    for (const url of ['https://dictionary.cambridge.org.evil.example/dictionary/record', 'http://dictionary.cambridge.org/dictionary/record', 'https://dictionary.cambridge.org/search/', 'https://evil.example/record']) {
      const value = online(); value.entries[0].source.entry_url = url; mocks.invoke.mockResolvedValue(value);
      await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_source');
    }
    const missingTime = online(); missingTime.entries[0].source.retrieved_at = null; mocks.invoke.mockResolvedValue(missingTime);
    await expect(lookupCambridge('record', '')).rejects.toThrow('dictionary_invalid_source');
  });

  it('does not send a complete local bilingual result online for optional missing audio or example translations', () => {
    const local = result();
    local.entries[0].groups[0].senses[1].meaning.zh = null;
    expect(shouldLookupCambridge(local)).toBe(false);
    local.status = 'partial'; expect(shouldLookupCambridge(local)).toBe(true);
    local.status = 'not_found'; local.entries = []; local.default_entry_id = null; expect(shouldLookupCambridge(local)).toBe(true);
    local.status = 'unavailable'; expect(shouldLookupCambridge(local)).toBe(true);
    expect(shouldLookupCambridge(null)).toBe(true);
  });

  it('keeps both original sources while selecting a provider-specific default and status', () => {
    const local = result(); const remote = online();
    local.status = 'partial';
    local.entries.forEach(entry => entry.groups.forEach(group => group.senses.forEach(sense => sense.meaning.zh = null)));
    const combined = combineDictionaryResults(local, remote, 'cambridge')!;
    expect(combined.status).toBe('found'); expect(combined.default_entry_id).toBe(remote.default_entry_id);
    expect(combined.entries).toEqual([...local.entries, ...remote.entries]);
    const localOnly = dictionarySourceResult(combined, 'longman')!;
    expect(localOnly.status).toBe('partial'); expect(localOnly.entries).toEqual(local.entries);
    expect(senseSelections(localOnly).every(item => item.entry.source.provider === 'longman')).toBe(true);
    expect(senseSelections(dictionarySourceResult(combined, 'cambridge')).every(item => item.entry.source.provider === 'cambridge')).toBe(true);
    expect(local.entries[0].groups[0].senses[0].meaning.zh).toBeNull();
  });

  it('does not upgrade a known necessary local extraction gap just because one Chinese meaning exists', () => {
    const local = result(); local.status = 'partial';
    expect(dictionarySourceResult(combineDictionaryResults(local, online(), 'longman'), 'longman')!.status).toBe('partial');
  });

  it('preserves the current Cambridge partial status and necessary-gap notice despite usable Chinese', () => {
    const remote = online(); remote.status = 'partial';
    remote.notices = [{ code: 'required_content_gap', text: 'Necessary source content is incomplete.', entry_id: remote.default_entry_id }];
    const active = dictionarySourceResult(combineDictionaryResults(result(), remote, 'cambridge'), 'cambridge')!;
    expect(active.entries[0].groups[0].senses[0].meaning.zh).toBeTruthy();
    expect(active.default_entry_id).toBe(remote.default_entry_id);
    expect(active.status).toBe('partial');
    expect(active.notices).toEqual(remote.notices);
  });

  it('keeps good local content when Cambridge fails and retains original cached retrieval dates', () => {
    const local = result(); const failure: DictionaryResult = { ...online(), status: 'unavailable', entries: [], default_entry_id: null, notices: [{ code: 'timeout', text: 'Unavailable', entry_id: null }] };
    const combined = combineDictionaryResults(local, failure, 'cambridge')!;
    expect(combined.status).toBe('found'); expect(combined.entries).toEqual(local.entries); expect(combined.default_entry_id).toBe(local.default_entry_id);
    const cache = online(); cache.entries.forEach(entry => entry.source.delivery = 'cache');
    const active = dictionarySourceResult(combineDictionaryResults(local, cache, 'cambridge'), 'cambridge')!;
    expect(active.entries[0].source).toMatchObject({ delivery: 'cache', retrieved_at: '2026-10-26T01:00:00.000Z' });
  });
});


describe('source IPA presentation', () => {
  it('wraps raw local IPA and cached Cambridge IPA once while preserving internal characters', () => {
    expect(formatIpa('ˈduːmˌskrəʊ.lɪŋ')).toBe('/ˈduːmˌskrəʊ.lɪŋ/');
    expect(formatIpa('/ˈduːmˌskrəʊ.lɪŋ/')).toBe('/ˈduːmˌskrəʊ.lɪŋ/');
    expect(formatIpa(' / ˈrɛk.ɔːd / ')).toBe('/ˈrɛk.ɔːd/');
    expect(formatIpa('r/ə')).toBe('/r/ə/');
  });
  it('shows only the requested accent on each own POS group and never substitutes a missing accent', () => {
    const value = result();
    const noun = value.entries[0].groups[0], verb = value.entries[1].groups[0];
    noun.pronunciations = [
      { region: 'uk', ipa: 'ˈrekɔːd', audio: null, form_label: null },
      { region: 'us', ipa: 'ˈrekərd', audio: null, form_label: null },
    ];
    verb.pronunciations = [{ region: 'uk', ipa: 'rɪˈkɔːd', audio: null, form_label: null }];
    expect(accentPronunciations(noun, 'gb').map(item => item.ipa)).toEqual(['ˈrekɔːd']);
    expect(accentPronunciations(verb, 'gb').map(item => item.ipa)).toEqual(['rɪˈkɔːd']);
    expect(accentPronunciations(noun, 'us').map(item => item.ipa)).toEqual(['ˈrekərd']);
    expect(accentPronunciations(verb, 'us')).toEqual([]);
  });
  it('omits source suffix fragments from the overview without fabricating a whole US pronunciation', () => {
    const group = result().entries[0].groups[0];
    group.pronunciations = [
      { region: 'uk', ipa: 'ˈrekɔːd', audio: null, form_label: null },
      { region: 'us', ipa: '/-ɔrd/', audio: null, form_label: 'source US variant of ˈrekɔːd' },
    ];
    expect(accentPronunciations(group, 'us')).toEqual([]);
    expect(accentPronunciations(group, 'gb').map(item => item.ipa)).toEqual(['ˈrekɔːd']);
    expect(accentPronunciations(group, 'us', true)).toEqual([group.pronunciations[1]]);
  });
});

describe('dictionary overview is a reference, never a sentence sense selection', () => {
  it('shows each related headword before a second direct POS without relabeling its senses', () => {
    const value = result('running');
    value.entries.forEach(entry => entry.headword = 'running');
    const parent = structuredClone(value.entries[1]);
    parent.id = 'longman:fixture:run'; parent.headword = 'run'; parent.match.type = 'inflection';
    parent.groups[0].id = 'longman:fixture:run:group';
    parent.groups[0].senses = [sense('run-1'), sense('run-2')];
    value.entries.push(parent);
    const before = JSON.stringify(value);
    expect(dictionaryOverview(value).map(item => [item.entry.headword,item.sense.id])).toEqual([
      ['running','noun-1'],['run','run-1'],['running','verb-1'],
    ]);
    expect(JSON.stringify(value)).toBe(before);
    expect(dictionaryReference(value)!.senses.map(item => item.sense_id)).toEqual(['noun-1','verb-1']);
  });
  it('samples across POS groups while leaving every full sense, example and pattern available', () => {
    const value = result();
    const original = JSON.stringify(value);
    expect(dictionaryOverview(value).map(item => item.sense.id)).toEqual(['noun-1', 'verb-1', 'noun-2']);
    expect(JSON.stringify(value)).toBe(original);
    expect(senseSelections(value)).toHaveLength(4);
  });
  it('honors an explicit expression scope instead of summarizing unrelated parent meanings', () => {
    const value = result('look it up');
    value.entries = [value.entries[0]];
    value.entries[0].match.sense_ids = ['noun-2'];
    expect(dictionaryOverview(value).map(item => item.sense.id)).toEqual(['noun-2']);
  });
  it('freezes only the visible excerpt with separate provenance and no selected-sense claim', () => {
    const value = result();
    const reference = dictionaryReference(value)!;
    expect(reference.kind).toBe('dictionary_excerpt');
    expect(reference.senses.map(item => item.sense_id)).toEqual(dictionaryOverview(value).map(item => item.sense.id));
    expect(reference.senses.every(item => !item.examples.length && !item.patterns.length && !item.labels.length)).toBe(true);
    expect(reference.senses[1]).toMatchObject({ part_of_speech: 'verb', source: { entry_key: 'record-verb' } });
    value.entries[0].groups[0].senses[0].meaning.zh = 'late modified online content';
    expect(reference.senses[0].meaning.zh).toBe('noun-1的释义');
    expect(reference).not.toHaveProperty('selected_sense_id');
  });
  it('never combines different headwords into one reference or loses the dictionary-proven case', () => {
    const value = result('US');
    value.entries[0].headword = 'US'; value.entries[1].headword = 'us';
    const reference = dictionaryReference(value)!;
    expect(reference.headword).toBe('US');
    expect(reference.senses.every(item => item.headword === 'US')).toBe(true);
  });
  it('omits unavailable and oversized optional reference content so saving original text can proceed', () => {
    expect(dictionaryReference(null)).toBeNull();
    const missing = result(); missing.entries = []; missing.default_entry_id = null; missing.status = 'unavailable';
    expect(dictionaryReference(missing)).toBeNull();
    const oversized = result();
    oversized.entries.forEach(entry => entry.groups.forEach(group => group.senses.forEach(item => item.meaning.en = 'x'.repeat(2001))));
    expect(dictionaryReference(oversized)).toBeNull();
    const tooMuchMetadata = result();
    tooMuchMetadata.entries.forEach(entry => entry.source.locator = 'x'.repeat(17000));
    expect(dictionaryReference(tooMuchMetadata)).toBeNull();
    expect(senseSelections(tooMuchMetadata)).toHaveLength(4);
  });
});
