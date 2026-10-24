import { describe, expect, it } from 'vitest';
import fixtures from '../../../docs/implementation/fixtures/v31-recall.json';
import { compileRecall } from '../recallMatcher';
describe('fixed English re-encounter corpus', () => {
  it.each(fixtures.positive)('matches complete expression: $expression in $text', ({expression,text}) => {
    const matches=compileRecall([expression]).match(text);expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe(expression);
    expect(text.slice(matches[0].start,matches[0].end).replace(/\p{White_Space}+/gu,' ').toLowerCase()).toBe(expression);
  });
  it.each(fixtures.negative)('rejects boundaries or transformations: $expression in $text', ({expression,text}) => {
    expect(compileRecall([expression]).match(text)).toEqual([]);
  });
  it.each(fixtures.polysemy)('matches the spelling, without asserting the old meaning: $text', ({expression,text}) => {
    const [match]=compileRecall([expression]).match(text);expect(match.expression).toBe(expression);
    expect(Object.keys(match).sort()).toEqual(['end','expression','start']);
  });
  it('preserves UTF-16 offsets and repeated occurrences', () => {
    const text='🛫 TAKE\t\tOFF; take off.';const matches=compileRecall(['take off']).match(text);
    expect(matches.map(m=>[m.start,m.end,text.slice(m.start,m.end)])).toEqual([[3,12,'TAKE\t\tOFF'],[14,22,'take off']]);
  });
  it('decorates the longest expression at the earliest overlapping position',()=>{
    expect(compileRecall(['take','take off','off now']).match('Take off now.')).toEqual([{start:0,end:8,expression:'take off'}]);
  });
  it('ignores unsupported source scripts and does not normalize accents or punctuation',()=>{
    expect(compileRecall(['こんにちは','学习','I’m','i']).match('こんにちは 学习 I’m')).toEqual([{start:9,end:12,expression:'i’m'}]);
  });
  it('handles 10,000 distinct expressions without per-pattern text scans',()=>{
    const expressions=Array.from({length:10000},(_,i)=>`saved expression ${i}`);const matcher=compileRecall(expressions);
    expect(matcher.match('saved expression 9999; saved expression 101; unsaved.').map(m=>m.expression)).toEqual(['saved expression 9999','saved expression 101']);
  });
});
