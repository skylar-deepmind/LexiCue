import {useState,useEffect,useRef} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {Play,Pause,RotateCcw} from 'lucide-react';
import {Scene} from './Scene';
import {copy,features} from './catalogue.mjs';
import {assetUrl} from './routes';
export function FeaturePlayer({id,locale,theme,active,hero=false,onChoose}:{id:string;locale:string;theme:'ocean'|'midnight';active:boolean;hero?:boolean;onChoose?:(id:string)=>void}) {
 const ref=useRef<PlayerRef>(null), [playing,setPlaying]=useState(false),[ready,setReady]=useState(hero),[portrait,setPortrait]=useState(innerWidth<650),[manual,setManual]=useState(false);
 const slot=useRef<HTMLDivElement>(null), c=copy[locale];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setReady(true);},{rootMargin:'250px'});if(slot.current)observer.observe(slot.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{const resized=()=>setPortrait(innerWidth<650);addEventListener('resize',resized);return()=>removeEventListener('resize',resized);},[]);
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(!entries[0]?.isIntersecting)ref.current?.pause();});if(slot.current)observer.observe(slot.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!active)ref.current?.pause();},[active,ready,reduced,manual,id]);
 useEffect(()=>{if(!ready)return; const player=ref.current;if(!player)return; const onPlay=()=>setPlaying(true),onPause=()=>setPlaying(false);const end=()=>{if(hero&&active&&!manual){const index=features.findIndex(f=>f.id===id);onChoose?.(features[(index+1)%6].id);}else player.pause();};player.addEventListener('play',onPlay);player.addEventListener('pause',onPause);player.addEventListener('ended',end);return()=>{player.removeEventListener('play',onPlay);player.removeEventListener('pause',onPause);player.removeEventListener('ended',end);};},[ready,hero,active,id,manual,onChoose]);
 const assetBase = assetUrl('');
 return <div className="demo-slot" role="group" aria-label={c.titles[features.findIndex(f=>f.id===id)]} data-player-id={hero?'hero':id} ref={slot}>
  {ready?<Player key={id+portrait} ref={ref} component={Scene} durationInFrames={240} fps={30} compositionWidth={portrait?620:1100} compositionHeight={portrait?830:660} style={{width:'100%',aspectRatio:portrait?'620/830':'1100/660'}} inputProps={{id,locale,theme,portrait,showPlaybackTrack:false,navigationVariant:'product',onSeek:(p:number)=>{setManual(true);ref.current?.pause();ref.current?.seekTo(Math.round(p*239));}}} initiallyShowControls={false} controls={false} clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} loop={false} initialFrame={reduced||!hero?165:0}/>:<img className="scene-poster" src={`${assetBase}media/${locale}/${id}.webp`} alt={c.titles[features.findIndex(f=>f.id===id)]} loading="lazy" width="1100" height="660"/>}
  <div className="player-controls"><span>{c.sample}</span><div><button onClick={()=>{if(!active)document.dispatchEvent(new CustomEvent('demo-activate',{detail:hero?'hero':id}));if(playing)ref.current?.pause();else{if(!manual||(ref.current?.getCurrentFrame()||0)>=239)ref.current?.seekTo(0);ref.current?.play();}setManual(true);}} aria-label={playing?c.pause:c.play}>{playing?<Pause size={16}/>:<Play size={16}/>}<span>{playing?c.pause:c.play}</span></button><button onClick={()=>{setManual(false);ref.current?.seekTo(0);if(active)ref.current?.play();}} aria-label={c.replay}><RotateCcw size={16}/><span>{c.replay}</span></button></div></div>
 </div>;
}
export function Capture(){
 const ref=useRef<PlayerRef>(null),q=new URLSearchParams(location.search);const id=q.get('scene')||'lookup',locale=q.get('lang')||'en',portrait=q.get('portrait')==='1',frame=Number(q.get('frame')||165),theme=q.get('theme')==='midnight'?'midnight':'ocean';
 useEffect(()=>{(window as any).__captureSeek=(n:number)=>ref.current?.seekTo(n);return()=>{delete (window as any).__captureSeek;};},[]);
 document.documentElement.dataset.theme=theme;
 return <div className="capture-root"><Player ref={ref} component={Scene} durationInFrames={240} fps={30} compositionWidth={portrait?620:1100} compositionHeight={portrait?830:660} style={{width:'100%'}} initialFrame={frame} inputProps={{id,locale,theme,portrait}} controls={false}/></div>;
}
