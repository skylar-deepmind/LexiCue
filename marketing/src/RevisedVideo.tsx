import {AbsoluteFill,Img,staticFile,useCurrentFrame,interpolate,interpolateColors} from 'remotion';
import {useLayoutEffect,useRef,useState} from 'react';
import {ArrowUpRight,Laptop,Smartphone,ShieldCheck,HardDrive,Download,Check,BookOpen} from 'lucide-react';
import {VideoSandbox} from '../generated/VideoSandbox';
import {author,revisionAt,themeAt,videoThemes,themeLabels,closingBoundary} from './video-revision.mjs';
import {videoSnapshot} from './video-snapshot.mjs';
import {videoThemeStyles} from '../generated/video-theme-tokens.mjs';
const ease=(n:number,a:number,b:number)=>interpolate(n,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:t=>1-(1-t)**3});
function themeStyle(frame:number,seconds:number){const theme=themeAt(frame,seconds),index=videoThemes.indexOf(theme),style={...videoThemeStyles[theme]};if(index){const start=index*.16*seconds*30,previous=videoThemeStyles[videoThemes[index-1]];for(const [key,value] of Object.entries(style))if(/^#[\da-f]{3,8}$/i.test(String(value))&&/^#[\da-f]{3,8}$/i.test(previous[key]))style[key]=interpolateColors(Math.min(start+10,Math.max(start,frame)),[start,start+10],[previous[key],String(value)]);}return style;}
const headingLines={import:['从一份字幕，','开始阅读。'],tags:['内容多了，','也能有条理。'],lookup:['遇到生词，','点一下。'],phrases:['不止单词，','也读懂表达。'],collect:['遇到的词，','都有来处。'],review:['带着原句，','再遇见一次。'],progress:['每一步，','都看得见。'],languages:['喜欢怎样读，','就怎样读。'],privacy:['学习记录，','留在本地。'],sync:['换个设备，','继续学。']};
function Github({size=28}:{size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.6-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.3c0 .32.22.69.82.58A12 12 0 0 0 12 .5Z"/></svg>;}
function ProductView({id,frame,seconds,portrait,theme}:{id:string;frame:number;seconds:number;portrait:boolean;theme:string}){
 const root=useRef<HTMLDivElement>(null),snapshot=videoSnapshot(id,frame,seconds),[point,setPoint]=useState<any>(null);
 if(id==='languages')snapshot.themeStyles=themeStyle(frame,seconds);
 const t=frame/30,click=snapshot.clickAt;
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
  <VideoSandbox locale="zh" theme={theme} snapshot={snapshot}/>
  {cursor&&<div className="video-pointer" style={{left:point.x+(1-approach)*60,top:point.y+(1-approach)*45,opacity:approach}}>
   {t>click-.12&&<i style={{opacity:1-ease(t,click-.12,click+.12),transform:`translate(-50%,-50%) scale(${1+ease(t,click-.12,click+.12)*1.8})`}}/>}
   <svg width="27" height="34" viewBox="0 0 27 34"><path d="M2 2v25l7-6 6 11 5-3-6-10h11Z" fill="var(--text-strong)" stroke="var(--surface)" strokeWidth="2"/></svg>
  </div>}
 </div>;
}
function SyncView({progress,portrait}:{progress:number;portrait:boolean}){
 const known=(phone=false)=>progress>=(phone ? .65 : .15);
 const device=(phone=false)=><section className="video-sync-device">{phone?<Smartphone size={portrait?62:72}/>:<Laptop size={portrait?62:72}/>}<h3>{phone?'手机':'电脑'}</h3><div><strong>meaningful</strong><span data-known={known(phone)}>{known(phone)?<><Check size={18}/>已掌握</>:'学习中'}</span></div></section>;
 return <div className={`video-sync ${portrait?'vertical-sync':''}`}>
  <div className="video-sync-diagram">{device()}<div className="video-transfer"><ShieldCheck size={42}/><p>加密传输</p><div><i style={{opacity:progress>.22&&progress<.68?1:0,transform:`translateX(${ease(progress,.22,.65)*100}px)`}}/></div></div>{device(true)}</div>
  <p className="video-sync-result">{progress>.68?'两端状态一致，接着上次的进度学。':'学习状态变化，随设备接续。'}</p><small>同步原理示意 · 可选开启</small>
 </div>;
}
function Outro({portrait,frame}:{portrait:boolean;frame:number}){
 const enter=ease(frame,0,18),card=ease(frame,10,30);
 return <div className={`video-outro ${portrait?'outro-portrait':''}`}>
  <section className="video-outro-product" style={{opacity:enter,transform:`translateY(${(1-enter)*14}px)`}}><p className="video-eyebrow">READ WHAT YOU LOVE.</p><h1>从喜欢的内容，<br/><span>开始。</span></h1><p>LexiCue · 免费开源 · 本地优先</p><a className="video-download" href="https://github.com/skylar-deepmind/LexiCue/releases/latest"><Download size={25}/>免费下载</a><p className="video-website">skylar-deepmind.github.io/LexiCue</p></section>
  <section className="video-author" style={{opacity:card,transform:`translateY(${(1-card)*16}px)`}}><div className="video-author-heading"><Img src={staticFile(author.avatar)} className="video-author-avatar"/><div><p>MEET THE MAKER</p><h2>{author.name}</h2><span>{author.role}</span></div></div><p className="video-author-invitation">欢迎关注我的 GitHub，<br/>发现更多开源项目。</p><a href={author.url} className="video-author-link"><Github size={portrait?30:28}/><span>{author.handle}</span><ArrowUpRight size={24}/></a></section>
 </div>;
}
function FilmBrand(){return <div className="video-brand"><Img src={staticFile('lexicue-icon.png')}/><strong>LexiCue</strong><span>免费 · 开源 · 本地优先</span></div>;}
function Ending({portrait,frame,subtitles,subtitle}:{portrait:boolean;frame:number;subtitles:boolean;subtitle:string}){
 const boundary=closingBoundary(frame,portrait);
 return <AbsoluteFill className={`revised-video video-ending ${portrait?'revised-portrait':''}`} data-theme="ocean" style={videoThemeStyles.ocean as any}>
  {(['ocean','midnight'] as const).map(theme=><AbsoluteFill key={theme} className="video-ending-layer" data-ending-layer={theme} data-theme={theme} aria-hidden={theme==='midnight'?true:undefined} inert={theme==='midnight'?true:undefined} style={{...videoThemeStyles[theme],clipPath:theme==='midnight'?boundary.clip:undefined,background:theme==='ocean'?videoThemeStyles.ocean['--surface']:videoThemeStyles.midnight['--marketing-bg'],pointerEvents:theme==='midnight'?'none':undefined} as any}>
   <FilmBrand/><Outro portrait={portrait} frame={frame}/>
   {subtitles&&<p className="video-subtitle bookend-subtitle">{subtitle}</p>}
   <div className="video-footnote">原创样例数据 · 产品组件演示 · Music: Carefree / Kevin MacLeod · CC BY 4.0</div>
  </AbsoluteFill>)}
 </AbsoluteFill>;
}
function ThemeRibbon({theme}:{theme:string}){return <div className="video-theme-ribbon"><span>主题</span><div>{videoThemes.map(name=><span key={name} data-selected={theme===name} data-video-theme={name}><i style={videoThemeStyles[name] as any}/>{themeLabels[name]}</span>)}</div></div>;}
export function RevisedVideo({portrait=false,subtitles=true}:{portrait?:boolean;subtitles?:boolean}){
 const f=useCurrentFrame(),scene=revisionAt(f,portrait),frame=f-scene.start*30,seconds=scene.end-scene.start,p=frame/(seconds*30),enter=ease(frame,0,12),theme=scene.id==='languages'?themeAt(frame,seconds):'ocean';
 if(scene.id==='outro')return <Ending portrait={portrait} frame={frame} subtitles={subtitles} subtitle={scene.subtitle}/>;
 const bookend=scene.id==='intro'||scene.id==='outro';
 return <AbsoluteFill data-theme={theme} className={`revised-video ${portrait?'revised-portrait':''}`} style={(scene.id==='languages'?themeStyle(frame,seconds):videoThemeStyles.ocean) as any}>
  <FilmBrand/>
  {scene.id==='intro'?<div className="video-intro" style={{opacity:enter}}><p className="video-eyebrow">READ WHAT YOU LOVE.</p><h1>喜欢的内容，<br/><span>记得住的词汇。</span></h1><p>导入 SRT 字幕，在原句中查词、积累和复习。</p><div><span>SRT 字幕</span><span>原句理解</span><span>词汇复习</span></div></div>:scene.id==='outro'?<Outro portrait={portrait} frame={frame}/>:<>
   <section className="video-scene-copy" style={{opacity:enter,transform:`translateY(${(1-enter)*12}px)`}}><p className="video-eyebrow">{({import:'开始阅读',tags:'内容整理',lookup:'离线查词',phrases:'语境理解',collect:'词汇积累',review:'原句复习',progress:'学习进度',languages:'语言与主题',privacy:'本地优先',sync:'多端接续'})[scene.id]}</p><h2>{portrait?scene.title:headingLines[scene.id].map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h2>{!portrait&&<p className="video-description">{scene.description}</p>}{scene.id==='phrases'&&<small>AI 可选 · 固定样例 · 过程已加速</small>}</section>
   <div className={`video-window ${scene.id==='languages'?'video-window-theme':''}`} style={{opacity:enter}}>{scene.id==='languages'&&<ThemeRibbon theme={theme}/>} {scene.id==='sync'?<SyncView progress={p} portrait={portrait}/>:scene.id==='privacy'?<div className="video-local"><HardDrive size={96}/><h3>默认本地保存</h3><p>阅读 · 词典 · 复习</p><div><span><Download size={24}/>导出备份</span><span><BookOpen size={24}/>恢复学习记录</span></div><small>云端 AI 与同步，由你主动开启。</small></div>:<div className="video-product-scale"><ProductView id={scene.id} frame={frame} seconds={seconds} portrait={portrait} theme={theme}/></div>}</div>
  </>}
  {subtitles&&<p className={`video-subtitle ${bookend?'bookend-subtitle':''}`}>{scene.subtitle}</p>}
  <div className="video-footnote">原创样例数据 · {scene.id==='sync'?'同步原理示意':'产品组件演示'}{scene.id==='outro'?' · Music: Carefree / Kevin MacLeod · CC BY 4.0':''}</div>
 </AbsoluteFill>;
}
