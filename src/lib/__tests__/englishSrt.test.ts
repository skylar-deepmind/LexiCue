import { describe, expect, it } from 'vitest';
import { importFileName } from '../materials';
import { parseEnglishSrt } from '../englishSrt';
const srt=(text:string)=>`1\n00:00:01,000 --> 00:00:03,000\n${text}\n`;
describe('English SRT import validation',()=>{
 it('keeps English, Chinese translation and actual timestamps',()=>{const rows=parseEnglishSrt('\uFEFF'+srt('We take off at noon.\n我们中午起飞。').replace(/\n/g,'\r\n'));expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({index:0,en_text:'We take off at noon.',zh_text:'我们中午起飞。',start_time:'00:00:01.000',end_time:'00:00:03.000'});});
 it.each(['','not a subtitle','1\n00:99:01,000 --> 00:00:03,000\nHello','1\n00:00:03,000 --> 00:00:01,000\nHello',srt('We fly.')+'\n2\nbad time\nBad cue'])('fails invalid or partial SRT rather than silently importing it',input=>{expect(()=>parseEnglishSrt(input)).toThrow();});
 it.each(['こんにちは。','我们今天学习。','Привет мир.','Wir sind heute nicht bereit.','Bonjour, nous sommes avec vous.','Hola, gracias por los libros.'])('rejects clearly unsupported source languages',text=>{expect(()=>parseEnglishSrt(srt(text))).toThrow('material_english_only');});
 it('does not fabricate a sentence from music captions',()=>{expect(()=>parseEnglishSrt(srt('[Music]'))).toThrow('material_english_only');});
});

it('preserves literal percent characters in native paths and decodes file URIs',()=>{expect(importFileName('/tmp/100%20.srt')).toBe('100%20.srt');expect(importFileName('file:///tmp/flight%20one.srt')).toBe('flight one.srt');});
