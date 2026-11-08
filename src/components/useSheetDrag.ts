import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Drag only the sheet's header; the material list keeps its own vertical scroll. */
export default function useSheetDrag(ref:RefObject<HTMLDivElement|null>,open:boolean,onClose:()=>void) {
  const close=useRef(onClose);close.current=onClose;
  useLayoutEffect(()=>{
    const panel=ref.current;if(!panel||!open)return;
    let drag:{id:number;y:number;dy:number;start:number}|null=null;
    const down=(event:PointerEvent)=>{
      if(innerWidth>=768||event.button!==0||!(event.target as Element).closest('.library-sheet-grab,.library-heading')||(event.target as Element).closest('button'))return;
      panel.getAnimations().forEach(a=>a.finish());panel.style.animation='none';
      drag={id:event.pointerId,y:event.clientY,dy:0,start:performance.now()};panel.setPointerCapture(event.pointerId);
    };
    const move=(event:PointerEvent)=>{if(!drag||drag.id!==event.pointerId)return;event.preventDefault();drag.dy=Math.max(0,event.clientY-drag.y);panel.style.transform=`translateY(${drag.dy}px)`;panel.style.setProperty('--sheet-drag',`${drag.dy}px`);};
    const end=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const gesture=drag;drag=null;
      if(panel.hasPointerCapture(event.pointerId))panel.releasePointerCapture(event.pointerId);
      const dismiss=event.type!=='pointercancel'&&(gesture.dy>90||gesture.dy>30&&performance.now()-gesture.start<300);
      panel.style.removeProperty('animation');panel.style.removeProperty('transform');
      if(dismiss){close.current();return;}
      panel.style.removeProperty('--sheet-drag');
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)panel.animate([{transform:`translateY(${gesture.dy}px)`},{transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
    };
    panel.addEventListener('pointerdown',down);panel.addEventListener('pointermove',move);panel.addEventListener('pointerup',end);panel.addEventListener('pointercancel',end);
    return()=>{panel.removeEventListener('pointerdown',down);panel.removeEventListener('pointermove',move);panel.removeEventListener('pointerup',end);panel.removeEventListener('pointercancel',end);panel.style.removeProperty('animation');panel.style.removeProperty('transform');};
  },[ref,open]);
}
