import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import zh from '../../i18n/locales/zh.json';
import type { DictionarySnapshot } from '../../lib/savedRecords';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' }, t: (key: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], zh) }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
import DictionarySource from '../DictionarySource';

const publicSource: DictionarySnapshot['source'] = {
  provider: 'cambridge', dataset: 'Cambridge Dictionary (author public API)', edition: null,
  release: null, adapter_version: 'cambridge-public-v1.0.0', entry_key: 'record', locator: null,
  access_channel: 'author_public_api', service_url: 'https://dictionary-api.eliaschen.dev',
  received_at: '2026-10-26T03:04:05Z',
};

describe('dictionary source provenance presentation', () => {
  it('labels the public receipt time and unknown originals without a fabricated entry link', () => {
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source: publicSource, historical: true }));
    expect(markup).toContain('剑桥 · 作者公共接口');
    expect(markup).toContain('查询获取时间');
    expect(markup).toContain('dateTime="2026-10-26T03:04:05Z"');
    expect(markup).toContain('原词条链接、原网页抓取时间未知');
    expect(markup).not.toContain('<a ');
    expect(markup).not.toContain('抓取于');
    expect(markup).not.toContain('Cambridge Dictionary (author public API)');
  });

  it('also labels the current public adapter without changing the historical public label', () => {
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source: { ...publicSource, adapter_version: 'cambridge-public-v1.1.0' }, historical: true }));
    expect(markup).toContain('剑桥 · 作者公共接口');
    expect(markup).toContain('查询获取时间');
    expect(markup).toContain('原词条链接、原网页抓取时间未知');
    expect(markup).not.toContain('<a ');
  });

  it('keeps the verified original link and retrieval label for historical self-hosted Cambridge records', () => {
    const source = { ...publicSource, adapter_version: 'cambridge-v1.0.0', access_channel: undefined, service_url: undefined, received_at: undefined, dataset: 'english-chinese-simplified', entry_url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/record', retrieved_at: '2026-10-25T03:04:05Z' };
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source, historical: true }));
    expect(markup).toContain('抓取于');
    expect(markup).toContain('查看原词条');
    expect(markup).toContain(source.entry_url);
    expect(markup).not.toContain('作者公共接口');
    expect(markup).not.toContain('查询获取时间');
  });
});
