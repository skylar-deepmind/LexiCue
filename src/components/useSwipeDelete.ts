import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Reveal a separate delete button; the gesture itself never removes data. */
export default function useSwipeDelete(ref: RefObject<HTMLElement | null>, open: boolean, onOpen: (open: boolean) => void, enabled: boolean) {
  const latest = useRef({open,onOpen});latest.current={open,onOpen};
  useLayoutEffect(() => {
    const node=ref.current;if(!node||!enabled)return;
    let drag:{id:number;x:number;y:number;dx:number;active:boolean;base:number}|null=null;
    let suppress=false,timer:ReturnType<typeof setTimeout>;
    const down=(event:PointerEvent)=>{
      if(event.button!==0||!(event.target as Element).closest('.saved-record-open'))return;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,active:false,base:latest.current.open?-72:0};
    };
    const move=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.active){if(Math.abs(dy)>Math.abs(dx)+6){drag=null;return;}if(Math.abs(dx)<8)return;drag.active=true;node.setPointerCapture(event.pointerId);node.dataset.swiping='true';}
      event.preventDefault();drag.dx=dx;
      node.style.setProperty('--swipe-shift',`${Math.max(-88,Math.min(0,drag.base+dx))}px`);
    };
    const end=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const gesture=drag;drag=null;delete node.dataset.swiping;node.style.removeProperty('--swipe-shift');
      if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);
      if(!gesture.active)return;
      suppress=true;clearTimeout(timer);timer=setTimeout(()=>{suppress=false;},350);
      latest.current.onOpen(event.type==='pointercancel'?latest.current.open:gesture.base+gesture.dx < -32);
    };
    const click=(event:MouseEvent)=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}};
    node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);node.addEventListener('click',click,true);
    return()=>{clearTimeout(timer);node.style.removeProperty('--swipe-shift');delete node.dataset.swiping;node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',end);node.removeEventListener('click',click,true);};
  },[ref,enabled]);
}
