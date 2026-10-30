import { describe, expect, it } from 'vitest';
import { importFileName } from '../materials';
import { parseEnglishSrt } from '../englishSrt';
const srt=(text:string)=>`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`;
describe('English SRT import validation',()=>{
 it('keeps English, Chinese translation and actual timestamps',()=>{const rows=parseEnglishSrt('\uFEFF'+srt('We take off at noon.\n我们中午起飞。').replace(/\n/g,'\r\n'));expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({index:0,en_text:'We take off at noon.',zh_text:'我们中午起飞。',start_time:'00:00:01.000',end_time:'00:00:03.000'});});
 it.each(['','not a subtitle','1\n00:99:01,000 --> 00:00:03,000\nHello','1\n00:00:03,000 --> 00:00:01,000\nHello',srt('We fly.')+'\n2\nbad time\nBad cue'])('fails invalid or partial SRT rather than silently importing it',input=>{expect(()=>parseEnglishSrt(input)).toThrow();});
 it.each(['こんにちは。','我们今天学习。','Привет мир.','Wir sind heute nicht bereit.','Bonjour, nous sommes avec vous.','Hola, gracias por los libros.'])('rejects clearly unsupported source languages',text=>{expect(()=>parseEnglishSrt(srt(text))).toThrow('material_english_only');});
 it('does not fabricate a sentence from music captions',()=>{expect(()=>parseEnglishSrt(srt('[Music]'))).toThrow('material_english_only');});
 it.each(['Hello...', 'Hi!!', 'Hey?!', 'Wait…?!', '"Really?!"'])('keeps a terminal punctuation run attached to its English sentence: %s',text=>{
  const rows=parseEnglishSrt(srt(text));
  expect(rows).toEqual([{index:0,en_text:text,zh_text:null,start_time:'00:00:01.000',end_time:'00:00:03.000'}]);
 });
 it('preserves bilingual text and timestamps across cues with repeated terminal punctuation',()=>{
  const rows=parseEnglishSrt(srt('Hello...\n你好……')+'\n2\n00:00:04,000 --> 00:00:06,000\nReally?!\n真的吗？！\n');
  expect(rows.map(row=>[row.en_text,row.zh_text,row.start_time,row.end_time])).toEqual([
   ['Hello...','你好……','00:00:01.000','00:00:03.000'],
   ['Really?!','真的吗？！','00:00:04.000','00:00:06.000'],
  ]);
  expect(rows.every((row,index)=>row.index===index&&/[A-Za-z]/.test(row.en_text))).toBe(true);
 });
 it('keeps a counted sentence in its English context with its original cue timing',()=>{
  const rows=parseEnglishSrt('1\n00:04:40,400 --> 00:04:43,280\nThere are four colors.\n\n2\n00:04:43,280 --> 00:04:50,880\n1 2 3 4.\nAnd they are light.\n');
  expect(rows.find(row=>row.en_text==='1 2 3 4.')).toMatchObject({start_time:'00:04:43.280',end_time:'00:04:50.880'});
  expect(rows.map(row=>row.en_text)).toEqual(['There are four colors.','1 2 3 4.','And they are light.']);
 });
 it('does not mistake a numeric caption body for its cue index',()=>{
  const rows=parseEnglishSrt(srt('There are four colors.')+'\n2\n00:00:04,000 --> 00:00:06,000\n4\n');
  expect(rows[1]).toMatchObject({index:1,en_text:'4',start_time:'00:00:04.000',end_time:'00:00:06.000'});
  expect(()=>parseEnglishSrt(srt('4'))).toThrow('material_english_only');
 });
});

it('preserves literal percent characters in native paths and decodes file URIs',()=>{expect(importFileName('/tmp/100%20.srt')).toBe('100%20.srt');expect(importFileName('file:///tmp/flight%20one.srt')).toBe('flight one.srt');});
