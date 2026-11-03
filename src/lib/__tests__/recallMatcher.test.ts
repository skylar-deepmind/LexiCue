import { describe, expect, it } from 'vitest';
import fixtures from '../../../docs/implementation/fixtures/v31-recall.json';
import { compileRecall, recallExpression } from '../recallMatcher';
describe('fixed English re-encounter corpus', () => {
  it.each(fixtures.positive)('matches complete expression: $expression in $text', ({expression,text}) => {
    // The old corpus treated all capitals as ordinary case folding. Without
    // explicit history these may be abbreviations, even if a pack is missing.
    const reserved = ['TAKE OFF','ART','RÉSUMÉ'].find(form=>text.includes(form));
    if(reserved){
      expect(compileRecall([expression]).match(text)).toEqual([]);
      expect(compileRecall([reserved]).match(text).map(match=>match.expression)).toEqual([reserved]);
      return;
    }
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
    const text='🛫 TAKE\t\tOFF; take off.';const matches=compileRecall(['TAKE OFF','take off']).match(text);
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
  it('keeps dictionary-proven US and us separate while retaining sentence capitals',()=>{
    const matcher=compileRecall(['US','us','change']);
    expect(matcher.match('US helps us. Us too. Change.').map(match=>match.expression)).toEqual(['US','us','us','change']);
    expect(compileRecall(['US']).match('Us and us')).toEqual([]);
    expect(recallExpression(['US','us'],'US')).toBe('US');
    expect(recallExpression(['US'],'us')).toBeUndefined();
  });
  it('respects source uppercase reservations with only lowercase history and keeps ordinary sentence capitals',()=>{
    const matcher=compileRecall(['us','may','go','went'],['US','May','MAY']);
    expect(matcher.match('US and May MAY. Us may Go; Went with us.').map(match=>match.expression)).toEqual(['us','may','go','went','us']);
    const reserved=new Set(['US','May','MAY']);
    expect(recallExpression(['us'],'US',reserved)).toBeUndefined();
    expect(recallExpression(['may'],'May',reserved)).toBeUndefined();
    expect(recallExpression(['may'],'MAY',reserved)).toBeUndefined();
    expect(recallExpression(['went'],'Went',reserved)).toBe('went');
  });
  it('permits explicitly saved reserved spellings including I without lowercase spillover',()=>{
    expect(compileRecall(['US','May','I'],['US','May','MAY','I']).match('US May MAY I; us may i.').map(match=>match.expression)).toEqual(['US','May','I']);
    expect(compileRecall(['i'],['I']).match('I agree.')).toEqual([]);
    expect(recallExpression(['US','us'],'US',new Set(['US']))).toBe('US');
  });
  it('fails closed on unverified all capitals when source exclusions are unavailable',()=>{
    expect(compileRecall(['us','may','go'],[]).match('US MAY GO; Us may Go.').map(match=>match.expression)).toEqual(['us','may','go']);
    expect(recallExpression(['us'],'US')).toBeUndefined();
    expect(compileRecall(["I'M","I'VE"],[]).match("I'M I'VE; I'm I've.").map(match=>match.expression)).toEqual(["I'M","I'VE"]);
    expect(compileRecall(['i'],[]).match('I agree.').map(match=>match.expression)).toEqual(['i']);
  });
  it('keeps original case in literal-only mode when a dictionary is absent or changed',()=>{
    expect(compileRecall(['may','us','go'],[],true).match('May US Go; may us go.').map(match=>match.expression)).toEqual(['may','us','go']);
    expect(compileRecall(['May','may',"I'M"],[],true).match("May may MAY I'M I'm.").map(match=>match.expression)).toEqual(['May','may',"I'M"]);
    expect(compileRecall(['take off'],[],true).match('take\t off; Take off.').map(match=>match.expression)).toEqual(['take off']);
    expect(recallExpression(['may'],'May',new Set(),true)).toBeUndefined();
    expect(recallExpression(['May'],'May',new Set(),true)).toBe('May');
  });
});
