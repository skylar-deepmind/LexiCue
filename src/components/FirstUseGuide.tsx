import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, X } from 'lucide-react';
import './first-use-guide.css';

interface Props {
  host?:HTMLElement; target: string; stage: string; title: string; body: string; progress: number;
  action?: string; onNext: () => void; onSkip: () => void;
}
interface Position { x:number; y:number; w:number; h:number; bx:number; by:number; bw:number; tail:number; tailY:number; side:'top'|'bottom'|'left'|'right'|'none' }
function visibleGuideTarget(selector:string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(node=>{
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&!node.closest('[inert],[aria-hidden="true"]');
  });
}
/** Only the coach marks are drawn here. Every highlighted element belongs to the live app. */
export default function FirstUseGuide({host=document.body,target,stage,title,body,progress,action,onNext,onSkip}:Props) {
  useLayoutEffect(()=>{
    if(host===document.body)return;
    const panel=host.querySelector<HTMLElement>('[aria-modal="true"]');
    if(!panel)return;
    const label=panel.getAttribute('aria-label');
    host.setAttribute('role','dialog');host.setAttribute('aria-modal','true');if(label)host.setAttribute('aria-label',label);
    panel.setAttribute('aria-modal','false');
    return()=>{host.removeAttribute('role');host.removeAttribute('aria-modal');host.removeAttribute('aria-label');panel.setAttribute('aria-modal','true');};
  },[host]);
  const id=useId(), maskId=`guide-mask-${id.replace(/:/g,'')}`;
  const note=useRef<HTMLElement>(null);
  const [position,setPosition]=useState<Position|null>(null);
  useLayoutEffect(()=>{
    let frame=0, until=0, anchor:HTMLElement|undefined, oldDescription:string|null=null, owner:HTMLElement|null=null, oldOwned:string|null=null;
    const observed=new Set<HTMLElement>();
    const release=()=>{
      if(!anchor)return;
      if(owner){if(oldOwned===null)owner.removeAttribute('aria-owns');else owner.setAttribute('aria-owns',oldOwned);owner=null;}
      for(const node of observed)resize.unobserve(node);observed.clear();
      delete anchor.dataset.guideAnchorActive;
      if(oldDescription===null)anchor.removeAttribute('aria-describedby');else anchor.setAttribute('aria-describedby',oldDescription);
    };
    const measure=()=>{
      const next=visibleGuideTarget(target), bubble=note.current;
      if(next!==anchor){
        release(); anchor=next;
        if(anchor){for(const node of [anchor,anchor.parentElement,anchor.closest<HTMLElement>('.context-panel,.reading-paper')])if(node){resize.observe(node);observed.add(node);}owner=anchor.closest<HTMLElement>('[role=dialog]');if(owner){oldOwned=owner.getAttribute('aria-owns');owner.setAttribute('aria-owns',[oldOwned,`${id}-note`].filter(Boolean).join(' '));}oldDescription=anchor.getAttribute('aria-describedby');anchor.dataset.guideAnchorActive='true';anchor.setAttribute('aria-describedby',[oldDescription,`${id}-copy`].filter(Boolean).join(' '));}
      }
      if(!bubble)return;
      const viewport=window.visualViewport, vw=viewport?.width??innerWidth, vh=viewport?.height??innerHeight;
      const ox=viewport?.offsetLeft??0, oy=viewport?.offsetTop??0, margin=16;
      const theme=getComputedStyle(document.documentElement),safeTop=Math.max(margin,parseFloat(theme.getPropertyValue('--safe-top'))||0),safeBottom=Math.max(margin,parseFloat(theme.getPropertyValue('--safe-bottom'))||0);
      const bw=Math.min(312,vw-2*margin), bh=bubble.getBoundingClientRect().height;
      const r=anchor?.getBoundingClientRect();
      let x=r?Math.max(ox+5,r.left-8):ox+vw/2, y=r?Math.max(oy+5,r.top-8):oy+vh/2;
      let right=r?Math.min(ox+vw-5,r.right+8):x,bottom=r?Math.min(oy+vh-5,r.bottom+8):y;
      // Intersect the focus with its real scrolling containers, rather than drawing through a toolbar.
      for(let parent=anchor?.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if(/auto|scroll|hidden|clip/.test(style.overflowY+style.overflowX)){
          const clip=parent.getBoundingClientRect();x=Math.max(x,clip.left);y=Math.max(y,clip.top);right=Math.min(right,clip.right);bottom=Math.min(bottom,clip.bottom);
        }
      }
      const w=Math.max(0,right-x),h=Math.max(0,bottom-y), gap=20;
      const clampX=(v:number)=>Math.max(ox+margin,Math.min(ox+vw-bw-margin,v));
      const clampY=(v:number)=>Math.max(oy+safeTop,Math.min(oy+vh-bh-safeBottom,v));
      const candidates=[
        {bx:right+gap,by:clampY(y+h/2-bh/2),side:'left' as const,valid:right+gap+bw<=ox+vw-margin},
        {bx:x-gap-bw,by:clampY(y+h/2-bh/2),side:'right' as const,valid:x-gap-bw>=ox+margin},
        {bx:clampX(x+w/2-bw/2),by:bottom+gap,side:'top' as const,valid:bottom+gap+bh<=oy+vh-safeBottom},
        {bx:clampX(x+w/2-bw/2),by:y-gap-bh,side:'bottom' as const,valid:y-gap-bh>=oy+safeTop},
      ];
      const placement=candidates.find(item=>item.valid&&w&&h)??{bx:clampX(x+w/2-bw/2),by:clampY(y>oy+vh/2?oy+margin:oy+vh-bh-margin),side:'none' as const};
      const value={x,y,w,h,bw,bx:placement.bx,by:placement.by,side:placement.side,tail:Math.max(26,Math.min(bw-26,x+w/2-placement.bx)),tailY:Math.max(26,Math.min(bh-26,y+h/2-placement.by))};
      setPosition(previous=>previous&&Object.keys(value).every(key=>previous[key as keyof Position]===value[key as keyof Position])?previous:value);
      if(performance.now()<until)frame=requestAnimationFrame(measure);
    };
    const update=()=>{cancelAnimationFrame(frame);until=performance.now()+650;frame=requestAnimationFrame(measure);};
    const observer=new MutationObserver(records=>{if(records.some(record=>!(record.target instanceof Element)||!record.target.closest('[data-app-guide]')))update();});
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-tab','data-open','data-query-open','data-recall','data-closing']});
    const resize=new ResizeObserver(update);resize.observe(document.documentElement);if(note.current)resize.observe(note.current);
    document.addEventListener('scroll',update,true);window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);window.visualViewport?.addEventListener('scroll',update);
    const first=visibleGuideTarget(target);
    if(first){const r=first.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)first.scrollIntoView({block:'nearest',behavior:'instant'});}
    update();
    return()=>{cancelAnimationFrame(frame);release();observer.disconnect();resize.disconnect();document.removeEventListener('scroll',update,true);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);window.visualViewport?.removeEventListener('scroll',update);};
  },[target,stage,id,title,body,host]);
  return createPortal(<div className="app-guide" data-app-guide="" data-stage={stage}>
    {position&&<svg className="app-guide__shade" aria-hidden="true" width="100%" height="100%"><defs><mask id={maskId}><rect width="100%" height="100%" fill="white"/><rect x={position.x} y={position.y} width={position.w} height={position.h} rx="13" fill="black"/></mask></defs><rect width="100%" height="100%" fill="var(--guide-scrim)" mask={`url(#${maskId})`}/><rect x={position.x} y={position.y} width={position.w} height={position.h} rx="13" fill="none" stroke="var(--guide-ring)" strokeWidth="2"/></svg>}
    <aside id={`${id}-note`} ref={note} className="app-guide__bubble" role="note" aria-labelledby={`${id}-title`} data-side={position?.side??'none'} style={{left:position?.bx??16,top:position?.by??16,width:position?.bw??312,visibility:position?'visible':'hidden','--guide-tail-x':`${position?.tail??30}px`} as CSSProperties}>
      <div className="app-guide__top"><small>初次体验 · {progress} / 5</small><button className="app-guide__skip" aria-label="跳过引导" title="跳过引导" onClick={onSkip}><X size={18} aria-hidden="true"/></button></div>
      <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-copy`}>{body}</p>
      <footer>{action?<button className="app-guide__next" onClick={onNext}>{action}<ArrowRight size={16} aria-hidden="true"/></button>:<span>试试光圈里的操作</span>}</footer>
    </aside>
    {position&&position.side!=='none'&&<span className="app-guide__tail" aria-hidden="true" data-side={position.side} style={{left:position.side==='left'?position.bx-7:position.side==='right'?position.bx+position.bw-9:position.bx+position.tail,top:position.side==='top'?position.by-7:position.side==='bottom'?position.by+(note.current?.offsetHeight??0)-9:position.by+position.tailY}}/>}
  </div>,host);
}
