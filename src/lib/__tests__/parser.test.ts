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

describe('SRT sentence merging', () => {
  it('merges cues spanning a sentence and locks the translation in step', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
I went to the store
我去商店

2
00:00:02,500 --> 00:00:04,000
and bought some milk.
买了些牛奶。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('I went to the store and bought some milk.');
    expect(result.segments[0].zh_text).toBe('我去商店买了些牛奶。');
    expect(result.segments[0].start_time).toBe('00:00:01.000');
    expect(result.segments[0].end_time).toBe('00:00:04.000');
  });

  it('does not split on abbreviations like Mr. and Dr.', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
He saw Dr. Smith

2
00:00:02,500 --> 00:00:04,000
at the office.`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('He saw Dr. Smith at the office.');
  });

  it('splits multiple complete sentences inside one cue', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Wait.
I'll be right back.
等等。
我马上回来。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('Wait.');
    expect(result.segments[0].zh_text).toBe('等等。');
    expect(result.segments[1].en_text).toBe("I'll be right back.");
    expect(result.segments[1].zh_text).toBe('我马上回来。');
  });

  it('keeps Chinese source merged across cues with non-terminal punctuation', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
今天天气很好，
The weather is nice,

2
00:00:02,500 --> 00:00:04,000
我们出去玩吧。
let's go out.`;

    const result = parseFile(srt, 'srt', 'auto', 'zh');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('今天天气很好，我们出去玩吧。');
    expect(result.segments[0].zh_text).toBe('The weather is nice, let\'s go out.');
  });

  it('merges Japanese sentences using kana and full-width stops', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
今日はいい天気ですね。
今天天气真好。

2
00:00:02,500 --> 00:00:04,000
一緒に散歩しましょう。
一起散步吧。`;

    const result = parseFile(srt, 'srt', 'auto', 'ja');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('今日はいい天気ですね。');
    expect(result.segments[1].en_text).toBe('一緒に散歩しましょう。');
  });

  it('leaves translation null when a cue has no translation line', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello, how are you?

2
00:00:03,000 --> 00:00:04,000
I'm fine, thanks.
我很好，谢谢。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments[0].en_text).toBe('Hello, how are you?');
    expect(result.segments[0].zh_text).toBeNull();
    expect(result.segments[1].zh_text).toBe('我很好，谢谢。');
  });

  it('appends leftover translation lines to the last paired line', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Line one
Line two
第一行
第二行`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('Line one Line two');
    expect(result.segments[0].zh_text).toBe('第一行第二行');
  });

  it('splits two sentence pairs sharing one cue line', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
国がやらないなら、私が。太地さんが7年にわたり台湾で続けてきた活動。
如果国家不做，那就由我来做。这是太地和子在台湾坚持了7年的行动`;

    const result = parseFile(srt, 'srt', 'auto', 'ja');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('国がやらないなら、私が。');
    expect(result.segments[0].zh_text).toBe('如果国家不做，那就由我来做。');
    expect(result.segments[1].en_text).toBe('太地さんが7年にわたり台湾で続けてきた活動。');
    expect(result.segments[1].zh_text).toBe('这是太地和子在台湾坚持了7年的行动');
  });

  it('does not split inside quotes', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
「行こう！」と彼は言った。彼は笑った。
「我们走吧！」他说。他笑了。`;

    const result = parseFile(srt, 'srt', 'auto', 'ja');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('「行こう！」と彼は言った。');
    expect(result.segments[0].zh_text).toBe('「我们走吧！」他说。');
    expect(result.segments[1].en_text).toBe('彼は笑った。');
    expect(result.segments[1].zh_text).toBe('他笑了。');
  });

  it('keeps the whole line when sentence counts differ', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
本当だよ。信じて。
真的，相信我。`;

    const result = parseFile(srt, 'srt', 'auto', 'ja');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('本当だよ。信じて。');
    expect(result.segments[0].zh_text).toBe('真的，相信我。');
  });

  it('does not split on decimals', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
The speed is 3.5 meters. We checked twice.
速度是3.5米。我们检查了两次。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('The speed is 3.5 meters.');
    expect(result.segments[0].zh_text).toBe('速度是3.5米。');
    expect(result.segments[1].en_text).toBe('We checked twice.');
    expect(result.segments[1].zh_text).toBe('我们检查了两次。');
  });

  it('continues a sentence across cues when the quote is still open', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
He said, "I'm fine.
他说，“我没事。

2
00:00:03,000 --> 00:00:04,000
She left."
她走了。”`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].en_text).toBe('He said, "I\'m fine. She left."');
    expect(result.segments[0].zh_text).toBe('他说，“我没事。她走了。”');
  });

  it('pairs sentences across lines when one line holds multiple sentences', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Wait. I'll be right back.
等等。
我马上回来。`;

    const result = parseFile(srt, 'srt');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].en_text).toBe('Wait.');
    expect(result.segments[0].zh_text).toBe('等等。');
    expect(result.segments[1].en_text).toBe("I'll be right back.");
    expect(result.segments[1].zh_text).toBe('我马上回来。');
  });

  it('forces a break when cues never reach sentence punctuation', () => {
    const srt = Array.from({ length: 20 }, (_, i) =>
      `${i + 1}\n00:00:0${String(i).padStart(2, '0')},000 --> 00:00:0${String(i + 1).padStart(2, '0')},000\nword ${i}`,
    ).join('\n\n');

    const result = parseFile(srt, 'srt');
    expect(result.segments.length).toBeGreaterThan(1);
    expect(result.segments[0].en_text).toBe(
      Array.from({ length: 15 }, (_, i) => `word ${i}`).join(' '),
    );
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
