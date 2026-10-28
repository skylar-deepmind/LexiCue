import { describe, expect, it } from 'vitest';
import { parseEnglishText } from '../englishText';
import { parseEnglishSrt } from '../englishSrt';

describe('sentence-first English import', () => {
  it('splits paragraphs into sentences and keeps abbreviations, decimals and quoted endings', () => {
    const text = 'Dr. Smith paid 3.50 dollars. He said, "Hello." We left.';
    expect(parseEnglishText(text).map(s => s.en_text)).toEqual(['Dr. Smith paid 3.50 dollars.', 'He said, "Hello."', 'We left.']);
  });
  it('bounds unpunctuated text without losing words or fabricating timestamps', () => {
    const text = 'we can read these words without a pause '.repeat(35).trim();
    const rows = parseEnglishText(text);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every(s => s.en_text.length <= 240 && s.start_time === null && s.end_time === null)).toBe(true);
    expect(rows.map(s=>s.en_text).join(' ')).toBe(text);
  });
  it('bounds a long single subtitle cue as well as accumulated cues', () => {
    const text = 'we can read these words '.repeat(40).trim();
    const rows = parseEnglishSrt(`1\n00:00:01,000 --> 00:00:50,000\n${text}`);
    expect(rows.every(s=>s.en_text.length<=240)).toBe(true);
    expect(rows.map(s=>s.en_text).join(' ')).toBe(text);
    const cues = Array.from({length:10},(_,i)=>`${i+1}\n00:00:${String(i*3).padStart(2,'0')},000 --> 00:00:${String(i*3+3).padStart(2,'0')},000\nwe continue`).join('\n\n');
    expect(parseEnglishSrt(cues)).toHaveLength(2);
    expect(parseEnglishSrt('1\n00:00:01,000 --> 00:00:02,000\nwe start\n\n2\n00:01:00,000 --> 00:01:02,000\nwe return')).toHaveLength(2);
  });
  it('keeps supplied bilingual sentence pairs without another translation', () => {
    expect(parseEnglishText('She bought a book.\n她买了一本书。\n\nShe read it.\n她读了它。').map(s=>s.zh_text)).toEqual(['她买了一本书。','她读了它。']);
  });
  it.each(['', 'こんにちは。', '中文原文。', 'Привет мир.', 'Wir sind heute nicht bereit.'])('rejects unsupported text %s', text => {
    expect(()=>parseEnglishText(text)).toThrow();
  });
});
