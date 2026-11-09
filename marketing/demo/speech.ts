import {create} from 'zustand';
export const SPEECH_START_TIMEOUT_MS=8000;
type BrowserSpeechPreferences={accent?:'us'|'gb';speed?:'normal'|'slow'};
let readPreferences:()=>BrowserSpeechPreferences=()=>({accent:'us',speed:'normal'});
export function configureBrowserSpeechPreferences(read:()=>BrowserSpeechPreferences){readPreferences=read;}
const preferenceRate=()=>readPreferences().speed==='slow'?0.8:1;
let utterance:SpeechSynthesisUtterance|null=null,generation=0,queue:any[]=[],eventTimer:ReturnType<typeof setTimeout>|undefined;
const clearEventTimer=()=>{clearTimeout(eventTimer);eventTimer=undefined;};
const initial={owner:null,ownerScope:null,key:null,status:'idle',pauseReason:null,rate:1,currentSegment:null,resumeMode:null,reading:null,loading:false,source:null,error:false,errorCode:null,errorKey:null,queueActive:false,queueIndex:null,playbackMode:null,continuousFileId:null,continuousSourceKey:null,continuousAssetId:null};
export const useSpeechStore=create<any>((set,get)=>{
 const stop=()=>{clearEventTimer();++generation;window.speechSynthesis?.cancel();utterance=null;queue=[];set({...initial,rate:get().rate});};
 const fail=(token:number,key:string,code:string)=>{
  if(token!==generation)return;
  clearEventTimer();++generation;window.speechSynthesis?.cancel();utterance=null;
  set({status:'error',loading:false,error:true,errorKey:key,errorCode:code,queueActive:false,
   reading:get().reading?{...get().reading,status:'error',errorCode:code}:null});
 };
 const awaitPlayback=(token:number,key:string,code:string)=>{
  clearEventTimer();eventTimer=setTimeout(()=>{
   if(token===generation&&get().loading)fail(token,key,code);
  },SPEECH_START_TIMEOUT_MS);
 };
 const play=async(text:string,key:string,options:any={},index:number|null=null)=>{
  clearEventTimer();const token=++generation;window.speechSynthesis?.cancel();utterance=null;
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){fail(token,key,'browser_unavailable');return;}
  const preferences=readPreferences();
  const item=new SpeechSynthesisUtterance(text);utterance=item;item.lang=preferences.accent==='gb'?'en-GB':'en-US';item.rate=preferenceRate()*get().rate;
  const voices=window.speechSynthesis.getVoices();const matching=voices.filter(voice=>voice.lang.toLowerCase().replace('_','-')===item.lang.toLowerCase());
  const voice=matching.find(voice=>voice.localService)||matching[0];if(voice)item.voice=voice;
  const reading=index===null?null:{key:queue[0]?.key??key,index,mode:'tts-queue',status:'loading',rate:get().rate,pauseReason:null,resumeMode:'continue',errorCode:null};
  set({owner:options.owner??null,ownerScope:options.ownerScope??null,key,status:'loading',loading:true,error:false,errorKey:null,errorCode:null,source:'device',currentSegment:index===null?null:{key,index},queueIndex:index,queueActive:index!==null,playbackMode:index===null?'single':'tts-queue',reading});
  const playing=()=>{
   if(token!==generation||utterance!==item)return;
   clearEventTimer();set({status:'playing',loading:false,pauseReason:null,reading:get().reading?{...get().reading,status:'playing',pauseReason:null,errorCode:null}:null});
  };
  // These are the only transitions to playing: actual browser playback events.
  item.onstart=playing;item.onresume=playing;
  item.onpause=()=>{
   if(token!==generation||utterance!==item)return;
   clearEventTimer();set({status:'paused',loading:false,reading:get().reading?{...get().reading,status:'paused',pauseReason:get().pauseReason}:null});
  };
  item.onerror=()=>fail(token,key,'browser_speech_failed');
  item.onend=()=>{
   if(token!==generation||utterance!==item)return;
   clearEventTimer();utterance=null;++generation;
   if(index!==null&&index+1<queue.length){const next=queue[index+1];void play(next.text,next.key,options,index+1);}
   else set({status:'idle',loading:false,queueActive:false,reading:get().reading?{...get().reading,status:'ended'}:null});
  };
  awaitPlayback(token,key,'browser_speech_start_timeout');
  try{window.speechSynthesis.speak(item);}catch{fail(token,key,'browser_speech_failed');}
 };
 const replay=async()=>{
  const index=get().queueIndex;
  if(index!==null&&queue[index])await play(queue[index].text,queue[index].key,{},index);
 };
 return {...initial,
  speak:(text:string,key:string,options:any)=>{queue=[];return play(text,key,options);},stop,
  stopOwned:(owner:string)=>{if(get().owner===owner)stop();},stopScope:(scope:string)=>{if(get().ownerScope===scope)stop();},
  startQueue:async(items:any[],startIndex=0)=>{queue=[...items];if(queue[startIndex])await play(queue[startIndex].text,queue[startIndex].key,{},startIndex);},
  pause:(reason='user')=>{
   if(!utterance||!['playing','loading'].includes(get().status))return;
   set({pauseReason:reason});window.speechSynthesis?.pause();
  },
  resume:async()=>{
   // Ended/failed utterances cannot be resumed by the browser. Submit a real
   // utterance again and wait for its onstart, keeping the current queue index.
   if(!utterance||get().status==='error'||get().reading?.status==='ended'){await replay();return;}
   if(get().status!=='paused')return;
   const token=generation,key=get().key;
   set({status:'loading',loading:true,error:false,errorKey:null,errorCode:null,reading:get().reading?{...get().reading,status:'loading'}:null});
   awaitPlayback(token,key,'browser_speech_resume_timeout');
   try{window.speechSynthesis?.resume();}catch{fail(token,key,'browser_speech_failed');}
  },
  replayCurrent:replay,
  setRate:(rate:number)=>{set({rate,reading:get().reading?{...get().reading,rate}:null});if(utterance)utterance.rate=preferenceRate()*rate;},
  exitReading:stop,clearCache:async()=>stop(),
  startSourceContinuous:async()=>{set({status:'error',error:true,errorCode:'browser_source_unavailable'});},jumpSourceContinuous:()=>false,
 };
});
export const prepareSpeech=()=>{window.speechSynthesis?.getVoices();};
