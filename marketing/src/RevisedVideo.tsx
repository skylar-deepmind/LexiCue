import {AbsoluteFill,Img,staticFile,useCurrentFrame,interpolate,interpolateColors} from 'remotion';
import {Fragment,useLayoutEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowRight,ArrowUpRight,Laptop,Smartphone,ShieldCheck,HardDrive,Download,Check,BookOpen,FileText,Play,Captions,Clapperboard,Upload} from 'lucide-react';
import {VideoSandbox} from '../generated/VideoSandbox';
import {author,horizontalRevision,verticalRevision,themeAt,videoThemes,themeLabels,closingBoundary,videoFps} from './video-revision.mjs';
import {videoSnapshot} from './video-snapshot.mjs';
import {videoThemeStyles} from '../generated/video-theme-tokens.mjs';
import {videoText,videoTimeline} from './video-copy.mjs';
const ease=(n:number,a:number,b:number)=>interpolate(n,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:t=>1-(1-t)**3});
function themeStyle(frame:number,seconds:number){const theme=themeAt(frame,seconds),index=videoThemes.indexOf(theme),style={...videoThemeStyles[theme]};if(index){const start=index*.16*seconds*videoFps,blendFrames=Math.round(videoFps/3),previous=videoThemeStyles[videoThemes[index-1]];for(const [key,value] of Object.entries(style))if(/^#[\da-f]{3,8}$/i.test(String(value))&&/^#[\da-f]{3,8}$/i.test(previous[key]))style[key]=interpolateColors(Math.min(start+blendFrames,Math.max(start,frame)),[start,start+blendFrames],[previous[key],String(value)]);}return style;}
const headingLines={import:['从一份字幕，','开始阅读。'],tags:['内容多了，','也能有条理。'],lookup:['遇到生词，','点一下。'],phrases:['不止单词，','也读懂表达。'],collect:['遇到的词，','都有来处。'],review:['带着原句，','再遇见一次。'],progress:['每一步，','都看得见。'],languages:['喜欢怎样读，','就怎样读。'],privacy:['学习记录，','留在本地。'],sync:['换个设备，','继续学。']};
function Github({size=28}:{size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.6-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.3c0 .32.22.69.82.58A12 12 0 0 0 12 .5Z"/></svg>;}
function ProductView({id,frame,seconds,portrait,theme,locale}:{id:string;frame:number;seconds:number;portrait:boolean;theme:string;locale:string}){
 const root=useRef<HTMLDivElement>(null),snapshot=videoSnapshot(id,frame,seconds,locale),[point,setPoint]=useState<any>(null);
 if(id==='languages')snapshot.themeStyles=themeStyle(frame,seconds);
 const t=frame/videoFps,click=snapshot.clickAt;
 useLayoutEffect(()=>{
  const box=root.current;if(!box)return;
  const content=box.querySelector('.sample-content');if(content)content.scrollTop=id==='progress'?ease(t/seconds,.35,.8)*300:id==='phrases'?ease(t/seconds,.32,.43)*150:0;
  const selector=snapshot.target;
  const target=selector?.startsWith('text:')?[...box.querySelectorAll<HTMLElement>('[role="button"]')].find(el=>el.textContent===selector.slice(5)):selector?box.querySelector<HTMLElement>(selector):null;
  if(!target){setPoint(null);return;}
  const r=target.getBoundingClientRect(),b=box.getBoundingClientRect(),scale=b.width/(portrait?620:1100);
  setPoint({x:(r.left+r.width*.5-b.left)/scale,y:(r.top+r.height*.5-b.top)/scale});
 },[frame,id,portrait,snapshot.target,seconds]);
 const cursor=point&&click!==null&&t>=Math.max(0,click-.85)&&t<=click+.12;
 const approach=ease(t,click-.85,click-.18),draw=snapshot.drawerAt===null?1:ease(t,snapshot.drawerAt,snapshot.drawerAt+.32);
 return <div ref={root} className={`video-product ${portrait?'video-product-portrait':'video-product-desktop'}`} data-theme={snapshot.session.theme||theme} style={{...(snapshot.themeStyles||{}),'--video-drawer-progress':draw} as any}>
  <VideoSandbox locale={locale} theme={theme} snapshot={snapshot}/>
  {cursor&&<div className="video-pointer" style={{left:point.x+(1-approach)*60,top:point.y+(1-approach)*45,opacity:approach}}>
   {t>click-.12&&<i style={{opacity:1-ease(t,click-.12,click+.12),transform:`translate(-50%,-50%) scale(${1+ease(t,click-.12,click+.12)*1.8})`}}/>}
   <svg width="27" height="34" viewBox="0 0 27 34"><path d="M2 2v25l7-6 6 11 5-3-6-10h11Z" fill="var(--text-strong)" stroke="var(--surface)" strokeWidth="2"/></svg>
  </div>}
 </div>;
}
function SyncView({progress,portrait,locale}:{progress:number;portrait:boolean;locale:string}){
 const copy=videoText(locale)?.sync;
 const known=(phone=false)=>progress>=(phone ? .65 : .15);
 const device=(phone=false)=><section className="video-sync-device">{phone?<Smartphone size={portrait?62:72}/>:<Laptop size={portrait?62:72}/>}<h3>{phone?(copy?.phone||'手机'):(copy?.computer||'电脑')}</h3><div><strong>meaningful</strong><span data-known={known(phone)}>{known(phone)?<><Check size={18}/>{copy?.known||'已掌握'}</>:(copy?.learning||'学习中')}</span></div></section>;
 const Direction=portrait?ArrowDown:ArrowRight,packet=ease(progress,.22,.65)*(portrait?70:100),active=progress>.22&&progress<.68;
 return <div className={`video-sync ${portrait?'vertical-sync':''}`}>
  <div className="video-sync-diagram">{device()}<div className="video-transfer" data-flow-direction={portrait?'down':'right'}><ShieldCheck size={42}/><p>{copy?.transfer||'加密传输'}</p><Direction size={portrait?24:22}/><div><i style={{opacity:active?1:0,transform:portrait?`translateY(${packet}px)`:`translateX(${packet}px)`}}/></div></div>{device(true)}</div>
  <p className="video-sync-result">{progress>.68?(copy?.result||'两端状态一致，接着上次的进度学。'):(copy?.changing||'学习状态变化，随设备接续。')}</p><small>{copy?.note||'同步原理示意 · 可选开启'}</small>
 </div>;
}
function SourceView({portrait,progress,locale}:{portrait:boolean;progress:number;locale:string}){
 const copy=videoText(locale)?.source;
 const videoReady=ease(progress,.08,.3),youtubeReady=ease(progress,.3,.54),fileReady=ease(progress,.2,.44),subtitleReady=ease(progress,.55,.78),libraryReady=ease(progress,.78,.98);
 const series=locale==='en'?[{title:'Breaking Bad',type:'Crime drama',art:'crime'},{title:'Stranger Things',type:'Sci-fi mystery',art:'mystery'},{title:'Friends',type:'Sitcom',art:'comedy'}]:[{title:'绝命毒师',type:'犯罪剧情',art:'crime'},{title:'怪奇物语',type:'科幻悬疑',art:'mystery'},{title:'老友记',type:'都市喜剧',art:'comedy'}];
 return <div className={`video-source-scene ${portrait?'video-source-portrait':''}`}>
  <header className="video-source-heading"><p className="video-eyebrow">{copy?.eyebrow||'从你喜欢的内容开始'}</p><h2>{copy?.title||'常看的视频，也能成为学习素材。'}</h2><span>{copy?.description||'YouTube 获取字幕，或导入自己的 SRT。'}</span></header>
  <div className="video-source-panels">
   <article className="video-source-card" data-source-panel="youtube">
    <div className="video-source-label"><span>01</span><span><Play size={16} fill="currentColor"/> {copy?.youtubeLabel||'YOUTUBE · 下载字幕'}</span></div>
    <h3>{copy?.youtubeTitle||'从 YouTube 下载字幕'}</h3><p>{copy?.youtubeDescription||'选择视频与可用字幕，下载后加入学习库。'}</p>
    <div className="video-source-youtube-demo">
     <div className="video-source-address"><Play size={16} fill="currentColor"/><span>youtube.com</span><small>{copy?.browserNote||'示意页面'}</small></div>
     <div className="video-source-video-result" style={{opacity:videoReady,transform:`translateY(${(1-videoReady)*12}px)`}}>
      <div className="video-source-thumbnail"><div className="video-source-sun"/><div className="video-source-horizon"/><div className="video-source-person"/><span className="video-source-play"><Play size={23} fill="currentColor"/></span><small>12:48</small></div>
      <div className="video-source-video-meta"><strong>{copy?.videoTitle||'A Day in the City'}</strong><span>{copy?.videoMeta||'English listening · Sample video'}</span><small>{copy?.videoHint||'选择有字幕的视频开始学习'}</small></div>
     </div>
     <div className="video-source-download-flow"><span data-active={progress>.18}>{copy?.chooseVideo||'选择视频'}</span><ArrowRight size={17}/><span data-active={progress>.5}>{copy?.chooseCaptions||'选择字幕'}</span><ArrowRight size={17}/><span data-active={progress>.82}>{copy?.addToLibrary||'加入文件库'}</span></div>
     <div className="video-source-caption-list" style={{opacity:youtubeReady,transform:`translateY(${(1-youtubeReady)*10}px)`}}>
      <div className="video-source-caption-heading"><span><Captions size={17}/> {copy?.captionHeading||'可用字幕'}</span><small>{copy?.captionHint||'选择要下载的语言'}</small></div>
      <div className="video-source-caption-row" data-selected="true"><span><i/>English · SRT</span><small>{copy?.original||'原字幕'}</small><strong><Download size={16}/> {copy?.download||'下载'}</strong></div>
      <div className="video-source-caption-row"><span><i/>{copy?.alternate||'日本語'}</span><small>{copy?.available||'可用字幕'}</small><Check size={17}/></div>
     </div>
     <div className="video-source-added" style={{opacity:libraryReady,transform:`translateX(${(1-libraryReady)*8}px)`}}><Check size={16}/> {copy?.added||'English.srt 已加入文件库'}</div>
    </div>
   </article>
   <article className="video-source-card" data-source-panel="srt">
    <div className="video-source-label"><span>02</span><span><Clapperboard size={17}/> {copy?.fileLabel||'收藏剧集 · SRT'}</span></div>
    <h3>{copy?.fileTitle||'喜欢的剧集，也能自己导入'}</h3><p>{copy?.fileDescription||'把收藏影片的 SRT 字幕文件带进 LexiCue。'}</p>
    <div className="video-source-srt-demo">
     <div className="video-source-series-row">{series.map(({title,type,art},i)=><div className="video-source-series" data-art={art} key={title} style={{opacity:fileReady,transform:`translateY(${(1-fileReady)*10}px)`}}><div className="video-source-series-art"><i/><b/><em/></div><strong>{title}</strong><small>{type}</small></div>)}</div>
     <div className="video-source-file" data-ready={fileReady>.8} style={{opacity:fileReady,transform:`translateX(${(1-fileReady)*-12}px)`}}><FileText size={34}/><span><strong>stranger-things.S01E01.srt</strong><small>{copy?.fileNote||'本地 SRT · 自备字幕文件'}</small></span><span className="video-source-imported"><Upload size={15}/>{copy?.importable||'可导入'}</span></div>
     <div className="video-source-srt-line" style={{opacity:subtitleReady,transform:`translateY(${(1-subtitleReady)*10}px)`}}><time>00:00:12</time><span>{copy?.subtitle||'A small choice can change the whole day.'}</span></div>
     <small className="video-source-original-note">{copy?.sourceNote||'原创剪影示意 · 请导入自己持有的字幕文件'}</small>
    </div>
   </article>
  </div>
  <div className="video-source-bridge"><span>{copy?.bridge||'选择你熟悉的内容'}</span><ArrowRight size={25}/><strong>{copy?.bridgeAction||'在原句里阅读、查词与积累'}</strong></div>
 </div>;
}
function Outro({portrait,frame,locale}:{portrait:boolean;frame:number;locale:string}){
 const copy=videoText(locale)?.outro;
 const enter=ease(frame,0,Math.round(.6*videoFps)),card=ease(frame,Math.round(videoFps/3),videoFps);
 return <div className={`video-outro ${portrait?'outro-portrait':''}`}>
  <section className="video-outro-product" style={{opacity:enter,transform:`translateY(${(1-enter)*14}px)`}}><p className="video-eyebrow">{copy?.eyebrow||'READ WHAT YOU LOVE.'}</p><h1>{copy?.titleFirst||'从喜欢的内容，'}<br/><span>{copy?.titleSecond||'开始。'}</span></h1><p>LexiCue · {copy?.tagline||'免费开源 · 本地优先'}</p><a className="video-download" href="https://github.com/skylar-deepmind/LexiCue/releases/latest"><Download size={25}/>{copy?.download||'免费下载'}</a><p className="video-website">skylar-deepmind.github.io/LexiCue</p></section>
  <section className="video-author" style={{opacity:card,transform:`translateY(${(1-card)*16}px)`}}><div className="video-author-heading"><Img src={staticFile(author.avatar)} className="video-author-avatar"/><div><p>{copy?.authorEyebrow||'MEET THE MAKER'}</p><h2>{author.name}</h2><span>{copy?.role||author.role}</span></div></div><p className="video-author-invitation">{copy?.invitation?.length?copy.invitation.map((line:string,i:number)=><Fragment key={line}>{i>0&&<br/>}{line}</Fragment>):<>欢迎关注我的 GitHub，<br/>发现更多开源项目。</>}</p><a href={author.url} className="video-author-link"><Github size={portrait?30:28}/><span>{author.handle}</span><ArrowUpRight size={24}/></a></section>
 </div>;
}
function FilmBrand({locale}:{locale:string}){return <div className="video-brand"><Img src={staticFile('lexicue-icon.png')}/><strong>LexiCue</strong><span>{videoText(locale)?.brand||'免费 · 开源 · 本地优先'}</span></div>;}
function Ending({portrait,frame,subtitles,subtitle,locale}:{portrait:boolean;frame:number;subtitles:boolean;subtitle:string;locale:string}){
 const boundary=closingBoundary(frame,portrait);
 return <AbsoluteFill className={`revised-video video-ending ${portrait?'revised-portrait':''}`} data-theme="ocean" data-scene-layer="outro" style={videoThemeStyles.ocean as any}>
  {(['ocean','midnight'] as const).map(theme=><AbsoluteFill key={theme} className="video-ending-layer" data-ending-layer={theme} data-theme={theme} aria-hidden={theme==='midnight'?true:undefined} inert={theme==='midnight'?true:undefined} style={{...videoThemeStyles[theme],clipPath:theme==='midnight'?boundary.clip:undefined,background:theme==='ocean'?videoThemeStyles.ocean['--surface']:videoThemeStyles.midnight['--marketing-bg'],pointerEvents:theme==='midnight'?'none':undefined} as any}>
   <FilmBrand locale={locale}/><Outro portrait={portrait} frame={frame} locale={locale}/>
   {subtitles&&<p className="video-subtitle bookend-subtitle">{subtitle}</p>}
   <div className="video-footnote">{videoText(locale)?.footer||'原创样例数据 · 产品组件演示'} · {videoText(locale)?.music||'Music: Carefree / Kevin MacLeod · CC BY 4.0'}</div>
  </AbsoluteFill>)}
 </AbsoluteFill>;
}
function ThemeRibbon({theme,locale}:{theme:string;locale:string}){const labels=videoText(locale)?.themes;return <div className="video-theme-ribbon"><span>{labels?.heading||'主题'}</span><div>{videoThemes.map(name=><span key={name} data-selected={theme===name} data-video-theme={name}><i style={videoThemeStyles[name] as any}/>{labels?.labels?.[name]||themeLabels[name]}</span>)}</div></div>;}
function VideoSceneLayer({scene,absoluteFrame,portrait,subtitles,locale}:{scene:any;absoluteFrame:number;portrait:boolean;subtitles:boolean;locale:string}){
 const frame=absoluteFrame-Math.round(scene.start*videoFps),seconds=scene.end-scene.start,p=frame/(seconds*videoFps),enter=ease(frame,0,Math.round(.4*videoFps)),theme=scene.id==='languages'?themeAt(frame,seconds):'ocean';
 if(scene.id==='outro')return <Ending portrait={portrait} frame={frame} subtitles={subtitles} subtitle={scene.subtitle} locale={locale}/>;
 const bookend=scene.id==='intro'||scene.id==='outro';
 return <AbsoluteFill data-scene-layer={scene.id} data-theme={theme} className={`revised-video ${portrait?'revised-portrait':''}`} style={(scene.id==='languages'?themeStyle(frame,seconds):videoThemeStyles.ocean) as any}>
  <FilmBrand locale={locale}/>
  {scene.id==='intro'?<div className="video-intro" style={{opacity:enter}}><p className="video-eyebrow">{videoText(locale)?.intro?.eyebrow||'READ WHAT YOU LOVE.'}</p><h1>{videoText(locale)?.intro?.titleFirst||'喜欢的内容，'}<br/><span>{videoText(locale)?.intro?.titleSecond||'记得住的词汇。'}</span></h1><p>{videoText(locale)?.intro?.description||'导入 SRT 字幕，在原句中查词、积累和复习。'}</p><div>{(videoText(locale)?.intro?.tags||['SRT 字幕','原句理解','词汇复习']).map(tag=><span key={tag}>{tag}</span>)}</div></div>:scene.id==='sources'?<SourceView portrait={portrait} progress={p} locale={locale}/>:scene.id==='outro'?<Outro portrait={portrait} frame={frame} locale={locale}/>:<>
   <section className="video-scene-copy" style={{opacity:enter,transform:`translateY(${(1-enter)*12}px)`}}><p className="video-eyebrow">{scene.eyebrow||({import:'开始阅读',tags:'内容整理',lookup:'离线查词',phrases:'语境理解',collect:'词汇积累',review:'原句复习',progress:'学习进度',languages:'语言与主题',privacy:'本地优先',sync:'多端接续'})[scene.id]}</p><h2>{portrait?scene.title:(scene.headingLines||headingLines[scene.id]).map((line:string,i:number)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h2>{!portrait&&<p className="video-description">{scene.description}</p>}{scene.id==='phrases'&&<small>{locale==='en'?'Optional AI · Fixed sample · Analysis accelerated':'AI 可选 · 固定样例 · 过程已加速'}</small>}</section>
   <div className={`video-window ${scene.id==='languages'?'video-window-theme':''}`} style={{opacity:enter}}>{scene.id==='languages'&&<ThemeRibbon theme={theme} locale={locale}/>} {scene.id==='sync'?<SyncView progress={p} portrait={portrait} locale={locale}/>:scene.id==='privacy'?<div className="video-local"><HardDrive size={96}/><h3>{videoText(locale)?.privacy?.title||'默认本地保存'}</h3><p>{videoText(locale)?.privacy?.items[0]||'阅读 · 词典 · 复习'}</p><div><span><Download size={24}/>{videoText(locale)?.privacy?.export||'导出备份'}</span><span><BookOpen size={24}/>{videoText(locale)?.privacy?.restore||'恢复学习记录'}</span></div><small>{videoText(locale)?.privacy?.note||'云端 AI 与同步，由你主动开启。'}</small></div>:<div className="video-product-scale"><ProductView id={scene.id} frame={frame} seconds={seconds} portrait={portrait} theme={theme} locale={locale}/></div>}</div>
  </>}
  {subtitles&&<p className={`video-subtitle ${bookend?'bookend-subtitle':''}`}>{scene.subtitle}</p>}
  <div className="video-footnote">{videoText(locale)?.footer||'原创样例数据'} · {scene.id==='sync'?(locale==='en'?'Sync principle illustration':'同步原理示意'):(locale==='en'?'Product interface demonstration':'产品组件演示')}{scene.id==='outro'?' · '+(videoText(locale)?.music||'Music: Carefree / Kevin MacLeod · CC BY 4.0'):''}</div>
 </AbsoluteFill>;
}
export function RevisedVideo({portrait=false,subtitles=true,locale='zh'}:{portrait?:boolean;subtitles?:boolean;locale?:string}){
 const absoluteFrame=useCurrentFrame(),timeline=videoTimeline(locale,portrait,{horizontal:horizontalRevision,vertical:verticalRevision});
 const index=Math.max(0,timeline.findIndex(scene=>absoluteFrame>=Math.round(scene.start*videoFps)&&absoluteFrame<Math.round(scene.end*videoFps))),scene=timeline[index],transitionFrames=Math.round(.4*videoFps),half=transitionFrames/2;
 const transitionIndex=timeline.findIndex((candidate,i)=>i>0&&absoluteFrame>=Math.round(candidate.start*videoFps)-half&&absoluteFrame<Math.round(candidate.start*videoFps)+half);
 if(transitionIndex>0){
  const next=timeline[transitionIndex],previous=timeline[transitionIndex-1],start=Math.round(next.start*videoFps),progress=Math.max(0,Math.min(1,(absoluteFrame-(start-half))/transitionFrames)),eased=progress*progress*(3-2*progress);
  const drift=(amount:number)=>portrait?`translateY(${amount}%)`:`translateX(${amount}%)`;
  return <AbsoluteFill className="video-transition-stage" data-transition={previous.id+'-'+next.id} data-transition-progress={eased}>
  <div className="video-transition-layer" data-transition-layer={previous.id} style={{transform:drift(-eased*100)}}><VideoSceneLayer scene={previous} absoluteFrame={Math.min(absoluteFrame,start-1)} portrait={portrait} subtitles={subtitles} locale={locale}/></div>
  <div className="video-transition-layer" data-transition-layer={next.id} style={{transform:drift((1-eased)*100)}}><VideoSceneLayer scene={next} absoluteFrame={Math.max(absoluteFrame,start)} portrait={portrait} subtitles={subtitles} locale={locale}/></div>
  </AbsoluteFill>;
 }
 return <VideoSceneLayer scene={scene} absoluteFrame={absoluteFrame} portrait={portrait} subtitles={subtitles} locale={locale}/>;
}
