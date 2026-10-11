import {useState,useRef,useEffect,type RefObject} from 'react';
import {X} from 'lucide-react';
import {homeCopy,guideTargets} from './home-copy.mjs';
import {experienceCopy} from './experience-copy.mjs';
import {useHomeGuide} from './useHomeGuide';
export function HomeGuide({root,moduleKey,locale,control}:{root:RefObject<HTMLDivElement>;moduleKey:string;locale:string;control:ReturnType<typeof useHomeGuide>}){
 const [position,setPosition]=useState<any>(null),bubble=useRef<HTMLDivElement>(null);const c=experienceCopy[locale],h=homeCopy[locale];
 const shown=control.active===moduleKey;
 useEffect(()=>{
  if(!shown){setPosition(null);return;}let frame=0;let described:HTMLElement|null=null;
  const hide=()=>{setPosition(null);described?.removeAttribute('aria-describedby');described=null;};
  const measure=()=>{frame=0;const box=root.current;if(!box)return;const target=box.querySelector<HTMLElement>(guideTargets[moduleKey]);if(!target){hide();return;}
   const rect=target.getBoundingClientRect(),bounds=box.getBoundingClientRect(),content=box.querySelector('.sample-content')?.getBoundingClientRect(),nav=document.querySelector('.site-nav')?.getBoundingClientRect();
   const top=Math.max(bounds.top,content?.top||0,nav?.bottom||0)+6,bottom=Math.min(bounds.bottom,content?.bottom||innerHeight,innerHeight)-6;
   if(rect.top<top||rect.bottom>bottom||rect.width===0||rect.height===0){hide();return;}
   const width=Math.min(300,bounds.width-24),height=bubble.current?.offsetHeight||110;
   const left=Math.max(12,Math.min(rect.left-bounds.left,bounds.width-width-12));
   let y=rect.bottom-bounds.top+12;if(y+height>bottom-bounds.top)y=rect.top-bounds.top-height-12;
   // Only show when both the highlighted control and its explanation fit in view.
   if(y<Math.max(top-bounds.top,0)||y+height>bottom-bounds.top){hide();return;}
   setPosition({x:rect.left-bounds.left-4,y:rect.top-bounds.top-4,w:rect.width+8,h:rect.height+8,left,top:y,width});
   if(described!==target){described?.removeAttribute('aria-describedby');target.setAttribute('aria-describedby','home-guide-tip');described=target;}control.mark();
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};schedule();
  const resize=new ResizeObserver(schedule);if(root.current)resize.observe(root.current);
  const changes=new MutationObserver(schedule);if(root.current)changes.observe(root.current,{childList:true,subtree:true});
  document.addEventListener('scroll',schedule,true);addEventListener('resize',schedule);
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();control.dismiss();}};addEventListener('keydown',escape);
  return()=>{cancelAnimationFrame(frame);resize.disconnect();changes.disconnect();document.removeEventListener('scroll',schedule,true);removeEventListener('resize',schedule);removeEventListener('keydown',escape);described?.removeAttribute('aria-describedby');};
 },[shown,moduleKey,locale,root,control]);
 if(!shown||!position)return null;
 return <div className="home-guide-layer"><div className="home-guide-ring" aria-hidden="true" style={{left:position.x,top:position.y,width:position.w,height:position.h}}/><div ref={bubble} id="home-guide-tip" className="home-guide-tip" role="note" style={{left:position.left,top:position.top,width:position.width}}><p>{h[moduleKey]}</p><button aria-label={c.close} onClick={control.dismiss}><X size={16}/></button></div></div>;
}
