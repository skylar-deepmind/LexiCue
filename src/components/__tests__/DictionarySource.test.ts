import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import zh from '../../i18n/locales/zh.json';
import type { DictionarySnapshot } from '../../lib/savedRecords';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh' }, t: (key: string, options?: Record<string, string>) => Object.entries(options ?? {}).reduce((text, [name, value]) => text.replace(`{{${name}}}`, value), key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], zh) as string) }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
import DictionarySource from '../DictionarySource';

const publicSource: DictionarySnapshot['source'] = {
  provider: 'cambridge', dataset: 'Cambridge Dictionary (author public API)', edition: null,
  release: null, adapter_version: 'cambridge-public-v1.0.0', entry_key: 'record', locator: null,
  access_channel: 'author_public_api', service_url: 'https://dictionary-api.eliaschen.dev',
  received_at: '2026-10-26T03:04:05Z',
};

describe('dictionary source provenance presentation', () => {
  it('uses local and online labels without rewriting historical provenance or treating cached online content as local', () => {
    const local = { ...publicSource, provider: 'longman' as const, dataset: 'Longman', access_channel: undefined, service_url: undefined, received_at: undefined, edition: '6', release: 'Longman-release-6' };
    const cachedOnline = { ...publicSource, delivery: 'cache' };
    const original = structuredClone({ local, cachedOnline });
    const localMarkup = renderToStaticMarkup(createElement(DictionarySource, { source: local, historical: true }));
    const onlineMarkup = renderToStaticMarkup(createElement(DictionarySource, { source: cachedOnline, historical: true }));
    expect(localMarkup).toContain('<p>本地 · 第 6 版</p>');
    expect(localMarkup).not.toContain('Longman');
    expect(localMarkup).not.toContain('朗文');
    expect(onlineMarkup).toContain('在线 · 作者公共接口 · 缓存');
    expect(onlineMarkup).not.toContain('本地');
    expect(onlineMarkup).not.toContain('剑桥');
    expect({ local, cachedOnline }).toEqual(original);
  });
  it('keeps Wiktionary attribution, original locator and the dictionary licence visible in offline references', () => {
    const source: DictionarySnapshot['source'] = {
      provider: 'wiktionary', dataset: 'Wiktionary', edition: null, release: null,
      adapter_version: 'freedictionaryapi-v1.0.0', entry_key: 'wiktionary:freedictionaryapi-v1.0.0:entry:abc', locator: '/entries/0',
      entry_url: 'https://en.wiktionary.org/wiki/my_bad', retrieved_at: '2026-10-28T03:04:05Z', received_at: '2026-10-28T03:04:05Z',
      access_channel: 'freedictionaryapi', service_url: 'https://freedictionaryapi.com', content_hash: 'a'.repeat(64),
      license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      attribution: 'Wiktionary contributors via FreeDictionaryAPI.com',
      modifications: 'Adapted English definitions and ordinary examples; translations, quotations and audio omitted.',
    };
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source, historical: true }));
    expect(markup).toContain('在线 · 仅英文');
    expect(markup).toContain('FreeDictionaryAPI.com 提供');
    expect(markup).toContain('https://en.wiktionary.org/wiki/my_bad');
    expect(markup).toContain('CC BY-SA 4.0');
    expect(markup).toContain('许可适用于词典节选');
    expect(markup).not.toContain('作者公共接口');
  });
  it('labels the public receipt time and unknown originals without a fabricated entry link', () => {
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source: publicSource, historical: true }));
    expect(markup).toContain('在线 · 作者公共接口');
    expect(markup).toContain('查询获取时间');
    expect(markup).toContain('dateTime="2026-10-26T03:04:05Z"');
    expect(markup).toContain('原词条链接、原网页抓取时间未知');
    expect(markup).not.toContain('<a ');
    expect(markup).not.toContain('抓取于');
    expect(markup).not.toContain('Cambridge Dictionary (author public API)');
  });

  it('also labels the current public adapter without changing the historical public label', () => {
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source: { ...publicSource, adapter_version: 'cambridge-public-v1.1.0' }, historical: true }));
    expect(markup).toContain('在线 · 作者公共接口');
    expect(markup).toContain('查询获取时间');
    expect(markup).toContain('原词条链接、原网页抓取时间未知');
    expect(markup).not.toContain('<a ');
  });

  it('keeps the verified original link and retrieval label for historical self-hosted Cambridge records', () => {
    const source = { ...publicSource, adapter_version: 'cambridge-v1.0.0', access_channel: undefined, service_url: undefined, received_at: undefined, dataset: 'Cambridge Dictionary historical dataset', release: 'Cambridge historical release', entry_url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/record', retrieved_at: '2026-10-25T03:04:05Z' };
    const original = structuredClone(source);
    const markup = renderToStaticMarkup(createElement(DictionarySource, { source, historical: true }));
    expect(markup).not.toContain(source.dataset);
    expect(markup).not.toContain(source.release);
    expect(source).toEqual(original);
    expect(markup).toContain('抓取于');
    expect(markup).toContain('查看原词条');
    expect(markup).toContain(source.entry_url);
    expect(markup).not.toContain('作者公共接口');
    expect(markup).not.toContain('查询获取时间');
  });
});
