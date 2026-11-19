import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DictionaryResult } from '../../lib/dictionaryResult';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' }, t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
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
  it('keeps word forms while omitting regular and variant pronunciations and example sentences', () => {
    const value = result();
    const group = value.entries[0].groups[0];
    group.pronunciations.push({ region: 'us', ipa: '-ɔrd', audio: null, form_label: 'source US variant of ˈrekɔːd' });
    group.forms = [{ text: 'records', label: 'plural' }, { text: 'recorded', label: 'past tense' }, { text: 'records', label: 'source table' }];
    group.senses[0].patterns[0].examples = [{ id: 'pattern-example', english: 'A collocation example.', chinese: null, audio: null }];
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    expect(markup).toContain('records · recorded');
    expect(markup).not.toMatch(/ˈrekɔːd|ˈrekərd|-ɔrd|longman-ipa|example 1|例句译文|A collocation example/u);
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
    expect(details).toContain('lang="en">running</strong>'); expect(details).toContain('running → run');
    expect(markup).not.toContain('type="radio"');
  });
  it('shows a cross-POS overview and continues with just the remaining definitions', () => {
    const value = result();
    const pattern = value.entries[0].groups[0].senses[0].patterns[0];
    pattern.explanation = { en: 'A pattern gloss', zh: '搭配释义' };
    value.entries[0].related_expressions = [{ text: pattern.text, expression_type: null, scope_id: 'noun:1', target_query: 'record' }];
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    const [overview, details] = markup.split('<details class="dictionary-more">');
    expect(overview.match(/data-overview-sense=/g)).toHaveLength(3);
    expect(overview).toContain('data-overview-sense="noun:1"');
    expect(overview).toContain('data-overview-sense="verb:1"');
    expect(details).toContain('<summary>dictionaryFlow.more');
    expect(details).toContain('start="4"');
    expect(details).not.toContain('noun释义1');
    expect(details).not.toContain('verb释义1');
    expect(details).toContain('verb释义2');
    expect(details).toContain('搭配释义');
    expect(details.match(/noun pattern 1/g)).toHaveLength(1);
    expect(markup.match(/data-sense-id=/g)).toHaveLength(8);
    expect(markup).not.toContain('type="radio"');
  });
  it('shows English-only meanings and skips the expansion when there is nothing more to read', () => {
    const value = result();
    const group = value.entries[0].groups[0];
    value.entries[0].groups = [group];
    group.senses = [group.senses[0]];
    group.senses[0].meaning.zh = null;
    group.senses[0].patterns = [];
    const markup = renderToStaticMarkup(createElement(LongmanResult, { result: value }));
    expect(markup).toContain('lang="en">noun definition 1');
    expect(markup).not.toContain('class="dictionary-more"');
  });
});
