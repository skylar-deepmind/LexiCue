import { describe, it, expect } from 'vitest';
import { parseFile } from '../parser';

describe('SRT parser', () => {
  it('parses standard SRT format correctly', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Hello, how are you?
你好，你怎么样？

2
00:00:04,000 --> 00:00:06,000
I'm doing great.
我很好。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('Hello, how are you?');
    expect(result.segments[0].zh_text).toBe('你好，你怎么样？');
    expect(result.segments[0].start_time).toBe('00:00:01.000');
    expect(result.segments[0].end_time).toBe('00:00:03.000');
  });

  it('cleans HTML tags', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
<i>Hello</i> world
你好世界`;

    const result = parseFile(srt, 'srt');
    expect(result.segments[0].en_text).toBe('Hello world');
  });

  it('extracts English words for later lemmatization', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
He went to the store.`;

    const result = parseFile(srt, 'srt');
    expect(result.lemmas).toContain('went');
    expect(result.occurrences.some(o => o.lemma === 'went' && o.original_form === 'went')).toBe(true);
  });

  it('skips empty blocks', () => {
    const srt = `


1
00:00:01,000 --> 00:00:03,000
Hello


`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(1);
  });
});

describe('TXT parser', () => {
  it('splits text into paragraphs', () => {
    const txt = `First paragraph with some words.

Second paragraph here.`;

    const result = parseFile(txt, 'txt');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].zh_text).toBeNull();
    expect(result.segments[0].start_time).toBeNull();
  });

  it('keeps Japanese text and tokenizes it without ASCII filtering', () => {
    const result = parseFile('今日はいい天気です。', 'txt', 'auto', 'ja');
    expect(result.language).toBe('ja');
    expect(result.segments[0].en_text).toBe('今日はいい天気です。');
    expect(result.lemmas.length).toBeGreaterThan(0);
    expect(result.occurrences.every((occurrence) => occurrence.original_form.length > 0)).toBe(true);
  });

  it('uses the Japanese line as the source in bilingual SRT', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
今日はいい天気ですね。
今天天气真好。`;
    const result = parseFile(srt, 'srt', 'auto', 'ja');
    expect(result.segments[0].en_text).toBe('今日はいい天気ですね。');
    expect(result.segments[0].zh_text).toBe('今天天气真好。');
  });

  it('keeps German text with umlauts and case in TXT', () => {
    const result = parseFile('Über die Straße gehen wir.', 'txt', 'auto', 'de');
    expect(result.language).toBe('de');
    expect(result.segments[0].en_text).toBe('Über die Straße gehen wir.');
    expect(result.occurrences.map((o) => o.original_form)).toEqual([
      'Über', 'die', 'Straße', 'gehen', 'wir',
    ]);
  });

  it('uses the German line as the source in bilingual SRT', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Guten Morgen!
早上好！`;
    const result = parseFile(srt, 'srt', 'auto', 'de');
    expect(result.segments[0].en_text).toBe('Guten Morgen!');
    expect(result.segments[0].zh_text).toBe('早上好！');
  });

  it('keeps umlauts in mixed German lines', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Über das Haus 关于这栋房子`;
    const result = parseFile(srt, 'srt', 'auto', 'de');
    expect(result.segments[0].en_text).toBe('Über das Haus');
  });

  it('uses the Chinese line as the source in bilingual SRT', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
今天天气真好。
The weather is really nice today.`;
    const result = parseFile(srt, 'srt', 'auto', 'zh');
    expect(result.segments[0].en_text).toBe('今天天气真好。');
    expect(result.segments[0].zh_text).toBe('The weather is really nice today.');
  });

  it('keeps Chinese text in TXT', () => {
    const result = parseFile('我喜欢学习中文。', 'txt', 'auto', 'zh');
    expect(result.language).toBe('zh');
    expect(result.segments[0].en_text).toBe('我喜欢学习中文。');
    expect(result.occurrences.every((occurrence) => occurrence.original_form.length > 0)).toBe(true);
  });
});
