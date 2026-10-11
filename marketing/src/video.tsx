import {AbsoluteFill,Composition,registerRoot,useCurrentFrame,interpolate,Img,staticFile,delayRender,continueRender} from 'remotion';
import {useEffect,useState} from 'react';
import {Scene} from './Scene';
import {copy,features,horizontalTimeline,verticalTimeline} from './catalogue.mjs';
import '../generated/scene.css';
export function Video({portrait=false,subtitles=true}:{portrait?:boolean;subtitles?:boolean}){
 const f=useCurrentFrame(),t=f/30,timeline=portrait?verticalTimeline:horizontalTimeline;
 const current=timeline.find(s=>t>=s.start&&t<s.end)||timeline.at(-1)!;
 const local=f-current.start*30,seconds=current.end-current.start;
 const [ready]=useState(()=>delayRender('Original sample definitions and fonts'));
 useEffect(()=>{const timer=setTimeout(()=>continueRender(ready),180);return()=>clearTimeout(timer);},[ready]);
 const progress=Math.min(1,local/seconds/30),enter=interpolate(local,[0,15],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
 const c=copy.zh,index=features.findIndex(x=>x.id===current.id),theme=(current.id==='languages'&&progress>.65)||current.id==='sync'?'midnight':'ocean';
 const bookend=current.id==='intro'||current.id==='outro';
 return <AbsoluteFill data-theme={theme} style={{background:'var(--marketing-bg)',color:'var(--marketing-heading)',fontFamily:"-apple-system, 'PingFang SC', 'Hiragino Kaku Gothic ProN', sans-serif",overflow:'hidden'}}>
  <div style={{position:'absolute',width:1200,height:1200,borderRadius:'50%',background:'var(--accent-100)',opacity:.3,left:portrait?-300:900,top:-400}}/>
  <div style={{position:'absolute',left:portrait?70:90,top:portrait?80:60,display:'flex',alignItems:'center',gap:18,fontSize:portrait?35:30,fontWeight:750}}><Img src={staticFile('lexicue-icon.png')} style={{width:portrait?62:48,height:portrait?62:48,borderRadius:12}}/>LexiCue<span style={{fontSize:portrait?21:18,fontWeight:400,color:'var(--marketing-muted)',marginLeft:15}}>免费 · 开源 · 本地优先</span></div>
  {bookend?<div style={{position:'absolute',inset:portrait?'330px 70px 240px':'240px 120px 180px',display:'flex',flexDirection:'column',alignItems:portrait?'flex-start':'center',justifyContent:'center',textAlign:portrait?'left':'center',opacity:enter,transform:`translateY(${(1-enter)*18}px)`}}>
    <p style={{fontSize:portrait?26:22,letterSpacing:4,color:'var(--accent-700)',marginBottom:35}}>READ WHAT YOU LOVE.</p>
    <h1 style={{fontSize:portrait?83:100,lineHeight:1.22,letterSpacing:-3,margin:0}}>{current.id==='intro'?'喜欢的内容，':'从喜欢的内容，'}<br/><span style={{color:'var(--accent-700)'}}>{current.id==='intro'?'记得住的词汇。':'开始。'}</span></h1>
    <p style={{fontSize:portrait?30:28,lineHeight:1.8,marginTop:36,maxWidth:900,color:'var(--marketing-muted)'}}>{current.id==='intro'?'导入 → 阅读理解 → 积累 → 复习':'macOS · Windows · Android'}</p>
    {current.id==='outro'&&<><div style={{marginTop:35,background:'var(--marketing-primary)',color:'var(--marketing-primary-text)',padding:'20px 35px',fontSize:portrait?32:27,borderRadius:14}}>免费下载 · LexiCue</div><p style={{fontSize:portrait?24:22,marginTop:28,lineHeight:1.6}}>skylar-deepmind.github.io/LexiCue/</p></>}
   </div>:<>
    <div style={{position:'absolute',left:portrait?70:90,top:portrait?205:260,width:portrait?940:610,opacity:enter,transform:`translateY(${(1-enter)*20}px)`}}><p style={{fontSize:portrait?23:18,letterSpacing:3,color:'var(--accent-700)',marginBottom:30}}>0{index+1} / {current.id.toUpperCase()}</p><h2 style={{fontSize:portrait?64:62,lineHeight:1.3,letterSpacing:-1.5,margin:0,maxWidth:portrait?900:610,textWrap:'balance'}}>{c.titles[index]}</h2>{!portrait&&<p style={{fontSize:24,lineHeight:1.85,marginTop:32,maxWidth:530,color:'var(--marketing-muted)'}}>{c.descriptions[index]}</p>}{current.id==='phrases'&&<p style={{fontSize:portrait?20:18,color:'var(--marketing-violet)',marginTop:28}}>AI 可选 · 固定演示结果</p>}</div>
    <div style={{position:'absolute',left:portrait?75:735,top:portrait?510:240,width:portrait?930:1100,height:portrait?1245:660,borderRadius:18,overflow:'hidden',border:'1px solid var(--border)',boxShadow:'var(--marketing-shadow)',opacity:enter}}><div style={{width:portrait?620:1100,height:portrait?830:660,transform:portrait?'scale(1.5)':'none',transformOrigin:'top left'}}><Scene id={current.id} locale="zh" theme={theme} portrait={portrait} seconds={seconds} frame={local}/></div></div>
   </>}
  {subtitles&&<div style={{position:'absolute',left:portrait?65:160,right:portrait?65:160,bottom:portrait?72:95,textAlign:'center',fontSize:portrait?34:30,lineHeight:1.55,color:'var(--marketing-heading)',background:'var(--surface)',border:'1px solid var(--border)',padding:portrait?'19px 24px':'15px 30px',borderRadius:12}}>{current.subtitle}</div>}
  <div style={{position:'absolute',left:portrait?70:90,bottom:portrait?28:30,fontSize:portrait?15:14,color:'var(--marketing-muted)'}}>原创演示数据 · {current.id==='sync'?'同步原理示意':'产品组件演示'}{current.id==='outro'?' · Music: Carefree / Kevin MacLeod · CC BY 4.0':''}</div>
  <div style={{position:'absolute',bottom:0,height:5,width:`${f/(portrait?900:2700)*100}%`,background:'var(--accent-600)'}}/>
 </AbsoluteFill>;
}
export function Root(){return <>{[false,true].map(portrait=><Composition key={String(portrait)} id={portrait?'Vertical':'Horizontal'} component={Video} durationInFrames={portrait?900:2700} fps={30} width={portrait?1080:1920} height={portrait?1920:1080} defaultProps={{portrait,subtitles:true}}/>)}</>;}
registerRoot(Root);
