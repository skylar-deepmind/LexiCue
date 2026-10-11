import {useRef,useEffect,useLayoutEffect,useState,useCallback,type RefObject,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {useSampleFocus} from './useSampleFocus';
export function DetailDrawer({root,title,closeLabel,onClose,children,passive=false}:{root:RefObject<HTMLDivElement>;title:string;closeLabel:string;onClose:()=>void;children:ReactNode;passive?:boolean}){
 const panel=useRef<HTMLElement>(null),layer=useRef<HTMLDivElement>(null),close=useRef(onClose),timer=useRef<number|null>(null),closingRef=useRef(false);const [closing,setClosing]=useState(false);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);},[]);
 const requestClose=useCallback(()=>{if(closingRef.current)return;closingRef.current=true;if(matchMedia('(prefers-reduced-motion:reduce)').matches){close.current();return;}setClosing(true);timer.current=window.setTimeout(()=>close.current(),200);},[]);
 useSampleFocus(panel,root,requestClose,'h3',!passive);
 useLayoutEffect(()=>{
  const el=panel.current,overlay=layer.current,box=root.current;if(passive||!el||!overlay||!box)return;let frame=0;
  const place=()=>{frame=0;const r=overlay.getBoundingClientRect(),nav=document.querySelector('.site-nav')?.getBoundingClientRect();const top=Math.max(r.top,nav?.bottom||0),bottom=Math.min(r.bottom,innerHeight-8),available=bottom-top;if(available<=0)return;const mobile=innerWidth<=650;el.style.height=(mobile?Math.min(r.height*.78,available):available)+'px';el.style.top=mobile?'auto':(top-r.top)+'px';el.style.bottom=mobile?(r.bottom-bottom)+'px':'auto';};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(place);};place();const resize=new ResizeObserver(schedule);resize.observe(box);document.addEventListener('scroll',schedule,true);addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);resize.disconnect();document.removeEventListener('scroll',schedule,true);removeEventListener('resize',schedule);};
 },[root,passive]);
 return <div ref={layer} className="sample-detail-overlay" data-closing={closing}><div className="sample-detail-scrim" aria-hidden="true" onClick={requestClose}/><section ref={panel} className="sample-definition sample-detail-panel" role="dialog" aria-modal="true" aria-labelledby="sample-detail-title" tabIndex={-1}><div className="sample-detail-handle" aria-hidden="true"/><header className="sample-detail-heading"><h3 id="sample-detail-title" tabIndex={-1}>{title}</h3><button className="ui-button" aria-label={closeLabel} onClick={requestClose}><X size={18}/></button></header><div className="sample-definition-body">{children}</div></section></div>;
}
