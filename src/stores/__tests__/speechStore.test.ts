import { afterEach,describe,expect,it,vi } from 'vitest';
import { useSpeechStore } from '../speechStore';
afterEach(()=>vi.unstubAllGlobals());
describe('single-owner English speech',()=>{
 it('cancels previous speech on ten rapid clicks and ignores old callbacks',()=>{
  const utterances:Array<{onend:()=>void;onerror:()=>void}>=[];const cancel=vi.fn();vi.stubGlobal('SpeechSynthesisUtterance',class {text:string;constructor(text:string){this.text=text;}});vi.stubGlobal('window',{speechSynthesis:{cancel,getVoices:()=>[{lang:'en-US',localService:true}],speak:(v:typeof utterances[number])=>utterances.push(v)}});
  for(let i=0;i<10;i++)useSpeechStore.getState().speak('English',String(i));
  expect(cancel).toHaveBeenCalledTimes(10);utterances[0].onend();utterances[1].onerror();expect(useSpeechStore.getState().key).toBe('9');useSpeechStore.getState().stop();utterances[9].onend();expect(useSpeechStore.getState().key).toBeNull();
 });
 it('exposes a nonblocking missing voice state without using another learning language',()=>{const speak=vi.fn();vi.stubGlobal('window',{speechSynthesis:{cancel:vi.fn(),getVoices:()=>[{lang:'ja-JP'}],speak}});useSpeechStore.getState().speak('Hello','one');expect(speak).not.toHaveBeenCalled();expect(useSpeechStore.getState()).toMatchObject({key:null,error:true});});
});
