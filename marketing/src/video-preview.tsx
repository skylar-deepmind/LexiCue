import {createRoot} from 'react-dom/client';
import {useEffect,useRef,useState} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {Play,Pause,RotateCcw,Volume2,VolumeX,Sun,Moon} from 'lucide-react';
import {RevisedVideo} from './RevisedVideo';
import {horizontalRevision,verticalRevision,author,videoFrames,videoDuration,videoFps} from './video-revision.mjs';
import './styles.css';
import './experience.css';
import './video-preview.css';
import './video-preview-page.css';
(window as any).remotion_staticBase=new URL('.',location.href).pathname.replace(/\/$/,'');
function Preview(){
 const player=useRef<PlayerRef>(null),audio=useRef<HTMLAudioElement>(null);
 const [portrait,setPortrait]=useState(false),[playing,setPlaying]=useState(false),[sound,setSound]=useState(false),[frame,setFrame]=useState(0),[theme,setTheme]=useState('ocean'),[locale,setLocale]=useState('zh');
 const timeline=portrait?verticalRevision:horizontalRevision,duration=videoFrames(portrait);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 useEffect(()=>{const el=player.current;if(!el)return;
  const tick=(e:any)=>{setFrame(e.detail.frame);if(audio.current&&sound&&Math.abs(audio.current.currentTime-e.detail.frame/videoFps)>.15)audio.current.currentTime=e.detail.frame/videoFps;};
  const play=()=>{setPlaying(true);if(sound)void audio.current?.play().catch(()=>{});};const pause=()=>{setPlaying(false);audio.current?.pause();};
  el.addEventListener('frameupdate',tick);el.addEventListener('play',play);el.addEventListener('pause',pause);el.addEventListener('ended',pause);
  return()=>{el.removeEventListener('frameupdate',tick);el.removeEventListener('play',play);el.removeEventListener('pause',pause);el.removeEventListener('ended',pause);};
 },[portrait,sound]);
 const seek=(n:number)=>{player.current?.seekTo(n);if(audio.current)audio.current.currentTime=n/videoFps;};
 const switchFormat=(value:boolean)=>{player.current?.pause();audio.current?.pause();setPlaying(false);setPortrait(value);setFrame(0);};
 useEffect(()=>{(window as any).__lexicueVideoPreview={seek:(n:number)=>{player.current?.pause();seek(n);},format:switchFormat,frame:()=>player.current?.getCurrentFrame()};return()=>{delete (window as any).__lexicueVideoPreview;};},[portrait]);
 return <main className="video-preview-page"><header><div><p>LEXICUE / VIDEO PREVIEW</p><h1>宣传视频改版预览</h1><span>按当前产品界面更新 · GitHub 作者片尾 · 最终导出节奏</span></div><button className="ui-button" aria-label="切换预览页亮暗模式" onClick={()=>setTheme(theme==='ocean'?'midnight':'ocean')}>{theme==='ocean'?<Moon size={19}/>:<Sun size={19}/>}</button></header>
  <div className="preview-format" role="group" aria-label="视频画幅"><button className="ui-button" aria-pressed={!portrait} onClick={()=>switchFormat(false)}>横版 · {videoDuration(false)} 秒</button><button className="ui-button" aria-pressed={portrait} onClick={()=>switchFormat(true)}>竖版 · {videoDuration(true)} 秒</button><button className="ui-button" aria-pressed={locale==='zh'} onClick={()=>setLocale('zh')}>中文</button><button className="ui-button" aria-pressed={locale==='en'} onClick={()=>setLocale('en')}>English</button><a href={author.url} target="_blank" rel="noreferrer">作者 GitHub ↗</a></div>
  <div className={`preview-player ${portrait?'preview-player-portrait':''}`}><Player key={String(portrait)} ref={player} component={RevisedVideo} inputProps={{portrait,subtitles:true,locale}} durationInFrames={duration} fps={videoFps} compositionWidth={portrait?1080:1920} compositionHeight={portrait?1920:1080} style={{width:'100%'}} controls={false} clickToPlay={false} spaceKeyToPlayOrPause={false} moveToBeginningWhenEnded={false}/></div>
  <div className="preview-controls"><button className="ui-button preview-play" onClick={()=>player.current?.toggle()}>{playing?<Pause size={18}/>:<Play size={18}/>} {playing?'暂停':'播放预览'}</button><button className="ui-button" onClick={()=>{seek(0);player.current?.play();}}><RotateCcw size={18}/>重播</button><button className="ui-button" aria-pressed={sound} onClick={()=>{const next=!sound;setSound(next);if(next&&playing)void audio.current?.play().catch(()=>{});else audio.current?.pause();}}>{sound?<Volume2 size={18}/>:<VolumeX size={18}/>} {sound?'关闭配乐':'试听原配乐'}</button><span>{(frame/videoFps).toFixed(1)} / {duration/videoFps} 秒</span></div>
  <audio ref={audio} src={portrait?'vertical-preview.m4a':'horizontal-preview.m4a'} preload="none"/>
  <nav className="preview-chapters" aria-label="跳转分镜">{timeline.map(s=><button className="ui-button" key={s.id} aria-current={frame>=s.start*videoFps&&frame<s.end*videoFps?'step':undefined} onClick={()=>seek((s.start+.7)*videoFps)}><small>{s.start}–{s.end}s</small><span>{s.id==='intro'?'开场':s.id==='outro'?'作者片尾':({sources:'内容来源',import:'SRT 导入',tags:'文件标签',lookup:'点击查词',phrases:'词组分析',collect:'词汇整理',review:'原句复习',progress:'学习进度',languages:'语言主题',privacy:'本地保存',sync:'加密同步'})[s.id]}</span></button>)}</nav>
  <p className="preview-note">查看重点：点击与抽屉节奏、字幕可读性、作者片尾。横版片尾从 {horizontalRevision.at(-1).start} 秒开始，竖版从 {verticalRevision.at(-1).start} 秒开始。预览保留原配乐；点击音效会在确认分镜后按新时序调整。</p>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
