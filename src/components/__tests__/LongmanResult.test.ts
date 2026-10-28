import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DictionaryResult } from '../../lib/dictionaryResult';
const state = vi.hoisted(() => ({ accent: 'us' as 'us' | 'gb' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' }, t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock('../../stores/preferencesStore', () => ({ usePreferencesStore: (selector: (value: { speech: { accent: 'us' | 'gb' } }) => unknown) => selector({ speech: { accent: state.accent } }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
import LongmanResult from '../LongmanResult';

function result(): DictionaryResult {
  return {
    schema_version: 1, query: { text: 'record', language: 'en', context: 'Please record this.' },
    status: 'found', default_entry_id: 'longman:record', notices: [], entries: [{
      id: 'longman:record', headword: 'record', kind: 'word', expression_type: null, origin: 'headword', parent_headword: null,
      source: { provider: 'longman', dataset: 'test', edition: '6', release: 'fixture', adapter_version: 'fixture', entry_key: 'record', locator: null, delivery: 'local', entry_url: null, retrieved_at: null },
      match: { type: 'exact', pattern: null, note: null, sense_ids: [] }, notes: [], related_expressions: [],
      groups: ['noun', 'verb'].map(part => ({
        id: `longman:record:${part}`, part_of_speech: part, source_part_of_speech: part, labels: [], forms: [], notes: [],
        pronunciations: [{ region: 'uk', ipa: part === 'noun' ? 'ˈrekɔːd' : 'rɪˈkɔːd', audio: null, form_label: null }, { region: 'us', ipa: part === 'noun' ? 'ˈrekərd' : 'rɪˈkɔːrd', audio: null, form_label: null }],
        senses: [1, 2, 3, 4].map(number => ({ id: `${part}:${number}`, meaning: { en: `${part} definition ${number}`, zh: `${part}释义${number}` }, labels: [], notes: [],
          examples: [{ id: `${part}:${number}:example`, english: `${part} example ${number}.`, chinese: `例句译文${number}`, audio: null }],
          patterns: [{ id: `${part}:${number}:pattern`, text: `${part} pattern ${number}`, explanation: null, labels: [], examples: [], notes: [] }],
        })),
      })),
    }],
  };
}

describe('dictionary reference presentation', () => {
  it('keeps go headword IPA in the overview and labels gone/goes pronunciations only in details', () => {
    const value = result(); value.query.text = 'go'; value.entries[0].headword = 'go';
    value.entries[0].groups = [value.entries[0].groups[1]];
    value.entries[0].groups[0].pronunciations = [
      { region:'us',ipa:'ɡoʊ',audio:null,form_label:null },
      { region:'us',ipa:'ɡɒːn',audio:null,form_label:'past participle: gone' },
      { region:'us',ipa:'ɡoʊz',audio:null,form_label:'third person singular: goes' },
    ];
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    const [overview,details] = markup.split('<details class="dictionary-more">');
    expect(overview).toContain('/ɡoʊ/'); expect(overview).not.toContain('/ɡɒːn/'); expect(overview).not.toContain('/ɡoʊz/');
    expect(details).toContain('/ɡɒːn/'); expect(details).toContain('past participle: gone');
    expect(details).toContain('/ɡoʊz/'); expect(details).toContain('third person singular: goes');
  });
  it('labels independent form meanings and related parent meanings without requiring a meaning choice', () => {
    const value = result(); value.query.text = 'running';
    value.entries[0].headword = 'running';
    const parent = structuredClone(value.entries[0]); parent.id = 'longman:run'; parent.headword = 'run'; parent.match.type = 'inflection';
    parent.groups = [parent.groups[1]]; parent.groups[0].id = 'longman:run:verb';
    parent.groups[0].senses.forEach(sense => { sense.id = `run:${sense.id}`; sense.examples.forEach(example => { example.id = `run:${example.id}`; }); });
    value.entries.push(parent);
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    const [overview,details] = markup.split('<details class="dictionary-more">');
    expect(overview).toContain('data-overview-headword="running"');
    expect(overview).toContain('data-overview-headword="run"');
    expect(overview).toContain('running → run');
    expect(details).toContain('<h3 lang="en">running</h3>'); expect(details).toContain('<h3 lang="en">run</h3>');
    expect(markup).not.toContain('type="radio"');
  });
  it('shows a short cross-POS overview with one initially collapsed full-content entrance and no sense-selection controls', () => {
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: result() }));
    expect((markup.match(/data-overview-sense=/g) ?? [])).toHaveLength(3);
    expect(markup).toContain('data-overview-sense="noun:1"');
    expect(markup).toContain('data-overview-sense="verb:1"');
    expect(markup).toContain('<details class="dictionary-more"><summary>dictionaryFlow.more</summary>');
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain('data-selected');
    expect(markup).not.toContain('longman.chooseSense');
    // The full structured data is retained even though its parent is closed.
    for (const part of ['noun', 'verb']) for (const number of [1, 2, 3, 4]) {
      expect(markup).toContain(`data-sense-id="${part}:${number}"`);
      expect(markup).toContain(`${part} example ${number}.`);
      expect(markup).toContain(`${part} pattern ${number}`);
    }
  });
  it('uses the same preference for overview and full POS groups without mixing noun and verb pronunciations', () => {
    state.accent = 'us';
    let markup = renderToStaticMarkup(createElement(LongmanResult, { result: result() }));
    expect(markup).toContain('/ˈrekərd/'); expect(markup).toContain('/rɪˈkɔːrd/');
    expect(markup).not.toContain('/ˈrekɔːd/'); expect(markup).not.toContain('/rɪˈkɔːd/');
    state.accent = 'gb';
    markup = renderToStaticMarkup(createElement(LongmanResult, { result: result() }));
    expect(markup).toContain('/ˈrekɔːd/'); expect(markup).toContain('/rɪˈkɔːd/');
    expect(markup).not.toContain('/ˈrekərd/'); expect(markup).not.toContain('/rɪˈkɔːrd/');
    state.accent = 'us';
  });
  it('labels valid English-only meanings and omits an absent accent instead of borrowing the other one', () => {
    const value = result();
    value.entries[0].groups.forEach(group => {
      group.pronunciations = group.pronunciations.filter(item => item.region === 'uk');
      group.senses.forEach(sense => sense.meaning.zh = null);
    });
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    expect(markup).toContain('longman.englishOnly');
    expect(markup).toContain('noun definition 1');
    expect(markup).not.toContain('class="longman-ipa"');
  });
  it('keeps incomplete source variants inside labelled details while leaving them out of the overview', () => {
    const value = result();
    value.entries[0].groups.forEach(group => group.pronunciations = [
      { region: 'us', ipa: '-ɔrd', audio: null, form_label: 'source US variant of ˈrekɔːd' },
    ]);
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    const [overview, details] = markup.split('<details class="dictionary-more">');
    expect(overview).not.toContain('/-ɔrd/');
    expect(details).toContain('/-ɔrd/');
    expect(details).toContain('longman.usVariant');
    expect(markup).not.toContain('/ˈrekɔːrd/');
  });
});
