import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DictionaryReference, DictionarySnapshot, SavedGroup, SavedRecord } from '../../lib/savedRecords';

const translations: Record<string, string> = {
  'dictionaryFlow.compactContextCount': '{{count}} 句',
  'dictionaryFlow.savedReference': '当时的词典参考（节选）',
  'dictionaryFlow.referenceNote': '词典参考，不代表已确认的本句意思',
  'dictionaryFlow.savedMeaning': '当时保存的释义',
  'dictionaryFlow.personalMeaning': '个人解释',
  'dictionaryFlow.englishOnly': '仅英文',
  'dictionary.longman': '朗文',
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' }, t: (key: string, options?: Record<string, string | number>) => Object.entries(options ?? {}).reduce((value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)), translations[key] ?? key) }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('../../stores/importStore', () => ({ useImportStore: vi.fn() }));
import { SavedGroupCard } from '../../pages/SavedPage';

const sense = (id: string, zh: string | null, en: string): DictionarySnapshot => ({
  schema_version: 1, headword: 'change',
  source: { provider: 'longman', dataset: 'Longman', edition: null, release: 'test', adapter_version: 'longman-v1', entry_key: 'change', locator: null },
  entry_id: 'change', group_id: 'noun', sense_id: id, part_of_speech: 'noun',
  meaning: { zh, en }, labels: [], examples: [], patterns: [],
});
const reference: DictionaryReference = { schema_version: 1, kind: 'dictionary_excerpt', headword: 'change', senses: [sense('change:1', '变化', 'becoming different'), sense('change:2', '零钱', 'coins'), sense('change:3', null, 'a different set of clothes')] };
const record: SavedRecord = {
  record_id: 'context:1', expression: 'change', normalized_expression: 'change', source_key: 'material:1',
  sentence: 'Keep the change.', sentence_translation: null, source: null, explanation: null, explanation_source: 'unknown',
  dictionary_reference: reference, origin: 'reader', legacy: null, saved_at: 1, updated_at: 1, revision: 'r1', generation: 1, deleted_at: null,
};
const group: SavedGroup = { group_id: 'word:change', expression: 'change', context_count: 2, latest_saved_at: 1, preview: record };

describe('saved word archive presentation', () => {
  it('renders a compact group with its dictionary summary and a closed inert panel', () => {
    const summarized = { ...group, summary: '变化' };
    const markup = renderToStaticMarkup(createElement(SavedGroupCard, { group: summarized, selected: false, onOpen: () => {} }, createElement('p', null, 'Keep the change.')));
    expect(markup.match(/<button /g)).toHaveLength(1);
    expect(markup).toContain('2 句');
    expect(markup).toContain('变化');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('inert=""');
  });

  it('exposes the expanded context while retaining the single group action', () => {
    const markup = renderToStaticMarkup(createElement(SavedGroupCard, { group, selected: true, onOpen: () => {} }, createElement('p', null, 'Keep the change.')));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-hidden="false"');
    expect(markup).toContain('Keep the change.');
    expect(markup).not.toContain('inert=""');
    expect(markup).not.toContain('当时保存的释义');
  });

});
