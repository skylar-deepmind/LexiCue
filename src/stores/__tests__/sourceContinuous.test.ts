import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>{const values=new Map();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});vi.stubGlobal('navigator',{language:'en'});return{invoke:vi.fn()};});
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke,convertFileSrc:(p:string)=>`asset://${p}`}));
import { useSpeechStore } from '../speechStore';
import { usePreferencesStore } from '../preferencesStore';
import { normalizeSpeechPreferences } from '../../lib/speechPreferences';
import { readingGroups, readingIndexAt } from '../../lib/sourceContinuous';
const ranges=[[500,2600],[2000,4200],[3700,5500],[5000,6000],[6800,7300]];
const anchors=ranges.map(([start_ms,end_ms],index)=>({start_ms,end_ms,index,segment_id:index+10}));
const result={path:'/managed/a.m4a',file_id:1,source_key:'source-a',asset_id:'a'.repeat(64),start_ms:500,duration_ms:8000,anchors};
const request={fileId:1,sourceKey:'source-a',segmentId:10,index:0,key:'reader:a:continuous'};
class Player extends EventTarget {
 static all:Player[]=[];static metadataDuration=8;src='';preload='';duration=Player.metadataDuration;playbackRate=1;defaultPlaybackRate=1;paused=true;readyState=0;seeking=false;time=0;
 onplaying:(()=>void)|null=null;onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 load=vi.fn(()=>{this.playbackRate=this.defaultPlaybackRate;if(this.src)queueMicrotask(()=>{this.readyState=4;this.dispatchEvent(new Event('loadedmetadata'));});});
 seeks:number[]=[];
 set currentTime(v:number){this.time=v;this.seeks.push(v);this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
 get currentTime(){return this.time;}
 pause=vi.fn(()=>{this.paused=true;});
 play=vi.fn(async()=>{this.paused=false;this.onplaying?.();});
 removeAttribute(){this.src='';}
 constructor(){super();Player.all.push(this);}
}
let frames:Map<number,FrameRequestCallback>,sequence=0;
const speech=()=>useSpeechStore.getState();
const tick=(time:number)=>{const p=Player.all.at(-1)!;p.time=time;const [id,fn]=[...frames.entries()][0];frames.delete(id);fn(0);};
beforeEach(()=>{frames=new Map();vi.stubGlobal('Audio',Player);vi.stubGlobal('window',{addEventListener:vi.fn(),speechSynthesis:{getVoices:()=>[]}});vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++sequence,fn);return sequence});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));usePreferencesStore.setState({speech:normalizeSpeechPreferences(null)});speech().stop();Player.all=[];Player.metadataDuration=8;mocks.invoke.mockReset();mocks.invoke.mockResolvedValue(result);});
afterEach(()=>{speech().stop();vi.unstubAllGlobals();});
describe('whole-track original reading session',()=>{
 it('uses one resolve/Audio/load/initial seek across overlaps, gaps, missing rows and an early final cue',async()=>{
  await speech().startSourceContinuous(request);const p=Player.all[0];
  for(const [clock,index] of [[2.2,1],[3.9,2],[5.8,3],[6.4,null],[7.0,4],[7.8,null]] as const){tick(clock);expect(speech().queueIndex).toBe(index);expect(speech().status).toBe('playing');}
  expect(Player.all).toHaveLength(1);expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(p.load).toHaveBeenCalledTimes(1);expect(p.seeks).toEqual([.5]);expect(p.pause).not.toHaveBeenCalled();expect(p.play).toHaveBeenCalledTimes(1);
  expect(speech().key).toBe(request.key);expect(speech().queueActive).toBe(true);p.onended!();expect(speech()).toMatchObject({status:'idle',queueActive:false,playbackMode:null});expect(frames.size).toBe(0);
 });
 it('reuses the same validated player for explicit forward/back jumps and rejects another source or unmapped row',async()=>{
  await speech().startSourceContinuous(request);const p=Player.all[0];
  expect(speech().jumpSourceContinuous({...request,segmentId:13,index:3})).toBe(true);await Promise.resolve();tick(5.2);
  expect(speech().jumpSourceContinuous({...request,segmentId:10,index:0})).toBe(true);await Promise.resolve();
  expect(speech().jumpSourceContinuous({...request,sourceKey:'other',segmentId:11,index:1})).toBe(false);expect(speech().jumpSourceContinuous({...request,segmentId:99,index:2})).toBe(false);
  expect(p.seeks).toEqual([.5,5,.5]);expect(Player.all).toHaveLength(1);expect(p.load).toHaveBeenCalledTimes(1);expect(p.play).toHaveBeenCalledTimes(1);expect(p.pause).not.toHaveBeenCalled();
 });
 it('coalesces rapid jumps during native loading and cannot resurrect after stop',async()=>{
  let resolve!:(v:typeof result)=>void;mocks.invoke.mockImplementation(()=>new Promise(done=>{resolve=done}));const pending=speech().startSourceContinuous(request);
  speech().jumpSourceContinuous({...request,segmentId:11,index:1});speech().jumpSourceContinuous({...request,segmentId:13,index:3});resolve(result);await pending;expect(Player.all[0].seeks).toEqual([5]);
  speech().stop();const late=speech().startSourceContinuous(request);speech().stop();resolve(result);await late;expect(Player.all).toHaveLength(1);expect(speech().status).toBe('idle');expect(frames.size).toBe(0);
 });
 it('keeps real selected slow/default rates and stops when preferences change',async()=>{
  usePreferencesStore.setState({speech:{...normalizeSpeechPreferences(null),speed:'slow'}});await speech().startSourceContinuous(request);const p=Player.all[0];expect(p.playbackRate).toBe(.75);expect(p.defaultPlaybackRate).toBe(.75);
  speech().jumpSourceContinuous({...request,segmentId:11,index:1});await Promise.resolve();expect(p.playbackRate).toBe(.75);usePreferencesStore.setState({speech:normalizeSpeechPreferences(null)});expect(speech().status).toBe('idle');expect(p.paused).toBe(true);
 });
 it('accepts a different native container duration and still waits for natural ended',async()=>{
  Player.metadataDuration=16;
  await speech().startSourceContinuous(request);const p=Player.all[0];
  // Native WKWebView may expose a different duration for a DASH MP4 container.
  tick(7.9);expect(speech().status).toBe('playing');expect(p.pause).not.toHaveBeenCalled();
  p.onended!();expect(speech().status).toBe('idle');
 });
 it('a word TTS request preempts original audio and late original callbacks cannot revive it',async()=>{
  await speech().startSourceContinuous(request);const original=Player.all[0],lateEnded=original.onended!;
  const preferences=normalizeSpeechPreferences(null);
  mocks.invoke.mockResolvedValue({data_base64:'fixture',mime:'audio/mpeg',cache_key:'tts-fixture',source:'edge-cache',voice:preferences.voices[preferences.accent],speed:preferences.speed,duration_ms:1000});
  await speech().speak('word','word:tts',{kind:'word'});
  expect(original.paused).toBe(true);expect(speech()).toMatchObject({key:'word:tts',status:'playing',playbackMode:'single',continuousAssetId:null});
  lateEnded();expect(speech().key).toBe('word:tts');expect(Player.all).toHaveLength(2);
 });
 it('lookup scope cleanup never cancels a reader or a newer button with the same key',async()=>{
  await speech().startSourceContinuous(request);const reader=Player.all[0];speech().stopScope('old-card');speech().stopOwned('old-button');expect(reader.paused).toBe(false);
  const preferences=normalizeSpeechPreferences(null);mocks.invoke.mockResolvedValue({data_base64:'fixture',mime:'audio/mpeg',cache_key:'tts',source:'edge-cache',voice:preferences.voices[preferences.accent],speed:preferences.speed,duration_ms:1000});
  await speech().speak('first','lookup:term',{owner:'old-button',ownerScope:'old-card'});const old=Player.all[1];
  // A new card may have exactly the same public speech key. Owner identity is separate.
  speech().stop();await speech().speak('second','lookup:term',{owner:'new-button',ownerScope:'new-card'});const current=Player.all[2];speech().stopOwned('old-button');speech().stopScope('old-card');expect(current.paused).toBe(false);expect(old.paused).toBe(true);expect(speech().key).toBe('lookup:term');speech().stopScope('new-card');expect(current.paused).toBe(true);
 });
 it('does not synthesize on source failure, and a single clip preempts the continuous owner',async()=>{
  await speech().startSourceContinuous(request);const p=Player.all[0];p.onerror!();expect(speech().status).toBe('error');expect(mocks.invoke.mock.calls.some(c=>c[0]==='resolve_tts_audio')).toBe(false);
  await speech().startSourceContinuous(request);const second=Player.all[1];mocks.invoke.mockResolvedValue({path:'/managed/a.m4a',asset_id:'a'.repeat(64),start_ms:500,end_ms:2600,duration_ms:8000});await speech().speak('A clip.','saved:clip',{media:{record_id:'saved'}});expect(second.paused).toBe(true);expect(speech().playbackMode).toBe('single');
 });
 it('selects a stable cue representative, leaves gaps unhighlighted and never falls back to an older overlap',()=>{
  const groups=readingGroups([...anchors,{...anchors[0],index:6,segment_id:90}]);expect(readingIndexAt(groups,500)).toBe(0);expect(readingIndexAt(groups,2100)).toBe(1);expect(readingIndexAt(groups,6400)).toBe(null);expect(readingIndexAt(groups,7800)).toBe(null);
 });
});
